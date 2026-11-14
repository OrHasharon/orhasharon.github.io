-- Admin page: 'הסרה' on an attempt with a number that isn't on the list removes that number's failed attempts
-- from the log. Only admins; approved entries are never removed this way. Safe to re-run.
drop policy if exists "admins remove failed logins" on or_hasharon_worship.site_logins;
create policy "admins remove failed logins" on or_hasharon_worship.site_logins
  for delete to authenticated using (or_hasharon_worship.is_admin() and not ok);
grant delete on or_hasharon_worship.site_logins to authenticated;
select 'מוכן: אפשר להסיר ניסיונות מדף הניהול' as "סטטוס";
