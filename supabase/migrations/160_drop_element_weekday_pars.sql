-- ============================================================================
-- restaurantfriend — migration 160 · an element's weekday pars go
--
-- Mark, 2026-09-30: "I think it's a relic from an earlier time. It was used for
-- daily donut pars. It would tell the bakers, 'make 1 batch of raised dough on
-- M, T, W, 1.5 batches on Th, and 2 batches on F, Sa, Su'. Now we use the
-- premade sheets that are calculated based on actual needs/demand instead of
-- just a fixed par. I think it can be safely removed."
--
-- `production_element_locations.par_by_weekday` and its twin
-- `yield_by_weekday` (036, loaded from FileMaker on 59 of 184 rows) had no
-- editor and no reader — no view, no function, nothing in the app but a
-- read-only column on the element's Kitchens table. Both are dropped. Backup:
-- `FMP Export/pre160-element-weekday-pars-2026-09-30.json` (59 rows).
--
-- NOT TOUCHED: `production_item_locations.par_by_weekday` — a production
-- ITEM's weekday par, which the plan matrix edits and reads.
--
-- Depends on 036. NOT rerunnable (the drop).
-- ============================================================================

alter table production_element_locations
  drop column par_by_weekday,
  drop column yield_by_weekday;
