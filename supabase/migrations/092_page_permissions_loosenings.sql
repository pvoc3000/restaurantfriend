-- 092 — THE PAGE PERMISSIONS SHEET: THE SIX CELLS THE DATABASE HAD TO LOOSEN
-- ----------------------------------------------------------------------------
-- Mark's "Page Permissions" spreadsheet (docs/Page Permissions.xlsx,
-- 2026-09-04) is now code — web/src/lib/pageAccess.ts — and the app hides,
-- reads or writes each screen per role from that one table. Tightening is an
-- edit there and a deploy. LOOSENING cannot be: a screen that offers a write
-- the policy refuses changes zero rows and reports success, and a screen that
-- reads a table the policy refuses renders an empty list. These are the cells
-- the sheet opened wider than the policies stood, each reproduced whole
-- (055's rule: a migration that has run is history, so nothing earlier is
-- edited).
--
--   Batch Logs      staff       Y          production_batches insert/update,
--                                          production_batch_logs likewise, the
--                                          batch-photos bucket, next_batch_number,
--                                          production_operators → every member
--   Schedules       supervisor  Y          production_schedules / _items /
--                                          _par_overrides writes, and
--                                          generate_production_schedules → supervisor+
--   Special Orders  staff       Read Only  the 051 select policies → every member
--   Customers       staff       Read Only  customers select → every member
--   Requests        supervisor  Y          preq_resolve → supervisor+
--   Sales           purchaser   Y          record_daily_sales, set_daily_sales_figure,
--                                          revert_daily_sales_to_square → purchaser+
--
-- And one TIGHTENING, the sheet's own "Unreachable" applied where the policy
-- was looser than the sheet: payroll_benefits select → owner/admin. The
-- catalog names no person, but the sheet files it with HR and Mark's rule is
-- that HR is unreachable rather than hidden. Nothing below owner/admin reads
-- it in web/src (the export, the timesheets screen and the employee record's
-- Payroll block are all already owner/admin).
--
-- WHAT DOES NOT MOVE, deliberately:
--   · generate_production_batches stays supervisor+ (047) — generating the
--     week's list is an act-level exception on a screen staff may write.
--   · production_batches DELETE stays purchaser+ (044's own argument).
--   · special_order_quote_tokens stays supervisor+ — a token is an approval
--     link, and a staffer reading an order does not need it; the record
--     renders without it.
--   · schedule_special_order / unschedule_special_order are UNTOUCHED and now
--     admit a supervisor, because they are security INVOKER and answer to the
--     production_schedules policies widened here. 068's header argued against
--     a definer widening them silently; this widening is explicit and is the
--     policy's, which is what that header asked for.
--   · The functions reproduced here keep their exact argument lists, so
--     `create or replace` replaces rather than overloads (033's lesson).
--
-- Verified on the Docker harness as real authenticated roles before this was
-- handed over — see the session notes in CLAUDE.md, build step 4m.
--
-- RERUNNABLE: every `drop policy` is followed by its `create policy` and every
-- function is `create or replace`, so a second run leaves the same state —
-- proved on the harness by applying it twice. Probe whether it has run with
-- `select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'preq_resolve'`
-- (it must name supervisor) and
-- `select count(*) from pg_proc where proname = 'record_daily_sales'` (1).

-- ----------------------------------------------------------------------------
-- 1. Requests: a supervisor resolves them (001's preq_resolve, widened)
-- ----------------------------------------------------------------------------

drop policy preq_resolve on purchase_requests;
create policy preq_resolve on purchase_requests for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- ----------------------------------------------------------------------------
-- 2. Schedules: a supervisor commits a kitchen's night (040's loop, widened
--    for three of its four tables — production_element_days is weekly-batch
--    CONFIG, not a schedule, and keeps purchaser+)
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'production_par_overrides',
    'production_schedules',
    'production_schedule_items'
  ] loop
    execute format('drop policy %I_insert on %I', t, t);
    execute format('drop policy %I_update on %I', t, t);
    execute format('drop policy %I_delete on %I', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'',''supervisor'']))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'',''supervisor'']))
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'',''supervisor'']))', t, t);
    execute format(
      'create policy %I_delete on %I for delete
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'',''supervisor'']))', t, t);
  end loop;
end $$;

-- generate_production_schedules — 069's body byte for byte but for the role
-- array in its one explicit check. This is the function the closing shift
-- report calls on page 7, which a supervisor runs; it refused them.

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
        on conflict (schedule_id, item_id) where par_source <> 'special_order'
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

-- ----------------------------------------------------------------------------
-- 3. Special orders and customers: every member READS (051's select policies)
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'special_orders',
    'special_order_items',
    'special_order_payments',
    'special_order_events',
    'special_order_attachments'
  ] loop
    execute format('drop policy %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select
         using (org_id in (select user_org_ids()))', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Batch logs: every member logs a batch (044/045, and the photo bucket)
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['production_batches', 'production_batch_logs'] loop
    execute format('drop policy %I_insert on %I', t, t);
    execute format('drop policy %I_update on %I', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using (org_id in (select user_org_ids()))
         with check (org_id in (select user_org_ids()))', t, t);
  end loop;
end $$;

drop policy batch_photos_object_insert on storage.objects;
drop policy batch_photos_object_update on storage.objects;
drop policy batch_photos_object_delete on storage.objects;

create policy batch_photos_object_insert on storage.objects for insert
  with check (
    bucket_id = 'batch-photos'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy batch_photos_object_update on storage.objects for update
  using (
    bucket_id = 'batch-photos'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy batch_photos_object_delete on storage.objects for delete
  using (
    bucket_id = 'batch-photos'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

-- The two definers a batch needs. Membership is still checked; the role
-- check inside each is what goes.

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

  -- No role check beyond membership since 092: every member logs batches.

  return nextval('production_batch_number_seq')::text;
end;
$$;

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

  -- No role check beyond membership since 092: whoever logs a batch names
  -- who made it, and that is now every member. Id and name only, as ever.

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

-- ----------------------------------------------------------------------------
-- 5. Sales: a purchaser syncs and corrects (063–066's three definers)
-- ----------------------------------------------------------------------------

create or replace function public.record_daily_sales(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_orgs   integer;
  v_bad    text;
  v_sales  integer;
  v_tips   integer;
  v_neg    integer;
  v_dates  jsonb;
  v_count  integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'record_daily_sales expects an array of rows';
  end if;

  v_count := jsonb_array_length(p_rows);

  if v_count = 0 then
    return jsonb_build_object('sales_upserted', 0, 'tips_written', 0,
                              'tips_skipped_closed', 0, 'tips_refused_negative', 0,
                              'tip_dates', '[]'::jsonb);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where nullif(r->>'location_id', '') is null
  ) then
    raise exception 'Every row must name a location_id';
  end if;

  select r->>'location_id' into v_bad
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from locations l where l.id = (r->>'location_id')::uuid)
   limit 1;
  if v_bad is not null then
    raise exception 'No such location: %', v_bad;
  end if;

  select count(distinct l.org_id) into v_orgs
    from jsonb_array_elements(p_rows) r
    join locations l on l.id = (r->>'location_id')::uuid;
  if v_orgs <> 1 then
    raise exception 'Every row must name a location in one organisation';
  end if;

  select l.org_id into v_org
    from jsonb_array_elements(p_rows) r
    join locations l on l.id = (r->>'location_id')::uuid
   limit 1;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then
    raise exception 'Only a purchaser or above can sync sales from Square';
  end if;

  insert into daily_sales (org_id, location_id, business_date,
                           net_sales_cents, tips_cents, source, synced_at)
  select v_org,
         (r->>'location_id')::uuid,
         (r->>'business_date')::date,
         (r->>'net_sales_cents')::integer,
         (r->>'tips_cents')::integer,
         'square',
         now()
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, location_id, business_date) do update
    set net_sales_cents = excluded.net_sales_cents,
        tips_cents      = excluded.tips_cents,
        synced_at       = excluded.synced_at
    where daily_sales.source <> 'manual';
  get diagnostics v_sales = row_count;

  select count(*) into v_neg
    from daily_sales ds
    join jsonb_array_elements(p_rows) r
      on ds.location_id = (r->>'location_id')::uuid
     and ds.business_date = (r->>'business_date')::date
   where ds.org_id = v_org
     and ds.tips_cents < 0
     and public.day_in_open_pay_period(v_org, ds.business_date);

  with fed as (
    insert into tip_pools (org_id, location_id, business_date,
                           reported_cents, reported_by, reported_at)
    select v_org, ds.location_id, ds.business_date, ds.tips_cents,
           -- THE AUTHOR IS DECIDED HERE, in the SELECT, and it has to be:
           -- `on conflict do update` can only see `excluded` and the target
           -- table, never this statement's own alias. Reaching for `ds.source`
           -- down there fails with "missing FROM-clause entry for table ds" —
           -- found by running it.
           case
             when ds.source = 'manual'
               then (select tp.reported_by from tip_pools tp
                      where tp.org_id = v_org
                        and tp.location_id = ds.location_id
                        and tp.business_date = ds.business_date)
             else null
           end,
           now()
      from daily_sales ds
      join jsonb_array_elements(p_rows) r
        on ds.location_id = (r->>'location_id')::uuid
       and ds.business_date = (r->>'business_date')::date
     where ds.org_id = v_org
       and ds.tips_cents >= 0
       and public.day_in_open_pay_period(v_org, ds.business_date)
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
          -- A MANUAL ROW KEEPS ITS AUTHOR, carried in from the SELECT above.
          -- Before 066 this was an unconditional null, which told every
          -- corrected day that Square had reported it. The figure was right;
          -- the name was not.
          reported_by    = excluded.reported_by,
          reported_at    = excluded.reported_at
    returning business_date
  )
  select count(*), coalesce(jsonb_agg(distinct business_date), '[]'::jsonb)
    into v_tips, v_dates
    from fed;

  return jsonb_build_object(
    'sales_upserted',        v_sales,
    'tips_written',          v_tips,
    'tips_skipped_closed',   v_count - v_tips - v_neg,
    'tips_refused_negative', v_neg,
    'tip_dates',             v_dates
  );
end;
$$;

create or replace function public.set_daily_sales_figure(
  p_location_id uuid,
  p_business_date date,
  p_column text,
  p_cents integer
)
returns daily_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row daily_sales;
begin
  -- The whitelist. A `case when` inside the UPDATE, never dynamic SQL.
  if p_column is null or p_column not in ('net_sales_cents', 'tips_cents') then
    raise exception 'Only net_sales_cents or tips_cents can be set by hand';
  end if;

  if p_cents is null then
    raise exception 'A figure is required — there is no such thing as a day with no takings recorded';
  end if;

  select org_id into v_org from locations where id = p_location_id;
  if v_org is null then
    raise exception 'No such location';
  end if;
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then
    raise exception 'Only a purchaser or above can correct a day''s figures';
  end if;

  -- NO `>= 0` GUARD, matching the table: a day of net refunds is legitimately
  -- negative, and 063 left the check off deliberately. A negative TIP figure is
  -- refused further down, where it would otherwise trip tip_pools' own check.

  -- An UPSERT rather than an update: correcting a day Square has never reported
  -- is exactly the case this exists for — a cash event, an outage — and there
  -- may be no row yet.
  insert into daily_sales (org_id, location_id, business_date,
                           net_sales_cents, tips_cents, source, synced_at)
  values (v_org, p_location_id, p_business_date,
          case when p_column = 'net_sales_cents' then p_cents else 0 end,
          case when p_column = 'tips_cents'      then p_cents else 0 end,
          'manual', now())
  on conflict (org_id, location_id, business_date) do update
    set net_sales_cents = case when p_column = 'net_sales_cents'
                               then p_cents else daily_sales.net_sales_cents end,
        tips_cents      = case when p_column = 'tips_cents'
                               then p_cents else daily_sales.tips_cents end,
        -- THE ROW IS NOW A HUMAN'S. `record_daily_sales` skips it from here on.
        source          = 'manual'
  returning * into v_row;

  -- The pool follows the corrected figure immediately. Without this a tip
  -- typed here would sit in `daily_sales` waiting for a sync that now skips
  -- the row — so it would never reach payroll at all.
  if v_row.tips_cents >= 0
     and public.day_in_open_pay_period(v_org, p_business_date) then
    insert into tip_pools (org_id, location_id, business_date,
                           reported_cents, reported_by, reported_at)
    values (v_org, p_location_id, p_business_date, v_row.tips_cents, auth.uid(), now())
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
          reported_by    = excluded.reported_by,
          reported_at    = excluded.reported_at;
    -- `reported_by` is the PERSON here, where the sync leaves it null to mean
    -- Square. That difference is the audit trail: a pool figure either came
    -- from the machine or from somebody, and the column says which.
  end if;

  return v_row;
end;
$$;

create or replace function public.revert_daily_sales_to_square(
  p_location_id uuid,
  p_business_date date
)
returns daily_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row daily_sales;
begin
  select org_id into v_org from locations where id = p_location_id;
  if v_org is null then
    raise exception 'No such location';
  end if;
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then
    raise exception 'Only a purchaser or above can hand a day back to Square';
  end if;

  update daily_sales
     set source = 'square'
   where org_id = v_org
     and location_id = p_location_id
     and business_date = p_business_date
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No figures recorded for that day';
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Benefits: unreachable below manager (033's select policy, tightened)
-- ----------------------------------------------------------------------------

drop policy payroll_benefits_select on payroll_benefits;
create policy payroll_benefits_select on payroll_benefits for select
  using (user_has_role(org_id, array['owner', 'admin']));
