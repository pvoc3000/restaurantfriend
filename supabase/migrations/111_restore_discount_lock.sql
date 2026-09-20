-- ============================================================================
-- restaurantfriend — migration 111 · put `discount` back in the locked set
--
-- A bug, found 2026-09-20 while reading this function in order to rename it.
--
-- 091 added `vendor_invoices.discount` and, in the same migration, added
-- `new.discount is distinct from old.discount` to the financials lock — a
-- discount is money, and money on an approved bill is not editable. 109 then
-- replaced the whole function to add `is_credit`, and its body was written from
-- 090's rather than 091's. The `discount` clause went with it, silently: a
-- `create or replace` of a trigger function cannot notice that the body it
-- replaces had a line the new one lacks.
--
-- The consequence, live until this runs: **the discount on an APPROVED bill can
-- be edited, and `financials_touched_at` is not stamped when it is.** Every
-- other locked column behaves correctly, which is why nothing surfaced it — the
-- screen refuses `total` and `tax` exactly as it should, so the lock reads as
-- working.
--
-- Separated from 110 deliberately. 110 is a rename and has to be reviewable as
-- one: a reader can assume every function body it recreates is equivalent to
-- the one it replaced. This is the only behavioural change in the pair, and it
-- gets to be visible.
--
-- The body below is 110's, with one line restored. Written against the RENAMED
-- function, so this must run after 110.
--
-- Depends on 110. Rerunnable.
-- ============================================================================

create or replace function public.enforce_vendor_bill_financials_lock()
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
    new.discount       is distinct from old.discount or
    new.subtotal       is distinct from old.subtotal or
    new.total          is distinct from old.total or
    new.is_credit      is distinct from old.is_credit
  );

  if v_changed and old.status <> 'open' then
    raise exception
      'This bill is % — % before editing its figures.',
      old.status,
      case old.status when 'void' then 'reopen it' else 'withdraw approval' end;
  end if;

  if v_changed then
    new.financials_touched_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_vendor_bill_financials_lock() is
  'BEFORE UPDATE on vendor_bills. Refuses a change to a locked column '
  'unless status is open; on a real change, stamps financials_touched_at. '
  'Not role-scoped — applies to owner/admin exactly as to purchaser. '
  'terms joined the locked set in 090, discount in 091, is_credit in 109; '
  '109 dropped discount by accident and 111 restored it. '
  'Renamed from enforce_vendor_invoice_financials_lock in 110. '
  'See 089, 090, 091, 109, 110, 111.';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   -- The clause is in the live body:
--   select pg_get_functiondef(oid) like '%new.discount%' from pg_proc
--    where proname = 'enforce_vendor_bill_financials_lock';              -- true
--
--   -- And still exactly one function by that name:
--   select count(*) from pg_proc
--    where proname = 'enforce_vendor_bill_financials_lock';              -- 1
--
--   -- Behavioural check, on a bill you can afford to disturb. Against an
--   -- APPROVED bill this must now RAISE where before it succeeded:
--   --   update vendor_bills set discount = coalesce(discount, 0) + 1
--   --    where id = '<an approved bill>';
--   -- → ERROR: This bill is approved — withdraw approval before editing its
--   --   figures.
-- ============================================================================
