-- Who wrote the Lord's Supper verse: set only when the verse itself is changed (not when the parasha is saved).
-- Safe to re-run; deletes nothing.
alter table or_hasharon_worship.meeting_texts add column if not exists communion_by text;
alter table or_hasharon_worship.meeting_texts add column if not exists communion_at timestamptz;
-- who uploaded the parasha presentation
alter table or_hasharon_worship.meeting_texts add column if not exists parasha_file_by text;
notify pgrst, 'reload schema';
