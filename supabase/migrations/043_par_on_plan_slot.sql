-- ============================================================================
-- restaurantfriend — migration 043 · the par moves onto the plan slot
--
-- Mark, 2026-08-08: "production pars should probably live here in the plan
-- rather than off the production item… each tray would have two fields instead
-- of one: [production_item] [par]."
--
-- He is right, and 039 had already built the shape for it. A plan slot is keyed
-- (tray, weekday, item) and a plan carries the selling location, so a par on
-- that row lands on exactly the axes a par needs. Until now the number came
-- from `production_item_locations.par_by_weekday[weekday]`, joined at render
-- time — which states the weekday axis TWICE, once on the slot and once in the
-- array, free to disagree. Measured before this ran: 184 of 311 par arrays vary
-- by weekday (DF01 [18,18,18,18,24,36,36], the weekend ramp), so that second
-- axis was carrying real information and duplicating the plan's own.
--
-- Cheapest possible moment: 1 plan, 2 trays, 1 slot, 0 par overrides, 0
-- schedules, 0 schedule items. Nothing to data-migrate, and no generated
-- document depends on the old source.
--
-- ----------------------------------------------------------------------------
-- THE ARRAY BECOMES A SEED, NOT A SOURCE
--
-- 013's shape: a purchase-order line SNAPSHOTS the vendor's price, and from
-- then on the line owns the number. Adding an item to a Saturday cell at DF01
-- copies that item's Saturday default onto the new slot; nothing reads the
-- array again at generation. The item record relabels it "Default par", and
-- says out loud that changing it does not change plans already built.
--
-- The column is dropped in a LATER migration, once real plans carry the
-- numbers — not here. Dropping the seed in the same breath as planting it
-- leaves no way back, and 1,947 non-zero slots of real FileMaker history is
-- exactly what makes building the first plans bearable.
--
-- There is deliberately no `par_source` on the slot. That column exists on
-- `production_schedule_items` because a GENERATOR rewrites those rows and has
-- to know which numbers are its to recompute. Nothing rewrites a plan slot: a
-- seeded number is simply the number you accepted by leaving it there, and the
-- default is still sitting in `par_by_weekday` to compare against. Any
-- behaviour that DID read such a flag — "the default changed, re-seed the slots
-- nobody typed over" — is the invisible recalculation this app refuses, and
-- would let one edit on an item record silently rewrite three shops' menus.
--
-- ----------------------------------------------------------------------------
-- THREE STATES, AND THEY ARE THE ORDER GUIDE'S THREE
--
-- This is the guide's quantity box exactly, and deliberately:
--
--   a number > 0   somebody said how many          → makes it, par_source 'plan'
--   0              somebody said NONE, on purpose  → on the menu, making none;
--                  keeps its tray position, reads as SUPPRESSED on the day
--   null           nobody has said anything        → yellow "—" in the matrix,
--                  makes nothing, and the day says "no par set"
--
-- Zero and null being different sentences is the whole point. Zero is a human
-- act — it is how you say "we sell it, not today" without taking the item off
-- the tray, which is how you say it is off the menu. Null is silence, and the
-- derived day must be able to tell a reader which one it is looking at.
--
-- Depends on 039 and 040. Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The column
-- ----------------------------------------------------------------------------
--
-- `par is null or` is redundant against Postgres' three-valued CHECK semantics
-- (a null check passes), and is written out because the null IS the point here:
-- a reader should not have to know that rule to see that null is allowed.
--
-- `production_par_overrides.par` stays NOT NULL by contrast — an override is by
-- definition a statement somebody made, so it has no third state.

alter table production_plan_tray_items
  add column par numeric(10,2) check (par is null or par >= 0);

comment on column production_plan_tray_items.par is
  'How many of this item on this tray this weekday. Null = nobody has said; '
  '0 = on the menu, making none today. Seeded from '
  'production_item_locations.par_by_weekday when the item is added to a plan, '
  'and owned by this row thereafter.';

comment on column production_item_locations.par_by_weekday is
  'DEFAULT par, seed only since 043: copied onto a plan slot when an item is '
  'added to a plan at this shop. NOTHING reads it at generation. Editing it '
  'does not change plans that already exist. Dropped once real plans carry '
  'the numbers.';

-- ----------------------------------------------------------------------------
-- Carry the existing slots over
-- ----------------------------------------------------------------------------
--
-- One row on the live database today, so this is for correctness on any
-- database this migration meets rather than for that one.
--
-- A correlated subquery rather than `update … from … join`: the target table
-- can't be referenced inside a FROM-clause join condition, and the tray is how
-- a slot reaches its plan and therefore its selling location.
--
-- `nullif(…, 0)` ON PURPOSE. A zero in the old array is not the deliberate zero
-- this migration invents — it is the old schema's way of writing "we don't make
-- this that day", i.e. silence. Seeding it as 0 would manufacture a human
-- decision nobody made, and the derived day would report it as SUPPRESSED. The
-- invariant worth keeping: a suppressed line always traces back to a human act
-- on the plan. (Measured: 3 such slots exist in the whole dataset, none at DF01
-- or DF02 — so this is chosen for the invariant, not for the data.)

update production_plan_tray_items s
   set par = (
     select nullif(il.par_by_weekday[s.weekday], 0)
       from production_plan_trays t
       join production_plans p on p.id = t.plan_id
       join production_item_locations il
         on il.item_id = s.item_id
        and il.location_id = p.location_id
      where t.id = s.tray_id
   )
 where s.par is null;

-- ----------------------------------------------------------------------------
-- v_production_plan_days — the menu at WEEKDAY grain, now with its own par
-- ----------------------------------------------------------------------------
--
-- DROP and recreate rather than `create or replace`: the column list happens
-- not to change (an array subscript carries the array's own typmod, so
-- `il.par_by_weekday[s.weekday]` and `s.par` are both numeric(10,2)), so a
-- replace would be accepted — but drop-and-recreate is the idiom this schema
-- already uses for v_order_guide's siblings (008, 009, 010, 011), and it says
-- plainly that the SOURCE of the par changed rather than its type.
--
-- TWO THINGS A DROP TAKES WITH IT AND THIS PUTS BACK: `security_invoker` and
-- the grant. Losing the first makes the view ignore its caller's RLS; losing
-- the second makes every read fail for `authenticated`.
--
-- `production_day` does not block the drop — its body is a quoted string
-- literal rather than BEGIN ATOMIC, so Postgres records no dependency on it.
--
-- `production_item_locations` IS STILL JOINED, and now for exactly one reason:
-- `il.is_active`, which feeds `is_makeable` and the "item inactive at this
-- shop" sentence.
--
-- AND THAT SENTENCE IS ALL IT DOES — a pre-existing hole this migration
-- SURFACES rather than introduces, measured on the harness. `is_makeable` is
-- not one of `production_day`'s return columns and never has been, and the fold
-- below has never consulted it; generation filters on `par > 0 and not
-- is_suppressed`. So an item switched off at a shop still generates a line,
-- carrying a reason that says it shouldn't — under 040 exactly as here, since
-- 040's `planned_par` was the array cell regardless of `il.is_active`.
--
-- NOT FIXED HERE, deliberately. It is latent: 0 of 307 items and 0 of 325
-- item-locations are inactive today, so nothing can trigger it, and changing
-- what a shop produces is a decision to take deliberately rather than fold into
-- a migration about where the par lives. The honest options when it is taken:
-- let a structurally-unavailable item read as SUPPRESSED (deactivating an item
-- at a shop IS a human saying no, so the word fits), or gate generation on
-- `is_makeable` directly. Ask first.
--
-- Either way it is a thin reason for a join now, and the migration that
-- eventually drops `par_by_weekday` should decide whether it survives.
--
-- KNOWN BEHAVIOUR CHANGE, and it is the right one: an item with NO
-- production_item_locations row at all now MAKES. Under 040 it said "no par row
-- at this shop" and made nothing. A plan carrying an item is the statement that
-- the shop sells it, and the par is on the slot, so there is nothing left for
-- the absent row to withhold.

drop view v_production_plan_days;

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
  i.base_element_id,

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


-- ----------------------------------------------------------------------------
-- production_day(location, date) — two hunks change, everything else is 040's
-- ----------------------------------------------------------------------------
--
-- The argument list is unchanged, so `create or replace` is safe here and 029's
-- overload trap (which needed a DROP first) does not apply.
--
-- What changed, and why each one is not cosmetic:
--
-- 1. THE REASON PICK IN `planned`. Under 040 every row in a (kitchen, item)
--    group read the SAME production_item_locations array cell, so every row in
--    the group carried the same `hidden_reason` and picking one arbitrarily was
--    harmless. Under 043 two overlapping plans genuinely disagree: plan A says
--    12, plan B says 0, the sum is 12, and the old pick could report "making
--    none today" BESIDE A PAR OF TWELVE — and put a `not_made` line on the
--    generation receipt for something the shop is making. Now a group only has
--    a reason when nothing in it can be made, and the pick is ordered so the
--    more informative sentence wins.
--
-- 2. `is_suppressed`. Decision 3 makes a plan-sourced zero a human saying no,
--    so it must read as suppressed and not as "nobody said anything". See the
--    comment at the expression itself for the null-safety, which is the part a
--    rewrite would drop.

create or replace function production_day(p_location_id uuid, p_date date)
returns table (
  location_id          uuid,
  kitchen_location_id  uuid,
  schedule_date        date,
  item_id              uuid,
  item_name            text,
  item_type            text,
  subtype              text,
  finish               text,
  size                 text,
  tally_box_size       integer,
  tray_capacity        integer,
  tray_number          text,
  tray_band            text,
  tray_sort            integer,
  price_class          text,
  price_tier           text,
  planned_par          numeric,
  override_par         numeric,
  par                  numeric,
  par_source           text,
  override_note        text,
  plan_ids             uuid[],
  plan_count           integer,
  kitchen_assumed      boolean,
  kitchen_split        boolean,
  is_suppressed        boolean,
  hidden_reason        text
)
language sql
stable
set search_path = public
as $$
with wd as (
  select extract(isodow from p_date)::int as weekday
),
-- Decision 9: a shop's effective menu on a date is the UNION of its active
-- plans, and pars SUM across overlapping ones. That sum is a WARNING at
-- generation, never a constraint at write time — 039's header says so outright,
-- and overlapping plans are the feature (DF01 makes DF02's raised donuts while
-- DF02 makes its own cake).
--
-- The sum is now MEANINGFUL in a way it could not be under 040: each plan
-- states its own number, so "half a tray of 12 plus half a tray of 12 is 24" is
-- a true sentence. Under 040 both rows read one array cell, so an overlap
-- doubled a number nobody had written down.
planned as (
  select
    v.kitchen_location_id                                as kitchen_location_id,
    v.item_id                                            as item_id,
    sum(v.planned_par)                                   as planned_par,
    min(v.tray_sort)                                     as tray_sort,
    (array_agg(v.tray_number order by v.tray_sort nulls last))[1] as tray_number,
    (array_agg(v.tray_band   order by v.tray_sort nulls last))[1] as tray_band,
    array_agg(distinct v.plan_id)                        as plan_ids,
    count(distinct v.plan_id)::int                       as plan_count,
    bool_or(v.kitchen_assumed)                           as kitchen_assumed,
    bool_or(v.is_makeable)                               as makeable,
    -- A REASON ONLY WHEN NOTHING IN THE GROUP CAN BE MADE. See hunk 1 above:
    -- with the par on the slot, two plans can disagree, and reporting the
    -- losing plan's reason would contradict the par printed beside it.
    --
    -- Ordered by the par, nulls last, so the pick is deterministic and the more
    -- informative sentence wins: a deliberate zero outranks silence.
    --
    -- `bool_or(v.is_makeable)` cannot be null here — `is_makeable` ANDs only
    -- NOT NULL columns with two null-safe predicates, so it is always true or
    -- false. This is also the first thing that has ever read it.
    case
      when bool_or(v.is_makeable) then null
      else (array_agg(v.hidden_reason order by v.planned_par desc nulls last)
              filter (where v.hidden_reason is not null))[1]
    end                                                  as hidden_reason,
    max(v.item_name)      as item_name,
    max(v.item_type)      as item_type,
    max(v.subtype)        as subtype,
    max(v.finish)         as finish,
    max(v.size)           as size,
    max(v.tally_box_size) as tally_box_size,
    max(v.tray_capacity)  as tray_capacity,
    max(v.price_class)    as price_class,
    max(v.price_tier)     as price_tier
  from v_production_plan_days v
  cross join wd
  where v.location_id = p_location_id
    and v.plan_active
    and v.weekday = wd.weekday
    and v.starts_on <= p_date
    and (v.ends_on is null or v.ends_on >= p_date)
  group by v.kitchen_location_id, v.item_id
),
-- An override carries ONE number, while decision 9 lets one item come from two
-- kitchens. A person thinks about a display case as one number, so the override
-- claims the kitchen making the most of it and the others go to zero — and
-- `kitchen_split` says so, so the generation receipt can name it.
ranked as (
  select
    pl.*,
    row_number() over (partition by pl.item_id
                       order by pl.planned_par desc nulls last,
                                pl.kitchen_location_id) as kitchen_rank,
    count(*) over (partition by pl.item_id)             as kitchen_count
  from planned pl
),
ov as (
  select
    o.item_id             as item_id,
    o.par                 as override_par,
    o.kitchen_location_id as ov_kitchen,
    o.note                as ov_note
  from production_par_overrides o
  where o.location_id = p_location_id
    and o.override_date = p_date
),
-- THE FOLD, in its own CTE so the effective par is computed ONCE and everything
-- downstream reads it. Written inline twice it drifted immediately: the zeroed
-- side of a kitchen-split override reported `is_suppressed = false` beside a
-- par of 0, which on a screen reads as "we just aren't making any", with no
-- explanation offered.
folded as (
  select
    coalesce(r.kitchen_location_id, ov.ov_kitchen, p_location_id) as kitchen_location_id,
    coalesce(r.item_id, ov.item_id)              as item_id,
    coalesce(r.item_name, i.name)                as item_name,
    coalesce(r.item_type, i.item_type)           as item_type,
    coalesce(r.subtype, i.subtype)               as subtype,
    coalesce(r.finish, i.finish)                 as finish,
    coalesce(r.size, i.size)                     as size,
    coalesce(r.tally_box_size, i.tally_box_size) as tally_box_size,
    coalesce(r.tray_capacity, i.tray_capacity)   as tray_capacity,
    r.tray_number                                as tray_number,
    r.tray_band                                  as tray_band,
    r.tray_sort                                  as tray_sort,
    coalesce(r.price_class, i.price_class)       as price_class,
    coalesce(r.price_tier, i.price_tier)         as price_tier,
    r.planned_par                                as planned_par,
    ov.override_par                              as override_par,
    -- An override on a split item claims the top kitchen and zeroes the rest;
    -- with no override the plan sum stands.
    case
      when ov.override_par is null then coalesce(r.planned_par, 0)
      when r.item_id is null       then ov.override_par        -- an ADDITION
      when r.kitchen_rank = 1      then ov.override_par
      else 0
    end                                          as par,
    case when ov.override_par is not null then 'override' else 'plan' end as par_source,
    ov.ov_note                                   as override_note,
    coalesce(r.plan_ids, '{}'::uuid[])           as plan_ids,
    coalesce(r.plan_count, 0)                    as plan_count,
    coalesce(r.kitchen_assumed, r.item_id is null) as kitchen_assumed,
    (coalesce(r.kitchen_count, 1) > 1 and ov.override_par is not null) as kitchen_split,
    (ov.override_par is not null)                as has_override,
    -- An override is an explicit human statement and outranks "no par set".
    -- That is the mechanism that lets you add an item no plan carries.
    case when ov.override_par is not null then null else r.hidden_reason end as hidden_reason
  from ranked r
  -- FULL OUTER: a row with no plan side is an ADDITION, a row with no override
  -- side is the ordinary case. One record type, two meanings, no flag.
  full outer join ov on ov.item_id = r.item_id
  left join production_items i on i.id = coalesce(r.item_id, ov.item_id)
)
select
  p_location_id,
  f.kitchen_location_id,
  p_date,
  f.item_id, f.item_name, f.item_type, f.subtype, f.finish, f.size,
  f.tally_box_size, f.tray_capacity, f.tray_number, f.tray_band, f.tray_sort,
  f.price_class, f.price_tier,
  f.planned_par, f.override_par, f.par, f.par_source, f.override_note,
  f.plan_ids, f.plan_count, f.kitchen_assumed, f.kitchen_split,
  -- SUPPRESSED means A HUMAN SAID NO. Three ways to say it, and one way that
  -- isn't:
  --
  --   * an override of 0                     — "not today", the 040 case;
  --   * the losing side of a split override  — same expression, par forced to 0;
  --   * a PLAN SLOT of 0 (new, decision 3)   — "on the menu, making none". The
  --     item keeps its tray position; taking it OFF the tray is how you say it
  --     is off the menu, and the two must not read the same.
  --
  -- An item with NO par is still NOT suppressed — nobody has said anything
  -- about it, which is what `hidden_reason` is for. Both end up with par 0 and
  -- neither generates a line, but they are different sentences and a screen has
  -- to be able to tell them apart.
  --
  -- THE COALESCE IS LOAD-BEARING, not defensive tidying. `sum()` over all-null
  -- pars is NULL, not 0, so a bare `f.planned_par = 0` returns NULL — and
  -- `not d.is_suppressed` appears FOUR times in generate_production_schedules,
  -- where `not NULL` is not false, it is NULL, and the row is silently dropped.
  -- A tri-state boolean escaping into four filters is the bug to prevent.
  --
  -- Across OVERLAPPING plans the sum decides, and that is the intended answer:
  --   0 and 12   → 12, not suppressed   (a zero on one plan is not a veto over
  --                                      another plan's twelve; an OVERRIDE is
  --                                      the veto, and it wins above)
  --   0 and 0    → 0,  suppressed       (every plan that spoke said none)
  --   0 and null → 0,  suppressed       (one said none, one said nothing)
  --   null,null  → NULL → par 0, NOT suppressed, reason "no par set"
  case
    when f.has_override then f.par = 0
    else coalesce(f.planned_par = 0, false)
  end,
  f.hidden_reason
from folded f
order by f.tray_sort nulls last, f.tray_number nulls last, f.item_name;
$$;

revoke all on function production_day(uuid, date) from public;
revoke all on function production_day(uuid, date) from anon;
grant execute on function production_day(uuid, date) to authenticated;


-- ----------------------------------------------------------------------------
-- generate_production_schedules — deliberately UNCHANGED
-- ----------------------------------------------------------------------------
--
-- It filters `d.par > 0 and not d.is_suppressed` in four places, and all four
-- still say the right thing:
--
--   slot 12              → par 12, not suppressed          → line written
--   slot null            → par 0,  not suppressed          → no line (par > 0 fails)
--   slot 0               → par 0,  SUPPRESSED              → no line (both fail)
--   slot 0  + override 24→ par 24, not suppressed          → line, source 'override'
--   slot 12 + override 0 → par 0,  suppressed              → no line (040 intact)
--
-- The `on conflict (schedule_id, item_id) do update` path only ever sees rows
-- that passed the filter, so it is untouched; a `par_source = 'manual'` line
-- still survives a regeneration, and a line carrying actuals still forces
-- p_allow_actuals.
--
-- ONE CONSEQUENCE WORTH KNOWING: the receipt's `not_made` warning now fires for
-- every deliberately-zeroed slot, every night. That is accurate and it is the
-- under-minimum-vendor pattern — name what happened, let them through. If a
-- shop that zeroes fifteen items on Mondays finds it noisy, the fix is a
-- distinct warning kind for a deliberate zero, not silence.

-- PostgREST caches the schema; without this the first insert carrying `par`
-- fails with PGRST204 "column par does not exist", which reads like the
-- migration never ran.
notify pgrst, 'reload schema';
