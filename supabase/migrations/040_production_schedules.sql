-- ============================================================================
-- restaurantfriend — migration 040 · production schedules
--
-- Phase 4 of the Production module, and the one that replaces FileMaker's
-- nightly closing routine. 039 gave us the PLAN — what we propose to make. This
-- gives us the SCHEDULE — what we actually land on for a particular day, and
-- the record a kitchen works from.
--
-- Depends on 036 (elements), 037 (items, batch yields), 039 (plans) and 001.
-- NOT rerunnable.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS REPLACES
--
-- FMP's supervisor runs seven generator dialogs a night — the Skip/Continue
-- gauntlet — and prints a packet: a Premade Schedule per shop, three tray
-- guides per kitchen, three element sheets. Decision 5 collapses that into ONE
-- generation act plus a print, because only the item-grain document is a
-- RECORD; the other six carry no information of their own and are renderings
-- of the same night re-cut at different grains.
--
-- So this migration adds exactly one document table and its lines, plus the
-- derivation that feeds them.
--
-- ---------------------------------------------------------------------------
-- THE DERIVED DAY IS A FUNCTION, NOT A VIEW AND NOT A TABLE (design rule 4)
--
-- Never materialize it. The order guide's `v_order_guide` is the precedent and
-- the reason the rule exists at all: FMP did the opposite and it was the single
-- worst source of bugs and slowness.
--
-- But it cannot be a plain view either, and the reason is worth stating because
-- the obvious move is to copy `v_order_guide` wholesale. That view fabricates a
-- weekday axis with `cross join generate_series(1, 7)` because its par lives in
-- a SEVEN-SLOT ARRAY with no weekday row to join to. Here
-- `production_plan_tray_items.weekday` already IS a row per weekday, so the
-- cross join would manufacture an axis only to filter it straight back down.
--
-- And a schedule is bound to a DATE, not a weekday. Plan membership is a RANGE
-- predicate (`starts_on <= d and (ends_on is null or ends_on >= d)`) that no
-- array subscript can fake, and a date axis has no natural bound — a
-- `generate_series` over dates that a caller forgets to constrain is a silent
-- cartesian over every plan in the org.
--
-- Hence `production_day(location, date)`: a set-returning function, exposed to
-- PostgREST as `rpc/production_day` for the screen AND called internally by the
-- generator. One implementation, two callers, nothing to drift. That last part
-- is 013's precedent: the generator recomputes the answer in SQL rather than
-- inserting numbers a client computed, or a stale tab writes last week's
-- arithmetic into a committed document.
--
-- ---------------------------------------------------------------------------
-- SQL WRITES THE PARS. TYPESCRIPT WRITES THE MONEY.
--
-- `web/src/lib/productionCost.ts` already resolves the whole graph — purchased
-- element -> inventory item -> cheapest active vendor item -> location price
-- override, made element -> master recipe version -> recursive line costs —
-- with `lib/units.ts` conversion, a cycle guard, and an `unresolved[]` list so
-- an unpriced component reports a LOWER BOUND rather than a confident zero.
-- `matchYield()` already ranks `production_batch_yields` by specificity.
--
-- A SQL twin of any of that would be decision 2's disease in a new form: two
-- vocabularies for one number. So `generate_production_schedules` writes the
-- four cost columns NULL and the caller patches them from the graph it is
-- already holding. A null `costed_at` is a legible state — the screen says "—"
-- beside a Recost command — where a zero would be a wrong number that looks
-- right.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- production_element_days — which kitchen makes what, on which day
-- ----------------------------------------------------------------------------
--
-- FMP's element production schedule, and the one config export no transform had
-- ever read: `_production.mer`, 1,201 rows over 212 elements and 365
-- (element, kitchen) pairs. Phase 1 loaded `_elementpars.mer` instead, which is
-- 59 element-locations — a sixth of this, and carrying neither shift nor batch.
--
-- This is what the AB and Weekly element sheets print from.
--
-- `location_id` is the KITCHEN — FMP's `kitchen_t`, which is the column that
-- squares with kitchen-on-plan (decision 9). An element is made SOMEWHERE; it
-- is not made "for" a shop.
--
-- ---------------------------------------------------------------------------
-- A ROW IS ONE BATCH, NOT ONE ELEMENT-DAY
--
-- Measured, and the thing a reading of the column list would get wrong: Raised
-- Dough at DF01 on a Monday morning is FOUR rows, labelled 1 · 2 · 3 · 5. They
-- are four batches to make that morning, so the grain is
-- (element, kitchen, weekday, shift, BATCH) — 1,080 groups become 1,184 once
-- the batch is in the key, and 76 groups genuinely hold more than one.
--
-- And `batchOrder_n` IS NOT A NUMBER despite its name. Its 17 distinct values
-- include "Blueberry", "Caramel", "Chocolate", "Maple", "Strawberry",
-- "Vanilla", "1 Bag", "x1" and "x2" — element 1109's batches are FLAVOURS, not
-- positions. An `integer` column would have taken the numeric ones and silently
-- dropped the rest, which is why this is `batch_label text` with `sort` beside
-- it for the ones that really are ordinal.

create table production_element_days (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  element_id  uuid not null references production_elements(id) on delete cascade,

  -- The kitchen. Cascade rather than restrict, unlike a plan's item: this row
  -- is a rhythm, not a menu — losing it costs a line on a sheet, not a product.
  location_id uuid not null references locations(id) on delete cascade,

  weekday     smallint not null check (weekday between 1 and 7),

  -- FMP's `shift_t`, loaded VERBATIM and deliberately not normalised. Measured
  -- over the real file: MORNING 378 · BAKER 173 · FRYER 167 · AB 64 ·
  -- OVERNIGHT 55 · EVENING 39 · blank 325 — which is a mix of shift names and
  -- SHEET names. Tidying that into one vocabulary at load time would be
  -- guessing where the brief says report; the transform names the values and
  -- Mark decides. (It varies within an (element, kitchen) pair on 28 of 159, so
  -- it is genuinely per-row.)
  shift       text,

  -- Which batch of the day this is. See the header: a LABEL, not a position.
  batch_label text,
  -- The ordinal when the label is one ("3" -> 3), null when it is "Caramel".
  -- Sheets order by this then by the label, so a flavour batch sorts after the
  -- numbered ones rather than being dropped.
  sort        integer,

  -- The tiebreak, and the reason it exists: `_production.mer` HAS NO PRIMARY
  -- KEY — not one column of it, checked. So a batch's identity has to be its
  -- natural tuple, and FileMaker holds six unlabelled Tuesday batches of
  -- element 1126 at DF01 carrying DIFFERENT amounts (8, 4, 2). Merging them on
  -- the tuple alone would silently discard five real batches.
  --
  -- 028's `source_row_key` lesson, same shape: natural tuple plus an occurrence
  -- ordinal, and stored READABLE rather than hashed so a duplicate explains
  -- itself when somebody comes looking.
  occurrence  smallint not null default 1 check (occurrence >= 1),

  -- FMP's `batchAmount_n` × `batchPortion_t` — "make 50 #", "make 12 QT",
  -- "make 2 X". The amount varies within an (element, kitchen) pair on 13 of
  -- 184, so it belongs on the batch and not on the element.
  batch_amount numeric(12,3),
  batch_unit   text,

  -- FMP's `batchShouldExclude_b` — this element is on the rhythm but skipped.
  -- A flag rather than a deleted row, because "we don't make it Tuesdays any
  -- more" and "we never did" are different facts.
  is_excluded boolean not null default false,

  note        text,

  legacy_id   text,
  source      text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id, legacy_id)
);

-- A unique INDEX rather than a table constraint, because the key needs
-- expressions: `unique` treats two NULLs as distinct, so without the coalesces
-- a shiftless, unlabelled element could be entered twice for one day with
-- occurrence 1 and the sheet would print it twice.
create unique index production_element_days_key
  on production_element_days
     (element_id, location_id, weekday, coalesce(shift, ''),
      coalesce(batch_label, ''), occurrence);

create index production_element_days_day_idx
  on production_element_days (org_id, location_id, weekday, sort);

create trigger trg_production_element_days_updated before update
  on production_element_days
  for each row execute function set_updated_at();


-- ----------------------------------------------------------------------------
-- production_items.tray_capacity — how many fit on a baker's tray
-- ----------------------------------------------------------------------------
--
-- 037 gave the item `tally_box_size` (Mark: "It's always 6, but… the ability to
-- set the chunk size for each item"). This is the same shape for a DIFFERENT
-- artifact, and the two must not be confused: the premade schedule's counting
-- strip is boxes of six, while the baker and fryer guides draw a ruler of TRAY
-- numbers. Answered question 3 says so outright — "reproducing one from the
-- other's rule would be wrong".
--
-- 24 IS MEASURED, and so is the exception. Rendering the real 2026-08-07 DF02
-- night through this app's own components and comparing it page for page
-- against FileMaker's printed guide: every filled cell holds 24 — vanilla 54
-- reads 24 · 24 · 6, bismarks 60 read 24 · 24 · 12, the 42G bismarks read 29
-- cells of 24 — EXCEPT the fritters, which FileMaker trays 16 · 4 rather than
-- as a single 20.
--
-- So it is a column, not a constant. One value is wrong for at least one real
-- item today, and a constant would have printed a fritter tray that does not
-- exist while looking perfectly plausible.
alter table production_items
  add column tray_capacity integer not null default 24 check (tray_capacity > 0);


-- ----------------------------------------------------------------------------
-- production_par_overrides — decision 6, and the end of FMP's ceremony
-- ----------------------------------------------------------------------------
--
-- FMP bumped Saturday's pars for a holiday by GENERATING Saturday days early
-- and then defending the document: an exists-check, an overwrite warning, and a
-- "locked" flag that silently won (Mark: "locked isn't the right word… it's
-- really just a way to say this is important and shouldn't be overwritten").
-- The document was doing double duty as a place to store intent about a FUTURE
-- date, and every one of those mechanisms existed only because of that.
--
-- A par override IS that intent, as its own small record. There is nothing to
-- clobber; generation whenever it happens picks it up; generating ahead
-- composes with it instead of racing it.

create table production_par_overrides (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,

  -- The SELLING location, always. A par is a fact about what a display case
  -- needs; WHICH KITCHEN fills it is routing, and routing is what the plan
  -- answers. Keying this to the kitchen would mean a plan changing hands
  -- silently orphans the holiday bump somebody typed three weeks ago.
  location_id   uuid not null references locations(id) on delete cascade,

  override_date date not null,

  -- Cascade, where `production_plan_tray_items.item_id` restricts. That
  -- restrict still fires first, so this can never be the thing that lets a live
  -- item vanish quietly; once the item is legitimately gone, a note about one
  -- day is noise.
  item_id       uuid not null references production_items(id) on delete cascade,

  -- NOT NULL, and ZERO MEANS "don't make it today".
  --
  -- 001's guide entries established a three-state rule where null = untouched
  -- and 0 = an explicit decision. Here THE ROW ITSELF is the touch — it exists
  -- only because somebody typed something — so a nullable par would be a second
  -- way to say nothing. And to a kitchen, "don't make it" and "make zero of it"
  -- are the same instruction.
  --
  -- A suppressed item still SHOWS on the derived day, marked, so the drop is
  -- visible; generation writes no line for it, because a printed sheet with a
  -- zero row on it invites somebody to make it anyway.
  par           numeric(10,2) not null check (par >= 0),

  -- Consulted only when the override is an ADDITION — an item no active plan
  -- carries on that date, which therefore has no kitchen to inherit. Null falls
  -- back to the selling location ("we'll make it here"), which is right the
  -- overwhelming majority of the time and is named in the generation receipt
  -- when it isn't.
  kitchen_location_id uuid references locations(id) on delete set null,

  -- "July 4". The reason, which the packet prints.
  note          text,

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- ONE number per item per shop per day. Deliberately NOT keyed to a plan or a
  -- tray slot: keying it to a slot would make an ADDITION inexpressible, and an
  -- addition is half of what decision 6 is for. The derived day's FULL OUTER
  -- JOIN is what tells a bump from an addition, so there is no `is_addition`
  -- flag — a flag would be a second answer to a question the join answers.
  unique (location_id, override_date, item_id)
);

create index production_par_overrides_day_idx
  on production_par_overrides (org_id, location_id, override_date);
create index production_par_overrides_item_idx
  on production_par_overrides (item_id, override_date desc);

create trigger trg_production_par_overrides_updated before update
  on production_par_overrides
  for each row execute function set_updated_at();


-- ----------------------------------------------------------------------------
-- production_schedules — the committed day
-- ----------------------------------------------------------------------------

create table production_schedules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,

  schedule_date date not null,

  -- NO on-delete clause on either, i.e. RESTRICT — 001's `purchase_orders`
  -- idiom. A schedule is this module's purchase order: deleting a location must
  -- not take last month's paperwork with it. (`production_plans` cascades
  -- because a plan is config; a schedule is a document.)
  location_id         uuid not null references locations(id),   -- SELLS
  kitchen_location_id uuid not null references locations(id),   -- MAKES

  -- NOT NULL where the plan's kitchen is nullable. 039 made the plan's nullable
  -- because "a plan can be written before anyone has decided which kitchen
  -- takes it"; a SCHEDULE is a committed day and "undecided" is not a
  -- committable state. Generation coerces null -> the selling location and
  -- names every coercion in its receipt.

  -- Decision 12's seam, from day one. Nothing generates anything but 'plan';
  -- the other two exist so Special Orders plugs in without schema surgery and
  -- so every roll-up sums across sources by construction.
  source        text not null default 'plan'
                check (source in ('plan', 'special_order', 'manual')),
  -- The special order's id when that module lands. NO FK: the table does not
  -- exist yet, and a uuid with a documented meaning beats a column added later.
  source_ref    uuid,
  -- "Nguyen wedding" — what the packet's header says for a non-plan schedule.
  title         text,

  -- Decision 5: generation and printing are SEPARATE STAMPED ACTS, kept.
  -- ("Generated 8/6 by Leo, printed 8/7" is on the real FMP document.)
  generated_by  uuid references auth.users(id),
  generated_at  timestamptz not null default now(),

  -- Decision 6's honest guard leaves a TRAIL rather than a "locked" flag.
  regenerated_by     uuid references auth.users(id),
  regenerated_at     timestamptz,
  regeneration_count integer not null default 0,

  -- The LAST print. Reprinting is free (decision 7), so a count would be noise;
  -- what matters is whether paper exists in the kitchen at all.
  printed_by    uuid references auth.users(id),
  printed_at    timestamptz,

  -- The generate dialog's toggle, recorded ON the document it produced, so the
  -- sheet explains its own totals a month later.
  ignored_special_orders boolean not null default false,

  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ONE plan schedule per (shop, day, kitchen). This IS the exists-check decision
-- 6 shrinks generation's guard down to, enforced by the database — so a
-- double-click cannot produce two.
--
-- Note what is NOT here: a plain unique including `source`. Decision 12 says
-- special orders "become additional schedules for the night", PLURAL, so two on
-- one night is the normal case and a key spanning all sources would forbid it.
create unique index production_schedules_plan_day
  on production_schedules (location_id, schedule_date, kitchen_location_id)
  where source = 'plan';

-- One schedule per special order per shop-day. Two different orders are two
-- schedules, which is the whole reason `source` is not in the key above.
create unique index production_schedules_source_ref
  on production_schedules (location_id, schedule_date, source, source_ref)
  where source_ref is not null;

create index production_schedules_day_idx
  on production_schedules (org_id, schedule_date desc, location_id);
-- The `KITCHEN:` header on the real PDFs — what DF01 makes for every shop it
-- serves. Now a query, where FMP had it as a column on `locations`.
create index production_schedules_kitchen_idx
  on production_schedules (kitchen_location_id, schedule_date desc);

create trigger trg_production_schedules_updated before update
  on production_schedules
  for each row execute function set_updated_at();


-- ----------------------------------------------------------------------------
-- production_schedule_items — the line, at ITEM grain and no finer
-- ----------------------------------------------------------------------------
--
-- Decision 5: records at item grain only. The baker / fryer / decorator guides
-- and the element sheets are RENDERINGS of these same lines re-cut, computed at
-- print time and never stored. If supervisors ever need to hand-adjust an
-- ELEMENT quantity, that is the one assumption in decision 5 to revisit — and
-- it becomes element-grain lines, not a column here.

create table production_schedule_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  schedule_id uuid not null references production_schedules(id) on delete cascade,

  item_id     uuid not null references production_items(id) on delete restrict,

  -- --------------------------------------------------------------------------
  -- THE SNAPSHOT
  --
  -- 038 is literally named `item_name_is_not_identity`, and a rename must not
  -- rewrite what a printed document said. The TAXONOMY is snapshotted too, not
  -- just the name, because the taxonomy is what the baker and fryer guides
  -- group by (decision 4) — re-cutting last month's night at type x subtype has
  -- to use last month's answer.
  item_name      text not null,
  item_type      text,
  subtype        text,
  finish         text,
  size           text,

  -- Open question 3: the counting strip's box size comes from the ITEM. Frozen
  -- here so a bulk edit to 12 does not retroactively change a printed sheet.
  tally_box_size integer not null default 6 check (tally_box_size > 0),
  -- The tray guides' ruler. A DIFFERENT artifact from the box above, and
  -- snapshotted for the same reason.
  tray_capacity  integer not null default 24 check (tray_capacity > 0),

  -- Case order. NULL for an addition and for every special-order line — they
  -- have no tray, and they sort last.
  tray_number text,
  tray_band   text,

  -- --------------------------------------------------------------------------
  -- THE ASK
  par         numeric(10,2) not null check (par >= 0),

  -- What the plans said BEFORE any override or hand edit, so the document
  -- explains its own number. This is FMP's batch-log discipline — it snapshots
  -- par AND on-hand at the moment of logging, 96%+ filled over 14k rows — one
  -- layer up.
  planned_par numeric(10,2),
  par_source  text not null default 'plan'
              check (par_source in ('plan', 'override', 'special_order', 'manual')),

  -- --------------------------------------------------------------------------
  -- THE ANSWER (phase 5 fills these; the columns ship now so the document is
  -- whole and the screen matches the paper from day one)
  made        numeric(10,2) check (made is null or made >= 0),
  leftover    numeric(10,2) check (leftover is null or leftover >= 0),
  note        text,

  -- `sold` IS NOT HERE AND MUST NEVER BE. It is made - leftover, computed by
  -- the reader (v_production_schedule_lines below does it for SQL callers).
  -- Not even a generated column: the brief leaves a seam for a POS feed to
  -- become the source of `sold` later, and a generated column is exactly the
  -- thing that seam would have to fight.

  -- --------------------------------------------------------------------------
  -- THE COST OF THE DAY (brief open question 4)
  --
  -- Decision 11's own carve-out: costing is derived live, and snapshots happen
  -- exactly where a DOCUMENT needs them. A schedule is a document about a day
  -- that has now passed. Without this, last month's day cost silently
  -- re-prices itself every time an ingredient does — the 2022-price disease
  -- pointing the other way.
  --
  -- WRITTEN BY THE APP, NOT BY THE GENERATOR. See the header.
  unit_cost       numeric(12,4),   -- 4 places: half this catalog is priced per GRAM
  unit_price      numeric(10,2),   -- the menu price of the day, same argument
  -- How many elements under this item could not be priced. `formatCost` renders
  -- "at least $4.12" off exactly this count; storing the figure without it
  -- would freeze a lower bound as though it were a number.
  cost_unresolved integer,
  -- NULL means NOT COSTED, visibly.
  costed_at       timestamptz,

  sort        integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The upsert target regeneration uses. One line per item per schedule: two
  -- would double the day's par and nothing downstream would notice.
  unique (schedule_id, item_id)
);

create index production_schedule_items_schedule_idx
  on production_schedule_items (schedule_id, sort);
-- Phase 5's two-week history on the Item screen, joined to the parent's date.
-- Deliberately NOT denormalising `schedule_date` onto the line: a schedule's
-- date never moves, but a copied column is a second answer waiting to drift.
create index production_schedule_items_item_idx
  on production_schedule_items (item_id);

create trigger trg_production_schedule_items_updated before update
  on production_schedule_items
  for each row execute function set_updated_at();


-- ----------------------------------------------------------------------------
-- v_production_schedule_lines — `sold`, without a column anywhere
-- ----------------------------------------------------------------------------

create view v_production_schedule_lines with (security_invoker = true) as
select
  li.id,
  li.org_id,
  li.schedule_id,
  li.item_id,
  li.item_name,
  li.item_type,
  li.subtype,
  li.finish,
  li.size,
  li.tally_box_size,
  li.tray_capacity,
  li.tray_number,
  li.tray_band,
  li.par,
  li.planned_par,
  li.par_source,
  li.made,
  li.leftover,
  li.note,
  li.unit_cost,
  li.unit_price,
  li.cost_unresolved,
  li.costed_at,
  li.sort,
  s.schedule_date,
  s.location_id,
  s.kitchen_location_id,
  s.source,
  s.title       as schedule_title,
  s.generated_at,
  s.printed_at,
  case when li.made is null then null
       else li.made - coalesce(li.leftover, 0) end as sold,
  (li.made is not null or li.leftover is not null)  as has_actuals
from production_schedule_items li
join production_schedules s on s.id = li.schedule_id;

grant select on v_production_schedule_lines to authenticated;


-- ----------------------------------------------------------------------------
-- v_production_plan_days — the menu at WEEKDAY grain
-- ----------------------------------------------------------------------------
--
-- Everything a plan says, unrolled to one row per (plan, tray, weekday, item),
-- with the par resolved out of 009's seven-slot array and `v_order_guide`'s
-- composed-boolean idiom on top: `is_makeable` as an AND of the active cascade,
-- and `hidden_reason` as a case naming WHICH condition failed.
--
-- That reason column is not decoration. `production_item_locations` rows are
-- sparse — most (item, location) pairs have no par row at all — so without it
-- the first real generation produces a nearly empty schedule and looks like the
-- generator is broken. It is the most likely day-one failure in this phase.
--
-- This is also what decision 9's read-only COMBINED per-shop matrix renders:
-- several active plans overlaid so the whole display case is visible at once
-- (the view that shows tray 07 empty on Tuesdays).

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

  -- Slot n = weekday n, ISO, 1 = Monday. The ONE place a production par comes
  -- from; getting the subscript wrong by one silently shifts a whole shop's
  -- menu by a day.
  il.par_by_weekday[s.weekday] as planned_par,

  (p.is_active
     and i.is_active
     and coalesce(il.is_active, true)
     and il.par_by_weekday[s.weekday] is not null
     and il.par_by_weekday[s.weekday] > 0)       as is_makeable,

  case
    when not p.is_active                      then 'plan inactive'
    when not i.is_active                      then 'item inactive'
    when not coalesce(il.is_active, true)     then 'item inactive at this shop'
    when il.id is null                        then 'no par row at this shop'
    when il.par_by_weekday is null            then 'no pars set'
    when il.par_by_weekday[s.weekday] is null then 'no par this weekday'
    when il.par_by_weekday[s.weekday] = 0     then 'par is zero'
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
-- production_day(location, date) — the derived day
-- ----------------------------------------------------------------------------
--
-- SECURITY INVOKER (the default): RLS on every underlying table is the org
-- scope, so this can't read anything its caller couldn't read directly.
--
-- Every column reference in the body is QUALIFIED, deliberately. A `returns
-- table` function's output names are visible inside its own body, so an
-- unqualified `item_id` is ambiguous and Postgres refuses it.

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
    (array_agg(v.hidden_reason) filter (where v.hidden_reason is not null))[1] as hidden_reason,
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
    -- An override is an explicit human statement and outranks "no par row at
    -- this shop". That is the mechanism that lets you add an item nobody ever
    -- set a par for.
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
  -- SUPPRESSED means a human said no: an explicit zero, or the losing side of a
  -- split override. An item with no par row is NOT suppressed — nobody has said
  -- anything about it, which is what `hidden_reason` is for. Both end up with
  -- par 0 and neither generates a line, but they are different sentences and a
  -- screen has to be able to tell them apart.
  f.has_override and f.par = 0,
  f.hidden_reason
from folded f
order by f.tray_sort nulls last, f.tray_number nulls last, f.item_name;
$$;

revoke all on function production_day(uuid, date) from public;
revoke all on function production_day(uuid, date) from anon;
grant execute on function production_day(uuid, date) to authenticated;


-- ----------------------------------------------------------------------------
-- generate_production_schedules — decision 7, one explicit human act
-- ----------------------------------------------------------------------------
--
-- No nightly cron. Generation is part of the supervisor's closing routine, and
-- the dialog takes a start date, a number of days and a location set because
-- generating AHEAD is a real workflow: closed days, long weekends, a supervisor
-- who won't be in. Ahead-generation composes with par overrides instead of
-- conflicting with them, which is the whole of decision 6.
--
-- SECURITY INVOKER, as 013: every insert flows through this table's own RLS, so
-- this cannot write anything its caller couldn't write directly. The explicit
-- role check up front just turns a bare RLS violation into a readable error.
--
-- NEVER SILENTLY REPLACE. Three levels, each costing an explicit human act:
--   1. default          — an existing plan schedule is SKIPPED and reported,
--                         not errored, so a 14-day run that overlaps three
--                         generated days still writes the other eleven.
--   2. p_replace        — replaces lines IN PLACE, keeping the schedule id,
--                         `generated_*` and `printed_at`, bumping
--                         `regenerated_*`.
--   3. p_allow_actuals  — required on top of p_replace when any target line
--                         carries made/leftover; otherwise it RAISES.
--
-- Replacement is an UPSERT on (schedule_id, item_id), not a delete-and-insert,
-- and that is what carries a supervisor's typing forward for free. Two kinds of
-- line survive a regeneration deliberately: one carrying ACTUALS, and one a
-- human ADDED by hand (`par_source = 'manual'`). Losing either because the plan
-- changed is precisely the failure decision 6 argues against.
--
-- Generation only ever touches `source = 'plan'` rows. A special-order or
-- manual schedule is never read, replaced or deleted by this function.

create or replace function generate_production_schedules(
  p_start                 date,
  p_days                  integer,
  p_location_ids          uuid[],
  p_ignore_special_orders boolean default false,
  p_replace               boolean default false,
  p_allow_actuals         boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_ids   uuid[];
  v_org_id    uuid;
  v_loc_id    uuid;
  v_kitchen   uuid;
  v_date      date;
  v_offset    integer;
  v_sched_id  uuid;
  v_existing  uuid;
  v_lines     integer;
  v_before    integer;
  v_par_total numeric;
  v_actuals   integer;
  v_carried   integer;
  v_lost      integer;
  v_manual    integer;
  v_loc_code  text;
  v_kit_code  text;
  v_created   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_replaced  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  w           record;
begin
  if p_location_ids is null or array_length(p_location_ids, 1) is null then
    raise exception 'no locations given';
  end if;

  -- Generating ahead is the workflow; ten years is a typo.
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'number of days must be between 1 and 31 (got %)', p_days;
  end if;

  if p_start is null then
    raise exception 'no start date given';
  end if;

  -- The org is DERIVED from the scope argument, never passed in (013). This
  -- takes an array where 013 took one location, so the cross-org case has to be
  -- refused rather than assumed.
  select array_agg(distinct l.org_id) into v_org_ids
    from locations l where l.id = any(p_location_ids);

  if v_org_ids is null then
    raise exception 'unknown location(s)';
  end if;
  if array_length(v_org_ids, 1) > 1 then
    raise exception 'locations span more than one organisation';
  end if;
  v_org_id := v_org_ids[1];

  if not user_has_role(v_org_id, array['owner','admin','purchaser']) then
    raise exception 'insufficient role to generate production schedules';
  end if;

  foreach v_loc_id in array p_location_ids loop
    select l.code into v_loc_code from locations l where l.id = v_loc_id;

    for v_offset in 0 .. p_days - 1 loop
      v_date := p_start + v_offset;

      -- Everything the day has to say about itself, once, for the receipt. The
      -- under-minimum-vendor pattern: name what happened and let them through.
      --
      -- GROUPED BY ITEM, not read row by row. A split item has one row per
      -- kitchen and both carry `kitchen_split`, so the raw rows produce the
      -- same warning twice — and a receipt that says everything twice is one
      -- nobody reads. The par is summed across kitchens for the same reason:
      -- "pars summed to 30" is a claim about the display case, which is where
      -- the reader's eye is.
      for w in
        select d.item_name                                      as item_name,
               max(d.plan_count)                                as plan_count,
               bool_or(d.kitchen_assumed)                       as kitchen_assumed,
               bool_or(d.kitchen_split)                         as kitchen_split,
               (array_agg(d.hidden_reason)
                  filter (where d.hidden_reason is not null))[1] as hidden_reason,
               sum(d.par)                                       as par
          from production_day(v_loc_id, v_date) d
         group by d.item_name
      loop
        if w.plan_count > 1 then
          v_warnings := v_warnings || jsonb_build_object(
            'kind', 'overlapping_plans', 'date', v_date, 'location_code', v_loc_code,
            'item_name', w.item_name,
            'detail', format('carried by %s active plans; pars summed to %s',
                             w.plan_count, w.par));
        end if;
        if w.kitchen_split then
          v_warnings := v_warnings || jsonb_build_object(
            'kind', 'kitchen_split_override', 'date', v_date, 'location_code', v_loc_code,
            'item_name', w.item_name,
            'detail', 'made in more than one kitchen; the override went to the largest');
        end if;
        if w.kitchen_assumed then
          v_warnings := v_warnings || jsonb_build_object(
            'kind', 'kitchen_assumed', 'date', v_date, 'location_code', v_loc_code,
            'item_name', w.item_name,
            'detail', 'no kitchen on the plan; assumed this shop makes it');
        end if;
        if w.hidden_reason is not null then
          v_warnings := v_warnings || jsonb_build_object(
            'kind', 'not_made', 'date', v_date, 'location_code', v_loc_code,
            'item_name', w.item_name, 'detail', w.hidden_reason);
        end if;
      end loop;

      -- The kitchen is NOT a parameter: the DAY tells you which kitchens are
      -- involved, because it is the union of the active plans (decision 9).
      for v_kitchen in
        select distinct d.kitchen_location_id
          from production_day(v_loc_id, v_date) d
         where d.par > 0 and not d.is_suppressed
      loop
        select l.code into v_kit_code from locations l where l.id = v_kitchen;

        select s.id into v_existing
          from production_schedules s
         where s.location_id = v_loc_id
           and s.schedule_date = v_date
           and s.kitchen_location_id = v_kitchen
           and s.source = 'plan';

        -- ------------------------------------------------------------------
        -- Guard 1 — exists, and we were not asked to replace
        if v_existing is not null and not p_replace then
          select count(*), count(*) filter (where li.made is not null
                                               or li.leftover is not null)
            into v_lines, v_actuals
            from production_schedule_items li where li.schedule_id = v_existing;

          v_skipped := v_skipped || jsonb_build_object(
            'schedule_id', v_existing, 'date', v_date,
            'location_id', v_loc_id, 'location_code', v_loc_code,
            'kitchen_location_id', v_kitchen, 'kitchen_code', v_kit_code,
            'reason', 'exists', 'line_count', v_lines,
            'has_actuals', v_actuals > 0);
          continue;
        end if;

        -- ------------------------------------------------------------------
        -- Guard 3 — actuals are somebody's counting, not our arithmetic
        if v_existing is not null then
          select count(*) into v_actuals
            from production_schedule_items li
           where li.schedule_id = v_existing
             and (li.made is not null or li.leftover is not null);

          if v_actuals > 0 and not p_allow_actuals then
            raise exception
              'the % schedule for % at % already has counted quantities on % line(s); regenerating it needs to be allowed explicitly',
              v_date, v_loc_code, v_kit_code, v_actuals;
          end if;
        end if;

        if v_existing is null then
          insert into production_schedules
            (org_id, schedule_date, location_id, kitchen_location_id,
             source, generated_by, ignored_special_orders)
          values
            (v_org_id, v_date, v_loc_id, v_kitchen,
             'plan', auth.uid(), coalesce(p_ignore_special_orders, false))
          returning id into v_sched_id;
          v_before := 0;
        else
          v_sched_id := v_existing;
          select count(*) into v_before
            from production_schedule_items li where li.schedule_id = v_sched_id;

          -- A line the day no longer carries goes, UNLESS a human put it there
          -- by hand. `par_source = 'manual'` is a decision, and a regeneration
          -- is a request for the plan's answer — not permission to discard one.
          select
            count(*) filter (where li.made is not null or li.leftover is not null)
            into v_lost
            from production_schedule_items li
           where li.schedule_id = v_sched_id
             and li.par_source <> 'manual'
             and not exists (
               select 1 from production_day(v_loc_id, v_date) d
                where d.item_id = li.item_id
                  and d.kitchen_location_id = v_kitchen
                  and d.par > 0 and not d.is_suppressed);

          delete from production_schedule_items li
           where li.schedule_id = v_sched_id
             and li.par_source <> 'manual'
             and not exists (
               select 1 from production_day(v_loc_id, v_date) d
                where d.item_id = li.item_id
                  and d.kitchen_location_id = v_kitchen
                  and d.par > 0 and not d.is_suppressed);

          update production_schedules s
             set regenerated_by = auth.uid(),
                 regenerated_at = now(),
                 regeneration_count = s.regeneration_count + 1,
                 ignored_special_orders = coalesce(p_ignore_special_orders, false)
           where s.id = v_sched_id;
        end if;

        -- The lines. `do update` deliberately leaves made / leftover / note and
        -- the four cost columns alone: the par is ours to recompute, the count
        -- and the money are not.
        insert into production_schedule_items
          (org_id, schedule_id, item_id, item_name, item_type, subtype, finish,
           size, tally_box_size, tray_capacity, tray_number, tray_band, par,
           planned_par, par_source, sort)
        select
          v_org_id, v_sched_id, d.item_id, d.item_name, d.item_type, d.subtype,
          d.finish, d.size, d.tally_box_size, d.tray_capacity, d.tray_number,
          d.tray_band, d.par, d.planned_par, d.par_source,
          row_number() over (order by d.tray_sort nulls last,
                                      d.tray_number nulls last,
                                      d.item_name)
        from production_day(v_loc_id, v_date) d
        where d.kitchen_location_id = v_kitchen
          and d.par > 0
          and not d.is_suppressed
        on conflict (schedule_id, item_id) do update set
          item_name      = excluded.item_name,
          item_type      = excluded.item_type,
          subtype        = excluded.subtype,
          finish         = excluded.finish,
          size           = excluded.size,
          tally_box_size = excluded.tally_box_size,
          tray_capacity  = excluded.tray_capacity,
          tray_number    = excluded.tray_number,
          tray_band      = excluded.tray_band,
          par            = excluded.par,
          planned_par    = excluded.planned_par,
          par_source     = excluded.par_source,
          sort           = excluded.sort;

        select count(*),
               coalesce(sum(li.par), 0),
               count(*) filter (where li.made is not null or li.leftover is not null),
               count(*) filter (where li.par_source = 'manual')
          into v_lines, v_par_total, v_carried, v_manual
          from production_schedule_items li where li.schedule_id = v_sched_id;

        -- No lines at all → no document. 013's "no will-order lines → no PO,
        -- and no sequence number burned."
        if v_lines = 0 then
          if v_existing is null then
            delete from production_schedules s where s.id = v_sched_id;
          end if;
          continue;
        end if;

        if v_existing is null then
          v_created := v_created || jsonb_build_object(
            'schedule_id', v_sched_id, 'date', v_date,
            'location_id', v_loc_id, 'location_code', v_loc_code,
            'kitchen_location_id', v_kitchen, 'kitchen_code', v_kit_code,
            'line_count', v_lines, 'par_total', v_par_total);
        else
          v_replaced := v_replaced || jsonb_build_object(
            'schedule_id', v_sched_id, 'date', v_date,
            'location_id', v_loc_id, 'location_code', v_loc_code,
            'kitchen_location_id', v_kitchen, 'kitchen_code', v_kit_code,
            'lines_before', v_before, 'lines_after', v_lines,
            'actuals_carried', v_carried, 'actuals_lost', coalesce(v_lost, 0),
            'manual_kept', v_manual);
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'start',    p_start,
    'days',     p_days,
    'created',  v_created,
    'skipped',  v_skipped,
    'replaced', v_replaced,
    'warnings', v_warnings
  );
end $$;

revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from public;
revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from anon;
grant execute on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- RLS — membership reads, purchaser+ writes, as 036 / 037 / 039
-- ----------------------------------------------------------------------------
--
-- Same posture throughout the module: production is operational, not
-- HR-sensitive, and anyone rostered to make a thing needs to read what the day
-- asks for. Writing is catalog-class work.
--
-- Two deliberate NON-decisions, both flagged rather than made silently:
--
--   * `production_par_overrides` arguably wants SUPERVISOR writes — bumping
--     Saturday is closing-routine work, not catalog work. It ships at
--     purchaser+ because 036's rule stands: a write policy with no writer is a
--     policy nobody has tested. Widening it later is one line.
--
--   * Phase 5's `made` / `leftover` will need COLUMN-scoped writes. RLS filters
--     rows, not columns, so a supervisor UPDATE policy here would also let them
--     edit `par` and the cost snapshot. That is 029's `report_pooled_tips`
--     shape — a definer function naming exactly those columns — and it belongs
--     in phase 5, not in a loosened policy here.

alter table production_element_days enable row level security;
alter table production_par_overrides enable row level security;
alter table production_schedules enable row level security;
alter table production_schedule_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'production_element_days',
    'production_par_overrides',
    'production_schedules',
    'production_schedule_items'
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

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_schedules;      → 0. Nothing migrates.
--   select count(*) from production_element_days;   → ~1,190 after the loader
--     (1,201 source rows, less the handful the transform merges and names).
--   -- the batch label must NOT have been coerced to a number:
--   select count(*) from production_element_days where batch_label ~ '[A-Za-z]';
--     → non-zero. "Caramel" and "Blueberry" are real batches.
--
--   -- the derived day answers for a shop with a plan, and names what it can't
--   -- make rather than silently dropping it:
--   select item_name, par, par_source, hidden_reason
--     from production_day((select id from locations where code = 'DF02'),
--                         current_date);
--
--   -- anon must be refused BOTH functions (002's lesson — revoking from PUBLIC
--   -- does not undo Supabase's default anon grant):
--   set role anon;
--   select * from production_day(null, current_date);   → permission denied
--   reset role;
