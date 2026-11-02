-- Worship sessions: ordered songs (with notes) per meeting. Allowed users only. Safe to re-run.
create table if not exists or_hasharon_worship.setlist_items (
  id bigint generated always as identity primary key,
  meeting_date date not null,
  song_id bigint not null references or_hasharon_worship.songs(id) on delete cascade,
  position int not null default 0,
  notes text,
  added_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
alter table or_hasharon_worship.setlist_items enable row level security;
drop policy if exists "allowed read setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "allowed add setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "allowed edit setlist" on or_hasharon_worship.setlist_items;
drop policy if exists "allowed remove setlist" on or_hasharon_worship.setlist_items;
create policy "allowed read setlist" on or_hasharon_worship.setlist_items for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed add setlist" on or_hasharon_worship.setlist_items for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed edit setlist" on or_hasharon_worship.setlist_items for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
create policy "allowed remove setlist" on or_hasharon_worship.setlist_items for delete to authenticated using (or_hasharon_worship.is_allowed());
grant select, insert, update, delete on or_hasharon_worship.setlist_items to authenticated;
grant usage, select on sequence or_hasharon_worship.setlist_items_id_seq to authenticated;
