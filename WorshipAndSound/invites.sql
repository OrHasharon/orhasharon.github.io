-- WorshipAndSound: several instruments per person per meeting + invitations by WhatsApp / email.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- (1) one person may play several instruments at the same meeting
alter table or_hasharon_worship.signups drop constraint if exists signups_meeting_date_role_member_id_key;
drop index if exists or_hasharon_worship.signups_unique_slot;
create unique index signups_unique_slot on or_hasharon_worship.signups (meeting_date, role, member_id, coalesce(instrument, ''));

-- (2) contact details live with the site's users: phone + which team member they are
alter table or_hasharon_worship.allowed_users add column if not exists phone text;
alter table or_hasharon_worship.allowed_users add column if not exists member_id bigint references or_hasharon_worship.members(id) on delete set null;
-- everyone on the list can see the list (needed to reach the person they sign up); only admins change it
drop policy if exists "see own row or all if admin" on or_hasharon_worship.allowed_users;
drop policy if exists "allowed see users" on or_hasharon_worship.allowed_users;
create policy "allowed see users" on or_hasharon_worship.allowed_users for select to authenticated using (or_hasharon_worship.is_allowed());

-- (3) a sign-up made for someone else is "pending" until they answer
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

-- The answer page works without logging in, but only with the secret token from the message.
drop function if exists or_hasharon_worship.invite_details(uuid);
create function or_hasharon_worship.invite_details(t uuid)
returns table (member_name text, member_email text, role text, instrument text, meeting_date date,
               invited_by text, inviter_name text, inviter_phone text, status text, response text, reason text)
language sql stable security definer set search_path = '' as $$
  with inv as (
    select m.name as member_name, (select u.email from or_hasharon_worship.allowed_users u where u.member_id = m.id limit 1) as member_email,
           s.role, s.instrument, s.meeting_date, s.invited_by, s.status, null::text as response, null::text as reason
      from or_hasharon_worship.signups s join or_hasharon_worship.members m on m.id = s.member_id
     where s.invite_token = t
    union all
    select l.member_name, l.member_email, l.role, l.instrument, l.meeting_date, l.invited_by, 'answered', l.response, l.reason
      from or_hasharon_worship.invite_log l
     where l.token = t and not exists (select 1 from or_hasharon_worship.signups s where s.invite_token = t and s.status = 'pending')
  )
  select inv.member_name, inv.member_email, inv.role, inv.instrument, inv.meeting_date, inv.invited_by,
         coalesce(mm.name, inv.invited_by), u.phone, inv.status, inv.response, inv.reason
    from inv
    left join or_hasharon_worship.allowed_users u on lower(u.email) = lower(inv.invited_by)
    left join or_hasharon_worship.members mm on mm.id = u.member_id
$$;

create or replace function or_hasharon_worship.respond_invite(t uuid, accept boolean, why text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select si.*, m.name as mname into s
    from or_hasharon_worship.signups si join or_hasharon_worship.members m on m.id = si.member_id
   where si.invite_token = t and si.status = 'pending';
  if not found then return 'not_found'; end if;
  insert into or_hasharon_worship.invite_log (token, member_name, member_email, role, instrument, meeting_date, invited_by, response, reason)
    values (t, s.mname, (select u.email from or_hasharon_worship.allowed_users u where u.member_id = s.member_id limit 1),
            s.role, s.instrument, s.meeting_date, s.invited_by, case when accept then 'accepted' else 'declined' end, why)
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
