-- Team link (live.html?c=…): show a meeting's set even before the leader opens "מצב הלל". Safe to re-run.
-- The link's code is the first 20 hex chars of sha256('orhasharon-ws-live:' || date) — the same one live-sync.js makes
-- (guestCodeFor). The function returns only that one meeting's songs, and only for meetings from yesterday to 30 days
-- ahead; nothing else (people, schedule, other songs) is reachable without signing in.
-- Note: the code is derived from the date, so someone who reads the site's JS could compute a link for an upcoming date
-- and read that set's songs. To make links unguessable, add a secret salt here and have the leader's page fetch the code
-- through a signed-in RPC instead.
create extension if not exists pgcrypto with schema extensions;

create or replace function or_hasharon_worship.live_set(c text)
returns table (id bigint, title text, song_key text, content text, notes text, meeting_date date, pos int)
language sql stable security definer set search_path = '' as $$
  select i.id, s.title, s.song_key, s.content, i.notes, i.meeting_date, i.position
  from or_hasharon_worship.setlist_items i
  join or_hasharon_worship.songs s on s.id = i.song_id
  where i.meeting_date between current_date - 1 and current_date + 30
    and left(encode(extensions.digest('orhasharon-ws-live:' || to_char(i.meeting_date, 'YYYY-MM-DD'), 'sha256'), 'hex'), 20) = c
  order by i.position, i.id;
$$;

revoke all on function or_hasharon_worship.live_set(text) from public;
grant execute on function or_hasharon_worship.live_set(text) to anon, authenticated;
