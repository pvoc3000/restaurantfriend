-- ============================================================================
-- 069 — A SPECIAL ORDER'S LINES ARE A TRANSCRIPT, NOT A ROLL-UP
-- ============================================================================
--
-- Mark, 2026-08-27, after seeing the first real one: "when scheduling a special
-- order for production, don't consolidate lines, even if they result in the
-- same donut. Keep each line intact, and be sure to copy the notes column."
--
-- WHY IT NEEDED A MIGRATION AND NOT JUST A CHANGE OF MIND. Order #7769 spells
-- HAPPY BIRTHDAY VINNY, and the letter H appears TWICE — two separate order
-- lines, same production item, same cut. 067's key
-- `(schedule_id, item_id, coalesce(subtype,''))` forbids that outright, so
-- "keep each line intact" is unenforceable while it stands.
--
-- Its two Mini lines are the reason the rule is right: 50 with a note reading
-- "chocolate glaze" and 50 reading "vanilla glaze". They are the same menu
-- item, the same cut and the same size, and they are NOT the same thing to
-- make. Rolled up they printed as one line of 100 and the decorator was never
-- told half were chocolate. No key over the taxonomy can fix that, because the
-- distinguishing fact is in a free-text note — which is exactly why the answer
-- is to stop rolling up rather than to add another column to the key.
--
-- ----------------------------------------------------------------------------
-- UNIQUENESS IS A RULE ABOUT GENERATED LINES, SO IT NOW SAYS SO
-- ----------------------------------------------------------------------------
-- 040's `unique (schedule_id, item_id)` exists because REGENERATION upserts:
-- two rows of one item would double the day's par and nothing downstream would
-- notice. That reasoning is about the generator and has never been about a
-- special order, whose lines are written once from a validated payload and
-- which `generate_production_schedules` refuses to touch at all (it only ever
-- reads `source = 'plan'`).
--
-- So the key becomes PARTIAL — `where par_source <> 'special_order'` — and
-- 067's subtype column comes back OUT of it. That is not a retreat: with
-- special-order lines exempt, subtype was doing nothing, because
-- `production_day` returns exactly one row per item and there was never a
-- second row for it to separate. 067 widened the key to make room for the
-- letters, and this makes room for them properly.
--
-- Removing subtype from the key also RETIRES a hazard 067 had to defend
-- against: with it in the key, renaming an item's subtype in the catalog made
-- the upsert miss its own row, so a regeneration left the old line standing
-- beside a new one — measured at 2 lines and 48 donuts where 24 was right.
-- 067 fixed that by matching the delete-stale predicate on subtype too. With
-- the key back on `item_id` alone, a rename simply updates the row it already
-- has, so BOTH of 067's changes to that function are reverted here and the
-- body below is 040's, byte for byte, but for the conflict target's `where`.
--
-- The three line kinds separate cleanly and that is what makes the predicate
-- safe: the generator writes `plan` / `override`, `AddScheduleItems` writes
-- `manual`, and only `schedule_special_order` writes `special_order`.
--
-- ----------------------------------------------------------------------------
-- THE CONFLICT TARGET HAS TO CARRY THE PREDICATE
-- ----------------------------------------------------------------------------
-- Postgres will not infer a PARTIAL unique index from a bare `on conflict
-- (cols)` — the index's predicate has to be implied by the statement's. Hence
-- the one changed line in the reproduction below. Without it the generator does
-- not misbehave, it fails outright with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification", which is at least loud.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The key
-- ----------------------------------------------------------------------------

-- Create first, drop second, so the table is never without a key. Safe to
-- build: it is NARROWER in rows than 067's (it covers fewer of them) and
-- coarser in columns, and no special-order schedule has more than one line per
-- item yet — the app has been consolidating them until now.
create unique index production_schedule_items_generated_line
  on production_schedule_items (schedule_id, item_id)
  where par_source <> 'special_order';

drop index production_schedule_items_line;

-- ----------------------------------------------------------------------------
-- 040's generator, with the conflict target pointed at the partial index
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

revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from public;
revoke all on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) from anon;
grant execute on function generate_production_schedules(date, integer, uuid[], boolean, boolean, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- schedule_special_order, reproduced with the roll-up taken out and the note
-- carried through. 068 is applied, so this is a new file rather than an edit
-- to it (055's rule); the argument list is COPIED, not retyped, or this would
-- create an OVERLOAD and leave 068's version live beside it.
-- ----------------------------------------------------------------------------

create or replace function schedule_special_order(
  p_order_id uuid,
  p_date     date,
  p_today    date,
  p_title    text,
  p_lines    jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_id     uuid;
  v_kind       text;
  v_status     text;
  v_number     text;
  v_existing   uuid;
  v_loc_id     uuid;
  v_kitchen_id uuid;
  v_sells      uuid;
  v_kitchen    uuid;
  v_scheduled  date;
  v_sched_id   uuid;
  v_bad        text;
  v_lines      integer;
  v_par_total  numeric;
begin
  if p_order_id is null then
    raise exception 'no order given';
  end if;
  if p_date is null then
    raise exception 'no date given';
  end if;
  -- THE ORG'S CALENDAR DAY, PASSED IN, NEVER `current_date`. Postgres answers
  -- that in UTC, so after 4pm Pacific it is tomorrow and the stamp would date
  -- an act to a day that has not happened. `lib/today` already computes it and
  -- every caller of this holds it.
  if p_today is null then
    raise exception 'no calendar day given';
  end if;

  select o.org_id, o.kind, o.status, o.number, o.production_schedule_id,
         o.location_id, o.kitchen_location_id, o.order_scheduled_at
    into v_org_id, v_kind, v_status, v_number, v_existing,
         v_loc_id, v_kitchen_id, v_scheduled
    from special_orders o
   where o.id = p_order_id;

  -- RLS decides what this select can see, so "not found" and "not yours" are
  -- the same sentence on purpose — an error that told them apart would say
  -- whether an order exists to somebody who may not read it.
  if v_org_id is null then
    raise exception 'no such special order';
  end if;

  -- 051's `special_orders_status_iff_order` makes `status` null exactly when
  -- `kind` is not 'order', so a template or a standing order has no workflow to
  -- advance and nothing yet to bake.
  if v_kind is distinct from 'order' then
    raise exception 'only an order can be scheduled; this is a %', v_kind;
  end if;
  if v_status = 'cancelled' then
    raise exception 'order % is cancelled', v_number;
  end if;

  -- One schedule per order, and the order itself is the record of that. This
  -- is what makes the whole lock/unschedule cycle a state you can read off one
  -- column rather than infer.
  if v_existing is not null then
    raise exception 'order % is already scheduled; unschedule it first', v_number;
  end if;

  v_kitchen := coalesce(v_kitchen_id, v_loc_id);
  v_sells   := coalesce(v_loc_id, v_kitchen_id);
  if v_kitchen is null then
    raise exception
      'order % has no kitchen and no pickup shop, so there is nowhere to make it',
      v_number;
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'order % has nothing to make', v_number;
  end if;

  -- ------------------------------------------------------------------------
  -- Validate the payload. Each of these is a way a wrong or stale client could
  -- otherwise put something on a kitchen sheet that nobody ordered.
  -- ------------------------------------------------------------------------
  -- A TEMP TABLE WOULD BE THE OBVIOUS SHAPE AND IS THE WRONG ONE: PL/pgSQL
  -- caches a statement's plan against the relation's OID, and a temp table
  -- recreated on the next call has a new one, so the second invocation in a
  -- session fails with "relation with OID ... does not exist".
  -- `jsonb_to_recordset` is the same reading with no relation to go stale, and
  -- the column list below is the payload's contract, stated once.
  if exists (
    select 1 from jsonb_to_recordset(p_lines)
      as d(item_id uuid, item_name text, par numeric)
     where d.item_id is null or nullif(btrim(coalesce(d.item_name, '')), '') is null
  ) then
    raise exception 'every line needs an item and a name';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_lines) as d(par numeric)
     where d.par is null or d.par <= 0
  ) then
    raise exception 'every line needs a quantity above zero';
  end if;

  -- Not merely "is a production item" — is a production item THIS ORDER ASKS
  -- FOR. Without the second half, a caller holding one order's id could
  -- schedule any item in the catalog against it.
  select string_agg(distinct d.item_id::text, ', ')
    into v_bad
    from jsonb_to_recordset(p_lines) as d(item_id uuid)
   where not exists (
     select 1
       from special_order_items li
       join production_items pi on pi.id = li.production_item_id
      where li.order_id = p_order_id
        and li.production_item_id = d.item_id
        and pi.org_id = v_org_id);
  if v_bad is not null then
    raise exception 'these items are not on order %: %', v_number, v_bad;
  end if;

  -- NO UNIQUENESS CHECK, deliberately. 069 exempts special-order lines from
  -- the key because a repeated (item, cut) is the normal case: HAPPY has two
  -- P's, and two Mini lines differing only by a note are two different things
  -- to make. One order line, one schedule line.

  -- ------------------------------------------------------------------------
  -- Commit
  -- ------------------------------------------------------------------------
  insert into production_schedules
    (org_id, schedule_date, location_id, kitchen_location_id,
     source, source_ref, title, generated_by)
  values
    (v_org_id, p_date, v_sells, v_kitchen,
     'special_order', p_order_id, nullif(btrim(coalesce(p_title, '')), ''), auth.uid())
  returning id into v_sched_id;

  insert into production_schedule_items
    (org_id, schedule_id, item_id, item_name, item_type, subtype, finish, size,
     tally_box_size, tray_capacity, par, par_source, note, sort)
  select
    v_org_id, v_sched_id, d.item_id, btrim(d.item_name),
    nullif(d.item_type, ''), nullif(d.subtype, ''),
    nullif(d.finish, ''), nullif(d.size, ''),
    -- The COUNTING artefacts come from the catalog, not from the order: a box
    -- of six and a tray of twenty-four are facts about the donut, and the
    -- defaults are 037's own. `tray_number` and `tray_band` stay null — a
    -- special-order line has no tray and sorts last, which 040 says in as many
    -- words. `planned_par` stays null: nothing planned this.
    coalesce(pi.tally_box_size, 6),
    coalesce(pi.tray_capacity, 24),
    d.par, 'special_order', nullif(btrim(coalesce(d.note, '')), ''),
    coalesce(d.sort, 0)
  from jsonb_to_recordset(p_lines)
    as d(item_id uuid, item_name text, item_type text, subtype text,
         finish text, size text, par numeric, note text, sort integer)
  join production_items pi on pi.id = d.item_id;

  select count(*), coalesce(sum(li.par), 0)
    into v_lines, v_par_total
    from production_schedule_items li
   where li.schedule_id = v_sched_id;

  -- The two stamps, in the same transaction as the document they describe.
  --
  -- `order_scheduled_at` takes TODAY, not `p_date`. Every stage date beside it
  -- records the day the ACT happened — a quote sent, an order printed — and
  -- the day production was scheduled FOR is on the schedule itself. Only when
  -- EMPTY, which is SendDocument's rule: a second act does not move a date
  -- somebody's paperwork already carries.
  update special_orders o
     set production_schedule_id = v_sched_id,
         order_scheduled_at = coalesce(o.order_scheduled_at, p_today)
   where o.id = p_order_id;

  -- 054's trigger watches columns, and deliberately does NOT watch the stage
  -- dates or `production_schedule_id` — so the biggest act in this module would
  -- otherwise leave no trace in its own history. Written here for the same
  -- reason `Duplicated from order N` is: a fact about the order with no watched
  -- column behind it.
  insert into special_order_events (org_id, order_id, author_id, message)
  values (v_org_id, p_order_id, auth.uid(),
          format('Production scheduled for %s at %s — %s lines, %s to make',
                 to_char(p_date, 'FMDy FMMon FMDD'),
                 (select l.code from locations l where l.id = v_kitchen),
                 v_lines, trim_scale(v_par_total)));

  -- 040's own "no lines -> no document" rule. Unreachable given the empty-payload
  -- guard above, and kept because a silent empty schedule is worse than a raise.
  if v_lines = 0 then
    raise exception 'order % produced no schedule lines', v_number;
  end if;

  return jsonb_build_object(
    'schedule_id', v_sched_id,
    'order_id',    p_order_id,
    'number',      v_number,
    'date',        p_date,
    'sells',       v_sells,
    'kitchen',     v_kitchen,
    'lines',       v_lines,
    'par_total',   v_par_total,
    'scheduled_at_was_already_set', v_scheduled is not null
  );

-- The `production_schedule_id is null` test above is the rule; the partial
-- unique index is the backstop for two calls racing past it. Without this a
-- double-click answers with a raw 23505 naming an index.
exception when unique_violation then
  raise exception 'order % is already scheduled for that day', v_number;
end $$;
revoke all on function schedule_special_order(uuid, date, date, text, jsonb) from public;
revoke all on function schedule_special_order(uuid, date, date, text, jsonb) from anon;
grant execute on function schedule_special_order(uuid, date, date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   -- the key is partial now, and 067's is gone:
--   select indexname, indexdef from pg_indexes
--    where tablename = 'production_schedule_items' and indexname like '%line%';
--     -> ONE row, `production_schedule_items_generated_line`, whose definition
--        ends `WHERE (par_source <> 'special_order'::text)`
--
--   -- still ONE of each function, never two (033's overload trap):
--   select proname, count(*) from pg_proc
--    where proname in ('generate_production_schedules', 'schedule_special_order')
--    group by 1;                                        -> count 1 each
--
--   -- and the guard still refuses from its first statement:
--   select public.schedule_special_order(null, null, null, null, null);
--     -> ERROR: no order given
