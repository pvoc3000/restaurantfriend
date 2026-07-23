-- ============================================================================
-- restaurantfriend — migration 007 · org timezone
--
-- The order guide needs to know what "today" is. Deriving it from the server's
-- clock works locally and breaks on a UTC host: from 5pm in Los Angeles, UTC is
-- already tomorrow, so an evening walk files its entries under tomorrow's
-- guide_date and the morning's entries appear to vanish mid-session.
--
-- The zone is a business fact, so it lives in orgs.settings (design rule 2 —
-- nothing about this business belongs in code), alongside the billing entity
-- and PO number format already seeded there.
--
-- Only fills the gap: an org that already declares a timezone is left alone, so
-- this is safe to re-run and won't stomp a later per-org choice.
-- ============================================================================

update orgs
   set settings = settings || jsonb_build_object('timezone', 'America/Los_Angeles')
 where settings->>'timezone' is null;

-- Locations may eventually need their own override (a shop in another zone);
-- the app should then read location settings first and fall back to the org.
-- Not added now: all six locations are in the same zone, and an unused override
-- is a second place for the value to drift out of step.

do $$
declare tz text;
begin
  select settings->>'timezone' into tz from orgs limit 1;
  raise notice 'org timezone is now %', tz;
end $$;
