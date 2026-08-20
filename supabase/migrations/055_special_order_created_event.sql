-- ============================================================================
-- restaurantfriend — migration 055 · An order's history starts when it does
--
-- SQL STARTS AT LINE 31. Everything above it is comment.
--
-- 054 watched UPDATE only, so a brand-new order had an EMPTY history until
-- somebody edited it — which reads as the logging not working rather than as
-- nothing having happened yet. FileMaker wrote a line for it ("Order started by
-- tracit", 3,482 of its 106,465 entries); we did not.
--
-- IT IS ITS OWN MIGRATION RATHER THAN AN EDIT TO 054, and that is the rule
-- worth keeping: 054 is applied. Once a migration has run it is history, and a
-- file that no longer describes what was run is how the harness and production
-- quietly stop being the same database. 054 IS rerunnable — every statement in
-- it is `create or replace` — so re-pasting it would have worked; the ledger is
-- the reason not to.
--
-- WHAT IT DELIBERATELY DOES NOT LOG: the fields the order was created with. The
-- create dialog asks for six things and every one of them is on the screen
-- behind the log. What has no other record is the MOMENT — and, through the
-- `author` column, whose it was.
--
-- The rest of `trg_log_special_order` is byte-identical to 054's. It is
-- restated whole because `create or replace` cannot patch a function body, and
-- because a reader comparing the two should see one branch appear and nothing
-- else move.
--
-- Run in the Supabase SQL editor. Rerunnable.
-- ============================================================================

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

-- The trigger itself has to be recreated: 054 declared it `after update`, and
-- a `create or replace` on the FUNCTION does not widen the events it fires on.
drop trigger if exists trg_special_orders_log on special_orders;
create trigger trg_special_orders_log
  after insert or update on special_orders
  for each row execute function trg_log_special_order();
