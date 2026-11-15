-- Duty contributors ("תורנויות בלבד"): sign in to admin.html with Google and see only the "תורניות" tab.
-- Safe to re-run; deletes nothing. Run after duty.sql.
-- They are kept in their own table (not allowed_users), so they get no access to the team site (WorshipAndSound)
-- and no admin rights. They can edit the duty teams and swaps, and read the phone list to pick phones from it.
-- E-mails and phones are NOT in this file (the repo is public): add people on admin.html ("מנהלים").

create table if not exists or_hasharon_worship.duty_editors (
  email        text primary key,
  display_name text,
  phone        text,
  added_at     timestamptz not null default now()
);
alter table or_hasharon_worship.duty_editors enable row level security;
drop policy if exists "admins manage duty editors" on or_hasharon_worship.duty_editors;
drop policy if exists "duty editor sees self" on or_hasharon_worship.duty_editors;
create policy "admins manage duty editors" on or_hasharon_worship.duty_editors for all to authenticated
  using (or_hasharon_worship.is_admin()) with check (or_hasharon_worship.is_admin());
create policy "duty editor sees self" on or_hasharon_worship.duty_editors for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select, insert, update, delete on or_hasharon_worship.duty_editors to authenticated;

-- an admin, or a duty contributor
create or replace function or_hasharon_worship.is_duty_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select or_hasharon_worship.is_admin() or exists (select 1 from or_hasharon_worship.duty_editors
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function or_hasharon_worship.is_duty_editor() from public;
grant execute on function or_hasharon_worship.is_duty_editor() to authenticated;

-- the duty tables: admins and duty contributors
drop policy if exists "admins teams" on or_hasharon_worship.duty_teams;
drop policy if exists "admins read swaps" on or_hasharon_worship.duty_swaps;
drop policy if exists "admins edit swaps" on or_hasharon_worship.duty_swaps;
create policy "admins teams" on or_hasharon_worship.duty_teams for all to authenticated
  using (or_hasharon_worship.is_duty_editor()) with check (or_hasharon_worship.is_duty_editor());
create policy "admins read swaps" on or_hasharon_worship.duty_swaps for select to authenticated using (or_hasharon_worship.is_duty_editor());
create policy "admins edit swaps" on or_hasharon_worship.duty_swaps for update to authenticated
  using (or_hasharon_worship.is_duty_editor()) with check (or_hasharon_worship.is_duty_editor());

-- the phone list: duty contributors may read it (to add phones to a team), only admins change it
drop policy if exists "duty editors read phones" on or_hasharon_worship.site_phones;
create policy "duty editors read phones" on or_hasharon_worship.site_phones for select to authenticated
  using (or_hasharon_worship.is_duty_editor());
