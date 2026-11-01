-- WorshipAndSound: switch from "anyone with the link" to "signed in with Google AND on the allowed list".
-- Run AFTER Google login is enabled in Supabase (Authentication -> Sign In / Providers -> Google).
-- Safe to re-run.

-- ---------- allowed users (managed from the site by admins) ----------
create table if not exists or_hasharon_worship.allowed_users (
  email text primary key,
  is_admin boolean not null default false,
  added_by text default (auth.jwt() ->> 'email'),
  added_at timestamptz not null default now()
);
insert into or_hasharon_worship.allowed_users (email, is_admin) values ('uriya19@gmail.com', true)
  on conflict (email) do update set is_admin = true;

-- helpers used by every policy (security definer so they can read allowed_users regardless of its own policies)
create or replace function or_hasharon_worship.is_allowed() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from or_hasharon_worship.allowed_users
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
create or replace function or_hasharon_worship.is_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from or_hasharon_worship.allowed_users
                 where is_admin and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function or_hasharon_worship.is_allowed() from public;
revoke all on function or_hasharon_worship.is_admin() from public;
grant execute on function or_hasharon_worship.is_allowed() to authenticated;
grant execute on function or_hasharon_worship.is_admin() to authenticated;

alter table or_hasharon_worship.allowed_users enable row level security;
drop policy if exists "see own row or all if admin" on or_hasharon_worship.allowed_users;
drop policy if exists "admins add users" on or_hasharon_worship.allowed_users;
drop policy if exists "admins edit users" on or_hasharon_worship.allowed_users;
drop policy if exists "admins remove users" on or_hasharon_worship.allowed_users;
create policy "see own row or all if admin" on or_hasharon_worship.allowed_users
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or or_hasharon_worship.is_admin());
create policy "admins add users" on or_hasharon_worship.allowed_users
  for insert to authenticated with check (or_hasharon_worship.is_admin());
create policy "admins edit users" on or_hasharon_worship.allowed_users
  for update to authenticated using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
create policy "admins remove users" on or_hasharon_worship.allowed_users
  for delete to authenticated using (or_hasharon_worship.is_admin());
grant select, insert, update, delete on or_hasharon_worship.allowed_users to authenticated;

-- ---------- songs (chord sheets, imported from PDF or typed) ----------
create table if not exists or_hasharon_worship.songs (
  id bigint generated always as identity primary key,
  title text not null,
  song_key text,               -- e.g. "Am"
  content text not null,       -- ChordPro-style: lyrics with [chord] markers
  source text,                 -- PDF file name it came from
  added_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table or_hasharon_worship.songs enable row level security;
drop policy if exists "allowed read songs" on or_hasharon_worship.songs;
drop policy if exists "allowed add songs" on or_hasharon_worship.songs;
drop policy if exists "allowed edit songs" on or_hasharon_worship.songs;
drop policy if exists "allowed remove songs" on or_hasharon_worship.songs;
create policy "allowed read songs" on or_hasharon_worship.songs for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed add songs" on or_hasharon_worship.songs for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed edit songs" on or_hasharon_worship.songs for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
create policy "allowed remove songs" on or_hasharon_worship.songs for delete to authenticated using (or_hasharon_worship.is_allowed());
grant select, insert, update, delete on or_hasharon_worship.songs to authenticated;
grant usage, select on sequence or_hasharon_worship.songs_id_seq to authenticated;

-- ---------- members + signups: allowed users only (no more anon) ----------
alter table or_hasharon_worship.signups add column if not exists added_by text default (auth.jwt() ->> 'email');
alter table or_hasharon_worship.members add column if not exists updated_by text default (auth.jwt() ->> 'email');

drop policy if exists "anyone can read members" on or_hasharon_worship.members;
drop policy if exists "anyone can add members" on or_hasharon_worship.members;
drop policy if exists "anyone can edit members" on or_hasharon_worship.members;
drop policy if exists "anyone can read signups" on or_hasharon_worship.signups;
drop policy if exists "anyone can sign up" on or_hasharon_worship.signups;
drop policy if exists "anyone can remove a signup" on or_hasharon_worship.signups;
drop policy if exists "allowed read members" on or_hasharon_worship.members;
drop policy if exists "allowed add members" on or_hasharon_worship.members;
drop policy if exists "allowed edit members" on or_hasharon_worship.members;
drop policy if exists "allowed read signups" on or_hasharon_worship.signups;
drop policy if exists "allowed sign up" on or_hasharon_worship.signups;
drop policy if exists "allowed remove signups" on or_hasharon_worship.signups;
revoke select, insert, update on or_hasharon_worship.members from anon;
revoke select, insert, delete on or_hasharon_worship.signups from anon;

create policy "allowed read members" on or_hasharon_worship.members for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed add members" on or_hasharon_worship.members for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed edit members" on or_hasharon_worship.members for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
create policy "allowed read signups" on or_hasharon_worship.signups for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed sign up" on or_hasharon_worship.signups for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed remove signups" on or_hasharon_worship.signups for delete to authenticated using (or_hasharon_worship.is_allowed());
grant select, insert, update on or_hasharon_worship.members to authenticated;
grant select, insert, delete on or_hasharon_worship.signups to authenticated;
-- usage_logs stays insert-only for anon + authenticated
