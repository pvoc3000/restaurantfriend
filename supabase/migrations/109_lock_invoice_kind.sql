-- ============================================================================
-- restaurantfriend — migration 109 · is_credit locks with the rest
--
-- 2026-09-19. The invoice detail screen gained a Kind field (Bill / Credit
-- memo) that writes `is_credit`, and the New invoice dialog gained the same
-- choice — until then the flag was set only by the reader, so a credit typed
-- in by hand went to QuickBooks as a Bill and a misread one could not be
-- corrected.
--
-- Once a field can change it belongs in the lock: `is_credit` decides the
-- ENTITY QuickBooks receives (`billEntity` in lib/quickbooks — Bill or
-- VendorCredit), and QuickBooks cannot turn one into the other; a flip after
-- the push would leave a Bill in the books for a document this side calls a
-- credit. It also flips the sign every total on the list is summed with. So
-- it locks exactly as `total` does — editable while open, refused once
-- approved or void, withdraw approval to change it.
--
-- ONE FUNCTION, WIDENED, NOT A NEW TRIGGER — the same move as 090: the
-- signature is unchanged, only `v_changed` grows a clause. 089 and 090 are
-- applied and stay as they were run.
--
-- Depends on 090. Rerunnable.
-- ============================================================================

create or replace function public.enforce_vendor_invoice_financials_lock()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
begin
  v_changed := (
    new.invoice_number is distinct from old.invoice_number or
    new.invoice_date   is distinct from old.invoice_date or
    new.due_date       is distinct from old.due_date or
    new.terms          is distinct from old.terms or
    new.vendor_id      is distinct from old.vendor_id or
    new.location_id    is distinct from old.location_id or
    new.tax            is distinct from old.tax or
    new.freight        is distinct from old.freight or
    new.other_charges  is distinct from old.other_charges or
    new.subtotal       is distinct from old.subtotal or
    new.total          is distinct from old.total or
    new.is_credit      is distinct from old.is_credit
  );

  if v_changed and old.status <> 'open' then
    raise exception
      'This invoice is % — % before editing its figures.',
      old.status,
      case old.status when 'void' then 'reopen it' else 'withdraw approval' end;
  end if;

  if v_changed then
    new.financials_touched_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_vendor_invoice_financials_lock() is
  'BEFORE UPDATE on vendor_invoices. Refuses a change to a locked column '
  'unless status is open; on a real change, stamps financials_touched_at. '
  'Not role-scoped — applies to owner/admin exactly as to purchaser. '
  'terms joined the locked set in 090, is_credit in 109. See 089, 090, 109.';

-- ----------------------------------------------------------------------------
-- After this runs, as a real authenticated purchaser+, on an approved invoice:
--     update vendor_invoices set is_credit = not is_credit where id = <id>;
--     → "This invoice is approved — withdraw approval before editing its
--        figures."  (previously succeeded)
-- ============================================================================
