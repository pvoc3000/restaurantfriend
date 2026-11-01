-- ============================================================================
-- 219 — APPLY CREDIT ON A QUICKBOOKS INVOICE SAYS WHAT HAPPENS INSTEAD
--
-- 218's refusal named an "Apply Credit Memo" command that does not exist. A
-- QuickBooks invoice takes credit memo credit when it is SENT to QuickBooks
-- (`qbo-sync`'s `push_customer_invoice`), and nowhere else. Same function,
-- arguments and grants; the message is the only change.
--
-- Run after 218. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================

create or replace function public.apply_customer_credit(p_invoice uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  if inv.voided_at is not null then
    raise exception 'invoice % is void', customer_invoice_label(p_invoice);
  end if;
  if inv.processor = 'quickbooks' then
    raise exception 'a QuickBooks invoice takes credit memo credit when it is sent to QuickBooks, and payment credit not at all';
  end if;
  return apply_credit_to_invoice(p_invoice, org_today(inv.org_id), auth.uid());
end;
$$;
