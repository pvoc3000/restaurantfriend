-- 049 — an item is a list of components, and none of them is special.
--
-- NUMBERED 045 WHEN IT WAS WRITTEN AND APPLIED (2026-08-13), which collided
-- with 045_batch_logs_and_items from 2026-08-09. Renamed 049 afterwards so the
-- sequence stays unambiguous. Mark has already run this against the hosted
-- database under its old name; it is idempotent (`drop column if exists`, and a
-- view recreated from scratch), so a second run is harmless either way.
--
-- Mark, 2026-08-13: "get rid of the 'dough' field on production items. It's not
-- necessary and doubles existing data. Components live in the component list
-- only." And, on why it was wrong in the first place: "Items can be anything.
-- They don't even have to be a donut. Assuming they're donuts, or that they are
-- a specific kind of donut, is weird and wrong."
--
-- ===========================================================================
-- RUN `migration/backfill-item-dough.mjs --apply` FIRST. THIS IS NOT OPTIONAL.
-- (Done 2026-08-13.)
--
-- "It doubles existing data" was true of FileMaker, where the dough sat in
-- `_idBase_t` AND in `_dependencies`, overlapping on 84 of 216 items. It is NOT
-- true of this database: 036's loader resolved that overlap by dropping any
-- dependency edge naming the item's own base, so measured on 2026-08-13 ZERO of
-- the 216 items carried their base as a component edge. Drop this column
-- without the backfill and every one of them silently loses its largest
-- component.
--
-- The backfill writes one `production_item_elements` row per item, carrying the
-- old `production_batch_yields.size_factor` as an ordinary quantity in the
-- base's own yield unit — so nothing reprices on the way through. Verify before
-- running this:
--
--   select count(*) from production_items i
--   where i.base_element_id is not null
--     and not exists (
--       select 1 from production_item_elements e
--       where e.item_id = i.id and e.element_id = i.base_element_id);
--
-- That must return 0.
-- ===========================================================================
--
-- WHY THIS RECREATES A VIEW BEFORE IT DROPS A COLUMN.
--
-- `v_production_plan_days` selects `i.base_element_id`, so a bare drop fails
-- with "cannot drop column ... because other objects depend on it" and Postgres
-- suggests CASCADE. DO NOT TAKE THAT SUGGESTION. CASCADE would drop the view,
-- and `production_day()` selects from it — the function would survive the
-- migration (Postgres does not track dependencies through a function body) and
-- fail at runtime instead, on the screen a kitchen reads at 4am. It would also
-- silently take the `authenticated` grant with it, which is 043's own lesson.
--
-- The column is a PURE PASSTHROUGH with no reader: `production_day()`'s RETURNS
-- TABLE does not list it, nothing in `web/src` selects the view directly, and
-- the app stopped reading the column entirely in the commit before this one. So
-- the view is recreated verbatim from 043 minus that one line.
--
-- WHAT THIS ALSO RETIRES, WITHOUT DROPPING IT.
--
-- `production_batch_yields` now has no reader anywhere in the app. Its
-- `portion_of_batch` lost its last one on 2026-08-13 (the recipe's own Expected
-- Yield row says how many a batch makes — "the expected yield IS the portion of
-- a batch. They're the same thing."), and `size_factor` is what the backfill
-- moved onto the edges.
--
-- The TABLE IS DELIBERATELY LEFT IN PLACE. Dropping it destroys the only record
-- of where those quantities came from, and it is the sole surviving copy of
-- FileMaker's structure for them. It costs nothing: nothing selects it, and
-- 001's org-scoped policies still apply. Drop it later, deliberately.
--
-- Nor does this touch the 58 items whose (item_type, subtype, size) matched no
-- rule and whose edges therefore carry a NULL quantity. They cost nothing
-- before and cost nothing after — the change is that the number is now a box on
-- the item's own screen rather than a missing row in a shared table. 33 of them
-- are `Raised/Promise Ring/Giant`, because the rules called "Giant" a SUBTYPE
-- while the items call it a SIZE: exactly the failure that enumerating
-- (type, subtype, size) triples invites, and exactly what this removal is for.

/* -- 1. the view, verbatim from 043 minus `i.base_element_id` -------------- */

drop view if exists v_production_plan_days;

create view v_production_plan_days with (security_invoker = true) as
select
  p.org_id,
  p.id                as plan_id,
  p.title             as plan_title,
  p.location_id,
  -- Decision 9's fallback, stated ONCE here rather than at every reader.
  coalesce(p.kitchen_location_id, p.location_id) as kitchen_location_id,
  (p.kitchen_location_id is null)                as kitchen_assumed,
  p.starts_on,
  p.ends_on,
  p.is_active         as plan_active,

  t.id                as tray_id,
  t.tray_number,
  t.band              as tray_band,
  t.sort              as tray_sort,

  s.weekday,

  i.id                as item_id,
  i.name              as item_name,
  i.item_type,
  i.subtype,
  i.finish,
  i.size,
  i.tally_box_size,
  i.tray_capacity,
  i.price_class,
  i.price_tier,

  -- THE PAR, from the slot that holds the item. Note there is no array
  -- subscript left anywhere in this file: the off-by-one that 040's comment
  -- warned about — "getting the subscript wrong by one silently shifts a whole
  -- shop's menu by a day" — has nowhere left to happen in SQL. It moved to
  -- `defaultParFor` in the app, which is where the seed is read, and there is a
  -- fixture on it.
  s.par                                          as planned_par,

  (p.is_active
     and i.is_active
     and coalesce(il.is_active, true)
     and s.par is not null
     and s.par > 0)                              as is_makeable,

  -- Two of 040's five par reasons are gone with the array: "no par row at this
  -- shop" and "no pars set" were facts about production_item_locations, and a
  -- plan carrying an item is now the statement that the shop sells it. What
  -- replaces them is the null/zero pair — silence, and a decision.
  --
  -- "making none today" rather than "par is zero": it is the sentence a
  -- supervisor reads on the derived day and on the generation receipt, and it
  -- describes the shop where the other describes a column.
  case
    when not p.is_active                  then 'plan inactive'
    when not i.is_active                  then 'item inactive'
    when not coalesce(il.is_active, true) then 'item inactive at this shop'
    when s.par is null                    then 'no par set'
    when s.par = 0                        then 'making none today'
  end                                            as hidden_reason

from production_plans p
join production_plan_trays t      on t.plan_id = p.id
join production_plan_tray_items s on s.tray_id = t.id
join production_items i           on i.id = s.item_id
left join production_item_locations il
       on il.item_id = i.id
      and il.location_id = p.location_id;

grant select on v_production_plan_days to authenticated;

/* -- 2. the column ---------------------------------------------------------- */

alter table production_items
  drop column if exists base_element_id;

-- 037 called it `production_items_base_idx`, not `..._base_element_idx`.
-- Postgres drops an index with its column, so this is belt and braces — and a
-- statement that it was not forgotten.
drop index if exists production_items_base_idx;

-- PostgREST caches the schema, and this migration changes the shape of both a
-- table and a view it serves. Without this the first select carrying the old
-- column shape answers from a stale cache.
notify pgrst, 'reload schema';
