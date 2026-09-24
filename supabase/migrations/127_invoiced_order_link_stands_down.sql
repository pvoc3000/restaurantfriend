-- ============================================================================
-- 127 — AN ORDER ON A CUSTOMER INVOICE CANNOT BE PAID THROUGH ITS OWN LINK
-- ============================================================================
--
-- Mark, 2026-09-23: "yes, close both gaps". The gap this half closes: an order
-- billed on a customer invoice may still hold a pay link of its own — emailed
-- before the invoice existed, or sent since from the order's Send ▸ Invoice.
-- A payment through it is recorded on the order UNTAGGED, so the customer
-- invoice goes on asking for the same money: the customer pays twice.
--
-- `pay_token_state` now answers SUPERSEDED for an ORDER token whose order is
-- a line on a customer invoice that is not void — the page says "This invoice
-- has been updated … the link in the newest message is the one to use", which
-- is true: the newest message is the customer invoice. Nothing is written to
-- the token, so voiding the invoice lets the order's own link work again,
-- which is what voiding means. The "paid" answer still comes first, so a link
-- whose order is already settled says so.
--
-- The app half: `SendDocument` sends an invoiced order's invoice with no pay
-- link, and the list's bulk Record Payment skips invoiced orders.
--
-- Redefined IN FULL from 124, arguments unchanged; it is granted to nobody
-- (only the definer functions call it). Run after 126. RERUNNABLE.
-- ============================================================================

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

  if t.customer_invoice_id is not null then                              -- <<< 124
    select * into inv from customer_invoices where id = t.customer_invoice_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    v_paid := customer_invoice_paid(inv.id);
    -- No `ignore_balance` shortcut: that flag says an order is billed on
    -- something other than its own invoice, and this IS that something.
    if t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    if inv.voided_at is not null then
      return jsonb_build_object('state', 'cancelled');
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
    -- 127: a customer invoice now bills this order, so its own link stands
    -- down — a payment here would not count against that invoice.
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

notify pgrst, 'reload schema';
