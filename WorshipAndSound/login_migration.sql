-- WorshipAndSound: turn on sign-in. After this runs, only emails on the allowed list can see or change anything.
-- The site switches to the login screen by itself once this has run. Safe to re-run.

-- ---------- allowed users (managed from the site's "משתמשים" tab by admins) ----------
create table if not exists or_hasharon_worship.allowed_users (
  email text primary key,
  is_admin boolean not null default false,
  added_by text default (auth.jwt() ->> 'email'),
  added_at timestamptz not null default now()
);
insert into or_hasharon_worship.allowed_users (email, is_admin) values ('uriya19@gmail.com', true)
  on conflict (email) do update set is_admin = true;

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
create policy "see own row or all if admin" on or_hasharon_worship.allowed_users for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or or_hasharon_worship.is_admin());
create policy "admins add users" on or_hasharon_worship.allowed_users for insert to authenticated with check (or_hasharon_worship.is_admin());
create policy "admins edit users" on or_hasharon_worship.allowed_users for update to authenticated using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
create policy "admins remove users" on or_hasharon_worship.allowed_users for delete to authenticated using (or_hasharon_worship.is_admin());
grant select, insert, update, delete on or_hasharon_worship.allowed_users to authenticated;

-- ---------- who did what ----------
alter table or_hasharon_worship.signups add column if not exists added_by text default (auth.jwt() ->> 'email');
alter table or_hasharon_worship.songs   add column if not exists added_by text default (auth.jwt() ->> 'email');
alter table or_hasharon_worship.members add column if not exists updated_by text default (auth.jwt() ->> 'email');

-- ---------- close members / signups / songs to anyone not on the list ----------
drop policy if exists "anyone can read members" on or_hasharon_worship.members;
drop policy if exists "anyone can add members" on or_hasharon_worship.members;
drop policy if exists "anyone can edit members" on or_hasharon_worship.members;
drop policy if exists "anyone can read signups" on or_hasharon_worship.signups;
drop policy if exists "anyone can sign up" on or_hasharon_worship.signups;
drop policy if exists "anyone can remove a signup" on or_hasharon_worship.signups;
drop policy if exists "anyone can read songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can add songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can edit songs" on or_hasharon_worship.songs;
drop policy if exists "anyone can remove songs" on or_hasharon_worship.songs;
revoke all on or_hasharon_worship.members from anon;
revoke all on or_hasharon_worship.signups from anon;
revoke all on or_hasharon_worship.songs from anon;

drop policy if exists "allowed read members" on or_hasharon_worship.members;
drop policy if exists "allowed add members" on or_hasharon_worship.members;
drop policy if exists "allowed edit members" on or_hasharon_worship.members;
drop policy if exists "allowed read signups" on or_hasharon_worship.signups;
drop policy if exists "allowed sign up" on or_hasharon_worship.signups;
drop policy if exists "allowed remove signups" on or_hasharon_worship.signups;
drop policy if exists "allowed read songs" on or_hasharon_worship.songs;
drop policy if exists "allowed add songs" on or_hasharon_worship.songs;
drop policy if exists "allowed edit songs" on or_hasharon_worship.songs;
drop policy if exists "allowed remove songs" on or_hasharon_worship.songs;
create policy "allowed read members" on or_hasharon_worship.members for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed add members" on or_hasharon_worship.members for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed edit members" on or_hasharon_worship.members for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
create policy "allowed read signups" on or_hasharon_worship.signups for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed sign up" on or_hasharon_worship.signups for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed remove signups" on or_hasharon_worship.signups for delete to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed read songs" on or_hasharon_worship.songs for select to authenticated using (or_hasharon_worship.is_allowed());
create policy "allowed add songs" on or_hasharon_worship.songs for insert to authenticated with check (or_hasharon_worship.is_allowed());
create policy "allowed edit songs" on or_hasharon_worship.songs for update to authenticated using (or_hasharon_worship.is_allowed()) with check (or_hasharon_worship.is_allowed());
create policy "allowed remove songs" on or_hasharon_worship.songs for delete to authenticated using (or_hasharon_worship.is_allowed());
grant select, insert, update on or_hasharon_worship.members to authenticated;
grant select, insert, delete on or_hasharon_worship.signups to authenticated;
grant select, insert, update, delete on or_hasharon_worship.songs to authenticated;
grant usage, select on sequence or_hasharon_worship.members_id_seq to authenticated;
grant usage, select on sequence or_hasharon_worship.signups_id_seq to authenticated;
grant usage, select on sequence or_hasharon_worship.songs_id_seq to authenticated;
-- usage_logs stays insert-only for anon + authenticated
