-- Worship sessions: only that meeting's worship leader can (admins included) add, reorder, edit notes or remove songs.
-- Everyone signed in can still read the session. Safe to re-run.
create or replace function or_hasharon_worship.can_edit_setlist(d date) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from or_hasharon_worship.signups s
    join or_hasharon_worship.allowed_users u on u.member_id = s.member_id
    where s.meeting_date = d and s.role = 'leader'
      and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function or_hasharon_worship.can_edit_setlist(date) from public;
grant execute on function or_hasharon_worship.can_edit_setlist(date) to authenticated;

drop policy if exists "allowed add setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "allowed edit setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "allowed remove setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "leader adds to setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "leader edits setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "leader removes from setlist" on or_hasharon_worship.setlist_items;
create policy "leader adds to setlist" on or_hasharon_worship.setlist_items for insert to authenticated
  with check (or_hasharon_worship.can_edit_setlist(meeting_date));
create policy "leader edits setlist" on or_hasharon_worship.setlist_items for update to authenticated
  using (or_hasharon_worship.can_edit_setlist(meeting_date)) with check (or_hasharon_worship.can_edit_setlist(meeting_date));
create policy "leader removes from setlist" on or_hasharon_worship.setlist_items for delete to authenticated
  using (or_hasharon_worship.can_edit_setlist(meeting_date));
