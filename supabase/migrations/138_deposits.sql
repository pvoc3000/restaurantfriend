-- ============================================================================
-- 138 — DEPOSITS: a part of the order's one invoice, never an invoice of its own
-- ============================================================================
--
-- Mark, 2026-09-25: "Being able to place a deposit is my next priority here. I
-- want to get it right." Researched against QuickBooks, whose two deposit
-- flows (a deposit requested on the invoice; a deposit requested on the
-- estimate, which converts to an invoice) both end in ONE invoice with the
-- deposit as its first payment — Square's invoices do the same. So a deposit
-- is NOT a second invoice (124's header imagined one; withdrawn), and every
-- payment stays on the order's one invoice, which is the order's Payments tab
-- as Mark described it: each payment, with a link to its invoice.
--
-- His answers:
--   · "deposit as a percentage setting" — `orgs.settings.special_orders.
--     deposit_rate`, a FRACTION like `rush_rate` (0.10 is 10%), seeded here.
--   · "most orders will just pay all at once. A deposit would be an edge case
--     … We need to be able to take a deposit, without having to take a
--     deposit." — so it is OPT-IN PER ORDER: `special_orders.deposit_rate`,
--     null = no deposit asked for. The app copies the setting onto the order
--     when somebody switches it on, so changing the setting later does not
--     move a deposit already quoted.
--   · The switch lives on the ORDER, not the invoice: the quote asks for it
--     before any invoice exists, and one fact in one place cannot drift.
--   · When a deposit is asked for, the customer may pay EITHER the deposit OR
--     the whole balance. The pay link offers both; the browser sends which
--     one, never a figure (119's rule stands — the amount is the server's).
--   · Approving a quote that asks for a deposit CREATES the order's invoice,
--     as a draft, and takes no payment ("Invoice made, no payment yet") — the
--     deposit is paid when that invoice is sent. QuickBooks' estimate →
--     invoice conversion, without its pay-on-approval step.
--
-- WHAT A DEPOSIT IS: the order's total × its rate, to the cent the way the
-- order's screen rounds (128's `js_cents`), never more than the line bills.
-- An invoice's deposit is the sum over its orders. It is MET once the payments
-- on the invoice reach it; after that the link charges the balance only.
--
-- NOTHING ELSE MOVES. A deposit does not settle an order (allocate's `v_share
-- >= v_owed` already says so), does not stamp a paid date and does not move a
-- status — 121's "a deposit moves nothing". Deposits are booked as income
-- today (Mark), exactly as any other pay-link payment.
--
-- Run in the Supabase SQL editor after 137. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The order asks for a deposit, and the org says how much
-- ----------------------------------------------------------------------------

alter table special_orders
  add column if not exists deposit_rate numeric;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'special_orders_deposit_rate_range') then
    alter table special_orders
      add constraint special_orders_deposit_rate_range
      check (deposit_rate is null or (deposit_rate > 0 and deposit_rate < 1));
  end if;
end $$;

comment on column special_orders.deposit_rate is
  'The deposit asked for, as a FRACTION of the order total (0.10 is 10%). Null '
  'is no deposit — the usual case. Copied from orgs.settings.special_orders.'
  'deposit_rate when switched on, so a later change to the setting does not '
  'move a deposit already quoted. Migration 138.';

-- Mark: 10%. Only written when absent (051's idiom), so a re-run cannot stomp
-- a rate somebody changed in Settings.
update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders}',
         coalesce(settings -> 'special_orders', '{}'::jsonb) || '{"deposit_rate": 0.1}'::jsonb
       )
 where not (coalesce(settings -> 'special_orders', '{}'::jsonb) ? 'deposit_rate');


-- ----------------------------------------------------------------------------
-- 2. The log learns the new column
-- ----------------------------------------------------------------------------
-- 118's function reproduced IN FULL (its own rule), changed in EXACTLY ONE
-- PLACE: one row on the watch list, marked.

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
    ['deposit_rate',         'Deposit (%)'],                          -- <<< 138
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


-- ----------------------------------------------------------------------------
-- 3. What a deposit comes to
-- ----------------------------------------------------------------------------

-- One order's deposit: its total × its rate, rounded the way the order's own
-- screen rounds (`depositAmount` in lib/specialOrders is the same arithmetic).
-- The product is taken in DOUBLE PRECISION, as JavaScript takes it — 128's
-- lesson: exact numeric makes 100.05 × 0.1 exactly 10.005 and rounds it up,
-- where the screen's 10.004999… rounds down.
-- Zero when none is asked for, or the order is cancelled.
create or replace function public.special_order_deposit(p_order uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when o.deposit_rate is null or o.status = 'cancelled' then 0
                else js_cents(m.total::double precision * o.deposit_rate::double precision)::numeric
           end
      from special_orders o, special_order_money(o.id) m
     where o.id = p_order
  ), 0)::numeric(10,2);
$$;

-- An invoice's deposit: each order's, capped at what its line bills (a line
-- already shrunk by a payment taken before the invoice cannot ask for more
-- deposit than it has left).
create or replace function public.customer_invoice_deposit(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(least(special_order_deposit(l.special_order_id), greatest(l.amount, 0))), 0)::numeric(10,2)
    from customer_invoice_lines l
   where l.invoice_id = p_invoice;
$$;

revoke all on function public.special_order_deposit(uuid) from public, anon, authenticated;
revoke all on function public.customer_invoice_deposit(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. The pay link offers the deposit
-- ----------------------------------------------------------------------------
-- 131's `pay_token_state`, IN FULL, with one addition marked: an open INVOICE
-- link says `deposit_due` — what is still owed toward the deposit — when that
-- is more than nothing and less than the balance. Absent otherwise, so a link
-- with no deposit reads exactly as before. `pay_by_token` passes it through
-- unchanged (it strips only its own four keys).

create or replace function public.pay_token_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t   record;
  o   record;
  inv record;
  v_paid numeric(10,2);
  v_deposit_due numeric(10,2);                                             -- <<< 138
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into t from special_order_pay_tokens where token = p_token;
  if not found or t.document_snapshot is null or t.total is null then
    return jsonb_build_object('state', 'unknown');
  end if;

  if t.customer_invoice_id is not null then
    select * into inv from customer_invoices where id = t.customer_invoice_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    if inv.voided_at is not null then
      return jsonb_build_object('state', 'cancelled');
    end if;
    -- 131: paid through QuickBooks' own link, never this one.
    if inv.processor = 'quickbooks' then
      return jsonb_build_object('state', 'superseded');
    end if;
    -- 128: the invoice has changed since this link's send — the customer is
    -- holding the old figures; the re-send carries the new link.
    if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = inv.id) <> t.total then
      return jsonb_build_object('state', 'superseded');
    end if;
    v_paid := customer_invoice_paid(inv.id);
    if t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    -- 138: still owed toward the deposit, when that is a real choice.
    v_deposit_due := customer_invoice_deposit(inv.id) - v_paid;
    if v_deposit_due <= 0 or v_deposit_due >= t.total - v_paid then
      v_deposit_due := null;
    end if;
  else
    select status, ignore_balance into o from special_orders where id = t.order_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    select coalesce(sum(amount), 0) into v_paid
      from special_order_payments where order_id = t.order_id;
    if o.ignore_balance or t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    if o.status = 'cancelled' then
      return jsonb_build_object('state', 'cancelled');
    end if;
    -- 127: a customer invoice bills this order, so its own link stands down.
    if exists (select 1
                 from customer_invoice_lines l
                 join customer_invoices i on i.id = l.invoice_id
                where l.special_order_id = t.order_id and i.voided_at is null) then
      return jsonb_build_object('state', 'superseded');
    end if;
  end if;

  if t.superseded_at is not null then
    return jsonb_build_object('state', 'superseded');
  end if;

  return jsonb_build_object(
    'state', 'open',
    'invoice', t.document_snapshot,
    'total', t.total,
    'paid', v_paid,
    'balance', t.total - v_paid,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'customer_invoice_id', t.customer_invoice_id,
    'claimed_until', t.claimed_until
  ) || case when v_deposit_due is null then '{}'::jsonb                   -- <<< 138
            else jsonb_build_object('deposit_due', v_deposit_due) end;
end;
$$;

revoke all on function public.pay_token_state(text) from public, anon, authenticated;

-- 126's `claim_pay_token`, IN FULL, taking WHICH amount the customer chose:
-- 'deposit' or 'balance' (the default, so a caller that says nothing pays the
-- balance, as before). Never a figure. `balance` in the answer is what
-- `square-pay` charges; a 'deposit' choice with no deposit due falls back to
-- the balance rather than refusing — the page offered a choice that has since
-- stopped existing (a hand-recorded payment met it), and the balance is what
-- the link would now offer anyway.
--
-- A NEW SIGNATURE, so the one-argument version is dropped first: two
-- overloads would leave PostgREST choosing between them.
drop function if exists public.claim_pay_token(text);

create or replace function public.claim_pay_token(p_token text, p_pay text default 'balance')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb := pay_token_state(p_token);
begin
  if s ->> 'state' <> 'open' then
    return s;
  end if;

  update special_order_pay_tokens
     set claimed_until = now() + interval '2 minutes'
   where token = p_token
     and (claimed_until is null or claimed_until < now());
  if not found then
    return jsonb_build_object('state', 'busy');
  end if;

  s := pay_token_state(p_token);
  if s ->> 'state' <> 'open' then
    update special_order_pay_tokens set claimed_until = null where token = p_token;
    return s;
  end if;

  return jsonb_build_object(
    'state', 'claimed',
    'org_id', s -> 'org_id',
    'order_id', s -> 'order_id',
    'customer_invoice_id', s -> 'customer_invoice_id',
    'kind', case when s ->> 'customer_invoice_id' is not null
                 then 'customer_invoice' else 'order' end,
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',
    'balance', case when p_pay = 'deposit' and s ? 'deposit_due'           -- <<< 138
                    then s -> 'deposit_due' else s -> 'balance' end,
    'is_deposit', (p_pay = 'deposit' and s ? 'deposit_due'),              -- <<< 138
    'location_id', pay_link_token_location(s),
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_token_variation(s),
    'items', (select jsonb_agg(jsonb_build_object(
                       'line_id', l.id,
                       'variation_id', pay_link_item_variation((s ->> 'org_id')::uuid, l.square_item))
                     order by l.sort nulls last, l.created_at)
                from customer_invoice_lines l
               where l.invoice_id = (s ->> 'customer_invoice_id')::uuid)
  );
end;
$$;

revoke all on function public.claim_pay_token(text, text) from public, anon, authenticated;
grant execute on function public.claim_pay_token(text, text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. Approving a quote that asks for a deposit makes the order's invoice
-- ----------------------------------------------------------------------------
-- A DRAFT, carrying no payment: the deposit is paid when somebody sends it.
-- A TRIGGER on the quote token rather than a rewrite of `approve_quote_by_token`
-- (052, amended since), so the approval's own function is untouched and the
-- invoice is made however the token comes to be approved.
--
-- SKIPPED, SILENTLY TO THE CUSTOMER and in words on the order's log, whenever
-- `create_customer_invoice` would refuse: no linked customer, not a live
-- order, or already on an invoice that is not void. The approval itself must
-- never fail because of this — a customer who has just signed is not the
-- person to hear about a missing customer link.
--
-- Its due date is the org's terms from today, as Create Invoice… would
-- suggest; it is a draft, so whoever sends it can change it.

create or replace function public.trg_quote_approved_makes_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_today date;
  v_days int;
  v_number int;
  v_id uuid;
begin
  select * into o from special_orders where id = new.order_id;
  if not found or o.deposit_rate is null then
    return null;
  end if;

  select l.invoice_id into v_id
    from customer_invoice_lines l
    join customer_invoices i on i.id = l.invoice_id
   where l.special_order_id = o.id and i.voided_at is null
   limit 1;
  if v_id is not null then
    return null;                          -- already invoiced: that invoice asks
  end if;

  if o.kind <> 'order' or o.status = 'cancelled' or o.customer_id is null then
    perform log_special_order_event(o.org_id, o.id,
      'Quote approved with a deposit, but no invoice was made — '
      || case when o.customer_id is null then 'link a customer, then Create Invoice…'
              else 'this is not a live order' end);
    return null;
  end if;

  v_today := org_today(o.org_id);
  select coalesce(nullif(settings -> 'customer_invoices' ->> 'terms_days', '')::int, 4)
    into v_days from orgs where id = o.org_id;

  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || o.org_id::text));
  select coalesce(max(number), 1000) + 1 into v_number
    from customer_invoices where org_id = o.org_id;

  insert into customer_invoices (org_id, customer_id, number, issued_on, due_on)
  values (o.org_id, o.customer_id, v_number, v_today, v_today + greatest(v_days, 0))
  returning id into v_id;

  -- Amount, wording and Sold as are filled by the line triggers (128, 129).
  insert into customer_invoice_lines (org_id, invoice_id, special_order_id, description, amount, sort)
  values (o.org_id, v_id, o.id, '', 0, 0);

  perform log_special_order_event(o.org_id, o.id,
    'Added to invoice ' || v_number || ' (quote approved with a deposit)');
  return null;
end;
$$;

revoke all on function public.trg_quote_approved_makes_invoice() from public, anon, authenticated;

drop trigger if exists trg_quote_approved_makes_invoice on special_order_quote_tokens;
create trigger trg_quote_approved_makes_invoice
  after update of approved_at on special_order_quote_tokens
  for each row
  when (old.approved_at is null and new.approved_at is not null)
  execute function trg_quote_approved_makes_invoice();

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select settings -> 'special_orders' -> 'deposit_rate' from orgs;      → 0.1
--   select count(*) from special_orders where deposit_rate is not null;   → 0
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'claim_pay_token';           → one row: p_token text, p_pay text
--   select has_function_privilege('anon',
--     'public.claim_pay_token(text,text)', 'execute');                    → true
--   select tgname from pg_trigger where tgname = 'trg_quote_approved_makes_invoice'; → one
-- ============================================================================
