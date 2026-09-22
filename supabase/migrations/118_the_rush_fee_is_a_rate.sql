-- ============================================================================
-- 118 — THE RUSH FEE IS A RATE, AND A RUSH ORDER ARRIVES CARRYING IT
--
-- SQL STARTS AT LINE 63. Everything above it is comment.
--
-- Mark, 2026-09-22: "when creating a special order, if you notice the initiated
-- date is less than two business days from the event date, automatically apply
-- the rush fee" — and, asked which of three shapes he meant: "the user facing
-- rush fee field should be a percentage, i.e. 35%, but when applied to the
-- order it should be either the user facing percentage (i.e. 35%), or $25,
-- whichever is greater."
--
-- ----------------------------------------------------------------------------
-- WHY A COLUMN AND NOT A NUMBER WRITTEN AT CREATION
-- ----------------------------------------------------------------------------
-- A new order has NO LINES, so its subtotal is zero and 35% of it is nothing.
-- Writing the money at creation could only ever write the $25 floor, and that
-- figure would then sit there while somebody added $800 of donuts around it.
--
-- So the ORDER carries the RATE and the money is derived from it wherever the
-- money is computed — `orderTotals`, the one implementation everything reads.
-- `rush_fee` keeps its meaning as a typed dollar amount, which is what 946 real
-- orders carry and what a hand-set fee still is.
--
-- THE PAIR IS `discount_amount` / `discount_rate`'s, deliberately — same table,
-- same shape, same two labels on the record ("Rush fee ($)" beside "Rush fee
-- (%)"). The ARITHMETIC differs and Mark said so: a discount's two fields ADD,
-- where a rush rate resolves to `max(subtotal × rate, minimum)` and a rate
-- present means the amount is derived rather than added to.
--
-- ----------------------------------------------------------------------------
-- WHAT THE MEASUREMENT SAID, AND WHAT IT DID NOT
-- ----------------------------------------------------------------------------
-- Of 8,167 orders carrying both dates, 1,448 were initiated inside the
-- two-business-day window and **only 442 of those (31%) ever carried a rush
-- fee**. Outside the window, 8%. So twelve years of practice did NOT charge
-- this fee most of the times it applied, and decision 22 read that as "suggest,
-- never write" — the `→` on the record, which stays.
--
-- Mark has now asked for the write, having been shown the 31%. That is a policy
-- change rather than a misreading, and it is his to make: the old number
-- measures what FileMaker made easy, not what anybody decided.
--
-- ----------------------------------------------------------------------------
-- THE WHOLESALE TRAP, WHICH IS WHY THIS IS NOT A TRIGGER
-- ----------------------------------------------------------------------------
-- `OrderTotals` carries the warning in as many words: an automatic fee "would
-- charge a wholesale customer a rush fee every Friday, quietly". Cafe Knotted's
-- days are real orders with an event date a day or two out, and a rule that
-- fired on every INSERT would bill them a third more, every day, with nobody
-- typing anything.
--
-- It cannot happen, because the rule lives in `lib/createSpecialOrder` — the
-- three doors a PERSON creates an order through — and a standing order's days
-- are made by 099's `ensure_standing_orders_materialized`, which is SQL and
-- never calls it. Writing this as a trigger on `special_orders` would have
-- caught exactly the rows that must not be caught. The same reasoning excludes
-- a template and a standing order themselves: neither has a single event date
-- for the window to be measured against.
-- ============================================================================


alter table special_orders
  add column if not exists rush_rate numeric;

comment on column special_orders.rush_rate is
  'The rush fee as a FRACTION of the subtotal (0.35 is 35%), mirroring '
  'discount_rate. When set, the fee is max(subtotal * rush_rate, the orgs '
  'settings rush_minimum) and rush_fee is not added to it; when null, rush_fee '
  'is the fee. Written at creation by lib/createSpecialOrder when the event is '
  'inside the rush window.';


-- ----------------------------------------------------------------------------
-- THE LOG LEARNS THE NEW COLUMN
-- ----------------------------------------------------------------------------
-- 055's function reproduced IN FULL — its own rule, because it is APPLIED and a
-- file that no longer describes what was run is how the harness and production
-- quietly stop being the same database. Changed in EXACTLY ONE PLACE: one row
-- added to the watch list, marked below. Without it a rate change is the only
-- money edit on this record that writes no history.

create or replace function public.trg_log_special_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- (column, label) — the watch list, and the labels are the ones the Info tab
  -- prints, so a log entry names the field the reader can see.
  v_watch text[][] := array[
    ['title',                'Order name'],
    ['status',               'Status'],
    ['kind',                 'Kind'],
    ['event_date',           'Event date'],
    ['event_time',           'Event time'],
    ['ready_by_time',        'Ready by'],
    ['date_initiated',       'Initiated'],
    ['taken_by',             'Taken by'],
    ['taken_by_employee_id', 'Taken by'],
    ['customer_id',          'Customer'],
    ['contact_name',         'Day-of contact'],
    ['contact_phone',        'Contact phone'],
    ['contact_email',        'Contact email'],
    ['location_id',          'Pickup shop'],
    ['kitchen_location_id',  'Kitchen'],
    ['fulfillment',          'Pickup / delivery'],
    ['delivery_address',     'Delivery address'],
    ['delivery_company',     'Delivery company'],
    ['delivery_tracking',    'Delivery tracking'],
    ['delivery_window_start','Delivery window (from)'],
    ['delivery_window_end',  'Delivery window (to)'],
    ['delivery_cost',        'Delivery cost to us'],
    ['delivery_boxes',       'Boxes'],
    ['todo',                 'To-do'],
    ['flag_reason',          'Flag'],
    ['allergen_info',        'Allergies'],
    ['tax_rate',             'Tax rate'],
    ['discount_amount',      'Discount ($)'],
    ['discount_rate',        'Discount (rate)'],
    ['delivery_charge',      'Delivery charge'],
    ['rush_fee',             'Rush fee'],
    ['rush_rate',            'Rush fee (%)'],
    ['ignore_balance',       'Ignore the balance'],
    ['notes_general',        'Notes'],
    ['notes_quote',          'Quote note'],
    ['notes_production',     'Production note'],
    ['notes_invoice',        'Invoice note'],
    ['notes_receipt',        'Receipt note']
  ];
  v_old jsonb;
  v_new jsonb;
  v_parts text[] := '{}';
  v_phrase text;
  i int;
begin
  -- THE NEW BRANCH — the first line of every history is that the order exists.
  if tg_op = 'INSERT' then
    perform log_special_order_event(
      new.org_id, new.id,
      case new.kind
        when 'order'          then format('Order started as a %s', coalesce(new.status, 'lead'))
        when 'template'       then 'Template created'
        when 'standing_order' then 'Standing order created'
        else 'Created'
      end
    );
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  for i in 1 .. array_length(v_watch, 1) loop
    -- A column named here that this schema does not have is SKIPPED rather
    -- than raising: a trigger is not where a whole shop should find out.
    if v_new ? v_watch[i][1] then
      v_phrase := special_order_change_phrase(
        v_watch[i][1], v_watch[i][2],
        v_old ->> v_watch[i][1], v_new ->> v_watch[i][1]
      );
      if v_phrase is not null then
        v_parts := v_parts || v_phrase;
      end if;
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  perform log_special_order_event(new.org_id, new.id, array_to_string(v_parts, '; '));
  return null;
end;
$$;

revoke all on function public.trg_log_special_order() from public, anon, authenticated;

-- The trigger itself is NOT recreated: 055 already declared it `after insert or
-- update`, and a `create or replace` on the function keeps the trigger pointing
-- at the new body. Dropping and recreating it here would be a second place for
-- the two to disagree.


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select column_name, data_type from information_schema.columns
--    where table_name = 'special_orders' and column_name = 'rush_rate';
--     -> one row, numeric
--
--   select count(*) from special_orders where rush_rate is not null;
--     -> 0, until somebody creates a rush order
--
-- On a scratch order, signed in:
--   update special_orders set rush_rate = 0.35 where id = :id;
--   select message from special_order_events
--    where order_id = :id order by happened_at desc limit 1;
--     -> 'Rush fee (%) set to 0.35'
-- ----------------------------------------------------------------------------
