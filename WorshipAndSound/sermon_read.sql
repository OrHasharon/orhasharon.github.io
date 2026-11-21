-- The signed-in team could not read sermon_links (sermon.sql made a policy but no grant), so the presentation tab and
-- the PowerPoint download never saw the speaker's file. Safe to re-run.
grant select on or_hasharon_worship.sermon_links to authenticated;
notify pgrst, 'reload schema';
