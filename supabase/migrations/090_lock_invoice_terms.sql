-- ============================================================================
-- restaurantfriend — migration 090 · terms locks with the rest
--
-- Mark, 2026-09-03, having used 089's lock on a real invoice: "now that I'm
-- seeing it - we should lock the terms too."
--
-- 089 left `terms` open on the reasoning that it is informational — "Net 30"
-- doesn't change what is owed. Seeing the locked screen changed his mind:
-- payment terms are part of what an approver is signing off on as much as the
-- due date next to it, which already locks. So `terms` moves from the
-- "notes-only" exception into the locked set, joining it.
--
-- ONE FUNCTION, WIDENED, NOT A NEW TRIGGER — `create or replace` is safe here
-- because the function's SIGNATURE (`returns trigger`, no arguments) is
-- unchanged; only the `v_changed` boolean inside it grows one more clause.
-- 033's `freeze_pay_period` drop-first rule is for a CHANGED ARGUMENT LIST,
-- which would otherwise leave a stale overload live beside the new one — not
-- the case for a trigger function whose body alone is being widened.
--
-- 089 is applied, so its file stays exactly as it was run — a separate
-- migration, not an edit to it (055's rule: a migration that has run is
-- history, and a file that no longer describes what was run is how the
-- harness and production quietly stop being the same database).
--
-- Depends on 089. Rerunnable — `create or replace function` and `create or
-- replace function` again both succeed a second time — but there is nothing
-- for it to do the second time, since it makes no other change.
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
    new.total          is distinct from old.total
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
  'terms joined the locked set in 090. See 089, 090.';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select public.enforce_vendor_invoice_financials_lock() -- should error
--    (called with no row context — confirms the function recompiled cleanly
--    rather than confirming any real behaviour; the trigger itself is the
--    only honest test, below)
--
--   As a real authenticated purchaser+, on an approved invoice:
--     update vendor_invoices set terms = 'Net 45' where id = <id>;
--     → "This invoice is approved — withdraw approval before editing its
--        figures."  (previously succeeded)
--   Notes still does not:
--     update vendor_invoices set notes = 'x' where id = <id>;   → succeeds
-- ============================================================================
