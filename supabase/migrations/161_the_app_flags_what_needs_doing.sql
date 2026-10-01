-- ============================================================================
-- 161 — THE APP FLAGS WHAT NEEDS DOING
--
-- SQL STARTS AT LINE 56. Everything above it is comment.
--
-- Mark, 2026-10-01: "Set a system flag and a to do when we need to act":
--
--   · an inquiry arrives          → Respond to Email/Call   (058, unchanged)
--   · a customer approves a quote → Send Invoice            (NEW to-do; 116's flag)
--   · a customer pays an invoice  → Schedule Delivery       (122's to-do; NEW flag)
--                                   or Send Receipt         (was Print Order)
--   · we schedule the delivery    → Send Receipt            (NEW to-do and flag)
--
-- A TO-DO IS ONLY EVER SET OVER AN EMPTY ONE OR ONE THE EVENT ANSWERS, 117's
-- rule — "call about the balloons" typed by a person outlives every one of
-- these. A FLAG IS NEVER WRITTEN OVER A PERSON'S, 116's rule.
--
-- FIVE PIECES:
--
-- 1. `flag_raised_at`. The fourth case is the first SYSTEM flag raised by a
--    signed-in person's own write, and 116's auto-clear would eat it in the same
--    statement: the date change is logged by 054's AFTER trigger as an authored
--    event, and an authored event clears a system flag. So a system flag now
--    remembers the transaction that raised it, and only a LATER one clears it
--    ("the next time anyone touches the record", which is still the rule).
--    `now()` is the transaction's start time, constant inside it.
-- 2. `approve_quote_by_token` (116, reproduced IN FULL; one change, marked)
--    sets the to-do to Send Invoice. 117 already clears it when the invoice
--    goes out.
-- 3. `settle_special_order_paid` (124, reproduced IN FULL; one change, marked):
--    a paid order that is not waiting on its courier is waiting on its RECEIPT,
--    not the printer. 117 clears Send Receipt when the receipt goes out.
-- 4. The two ONLINE payment doors (`record_pay_link_payment`, 145, and
--    `record_qbo_invoice_payment`, 140, both IN FULL) log a 'customer' event
--    on every order the payment SETTLED — 116's trigger turns that sentence
--    into the flag. Only settling raises it: a deposit asks nothing of us. A
--    payment recorded by hand raises nothing: the person recording it is the
--    one who would have been told.
-- 5. `trg_special_order_stage_clears` (122, IN FULL; one branch added): the
--    first stamp of `delivery_scheduled_at` on a PAID order whose receipt has
--    not gone sets Send Receipt and a system flag reading "Delivery scheduled".
--    An unpaid order gets neither — there is no receipt to send yet, and the
--    payment will ask for it when it lands.
--
-- Trigger order is still load-bearing (117's note): `…_flag_source` runs
-- BEFORE `…_stage_clears`, so branch 5 writes `flag_source` and
-- `flag_raised_at` itself rather than relying on 116 to derive them.
--
-- Arguments, names and triggers are unchanged, so every grant stands. Safe to
-- run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A SYSTEM FLAG SURVIVES THE TRANSACTION THAT RAISED IT
-- ----------------------------------------------------------------------------
alter table special_orders add column if not exists flag_raised_at timestamptz;

create or replace function public.trg_special_order_flag_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.flag_reason is null then
    new.flag_source := null;
    new.flag_raised_at := null;                                            -- <<< 161

  elsif tg_op = 'INSERT' then
    if new.flag_source is null then
      new.flag_source := case when auth.uid() is null then 'system' else 'person' end;
    end if;
    new.flag_raised_at := now();                                           -- <<< 161

  elsif new.flag_reason is distinct from old.flag_reason
        and new.flag_source is not distinct from old.flag_source then
    new.flag_source := case when auth.uid() is null then 'system' else 'person' end;
    new.flag_raised_at := now();                                           -- <<< 161

  elsif new.flag_reason is distinct from old.flag_reason then              -- <<< 161
    new.flag_raised_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.trg_special_order_event_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'customer' and auth.uid() is null then
    update special_orders
       set flag_reason = new.message,
           flag_source = 'system'
     where id = new.order_id
       and flag_source is distinct from 'person'
       and (flag_reason is distinct from new.message or flag_source is distinct from 'system');

  elsif new.author_id is not null then
    -- THE TEAM ARRIVED — in a LATER transaction than the one that raised the
    -- flag (161). The write that raises one logs authored events of its own.
    update special_orders
       set flag_reason = null,
           flag_source = null
     where id = new.order_id
       and flag_source = 'system'
       and (flag_raised_at is null or flag_raised_at < now());             -- <<< 161
  end if;

  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. AN APPROVED QUOTE WANTS ITS INVOICE
-- ----------------------------------------------------------------------------
create or replace function public.approve_quote_by_token(
  p_token text,
  p_name  text,
  p_meta  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  if v_name is null then
    return jsonb_build_object('state', 'name_required');
  end if;

  update special_order_quote_tokens
     set approved_at   = now(),
         approved_name = v_name,
         approved_meta = coalesce(p_meta, '{}'::jsonb)
   where token = p_token
     and approved_at is null
     and superseded_at is null
     and document_snapshot is not null
   returning * into t;

  if not found then
    select * into t from special_order_quote_tokens where token = p_token;
    if not found or t.document_snapshot is null then
      return jsonb_build_object('state', 'unknown');
    elsif t.approved_at is not null then
      return jsonb_build_object(
        'state', 'already_approved',
        'approved_at', t.approved_at,
        'approved_name', t.approved_name
      );
    else
      return jsonb_build_object('state', 'superseded');
    end if;
  end if;

  update special_orders
     set quote_returned_at = coalesce(quote_returned_at, current_date),
         -- <<< 161: the next document is ours to send.
         todo = case
                  when kind = 'order' and status is distinct from 'cancelled'
                   and (todo is null or btrim(todo) = ''
                        or todo in ('Respond to Email/Call', 'Send Quote'))
                    then 'Send Invoice'
                  else todo
                end
   where id = t.order_id;

  insert into special_order_events (org_id, order_id, message, author, source)
  values (
    t.org_id,
    t.order_id,
    format('Quote approved online by %s', v_name),
    v_name,
    'customer'
  );

  return jsonb_build_object(
    'state', 'approved',
    'order_id', t.order_id,
    'org_id', t.org_id,
    'approved_at', t.approved_at,
    'approved_name', t.approved_name
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. A PAID ORDER WANTS ITS RECEIPT (or its courier first)
-- ----------------------------------------------------------------------------
create or replace function public.settle_special_order_paid(p_order uuid, p_today date)
returns void
language sql
security definer
set search_path = public
as $$
  update special_orders
     set invoice_paid_at = coalesce(invoice_paid_at, p_today),
         status = case
                    when kind = 'order' and status in ('lead', 'quote', 'invoice')
                      then 'order'
                    else status
                  end,
         todo = case
                  when kind = 'order'
                   and status in ('lead', 'quote', 'invoice')
                   and (todo is null or btrim(todo) = ''
                        or todo in ('Send Invoice', 'Invoice Overdue!', 'Respond to Email/Call'))
                    then case
                           when fulfillment = 'delivery' and delivery_scheduled_at is null
                             then 'Schedule Delivery'
                           else 'Send Receipt'                             -- <<< 161: was Print Order
                         end
                  else todo
                end
   where id = p_order;
$$;

-- ----------------------------------------------------------------------------
-- 4. A PAYMENT FROM OUTSIDE THAT SETTLES AN ORDER FLAGS IT
-- ----------------------------------------------------------------------------
-- Which of an invoice's orders still owe something. Read before the payment
-- and after it; the difference is what this payment settled.
create or replace function public.customer_invoice_unsettled_orders(p_invoice uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct l.special_order_id), '{}')
    from customer_invoice_lines l
    join special_orders o on o.id = l.special_order_id
   where l.invoice_id = p_invoice
     and o.kind = 'order'
     and o.status is distinct from 'cancelled'
     and (select m.total from special_order_money(o.id) m) - special_order_paid(o.id) > 0;
$$;
revoke all on function public.customer_invoice_unsettled_orders(uuid) from public, anon, authenticated;

-- The notice itself: one 'customer' event per order settled, which 116's
-- trigger turns into the flag.
create or replace function public.flag_orders_paid_online(
  p_before uuid[],
  p_after  uuid[],
  p_message text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into special_order_events (org_id, order_id, message, source)
  select o.org_id, o.id, p_message, 'customer'
    from special_orders o
   where o.id = any (p_before)
     and not (o.id = any (p_after));
$$;
revoke all on function public.flag_orders_paid_online(uuid[], uuid[], text) from public, anon, authenticated;

create or replace function public.record_pay_link_payment(
  p_token text,
  p_amount numeric,
  p_square_payment_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_paid numeric(10,2);
  v_inserted int;
  v_before uuid[];                                                         -- <<< 161
begin
  select * into t from special_order_pay_tokens where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_square_payment_id), '') = '' then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_before := customer_invoice_unsettled_orders(t.customer_invoice_id);   -- <<< 161
  v_inserted := allocate_customer_invoice_payment(
    t.customer_invoice_id, p_amount, 'Square Online', p_square_payment_id,
    p_note, org_today(t.org_id), null);
  update special_order_pay_tokens set claimed_until = null where id = t.id;
  if v_inserted > 0 then                                                   -- <<< 161
    perform flag_orders_paid_online(
      v_before, customer_invoice_unsettled_orders(t.customer_invoice_id),
      'Paid online through Square');
  end if;
  v_paid := customer_invoice_paid(t.customer_invoice_id);
  return jsonb_build_object(
    'state', case when v_inserted > 0 then 'recorded' else 'already_recorded' end,
    'org_id', t.org_id,
    'customer_invoice_id', t.customer_invoice_id,
    'paid', v_paid,
    'balance', t.total - v_paid
  );
end;
$$;

create or replace function public.record_qbo_invoice_payment(
  p_realm       text,
  p_qbo_invoice text,
  p_amount      numeric,
  p_payment_id  text,
  p_paid_on     date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  inv   record;
  v_n   int;
  v_before uuid[];                                                         -- <<< 161
begin
  if p_amount is null or p_amount <= 0 then
    return 'no amount';
  end if;

  select org_id into v_org
    from accounting_connections
   where provider = 'qbo' and realm_id = p_realm;
  if v_org is null then
    return 'unknown company';
  end if;

  select * into inv
    from customer_invoices
   where org_id = v_org
     and external_ref -> 'qbo' ->> 'id' = p_qbo_invoice;
  if not found then
    return 'not ours';
  end if;
  if inv.processor <> 'quickbooks' then
    return 'not a quickbooks invoice';
  end if;
  if inv.voided_at is not null then
    return 'void';
  end if;

  if exists (select 1
               from payment_applications a
               join customer_payments p on p.id = a.payment_id
              where p.org_id = v_org and p.processor = 'quickbooks'
                and p.external_ref = p_payment_id
                and a.customer_invoice_id = inv.id) then
    return 'duplicate';
  end if;

  v_before := customer_invoice_unsettled_orders(inv.id);                  -- <<< 161
  v_n := allocate_customer_invoice_payment(
    inv.id, p_amount, 'QuickBooks Payments', p_payment_id,
    'Paid through QuickBooks', coalesce(p_paid_on, org_today(v_org)), null);

  if v_n > 0 then                                                          -- <<< 161
    perform flag_orders_paid_online(
      v_before, customer_invoice_unsettled_orders(inv.id),
      'Paid online through QuickBooks');
  end if;

  return case when v_n > 0 then 'recorded' else 'duplicate' end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. A BOOKED DELIVERY ON A PAID ORDER WANTS ITS RECEIPT
-- ----------------------------------------------------------------------------
create or replace function public.trg_special_order_stage_clears()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_answered text[] := '{}';
  v_todo_only text[] := '{}';
begin
  if old.quote_sent_at is null and new.quote_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Quote'];
  end if;
  if old.invoice_sent_at is null and new.invoice_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Invoice'];
  end if;
  if old.receipt_sent_at is null and new.receipt_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Receipt'];
  end if;
  if old.order_printed_at is null and new.order_printed_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Print Order'];
  end if;
  if old.order_scheduled_at is null and new.order_scheduled_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Schedule Production'];
  end if;
  if old.delivery_scheduled_at is null and new.delivery_scheduled_at is not null then
    v_todo_only := array['Respond to Email/Call', 'Schedule Delivery'];
  end if;

  -- <<< 161: booked and paid, so the receipt is next — and the app says so.
  if old.delivery_scheduled_at is null and new.delivery_scheduled_at is not null
     and new.kind = 'order'
     and new.status is distinct from 'cancelled'
     and new.invoice_paid_at is not null
     and new.receipt_sent_at is null then
    if new.todo is null or btrim(new.todo) = '' or new.todo = any (v_todo_only) then
      new.todo := 'Send Receipt';
    end if;
    if new.flag_source is distinct from 'person' then
      new.flag_reason := 'Delivery scheduled';
      new.flag_source := 'system';
      new.flag_raised_at := now();
    end if;
  elsif new.todo = any (v_todo_only) then
    new.todo := null;
  end if;
  -- >>> 161

  if array_length(v_answered, 1) is null then
    return new;
  end if;

  if new.todo = any (v_answered) then
    new.todo := null;
  end if;

  if new.flag_source = 'system' then
    new.flag_reason := null;
    new.flag_source := null;
    new.flag_raised_at := null;                                            -- <<< 161
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
