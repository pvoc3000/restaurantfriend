-- ============================================================================
-- restaurantfriend — migration 054 · The order's history writes itself
--
-- SQL STARTS AT LINE 106. Everything above it is comment.
--
-- Mark, 2026-08-19: "no edits I make to my test order are getting logged as
-- events in the history section. Is that still to come?" — and then: "i would
-- want our app to log/record more events than FMP did. adding/editing/removing
-- items was absent from FMP and would be nice to have."
--
-- It was never built. Until now `special_order_events` had four writers and all
-- four were ACTS somebody performed on a screen (a document emailed, paperwork
-- filed, an order flagged, a freehand note). Nothing watched the RECORD, so
-- changing an event date, a price or a quantity left no trace at all.
--
-- ---------------------------------------------------------------------------
-- FILEMAKER LOGGED FIELD EDITS AND WE DID NOT. Measured over its own 106,465
-- entries, the top shapes are more than half field changes:
--
--     8,726  Emailed Quote                        (we had this)
--     8,045  Order Type set to Quote              ← a column
--     5,651  Order printed                        (we had this)
--     4,792  Order To Do cleared                  ← a column
--     3,457  Order Taken By changed to Traci      ← a column
--     1,434  Changed Event Date to #/#/#          ← a column
--     1,262  Delivery Charge changed to #.#       ← a column
--       805  Changed Time to be Ready to #:#am    ← a column
--       720  Changed Pickup or Delivery to …      ← a column
--
-- So this is not a new idea, it is a missing half. What IS new is the lines and
-- the payments: FileMaker never logged either, and Mark asked for both.
--
-- ---------------------------------------------------------------------------
-- IT IS A TRIGGER, WHICH IS THE HOUSE PATTERN AND NOT A SHORTCUT.
--
-- Design rule 6 already says it for the catalog: "Price and par changes are
-- logged automatically by DB triggers — don't log in app code." The same two
-- reasons apply here and the second is the one that matters. A screen can
-- forget; a trigger cannot. And there are already FOUR ways an order changes —
-- inline cells, the two edge functions, `approve_quote_by_token`, and whatever
-- phase 4 adds — so app-side logging would have to be remembered in each, and
-- the day it is forgotten looks exactly like the bug Mark just reported.
--
-- IT IS `security definer`, WHICH IS ALSO 001's ANSWER — `log_price_change`
-- and its three siblings are definers for the same job. Written plain first,
-- and the harness said no twice:
--
--   · the writer calls `auth.uid()`, which a plain function reaches only if
--     the caller has USAGE on the `auth` schema; and
--   · the value renderer reads `employees`, which 020 gates to owner/admin —
--     so a SUPERVISOR's edit would have logged "a record that no longer
--     exists" where the taker's name belongs.
--
-- The usual objection to a definer does not apply here, and it is worth saying
-- why rather than waving it through: a definer must re-check what RLS would
-- have, and these already have. The trigger fires only AFTER a change that
-- passed the table's own policy, so the act was authorised before the log
-- hears about it. What a definer WOULD open is a direct call — anyone forging
-- an entry on any order — so **execute is revoked from `authenticated`, not
-- granted to it**. A trigger's permission is checked when the trigger is
-- created, not each time it fires, so nothing needs the grant.
--
-- The non-definer version had one further fault that only shows under load: it
-- coupled every edit to a SECOND policy, so a mismatch there would abort the
-- update itself rather than merely failing to log it.
--
-- ---------------------------------------------------------------------------
-- FOUR DECISIONS INSIDE IT, each of which the obvious version gets wrong.
--
-- **ONE ENTRY PER STATEMENT, not per column.** An edit that touches three
-- columns is one thing that happened, and one line saying so reads better than
-- three. It also settles the double-entry problem by construction: flagging an
-- order writes `flag_reason` AND `todo`, and this is one sentence about it.
--
-- **`sort` IS NOT WATCHED, and this is the one omission that would flood the
-- log.** Dragging a line to reorder renumbers the WHOLE list — 21 rows on a
-- real order — so watching it would turn one gesture into twenty-one entries
-- and bury everything else. The order of the lines is visible in the lines.
--
-- **NEITHER ARE THE STAGE DATES** (`quote_sent_at` and its four siblings) or
-- `updated_at`/`updated_by`. The stage dates are set BY acts that already write
-- their own entry — "Emailed Quote", "Quote approved online by …" — so watching
-- them would print each of those twice, once in words and once as a date.
--
-- **A VALUE THAT MEANS NOTHING RAW IS RESOLVED.** A uuid in a log entry is a
-- line nobody can read, so locations render as their code, the customer and the
-- employee as their name. Everything else is rendered as text, which is what
-- `to_jsonb` gives for free and is right for money, dates and times.
--
-- ---------------------------------------------------------------------------
-- CONSEQUENCE FOR THE APP, and it must land WITH this migration: two of the
-- four existing app-side writers now say what the trigger says.
--
--   · `OrderActions` cancel wrote "Order cancelled" — the trigger writes
--     "Status changed from Order to Cancelled", which is strictly more.
--   · `OrderActions` flag/resolve wrote "Flagged: <reason>" / "Issue resolved"
--     — the trigger watches `flag_reason` and `todo` and says both.
--
-- Both are removed in the same commit. The two that STAY are acts with no
-- column behind them: filing a document, and the freehand note.
--
-- Run in the Supabase SQL editor. Rerunnable.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. THE WRITER
-- ----------------------------------------------------------------------------
-- One insert, with the author resolved once. `author_id` is the app user;
-- `author` is their display name, which is what the history column shows and
-- what FileMaker's 106,465 rows carry (names, not ids).
--
-- A null message writes NOTHING. Every trigger below funnels through here, and
-- "nothing worth saying changed" is the common case for an update that touched
-- only an unwatched column.
create or replace function public.log_special_order_event(
  p_org_id uuid,
  p_order_id uuid,
  p_message text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author text;
begin
  if p_message is null or btrim(p_message) = '' then
    return;
  end if;

  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  insert into special_order_events (org_id, order_id, author, author_id, message, source)
  values (p_org_id, p_order_id, v_author, auth.uid(), p_message, 'app');
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. RENDERING ONE VALUE
-- ----------------------------------------------------------------------------
-- `to_jsonb(row)->>'col'` gives text for everything, which is right for money,
-- dates, times and booleans. The three FK columns are the exception: a uuid in
-- a sentence is a line nobody can read.
create or replace function public.special_order_value_label(p_column text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_value is null or p_value = '' then
    return null;
  end if;

  if p_column in ('location_id', 'kitchen_location_id') then
    select l.code into v from locations l where l.id = p_value::uuid;
  elsif p_column = 'customer_id' then
    select coalesce(nullif(btrim(coalesce(c.company, '')), ''),
                    btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))
      into v from customers c where c.id = p_value::uuid;
  elsif p_column = 'taken_by_employee_id' then
    select coalesce(nullif(btrim(e.nickname), ''), e.first_name) || ' ' || e.last_name
      into v from employees e where e.id = p_value::uuid;
  else
    return p_value;
  end if;

  -- A row that has since been deleted still gets a legible entry.
  return coalesce(v, 'a record that no longer exists');
end;
$$;


-- One column's change, in words. Null when it did not change.
create or replace function public.special_order_change_phrase(
  p_column text,
  p_label text,
  p_before text,
  p_after text
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_before text := special_order_value_label(p_column, p_before);
  v_after  text := special_order_value_label(p_column, p_after);
begin
  if p_before is not distinct from p_after then
    return null;
  end if;

  -- THREE SENTENCES, NOT ONE. "changed from — to 3" reads as a glitch; the
  -- first value a field has ever held is "set to", and emptying one is
  -- "cleared", which is the wording FileMaker used and the wording that says
  -- an empty field was somebody's decision rather than an oversight.
  if v_after is null then
    return format('%s cleared (was %s)', p_label, v_before);
  elsif v_before is null then
    return format('%s set to %s', p_label, v_after);
  else
    return format('%s changed from %s to %s', p_label, v_before, v_after);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. THE ORDER ITSELF
-- ----------------------------------------------------------------------------
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
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_parts text[] := '{}';
  v_phrase text;
  i int;
begin
  for i in 1 .. array_length(v_watch, 1) loop
    -- A column named here that this schema does not have is SKIPPED rather
    -- than raising: the delivery block's columns arrived with 051 and the
    -- next phase may add or rename one, and a trigger is not where a whole
    -- shop should find out.
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

drop trigger if exists trg_special_orders_log on special_orders;
create trigger trg_special_orders_log
  after update on special_orders
  for each row execute function trg_log_special_order();


-- ----------------------------------------------------------------------------
-- 4. THE LINES — what FileMaker never recorded
-- ----------------------------------------------------------------------------
create or replace function public.trg_log_special_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watch text[][] := array[
    ['name',        'name'],
    ['qty',         'quantity'],
    ['unit_price',  'price'],
    ['notes',       'note'],
    ['taxable',     'taxable'],
    ['item_donut',  'donut'],
    ['item_type',   'type'],
    ['item_cut',    'cut'],
    ['item_finish', 'finish'],
    ['item_size',   'size']
  ];
  v_old jsonb;
  v_new jsonb;
  v_parts text[] := '{}';
  v_phrase text;
  i int;
begin
  if tg_op = 'INSERT' then
    perform log_special_order_event(
      new.org_id, new.order_id,
      -- `FM…0.99` leaves a TRAILING POINT on a whole number — "Added 12. ×",
      -- which the harness printed before this rtrim. Quantities here are
      -- usually whole and occasionally not, so neither a fixed 2dp nor an
      -- integer cast is right.
      format('Added %s × %s',
             rtrim(rtrim(to_char(coalesce(new.qty, 0), 'FM999999990.99'), '0'), '.'),
             new.name)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform log_special_order_event(
      old.org_id, old.order_id,
      format('Removed %s × %s',
             rtrim(rtrim(to_char(coalesce(old.qty, 0), 'FM999999990.99'), '0'), '.'),
             old.name)
    );
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  for i in 1 .. array_length(v_watch, 1) loop
    -- `sort` IS DELIBERATELY ABSENT — see the header. One drag renumbers the
    -- whole list, and watching it would bury the log under one gesture.
    v_phrase := special_order_change_phrase(
      v_watch[i][1], v_watch[i][2],
      v_old ->> v_watch[i][1], v_new ->> v_watch[i][1]
    );
    if v_phrase is not null then
      v_parts := v_parts || v_phrase;
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  -- The LINE is named first, because an order carries twenty of these and
  -- "price changed from 5.10 to 5.50" alone says nothing about which donut.
  perform log_special_order_event(
    new.org_id, new.order_id,
    format('%s — %s', new.name, array_to_string(v_parts, '; '))
  );
  return null;
end;
$$;

drop trigger if exists trg_special_order_items_log on special_order_items;
create trigger trg_special_order_items_log
  after insert or update or delete on special_order_items
  for each row execute function trg_log_special_order_item();


-- ----------------------------------------------------------------------------
-- 5. THE PAYMENTS
-- ----------------------------------------------------------------------------
-- FileMaker logged "Payment $#.# received" 1,127 times, so the insert is its
-- idea; the update and the delete are ours.
create or replace function public.trg_log_special_order_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watch text[][] := array[
    ['amount',       'amount'],
    ['paid_on',      'date'],
    ['payment_type', 'method'],
    ['note',         'note'],
    ['external_ref', 'reference']
  ];
  v_old jsonb;
  v_new jsonb;
  v_parts text[] := '{}';
  v_phrase text;
  i int;
begin
  if tg_op = 'INSERT' then
    perform log_special_order_event(
      new.org_id, new.order_id,
      format('Payment of %s recorded%s',
             to_char(coalesce(new.amount, 0), 'FM$999,999,990.00'),
             coalesce(' · ' || nullif(btrim(new.payment_type), ''), ''))
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform log_special_order_event(
      old.org_id, old.order_id,
      format('Payment of %s removed', to_char(coalesce(old.amount, 0), 'FM$999,999,990.00'))
    );
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  for i in 1 .. array_length(v_watch, 1) loop
    v_phrase := special_order_change_phrase(
      v_watch[i][1], v_watch[i][2],
      v_old ->> v_watch[i][1], v_new ->> v_watch[i][1]
    );
    if v_phrase is not null then
      v_parts := v_parts || v_phrase;
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  perform log_special_order_event(
    new.org_id, new.order_id,
    format('Payment — %s', array_to_string(v_parts, '; '))
  );
  return null;
end;
$$;

drop trigger if exists trg_special_order_payments_log on special_order_payments;
create trigger trg_special_order_payments_log
  after insert or update or delete on special_order_payments
  for each row execute function trg_log_special_order_payment();


-- 002's rule, and then some: these are definers with NO caller but the trigger
-- machinery, so nothing is granted back. A direct call is what a definer would
-- otherwise open — forging a log entry on any order — and a trigger's
-- permission is checked when it is CREATED, not each time it fires.
revoke all on function public.log_special_order_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.special_order_value_label(text, text) from public, anon, authenticated;
revoke all on function public.special_order_change_phrase(text, text, text, text) from public, anon, authenticated;
revoke all on function public.trg_log_special_order() from public, anon, authenticated;
revoke all on function public.trg_log_special_order_item() from public, anon, authenticated;
revoke all on function public.trg_log_special_order_payment() from public, anon, authenticated;
