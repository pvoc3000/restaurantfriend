-- ============================================================================
-- 131 — A CUSTOMER INVOICE NAMES ITS PAYMENT PROCESSOR: SQUARE OR QUICKBOOKS
-- ============================================================================
--
-- Mark, 2026-09-24: "i want to build a QBO workflow into our customer invoice
-- system so I can test it out … I have a hunch that QBO will be better for us,
-- but until I try it I won't know for sure." The app is not live, so two
-- payment paths side by side is fine.
--
-- A QUICKBOOKS INVOICE is pushed to QuickBooks as an Invoice (one line per
-- order, the item by Sold as), and OUR email goes out carrying QuickBooks' own
-- pay link (InvoiceLink) in place of `/pay/[token]`. The money is taken by
-- QuickBooks Payments, never by Square, so the nightly Square journal entry
-- never sees it and the push does not double-count — the reason pay-link
-- orders must NOT be pushed does not apply here.
--
-- 1. `customer_invoices.processor` — 'square' (the default, everything today)
--    or 'quickbooks'. Chosen per invoice, and LOCKED ONCE SENT: switching a
--    sent invoice would leave a live link on the other rail.
-- 2. `customer_invoices.external_ref` — `{ qbo: { id, sync_token, doc_number,
--    invoice_link, attachments } }`, the shape `special_orders.external_ref`
--    already has (081).
-- 3. `accounting_connections.wholesale_item_ref/_name` — the QBO item a line
--    whose Sold as is wholesale posts to. `invoice_item_ref` stays the
--    special-order item. Surfaced by `accounting_connection_status`.
-- 4. 124's unique Square Online payment index WIDENED to QuickBooks Payments,
--    so a webhook Intuit retries records the payment once. The existing
--    `on conflict … where payment_type = 'Square Online' …` clauses still pick
--    this index: that predicate implies the widened one.
-- 5. `record_qbo_invoice_payment` — the webhook's one write, service_role only.
-- 6. `pay_token_state` — a `/pay` link on an invoice now routed to QuickBooks
--    stands down (superseded). Belt and braces: a QBO invoice never mints one.
--
-- Depends on 081, 086, 124, 128. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1–2. The processor and the QuickBooks reference
-- ----------------------------------------------------------------------------

alter table customer_invoices
  add column if not exists processor text not null default 'square';
alter table customer_invoices
  drop constraint if exists customer_invoices_processor_check;
alter table customer_invoices
  add constraint customer_invoices_processor_check
    check (processor in ('square', 'quickbooks'));

alter table customer_invoices
  add column if not exists external_ref jsonb;

create or replace function public.trg_customer_invoice_processor_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.processor is distinct from old.processor and old.sent_at is not null then
    raise exception 'Invoice % has been sent, so its payment processor can no longer change — the customer already holds a % link.',
      old.number, case old.processor when 'quickbooks' then 'QuickBooks' else 'Square' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_invoice_processor_locked on customer_invoices;
create trigger trg_customer_invoice_processor_locked
  before update of processor on customer_invoices
  for each row execute function trg_customer_invoice_processor_locked();

revoke all on function public.trg_customer_invoice_processor_locked() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The wholesale item, and the status function that reports it
-- ----------------------------------------------------------------------------

alter table accounting_connections
  add column if not exists wholesale_item_ref  text,
  add column if not exists wholesale_item_name text;

-- 086's body, widened by the two columns. DROP FIRST: `create or replace`
-- cannot change a `returns table` column list, and the drop takes the grants.
drop function if exists public.accounting_connection_status(uuid);

create function public.accounting_connection_status(p_org uuid)
returns table (
  provider                 text,
  status                   text,
  connected                boolean,
  environment              text,
  bill_expense_account_ref  text,
  bill_expense_account_name text,
  invoice_item_ref          text,
  invoice_item_name         text,
  wholesale_item_ref        text,
  wholesale_item_name       text,
  tax_code_ref             text,
  tax_code_name            text,
  refresh_token_expires_at timestamptz,
  connected_at             timestamptz,
  last_used_at             timestamptz,
  last_error               text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or p_org not in (select user_org_ids()) then
    return;
  end if;

  -- NAMED COLUMNS, NEVER `select c.*` (086) — the row holds live tokens.
  return query
    select c.provider, c.status,
           (c.realm_id is not null) as connected,
           c.environment,
           c.bill_expense_account_ref, c.bill_expense_account_name,
           c.invoice_item_ref, c.invoice_item_name,
           c.wholesale_item_ref, c.wholesale_item_name,
           c.tax_code_ref, c.tax_code_name,
           c.refresh_token_expires_at, c.connected_at, c.last_used_at,
           c.last_error
      from accounting_connections c
     where c.org_id = p_org;
end $$;

revoke all on function public.accounting_connection_status(uuid) from public;
revoke all on function public.accounting_connection_status(uuid) from anon;
grant execute on function public.accounting_connection_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. One QuickBooks payment, one row per order — as Square Online
-- ----------------------------------------------------------------------------

drop index if exists special_order_payments_square_ref;
create unique index special_order_payments_square_ref
  on special_order_payments (org_id, external_ref, order_id)
  where payment_type in ('Square Online', 'QuickBooks Payments') and external_ref is not null;

-- ----------------------------------------------------------------------------
-- 5. The webhook's write
-- ----------------------------------------------------------------------------
--
-- Found by the QuickBooks company (`realm_id`) and the QBO invoice id the
-- payment is linked to, never by anything the caller claims about our rows.
-- Only an invoice routed to QuickBooks takes one: a Square invoice that somebody
-- also pushed by hand is not this path's to settle. Returns what happened, so
-- the webhook can log it; a replay answers 'duplicate'.

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

  if exists (select 1 from special_order_payments
              where org_id = v_org and customer_invoice_id = inv.id
                and payment_type = 'QuickBooks Payments'
                and external_ref = p_payment_id) then
    return 'duplicate';
  end if;

  v_n := allocate_customer_invoice_payment(
    inv.id, p_amount, 'QuickBooks Payments', p_payment_id,
    'Paid through QuickBooks', coalesce(p_paid_on, org_today(v_org)), null);

  return case when v_n > 0 then 'recorded' else 'duplicate' end;
end;
$$;

revoke all on function public.record_qbo_invoice_payment(text, text, numeric, text, date)
  from public, anon, authenticated;
grant execute on function public.record_qbo_invoice_payment(text, text, numeric, text, date)
  to service_role;

-- ----------------------------------------------------------------------------
-- 6. A `/pay` link stands down once the invoice is QuickBooks'
-- ----------------------------------------------------------------------------
-- 128's body, with one check added after the void check.

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
  );
end;
$$;

revoke all on function public.pay_token_state(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- After this runs:
--   select processor, count(*) from customer_invoices group by 1;  → all square
--   select pg_get_function_result(oid) from pg_proc
--    where proname = 'accounting_connection_status';  → names wholesale_item_ref
--   select indexdef from pg_indexes
--    where indexname = 'special_order_payments_square_ref';  → names both types
--   select has_function_privilege('authenticated',
--     'public.record_qbo_invoice_payment(text,text,numeric,text,date)', 'execute'); → false
-- ============================================================================
