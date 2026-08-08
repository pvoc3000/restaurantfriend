-- ============================================================================
-- restaurantfriend — migration 036 · production elements + recipes
--
-- Phase 1 of the Production module (docs/production-brief.md, build step 4f).
-- The merged component catalog and the versioned recipe document — the half
-- that works standalone: the kitchen binder, costed live through purchasing.
--
-- ---------------------------------------------------------------------------
-- THE MERGE (brief decision 2)
--
-- FileMaker kept TWO component vocabularies that were the same thing built
-- twice: `Production_Elements` (249 rows — what you make or buy) and
-- `Recipe_Items` (212 rows — what a recipe line points at), each with its own
-- UI, its own cost columns and its own idea of what a component is. Add vendor
-- items and inventory items and that is four vocabularies for "a thing with a
-- cost". They become ONE table here, and both BOM layers — recipe ingredient
-- lines now, an Item's dependency list in phase 2 — reference it and nothing
-- else.
--
-- `kind` is what the merge turns on, and FMP already had the vocabulary:
-- `Recipe_Items.VendorItemOrRecipe_text` is "Vendor Item" 199 · "Manual" 8 ·
-- "Recipe" 5. Those become `purchased` · `manual` · `made`.
--
-- ---------------------------------------------------------------------------
-- WHY RECIPES STAY SEPARATE (brief decision 3)
--
-- Mark floated merging them into elements; the answer is no, and the reason is
-- version history. An element is a NODE IN THE PRODUCTION GRAPH — pars, BOM
-- edges, batch history, a schedule class. A recipe is a VERSIONED DOCUMENT
-- describing how to make one. Gluten Free(ish) Cake Donut has 27 versions;
-- everything referencing that element survives every reformulation untouched.
-- Merging would thread version history through the BOM.
--
-- FMP's actual disease was cheaper than the model: elements point at recipes BY
-- NAME (`recipeName_t` filled on 97 of 249, an actual key on 11). Rename a
-- recipe and the chain snaps silently. Here `production_recipes.element_id` is
-- a real FK and NOT NULL.
--
-- ---------------------------------------------------------------------------
-- NO STORED COSTS (brief decision 11)
--
-- There is not one cost column on a recipe, a version or a line, and that is
-- the point. FMP froze costs at map time and still carries 1/30/2022 prices in
-- 2026 — `Recipe_Items` has SIX cost columns (CostPerGram_c, CostPerOunce_c,
-- CostPerPound_c, …), all stale. Cost flows at read time: purchased element →
-- inventory item → effective vendor price (design rule 6, location overrides
-- included), made element → its master version's lines, recursively.
-- `web/src/lib/productionCost.ts` is that resolver.
--
-- The exception the brief names is a DOCUMENT snapshot — a generated schedule
-- line, a batch log's cost of the day. Neither exists yet; both arrive in
-- phases 4 and 5 on their own tables. Nothing here may grow a cost column.
--
-- Depends on 001 (orgs, locations, inventory_items, user_has_role,
-- set_updated_at). Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- production_elements — the merged component catalog
-- ----------------------------------------------------------------------------

create table production_elements (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- made      — has recipes. The BOM's interior nodes: doughs, glazes, creams.
  -- purchased — resolves to an inventory item and thence to a live vendor
  --             price. NEVER to a vendor item directly: the inventory item is
  --             the stable identity and vendor items are its sources, which is
  --             the whole of design rule 6.
  -- manual    — labor and the like, a set cost per unit. FMP used "Manual" rows
  --             as a labor hack and so do we, deliberately: the alternative is
  --             a labor model, and standard costing wants a number.
  kind        text not null check (kind in ('made', 'purchased', 'manual')),

  name        text not null,

  -- The type vocabulary, WITHOUT FileMaker's numbered prefix. FMP stored "05
  -- Topping" and then computed `type_forprint_c` = "Topping" to display — so
  -- the source itself agrees the number is presentation, and it is really the
  -- sort order living in the name (the shop-section prefix problem, migration
  -- `strip-section-prefix.mjs`). The number lands in `type_sort`.
  --
  -- Free text rather than a check constraint: 15 values today (Topping 61 ·
  -- Glaze 35 · Cleaning 25 · Ice Cream 24 · Cream 23 · Donut 20 · …) and one
  -- element with none, and a kitchen invents a category faster than a migration
  -- can be written. The app offers a PickList over what exists, `allowNew`.
  element_type text,
  type_sort    integer,

  -- Which production rhythm this element belongs to — FMP's `schedule` column:
  -- WEEKLY 159 · AB 49 · DONUT 18 · HIDDEN 6 · NONE 1. It selects which element
  -- sheet an element prints on in phase 4, so it is a real operational fact and
  -- not decoration. Free text for the same reason as `element_type`.
  schedule_class text,

  -- Purchased only. `on delete set null` rather than cascade: deleting an
  -- inventory item must not silently remove a node the whole BOM hangs off —
  -- the element survives, uncosted and visibly so.
  inventory_item_id uuid references inventory_items(id) on delete set null,

  -- Manual only. A set cost per unit ("$0.50 per ea"). Numeric(12,4) because
  -- these are per-unit costs that get multiplied by small quantities — a cent
  -- is not enough resolution when the unit is a gram.
  manual_cost      numeric(12,4),
  manual_cost_unit text,

  -- DELIBERATELY NO CONSTRAINT tying these columns to `kind`.
  --
  -- Migration 024's lesson, and it was expensive: `vendor_items_pack_shape`
  -- said "a count needs a size", which is true of finished data and wrong as a
  -- constraint, because the pack is edited ONE COLUMN AT A TIME and the first
  -- cell you reach is the one the constraint forbids on its own. Mark hit it
  -- and got raw Postgres text in a table cell.
  --
  -- Every one of these screens is an InlineValue grid with the same property.
  -- Switch an element from manual to purchased and there is an instant where
  -- `kind` says purchased and `inventory_item_id` is still null; a constraint
  -- would refuse the FIRST of the two edits and there would be no order that
  -- works. Readers gate on `kind` instead — an element with nothing to cost
  -- from reads as uncosted, which is a fact worth showing rather than an error
  -- worth refusing.

  is_active   boolean not null default true,   -- that spelling: catalog/ActiveToggle hardcodes it
  notes       text,

  legacy_id   text,
  source      text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The identity the BOM and the guide will group by, so it must be unique the
  -- way `shop_sections.display_name` is (migration 017). FMP has three
  -- duplicate pairs — "Candied Peanuts", "Fryer", "X-Ray Speculoos Scoop Cup" —
  -- and the transform merges them with a report rather than loading both.
  unique (org_id, name),
  unique (org_id, legacy_id)
);

create index production_elements_org_active_idx on production_elements (org_id, is_active);
create index production_elements_inventory_idx on production_elements (inventory_item_id)
  where inventory_item_id is not null;

create trigger trg_production_elements_updated before update on production_elements
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_element_locations — the stock-up par, per shop
-- ----------------------------------------------------------------------------
--
-- The model sketch in the brief put the par on the ELEMENT. The export says
-- otherwise: `_elementpars.mer` is keyed (element, location) — DF01 49 rows,
-- DF02 11 — and the element's own `par` field is nearly empty, with
-- `currentPar_c` a calculation showing whichever location you are standing in.
-- So this is `inventory_item_locations`' shape, and it should be: a par is how
-- much of a thing THIS shop keeps, and two shops legitimately differ.
--
-- The seven-slot array is 009's idiom, slot n = weekday n (ISO, 1 = Monday),
-- with the same guard. Every per-weekday array in this schema reads the same
-- way and this one must not be the exception.

create table production_element_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  element_id  uuid not null references production_elements(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  par_by_weekday numeric(12,3)[] check (
    par_by_weekday is null or array_length(par_by_weekday, 1) = 7),

  -- FMP's free-text stock-up par ("6x 1.5 GAL", "10 BAGS", "1x 22# tub"),
  -- parsed to the batch log's own shape — count × container size — because
  -- that is what the person counting actually says out loud, and because free
  -- text cannot be multiplied. What refuses to parse is reported by the
  -- transform and left null rather than guessed at; one row is literally "?".
  stock_count numeric(10,3),
  stock_size  numeric(10,3),
  stock_unit  text,

  -- FMP kept a 7-slot yield array beside the par. It is the expected output for
  -- that weekday, which phase 4's element sheet reads.
  yield_by_weekday numeric(12,3)[] check (
    yield_by_weekday is null or array_length(yield_by_weekday, 1) = 7),

  is_active   boolean not null default true,
  notes       text,

  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (element_id, location_id)
);

create index production_element_locations_loc_idx
  on production_element_locations (org_id, location_id);

create trigger trg_production_element_locations_updated before update
  on production_element_locations
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_recipes — the FAMILY
-- ----------------------------------------------------------------------------
--
-- One row per recipe, so "the recipe" has a stable identity across versions.
-- FMP had no such row: it kept 493 version records and grouped them by name,
-- which is why four elements carry two spellings of one recipe across their
-- history (element 1002 is "Scratch Cake Donut" at v01 and "Vanilla Cake Donut"
-- at v11 — one recipe renamed mid-life, and by name alone it reads as two).
--
-- `element_id` NOT NULL is decision 3's whole point. Consequence at load: 34 of
-- the 128 families have no element in FMP at all (the 13 "Knotted – …" creams
-- and custards, several "(old)" glazes, Peanut Butter Cookie, Sugar Cookie,
-- Maple Glaze), so the transform CREATES one for each, inactive, and names
-- them all in its report. A recipe with no element means the element was never
-- written down, not that the recipe makes nothing.
--
-- `on delete restrict`: deleting an element that has recipes would take a
-- versioned document with it. The app counts them and says so, the way 023's
-- employee delete does.

create table production_recipes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  element_id  uuid not null references production_elements(id) on delete restrict,

  name        text not null,

  -- FMP's Type1/Type2/Type3 (Glaze/Cake/Mix). Type1 is filled on 97% and is the
  -- real classifier; the other two are sparse and land in `source_payload`.
  recipe_type text,

  is_active   boolean not null default true,
  notes       text,

  legacy_id   text,
  source      text not null default 'app' check (source in ('app', 'filemaker')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, legacy_id)
);

-- NOT unique on (org_id, name): an element may legitimately have two recipes
-- (a summer and a winter formulation are two documents, not two versions), and
-- FMP's own data has near-duplicate names it never resolved.
create index production_recipes_element_idx on production_recipes (element_id);
create index production_recipes_org_idx on production_recipes (org_id, is_active);

create trigger trg_production_recipes_updated before update on production_recipes
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_recipe_versions — the document
-- ----------------------------------------------------------------------------
--
-- FMP's shape kept: versions as rows, one marked master, author, per-version
-- note, testing notes. What changes is that YIELD, MIXER SIZE and PREP TIME are
-- real columns. In FileMaker they were recipe LINES at sort 100–102 — a
-- 178-row "Mixer Size" ingredient, a 40-row "Expected Yield" one — which is
-- why the ingredient list has to be filtered before it can be read, why they
-- can't be queried, and why "Mixer Size" shows up as the single biggest
-- violator of every scaling rule (a 3× batch uses a 20 qt bowl, not a 30 qt
-- one). The transform lifts them out.

create table production_recipe_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  recipe_id   uuid not null references production_recipes(id) on delete cascade,

  -- TEXT, not integer. FMP's Gluten Free(ish) Cake Donut runs v27a, v28a, v27b,
  -- v28b — parallel experiments on one base — so a numeric column would refuse
  -- real history. `version_sort` is what orders them.
  version_label text not null,
  version_sort  numeric(10,3),

  -- Exactly one master per family, enforced below. FMP's flag could not be
  -- trusted: 103 families have one, 6 have several (Passion Fruit Glaze marks
  -- both v22 and v23) and 64 have none, so the transform decides — one flag →
  -- it, several → highest version, none → highest among the active — and
  -- reports every family where the flag didn't settle it.
  --
  -- The master is what live costing reads and what the recipe PDF prints by
  -- default. It is a pointer, not an archive flag: `is_active` says whether a
  -- version is still in play at all.
  is_master   boolean not null default false,
  is_active   boolean not null default true,

  author      text,          -- FMP's free-text author, filled on 91%
  description text,
  note        text,          -- the per-version change note: "v09 scaled to 2000g"
  testing_notes text,

  -- Real columns, formerly magic rows.
  yield_amount numeric(12,3),
  yield_unit   text,
  mixer_size   text,         -- "10 qt" / "20 qt" — text because it names a BOWL
  prep_time    text,         -- "10-15 minutes", as written
  shelf_life   text,         -- "3 weeks"
  storage      text,
  tools        text,

  -- THE SCALE COLUMNS, as (label, multiplier) pairs — parallel arrays, ordered,
  -- at most 8 (FileMaker's repetition count).
  --
  -- These are NOT a fixed TEST/×½/×¾/×1/% ladder. Measured over the real
  -- versions: 48 say "1/2 Pan | 1 Pan | 2 Pans | 3 Pans | %", 39 say
  -- "2 QT | 7.5 QT | 12 QT | 22 QT | %", others "x1 | x2 | x4 | x8",
  -- "4x 1.5G | 5x 1.5G | 3x 1.5G", "TEST | x1 | x1.5 | x2 | %". The labels are
  -- content — they name the vessel you are scaling to — so they are stored and
  -- the AMOUNTS are computed from them.
  --
  -- That direction is a measurement, not a preference. FMP stored an amount per
  -- column and it LOOKS hand-entered; 96.4% of testable ingredient lines are
  -- within 2% of a strict multiple of the base column, once you normalise the
  -- unit changing as the number grows (170 g → 1.7 kg is ×10) and read a blank
  -- multiplier in slot 0 as ×1 (all 493 versions put the base there). The
  -- residue is metadata rows and one ingredient stated in two units. So a line
  -- stores ONE amount and the columns are rendered — decision 3.
  --
  -- Parallel arrays rather than a child table because they are a fixed-width
  -- ordered strip read only with the version, never queried across: the same
  -- argument `par_by_weekday` rests on. The check keeps them in step.
  scale_labels      text[],
  scale_multipliers numeric(10,4)[],
  constraint production_recipe_versions_scale_shape check (
    coalesce(array_length(scale_labels, 1), 0)
      = coalesce(array_length(scale_multipliers, 1), 0)
    and coalesce(array_length(scale_labels, 1), 0) <= 8),

  legacy_id   text,
  source      text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, legacy_id)
);

-- ONE MASTER PER FAMILY. A partial unique index, so any number of non-masters
-- coexist and exactly one master may. Note this makes promoting a version a
-- TWO-STATEMENT act — clear the old, set the new — which the app must do in
-- that order; the reverse trips the index.
create unique index production_recipe_versions_one_master
  on production_recipe_versions (recipe_id) where is_master;

create index production_recipe_versions_recipe_idx
  on production_recipe_versions (recipe_id, version_sort desc);

create trigger trg_production_recipe_versions_updated before update
  on production_recipe_versions
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_recipe_lines — the ingredients
-- ----------------------------------------------------------------------------

create table production_recipe_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  version_id  uuid not null references production_recipe_versions(id) on delete cascade,

  -- The BOM edge. `on delete restrict` — deleting an element used by a recipe
  -- must not silently empty the recipe; the app counts and says so.
  --
  -- NULLABLE, which is the one thing here that looks like a mistake and isn't:
  -- 1,459 of FMP's ingredient lines carry an amount and a name but no
  -- `_ItemKey` at all ("pinch of salt", a note-shaped line). Refusing them
  -- would drop real content out of real recipes; they load with `label` filled
  -- and no element, cost nothing, and say so.
  element_id  uuid references production_elements(id) on delete restrict,

  -- What the line says when it has no element, and the override when it has one
  -- (FMP's `columnName_t`, e.g. "Speedy Glaze" written over the item's name).
  label       text,

  -- The BASE amount — scale column 0. Every other column is computed from the
  -- version's multipliers at render.
  qty         numeric(12,4),
  unit        text,

  sort        integer,
  section     text,          -- a heading within the ingredient list
  note        text,          -- FMP's ItemNote, "cut into small pieces"

  legacy_id   text,
  source_payload jsonb,      -- the discarded per-column amounts, so the round-off is reversible

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, legacy_id)
);

create index production_recipe_lines_version_idx
  on production_recipe_lines (version_id, sort);
create index production_recipe_lines_element_idx
  on production_recipe_lines (element_id) where element_id is not null;

create trigger trg_production_recipe_lines_updated before update
  on production_recipe_lines
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_recipe_steps — the procedure
-- ----------------------------------------------------------------------------
--
-- A separate table rather than a `kind` on lines, though FMP interleaved them
-- in one list (`_ElementType` = ingredient 5,260 / procedure 2,915, case
-- drifted). They are different documents: a step has prose and no quantity, an
-- ingredient has a quantity and no prose, and the recipe PDF sets them in two
-- columns. One table would be two disjoint column sets under one roof, and
-- every reader would filter first.

create table production_recipe_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  version_id  uuid not null references production_recipe_versions(id) on delete cascade,

  sort        integer,
  body        text not null,
  section     text,

  legacy_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, legacy_id)
);

create index production_recipe_steps_version_idx
  on production_recipe_steps (version_id, sort);

create trigger trg_production_recipe_steps_updated before update
  on production_recipe_steps
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — membership reads, purchaser+ writes
-- ----------------------------------------------------------------------------
--
-- Deliberately NOT 020's role-gated read. Production is operational, not
-- HR-sensitive: a recipe is what the kitchen makes, and anyone rostered to make
-- it needs to read it. That includes staff and supervisors, so `select` is
-- membership-only — the same posture as the order guide and the vendor catalog.
--
-- Writes are purchaser+, matching `lib/roles.ts`'s `canWriteCatalog`. This IS
-- a catalog: the same people who maintain vendor items and inventory items
-- maintain elements and recipes, and the cost of a wrong edit is the same
-- (every future order, every future cost). A supervisor entering a batch log
-- needs no write here — that is phase 5's own table, and it can name the
-- supervisor role itself when it has a screen to test it against (035's rule:
-- a write policy with no writer is a policy nobody has tested).
--
-- DELETE is purchaser+ too. The app must `.select()` its own delete — with no
-- matching policy Postgres removes zero rows and PostgREST returns no error,
-- which reads as a cheerful success and has now bitten twice (023, and the
-- order-guide clear).

alter table production_elements enable row level security;
alter table production_element_locations enable row level security;
alter table production_recipes enable row level security;
alter table production_recipe_versions enable row level security;
alter table production_recipe_lines enable row level security;
alter table production_recipe_steps enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'production_elements',
    'production_element_locations',
    'production_recipes',
    'production_recipe_versions',
    'production_recipe_lines',
    'production_recipe_steps'
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
--   select kind, count(*) from production_elements group by 1;
--     → purchased ~199 · made ~130 · manual ~8. "made" exceeds FMP's 5 because
--       every element carrying recipes is one, plus the 34 created for orphaned
--       recipe families.
--
--   select count(*) from production_elements where source = 'filemaker'
--     and legacy_id is null;   → 0
--
--   select count(*) from production_recipes;            → ~128 families
--   select count(*) from production_recipe_versions;    → 493
--   select count(*) from production_recipe_lines;       → ~5,260
--   select count(*) from production_recipe_steps;       → ~2,915
--     lines + steps = 8,175, the whole export accounted for.
--
--   -- every family has exactly one master:
--   select count(*) from production_recipes r where (
--     select count(*) from production_recipe_versions v
--      where v.recipe_id = r.id and v.is_master) <> 1;   → 0
--
--   -- no recipe is orphaned from its element (the FMP disease):
--   select count(*) from production_recipes where element_id is null;
--     → 0 by construction; the column is NOT NULL. If this errors, good.
--
--   -- purchased elements that can't be costed, which the app shows as uncosted:
--   select count(*) from production_elements
--    where kind = 'purchased' and inventory_item_id is null;
--     → expect ~50 (FMP mapped 160 of 212 Recipe_Items to a vendor item)
