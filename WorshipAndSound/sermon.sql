-- The sermon from the speaker: a personal link per meeting (sermon.html?t=<token>) uploads a PDF straight to Storage,
-- and the projection screen (screen.html) pulls it in by itself. Safe to re-run. Needs Storage on (Supabase dashboard).
--
-- What it adds:
--   * bucket "sermons": public read by URL (no listing), PDF only, up to 40MB a file;
--   * table or_hasharon_worship.sermon_links: one random token per meeting + the current file;
--   * RPCs: sermon_link (signed-in team: create / get the meeting's link), sermon_info + sermon_attach (the speaker,
--     by token, no sign-in), sermon_for (the screen, by the same date code as live_set), sermon_clear (signed-in team);
--   * one Storage policy: uploads only into the folder of a live token (meeting from yesterday to 60 days ahead).
-- The token is random (gen_random_uuid), so the upload link can't be guessed. Reading: the path is reachable only via
-- sermon_for(date code) for meetings from yesterday to 30 days ahead — the same exposure as the set's songs (live_set).
--
-- To remove: drop policy sermons_upload on storage.objects; drop function or_hasharon_worship.sermon_link(date),
-- or_hasharon_worship.sermon_info(uuid), or_hasharon_worship.sermon_attach(uuid, text, text),
-- or_hasharon_worship.sermon_for(text), or_hasharon_worship.sermon_clear(date), or_hasharon_worship.sermon_token_ok(text);
-- drop table or_hasharon_worship.sermon_links; then empty + delete the "sermons" bucket in the dashboard.

create extension if not exists pgcrypto with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sermons', 'sermons', true, 41943040, '{application/pdf}')
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists or_hasharon_worship.sermon_links (
  meeting_date date primary key,
  token uuid not null default gen_random_uuid() unique,
  file_path text,
  file_name text,
  uploaded_at timestamptz,
  created_by text default auth.email(),
  created_at timestamptz default now()
);
alter table or_hasharon_worship.sermon_links enable row level security;
drop policy if exists sermon_links_read on or_hasharon_worship.sermon_links;
create policy sermon_links_read on or_hasharon_worship.sermon_links
  for select to authenticated using (or_hasharon_worship.is_allowed());
-- no write policies: every change goes through the functions below

-- the team (signed in): the meeting's speaker link — the same token every time
create or replace function or_hasharon_worship.sermon_link(d date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if not or_hasharon_worship.is_allowed() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into or_hasharon_worship.sermon_links (meeting_date) values (d) on conflict (meeting_date) do nothing;
  select token into t from or_hasharon_worship.sermon_links where meeting_date = d;
  return t;
end $$;

-- the speaker's page: which meeting this link is for, and what is already there
create or replace function or_hasharon_worship.sermon_info(t uuid)
returns table (meeting_date date, file_name text, uploaded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.meeting_date, l.file_name, l.uploaded_at from or_hasharon_worship.sermon_links l
  where l.token = t and l.meeting_date between current_date - 1 and current_date + 60;
$$;

-- the speaker's page, after the upload: this file is now the meeting's sermon
create or replace function or_hasharon_worship.sermon_attach(t uuid, path text, fname text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if path not like t::text || '/%' then raise exception 'bad path' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'sermons' and o.name = path) then
    raise exception 'no such file' using errcode = 'P0002';
  end if;
  update or_hasharon_worship.sermon_links
     set file_path = path, file_name = left(coalesce(fname, 'sermon.pdf'), 200), uploaded_at = now()
   where token = t and meeting_date between current_date - 1 and current_date + 60;
  if not found then raise exception 'link expired' using errcode = '42501'; end if;
end $$;

-- the projection screen: the meeting's current sermon, by the team link's date code (as live_set)
create or replace function or_hasharon_worship.sermon_for(c text)
returns table (path text, file_name text, uploaded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.file_path, l.file_name, l.uploaded_at from or_hasharon_worship.sermon_links l
  where l.file_path is not null
    and l.meeting_date between current_date - 1 and current_date + 30
    and left(encode(extensions.digest('orhasharon-ws-live:' || to_char(l.meeting_date, 'YYYY-MM-DD'), 'sha256'), 'hex'), 20) = c;
$$;

-- the team (signed in): take the sermon off (the file stays in Storage; nothing is deleted)
create or replace function or_hasharon_worship.sermon_clear(d date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not or_hasharon_worship.is_allowed() then raise exception 'not allowed' using errcode = '42501'; end if;
  update or_hasharon_worship.sermon_links set file_path = null, file_name = null, uploaded_at = null where meeting_date = d;
end $$;

revoke all on function or_hasharon_worship.sermon_link(date) from public;
revoke all on function or_hasharon_worship.sermon_info(uuid) from public;
revoke all on function or_hasharon_worship.sermon_attach(uuid, text, text) from public;
revoke all on function or_hasharon_worship.sermon_for(text) from public;
revoke all on function or_hasharon_worship.sermon_clear(date) from public;
grant execute on function or_hasharon_worship.sermon_link(date) to authenticated;
grant execute on function or_hasharon_worship.sermon_info(uuid) to anon, authenticated;
grant execute on function or_hasharon_worship.sermon_attach(uuid, text, text) to anon, authenticated;
grant execute on function or_hasharon_worship.sermon_for(text) to anon, authenticated;
grant execute on function or_hasharon_worship.sermon_clear(date) to authenticated;

-- is this folder name a live token? (security definer: the policy runs as anon, who can't read sermon_links)
create or replace function or_hasharon_worship.sermon_token_ok(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from or_hasharon_worship.sermon_links l
    where l.token::text = folder and l.meeting_date between current_date - 1 and current_date + 60);
$$;
revoke all on function or_hasharon_worship.sermon_token_ok(text) from public;
grant execute on function or_hasharon_worship.sermon_token_ok(text) to anon, authenticated;

-- uploads: only into "<live token>/…" in the sermons bucket; no select/update/delete policies (public URLs need none,
-- listing stays closed, nobody overwrites or deletes)
drop policy if exists sermons_upload on storage.objects;
create policy sermons_upload on storage.objects for insert to anon, authenticated
with check (bucket_id = 'sermons' and or_hasharon_worship.sermon_token_ok((storage.foldername(name))[1]));
