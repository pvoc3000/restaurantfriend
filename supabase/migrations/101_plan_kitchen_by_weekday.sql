-- ============================================================================
-- 101 — A PLAN'S KITCHEN IS PER WEEKDAY, and the single "Made at" is RETIRED
-- ============================================================================
--
-- Mark, 2026-09-09: "Currently the only way to have donuts made for DF2 at DF1
-- M-W and DF2 Th-Su is to have two separate plans … any change to the schedule
-- requires the user to change 2 schedules instead of just one. A better
-- solution … is to place a kitchen field above each day's column."
--
-- He is right, and the reason is that the two-plan workaround makes a TRAY look
-- like it changes on Thursday. A tray is a physical case position at the
-- SELLING shop and it does not change; what changes by day is who bakes it. 039
-- put the kitchen on the plan, which is one answer for a whole week, so the
-- only way to vary it was to vary the plan — and then DF02 has two tray 01s
-- that are the same shelf, and every edit has to be made to both.
--
-- WHAT THIS IS NOT: it does not replace OVERLAPPING PLANS. Two kitchens on ONE
-- day, split by item — "DF01 makes DF02's raised donuts while DF02 makes its
-- own cake", 039's own example — is still two overlapping plans, which is why
-- `production_day` groups by (kitchen, item) and why `kitchen_split` exists on
-- overrides. This is the DIFFERENT-DAYS case, and only that.
--
-- THE SINGLE COLUMN IS DROPPED, NOT KEPT AS A DEFAULT (Mark: "we would retire
-- the plan's 'made at' field as it would conflict with the daily kitchen
-- locations field"). Two answers to one question is 016's `nextDeliveryDate`
-- trap, and a plan-level field that only applies where a day says nothing is
-- exactly the shape that drifts. Decision 9's fallback survives INTACT and is
-- unchanged in meaning: a null says the selling shop makes its own — it is now
-- said per day rather than per plan.
--
-- ----------------------------------------------------------------------------
-- WHY NOTHING BELOW THE VIEW CHANGES, which is the whole reason this is cheap:
--
--   * `production_day(location, date)` filters `v.weekday = wd.weekday` and
--     THEN groups by `v.kitchen_location_id`. Every row it sees already shares
--     one weekday, so the kitchen it groups by is that weekday's. Untouched.
--   * `production_schedules` is unique on (location_id, schedule_date,
--     kitchen_location_id) — 040:350 — so one seller already may have two
--     schedules on one date at two kitchens. Which is exactly what a week
--     split M–W / Th–Su produces.
--   * `generate_production_schedules` reads `distinct d.kitchen_location_id`
--     out of the day and loops over it. 040's own comment — "the kitchen is
--     NOT a parameter: the DAY tells you which kitchens are involved" — is
--     what makes it indifferent to where the day got its answer. Untouched,
--     and deliberately NOT reproduced here (055's rule: 092 holds the current
--     body, and a migration that restates a function it does not mean to
--     change is how one gets silently reverted).
--
-- So the substance is one expression moving inside `v_production_plan_days`.
-- ----------------------------------------------------------------------------
--
-- AN ARRAY, NOT A CHILD TABLE. Seven slots on the plan, slot n = ISO weekday n,
-- which is `par_by_weekday` (009), `open_time_by_weekday` (017) and
-- `standing_days` (051) — the house idiom for a fact that has exactly seven
-- values. A `production_plan_kitchens(plan, weekday, location)` table would buy
-- a real FK per slot and cost another table, another RLS block, another select
-- on two screens and an upsert; 043's lesson ran the other way (par came OFF an
-- array) but only because there was already a row carrying the weekday axis to
-- move it onto, and here there is none.
--
-- THE COST OF THE ARRAY, stated so nobody is surprised by it: an array cannot
-- carry a foreign key, so where `kitchen_location_id` had `on delete set null`,
-- a deleted location now leaves a dangling uuid in a slot. It fails LOUDLY
-- rather than silently — `production_schedules.kitchen_location_id` is
-- `not null references locations(id)`, so generation raises an FK violation
-- rather than making donuts at a shop that does not exist. Locations are
-- deactivated rather than deleted in this app, so this is a live edge and not a
-- live risk.
--
-- AND THE SUBSCRIPT COMES BACK. 049's view celebrated that "there is no array
-- subscript left anywhere in this file" after 043 moved the par onto the slot.
-- One returns here, on a different axis, and 040's warning applies to it word
-- for word: getting it wrong by one silently shifts a whole shop's WHOLE WEEK
-- of kitchens by a day. What makes it safe is that the subscript is `s.weekday`
-- — the slot's own column, the same value the row is keyed by — rather than a
-- number computed anywhere. There are fixtures on the app-side twin
-- (`planKitchenFor`) and the harness exercises this one.

-- ----------------------------------------------------------------------------
-- 1. the column
-- ----------------------------------------------------------------------------
--
-- `cardinality`, NEVER `array_length(x, 1)` — 076's lesson, and it was found by
-- asserting a refusal rather than assuming one: `array_length('{}', 1)` returns
-- NULL, not 0, so the predicate is NULL and A CHECK CONSTRAINT PASSES ON NULL.
-- The empty array sails straight through. (017's own check on
-- `locations.kitchen_by_weekday` has exactly that hole; it is not fixed here.)
--
-- NULL for the whole column means "every day, the selling shop" — the state
-- every existing plan that named no kitchen is already in, so nothing needs
-- backfilling for them. A null SLOT means the same thing for that one day.

alter table production_plans
  add column kitchen_by_weekday uuid[];

alter table production_plans
  add constraint production_plans_kitchen_by_weekday_len
    check (kitchen_by_weekday is null or cardinality(kitchen_by_weekday) = 7);

comment on column production_plans.kitchen_by_weekday is
  'Which kitchen MAKES this plan, per ISO weekday: slot 1 = Monday … slot 7 = '
  'Sunday. A null slot (or a null column) means the selling shop makes its own '
  'that day — decision 9''s fallback, stated per day since 101. Replaces the '
  'single kitchen_location_id, which 101 dropped.';

-- ----------------------------------------------------------------------------
-- 2. the backfill — seven copies of whatever the plan said before
-- ----------------------------------------------------------------------------
--
-- A plan naming DF01 meant DF01 every day, so seven copies is exactly what it
-- said. Plans naming no kitchen are left NULL, which means the same thing it
-- always meant.

update production_plans
   set kitchen_by_weekday = array_fill(kitchen_location_id, array[7])
 where kitchen_location_id is not null;

-- ----------------------------------------------------------------------------
-- 3. the view — recreated so the column can go, and the ONE real change
-- ----------------------------------------------------------------------------
--
-- Verbatim from 049 but for the two kitchen expressions. `production_day` does
-- not block the drop: its body is a quoted string literal rather than BEGIN
-- ATOMIC, so Postgres records no dependency on the view (043 relied on the same
-- thing). The GRANT has to be restated — a dropped view takes its privileges.

drop view v_production_plan_days;

alter table production_plans drop column kitchen_location_id;

-- Belt and braces: Postgres drops an index with its column. A statement that it
-- was not forgotten, and 049's own idiom.
drop index if exists production_plans_kitchen_idx;

create view v_production_plan_days with (security_invoker = true) as
select
  p.org_id,
  p.id                as plan_id,
  p.title             as plan_title,
  p.location_id,
  -- Decision 9's fallback, stated ONCE here rather than at every reader — and
  -- since 101, per DAY. `s.weekday` is the slot's own column, so the subscript
  -- cannot disagree with the row it is on.
  coalesce(p.kitchen_by_weekday[s.weekday], p.location_id) as kitchen_location_id,
  (p.kitchen_by_weekday[s.weekday] is null)                as kitchen_assumed,
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

  -- THE PAR, from the slot that holds the item.
  s.par                                          as planned_par,

  (p.is_active
     and i.is_active
     and coalesce(il.is_active, true)
     and s.par is not null
     and s.par > 0)                              as is_makeable,

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

-- ----------------------------------------------------------------------------
-- NOT TOUCHED, and named so nobody thinks it was forgotten
-- ----------------------------------------------------------------------------
--
-- `locations.kitchen_by_weekday` and `shops_for` (017), which 039's header said
-- would "become vestigial the day kitchen-on-plan lands" — this is that day,
-- and they are now unambiguously a second answer to a question the plan owns.
-- They are NOT dropped here: they hold real data, they have a live editor on
-- the location record (`ProductionMapping`), nothing has ever DERIVED anything
-- from them, and deleting a block off a screen is a decision to take
-- deliberately rather than fold into a migration about plans. One commit when
-- Mark wants it.
--
-- APPLY THIS BEFORE DEPLOYING, which is 059/060's order and not 012's. Five
-- screens select `kitchen_by_weekday`, so a deploy that runs in front of the
-- migration 400s each of those selects. Two of them degrade honestly — the
-- schedules list and record only lose the plan's NAME in their From column —
-- but the shift report's Tomorrow page and the generate dialog would find no
-- plans and report "No active plan makes anything at <shop>", which stops a
-- closing supervisor generating the night's paper. The plans screens themselves
-- say "migration 101 has not been applied yet" by name.
--
-- NOT RERUNNABLE: `drop column kitchen_location_id` fails a second time, which
-- is the signal it already ran.
