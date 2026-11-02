-- Songs: only the person who uploaded a song (or the file it came from) can delete it. Safe to re-run.
drop policy if exists "allowed remove songs" on or_hasharon_worship.songs;
drop policy if exists "uploader removes songs" on or_hasharon_worship.songs;
create policy "uploader removes songs" on or_hasharon_worship.songs for delete to authenticated
  using (or_hasharon_worship.is_allowed() and lower(coalesce(added_by, '')) = lower(auth.jwt() ->> 'email'));
