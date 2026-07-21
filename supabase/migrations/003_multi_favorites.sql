-- ============================================================================
-- restaurantfriend — migration 003 · multiple favorites per item per weekday
--
-- Why (decided 2026-07-21 with Mark, after migration surfaced the pattern):
-- FMP's order guide line was the VENDOR ITEM, and 626 item/location pairs
-- carried multiple favorites for the same day. Two legitimate reasons:
--   * multi-vendor sourcing — "Soap, Hand" from Restaurant Depot OR Unified
--     Paper OR Friendly Foods; pick on the fly at order time
--   * pack-size variants — CS and EA of the same product, 3-gal and 1.5-gal
--     of the same ice cream
-- 001's unique (item_location_id, weekday) forced ONE vendor item per item
-- per day and silently dropped the rest. This migration makes the plan row
-- per-(item, location, weekday, vendor item), so the guide renders one line
-- per favorite, grouped under the inventory item.
--
-- Semantics after this change:
--   * A plan row's vendor_item_id NULL still means "the item's default".
--   * par_qty on a plan row is now a PER-LINE par (e.g. per flavor/variant).
--     The item-level par (item_locations.default_par) remains the group
--     total. Suggestion math (v2): line par where set, else group par.
--   * Distinct-need variants (e.g. San Pellegrino flavors, where each flavor
--     deserves its own par and on-hand) should be SPLIT into separate
--     inventory items instead — rule of thumb: substitutes -> favorites on
--     one item; complements -> separate items.
-- ============================================================================

alter table item_order_days
  drop constraint item_order_days_item_location_id_weekday_key;

-- nulls not distinct: at most ONE "inherit the default" row per item+day;
-- explicit vendor items are each unique per item+day.
alter table item_order_days
  add constraint item_order_days_plan_row_key
  unique nulls not distinct (item_location_id, weekday, vendor_item_id);
