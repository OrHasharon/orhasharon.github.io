-- Who uploaded the sermon: the speaker's name (typed on the speaker's page) or the signed-in team member.
-- Safe to re-run; deletes nothing. Needs sermon.sql.
alter table or_hasharon_worship.sermon_links add column if not exists uploaded_by text;

create or replace function or_hasharon_worship.sermon_attach(t uuid, path text, fname text, by text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if path not like t::text || '/%' then raise exception 'bad path' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'sermons' and o.name = path) then
    raise exception 'no such file' using errcode = 'P0002';
  end if;
  update or_hasharon_worship.sermon_links
     set file_path = path, file_name = left(coalesce(fname, 'sermon.pdf'), 200), uploaded_at = now(),
         uploaded_by = nullif(left(coalesce(by, ''), 100), '')
   where token = t and meeting_date between current_date - 1 and current_date + 60;
  if not found then raise exception 'link expired' using errcode = '42501'; end if;
end $$;
revoke all on function or_hasharon_worship.sermon_attach(uuid, text, text, text) from public;
grant execute on function or_hasharon_worship.sermon_attach(uuid, text, text, text) to anon, authenticated;

-- the sermon already uploaded for 21.11 (Noam Hendren's file, 00:59)
update or_hasharon_worship.sermon_links set uploaded_by = 'נועם הנדרן'
 where meeting_date = '2026-11-21' and file_path like '%1795215541495-sermon.pptx' and uploaded_by is null;

notify pgrst, 'reload schema';
