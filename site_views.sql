-- Who opened which video on the community site (a sermon or a hallel). Safe to re-run. Run after site_admins.sql.
-- The site calls site_view() when someone opens a video; it is written only for a number that may enter
-- (listed or an admin's). Opening the same video again within 30 minutes counts once. Only admins read it.

create table if not exists or_hasharon_worship.site_views (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  phone    text not null,
  name     text,
  video_id text not null,
  title    text,
  vdate    date,          -- the video's date (the meeting), as the site shows it
  vtype    text,          -- sermon | hallel
  device   text,
  hits     int not null default 1
);
create index if not exists site_views_video on or_hasharon_worship.site_views (video_id);
create index if not exists site_views_at on or_hasharon_worship.site_views (at desc);

alter table or_hasharon_worship.site_views enable row level security;
drop policy if exists "admins read views" on or_hasharon_worship.site_views;
create policy "admins read views" on or_hasharon_worship.site_views for select to authenticated using (or_hasharon_worship.is_admin());
grant select on or_hasharon_worship.site_views to authenticated;
revoke all on or_hasharon_worship.site_views from anon;

create or replace function or_hasharon_worship.site_view(p_phone text, p_video text, p_title text default null,
                                                         p_date text default null, p_type text default null, p_device text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ph   text := or_hasharon_worship.site_norm_phone(p_phone);
  v_name text;
  v_last bigint;
begin
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then return; end if;
  select p.name into v_name from or_hasharon_worship.site_phones p where p.phone = v_ph;
  if not found then
    select coalesce(nullif(trim(u.display_name), ''), u.email) into v_name from or_hasharon_worship.allowed_users u
     where u.is_admin and or_hasharon_worship.site_norm_phone(u.phone) = v_ph limit 1;
    if not found then return; end if;   -- not someone who may enter: nothing is written
  end if;
  select v.id into v_last from or_hasharon_worship.site_views v
   where v.phone = v_ph and v.video_id = p_video and v.at > now() - interval '30 minutes'
   order by v.at desc limit 1;
  if v_last is not null then
    update or_hasharon_worship.site_views set at = now(), hits = hits + 1 where id = v_last;
  else
    insert into or_hasharon_worship.site_views (phone, name, video_id, title, vdate, vtype, device)
    values (v_ph, v_name, p_video, left(p_title, 200),
            case when p_date ~ '^\d{4}-\d{2}-\d{2}$' then p_date::date end,
            case when p_type in ('sermon', 'hallel') then p_type end, left(p_device, 200));
  end if;
end;
$$;
revoke all on function or_hasharon_worship.site_view(text, text, text, text, text, text) from public;
grant execute on function or_hasharon_worship.site_view(text, text, text, text, text, text) to anon, authenticated;

select 'מוכן: צפיות בסרטונים נרשמות מעכשיו' as "סטטוס";
