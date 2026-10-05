-- ============================================================================
-- 173 — A SCHEDULE REMEMBERS THE PLANS IT CAME FROM
--
-- Mark, 2026-10-04: DF01 was planned to make DF02's donuts on Monday and for
-- one day DF02 had to make its own. A schedule's Made at has been a picker
-- since 2026-09-30, but Generate found an existing schedule by shop, date AND
-- kitchen, so a schedule moved to DF02 looked like a missing DF01 one and the
-- next Generate made a second. "Remembering the plan it came from is more
-- powerful than remembering the kitchen it was moved from … the app can check
-- if a schedule was already generated for that plan for that day, and skip it."
--
-- 1. `production_schedules.plan_ids` — the plans that fed the schedule. A list
--    because overlapping plans into one kitchen still make ONE schedule with
--    their pars summed (decision 9); in practice it holds one.
-- 2. The backfill. Measured 2026-10-04 over 64 plan schedules: 61 match
--    exactly one plan on shop, date and that weekday's kitchen (none match
--    two); the other 3 were moved by hand and are matched on shop and date.
--    A plan's `is_active` is NOT asked: 24 of the 61 came from the summer
--    plans, retired since, and their From column has read "Plan" ever since.
-- 3. `generate_production_schedules` finds the schedule by its plans. THE BODY
--    IS THE LIVE FUNCTION (pg_get_functiondef, 2026-10-04); every change is
--    marked "173". `create or replace` keeps the grants.
--
-- No policy changes: the column rides `production_schedules`' own.
--
-- APPLY BEFORE DEPLOYING: /schedules selects `plan_ids`.
-- RERUNNABLE. THE SQL STARTS ON THE LINE BELOW THIS HEADER.
-- ============================================================================

alter table production_schedules
  add column if not exists plan_ids uuid[] not null default '{}';

comment on column production_schedules.plan_ids is
  'The production_plans this schedule was generated from (173). Written by '
  'generate_production_schedules; it is how Generate recognises the schedule '
  'after its kitchen has been moved. Empty on special-order and by-hand '
  'schedules. No foreign key: a deleted plan leaves its id behind, harmlessly.';

-- The backfill, first pass: shop, date, and the plan's kitchen for that
-- weekday — the rule the From column has used since 101.
update production_schedules s
   set plan_ids = m.ids
  from (
    select s2.id, array_agg(p.id order by p.starts_on, p.id) as ids
      from production_schedules s2
      join production_plans p
        on p.location_id = s2.location_id
       and p.starts_on <= s2.schedule_date
       and (p.ends_on is null or p.ends_on >= s2.schedule_date)
       and coalesce(p.kitchen_by_weekday[extract(isodow from s2.schedule_date)::int],
                    p.location_id) = s2.kitchen_location_id
     where s2.source = 'plan' and s2.plan_ids = '{}'
     group by s2.id
  ) m
 where m.id = s.id;

-- Second pass: a schedule already moved off its plan's kitchen. Only where
-- exactly one plan covers that shop and date, so nothing is guessed.
update production_schedules s
   set plan_ids = m.ids
  from (
    select s2.id, array_agg(p.id) as ids
      from production_schedules s2
      join production_plans p
        on p.location_id = s2.location_id
       and p.starts_on <= s2.schedule_date
       and (p.ends_on is null or p.ends_on >= s2.schedule_date)
     where s2.source = 'plan' and s2.plan_ids = '{}'
     group by s2.id
    having count(*) = 1
  ) m
 where m.id = s.id;

CREATE OR REPLACE FUNCTION public.generate_production_schedules(p_start date, p_days integer, p_location_ids uuid[], p_ignore_special_orders boolean DEFAULT false, p_replace boolean DEFAULT false, p_allow_actuals boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_org_ids   uuid[];
  v_org_id    uuid;
  v_loc_id    uuid;
  v_kitchen   uuid;
  v_date      date;
  v_offset    integer;
  v_sched_id  uuid;
  v_existing  uuid;
  v_plans     uuid[];
  v_made_at   uuid;
  v_blocker   uuid;
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
      --
      -- 173: a kitchen that already holds this shop's plan schedule goes FIRST.
      -- On a regeneration each pass rewrites the schedule it finds and restates
      -- its plans, so the kitchen the schedule is actually at has to claim it
      -- before another kitchen's plans can.
      for v_kitchen in
        select k.kitchen_location_id
          from (select distinct d.kitchen_location_id
                  from production_day(v_loc_id, v_date) d
                 where d.par > 0 and not d.is_suppressed) k
         order by exists (
                    select 1 from production_schedules s
                     where s.location_id = v_loc_id
                       and s.schedule_date = v_date
                       and s.source = 'plan'
                       and s.kitchen_location_id = k.kitchen_location_id) desc,
                  k.kitchen_location_id
      loop
        -- 173: the plans feeding this kitchen's share of the day.
        select coalesce(array_agg(distinct pid), '{}'::uuid[]) into v_plans
          from production_day(v_loc_id, v_date) d
          cross join lateral unnest(d.plan_ids) as pid
         where d.kitchen_location_id = v_kitchen
           and d.par > 0 and not d.is_suppressed;

        -- 173: THE SCHEDULE IS FOUND BY ITS PLANS, not by its kitchen. A
        -- schedule generated from one of these plans for this shop and date IS
        -- this schedule, wherever its Made at has since been moved to. The
        -- kitchen still decides when there is no plan to match on: a schedule
        -- from before 173 that the backfill could not place, or a day made only
        -- of items added by par override.
        select s.id, s.kitchen_location_id into v_existing, v_made_at
          from production_schedules s
         where s.location_id = v_loc_id
           and s.schedule_date = v_date
           and s.source = 'plan'
           and (s.plan_ids && v_plans
                or (s.kitchen_location_id = v_kitchen
                    and (s.plan_ids = '{}'::uuid[] or v_plans = '{}'::uuid[])))
         order by (s.plan_ids && v_plans) desc, s.created_at
         limit 1;

        if v_existing is null then
          v_made_at := v_kitchen;

          -- Another plan's schedule is sitting at this kitchen, so a new one
          -- here would be the second schedule for one shop, date and kitchen
          -- that `production_schedules_plan_day` forbids. Left alone and
          -- reported, rather than failing the whole run on a unique key.
          select s.id into v_blocker
            from production_schedules s
           where s.location_id = v_loc_id
             and s.schedule_date = v_date
             and s.kitchen_location_id = v_kitchen
             and s.source = 'plan';

          if v_blocker is not null then
            select l.code into v_kit_code from locations l where l.id = v_kitchen;
            select count(*), count(*) filter (where li.made is not null
                                                 or li.leftover is not null)
              into v_lines, v_actuals
              from production_schedule_items li where li.schedule_id = v_blocker;

            if not exists (select 1 from jsonb_array_elements(v_skipped) e
                            where e->>'schedule_id' = v_blocker::text) then
              v_skipped := v_skipped || jsonb_build_object(
                'schedule_id', v_blocker, 'date', v_date,
                'location_id', v_loc_id, 'location_code', v_loc_code,
                'kitchen_location_id', v_kitchen, 'kitchen_code', v_kit_code,
                'reason', 'kitchen_taken', 'line_count', v_lines,
                'has_actuals', v_actuals > 0);
            end if;
            continue;
          end if;
        end if;

        -- The receipt names the kitchen the schedule is AT.
        select l.code into v_kit_code from locations l where l.id = v_made_at;

        -- ------------------------------------------------------------------
        -- Guard 1 — exists, and we were not asked to replace
        if v_existing is not null and not p_replace then
          select count(*), count(*) filter (where li.made is not null
                                               or li.leftover is not null)
            into v_lines, v_actuals
            from production_schedule_items li where li.schedule_id = v_existing;

          -- Once per schedule: two kitchens' plans can both be on one.
          if not exists (select 1 from jsonb_array_elements(v_skipped) e
                          where e->>'schedule_id' = v_existing::text) then
            v_skipped := v_skipped || jsonb_build_object(
              'schedule_id', v_existing, 'date', v_date,
              'location_id', v_loc_id, 'location_code', v_loc_code,
              'kitchen_location_id', v_made_at, 'kitchen_code', v_kit_code,
              'reason', 'exists', 'line_count', v_lines,
              'has_actuals', v_actuals > 0);
          end if;
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
             source, generated_by, ignored_special_orders, plan_ids)
          values
            (v_org_id, v_date, v_loc_id, v_kitchen,
             'plan', auth.uid(), coalesce(p_ignore_special_orders, false), v_plans)
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
                 ignored_special_orders = coalesce(p_ignore_special_orders, false),
                 -- The lines are about to be this kitchen's share of today's
                 -- plans, so the record of where they came from follows them.
                 plan_ids = v_plans
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
            'kitchen_location_id', v_made_at, 'kitchen_code', v_kit_code,
            'line_count', v_lines, 'par_total', v_par_total);
        else
          v_replaced := v_replaced || jsonb_build_object(
            'schedule_id', v_sched_id, 'date', v_date,
            'location_id', v_loc_id, 'location_code', v_loc_code,
            'kitchen_location_id', v_made_at, 'kitchen_code', v_kit_code,
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
end $function$;

notify pgrst, 'reload schema';
