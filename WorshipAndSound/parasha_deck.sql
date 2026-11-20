-- The week's parasha as an uploaded presentation (PowerPoint or PDF), set in the site's presentation tab.
-- It goes into the meeting's deck as it is, in place of the parasha + reading slides (like the sermon).
-- The file lives in the "sermons" bucket (sermon.sql + prayers_pptx.sql must have run). Safe to re-run; deletes nothing.
alter table or_hasharon_worship.meeting_texts add column if not exists parasha_file_path text;
alter table or_hasharon_worship.meeting_texts add column if not exists parasha_file_name text;
alter table or_hasharon_worship.meeting_texts add column if not exists parasha_file_at timestamptz;
-- (and who wrote the Supper verse, communion_by.sql)
alter table or_hasharon_worship.meeting_texts add column if not exists communion_by text;
alter table or_hasharon_worship.meeting_texts add column if not exists communion_at timestamptz;
notify pgrst, 'reload schema';
