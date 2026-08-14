-- 050 — a manual element's cost is a fact about the SHOP, and labour is an
-- ingredient like any other.
--
-- Mark, 2026-08-13: "instead of having a single labor cost as part of the
-- location table, we make it an element that can be added to recipes as an
-- ingredient and production items as a component … The only change we would
-- need is to make manual costing in an element a Per Location thing."
--
-- ===========================================================================
-- WHY THIS IS AN IMPROVEMENT AND NOT JUST A MOVE
--
-- Labour was the last cost that did not come from a component list. It read
-- `locations.labor_rate` and a recipe row matched BY LABEL ("prep time"), which
-- made it the one figure in the module with its own arithmetic — the same
-- special case `production_items.base_element_id` was, and killed by 049 for
-- the same reason.
--
-- Three things fall out that the old shape could not express:
--
--   * AN ITEM CAN CARRY LABOUR. Decorating a donut is real work in no recipe,
--     so `itemCost` could not charge it at all.
--   * A RECIPE CAN CARRY SEVERAL KINDS. Mix, proof and fry are different lines,
--     and a baker's rate need not be a decorator's — one column on `locations`
--     has room for one answer.
--   * THE RATE IS EDITABLE WHERE IT IS READ, on the element, per shop.
--
-- WHAT DOES NOT CHANGE, and the thing a rewrite would break: LABOUR STILL DOES
-- NOT SCALE WITH BATCH SIZE. It is read from its line AT THE COLUMN, exactly as
-- the prep-time row is read today, and pulled out of the ingredient total so
-- the ingredient half scales as it always has. Measured over the 31 master
-- versions carrying prep hours: ALL 31 have them typed per column, and 30 of
-- the 31 would be charged wrongly if a labour line were scaled like flour — one
-- would bill 24 hours where the recipe says half an hour.
-- ===========================================================================

/* -- the per-shop cost ------------------------------------------------------ */

-- design rule 6's shape, third outing after `vendor_item_location_prices` and
-- `production_price_grid_locations`: an override row per (thing, shop), and the
-- base column on the parent as the fallback. NO surrogate id — the pair IS the
-- key, which is the idiom both of those already use and the reason
-- `fetchAll` takes its order column as a parameter.
create table production_element_location_costs (
  org_id      uuid not null references orgs(id) on delete cascade,
  element_id  uuid not null references production_elements(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  -- NOT NULL: a row exists to state a cost. "No cost at this shop" is the
  -- ABSENCE of a row, which falls back to `production_elements.manual_cost` —
  -- a nullable column here would be a second way to say nothing, and 043's
  -- par lesson is that two spellings of silence get read differently.
  cost        numeric(12,4) not null check (cost >= 0),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (element_id, location_id)
);

create index production_element_location_costs_loc_idx
  on production_element_location_costs (location_id);

alter table production_element_location_costs enable row level security;

-- Membership READ: a cost is operational, not HR-sensitive, and anyone who can
-- read a recipe can already see what it comes to. Purchaser+ WRITE, matching
-- `production_elements` itself (036) — the rate is catalog data, and letting
-- staff change it would let them change every recipe's cost at once.
create policy production_element_location_costs_select
  on production_element_location_costs for select
  using (org_id in (select user_org_ids()));

create policy production_element_location_costs_write
  on production_element_location_costs for all
  using (public.user_has_role(org_id, array['owner','admin','purchaser']))
  with check (public.user_has_role(org_id, array['owner','admin','purchaser']));

create trigger production_element_location_costs_touch
  before update on production_element_location_costs
  for each row execute function set_updated_at();

/* -- what stays -------------------------------------------------------------- */

-- `production_elements.manual_cost` IS NOT DROPPED. It is the fallback for a
-- shop with no row, which is what stops every manual element losing its cost on
-- the day this ships — and for the 8 manual elements that are not labour, one
-- number for the whole org is very likely the right answer forever.
--
-- `locations.labor_rate` IS NOT DROPPED EITHER, and that is the more careful
-- one. After `backfill-labor-elements.mjs` nothing in `web/src` reads it, but
-- it is the SOURCE the backfill seeds the per-shop rates FROM, and deleting the
-- source in the same migration that copies it leaves no way to check the copy.
-- Retire it once the rates have been read in anger. `locations` has no other
-- reader of it and the Location record's Labor rate field goes when it does.

notify pgrst, 'reload schema';
