-- ============================================================================
-- restaurantfriend — migration 037 · production items, the BOM, and prices
--
-- Phase 2 of the Production module (docs/production-brief.md, build step 4f).
-- The finished goods you assemble and sell, what each is made of, what each
-- shop keeps, and what they cost the customer.
--
-- Depends on 036 (production_elements) and 001. NOT rerunnable.
--
-- ---------------------------------------------------------------------------
-- THE ITEM'S BOM IS TWO FACTS, NOT ONE (measured 2026-08-07)
--
-- FileMaker states what an item is made of in TWO places that overlap
-- inconsistently — the "pars in three places" disease again:
--
--   `Production_Items._idBase_t`  the DOUGH, as an element id. 216 of 307.
--   `_dependencies`               everything else — glazes, toppings. 408 rows.
--
-- Of the 216 items with a base, 132 do NOT list it among their dependencies
-- and 84 DO. So neither source alone is the answer: take dependencies only and
-- 132 items lose their dough entirely; take both and 84 count it twice.
--
-- This schema separates them, which is what makes the merge safe:
--
--   `production_items.base_element_id`  ONE dough, a real FK.
--   `production_item_elements`          the additional components, with qty.
--
-- The transform loads dependencies as edges and DROPS any edge that names the
-- item's own base, reporting each. That is 84 edges, 41 of which carry no
-- quantity at all — because FileMaker never needed one:
--
-- ---------------------------------------------------------------------------
-- THE DOUGH'S QUANTITY IS DERIVED, WHICH IS WHY 176 EDGES HAVE NONE
--
-- How much dough one donut uses is not stored per item; it is a property of
-- (type, subtype, size) — FMP's DONUT_YIELDS table, and Mark's own rule:
--
--   "each regular donut (promise rings, bismarks, bullseyes, letters) is
--    1/340 of a batch, mini donuts are 1/3 the size of a regular donut,
--    giant donuts are 2x a regular donut"
--
-- So `production_batch_yields` carries it, and an item's dough cost is
--   (its base element's BATCH cost) x portion_of_batch x size_factor.
-- No stored cost anywhere — decision 11 holds through this layer too.
--
-- MARK'S NUMBERS DISAGREE WITH THE EXPORT AND HIS WIN (the brief records the
-- export as stale): raised is 1/340 where `_yields.mer` says 1/350, mini is
-- 1/3 where it says 0.4, giant 2x where it says 4. He named only the RAISED
-- cuts, so the export's cake portions (Vanilla 1/40, Chocolate 1/35, Banana
-- 1/30, Scrap Fritter 1/16, Old Fashioned 1/60) load as they stand — there is
-- no replacement for them and inventing one would be guessing. Every value the
-- transform changes is named in its report, and every row is editable, which
-- is the whole reason this is a table rather than a constant.
--
-- ---------------------------------------------------------------------------
-- PRICES: AN ORG GRID WITH SPARSE OVERRIDES (decision 10, CONFIRMED)
--
-- Measured on the real `Production_Item_Prices.mer`: 40 (class, tier) cells
-- over 4 locations, and DF01/DF02/DF03 agree on ALL 40. Only EVENT differs,
-- on exactly 5 cells — its Regular class. FMP's per-location copies exist only
-- because FileMaker had no inheritance: three shops hand-maintaining the same
-- forty numbers.
--
-- So this mirrors `vendor_items.price` -> `vendor_item_location_prices`
-- exactly, including the location-override table having NO surrogate id.
-- Resolution, high to low:
--   item-location override -> location grid override -> org grid.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- production_items — the finished good
-- ----------------------------------------------------------------------------

create table production_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  name        text not null,

  -- The taxonomy is OPERATIONAL, not descriptive (decision 4): these are what
  -- the position guides group by — the baker guide rolls up to type x subtype
  -- (what to cut), the fryer guide adds finish (what to prep), the decorator
  -- guide goes to the named item. Free text with a PickList over what exists,
  -- for the same reason `element_type` is: a kitchen invents a cut faster than
  -- a migration can be written. Measured: 9 types, 27 cuts, 5 sizes, 13
  -- finishes over 307 items.
  item_type   text,          -- Raised · Cake · Mochi · Old Fashioned · Scrap
  subtype     text,          -- the CUT: Promise Ring · Letter · Bismark · Bullseye
  finish      text,          -- Plain · BOH Glaze · Granulated Sugar
  size        text,          -- Regular · Mini · Giant

  -- The dough. `on delete restrict` — an element the whole menu is built on
  -- must not vanish quietly; the app counts and says so.
  base_element_id uuid references production_elements(id) on delete restrict,

  -- What the customer pays, via the grid below. Free text rather than FKs:
  -- both are vocabularies (decision 10 says so outright), and a tier is a
  -- label on a column of the grid rather than a record in its own right.
  price_class text,          -- Regular · Mini · Giant · Letter · Wholesale · Event · Delivery · Special
  price_tier  text,          -- Tier 1 … Tier 5

  -- How many this item trays in, which the printed schedule's counting strip
  -- reads (Mark, 2026-08-07: "It's always 6, but that is something that would
  -- make it better — to have the ability to set the chunk size for each item").
  -- NOT NULL with a default because 6 is the honest answer for all 307 items
  -- today: the load needs no backfill and the printed sheet is unchanged on
  -- day one. Per ITEM, not per size — a cascade nobody needs is 016's
  -- `nextDeliveryDate` trap in miniature.
  tally_box_size integer not null default 6 check (tally_box_size > 0),

  is_active   boolean not null default true,
  notes       text,

  legacy_id   text,
  source      text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, name),
  unique (org_id, legacy_id)
);

create index production_items_org_active_idx on production_items (org_id, is_active);
create index production_items_base_idx on production_items (base_element_id)
  where base_element_id is not null;

create trigger trg_production_items_updated before update on production_items
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_item_elements — the BOM edge
-- ----------------------------------------------------------------------------
--
-- The item's components BESIDE its dough. `on delete restrict` on the element
-- for the same reason as a recipe line: deleting an element used by the menu
-- must not silently empty an item.
--
-- `qty` is NULLABLE, and that is the data rather than laziness: 176 of FMP's
-- 408 edges carry no quantity — 41 of them because they name the dough, whose
-- amount is derived, and the rest because nobody ever filled it in. A line
-- with no quantity costs nothing and says so, which is `production_recipe_lines`'
-- own rule.

create table production_item_elements (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  item_id     uuid not null references production_items(id) on delete cascade,
  element_id  uuid not null references production_elements(id) on delete restrict,

  qty         numeric(12,4),
  unit        text,
  sort        integer,
  note        text,

  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One edge per (item, element). Measured: FMP has zero duplicates, so this
  -- costs nothing today and stops the BOM growing two answers tomorrow.
  unique (item_id, element_id),
  unique (org_id, legacy_id)
);

create index production_item_elements_item_idx on production_item_elements (item_id, sort);
create index production_item_elements_element_idx on production_item_elements (element_id);

create trigger trg_production_item_elements_updated before update
  on production_item_elements
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_item_locations — per-shop par and price
-- ----------------------------------------------------------------------------
--
-- 009's seven-slot array idiom, slot n = weekday n (ISO, 1 = Monday), with the
-- same guard. Measured: 316 par rows over DF01 100 / DF02 108 / DF03 67 /
-- EVENT 37 / WHOLESALE 3, no duplicate (item, location) pairs.
--
-- WHOLESALE is a pseudo-location and is SKIPPED by the transform with a report
-- (Mark, 2026-08-07: "honestly can't remember, can skip for now"). It is not a
-- row in `locations` and inventing one would put a shop in the switcher that
-- nobody works at.

create table production_item_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  item_id     uuid not null references production_items(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  par_by_weekday numeric(10,2)[] check (
    par_by_weekday is null or array_length(par_by_weekday, 1) = 7),

  -- The last word in price resolution — FMP's Price Overrides portal, 17 rows.
  price_override numeric(10,2),

  is_active   boolean not null default true,
  notes       text,

  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (item_id, location_id)
);

create index production_item_locations_loc_idx
  on production_item_locations (org_id, location_id);

create trigger trg_production_item_locations_updated before update
  on production_item_locations
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- The price grid — org level, then sparse per-location overrides
-- ----------------------------------------------------------------------------

create table production_price_grid (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  price_class text not null,
  price_tier  text not null,
  price       numeric(10,2),
  -- Where each sits in the menu, so the grid renders in a sensible order
  -- rather than alphabetically (Tier 10 before Tier 2).
  class_sort  integer,
  tier_sort   integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, price_class, price_tier)
);

create trigger trg_production_price_grid_updated before update
  on production_price_grid
  for each row execute function set_updated_at();

-- NO SURROGATE ID, matching `vendor_item_location_prices` — the pair IS the
-- key, and a second row for the same cell at the same shop is meaningless.
create table production_price_grid_locations (
  org_id      uuid not null references orgs(id) on delete cascade,
  grid_id     uuid not null references production_price_grid(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  price       numeric(10,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (grid_id, location_id)
);

create index production_price_grid_locations_loc_idx
  on production_price_grid_locations (org_id, location_id);

create trigger trg_production_price_grid_locations_updated before update
  on production_price_grid_locations
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_batch_yields — how much dough one item uses
-- ----------------------------------------------------------------------------
--
-- Mark's rule, as DATA. He asked for "a better way to do it" than FileMaker's,
-- and the better way starts by making it editable instead of a constant in
-- code — so when the answer changes it is one edit, not a migration.
--
-- `portion_of_batch` is what ONE regular item takes of its base element's
-- batch (raised = 1/340); `size_factor` scales that for the size (mini 1/3,
-- giant 2). Both nullable: a combination nobody has measured yet should read
-- as unknown, and cost nothing, rather than defaulting to a confident wrong
-- number.
--
-- Keyed (type, subtype, size) because the export proves the portion varies by
-- SUBTYPE, not only size — Cake Vanilla is 1/40 while Cake Banana is 1/30.
-- Subtype and size are nullable so a rule can be stated at the type level and
-- apply to everything under it; the resolver takes the most specific match.

create table production_batch_yields (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  item_type   text not null,
  subtype     text,
  size        text,

  portion_of_batch numeric(12,8) check (portion_of_batch is null or portion_of_batch > 0),
  size_factor      numeric(10,4) check (size_factor is null or size_factor > 0),

  note        text,
  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A partial unique index rather than a plain one: `unique` treats two NULLs as
-- distinct, so without this a type-level rule could be entered twice and the
-- resolver would have two answers to choose between.
create unique index production_batch_yields_key
  on production_batch_yields (org_id, item_type, coalesce(subtype, ''), coalesce(size, ''));

create trigger trg_production_batch_yields_updated before update
  on production_batch_yields
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — membership reads, purchaser+ writes, exactly as 036
-- ----------------------------------------------------------------------------
--
-- Same posture and the same argument: production is operational, not
-- HR-sensitive, and anyone rostered to make or sell a thing needs to read what
-- it is and what it costs the customer. Writes are purchaser+, matching
-- `lib/roles.ts`'s `canWriteCatalog` — this is a catalog.

alter table production_items enable row level security;
alter table production_item_elements enable row level security;
alter table production_item_locations enable row level security;
alter table production_price_grid enable row level security;
alter table production_price_grid_locations enable row level security;
alter table production_batch_yields enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'production_items',
    'production_item_elements',
    'production_item_locations',
    'production_price_grid',
    'production_price_grid_locations',
    'production_batch_yields'
  ] loop
    execute format(
      'create policy %I_select on %I for select
         using (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_delete on %I for delete
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- After the load, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_items;                  → 307
--   select count(*) from production_item_elements;          → ~324 (408 less the
--     84 that duplicate their item's own base element)
--   select count(*) from production_item_locations;         → ~312 (316 less the
--     3 WHOLESALE rows and 1 with no location)
--   select count(*) from production_price_grid;             → 40
--   select count(*) from production_price_grid_locations;   → 5 (EVENT's Regular class)
--   select count(*) from production_batch_yields;           → 22
--
--   -- no item lists its own dough twice:
--   select count(*) from production_item_elements e
--     join production_items i on i.id = e.item_id
--    where e.element_id = i.base_element_id;                → 0
--
--   -- the grid really is one set of numbers with a handful of exceptions:
--   select count(*) from production_price_grid_locations;   → far fewer than 40
