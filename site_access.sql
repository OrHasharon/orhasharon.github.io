-- Entry to the community site (orhasharon.github.io) by phone number, instead of the shared code. Safe to re-run.
-- * site_phones: the numbers that may enter. Only admins (allowed_users.is_admin, signed in with Google) see/edit it.
-- * site_logins: every attempt (approved or not) with the device and the IP address. Only admins read it.
-- * site_admins.sql (run after this) re-creates site_enter() so an admin's phone counts too: re-run it after this file.
-- * site_enter(): the one thing the public site may call. It checks a number without revealing the list,
--   writes the attempt to the log and blocks an IP address after 10 wrong numbers in an hour.

create table if not exists or_hasharon_worship.site_phones (
  phone    text primary key,               -- digits only, Israeli form: 0501234567
  name     text not null default '',
  added_by text,
  added_at timestamptz not null default now()
);

create table if not exists or_hasharon_worship.site_logins (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  phone   text not null,                    -- what was typed (normalized), also when it is not in the list
  ok      boolean not null,
  name    text,                             -- the list's name at the time, for approved entries
  kind    text not null default 'login',    -- login = typed the number; visit = came back on a remembered device
  device  text,
  ip      text,
  hits    int not null default 1            -- repeated visits from the same device+IP within 30 minutes
);
create index if not exists site_logins_at on or_hasharon_worship.site_logins (at desc);

alter table or_hasharon_worship.site_phones enable row level security;
alter table or_hasharon_worship.site_logins enable row level security;

drop policy if exists "admins read phones" on or_hasharon_worship.site_phones;
drop policy if exists "admins add phones" on or_hasharon_worship.site_phones;
drop policy if exists "admins edit phones" on or_hasharon_worship.site_phones;
drop policy if exists "admins remove phones" on or_hasharon_worship.site_phones;
drop policy if exists "admins read logins" on or_hasharon_worship.site_logins;
create policy "admins read phones" on or_hasharon_worship.site_phones for select to authenticated using (or_hasharon_worship.is_admin());
create policy "admins add phones" on or_hasharon_worship.site_phones for insert to authenticated with check (or_hasharon_worship.is_admin());
create policy "admins edit phones" on or_hasharon_worship.site_phones for update to authenticated using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
create policy "admins remove phones" on or_hasharon_worship.site_phones for delete to authenticated using (or_hasharon_worship.is_admin());
create policy "admins read logins" on or_hasharon_worship.site_logins for select to authenticated using (or_hasharon_worship.is_admin());

grant select, insert, update, delete on or_hasharon_worship.site_phones to authenticated;
grant select on or_hasharon_worship.site_logins to authenticated;
revoke all on or_hasharon_worship.site_phones from anon;
revoke all on or_hasharon_worship.site_logins from anon;

create or replace function or_hasharon_worship.site_norm_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case when d like '972%' then '0' || substr(d, 4) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

create or replace function or_hasharon_worship.site_enter(p_phone text, p_device text default null, p_kind text default 'login')
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_ph   text := or_hasharon_worship.site_norm_phone(p_phone);
  hdr  json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip   text := coalesce(nullif(trim(split_part(hdr ->> 'x-forwarded-for', ',', 1)), ''), hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip');
  v_dev  text := left(coalesce(p_device, ''), 200);
  v_kind  text := case when p_kind = 'visit' then 'visit' else 'login' end;
  v_name   text;
  v_hit  boolean;
  v_last bigint;
begin
  if length(v_ph) < 9 or length(v_ph) > 12 then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  -- too many wrong numbers from this address in the last hour: stop answering. Counted on the address's latest
  -- failed row (not a new row each time, so nobody can flood the log)
  if (select count(*) from or_hasharon_worship.site_logins l
       where not l.ok and l.ip is not distinct from v_ip and l.at > now() - interval '1 hour') >= 10 then
    update or_hasharon_worship.site_logins set hits = hits + 1, at = now()
     where id = (select l.id from or_hasharon_worship.site_logins l
                  where not l.ok and l.ip is not distinct from v_ip order by l.at desc limit 1);
    return json_build_object('ok', false, 'reason', 'blocked');
  end if;
  select p.name into v_name from or_hasharon_worship.site_phones p where p.phone = v_ph;
  v_hit := found;
  -- a remembered device coming back often: one row per 30 minutes, not one per page view
  select l.id into v_last from or_hasharon_worship.site_logins l
   where l.phone = v_ph and l.ok = v_hit and l.device is not distinct from v_dev and l.ip is not distinct from v_ip
     and l.at > now() - interval '30 minutes'
   order by l.at desc limit 1;
  if v_last is not null then
    update or_hasharon_worship.site_logins set at = now(), hits = hits + 1, name = v_name where id = v_last;
  else
    insert into or_hasharon_worship.site_logins (phone, ok, name, kind, device, ip) values (v_ph, v_hit, v_name, v_kind, v_dev, v_ip);
  end if;
  return json_build_object('ok', v_hit, 'name', case when v_hit then v_name end, 'reason', case when v_hit then null else 'unknown' end);
end;
$$;

revoke all on function or_hasharon_worship.site_enter(text, text, text) from public;
grant execute on function or_hasharon_worship.site_enter(text, text, text) to anon, authenticated;
revoke all on function or_hasharon_worship.site_norm_phone(text) from public;
grant execute on function or_hasharon_worship.site_norm_phone(text) to authenticated;

select (select count(*) from or_hasharon_worship.site_phones) as "מספרים ברשימה",
       (select string_agg(email, ', ') from or_hasharon_worship.allowed_users where is_admin) as "מנהלים";
