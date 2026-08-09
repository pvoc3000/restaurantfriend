-- ============================================================================
-- restaurantfriend — migration 044 · production phase 5, ACTUALS
--
-- Phase 4 committed the day. This is the other half of every document it
-- produces: what actually happened.
--
--   * ITEM actuals — `made` / `leftover` per schedule line. 040 created those
--     columns and nothing has ever written them. `sold` stays derived.
--   * ELEMENT actuals — `production_batches`, the last unbuilt table in the
--     module. One row per making of an element.
--
-- Depends on 040 (schedules, element days), 036 (elements, recipe versions),
-- 020 (employees), 018 (the storage helper). Run in the Supabase SQL editor.
-- NOT rerunnable — the bucket insert is guarded, the sequence is not.
--
-- ---------------------------------------------------------------------------
-- THE ONE THING TO UNDERSTAND BEFORE READING THE REST
--
-- This file gates two writes in two DIFFERENT ways, and it looks inconsistent
-- until you see which kind of rule each one is.
--
--   A SCHEDULE LINE is a purchaser's document with two supervisor-writable
--   CELLS. "A supervisor may set made and leftover and nothing else" is a
--   COLUMN rule, and RLS filters ROWS — a supervisor UPDATE policy on
--   production_schedule_items would also hand them `par`, `par_source`,
--   `planned_par` and the whole cost snapshot. So it is a definer function
--   naming exactly the safe columns: 029's `report_pooled_tips` shape, which
--   040's own RLS block already named as what this phase needs.
--
--   A BATCH is a supervisor's OWN record. Every column on it is theirs. That
--   is a ROW rule, so it is an ordinary policy — and `production_batches` is
--   the first table in this schema whose write policy names `supervisor`,
--   which 020 predicted in those words.
--
-- ---------------------------------------------------------------------------
-- AND ONE CORRECTION TO THE BRIEF, because it inverts an argument
--
-- FileMaker's batch log carries 4,437 rows still sitting at `1 TO DO` out of
-- 14,103, and a first reading of that says pre-generate-and-protect — the
-- disease decision 6 killed on the schedule side. It is not. Mark, 2026-08-09:
-- an employee GENERATES the week's batch log from the weekly element schedule
-- and works the list down, so `to_do` is the default status of a generated
-- CHECKLIST. Decision 6 is about a document defended against overwriting;
-- nothing here is defended, and re-running skips and reports.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Who counted, and when
-- ----------------------------------------------------------------------------
-- 029 put `reported_by` / `reported_at` beside `reported_cents` for this
-- reason: a number somebody typed at 1am wants an author. Without it the
-- schedules list can say "12 of 37 counted" and never who.
--
-- 040's regeneration upsert names its SET columns explicitly, so these are
-- carried forward untouched by a replace — the same property `made` and
-- `leftover` already rely on.

alter table production_schedule_items
  add column counted_by uuid references auth.users(id),
  add column counted_at timestamptz;


-- ----------------------------------------------------------------------------
-- 2. v_production_schedule_lines, recreated
-- ----------------------------------------------------------------------------
-- 043's lesson, and the easiest thing in this file to get wrong: neither
-- `security_invoker` nor the grant survives a drop. Both are restated below.
--
-- This view is the SOLE definition of `sold`. It had no reader in web/src
-- until this phase; from here the schedule record and the item history both
-- select it, so there is no TypeScript twin to drift from and one place for
-- the POS seam the brief leaves open.

drop view if exists v_production_schedule_lines;

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
  li.counted_by,
  li.counted_at,
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
-- 3. set_schedule_actual — a supervisor writes ONE column
-- ----------------------------------------------------------------------------
-- See the header. Definer, so the body re-checks everything RLS would have.
--
-- It takes a COLUMN NAME rather than both values, and that is deliberate: a
-- pair-writing function would have to be handed the sibling cell's currently
-- rendered value, so editing `made` could resurrect a `leftover` somebody had
-- just cleared. One column per call has no lost-update surface at all.
--
-- The whitelist is a `case when` inside the UPDATE, never dynamic SQL. It is
-- the entire security property of this function: `par`, `par_source`,
-- `unit_cost` and `costed_at` are unreachable from here by construction.

create or replace function public.set_schedule_actual(
  p_line_id uuid,
  p_column  text,
  p_value   numeric
)
returns production_schedule_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row production_schedule_items;
begin
  if p_column is null or p_column not in ('made', 'leftover') then
    raise exception
      'set_schedule_actual writes made or leftover, not %', coalesce(p_column, 'null');
  end if;

  -- Mirrors 040's own CHECK, so the refusal is a sentence rather than a
  -- constraint name arriving in a cell.
  if p_value is not null and p_value < 0 then
    raise exception 'A count cannot be negative';
  end if;

  select li.org_id into v_org
    from production_schedule_items li where li.id = p_line_id;

  if v_org is null then
    raise exception 'No such schedule line';
  end if;

  -- What the SELECT policy would have allowed.
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  -- The new rule this function exists for: supervisor, on top of the set the
  -- table's own UPDATE policy names.
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to record a count';
  end if;

  update production_schedule_items
     set made     = case when p_column = 'made'     then p_value else made     end,
         leftover = case when p_column = 'leftover' then p_value else leftover end,

         -- Cleared only when this write empties the LAST of the two: `p_value
         -- is null` is this column going, and the case beside it is the
         -- sibling already being gone. Written against the row's own current
         -- values in one statement rather than read-then-write, so two people
         -- counting one line at once cannot lose a number.
         --
         -- It matters that this really does clear: a line reporting an author
         -- for a count that is no longer there cannot be restored to as-found,
         -- which the live walk depends on.
         counted_by = case
           when p_value is null
            and (case when p_column = 'made' then leftover else made end) is null
           then null else auth.uid() end,
         counted_at = case
           when p_value is null
            and (case when p_column = 'made' then leftover else made end) is null
           then null else now() end
   where id = p_line_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_schedule_actual(uuid, text, numeric) from public;
revoke all on function public.set_schedule_actual(uuid, text, numeric) from anon;
grant execute on function public.set_schedule_actual(uuid, text, numeric) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. mark_schedule_printed — the same problem, one table up
-- ----------------------------------------------------------------------------
-- `printed_at` lives on production_schedules, whose UPDATE policy is
-- purchaser+. A supervisor pressing Print would therefore match ZERO ROWS and
-- get NO ERROR — the identical silent failure this phase exists to remove,
-- and printing the night's packet is the same closing routine the counts are
-- entered in (Mark, 2026-08-09).
--
-- Two columns, and nothing else on the schedule is reachable from here.

create or replace function public.mark_schedule_printed(p_schedule_id uuid)
returns production_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row production_schedules;
begin
  select s.org_id into v_org
    from production_schedules s where s.id = p_schedule_id;

  if v_org is null then
    raise exception 'No such schedule';
  end if;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to mark a schedule printed';
  end if;

  update production_schedules
     set printed_at = now(),
         printed_by = auth.uid()
   where id = p_schedule_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.mark_schedule_printed(uuid) from public;
revoke all on function public.mark_schedule_printed(uuid) from anon;
grant execute on function public.mark_schedule_printed(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. production_batches — one row per making of an element
-- ----------------------------------------------------------------------------
-- The brief's model sketch reads "on-hand (count × size × unit), yield" as
-- though yield were a scalar. Measured on the real 14,103-row FMP log it is
-- not: `Batch_Yield_Qty` / `_Amount` / `_Unit` are filled 99.4 / 97.9 / 99.6%
-- and the calculation field prints "2x 22qt". So yield is a TRIPLE, like
-- on-hand and like the par — the same count × size × unit shape 036 already
-- parsed FileMaker's free text ("6x 1.5 GAL", "10 BAGS") into, and the only
-- form that can be multiplied.
--
-- Four amounts and they are four different facts, worth stating once:
--   batch_amount  what the schedule said to make ("2 X", "50 #")
--   par_*         what this kitchen keeps on hand — the ASK
--   on_hand_*     what was there before you started
--   yield_*       what came out — the ANSWER
-- FMP kept all four and its own brief calls that data discipline the module's
-- best habit: the ask and the answer in one record.

create table production_batches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- RESTRICT on both (no on-delete clause), production_schedules' idiom: a
  -- batch is a DOCUMENT about work that happened, and deleting a catalog row
  -- must not take last month's record of a night with it. Contrast
  -- production_element_days, which cascades because it is a rhythm.
  element_id  uuid not null references production_elements(id),
  location_id uuid not null references locations(id),   -- the KITCHEN

  -- Which scheduled batch this is, when it came from the weekly schedule.
  -- Null for a freehand one-off — including anything AB- or DONUT-class, which
  -- generation never produces.
  --
  -- This is also what makes "already generated" answerable without guessing at
  -- a natural tuple. It has to be: 39 of 14,061 FMP (element, location, date,
  -- order) tuples collide, and element 1126 holds six unlabelled Tuesday
  -- batches at DF01 carrying different amounts. The batch NUMBER is identity;
  -- this is provenance.
  element_day_id uuid references production_element_days(id) on delete set null,

  batch_date   date not null,
  batch_number text not null,

  -- WHICH batch of the day. A LABEL with a sort beside it, never an integer:
  -- 040 measured 17 distinct values including "Blueberry", "Caramel" and "x2".
  batch_label text,
  sort        integer,

  -- 040's verbatim vocabulary — a mix of shift names and sheet names
  -- (MORNING · BAKER · FRYER · AB · OVERNIGHT · EVENING), deliberately not
  -- normalised there and not normalised here. Mark decides.
  shift       text,

  -- A BATCH NAMES TWO PEOPLE (Mark, 2026-08-09).
  --
  -- `created_by` is the signed-in app user — the audit trail, and the only one
  -- of the two that is always knowable. `operator_employee_id` is who actually
  -- made it, which is an employee and frequently not an app user at all: the
  -- baker on the overnight has an HR record and no login.
  --
  -- RESTRICT rather than set null, because 023 lets an owner delete an
  -- employee record and that must not quietly rewrite who made something.
  -- Deleting a person who ever ran a batch is refused, which is the same
  -- answer 001 gives for anyone who ever changed a price.
  operator_employee_id uuid references employees(id),
  created_by           uuid references auth.users(id),

  -- Set null rather than restrict: losing a version must not lose the batch.
  recipe_version_id    uuid references production_recipe_versions(id) on delete set null,
  -- SNAPSHOT. 036 makes `version_label` editable text, so a rename must not
  -- rewrite what last month's batch says it followed — 038's rule, one table
  -- over.
  recipe_version_label text,

  -- WHICH SCALE COLUMN was run. A SLOT NUMBER, not a label — 042's
  -- `cost_column` argument verbatim: labels are editable content, so storing
  -- the label alone would let renaming a batch size move which one a finished
  -- batch claims to have been. The label rides along as the snapshot.
  scale_index smallint check (scale_index is null or scale_index between 0 and 7),
  scale_label text,

  -- What the weekly schedule asked for — FMP's `batchAmount_n` ×
  -- `batchPortion_t`, carried across from the element day at generation.
  batch_amount numeric(12,3),
  batch_unit   text,

  par_count numeric(10,3),
  par_size  numeric(10,3),
  par_unit  text,

  on_hand_count numeric(10,3),
  on_hand_size  numeric(10,3),
  on_hand_unit  text,

  yield_count numeric(10,3),
  yield_size  numeric(10,3),
  yield_unit  text,

  -- FMP's five, with its sort prefixes stripped (036's "05 Topping" lesson).
  -- DEFAULT 'to_do' because the ordinary way a row appears is generation, and
  -- a generated row IS a to-do. The freehand New batch dialog sends
  -- 'complete': you are recording something you just made.
  status text not null default 'to_do'
    check (status in ('to_do', 'in_progress', 'complete', 'skipped', 'test')),

  notes text,

  -- {org_id}/{batch_id}/{uuid}.{ext} — org first, so the storage policies
  -- authorise from the path alone with no join. Consequence for the UI: the
  -- row must exist before a photo can go up, which is why the photo lives on
  -- the record and not on the create dialog.
  photo_path text,
  photo_name text,
  photo_type text,
  photo_size bigint,

  -- THE COST OF THE BATCH — decision 11's own carve-out (costing derives live;
  -- a snapshot happens exactly where a DOCUMENT needs one), and Mark's call on
  -- 2026-08-09.
  --
  -- Left NULL by the generator and written by the APP, for the reason 040
  -- states about its own four: the resolver is lib/productionCost — the whole
  -- graph, a cycle guard, lib/units doing the conversion — and a SQL twin of
  -- it would be decision 2's disease in a new form. A generated batch has not
  -- run yet, so the stamp lands when it is marked complete.
  --
  -- `cost_unresolved` is what the "AT LEAST" is hiding. Storing the figure
  -- without the count would freeze a LOWER BOUND as though it were a number,
  -- and 209 elements are still unpriced.
  unit_cost       numeric(12,4),
  cost_unresolved integer,
  costed_at       timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, batch_number)
);

-- One generated batch per scheduled batch per date. PARTIAL, so it constrains
-- generation without saying anything at all about freehand rows — you may log
-- three unplanned batches of the same glaze on one day, which happens.
create unique index production_batches_generated_key
  on production_batches (element_day_id, batch_date)
  where element_day_id is not null;

create index production_batches_day_idx
  on production_batches (org_id, batch_date desc, location_id);

-- The element record's "Recent batches" block, and phase 5's efficiency
-- questions after it.
create index production_batches_element_idx
  on production_batches (element_id, batch_date desc);

create trigger trg_production_batches_updated before update
  on production_batches
  for each row execute function set_updated_at();


-- ----------------------------------------------------------------------------
-- 6. RLS — the first write policy in this schema to name `supervisor`
-- ----------------------------------------------------------------------------
-- See the header for why this is a policy where §3 is a function.
--
-- DELETE stays purchaser+, and the line is drawn where it is on purpose:
-- correcting a batch is EDITING it, which a supervisor does all shift. Erasing
-- the record that a batch happened is a different act.

alter table production_batches enable row level security;

create policy production_batches_select on production_batches for select
  using (org_id in (select user_org_ids()));

create policy production_batches_insert on production_batches for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy production_batches_update on production_batches for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy production_batches_delete on production_batches for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']));


-- ----------------------------------------------------------------------------
-- 7. Batch numbering
-- ----------------------------------------------------------------------------
-- 006's idiom, with one honest difference: 006 computes its seed from live
-- data because 13 years of purchase orders existed to continue. Nothing
-- migrates here, so the seed is the literal from the brief's answered question
-- 1 — and it is provably clear rather than merely chosen, because the FMP
-- export's own maximum batch number is 19,541 over 14,103 all-distinct values.
--
-- A real sequence rather than max()+1 for 006's reason: two bakers logging at
-- once would read the same max and collide on `unique (org_id, batch_number)`,
-- and here that would fail mid-generation, halfway through a week.

create sequence if not exists production_batch_number_seq start with 30000;

/**
 * Next batch number at a kitchen.
 *
 * security definer so it can advance the sequence, which RLS doesn't cover —
 * and because of that it re-checks what RLS would have. Supervisor is in the
 * set: logging a batch is exactly what the role exists for.
 *
 * Returns bare digits as text, which is what FileMaker's own numbers are. Text
 * rather than integer because 006 set that precedent and because a prefix
 * later is then a format change rather than a migration.
 */
create or replace function public.next_batch_number(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select l.org_id into v_org from locations l where l.id = p_location_id;

  if v_org is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to number a batch';
  end if;

  return nextval('production_batch_number_seq')::text;
end;
$$;

revoke all on function public.next_batch_number(uuid) from public;
revoke all on function public.next_batch_number(uuid) from anon;
grant execute on function public.next_batch_number(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. generate_production_batches — the week's work list
-- ----------------------------------------------------------------------------
-- Mark, 2026-08-09: an employee generates the week's batch log for a kitchen
-- from the WEEKLY-class element schedule, then works it down.
--
-- SECURITY INVOKER, 013's precedent: every insert flows through the policy in
-- §6, which is also what lets a supervisor run this. The sequence is the one
-- thing invoker can't reach, so numbers come from §7's definer.
--
-- SOURCE IS `schedule_class = 'WEEKLY'` AND NOTHING ELSE — 159 of 470 elements.
-- AB (49), DONUT (18) and HIDDEN (6) are not generated and reach the log only
-- by hand. That is Mark's rule, and it is the one thing here most likely to
-- look like a bug when a donut element never appears.
--
-- ONE ROW OF production_element_days IS ONE BATCH, not one element-day: Raised
-- Dough at DF01 on a Monday morning is four rows labelled 1 · 2 · 3 · 5. A
-- reading that grouped by element would generate one batch where four are due.
--
-- 040's guards, in 040's order, so there is one rule to learn across both
-- generators: an existing batch is SKIPPED and named; `p_replace` is required
-- to touch it; and a batch that already carries a YIELD raises unless
-- replacement is explicitly allowed.
--
-- IT NEVER DELETES. 040 drops a line the day no longer carries, because a
-- schedule must equal what the plans say. A batch log is a checklist somebody
-- is working, so an element that has since left the weekly schedule keeps its
-- row and gets skipped by hand. Least-destructive, and it is named in the
-- receipt's warnings rather than being silent.

create or replace function public.generate_production_batches(
  p_location_id  uuid,
  p_week_start   date,
  p_replace      boolean default false,
  p_allow_yields boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org       uuid;
  v_loc_code  text;
  v_monday    date;
  v_date      date;
  v_offset    integer;
  v_existing  uuid;
  v_yield     integer;
  v_number    text;
  -- Scalars, not `record`. Most elements have no row in
  -- production_element_locations and many have no master version, so these
  -- lookups routinely find nothing — and a record variable's behaviour on a
  -- no-row SELECT INTO is exactly the sort of thing to not depend on.
  v_version_id    uuid;
  v_version_label text;
  v_par_count numeric(10,3);
  v_par_size  numeric(10,3);
  v_par_unit  text;
  v_created   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_replaced  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  d           record;
  w           record;
begin
  if p_week_start is null then
    raise exception 'no week given';
  end if;

  select l.org_id, l.code into v_org, v_loc_code
    from locations l where l.id = p_location_id;

  if v_org is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to generate a batch log';
  end if;

  -- NORMALISED to the ISO Monday rather than refused. A date input hands back
  -- whatever day was clicked, and "that isn't a Monday" is a worse answer than
  -- generating the week it falls in — so the receipt reports the week actually
  -- generated and the caller shows it.
  v_monday := p_week_start - (extract(isodow from p_week_start)::integer - 1);

  -- Named before the loop, once. An element on the rhythm with no master
  -- recipe still generates — the batch is real and somebody will make it from
  -- memory — but it is the thing a baker most wants to hear about, and a
  -- receipt that says it per day would say it seven times.
  for w in
    select distinct e.name as element_name
      from production_element_days ed
      join production_elements e on e.id = ed.element_id
     where ed.location_id = p_location_id
       and not ed.is_excluded
       and e.is_active
       and e.schedule_class = 'WEEKLY'
       and e.kind = 'made'
       and not exists (
         select 1
           from production_recipe_versions v
           join production_recipes r on r.id = v.recipe_id
          where r.element_id = e.id and v.is_master
       )
     order by e.name
  loop
    v_warnings := v_warnings || jsonb_build_object(
      'kind', 'no_master_recipe', 'element_name', w.element_name);
  end loop;

  for v_offset in 0 .. 6 loop
    v_date := v_monday + v_offset;

    for d in
      select ed.id            as element_day_id,
             ed.element_id,
             ed.shift,
             ed.batch_label,
             ed.sort,
             ed.batch_amount,
             ed.batch_unit,
             e.name           as element_name
        from production_element_days ed
        join production_elements e on e.id = ed.element_id
       where ed.location_id = p_location_id
         and ed.weekday     = extract(isodow from v_date)::smallint
         and not ed.is_excluded
         and e.is_active
         and e.schedule_class = 'WEEKLY'
       order by ed.sort nulls last, ed.batch_label nulls last, ed.id
    loop
      select b.id into v_existing
        from production_batches b
       where b.element_day_id = d.element_day_id
         and b.batch_date     = v_date;

      -- --------------------------------------------------------------------
      -- Guard 1 — exists, and we were not asked to replace
      if v_existing is not null and not p_replace then
        v_skipped := v_skipped || jsonb_build_object(
          'batch_id', v_existing, 'date', v_date,
          'element_name', d.element_name, 'batch_label', d.batch_label,
          'reason', 'exists');
        continue;
      end if;

      -- --------------------------------------------------------------------
      -- Guard 2 — a yield is somebody's measuring, not our arithmetic
      if v_existing is not null then
        select count(*) into v_yield
          from production_batches b
         where b.id = v_existing and b.yield_count is not null;

        if v_yield > 0 and not p_allow_yields then
          raise exception
            'the % batch of % at % on % already has a recorded yield; regenerating it needs to be allowed explicitly',
            coalesce(d.batch_label, 'unlabelled'), d.element_name, v_loc_code, v_date;
        end if;
      end if;

      -- The stock-up par at THIS kitchen — the ask, snapshotted beside the
      -- answer. 036 parsed FileMaker's free text into these three columns
      -- precisely so it could be carried like this.
      select el.stock_count, el.stock_size, el.stock_unit
        into v_par_count, v_par_size, v_par_unit
        from production_element_locations el
       where el.element_id = d.element_id
         and el.location_id = p_location_id;

      -- The master version, snapshotted by id AND label.
      select v.id, v.version_label
        into v_version_id, v_version_label
        from production_recipe_versions v
        join production_recipes r on r.id = v.recipe_id
       where r.element_id = d.element_id and v.is_master
       limit 1;

      if v_existing is null then
        v_number := public.next_batch_number(p_location_id);

        insert into production_batches (
          org_id, element_id, location_id, element_day_id,
          batch_date, batch_number, batch_label, sort, shift,
          created_by, recipe_version_id, recipe_version_label,
          batch_amount, batch_unit,
          par_count, par_size, par_unit, status)
        values (
          v_org, d.element_id, p_location_id, d.element_day_id,
          v_date, v_number, d.batch_label, d.sort, d.shift,
          auth.uid(), v_version_id, v_version_label,
          d.batch_amount, d.batch_unit,
          v_par_count, v_par_size, v_par_unit, 'to_do');

        v_created := v_created || jsonb_build_object(
          'date', v_date, 'element_name', d.element_name,
          'batch_label', d.batch_label, 'batch_number', v_number,
          'shift', d.shift);
      else
        -- REPLACE refreshes what the schedule says and leaves every measured
        -- thing alone: status, on-hand, yield, notes, photo, operator and the
        -- cost snapshot are all untouched. Replacing is a request for the
        -- schedule's answer, not permission to discard somebody's shift.
        update production_batches
           set batch_label          = d.batch_label,
               sort                 = d.sort,
               shift                = d.shift,
               batch_amount         = d.batch_amount,
               batch_unit           = d.batch_unit,
               par_count            = v_par_count,
               par_size             = v_par_size,
               par_unit             = v_par_unit,
               recipe_version_id    = v_version_id,
               recipe_version_label = v_version_label
         where id = v_existing;

        v_replaced := v_replaced || jsonb_build_object(
          'batch_id', v_existing, 'date', v_date,
          'element_name', d.element_name, 'batch_label', d.batch_label);
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'week_start',    v_monday,
    'location_id',   p_location_id,
    'location_code', v_loc_code,
    'created',       v_created,
    'skipped',       v_skipped,
    'replaced',      v_replaced,
    'warnings',      v_warnings);
end;
$$;

revoke all on function public.generate_production_batches(uuid, date, boolean, boolean) from public;
revoke all on function public.generate_production_batches(uuid, date, boolean, boolean) from anon;
grant execute on function public.generate_production_batches(uuid, date, boolean, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- 9. production_operators — naming who made it, without opening the HR record
-- ----------------------------------------------------------------------------
-- 020 gates `employees` SELECT to owner/admin, on the reasoning that the table
-- carries a home address and a date of birth. A supervisor logging a batch
-- therefore cannot read the one table that knows the baker's name.
--
-- CLAUDE.md 4c anticipated exactly this: "A supervisor phone list and a 'my
-- own record' view are both real future needs and both COLUMN-scoped, so each
-- arrives as a definer function naming the safe columns, never by loosening
-- this." This is the first of them.
--
-- It returns TWO COLUMNS. No phone, no address, no date of birth, no wage, no
-- status detail — a name and the id to write. Named for its one caller rather
-- than something like `employees_for_picker`, because a general name is an
-- invitation for the columns to creep back.

create or replace function public.production_operators(p_location_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select l.org_id into v_org from locations l where l.id = p_location_id;

  if v_org is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to read the operator roster';
  end if;

  return query
    select e.id,
           (coalesce(nullif(btrim(e.nickname), ''), e.first_name)
             || ' ' || e.last_name)::text
      from employees e
     -- Active and new hires. A terminated employee is not somebody you reach
     -- for at 5am, and 417 of 445 rows are terminated.
     where e.org_id = v_org
       and e.status <> 'inactive'
     -- DELIBERATELY NOT filtered by main_location_id. 020 is explicit that the
     -- main location is "where someone mostly works, not a restriction on
     -- where they may work", so filtering would hide the DF01 baker covering
     -- DF02 — which is the shift most likely to need naming.
     order by e.last_name, e.first_name;
end;
$$;

revoke all on function public.production_operators(uuid) from public;
revoke all on function public.production_operators(uuid) from anon;
grant execute on function public.production_operators(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 10. The batch photo bucket
-- ----------------------------------------------------------------------------
-- PRIVATE, like every other bucket here; reads go through short-lived signed
-- URLs minted server-side.
--
-- 018's template rather than 021's. 021 gates READ as well as write because
-- employee documents carry a home address and a signed I-9 — a genuinely
-- different audience. A photograph of a bowl of glaze has the same audience as
-- the recipe it followed, which is 036's own posture: membership reads.
--
-- Its own bucket rather than sharing `recipe-images`, on 041's stated test:
-- the two differ on WRITE. A supervisor may photograph a batch and may not
-- upload a recipe image, and sharing a bucket would tie those two answers
-- together forever.

insert into storage.buckets (id, name, public)
values ('batch-photos', 'batch-photos', false)
on conflict (id) do nothing;

-- `public.storage_folder_org()` comes from 018 — it returns null instead of
-- raising on a non-uuid first segment, so a junk path is refused by the POLICY
-- rather than blowing up with a cast error, and its grants (revoked from
-- public and from anon, granted to authenticated) are already sorted there.
-- Reuse, don't redefine: a second `create or replace` here would silently
-- become the definition 018's, 021's and 041's policies all depend on too.
-- That is also why the policies below need no grant of their own.

create policy batch_photos_object_read on storage.objects for select
  using (
    bucket_id = 'batch-photos'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy batch_photos_object_insert on storage.objects for insert
  with check (
    bucket_id = 'batch-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );

create policy batch_photos_object_update on storage.objects for update
  using (
    bucket_id = 'batch-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );

create policy batch_photos_object_delete on storage.objects for delete
  using (
    bucket_id = 'batch-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_batches;                        → 0
--   select last_value, is_called from production_batch_number_seq;   → 30000, false
--     (is_called false means 30000 has not been handed out yet — the FIRST
--      call to next_batch_number returns 30000, not 30001.)
--
--   select count(*) from production_schedule_items where counted_at is not null;
--                                                                    → 0
--
--   select id, public from storage.buckets where id = 'batch-photos';
--                                                                    → 1 row, false
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'batch_photos%';                          → 4
--
--   select reloptions from pg_class where relname = 'v_production_schedule_lines';
--                                                       → {security_invoker=true}
--   select has_table_privilege('authenticated','v_production_schedule_lines','select');
--                                                                    → true
--
-- And, as `anon`, all four functions must answer "permission denied for
-- function" rather than doing any work:
--   select public.set_schedule_actual('00000000-0000-0000-0000-000000000000','made',1);
--   select public.mark_schedule_printed('00000000-0000-0000-0000-000000000000');
--   select public.next_batch_number('00000000-0000-0000-0000-000000000000');
--   select public.production_operators('00000000-0000-0000-0000-000000000000');
--
-- Note the last three answer from their FIRST statement on a bogus id, so a
-- signed-in probe raises "unknown location" / "No such schedule" without
-- touching anything — the cheap way to prove they exist (CLAUDE.md's rule:
-- probe, don't read the file).
-- ----------------------------------------------------------------------------
