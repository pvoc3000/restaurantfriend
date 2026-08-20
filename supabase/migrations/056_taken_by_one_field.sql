-- ============================================================================
-- restaurantfriend — migration 056 · "Taken by" is one field, not two
--
-- SQL STARTS AT LINE 28. Everything above it is comment.
--
-- Found by using it, minutes after 055 went in. Picking somebody from the
-- roster writes BOTH halves of the field in one statement — 053's link set, and
-- the text it supersedes cleared — and both halves carry the label "Taken by",
-- so the entry came out:
--
--     Taken by cleared (was Mark); Taken by set to Mark Trombino
--
-- Every word of that is true and it reads like a glitch, on the commonest edit
-- this field will ever see. The link is the answer; the text going is
-- bookkeeping nobody needs a line about.
--
-- So the text half is suppressed WHEN THE LINK MOVED IN THE SAME STATEMENT, and
-- only then. Editing the legacy text on one of the 7,944 migrated orders that
-- has no link still logs exactly as before, which is the case where that text
-- IS the answer.
--
-- Nothing but the function changes: 055's trigger already fires on insert and
-- update, and this does not touch it.
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
  v_link_moved boolean;
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

  -- TWO COLUMNS, ONE FIELD. `taken_by` is FileMaker's text and
  -- `taken_by_employee_id` is 053's link, and picking somebody from the roster
  -- writes BOTH in one statement — the link set, the superseded text cleared.
  -- Both carry the label "Taken by", so the entry came out
  --
  --     Taken by cleared (was Mark); Taken by set to Mark Trombino
  --
  -- which is true and reads like a glitch, on the commonest edit this field
  -- will ever see. The link is the answer; the text going is bookkeeping.
  v_link_moved := (v_new ? 'taken_by_employee_id')
    and (v_old ->> 'taken_by_employee_id') is distinct from (v_new ->> 'taken_by_employee_id');

  for i in 1 .. array_length(v_watch, 1) loop
    continue when v_link_moved and v_watch[i][1] = 'taken_by';
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
