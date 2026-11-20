-- Songs: the person who uploaded a song (or the file it came from) can delete it, and admins can delete any song.
-- Safe to re-run; deletes nothing. (Replaces the delete rule from songs_owner.sql.)
drop policy if exists "allowed remove songs" on or_hasharon_worship.songs;
drop policy if exists "uploader removes songs" on or_hasharon_worship.songs;
create policy "uploader removes songs" on or_hasharon_worship.songs for delete to authenticated
  using (or_hasharon_worship.is_admin()
    or (or_hasharon_worship.is_allowed() and lower(coalesce(added_by, '')) = lower(auth.jwt() ->> 'email')));
