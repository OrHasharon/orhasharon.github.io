-- Run once. Safe to re-run; deletes nothing.
-- The week's texts for the presentation, typed in the site's upcoming-meeting tab:
--   parasha (name), parasha_refs (one reading per line), reading_ref + reading (the passage read aloud),
--   communion_verse + communion_ref (the Lord's Supper verse; carries on to later meetings until changed).
-- Not private: the projection screen reads them without signing in. Only the signed-in team can write.

create table if not exists or_hasharon_worship.meeting_texts (
  meeting_date date primary key,
  parasha text not null default '',
  parasha_refs text not null default '',
  reading_ref text not null default '',
  reading text not null default '',
  communion_verse text not null default '',
  communion_ref text not null default '',
  updated_by text default auth.email(),
  updated_at timestamptz not null default now()
);
alter table or_hasharon_worship.meeting_texts enable row level security;
drop policy if exists texts_read on or_hasharon_worship.meeting_texts;
drop policy if exists texts_insert on or_hasharon_worship.meeting_texts;
drop policy if exists texts_update on or_hasharon_worship.meeting_texts;
create policy texts_read on or_hasharon_worship.meeting_texts
  for select to anon, authenticated using (true);
create policy texts_insert on or_hasharon_worship.meeting_texts
  for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy texts_update on or_hasharon_worship.meeting_texts
  for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
grant select on or_hasharon_worship.meeting_texts to anon, authenticated;
grant insert, update on or_hasharon_worship.meeting_texts to authenticated;
