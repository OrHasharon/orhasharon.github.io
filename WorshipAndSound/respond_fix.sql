-- WorshipAndSound: the confirm / decline links work for any sign-up that hasn't been answered yet
-- (also your own, which starts out confirmed). Run once: SQL Editor -> New query -> paste -> Run. Safe to re-run.

drop function if exists or_hasharon_worship.invite_details(uuid);
create function or_hasharon_worship.invite_details(t uuid)
returns table (member_name text, member_email text, role text, instrument text, meeting_date date,
               invited_by text, inviter_name text, inviter_phone text, status text, response text, reason text)
language sql stable security definer set search_path = '' as $$
  with answered as (select * from or_hasharon_worship.invite_log l where l.token = t),
  inv as (
    -- not answered yet: the live sign-up
    select m.name as member_name, (select u.email from or_hasharon_worship.allowed_users u where u.member_id = m.id limit 1) as member_email,
           s.role, s.instrument, s.meeting_date, s.invited_by, s.status, null::text as response, null::text as reason
      from or_hasharon_worship.signups s join or_hasharon_worship.members m on m.id = s.member_id
     where s.invite_token = t and not exists (select 1 from answered)
    union all
    -- already answered
    select a.member_name, a.member_email, a.role, a.instrument, a.meeting_date, a.invited_by, 'answered', a.response, a.reason from answered a
  )
  select inv.member_name, inv.member_email, inv.role, inv.instrument, inv.meeting_date, inv.invited_by,
         coalesce(mm.name, inv.invited_by), u.phone, inv.status, inv.response, inv.reason
    from inv
    left join or_hasharon_worship.allowed_users u on lower(u.email) = lower(inv.invited_by)
    left join or_hasharon_worship.members mm on mm.id = u.member_id
$$;

create or replace function or_hasharon_worship.respond_invite(t uuid, accept boolean, why text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s record; prev text;
begin
  select response into prev from or_hasharon_worship.invite_log where token = t;
  if prev = 'declined' then return 'answered'; end if;            -- the sign-up is gone already
  if prev = 'accepted' then
    if accept then return 'answered'; end if;                     -- confirmed twice: nothing to do
    delete from or_hasharon_worship.signups where invite_token = t; -- changed their mind after confirming
    update or_hasharon_worship.invite_log set response = 'declined', reason = why, answered_at = now() where token = t;
    return 'declined';
  end if;
  select si.*, m.name as mname into s
    from or_hasharon_worship.signups si join or_hasharon_worship.members m on m.id = si.member_id
   where si.invite_token = t;
  if not found then return 'not_found'; end if;
  insert into or_hasharon_worship.invite_log (token, member_name, member_email, role, instrument, meeting_date, invited_by, response, reason)
    values (t, s.mname, (select u.email from or_hasharon_worship.allowed_users u where u.member_id = s.member_id limit 1),
            s.role, s.instrument, s.meeting_date, s.invited_by, case when accept then 'accepted' else 'declined' end, why);
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

-- version marker, so the site (and Claude) can tell this script has run
create or replace function or_hasharon_worship.invites_version() returns int language sql immutable as 'select 2';
grant execute on function or_hasharon_worship.invites_version() to anon, authenticated;