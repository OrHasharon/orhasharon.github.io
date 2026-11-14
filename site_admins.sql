-- Admin names for the community site's entry screen. Safe to re-run. Run after site_access.sql.
-- A number that isn't on the list sees: "...נא פנה לאדמין: אוריה, נעמי וליה" — the names come from here, so the
-- message follows the admins list on admin.html. Only the names go out (no e-mail addresses).

alter table or_hasharon_worship.allowed_users add column if not exists display_name text;
update or_hasharon_worship.allowed_users set display_name = 'אוריה'
 where lower(email) = 'uriya19@gmail.com' and coalesce(display_name, '') = '';

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

select or_hasharon_worship.site_admin_names() as "שמות המנהלים בהודעה";
