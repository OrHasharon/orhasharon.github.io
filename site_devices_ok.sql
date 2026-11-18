-- admin.html: "✓ זה בסדר, לאשר" on a number that entered from more than one device.
-- The approved devices are kept on the number; the alert comes back only if a new device shows up.
-- Safe to re-run. Needs site_access.sql. Admins already have update on site_phones.
alter table or_hasharon_worship.site_phones add column if not exists devices_ok text[] not null default '{}';
notify pgrst, 'reload schema';
