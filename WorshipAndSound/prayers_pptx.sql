-- Run once, after sermon.sql. Safe to re-run; deletes nothing.
-- 1) The speaker may upload a PowerPoint (.pptx) as well as a PDF, up to 50MB (the free plan's limit per file).
-- 2) Prayer requests for the presentation: typed in the site's "מצגת" tab. A meeting shows the latest text saved
--    for it or for an earlier meeting, so the same requests carry on until someone updates them.
--    Only the signed-in team can read or write them (they are personal; never in the public repository).

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = '{application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation}'
 where id = 'sermons';

create table if not exists or_hasharon_worship.prayer_requests (
  meeting_date date primary key,
  body text not null default '',
  updated_by text default auth.email(),
  updated_at timestamptz not null default now()
);
alter table or_hasharon_worship.prayer_requests enable row level security;
drop policy if exists prayer_read on or_hasharon_worship.prayer_requests;
drop policy if exists prayer_insert on or_hasharon_worship.prayer_requests;
drop policy if exists prayer_update on or_hasharon_worship.prayer_requests;
create policy prayer_read on or_hasharon_worship.prayer_requests
  for select to authenticated using (or_hasharon_worship.is_allowed());
create policy prayer_insert on or_hasharon_worship.prayer_requests
  for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy prayer_update on or_hasharon_worship.prayer_requests
  for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
grant select, insert, update on or_hasharon_worship.prayer_requests to authenticated;
