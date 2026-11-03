-- Run AFTER re-importing Wb.pdf: removes old copies of the book's songs
-- (very old imports saved as just "Wb.pdf", copies under a wrong book number, and repeated copies).
-- Songs that are used in a worship session are kept. Shows what is left.
with bad as (
  delete from or_hasharon_worship.songs s
   where s.source like 'Wb.pdf%'
     and (s.source = 'Wb.pdf'
          or s.source !~ '^Wb\.pdf#([1-9]|[1-9][0-9]|[12][0-9][0-9]|3[0-6][0-9]|37[0-7])(-2)?$'
          -- two rows with the same number: keep the one the re-import just updated
          or exists (select 1 from or_hasharon_worship.songs o where o.source = s.source and o.id <> s.id and o.updated_at > s.updated_at))
     and exists (select 1 from or_hasharon_worship.songs n where n.source = 'Wb.pdf#316' and n.title like 'ישוע חי (%')
     and not exists (select 1 from or_hasharon_worship.setlist_items i where i.song_id = s.id)
  returning s.id
)
select (select count(*) from bad) as "נמחקו",
       (select count(*) from or_hasharon_worship.songs) - (select count(*) from bad) as "נשארו שירים",
       (select string_agg(title || ' [' || coalesce(source, '') || ']', ' | ') from or_hasharon_worship.songs
         where title like 'ישוע חי%' and id not in (select id from bad)) as "ישוע חי";
