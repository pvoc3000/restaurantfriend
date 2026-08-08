-- ============================================================================
-- restaurantfriend — migration 042 · which batch a recipe is costed at
--
-- Why (Mark, 2026-08-08, with FileMaker's RECIPES > INFO tab beside it): the old
-- screen carries a COSTS matrix — ingredients, labour, subtotal, yield, cost per
-- unit, one column per batch size — and a row of radio buttons choosing which of
-- those columns is "the" cost of this recipe. That last control is the only part
-- of the block that is an INPUT rather than arithmetic, and we had nowhere to
-- put it.
--
-- FileMaker keeps it as `CostColumn_n` on the recipe row, which in this schema is
-- the VERSION — each FMP recipe row is one version — so that is where it goes.
--
-- ----------------------------------------------------------------------------
-- WHY IT IS A SLOT NUMBER AND NOT A LABEL
--
-- The obvious alternative is to store the batch NAME ("x1"), which reads better
-- in a database client. It is wrong for the same reason `ScaleColumn` carries
-- the slot it came from rather than its position on screen: the labels are
-- editable content, two versions of one recipe disagree about them, and renaming
-- a column would silently move which batch the recipe is costed at. The slot is
-- the identity; the label is what it is called this week.
--
-- Null means the BASE column, which is what every version was costed at before
-- this and is the honest default for one that has never been asked.
--
-- ----------------------------------------------------------------------------
-- WHAT IT DOES AND DOES NOT DRIVE, because the difference matters
--
-- It drives the COSTS block: which column is marked, and the per-unit figure the
-- block headlines. It does NOT change what `lib/productionCost` charges for an
-- element, and that is deliberate rather than unfinished — cost per unit is
-- (batch cost ÷ batch yield), both of which scale together, so the answer is the
-- same at every column unless the yield row is one FileMaker's AUTO switch was
-- turned off for. Wiring the two together is a real follow-up and a costing
-- change; it should be made deliberately, with fixtures, not as a side effect of
-- adding a radio button.
--
-- Depends on 036. Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

alter table production_recipe_versions
  add column cost_column smallint
    check (cost_column is null or (cost_column >= 0 and cost_column < 8));

comment on column production_recipe_versions.cost_column is
  'Slot of scale_labels/scale_multipliers this recipe is costed at. Null = the base column.';

-- ----------------------------------------------------------------------------
-- After this:
-- ----------------------------------------------------------------------------
--   select count(*) from production_recipe_versions where cost_column is not null;  → 0
--     (nothing is backfilled — FileMaker's own `CostColumn_n` is a display
--      preference, and every version reads at its base column until somebody
--      says otherwise)
