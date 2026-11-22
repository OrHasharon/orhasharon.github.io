-- Duty (תורנות): phones per duty team, swap requests approved by WhatsApp link, and the weekly reminder job.
-- Safe to re-run. Needs site_access.sql + site_admins.sql (site_phones, is_admin, site_norm_phone).
--
-- * duty_teams: a duty team as it appears in the roster ("רנדי ומירי") → its phones (from site_phones). Admins only.
--   A meeting's duty text lists teams separated by commas: "רנדי ומירי, דנאל ויאווה" = two teams.
-- * duty_swaps: swap requests. The requester (identified by the phone they entered the site with) asks another team;
--   the other team approves with a one-time link (duty.html?s=<token>). Approved → duty_overrides() shows both dates
--   with the teams swapped, on top of the Google Sheet / data/duty.json (the sheet itself is not changed).
-- * duty_job_teams(key): the weekly reminder job (runs on Liah's computer, sends through her WhatsApp gateway) reads the
--   teams' phones with a secret key; only its sha256 is stored here.
--
-- To remove: drop function or_hasharon_worship.duty_swap_request(text, date, text, text, date, text),
--   or_hasharon_worship.duty_swap_view(uuid), or_hasharon_worship.duty_swap_answer(uuid, boolean),
--   or_hasharon_worship.duty_overrides(), or_hasharon_worship.duty_job_teams(text), or_hasharon_worship.duty_parts(text),
--   or_hasharon_worship.duty_swap_text(text, text, text), or_hasharon_worship.duty_key_ok(text), or_hasharon_worship.duty_roster(),
--   or_hasharon_worship.duty_roster_save(text, date, text, text, text, text, boolean), or_hasharon_worship.duty_team_list(text);
--   drop table or_hasharon_worship.duty_roster, or_hasharon_worship.duty_swaps, or_hasharon_worship.duty_teams, or_hasharon_worship.duty_job_keys;

create extension if not exists pgcrypto with schema extensions;

create table if not exists or_hasharon_worship.duty_teams (
  name       text primary key,
  phones     text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists or_hasharon_worship.duty_swaps (
  id          bigserial primary key,
  token       uuid not null unique default gen_random_uuid(),
  from_date   date not null,
  from_team   text not null,
  to_date     date not null,
  to_team     text not null,
  from_duty   text not null,          -- the duty text of from_date when asked (after earlier swaps)
  to_duty     text not null,
  req_phone   text not null,
  req_name    text,
  new_from    text,                   -- from_date's text after the swap
  new_to      text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create table if not exists or_hasharon_worship.duty_job_keys (hash text primary key);
insert into or_hasharon_worship.duty_job_keys (hash) values ('90c379f05df34a2b59d211446a1666d1bd09986645366360bb3b56abb99efbd6'),
  ('33886edc7644a69ed82bd15a100574e406a6b2fb9e4ce622a3ae5cc77a3a242e')   -- Michal's weekly send page (duty-send.html#k=…)
on conflict do nothing;

-- the roster (from 22.11): Michal edits it from duty-send.html (key-checked) — adds dates, sets teams, place, kind.
-- A row wins over the Google Sheet and data/duty.json for its date; deleted = the meeting is hidden. Null fields = inherit.
create table if not exists or_hasharon_worship.duty_roster (
  meeting_date date primary key,
  day         text,
  place       text,
  kind        text,
  duty        text,
  notes       text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table or_hasharon_worship.duty_roster enable row level security;
drop policy if exists "admins roster" on or_hasharon_worship.duty_roster;
create policy "admins roster" on or_hasharon_worship.duty_roster for all to authenticated
  using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
grant select, insert, update, delete on or_hasharon_worship.duty_roster to authenticated;

alter table or_hasharon_worship.duty_teams enable row level security;
alter table or_hasharon_worship.duty_swaps enable row level security;
alter table or_hasharon_worship.duty_job_keys enable row level security;   -- no policies: nobody reads it directly
drop policy if exists "admins teams" on or_hasharon_worship.duty_teams;
drop policy if exists "admins read swaps" on or_hasharon_worship.duty_swaps;
drop policy if exists "admins edit swaps" on or_hasharon_worship.duty_swaps;
create policy "admins teams" on or_hasharon_worship.duty_teams for all to authenticated
  using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
create policy "admins read swaps" on or_hasharon_worship.duty_swaps for select to authenticated using (or_hasharon_worship.is_admin());
create policy "admins edit swaps" on or_hasharon_worship.duty_swaps for update to authenticated
  using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
grant select, insert, update, delete on or_hasharon_worship.duty_teams to authenticated;
grant select, update on or_hasharon_worship.duty_swaps to authenticated;

-- the teams in a duty text
create or replace function or_hasharon_worship.duty_parts(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') from unnest(regexp_split_to_array(coalesce(t, ''), ',')) x;
$$;
-- replace one team by another in a duty text (keeps the order and the others)
create or replace function or_hasharon_worship.duty_swap_text(t text, a text, b text) returns text
language sql immutable set search_path = '' as $$
  select array_to_string(array(select case when x = a then b else x end from unnest(or_hasharon_worship.duty_parts(t)) x), ', ');
$$;

-- a member asks another team to swap. p_phone = the phone they entered the site with (gate.js "oh-phone").
create or replace function or_hasharon_worship.duty_swap_request(p_phone text, p_from date, p_from_duty text,
                                                                  p_to_team text, p_to date, p_to_duty text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_ph text := or_hasharon_worship.site_norm_phone(p_phone); v_name text; v_team text; v_to text[]; v_tok uuid;
begin
  select name into v_name from or_hasharon_worship.site_phones where phone = v_ph;
  if v_name is null then return json_build_object('error', 'not_member'); end if;
  if p_from < current_date or p_to < current_date or p_from = p_to then return json_build_object('error', 'bad_dates'); end if;
  select t.name into v_team from or_hasharon_worship.duty_teams t
   where v_ph = any(t.phones) and t.name = any(or_hasharon_worship.duty_parts(p_from_duty)) limit 1;
  if v_team is null then return json_build_object('error', 'not_on_duty'); end if;
  if not (p_to_team = any(or_hasharon_worship.duty_parts(p_to_duty))) or p_to_team = v_team then
    return json_build_object('error', 'bad_team'); end if;
  select t.phones into v_to from or_hasharon_worship.duty_teams t where t.name = p_to_team;
  if coalesce(array_length(v_to, 1), 0) = 0 then return json_build_object('error', 'no_phone'); end if;
  update or_hasharon_worship.duty_swaps set status = 'cancelled', decided_at = now()
   where status = 'pending' and from_team = v_team and from_date = p_from;
  insert into or_hasharon_worship.duty_swaps (from_date, from_team, to_date, to_team, from_duty, to_duty, req_phone, req_name)
  values (p_from, v_team, p_to, p_to_team, p_from_duty, p_to_duty, v_ph, v_name) returning token into v_tok;
  return json_build_object('token', v_tok, 'from_team', v_team, 'req_name', v_name,
    'to', (select json_agg(json_build_object('phone', x, 'name', coalesce(sp.name, ''))) from unnest(v_to) x
           left join or_hasharon_worship.site_phones sp on sp.phone = x));
end $$;

-- the approval page: what is asked (no phone numbers)
create or replace function or_hasharon_worship.duty_swap_view(t uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('from_date', from_date, 'from_team', from_team, 'to_date', to_date, 'to_team', to_team,
    'req_name', req_name, 'status', case when status = 'pending' and least(from_date, to_date) < current_date then 'expired' else status end)
  from or_hasharon_worship.duty_swaps where token = t;
$$;

-- the other team answers (once). Returns the requester's name + phone so they can be told on WhatsApp.
create or replace function or_hasharon_worship.duty_swap_answer(t uuid, yes boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare s or_hasharon_worship.duty_swaps;
begin
  select * into s from or_hasharon_worship.duty_swaps where token = t for update;
  if not found then return json_build_object('error', 'not_found'); end if;
  if s.status <> 'pending' then return json_build_object('error', 'answered', 'status', s.status); end if;
  if least(s.from_date, s.to_date) < current_date then return json_build_object('error', 'expired'); end if;
  if yes then
    update or_hasharon_worship.duty_swaps set status = 'approved', decided_at = now(),
      new_from = or_hasharon_worship.duty_swap_text(s.from_duty, s.from_team, s.to_team),
      new_to   = or_hasharon_worship.duty_swap_text(s.to_duty, s.to_team, s.from_team)
     where id = s.id;
  else
    update or_hasharon_worship.duty_swaps set status = 'declined', decided_at = now() where id = s.id;
  end if;
  return json_build_object('status', case when yes then 'approved' else 'declined' end, 'req_name', s.req_name, 'req_phone', s.req_phone,
    'from_date', s.from_date, 'to_date', s.to_date);
end $$;

-- the roster after swaps, per future date: the latest approved swap touching that date wins
create or replace function or_hasharon_worship.duty_overrides() returns table (meeting_date date, duty text)
language sql stable security definer set search_path = '' as $$
  select distinct on (d) d, txt from (
    select from_date as d, new_from as txt, decided_at from or_hasharon_worship.duty_swaps where status = 'approved'
    union all
    select to_date, new_to, decided_at from or_hasharon_worship.duty_swaps where status = 'approved'
  ) x where d >= current_date - 1
    -- unless Michal edited that date in duty_roster after the swap (her edit already shows the current teams)
    and not exists (select 1 from or_hasharon_worship.duty_roster r where r.meeting_date = x.d and r.updated_at > x.decided_at)
  order by d, decided_at desc;
$$;

-- the reminder job: every team's phones + names, with the job's secret key
create or replace function or_hasharon_worship.duty_job_teams(p_key text)
returns table (team text, phone text, name text)
language sql stable security definer set search_path = '' as $$
  select t.name, x, coalesce(sp.name, '')
  from or_hasharon_worship.duty_teams t cross join unnest(t.phones) x
  left join or_hasharon_worship.site_phones sp on sp.phone = x
  where exists (select 1 from or_hasharon_worship.duty_job_keys k
                where k.hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex'));
$$;

revoke all on function or_hasharon_worship.duty_swap_request(text, date, text, text, date, text) from public;
revoke all on function or_hasharon_worship.duty_swap_view(uuid) from public;
revoke all on function or_hasharon_worship.duty_swap_answer(uuid, boolean) from public;
revoke all on function or_hasharon_worship.duty_overrides() from public;
revoke all on function or_hasharon_worship.duty_job_teams(text) from public;
grant execute on function or_hasharon_worship.duty_swap_request(text, date, text, text, date, text) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_swap_view(uuid) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_swap_answer(uuid, boolean) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_overrides() to anon, authenticated;
grant execute on function or_hasharon_worship.duty_job_teams(text) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_parts(text) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_swap_text(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- the roster editor (duty-send.html, Michal's private link). Every write checks the page's key (duty_job_keys).
create or replace function or_hasharon_worship.duty_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from or_hasharon_worship.duty_job_keys k
                 where k.hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex'));
$$;
revoke all on function or_hasharon_worship.duty_key_ok(text) from public;   -- internal: used by the functions below

-- the site reads the roster (it is public anyway, like the sheet)
create or replace function or_hasharon_worship.duty_roster()
returns table (meeting_date date, day text, place text, kind text, duty text, notes text, deleted boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select meeting_date, day, place, kind, duty, notes, deleted, updated_at from or_hasharon_worship.duty_roster
  where meeting_date >= current_date - 7 order by meeting_date;
$$;

-- add / change / delete (p_deleted) one meeting. Empty text = clear the field (e.g. kind '' = by the day); null = inherit.
create or replace function or_hasharon_worship.duty_roster_save(p_key text, p_date date, p_day text, p_place text,
                                                                 p_kind text, p_duty text, p_deleted boolean)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not or_hasharon_worship.duty_key_ok(p_key) then return json_build_object('error', 'bad_key'); end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 730 then return json_build_object('error', 'bad_date'); end if;
  if length(coalesce(p_duty, '')) > 400 or length(coalesce(p_place, '')) > 120 or length(coalesce(p_kind, '')) > 80
     or length(coalesce(p_day, '')) > 20 then return json_build_object('error', 'too_long'); end if;
  insert into or_hasharon_worship.duty_roster as r (meeting_date, day, place, kind, duty, deleted, updated_at, updated_by)
  values (p_date, btrim(p_day), btrim(p_place), btrim(p_kind), btrim(p_duty), coalesce(p_deleted, false), now(), 'duty-send')
  on conflict (meeting_date) do update set day = excluded.day, place = excluded.place, kind = excluded.kind,
    duty = excluded.duty, deleted = excluded.deleted, updated_at = now(), updated_by = excluded.updated_by;
  return json_build_object('ok', true);
end $$;

-- the team names for the editor's picker, and how many phones each has (no phone numbers)
create or replace function or_hasharon_worship.duty_team_list(p_key text) returns table (name text, phones int)
language sql stable security definer set search_path = '' as $$
  select t.name, coalesce(array_length(t.phones, 1), 0) from or_hasharon_worship.duty_teams t
  where or_hasharon_worship.duty_key_ok(p_key) order by t.name;
$$;

revoke all on function or_hasharon_worship.duty_roster() from public;
revoke all on function or_hasharon_worship.duty_roster_save(text, date, text, text, text, text, boolean) from public;
revoke all on function or_hasharon_worship.duty_team_list(text) from public;
grant execute on function or_hasharon_worship.duty_roster() to anon, authenticated;
grant execute on function or_hasharon_worship.duty_roster_save(text, date, text, text, text, text, boolean) to anon, authenticated;
grant execute on function or_hasharon_worship.duty_team_list(text) to anon, authenticated;

-- the roster as it was on 22.11.2026 (Google Sheet + data/duty.json, before swaps). Old updated_at so approved swaps still
-- show on top; on conflict do nothing, so re-running never overwrites Michal's edits.
insert into or_hasharon_worship.duty_roster (meeting_date, day, place, kind, duty, updated_at, updated_by) values
  ('2026-11-28', 'שבת', 'כפר הבפטיסטים', null, 'גל וליה, יואל ומוריה', '2000-01-01', 'seed 22.11'),
  ('2026-12-04', 'שישי', 'כפר הבפטיסטים', 'מסיבת חנוכה', 'כולם', '2000-01-01', 'seed 22.11'),
  ('2026-12-12', 'שבת', 'כפר הבפטיסטים', null, 'רוני הנדרן, סו וגולן', '2000-01-01', 'seed 22.11'),
  ('2026-12-19', 'שבת', 'כפר הבפטיסטים', null, 'מיכל ורולנד, סטיב ורחל', '2000-01-01', 'seed 22.11'),
  ('2026-12-26', 'שבת', 'כפר הבפטיסטים', null, 'אביאל וקיריל, דן ואניה', '2000-01-01', 'seed 22.11'),
  ('2027-01-01', 'שישי', 'משמר השרון', null, 'כולם', '2000-01-01', 'seed 22.11'),
  ('2027-01-09', 'שבת', 'כפר הבפטיסטים', null, 'מרינה שפר, זוהר ושרית', '2000-01-01', 'seed 22.11'),
  ('2027-01-16', 'שבת', 'כפר הבפטיסטים', null, 'משפחת רוז, סשה וליליאן', '2000-01-01', 'seed 22.11'),
  ('2027-01-23', 'שבת', 'כפר הבפטיסטים', null, 'רוני הנדרן, אורי ושרון', '2000-01-01', 'seed 22.11'),
  ('2027-01-30', 'שבת', 'כפר הבפטיסטים', null, 'אוריה ונעמי', '2000-01-01', 'seed 22.11')
on conflict (meeting_date) do nothing;
