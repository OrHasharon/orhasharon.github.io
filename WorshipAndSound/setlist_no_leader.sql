-- Worship sessions: the meeting's worship leader edits the session; when no leader is assigned yet,
-- every signed-in team member can. Safe to re-run; deletes nothing. (Replaces the rule from setlist_leader.sql.)
create or replace function or_hasharon_worship.can_edit_setlist(d date) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
      select 1
      from or_hasharon_worship.signups s
      join or_hasharon_worship.allowed_users u on u.member_id = s.member_id
      where s.meeting_date = d and s.role = 'leader'
        and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or (not exists (select 1 from or_hasharon_worship.signups s where s.meeting_date = d and s.role = 'leader')
        and or_hasharon_worship.is_allowed())
$$;
revoke all on function or_hasharon_worship.can_edit_setlist(date) from public;
grant execute on function or_hasharon_worship.can_edit_setlist(date) to authenticated;
