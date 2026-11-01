-- WorshipAndSound: team table like Uriya's sheet (lead checkbox + participation frequency) and the sheet's data.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
alter table or_hasharon_worship.members add column if not exists can_lead boolean not null default false;
alter table or_hasharon_worship.members add column if not exists participation_frequency text;

update or_hasharon_worship.members set instruments = 'פסנתר, שירה',      can_lead = true, lead_frequency = 'פעם בשבועיים' where name = 'אור קוסינוב';
update or_hasharon_worship.members set instruments = 'פסנתר, שירה',      can_lead = true, lead_frequency = 'פעם בחודש'    where name = 'חגית זיגל';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, תוף', can_lead = true, lead_frequency = 'פעם ברבעון'   where name = 'אוריה סתוי';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה',      can_lead = true, lead_frequency = 'פעם בחודש', participation_frequency = 'פעמיים שלוש' where name = 'רנדי סיגולים';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, בס',  can_lead = true, lead_frequency = 'פעם בחודשיים' where name = 'ליה לביא';
update or_hasharon_worship.members set instruments = 'שירה'              where name = 'שרון חיון';
update or_hasharon_worship.members set instruments = 'פסנתר'             where name = 'שמעון רוז';
update or_hasharon_worship.members set instruments = 'פסנתר, תוף'        where name = 'יונתן רוז';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה'       where name = 'רולנד שיפרס';
update or_hasharon_worship.members set instruments = 'כינור'             where name = 'איילת הנדרן';
update or_hasharon_worship.members set instruments = 'שירה, גיטרה, בס', participation_frequency = 'פעמיים שלוש' where name = 'נועם לבונטי';
insert into or_hasharon_worship.members (name, instruments) values
  ('יאווה', 'שירה'), ('טל שפר', 'שירה'), ('נעם לביא', 'שירה'), ('אלי', 'תוף')
  on conflict (name) do nothing;
