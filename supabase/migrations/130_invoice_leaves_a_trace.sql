-- ============================================================================
-- 130 — AN ORDER'S LOG SAYS WHEN IT LEAVES AN INVOICE
-- ============================================================================
--
-- Mark, 2026-09-23, after deleting draft invoice 1001: "yes, add the
-- removed-from-invoice log". Its three orders' logs said "Added to invoice
-- 1001" and then nothing, so anyone reading one would believe it was still
-- billed.
--
-- TWO WAYS AN ORDER LEAVES AN INVOICE, both now logged on every order on it:
--
--   · DELETING a draft → "Removed from invoice 1001 (draft deleted)". A BEFORE
--     DELETE trigger on the INVOICE, because by the time the cascade reaches
--     the lines the invoice row — and its number — is gone.
--   · VOIDING → "Invoice 1001 voided", when `voided_at` is first set.
--
-- Through `log_special_order_event`, so the author is whoever pressed it.
--
-- Run in the Supabase SQL editor after 129. RERUNNABLE.
-- ============================================================================

create or replace function public.trg_customer_invoice_leaves_a_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform log_special_order_event(old.org_id, l.special_order_id,
                                    'Removed from invoice ' || old.number || ' (draft deleted)')
       from customer_invoice_lines l where l.invoice_id = old.id;
    return old;
  end if;

  if old.voided_at is null and new.voided_at is not null then
    perform log_special_order_event(new.org_id, l.special_order_id,
                                    'Invoice ' || new.number || ' voided')
       from customer_invoice_lines l where l.invoice_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_leaves_a_trace() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_deleted on customer_invoices;
create trigger trg_customer_invoice_deleted
  before delete on customer_invoices
  for each row execute function trg_customer_invoice_leaves_a_trace();

drop trigger if exists trg_customer_invoice_voided on customer_invoices;
create trigger trg_customer_invoice_voided
  after update of voided_at on customer_invoices
  for each row execute function trg_customer_invoice_leaves_a_trace();
