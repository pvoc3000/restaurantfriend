-- ============================================================================
-- restaurantfriend — migration 159 · the element's Order goes
--
-- Mark, 2026-09-30: "I don't think an 'element' order is needed. Batch logs
-- order fields can start empty. it's fine. The shift report stuff was added
-- today and also not necessary. Let's remove it also."
--
-- `production_element_locations.batch_sort` (045's FileMaker ORDER, set on 6
-- rows) seeded each generated batch's `sort` and ordered the log, the shift
-- report's Donut batches page and the tray guide's Total batches box. It is
-- dropped. A generated batch's own `sort` — the batch log's Order — now starts
-- empty and is set on the log if wanted; refreshing a log no longer overwrites
-- it. Generation lists elements by name. Backup:
-- `FMP Export/pre159-element-order-2026-09-30.json` (6 rows).
--
-- `generate_production_batches` restated from 158 without it (same argument
-- list). Depends on 158. NOT rerunnable (the drop).
-- ============================================================================

create or replace function public.generate_production_batches(
  p_location_id  uuid,
  p_log_date     date,
  -- WHICH SCHEDULE (153): 'WEEKLY', 'DONUT' or 'ICE CREAM'. Required — a
  -- log is one schedule's, so there is no "every schedule".
  p_schedule     text,
  p_replace      boolean default false
) returns jsonb
language plpgsql
-- SECURITY INVOKER, 013's precedent: every insert flows through the policies
-- above, which is also what lets a supervisor run it. The batch-number sequence
-- is the one thing invoker cannot reach, so numbers come from 044's definer.
set search_path = public
as $$
declare
  v_org      uuid;
  v_loc_code text;
  v_log_id   uuid;
  v_created_log boolean := false;
  v_existing uuid;
  v_number   text;
  v_version_id    uuid;
  v_version_label text;
  v_created  jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  d          record;
  w          record;
begin
  if p_log_date is null then
    raise exception 'no date given';
  end if;

  if p_schedule is null or p_schedule not in ('WEEKLY', 'DONUT', 'ICE CREAM') then
    raise exception 'unknown schedule %', coalesce(p_schedule, '(none)');
  end if;

  select l.org_id, l.code into v_org, v_loc_code
    from locations l where l.id = p_location_id;

  if v_org is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to generate a batch log';
  end if;

  -- The log for that day, made if it isn't there. Generating twice TOPS UP one
  -- log rather than making a second — the unique index says so and this is how
  -- it is honoured.
  select id into v_log_id
    from production_batch_logs
   where location_id = p_location_id and log_date = p_log_date
     and schedule = p_schedule;

  if v_log_id is null then
    insert into production_batch_logs (org_id, location_id, log_date, schedule, generated_by)
    values (v_org, p_location_id, p_log_date, p_schedule, auth.uid())
    returning id into v_log_id;
    v_created_log := true;
  end if;

  -- Named once, before the loop: an element on the round with no master recipe
  -- still generates — the batch is real and somebody will make it from memory —
  -- but it is what a baker most wants to hear about.
  for w in
    select e.name as element_name
      from production_element_locations el
      join production_elements e on e.id = el.element_id
     where el.location_id = p_location_id
       -- 157: ACTIVE AT THIS KITCHEN is the membership; no separate tick.
       and el.is_active
       and e.is_active
       and e.kind = 'made'
       -- The same filter the generating loop uses.
       and e.schedule_class = p_schedule
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

  -- ONE TABLE, at the grain the fact actually has. No weekday, no shift, no
  -- collapse — `production_element_locations` is already one row per
  -- (element, kitchen).
  for d in
    select el.element_id,
           el.stock_count,
           el.stock_size,
           el.stock_unit,
           e.name as element_name
      from production_element_locations el
      join production_elements e on e.id = el.element_id
     where el.location_id = p_location_id
       and el.is_active
       and e.is_active
       -- The element's SCHEDULE (153), where 047 filtered by element type.
       and e.schedule_class = p_schedule
     order by e.name
  loop
    select b.id into v_existing
      from production_batches b
     where b.log_id = v_log_id
       and b.element_id = d.element_id
       and b.is_generated;

    if v_existing is not null and not p_replace then
      v_skipped := v_skipped || jsonb_build_object(
        'batch_id', v_existing, 'element_name', d.element_name, 'reason', 'exists');
      continue;
    end if;

    select v.id, v.version_label
      into v_version_id, v_version_label
      from production_recipe_versions v
      join production_recipes r on r.id = v.recipe_id
     where r.element_id = d.element_id and v.is_master
     limit 1;

    if v_existing is null then
      v_number := public.next_batch_number(p_location_id);

      insert into production_batches (
        org_id, log_id, element_id, location_id, is_generated,
        batch_number,
        created_by, recipe_version_id, recipe_version_label,
        par_count, par_size, par_unit, status)
      values (
        v_org, v_log_id, d.element_id, p_location_id, true,
        v_number,
        auth.uid(), v_version_id, v_version_label,
        d.stock_count, d.stock_size, d.stock_unit, 'to_do');

      v_created := v_created || jsonb_build_object(
        'element_name', d.element_name, 'batch_number', v_number);
    else
      -- REPLACE refreshes what the round says and leaves every measured thing
      -- alone: status, on-hand, yield, notes, photo, operator and the cost
      -- snapshot are untouched. There is no yield guard here, unlike 044's:
      -- nothing this rewrites can destroy a measurement. Nor the batch's own
      -- Order (159): it is set on the log, so a refresh keeps it.
      update production_batches
         set par_count            = d.stock_count,
             par_size             = d.stock_size,
             par_unit             = d.stock_unit,
             recipe_version_id    = v_version_id,
             recipe_version_label = v_version_label
       where id = v_existing;
    end if;
  end loop;

  return jsonb_build_object(
    'log_id',        v_log_id,
    'log_date',      p_log_date,
    'new_log',       v_created_log,
    'location_id',   p_location_id,
    'location_code', v_loc_code,
    'schedule',      p_schedule,
    'created',       v_created,
    'skipped',       v_skipped,
    'warnings',      v_warnings);
end;
$$;


drop index if exists production_element_locations_batch_idx;
alter table production_element_locations drop column batch_sort;

-- What generation filters on, without the order it no longer reads.
create index production_element_locations_batch_idx
  on production_element_locations (location_id)
  where is_active;
