-- ============================================================================
-- 112 — A STANDING ORDER CARRIES THE STATUS AND TO-DO ITS DAYS START WITH
--
-- Mark, 2026-09-20: "the most simple solution, to me, is to allow the user to
-- set the status of a standing order, and copy it when instantiating it."
--
-- He is right, and the argument is one line long: `status` and `todo` were the
-- ONLY two fields 099's insert hardcoded. Every other value on a day —title,
-- event time, tax rate, `ignore_balance`, the notes, the address — is there
-- because a standing order is a PROTOTYPE and its days inherit it. Those two
-- being literals was the anomaly, not the design, and a separate
-- `standing_day_status` column would have been a second way to say what this
-- table already says.
--
-- WHY IT IS WANTED: Cafe Knotted pays in advance, so a day materialized on
-- Monday for Friday is not paid for and must not reach a kitchen night. Another
-- wholesale account billed in arrears wants the opposite. One literal cannot be
-- right for both; a field on each template is.
--
-- ----------------------------------------------------------------------------
-- THE CONSTRAINT IS WIDENED, NOT DROPPED
-- ----------------------------------------------------------------------------
-- 051 proved `special_orders_status_iff_order` by BREAKING it on the Docker
-- harness, in both directions, and that is worth keeping. So it stays a
-- biconditional and gains one kind:
--
--     (kind in ('order','standing_order')) = (status is not null)
--
-- A `template` still may not hold one, and that is not timidity — a template is
-- DUPLICATED, not instantiated on a schedule, so it has no days to prototype
-- and nothing to say. The two claims below are still refused, and are still
-- worth proving by hand after this runs:
--
--     insert ... (kind, status) values ('template', 'lead')  -> refused
--     insert ... (kind, status) values ('order', null)       -> refused
--
-- ORDER MATTERS IN THIS FILE. The two existing standing orders hold NULL, which
-- the WIDER constraint forbids — so the old one is dropped, the rows are set,
-- and only then is the new one added. Adding it first fails on the rows it is
-- being added for.
--
-- WHAT IS NOT DONE HERE: nothing is backfilled onto days already made. A day
-- that has been made, delivered and eaten is not waiting for an invoice.
--
-- Run in the Supabase SQL editor. RERUNNABLE.
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

alter table special_orders
  drop constraint if exists special_orders_status_iff_order;

-- Mark's instruction, 2026-09-20: "set the two existing standing order status'
-- to 'Invoice' and the to do to 'Send Invoice'". `where status is null` so a
-- rerun cannot stamp over a template somebody has since changed.
update special_orders
   set status = 'invoice',
       todo   = coalesce(todo, 'Send Invoice')
 where kind = 'standing_order'
   and status is null;

alter table special_orders
  add constraint special_orders_status_iff_order
  check ((kind in ('order', 'standing_order')) = (status is not null));

comment on constraint special_orders_status_iff_order on special_orders is
  'Decision 3, widened by 112: an ORDER has a status and a STANDING ORDER has '
  'the status its days start with. A template has neither - it is duplicated, '
  'not instantiated, so it has no days to prototype.';


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
        -- COPIED, NOT HARDCODED, SINCE 112 (Mark, 2026-09-20). 099 wrote
        -- 'order' and 'Print Order' here. They were the only two fields on this
        -- insert that did not come from the template — everything else in this
        -- select is `s.something` — and that was the anomaly rather than the
        -- design. `coalesce` is belt: the widened constraint makes a null
        -- status impossible on a standing order, and a migration that trusts a
        -- constraint it just wrote is a migration that fails on the one row
        -- nobody checked.
        s.org_id, v_number, 'order', coalesce(s.status, 'order'), s.todo,
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
