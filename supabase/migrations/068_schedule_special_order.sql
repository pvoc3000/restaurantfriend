-- ============================================================================
-- 068 — SCHEDULING A SPECIAL ORDER'S PRODUCTION
-- ============================================================================
--
-- Decision 9, finally written. 040 shipped the whole seam and left it unused:
-- `production_schedules.source` already accepts 'special_order', `source_ref`
-- and `title` sit beside it, `production_schedule_items.par_source` accepts
-- 'special_order', its `tray_number` comment names "every special-order line",
-- and 051 gave `special_orders.production_schedule_id` an FK that nothing has
-- ever read. This is the pair of functions that joins the two ends.
--
-- ----------------------------------------------------------------------------
-- THE CLIENT COMPUTES THE LINES; THIS VALIDATES AND COMMITS THEM
-- ----------------------------------------------------------------------------
-- 029's `freeze_pay_period` shape, and for its stated reason. Grouping an
-- order's items into schedule lines means normalising the CUT, and the live
-- data holds 93 letter-ish spellings of what is really forty-odd characters:
-- `Letter - "A"` (1,170 rows), `Letter "A"` (17, no dash), `Letter. "A"`,
-- lowercase `Letter - "y"`, a stray `Letter - U"`, one escape-mangled
-- `Letter - ""Y""`. That logic exists and is fixture-tested in
-- `web/src/lib/specialOrderLines.ts`; a second copy in PL/pgSQL would be 016's
-- `nextDeliveryDate` trap on a document a kitchen bakes from.
--
-- So `p_lines` arrives computed. It is NOT trusted: every item must be a
-- production item in this org AND must appear as the `production_item_id` of a
-- line on THIS order, `(item_id, subtype)` must be unique within the payload,
-- and every par must be positive. A caller cannot schedule something the order
-- does not contain, however the payload was built.
--
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER, DELIBERATELY — 013's PRECEDENT VERBATIM
-- ----------------------------------------------------------------------------
-- `create_purchase_orders_from_guide` is invoker "on purpose — inserts flow
-- through the purchaser+ RLS policies", and the same is right here.
-- `production_schedules` is purchaser+ on insert and delete (040), while
-- special orders are supervisor+ (051). A definer would silently widen
-- scheduling to supervisors, which is a decision about who commits a kitchen's
-- night and not one to make as a side effect of wanting atomicity. A supervisor
-- calling this gets a policy refusal by name, and the UI does not offer them
-- the command in the first place.
--
-- Atomicity still holds: a function body is one transaction, so an order can
-- never rest half-scheduled with a schedule and no stamp, or the reverse.
--
-- ----------------------------------------------------------------------------
-- WHAT THE SHOPS MEAN
-- ----------------------------------------------------------------------------
-- `production_schedules.location_id` SELLS and `kitchen_location_id` MAKES, and
-- both are NOT NULL. On a special order BOTH are nullable — the kitchen is
-- filled on 83% of rows and the pickup shop only on recent ones — so each falls
-- back to the other, which is decision 9's own rule ("a plan with no kitchen
-- falls back to the selling shop") pointed in both directions. With neither,
-- there is no honest answer and the function refuses.
-- ============================================================================

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
  v_count      integer;
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

  -- 067's key, checked before it can raise as a constraint violation — a
  -- unique_violation here would name an index rather than the mistake.
  select count(*) into v_count
    from (
      select d.item_id, coalesce(nullif(d.subtype, ''), '') s
        from jsonb_to_recordset(p_lines) as d(item_id uuid, subtype text)
       group by 1, 2 having count(*) > 1
    ) dup;
  if v_count > 0 then
    raise exception '% item and cut combination(s) appear more than once', v_count;
  end if;

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
     tally_box_size, tray_capacity, par, par_source, sort)
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
    d.par, 'special_order', coalesce(d.sort, 0)
  from jsonb_to_recordset(p_lines)
    as d(item_id uuid, item_name text, item_type text, subtype text,
         finish text, size text, par numeric, sort integer)
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


-- ============================================================================
-- UNSCHEDULING
-- ============================================================================
--
-- Deleting the schedule IS unscheduling: `special_orders.production_schedule_id`
-- is `on delete set null`, so the order unlocks for free and cannot be left
-- pointing at a schedule that no longer exists.
--
-- IT REFUSES ONCE THE NIGHT HAS BEEN PRINTED OR COUNTED (Mark, 2026-08-27),
-- which is the one place this module is stricter than `closeReadiness`'s
-- name-it-and-let-you-through rule — and deliberately, because both facts are
-- about the world rather than about the record. Paper is in a kitchen, or
-- somebody stood at a bench and counted what they made. Neither is ours to
-- discard so that an order can be edited.
--
-- The escape hatch is real and is not a hole: a purchaser can still delete the
-- schedule from `/schedules/[id]`, which clears the link through the FK. That
-- is a deliberate act on the production record, which is the right place to
-- take responsibility for throwing a counted night away.
-- ============================================================================

create or replace function unschedule_special_order(
  p_order_id uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_id    uuid;
  v_number    text;
  v_sched_id  uuid;
  v_printed   timestamptz;
  v_counted   integer;
  v_lines     integer;
  v_deleted   integer;
begin
  if p_order_id is null then
    raise exception 'no order given';
  end if;

  select o.org_id, o.number, o.production_schedule_id
    into v_org_id, v_number, v_sched_id
    from special_orders o
   where o.id = p_order_id;

  if v_org_id is null then
    raise exception 'no such special order';
  end if;
  if v_sched_id is null then
    raise exception 'order % is not scheduled', v_number;
  end if;

  select s.printed_at into v_printed
    from production_schedules s where s.id = v_sched_id;

  select count(*) filter (where li.made is not null or li.leftover is not null),
         count(*)
    into v_counted, v_lines
    from production_schedule_items li
   where li.schedule_id = v_sched_id;

  if v_printed is not null then
    raise exception
      'the schedule for order % was printed on %; delete it from the schedule itself if you really mean to discard it',
      v_number, v_printed::date;
  end if;
  if coalesce(v_counted, 0) > 0 then
    raise exception
      'the schedule for order % has counted quantities on % of % lines; delete it from the schedule itself if you really mean to discard them',
      v_number, v_counted, v_lines;
  end if;

  delete from production_schedules s where s.id = v_sched_id;
  get diagnostics v_deleted = row_count;

  -- A delete matching no policy removes zero rows and returns NO error, so
  -- without this the order would be reported as unscheduled while still locked
  -- and still pointing at a live schedule. The `order_guide_entries` lesson.
  if v_deleted = 0 then
    raise exception
      'the schedule for order % was not deleted; you may not have permission',
      v_number;
  end if;

  -- The FK has already nulled `production_schedule_id`. The stage date is ours
  -- to clear: it claimed production was scheduled, and it is not any more.
  update special_orders o
     set order_scheduled_at = null
   where o.id = p_order_id;

  -- Retracting a DOCUMENT, never somebody's decision: a to-do or a status the
  -- workflow offer moved when this was scheduled stays exactly where a human
  -- put it.
  insert into special_order_events (org_id, order_id, author_id, message)
  values (v_org_id, p_order_id, auth.uid(),
          format('Production unscheduled — %s lines discarded', v_lines));

  return jsonb_build_object(
    'order_id', p_order_id,
    'number',   v_number,
    'schedule_id', v_sched_id,
    'lines_deleted', v_lines
  );
end $$;


-- 002's rule: every new public-schema function is executable by `anon` through
-- Supabase's defaults, and revoking from PUBLIC does not undo that.
revoke all on function schedule_special_order(uuid, date, date, text, jsonb) from public;
revoke all on function schedule_special_order(uuid, date, date, text, jsonb) from anon;
grant execute on function schedule_special_order(uuid, date, date, text, jsonb) to authenticated;

revoke all on function unschedule_special_order(uuid) from public;
revoke all on function unschedule_special_order(uuid) from anon;
grant execute on function unschedule_special_order(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   -- both functions exist, ONE row each (two would mean an argument list
--   -- drifted and an overload is live beside it):
--   select proname, count(*) from pg_proc
--    where proname in ('schedule_special_order', 'unschedule_special_order')
--    group by 1;
--     -> one row each, count 1
--
--   -- they refuse from their FIRST statement, so this does no work:
--   select public.schedule_special_order(null, null, null, null, null);
--     -> ERROR: no order given
--   select public.unschedule_special_order(null);
--     -> ERROR: no order given
--
--   -- `anon` is refused outright, not merely filtered:
--   set role anon; select public.unschedule_special_order(null);
--     -> ERROR: permission denied for function unschedule_special_order
--
--   -- and nothing has been scheduled yet:
--   select count(*) from production_schedules where source = 'special_order';
--     -> 0
