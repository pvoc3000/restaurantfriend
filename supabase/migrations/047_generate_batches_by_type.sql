-- ============================================================================
-- restaurantfriend — migration 047 · generate only the types you asked for
--
-- Mark, 2026-08-09: the New batch log dialog gets "a vertical list of the
-- element types with a checkbox next to them … when the generate button is
-- finally pressed, only copy the elements from the weekly schedule with those
-- selected element types."
--
-- The round is one list per kitchen — DF02's is Glaze 12 · Cream 6 · Topping 6
-- · Misc 2 · Ice Cream 2 · Donut 1 · Jam 1 — and the whole of it lands on one
-- log today. Sometimes what you are about to do is the glazes.
--
-- ---------------------------------------------------------------------------
-- DROPPED AND RECREATED, not `create or replace`.
--
-- 033's lesson, and it is the whole reason this is a migration rather than an
-- edit: a replace cannot change an argument list. Adding a parameter — even one
-- with a DEFAULT — creates an OVERLOAD and leaves the three-argument version
-- live, so an old tab would go on generating every type with no error anywhere.
-- With the drop, a stale tab gets PostgREST's `PGRST202`, which is loud.
--
-- ---------------------------------------------------------------------------
-- NULL MEANS EVERY TYPE, so nothing that already calls this changes meaning,
-- and `''` MEANS "no type" — the sentinel for `element_type is null`.
--
-- The sentinel is safe rather than lucky: measured before choosing it, ZERO of
-- the 470 elements carry an empty-string type (203 carry null), so `''` cannot
-- collide with a real value. `coalesce` is what makes one array express both.
-- No element on either kitchen's round is untyped today, so the dialog does not
-- currently offer the option — but an untyped element joining the round later
-- must not become silently ungenerable, which is what a bare
-- `element_type = any(...)` would have done.
-- ============================================================================

drop function if exists public.generate_production_batches(uuid, date, boolean);

create function public.generate_production_batches(
  p_location_id  uuid,
  p_log_date     date,
  p_replace      boolean default false,
  -- NULL = every type on the round. See the header for the `''` sentinel.
  p_element_types text[] default null
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
   where location_id = p_location_id and log_date = p_log_date;

  if v_log_id is null then
    insert into production_batch_logs (org_id, location_id, log_date, generated_by)
    values (v_org, p_location_id, p_log_date, auth.uid())
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
       and el.on_weekly_log
       and el.is_active
       and e.is_active
       and e.kind = 'made'
       -- The same filter the generating loop uses. A warning about an element
       -- you did not ask for is noise on a receipt you are reading to find out
       -- what you DID make.
       and (p_element_types is null
            or coalesce(e.element_type, '') = any(p_element_types))
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
           el.weekly_sort,
           el.weekly_amount,
           el.weekly_unit,
           el.stock_count,
           el.stock_size,
           el.stock_unit,
           e.name as element_name
      from production_element_locations el
      join production_elements e on e.id = el.element_id
     where el.location_id = p_location_id
       and el.on_weekly_log
       and el.is_active
       and e.is_active
       -- THE ONLY BEHAVIOUR CHANGE IN THIS MIGRATION. Everything else — the
       -- top-up, the skip, the replace, the warnings — is 045 verbatim.
       and (p_element_types is null
            or coalesce(e.element_type, '') = any(p_element_types))
     order by el.weekly_sort nulls last, e.name
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
        batch_number, sort,
        created_by, recipe_version_id, recipe_version_label,
        batch_amount, batch_unit,
        par_count, par_size, par_unit, status)
      values (
        v_org, v_log_id, d.element_id, p_location_id, true,
        v_number, d.weekly_sort,
        auth.uid(), v_version_id, v_version_label,
        d.weekly_amount, d.weekly_unit,
        d.stock_count, d.stock_size, d.stock_unit, 'to_do');

      v_created := v_created || jsonb_build_object(
        'element_name', d.element_name, 'batch_number', v_number);
    else
      -- REPLACE refreshes what the round says and leaves every measured thing
      -- alone: status, on-hand, yield, notes, photo, operator and the cost
      -- snapshot are untouched. There is no yield guard here, unlike 044's:
      -- nothing this rewrites can destroy a measurement.
      update production_batches
         set sort                 = d.weekly_sort,
             batch_amount         = d.weekly_amount,
             batch_unit           = d.weekly_unit,
             par_count            = d.stock_count,
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
    'element_types', to_jsonb(p_element_types),
    'created',       v_created,
    'skipped',       v_skipped,
    'warnings',      v_warnings);
end;
$$;
