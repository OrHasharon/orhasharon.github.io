-- Admins on the community site: a name and a phone number per admin. Safe to re-run. Run after site_access.sql.
-- * The entry screen recognizes an admin's phone number (allowed_users.phone) like a listed number.
-- * A number that isn't on the list sees "...נא פנה לאדמין: אוריה, ליה ונעמי": the names come from here (names only,
--   no e-mail addresses), so the message follows the admins list on admin.html.

alter table or_hasharon_worship.allowed_users add column if not exists display_name text;
alter table or_hasharon_worship.allowed_users add column if not exists phone text;

-- Phone numbers are NOT in this file (the repo is public): each admin's name and phone are filled in on admin.html
-- ("מנהלים"), which also puts the phone on the entry list.

create or replace function or_hasharon_worship.site_admin_names()
returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(n order by n), '{}')
  from (select distinct coalesce(nullif(trim(u.display_name), ''), nullif(trim(m.name), '')) as n
          from or_hasharon_worship.allowed_users u
          left join or_hasharon_worship.members m on m.id = u.member_id
         where u.is_admin) x
  where n is not null;
$$;
revoke all on function or_hasharon_worship.site_admin_names() from public;
grant execute on function or_hasharon_worship.site_admin_names() to anon, authenticated;

-- site_enter: as in site_access.sql, plus an admin's phone counts as a listed number
create or replace function or_hasharon_worship.site_enter(p_phone text, p_device text default null, p_kind text default 'login')
returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_ph   text := or_hasharon_worship.site_norm_phone(p_phone);
  hdr    json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip   text := coalesce(nullif(trim(split_part(hdr ->> 'x-forwarded-for', ',', 1)), ''), hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip');
  v_dev  text := left(coalesce(p_device, ''), 200);
  v_kind text := case when p_kind = 'visit' then 'visit' else 'login' end;
  v_name text;
  v_hit  boolean;
  v_last bigint;
begin
  if length(v_ph) < 9 or length(v_ph) > 12 then return json_build_object('ok', false, 'reason', 'invalid'); end if;
  if (select count(*) from or_hasharon_worship.site_logins l
       where not l.ok and l.ip is not distinct from v_ip and l.at > now() - interval '1 hour') >= 10 then
    update or_hasharon_worship.site_logins set hits = hits + 1, at = now()
     where id = (select l.id from or_hasharon_worship.site_logins l
                  where not l.ok and l.ip is not distinct from v_ip order by l.at desc limit 1);
    return json_build_object('ok', false, 'reason', 'blocked');
  end if;
  select p.name into v_name from or_hasharon_worship.site_phones p where p.phone = v_ph;
  v_hit := found;
  if not v_hit then
    select coalesce(nullif(trim(u.display_name), ''), u.email) into v_name from or_hasharon_worship.allowed_users u
     where u.is_admin and or_hasharon_worship.site_norm_phone(u.phone) = v_ph limit 1;
    v_hit := found;
  end if;
  select l.id into v_last from or_hasharon_worship.site_logins l
   where l.phone = v_ph and l.ok = v_hit and l.device is not distinct from v_dev and l.ip is not distinct from v_ip
     and l.at > now() - interval '30 minutes'
   order by l.at desc limit 1;
  if v_last is not null then
    update or_hasharon_worship.site_logins set at = now(), hits = hits + 1, name = v_name where id = v_last;
  else
    insert into or_hasharon_worship.site_logins (phone, ok, name, kind, device, ip) values (v_ph, v_hit, v_name, v_kind, v_dev, v_ip);
  end if;
  return json_build_object('ok', v_hit, 'name', case when v_hit then v_name end, 'reason', case when v_hit then null else 'unknown' end);
end;
$$;
revoke all on function or_hasharon_worship.site_enter(text, text, text) from public;
grant execute on function or_hasharon_worship.site_enter(text, text, text) to anon, authenticated;

-- check: every admin should have a name and a phone
select email as "מייל", display_name as "שם", phone as "טלפון" from or_hasharon_worship.allowed_users where is_admin order by email;
