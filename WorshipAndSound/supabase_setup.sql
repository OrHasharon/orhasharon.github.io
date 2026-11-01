-- WorshipAndSound (sub-site of OrHasharon): team info + self sign-up per meeting.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Then add "or_hasharon_worship" to Settings -> API -> Exposed schemas.

create schema if not exists or_hasharon_worship;
grant usage on schema or_hasharon_worship to anon, authenticated;

-- Team members. Editable from the site by anyone with the link (no deletes: set active = false instead).
create table or_hasharon_worship.members (
  id bigint generated always as identity primary key,
  name text not null unique,
  instruments text,            -- free text, e.g. "גיטרה, בס"
  lead_frequency text,         -- null = doesn't lead worship; e.g. "פעם בחודש"
  sound boolean not null default false,   -- runs the sound desk
  setup boolean not null default false,   -- sets up the sound equipment
  notes text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table or_hasharon_worship.members enable row level security;
create policy "anyone can read members" on or_hasharon_worship.members
  for select to anon, authenticated using (true);
create policy "anyone can add members" on or_hasharon_worship.members
  for insert to anon, authenticated with check (true);
create policy "anyone can edit members" on or_hasharon_worship.members
  for update to anon, authenticated using (true) with check (true);
grant select, insert, update on or_hasharon_worship.members to anon, authenticated;
grant usage, select on sequence or_hasharon_worship.members_id_seq to anon, authenticated;

-- Sign-ups: one row per person per role per meeting.
create table or_hasharon_worship.signups (
  id bigint generated always as identity primary key,
  meeting_date date not null,
  role text not null check (role in ('leader', 'musician', 'sound', 'setup')),
  member_id bigint not null references or_hasharon_worship.members(id),
  instrument text,             -- for musicians
  created_at timestamptz not null default now(),
  unique (meeting_date, role, member_id)
);
alter table or_hasharon_worship.signups enable row level security;
create policy "anyone can read signups" on or_hasharon_worship.signups
  for select to anon, authenticated using (true);
create policy "anyone can sign up" on or_hasharon_worship.signups
  for insert to anon, authenticated with check (true);
create policy "anyone can remove a signup" on or_hasharon_worship.signups
  for delete to anon, authenticated using (true);
grant select, insert, delete on or_hasharon_worship.signups to anon, authenticated;
grant usage, select on sequence or_hasharon_worship.signups_id_seq to anon, authenticated;

-- Usage log: insert-only from the site, readable only in the dashboard.
create table or_hasharon_worship.usage_logs (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now(),
  visitor_name text,
  action text not null default 'page_view'
);
alter table or_hasharon_worship.usage_logs enable row level security;
create policy "anon can insert logs" on or_hasharon_worship.usage_logs
  for insert to anon, authenticated with check (true);
grant insert on or_hasharon_worship.usage_logs to anon, authenticated;
grant usage, select on sequence or_hasharon_worship.usage_logs_id_seq to anon, authenticated;

-- Starting team (as given by Uriya, 2026-11-01)
insert into or_hasharon_worship.members (name, instruments, lead_frequency, sound, setup) values
  ('אוריה סתוי',   'גיטרה, קחון (אם חייב)', 'פעם ברבעון',          true,  true),
  ('חגית זיגל',    'קלידים',                'פעם בחודש',           false, false),
  ('רנדי סיגולים', 'גיטרה, גיטרה חשמלית',   'פעם בחודש (בגיטרה)',  false, false),
  ('אור קוסינוב',  'קלידים',                'פעם בחודש',           false, false),
  ('ליה לביא',     'גיטרה, בס',             null,                  false, false),
  ('איילת הנדרן',  'כינור',                 null,                  false, false),
  ('רולנד שיפרס',  'גיטרה',                 null,                  false, false),
  ('נועם לבונטי',  'גיטרה, בס',             null,                  false, true),
  ('שמעון רוז',    'קלידים',                null,                  false, false),
  ('יונתן רוז',    'קלידים, קחון',          null,                  false, false),
  ('אורי חיון',    null,                    null,                  true,  false),
  ('אנדרי בביץ',   null,                    null,                  false, true),
  ('גייסון רוז',   null,                    null,                  false, true);
