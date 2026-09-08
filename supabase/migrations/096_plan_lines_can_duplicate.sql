-- ============================================================================
-- 096 — A PLAN LINE CAN BE DUPLICATED TOO
-- ============================================================================
--
-- Mark, 2026-09-07: "let's relax the index so plan lines can duplicate too."
--
-- 069's key is `unique (schedule_id, item_id) where par_source <>
-- 'special_order'`, so a schedule could hold two lines of one item only when
-- both came from an order. Everywhere else Duplicate was a command that could
-- only fail, and the screen said so with a disabled menu item.
--
-- ----------------------------------------------------------------------------
-- WHAT THE KEY IS ACTUALLY FOR, WHICH IS NARROWER THAN WHAT IT SAID
-- ----------------------------------------------------------------------------
-- 040 keyed the table because REGENERATION UPSERTS: `on conflict (schedule_id,
-- item_id) do update` needs exactly one row per item to aim at, and without
-- that a second row of one item would double the day's par with nothing
-- noticing. Every word of that is about the rows the GENERATOR writes.
--
-- It has never been about a line a human added. `AddScheduleItems` writes
-- `par_source = 'manual'`, the generator never inserts one, and the
-- delete-stale pass already skips them by name — "a regeneration is a request
-- for the plan's answer, not permission to discard one". A manual row is
-- invisible to the upsert in every respect except the index, which was
-- catching it for no reason of its own.
--
-- So the predicate narrows from "not an order's" to "the generator's":
--
--     where par_source in ('plan', 'override')
--
-- `plan` and `override` are exactly what `production_day` yields and therefore
-- exactly what the insert below writes, so the generator's guarantee is
-- unchanged: one row per item per schedule among the rows it owns, upserted in
-- place, actuals and costs carried. What becomes possible is a SECOND row of
-- that item carrying `manual` — which is what Duplicate now writes.
--
-- ----------------------------------------------------------------------------
-- THE CONSEQUENCE, STATED PLAINLY
-- ----------------------------------------------------------------------------
-- Regenerating a day that holds a duplicated line restores the PLAN's line to
-- the plan's par and leaves the copy alone, so the item is made twice — once
-- for each line. That is what asking for two lines means, it is what a
-- hand-ADDED line has always done, and it is visible: `planDeviation` reads a
-- row with no `planned_par` as ADDED, so the copy carries a mark and the
-- record's "N lines differ from the plan" badge counts it.
--
-- What is NOT possible, and must not become possible, is two rows the
-- GENERATOR owns. That is the doubling 040 was written against, and this
-- migration leaves it exactly as forbidden as it was.
--
-- ----------------------------------------------------------------------------
-- THE CONFLICT TARGET HAS TO CARRY THE PREDICATE, WORD FOR WORD
-- ----------------------------------------------------------------------------
-- 069 learned that Postgres will not infer a partial unique index from a bare
-- `on conflict (cols)`. The half it did not have to learn, and this one does:
-- the predicate given in ON CONFLICT must IMPLY the index's, and the prover is
-- syntactic enough that "not special_order" will not be accepted for
-- "in ('plan','override')" — the first is true of a `manual` row and the
-- second is not. Leaving 069's wording would fail outright with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification",
-- which is at least loud. The two are written IDENTICALLY below.
--
-- 069 is applied, so this is a new file rather than an edit to it (055's rule),
-- and the argument list is COPIED rather than retyped — a changed one would
-- create an OVERLOAD and leave 069's version live beside it (033's
-- `freeze_pay_period` trap). `schedule_special_order` is untouched: it writes
-- `special_order` rows, which were outside the key before this and are outside
-- it after.
--
-- NOT RERUNNABLE: the `drop index` fails a second time, which is the signal it
-- has already run.
--
-- PROBE, don't read a note:
--   select indexdef from pg_indexes
--    where indexname = 'production_schedule_items_generated_line';
--   -- must end: WHERE (par_source = ANY (ARRAY['plan'::text, 'override'::text]))
--   select count(*) from pg_proc where proname = 'generate_production_schedules';
--   -- must be 1
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The key
-- ----------------------------------------------------------------------------

-- Create first, drop second, so the table is never without one — 069's own
-- order. Safe to build over live data: the new index is NARROWER in rows than
-- the one it replaces (it covers a subset), so anything the old key permitted
-- the new one permits.
create unique index production_schedule_items_generated_line_v2
  on production_schedule_items (schedule_id, item_id)
  where par_source in ('plan', 'override');

drop index production_schedule_items_generated_line;

-- Back to the canonical name, so the probe above and every note that quotes it
-- keep naming one thing.
alter index production_schedule_items_generated_line_v2
  rename to production_schedule_items_generated_line;

-- ----------------------------------------------------------------------------
-- THE GENERATOR, REPRODUCED FROM 092 AND NOT FROM 069
-- ----------------------------------------------------------------------------
-- 092 is the LATEST version of this function, not 069: it reproduced the body
-- to widen the role check to supervisor+, which is what lets a closing shift
-- report generate tomorrow's paper. Copying 069's — the file this migration is
-- otherwise about — would have silently reverted that, with nothing failing
-- and nobody looking. **When reproducing a function, copy the last migration
-- that TOUCHED it, which is rarely the one you are thinking about.**
--
-- Byte for byte 092's, but for the one conflict-target line.
-- ----------------------------------------------------------------------------

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

  if not user_has_role(v_org_id, array['owner','admin','purchaser','supervisor']) then
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
        on conflict (schedule_id, item_id) where par_source in ('plan', 'override')
        do update set
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

-- `create or replace` keeps a function's privileges, so these are a restatement
-- rather than a repair — 069's habit, kept because the alternative is trusting
-- that nobody ever drops this function by hand.
revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from public;
revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from anon;
grant execute on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) to authenticated;
