-- Worship sessions: admins can always change the songs of any session (add, reorder, notes, remove).
-- Everyone else as before: the meeting's worship leader, or every signed-in member while no leader is assigned.
-- Safe to re-run; deletes nothing. (Replaces the function from setlist_no_leader.sql; the policies stay.)
create or replace function or_hasharon_worship.can_edit_setlist(d date) returns boolean
  language sql stable security definer set search_path = '' as $$
  select or_hasharon_worship.is_admin()
    or exists (
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
