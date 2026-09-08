-- ============================================================================
-- 099 — STANDING ORDERS MATERIALIZE THEMSELVES
--
-- SQL STARTS AT LINE 112. Everything above it is comment.
-- ============================================================================
--
-- Decision 13, finally written. 051 shipped the whole seam and left it unused:
-- `kind = 'standing_order'`, `standing_days`, `starts_on`, `ends_on`, `paused`
-- and `standing_order_id` all exist; `special_orders_standing_day` is the
-- idempotency key this function is safe to call on every page load because of;
-- `special_orders_standing_idx` was created FOR "the materializer's own sweep"
-- and has never had a reader; and `orgs.settings.special_orders.horizon_days`
-- has been 14 since 057 with nothing consulting it. The record screen has been
-- telling people since August that "orders appear by themselves 14 days ahead
-- — nobody has to remember", which was false: measured 2026-09-08, ZERO rows
-- in the whole database carry a `standing_order_id`, and Cafe Knotted's last
-- wholesale day was 2026-08-23, sixteen days earlier, loaded out of FileMaker.
--
-- ----------------------------------------------------------------------------
-- NOBODY INSTANTIATES, AND THERE IS NO CRON
-- ----------------------------------------------------------------------------
-- FMP had an Instantiate button and Mark forgot to press it ("Sometimes I
-- forget. I've often wondered if there was a better way."). This is that better
-- way: the horizon tops itself up from the two moments that need the orders to
-- be real — opening the special orders list, and opening the generate-schedules
-- dialog — plus a "Materialize now…" escape hatch on the standing order itself
-- for a one-off beyond the horizon. Three doors, ONE function, 013's precedent.
--
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER, DELIBERATELY — 068's ARGUMENT VERBATIM
-- ----------------------------------------------------------------------------
-- Every insert flows through 051's own supervisor+ policies, so this function
-- cannot create an order that its caller could not have created by hand, even
-- if the role check below is one day edited wrongly. A definer would make the
-- top-up a hole in the one rule the module has about who may write an order.
--
-- WHICH MAKES THE ROLE CHECK'S SHAPE LOAD-BEARING, and it is the opposite of
-- every other guard in this schema: **below supervisor+ it RETURNS, it does not
-- raise.** 092 widened `special_orders_select` to every member, so staff can
-- read `/special-orders` — and the list calls this before it queries. A raise
-- would replace the whole screen with a role error for the people who are least
-- able to do anything about it. They see whatever the horizon already holds;
-- the horizon fills the moment a supervisor works, which is every day.
--
-- Atomicity is the function body's own transaction, so an order can never rest
-- with a header and no lines.
--
-- ----------------------------------------------------------------------------
-- THE THREE RULES THAT KEEP IT HONEST
-- ----------------------------------------------------------------------------
-- 1. **It never makes a day before `p_from`, and `p_from` is passed in.**
--    `current_date` is UTC, so after 4pm Pacific it is tomorrow — 068's stamp
--    problem, except here it would silently skip a day of wholesale. Every
--    caller already holds the org's calendar day (`lib/today`).
--
--    It also does NOT backfill. Cafe Knotted's sixteen missing days are days
--    that have HAPPENED; creating them now would put orders nobody delivered
--    into the books and onto a statement. The horizon runs forward only.
--
-- 2. **An existing row blocks re-creation, INCLUDING A CANCELLED ONE.** That is
--    the whole point of 051's partial unique index and it is stated there:
--    cancelling Thanksgiving is a decision that must stick. Consequence, and
--    the app enforces it in the delete confirm: a materialized day is
--    CANCELLED, never deleted — deleting it means the next top-up makes the
--    donuts again.
--
--    The `exists` check and `on conflict do nothing` are both here on purpose.
--    The check is what stops a burned order number (013's rule: a vendor with
--    no lines must not consume a sequence number), and the `on conflict` is the
--    race guard for two page loads landing together.
--
-- 3. **A misconfigured standing order is NAMED, never guessed at.** No weekday
--    set, or no items, and it is skipped with a reason in the receipt — 040's
--    "names every coercion in its receipt". An empty wholesale order made every
--    day for a standing order somebody half-filled-in is worse than none, and
--    it is recoverable: add the line and the next top-up fills the horizon.
--
-- ----------------------------------------------------------------------------
-- WHAT A MATERIALIZED DAY IS
-- ----------------------------------------------------------------------------
-- Indistinguishable from a hand-made order and freely editable — kind `order`,
-- status `order`, to-do "Print Order", the standing order's header snapshot and
-- its items copied, `standing_order_id` set, and a log entry naming the source.
-- "Add 100 this Friday" is an edit to that Friday's order; editing the STANDING
-- order changes only days not yet made, which is what makes the two useful.
--
-- WHAT IS DELIBERATELY NOT COPIED: the recurrence columns themselves
-- (`standing_days`, `starts_on`, `ends_on`, `paused` — a child that carried
-- them would look like a second standing order); every stage date, the flag,
-- the production schedule link and `external_ref` (facts about a document that
-- has not been produced yet); and `delivery_tracking`, which belongs to one
-- shipment. `date_initiated` is the day the row was MADE, not the standing
-- order's own — dating fourteen days to one August afternoon says nothing.
--
-- To-do is written, which is decision 4's stated exception rather than a breach
-- of it: `createSpecialOrder` already seeds "Respond to Email/Call" on a new
-- lead for the same reason. The to-do here is not a guess about a workflow, it
-- is what this act produced.
--
-- ----------------------------------------------------------------------------
-- THE WINDOW IS THE CALLER'S, AND IT IS CAPPED
-- ----------------------------------------------------------------------------
-- `horizon_days` lives in `orgs.settings` (design rule 2) and is read by the
-- callers, not here — because the escape hatch's whole job is to reach PAST the
-- horizon, so a function that computed it could not serve all three doors. The
-- 366-day cap is what stops a mistyped year turning into a decade of wholesale
-- orders, and `p_max` caps one call's output for the same reason.
--
-- Run in the Supabase SQL editor. RERUNNABLE (`create or replace`).
-- ============================================================================

create or replace function public.ensure_standing_orders_materialized(
  p_org_id   uuid,
  p_from     date,
  p_through  date,
  -- Null = every standing order in the org, which is what the two automatic
  -- callers want. The escape hatch on a record names one.
  p_order_id uuid default null,
  -- One call's ceiling. 200 is ~14 standing orders over a full 14-day horizon;
  -- reaching it means something is wrong, so it is reported rather than looped.
  p_max      integer default 200
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_so        record;
  v_date      date;
  v_start     date;
  v_end       date;
  v_number    text;
  v_new_id    uuid;
  v_author    text;
  v_made      jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_created   integer := 0;
  v_existing  integer := 0;
  v_lines     integer;
  v_seen      integer := 0;
  v_capped    boolean := false;
begin
  if p_org_id is null then
    raise exception 'no organisation given';
  end if;
  -- THE ORG'S CALENDAR DAY, PASSED IN, NEVER `current_date` — see rule 1.
  if p_from is null or p_through is null then
    raise exception 'no date range given';
  end if;
  if p_through - p_from > 366 then
    raise exception 'that range is % days; the most this will make at once is a year', p_through - p_from;
  end if;

  -- Membership decides whose data this may see at all, and the answer is the
  -- same sentence for "no such org" and "not yours" (068's rule) — an error
  -- that told them apart would say whether an org exists to somebody outside
  -- it.
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor', 'staff']) then
    raise exception 'not your organisation';
  end if;

  -- RETURNS, DOES NOT RAISE. See the header: the list calls this on every load
  -- and staff can read the list.
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    return jsonb_build_object(
      'ok', true, 'created', 0, 'existing', 0, 'skipped', 'role',
      'orders', v_made, 'warnings', v_warnings);
  end if;

  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  for v_so in
    select s.id, s.number, s.title, s.standing_days, s.starts_on, s.ends_on, s.paused
      from special_orders s
     where s.org_id = p_org_id
       and s.kind = 'standing_order'
       and (p_order_id is null or s.id = p_order_id)
     order by s.number
  loop
    v_seen := v_seen + 1;

    if v_so.paused then
      -- Silent in a sweep — pausing is a decision, and naming it every time
      -- anybody opens the list is how a receipt stops being read. Named when
      -- somebody has asked for this one BY NAME and nothing happened.
      if p_order_id is not null then
        v_warnings := v_warnings || jsonb_build_object(
          'standing_number', v_so.number, 'title', v_so.title, 'reason', 'paused');
      end if;
      continue;
    end if;

    if v_so.standing_days is null or cardinality(v_so.standing_days) = 0 then
      -- `cardinality`, never `array_length(x, 1)`, which is NULL on an empty
      -- array — 076's lesson, and here it would silently take this branch's
      -- opposite.
      v_warnings := v_warnings || jsonb_build_object(
        'standing_number', v_so.number, 'title', v_so.title, 'reason', 'no weekdays set');
      continue;
    end if;

    select count(*) into v_lines from special_order_items li where li.order_id = v_so.id;
    if v_lines = 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'standing_number', v_so.number, 'title', v_so.title, 'reason', 'no items to make');
      continue;
    end if;

    v_start := greatest(p_from, coalesce(v_so.starts_on, p_from));
    v_end   := least(p_through, coalesce(v_so.ends_on, p_through));

    for v_date in
      select d::date from generate_series(v_start, v_end, interval '1 day') d
    loop
      if not (extract(isodow from v_date)::smallint = any(v_so.standing_days)) then
        continue;
      end if;

      if exists (
        select 1 from special_orders x
         where x.standing_order_id = v_so.id and x.event_date = v_date
      ) then
        v_existing := v_existing + 1;
        continue;
      end if;

      if v_created >= p_max then
        v_capped := true;
        exit;
      end if;

      -- Only now: a number allocated for a day that already exists is a number
      -- burned for nothing (013's rule).
      v_number := next_special_order_number(p_org_id);

      insert into special_orders (
        org_id, number, kind, status, todo,
        customer_id, contact_name, contact_phone, contact_email, allergen_info,
        title, event_date, event_time, ready_by_time,
        location_id, kitchen_location_id, fulfillment,
        delivery_address, delivery_distance, delivery_cost, delivery_company,
        delivery_company_phone, delivery_window_start, delivery_window_end,
        delivery_boxes, delivery_weight_lbs,
        tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
        ignore_balance, taken_by,
        notes_general, notes_quote, notes_production, notes_invoice, notes_receipt,
        date_initiated, standing_order_id, source, created_by
      )
      select
        s.org_id, v_number, 'order', 'order', 'Print Order',
        s.customer_id, s.contact_name, s.contact_phone, s.contact_email, s.allergen_info,
        s.title, v_date, s.event_time, s.ready_by_time,
        s.location_id, s.kitchen_location_id, s.fulfillment,
        s.delivery_address, s.delivery_distance, s.delivery_cost, s.delivery_company,
        s.delivery_company_phone, s.delivery_window_start, s.delivery_window_end,
        s.delivery_boxes, s.delivery_weight_lbs,
        s.tax_rate, s.discount_amount, s.discount_rate, s.delivery_charge, s.rush_fee,
        s.ignore_balance, s.taken_by,
        s.notes_general, s.notes_quote, s.notes_production, s.notes_invoice, s.notes_receipt,
        p_from, s.id, 'app', auth.uid()
        from special_orders s
       where s.id = v_so.id
      on conflict (standing_order_id, event_date) where standing_order_id is not null
        do nothing
      returning id into v_new_id;

      -- The race guard fired: somebody else's page load made this day between
      -- the `exists` above and here. The number is spent; that is the cost of
      -- being correct, and it happens about never.
      if v_new_id is null then
        v_existing := v_existing + 1;
        continue;
      end if;

      insert into special_order_items (
        org_id, order_id, sort, production_item_id, name,
        item_donut, item_type, item_cut, item_finish, item_size,
        notes, qty, unit_price, taxable
      )
      select li.org_id, v_new_id, li.sort, li.production_item_id, li.name,
             li.item_donut, li.item_type, li.item_cut, li.item_finish, li.item_size,
             li.notes, li.qty, li.unit_price, li.taxable
        from special_order_items li
       where li.order_id = v_so.id;

      -- WHERE IT CAME FROM. 054's trigger already wrote "Order started as a
      -- order" and the item trigger a line each; neither says this was not
      -- typed by a person. `OrderActions`' own "Duplicated from order N" is the
      -- precedent — a fact with no watched column behind it.
      insert into special_order_events (org_id, order_id, author, author_id, message, source)
      values (
        p_org_id, v_new_id, v_author, auth.uid(),
        format('Made from standing order %s%s',
               v_so.number,
               case when coalesce(btrim(v_so.title), '') = '' then '' else ' — ' || v_so.title end),
        'app');

      v_created := v_created + 1;
      v_made := v_made || jsonb_build_object(
        'number', v_number,
        'event_date', v_date,
        'standing_number', v_so.number,
        'title', v_so.title);
    end loop;

    exit when v_capped;
  end loop;

  if v_capped then
    v_warnings := v_warnings || jsonb_build_object(
      'reason', format('stopped at %s orders — run it again to carry on, or check the weekday sets', p_max));
  end if;

  if p_order_id is not null and v_seen = 0 then
    raise exception 'no such standing order';
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'existing', v_existing,
    'from', p_from,
    'through', p_through,
    'orders', v_made,
    'warnings', v_warnings);
end;
$$;

comment on function public.ensure_standing_orders_materialized(uuid, date, date, uuid, integer) is
  'Decision 13 - tops standing orders up to a rolling horizon. Idempotent on '
  '(standing_order_id, event_date); a cancelled day still blocks re-creation. '
  'Invoker, so every insert flows through 051''s supervisor+ policies; below '
  'supervisor+ it returns skipped rather than raising, because the list calls '
  'it and staff may read the list.';

-- 002's rule: a new public-schema function is executable by `anon` through
-- Supabase's default privileges, and revoking from PUBLIC does not undo that.
revoke all on function public.ensure_standing_orders_materialized(uuid, date, date, uuid, integer) from public;
revoke all on function public.ensure_standing_orders_materialized(uuid, date, date, uuid, integer) from anon;
grant execute on function public.ensure_standing_orders_materialized(uuid, date, date, uuid, integer) to authenticated;


-- ----------------------------------------------------------------------------
-- THE STANDING ORDERS THAT SHOULD NOT RUN (Mark, 2026-09-08: "everything
-- should be paused except 9762 and 9763")
-- ----------------------------------------------------------------------------
-- Ten standing orders came out of FileMaker and two of them are the live
-- wholesale account. The other eight are:
--
--   · **Yeastie Boys x7**, one per weekday, unpaused with `starts_on` null and
--     84 Black and White Bismarks each. Their last real order was **February
--     2025**. Switching the top-up on without this would have created a week of
--     orders for a dormant account before anybody saw the screen — which is
--     exactly why decision 13 said the MIGRATION must materialize nothing and
--     the first top-up must happen in the app, after the standing orders have
--     been looked at.
--   · **#10018 "Cafe Knotted SO Mo-Th"**, an app-numbered duplicate of #9762
--     carrying the same 370 Knotted Bismarks and an EMPTY weekday set. It would
--     have made nothing and warned about itself forever.
--
-- Pausing rather than deleting, and that is the same call 051 makes about a
-- cancelled day: a standing order is a record of an arrangement, and Yeastie
-- Boys may come back. Unpausing is one tap on the record.
--
-- Scoped by `kind` and by NOT being one of the two, so it cannot touch an
-- ordinary order. Rerunnable — a second run updates the same eight rows to the
-- same value.
update special_orders
   set paused = true
 where kind = 'standing_order'
   and not paused
   and number not in ('9762', '9763');
