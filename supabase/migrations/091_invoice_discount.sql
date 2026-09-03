-- ============================================================================
-- restaurantfriend — migration 091 · a discount is its own field
--
-- Mark, 2026-09-03: "can we add one more amount field to the detail page:
-- discounts. Currently only Amoretti has a discount but there may be others
-- in the future."
--
-- Today a discount lives wherever it landed by accident — the real case is
-- Amoretti 15-700541/15-700341, where a $15.31 credit was typed into `Other`
-- as a negative number, because `Other` was the only free slot at the foot of
-- the invoice that could hold it. That works arithmetically (`computedAmounts`
-- already sums it into the total) and reads badly: an "Other" line carrying a
-- negative figure says nothing about WHAT it is, and a future reader has to
-- reconstruct that it's a discount rather than being told.
--
-- ONE COLUMN, POSITIVE, SUBTRACTED — the opposite convention from `Other`.
-- The field is named for what it does, so typing what's printed on the page
-- (a plain positive discount amount) is the natural entry, and the app does
-- the subtracting. `Other` stays signed-as-printed because it's a catch-all
-- with no fixed direction; `Discounts` earns a dedicated sign because it has
-- a dedicated column name to make it honest.
--
-- NOT BACKFILLED. Amoretti's existing -15.31 stays in `Other`, exactly where
-- it was typed — moving it is a data edit Mark can make himself from the
-- screen now that the field exists, not a migration's business to decide for
-- him.
--
-- LOCKS WITH THE REST, joining tax/freight/other_charges/subtotal/total —
-- same widening 090 already did to this same trigger function for `terms`,
-- and the same reasoning: it moves what's owed, so it's part of what an
-- approval signs off on. `create or replace` is safe here for 090's own
-- stated reason — the function's SIGNATURE doesn't change, only the body.
--
-- Depends on 090. Rerunnable only for the trigger half (`create or replace`);
-- the `add column` fails a second time, which is the signal it already ran.
-- ============================================================================

alter table vendor_invoices add column discount numeric(12,2);

comment on column vendor_invoices.discount is
  'A discount printed on the invoice, entered as a positive amount and '
  'SUBTRACTED from the total by computedAmounts() — the opposite sign '
  'convention from other_charges, which is signed as printed. Null means '
  'none was printed, which is true of nearly every bill. See 091.';

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
    new.discount        is distinct from old.discount or
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
  'terms joined the locked set in 090, discount in 091. See 089, 090, 091.';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'vendor_invoices' and column_name = 'discount';
--                                                    → 1 row, numeric, YES
--
--   select count(*) from vendor_invoices where discount is not null;   → 0
--     (nothing backfilled — Amoretti's discount stays in `other_charges`)
--
--   As a real authenticated purchaser+, on an approved invoice:
--     update vendor_invoices set discount = 5 where id = <id>;
--     → "This invoice is approved — withdraw approval before editing its
--        figures."
--   On an open one: succeeds, and financials_touched_at moves.
-- ============================================================================
