-- ============================================================================
-- 067 — A SCHEDULE LINE IS ONE PER (ITEM, CUT), NOT ONE PER ITEM
-- ============================================================================
--
-- Decision 9 needs a special order's items on a production schedule, and 040's
-- `unique (schedule_id, item_id)` will not let them on.
--
-- WHY, measured against the live catalog rather than argued:
--
--   * `production_items` holds ONE generic `Letter` subtype — 56 rows, one per
--     FLAVOUR (Angry Samoa, Poppygandhi, Rites of Sprinkles - Choc, ...). There
--     is no per-alphabet-character item and there should not be one: the
--     character is a property of the ORDER, not of the menu.
--   * So every letter of a customer's name resolves to the same
--     `production_item_id`. Order #7769 spells HAPPY BIRTHDAY VINNY in 18
--     lines that ALL point at `Rites of Sprinkles - Choc`. Under 040's key that
--     is one schedule line reading "18 x Rites of Sprinkles - Letter", and the
--     decorator does not know which letters to cut.
--   * It is not an edge case. 943 of the 3,133 orders carrying linked lines
--     (30.1%) have two lines sharing a production item, and roughly three in
--     four of those collisions are DIFFERENT letters rather than duplicates.
--
-- The cut is the discriminator, and `production_schedule_items.subtype` is
-- already where a line's cut is snapshotted. So the key moves onto it.
--
-- ----------------------------------------------------------------------------
-- PLAN SCHEDULES DO NOT CHANGE, AND THAT IS PROVABLE RATHER THAN HOPED
-- ----------------------------------------------------------------------------
-- `production_day` groups by (kitchen_location_id, item_id) and returns exactly
-- one row per item, each carrying one subtype. Adding subtype to the key
-- therefore cannot split anything a plan generates — there is never a second
-- row of the same item to split from.
--
-- ----------------------------------------------------------------------------
-- WHY THE DELETE-STALE PREDICATE MOVES TOO
-- ----------------------------------------------------------------------------
-- The upsert's conflict target has to match a real unique index, so it changes
-- with the key. That alone would introduce a NEW failure: 040's replacement
-- pass deletes a line only when the day no longer carries its `item_id`, so
-- editing an item's subtype in the catalog and regenerating would leave the old
-- line standing AND insert a new one — a silently doubled par, which is the
-- exact failure the original constraint existed to prevent. Both `not exists`
-- predicates (the `v_lost` actuals count and the delete beneath it) therefore
-- gain `coalesce(d.subtype,'') = coalesce(li.subtype,'')`, so a rename replaces
-- rather than duplicates. They must keep saying the same thing as each other,
-- or the guard and the delete stop agreeing about what is about to be lost.
--
-- ----------------------------------------------------------------------------
-- THE FUNCTION IS REPRODUCED IN FULL, DELIBERATELY
-- ----------------------------------------------------------------------------
-- 055's rule: 040 is applied, and a migration that has run is history. Editing
-- it is how the harness and production quietly stop being the same database.
-- What follows is 040:821-1109 byte-for-byte except the three changed lines
-- named above. The argument list is COPIED, not retyped — a changed one would
-- create an OVERLOAD and leave 040's version live beside this one (033's
-- `freeze_pay_period` lesson).
--
-- Cheap at the moment it lands: `production_schedules` holds 17 rows (all
-- `source = 'plan'`) and `production_schedule_items` 546, so there is nothing
-- to data-migrate and no duplicate to reconcile.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The key
-- ----------------------------------------------------------------------------

-- CREATE FIRST, DROP SECOND, so there is never an instant with no key on this
-- table. The old constraint also guarantees the new index builds: uniqueness on
-- (schedule, item) implies it on (schedule, item, cut).
--
-- An EXPRESSION index, because `subtype` is nullable and two NULLs are never
-- equal in a plain unique index — which would silently allow two untyped lines
-- of the same item and hand back the doubled par this key exists to forbid.
create unique index production_schedule_items_line
  on production_schedule_items (schedule_id, item_id, coalesce(subtype, ''));

alter table production_schedule_items
  drop constraint production_schedule_items_schedule_id_item_id_key;

-- ----------------------------------------------------------------------------
-- 040's generator, reproduced with the three changes above
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
                  and coalesce(d.subtype, '') = coalesce(li.subtype, '')
                  and d.par > 0 and not d.is_suppressed);

          delete from production_schedule_items li
           where li.schedule_id = v_sched_id
             and li.par_source <> 'manual'
             and not exists (
               select 1 from production_day(v_loc_id, v_date) d
                where d.item_id = li.item_id
                  and d.kitchen_location_id = v_kitchen
                  and coalesce(d.subtype, '') = coalesce(li.subtype, '')
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
        on conflict (schedule_id, item_id, coalesce(subtype, '')) do update set
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

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   -- the old key is gone and the new one is here:
--   select conname from pg_constraint
--    where conrelid = 'public.production_schedule_items'::regclass
--      and contype = 'u';
--     -> NO `production_schedule_items_schedule_id_item_id_key`
--   select indexname from pg_indexes
--    where tablename = 'production_schedule_items';
--     -> includes `production_schedule_items_line`
--
--   -- ONE generator, not two. Two would mean the argument list drifted and
--   -- 040's version is still live beside this one:
--   select count(*) from pg_proc where proname = 'generate_production_schedules';
--     -> 1
--
--   -- nothing was split by the new key (17 schedules / 546 lines, unchanged):
--   select count(*) from production_schedule_items;
--     -> 546
