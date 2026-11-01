-- WorshipAndSound: team table like Uriya's sheet (lead checkbox + participation frequency) and the sheet's data.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
alter table or_hasharon_worship.members add column if not exists can_lead boolean not null default false;
alter table or_hasharon_worship.members add column if not exists participation_frequency text;

update or_hasharon_worship.members set instruments = 'פסנתר, שירה',      can_lead = true, lead_frequency = 'פעם בשבועיים' where name = 'אור קוסינוב';
update or_hasharon_worship.members set instruments = 'פסנתר, שירה',      can_lead = true, lead_frequency = 'פעם בחודש'    where name = 'חגית זיגל';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, תוף', can_lead = true, lead_frequency = 'פעם ברבעון'   where name = 'אוריה סתוי';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה',      can_lead = true, lead_frequency = 'פעם בחודש', participation_frequency = 'פעמיים שלוש' where name = 'רנדי סיגולים';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, בס',  can_lead = true, lead_frequency = 'פעם בחודשיים' where name = 'ליה לביא';
update or_hasharon_worship.members set instruments = 'שירה'              where name = 'שרון חיון';
update or_hasharon_worship.members set instruments = 'פסנתר'             where name = 'שמעון רוז';
update or_hasharon_worship.members set instruments = 'פסנתר, תוף'        where name = 'יונתן רוז';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה'       where name = 'רולנד שיפרס';
update or_hasharon_worship.members set instruments = 'כינור'             where name = 'איילת הנדרן';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, בס', can_lead = true, participation_frequency = 'פעמיים שלוש' where name = 'נועם לבונטי';
insert into or_hasharon_worship.members (name, instruments) values
  ('יאווה', 'שירה'), ('טל שפר', 'שירה'), ('נעם לביא', 'שירה'), ('אלי', 'תוף')
  on conflict (name) do nothing;

-- ---------- songs (chord sheets, imported from PDF or typed); open like the rest of the site ----------
create table if not exists or_hasharon_worship.songs (
  id bigint generated always as identity primary key,
  title text not null,
  song_key text,               -- e.g. "Am"
  content text not null,       -- lyrics with [chord] markers, e.g. "[Am]שלום [G]עולם"
  source text,                 -- PDF file name it came from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table or_hasharon_worship.songs enable row level security;
drop policy if exists "anyone can read songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can add songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can edit songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can remove songs" on or_hasharon_worship.songs;
create policy "anyone can read songs" on or_hasharon_worship.songs for select to anon, authenticated using (true);
create policy "anyone can add songs" on or_hasharon_worship.songs for insert to anon, authenticated with check (true);
create policy "anyone can edit songs" on or_hasharon_worship.songs for update to anon, authenticated using (true) with check (true);
create policy "anyone can remove songs" on or_hasharon_worship.songs for delete to anon, authenticated using (true);
grant select, insert, update, delete on or_hasharon_worship.songs to anon, authenticated;
grant usage, select on sequence or_hasharon_worship.songs_id_seq to anon, authenticated;
