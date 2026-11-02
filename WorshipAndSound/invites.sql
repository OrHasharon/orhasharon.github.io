-- WorshipAndSound: (1) one person may play several instruments at the same meeting,
-- (2) email invitations: a sign-up made for someone else is "pending" until they confirm or decline from the email.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- (1) several instruments per person per meeting
alter table or_hasharon_worship.signups drop constraint if exists signups_meeting_date_role_member_id_key;
drop index if exists or_hasharon_worship.signups_unique_slot;
create unique index signups_unique_slot on or_hasharon_worship.signups (meeting_date, role, member_id, coalesce(instrument, ''));

-- (2) invitations
alter table or_hasharon_worship.members add column if not exists email text;
alter table or_hasharon_worship.signups add column if not exists status text not null default 'confirmed';
alter table or_hasharon_worship.signups add column if not exists invite_token uuid unique;
alter table or_hasharon_worship.signups add column if not exists invited_by text;
grant update on or_hasharon_worship.signups to authenticated;
drop policy if exists "allowed edit signups" on or_hasharon_worship.signups;
create policy "allowed edit signups" on or_hasharon_worship.signups for update to authenticated
  using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());

create table if not exists or_hasharon_worship.invite_log (
  token uuid primary key,
  member_name text, member_email text, role text, instrument text, meeting_date date,
  invited_by text, response text, reason text, answered_at timestamptz not null default now()
);
alter table or_hasharon_worship.invite_log enable row level security;
drop policy if exists "allowed read invite log" on or_hasharon_worship.invite_log;
create policy "allowed read invite log" on or_hasharon_worship.invite_log for select to authenticated using (or_hasharon_worship.is_allowed());
grant select on or_hasharon_worship.invite_log to authenticated;

-- Everything below is reachable without logging in, but only with the secret token from the email.
create or replace function or_hasharon_worship.invite_details(t uuid)
returns table (member_name text, member_email text, role text, instrument text, meeting_date date, invited_by text, status text, response text, reason text)
language sql stable security definer set search_path = '' as $$
  select m.name, m.email, s.role, s.instrument, s.meeting_date, s.invited_by, s.status, null::text, null::text
    from or_hasharon_worship.signups s join or_hasharon_worship.members m on m.id = s.member_id
   where s.invite_token = t
  union all
  select l.member_name, l.member_email, l.role, l.instrument, l.meeting_date, l.invited_by, 'answered', l.response, l.reason
    from or_hasharon_worship.invite_log l
   where l.token = t and not exists (select 1 from or_hasharon_worship.signups s where s.invite_token = t and s.status = 'pending')
$$;

create or replace function or_hasharon_worship.respond_invite(t uuid, accept boolean, why text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select si.*, m.name as mname, m.email as memail into s
    from or_hasharon_worship.signups si join or_hasharon_worship.members m on m.id = si.member_id
   where si.invite_token = t and si.status = 'pending';
  if not found then return 'not_found'; end if;
  insert into or_hasharon_worship.invite_log (token, member_name, member_email, role, instrument, meeting_date, invited_by, response, reason)
    values (t, s.mname, s.memail, s.role, s.instrument, s.meeting_date, s.invited_by, case when accept then 'accepted' else 'declined' end, why)
    on conflict (token) do update set response = excluded.response, reason = excluded.reason, answered_at = now();
  if accept then
    update or_hasharon_worship.signups set status = 'confirmed' where id = s.id;
    return 'accepted';
  else
    delete from or_hasharon_worship.signups where id = s.id;
    return 'declined';
  end if;
end $$;

revoke all on function or_hasharon_worship.invite_details(uuid) from public;
revoke all on function or_hasharon_worship.respond_invite(uuid, boolean, text) from public;
grant execute on function or_hasharon_worship.invite_details(uuid) to anon, authenticated;
grant execute on function or_hasharon_worship.respond_invite(uuid, boolean, text) to anon, authenticated;
