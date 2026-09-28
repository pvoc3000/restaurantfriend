-- ============================================================================
-- 149 — A QUICKBOOKS PAYMENT CAN BE REFUNDED FROM THE APP
-- ============================================================================
--
-- Mark, 2026-09-28: he cancelled a test order paid through QuickBooks Payments
-- (SO-10088, INV-10001, $1.10) and "I don't see an option" to refund it. The
-- accounting API only RECORDS a refund; the money goes back through the
-- Payments API, and since 2026-09-28 the connection carries that scope (see
-- `QBO_SCOPE` in `_shared/qbo.ts` and docs/history/04l-quickbooks.md).
-- `qbo-sync`'s `refund_payment` mode moves the money; this is the record.
--
-- 140's two refund functions IN FULL, changed where marked, so the Square
-- path and the QuickBooks path are one rule:
--
--   `payment_refundable`   counts a 'QuickBooks Refund' against what is left
--                          of a payment, as it counts a 'Square Refund';
--   `record_payment_refund` takes a 'QuickBooks Payments' payment as well as
--                          a pay-link one, and writes a 'QuickBooks Refund'
--                          (processor 'quickbooks') naming it — negative,
--                          applied where the original was, so the order's and
--                          the invoice's balances follow on their own.
--
-- A QuickBooks refund's `external_ref` is the Payments API's refund or void
-- id, which is unique per refund, so 140's one-row-per-processor-id index
-- keeps a retried call from recording it twice.
--
-- Nothing else moves, as with Square (Mark, 2026-09-22: "leave status
-- alone"): a refund reopens the invoice by 141's payments-follow rule, and
-- whether it is then voided or re-billed is the person's next step.
--
-- Run in the Supabase SQL editor after 148. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What is left to refund of an order's (or an invoice's) share
-- ----------------------------------------------------------------------------

create or replace function public.payment_refundable(p_application uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a record;
begin
  select ap.*, p.org_id as p_org into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.p_org, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  return a.amount + coalesce((
    select sum(ra.amount)
      from payment_applications ra
      join customer_payments rp on rp.id = ra.payment_id
     where rp.payment_type in ('Square Refund', 'QuickBooks Refund')          -- <<< 149
       and ra.special_order_id is not distinct from a.special_order_id
       and ra.customer_invoice_id is not distinct from a.customer_invoice_id
       -- A refund made here names its payment; one carried over from the old
       -- table cannot, and counted against the order's share as 124 did.
       and (rp.refund_of = a.payment_id or rp.refund_of is null)
  ), 0);
end;
$$;
revoke all on function public.payment_refundable(uuid) from public, anon, authenticated;
grant execute on function public.payment_refundable(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Recording the refund
-- ----------------------------------------------------------------------------

create or replace function public.record_payment_refund(
  p_application uuid,
  p_amount      numeric,
  p_refund_id   text,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_left numeric(10,2);
  v_payment uuid;
  v_type text;                                                               -- <<< 149
  v_processor text;                                                          -- <<< 149
begin
  select ap.id, ap.special_order_id, ap.customer_invoice_id, ap.amount,
         p.id as payment_id, p.org_id, p.customer_id, p.payment_type, p.external_ref
    into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.org_id, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  -- 149: a pay-link payment goes back through Square, a QuickBooks Payments
  -- one through QuickBooks; nothing else is refunded from here.
  if a.payment_type = 'Square Online' then
    v_type := 'Square Refund';
    v_processor := 'square';
  elsif a.payment_type = 'QuickBooks Payments' then
    v_type := 'QuickBooks Refund';
    v_processor := 'quickbooks';
  else
    raise exception 'only a payment taken through the pay link or QuickBooks Payments is refunded from here';
  end if;
  if a.external_ref is null or a.amount <= 0 then
    raise exception 'only a payment taken through the pay link or QuickBooks Payments is refunded from here';
  end if;
  if coalesce(p_amount, 0) <= 0 or nullif(btrim(coalesce(p_refund_id, '')), '') is null then
    raise exception 'a refund is more than zero and names the processor''s refund';
  end if;
  v_left := payment_refundable(p_application);
  if p_amount > v_left then
    raise exception 'only % of this payment is left to refund', v_left;
  end if;

  insert into customer_payments
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note, refund_of, created_by)
  values
    (a.org_id, a.customer_id, org_today(a.org_id), -p_amount, v_type, v_processor,   -- <<< 149
     btrim(p_refund_id), nullif(btrim(coalesce(p_note, '')), ''), a.payment_id, auth.uid())
  returning id into v_payment;

  insert into payment_applications
    (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
  values
    (a.org_id, v_payment, a.special_order_id, a.customer_invoice_id, -p_amount, auth.uid());

  return v_payment;
end;
$$;
revoke all on function public.record_payment_refund(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_refund(uuid, numeric, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select proname, count(*) from pg_proc
--    where proname in ('payment_refundable', 'record_payment_refund')
--    group by proname;                      -- one row each, count 1
