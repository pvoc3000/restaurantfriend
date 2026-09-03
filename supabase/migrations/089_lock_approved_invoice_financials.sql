-- ============================================================================
-- restaurantfriend — migration 089 · an approved invoice's figures are locked
--
-- Mark, 2026-09-03: "I think a lot of the invoice should not be editable once
-- it has been approved for payment. The billed qty, unit price, tax, freight,
-- and other fields at the very least, and any others you recommend. If the
-- user wants to edit these things, they need to withdraw approval first."
--
-- Followed by his own question, which decided the second half of this
-- migration: "what happens to invoices already sent to QBO if the user edits
-- the invoice?"
--
-- ----------------------------------------------------------------------------
-- WHY A TRIGGER, NOT JUST THE CLIENT'S `canEdit`
--
-- `canEdit` on `InvoiceDetail` is role-only (`canWriteCatalog`) and has never
-- once asked what STATUS the invoice is in — every field has been writable
-- straight through PostgREST by any purchaser+, approved or not, since 025.
-- A client-side guard alone is exactly the kind of thing this schema has
-- warned about since 002: a stale tab, a second browser, or a direct API call
-- would still get through. RLS can't express it either — `USING`/`WITH CHECK`
-- see one row's OLD or NEW state, not a comparison BETWEEN them, and the rule
-- here is "you may not CHANGE these columns" — which needs a trigger.
--
-- The lock is deliberately NOT role-scoped: an owner is blocked from touching
-- an approved bill's figures exactly as a purchaser is. Approval is a claim
-- someone made ("this is correct and payable"); changing what was approved
-- without first taking that claim back is the thing being prevented, and that
-- has nothing to do with who is doing it.
--
-- ----------------------------------------------------------------------------
-- WHAT LOCKS AND WHAT DOESN'T
--
-- Locked — this is "the claim being approved": invoice_number, invoice_date,
-- due_date, vendor_id, location_id, tax, freight, other_charges, subtotal,
-- total on the header; qty, unit_price, extended, kind, purchase_order_id,
-- purchase_order_item_id on a line. `kind` locks because a freight/item
-- toggle changes what `computedAmounts` counts toward the subtotal without
-- touching qty or price — the same money movement through a side door. The
-- PO link locks because relinking a line changes what receiving comparison
-- (`receivedFor`) is measured against, which is part of what was approved.
--
-- NOT locked, on purpose: notes and terms (header) — pure annotation, no
-- effect on money or on what QuickBooks receives — and product_id,
-- description, pack (line) — catalog/identity text, correctable without
-- reopening a bill that was correctly priced. Also untouched: attaching or
-- re-reading paperwork, Void, Delete, Approve, Withdraw approval, and every
-- QuickBooks action — none of those is a field edit.
--
-- The rule is uniform — editable iff status = 'open' — so a VOIDED invoice
-- locks exactly like an approved one. Reopen is void's own unlock path, the
-- same shape as Withdraw approval.
--
-- ----------------------------------------------------------------------------
-- `financials_touched_at` — WHAT MARK'S SECOND QUESTION NEEDED
--
-- "What happens to invoices already sent to QBO if the user edits the
-- invoice?" The lock already answers most of it: reaching an edit at all
-- means an owner/admin deliberately withdrew approval first, which is already
-- the auditable, deliberate act this app leans on everywhere else. What was
-- missing is a way to know, AFTERWARDS, that the figures moved since the last
-- push — `synced_at` says when we told QuickBooks something; nothing said
-- whether that something was still true.
--
-- `financials_touched_at` is bumped ONLY when a LOCKED column actually
-- changes value (`is distinct from`, so a write that reasserts the same
-- number is not a touch) — never by editing notes or terms, which are not
-- part of what gets pushed. Comparing it against `synced_at` in the app
-- answers "has this been edited since QuickBooks last heard about it?"
-- precisely, without a false alarm every time someone fixes a typo in a note.
--
-- A line's locked columns bump the PARENT's `financials_touched_at` too — a
-- qty or price correction is exactly the case this exists to catch, and it
-- lives on the LINE table while the pushed payload is a HEADER concern.
--
-- Null forever on an invoice nobody has edited since creation, which is most
-- of them; that reads as "not stale" together with a null `synced_at`
-- (nothing pushed to be stale against), same shape as 088's tri-state.
--
-- ----------------------------------------------------------------------------
-- ONE HEADER TRIGGER DOES BOTH JOBS — lock and touch — because they are the
-- same comparison (which locked columns changed) asked twice: once as a
-- refusal, once as a timestamp. Splitting them into two triggers would mean
-- running that comparison twice per write for no reason.
--
-- THE LINE TRIGGERS ARE TWO, DELIBERATELY SEPARATE: a BEFORE trigger that can
-- refuse the write outright (needs the PARENT's status, fetched by a
-- subquery), and an AFTER trigger that updates the PARENT row once the write
-- has actually gone through. A single BEFORE trigger cannot safely update a
-- DIFFERENT table's row and then still validate its own — Postgres does not
-- guarantee that ordering — where a BEFORE/AFTER pair on the SAME table
-- always fires in that order for the SAME statement.
--
-- Depends on 025 (`vendor_invoices`, `vendor_invoice_lines`). NOT
-- rerunnable — `add column` and `create trigger` both fail the second time.
-- ============================================================================

alter table vendor_invoices add column financials_touched_at timestamptz;

comment on column vendor_invoices.financials_touched_at is
  'When a locked (money-affecting) column last actually changed value. '
  'Compared against synced_at to say whether this invoice was edited since '
  'QuickBooks last heard about it. Null means never touched since creation, '
  'which reads as not stale against a null synced_at. Bumped by the trigger '
  'below, and by the line trigger on the parent when a line''s own locked '
  'column changes. Never written by app code. See 089.';

-- ----------------------------------------------------------------------------
-- The header: lock, and touch the timestamp in the same pass.
-- ----------------------------------------------------------------------------

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
  'Not role-scoped — applies to owner/admin exactly as to purchaser. See 089.';

create trigger trg_vendor_invoices_financials_lock
  before update on vendor_invoices
  for each row execute function public.enforce_vendor_invoice_financials_lock();

-- ----------------------------------------------------------------------------
-- The lines: refuse (BEFORE, needs the parent's status), then touch the
-- parent (AFTER, once the write has actually gone through).
-- ----------------------------------------------------------------------------

create or replace function public.enforce_vendor_invoice_line_financials_lock()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
  v_status  text;
begin
  v_changed := (
    new.qty                   is distinct from old.qty or
    new.unit_price             is distinct from old.unit_price or
    new.extended                is distinct from old.extended or
    new.kind                    is distinct from old.kind or
    new.purchase_order_id       is distinct from old.purchase_order_id or
    new.purchase_order_item_id  is distinct from old.purchase_order_item_id
  );

  if not v_changed then
    return new;
  end if;

  select status into v_status from vendor_invoices where id = old.invoice_id;

  if v_status <> 'open' then
    raise exception
      'This invoice is % — % before editing its lines.',
      v_status,
      case v_status when 'void' then 'reopen it' else 'withdraw approval' end;
  end if;

  return new;
end;
$$;

comment on function public.enforce_vendor_invoice_line_financials_lock() is
  'BEFORE UPDATE on vendor_invoice_lines. Same rule as the header trigger, '
  'read off the parent invoice''s status. See 089.';

create trigger trg_vendor_invoice_lines_financials_lock
  before update on vendor_invoice_lines
  for each row execute function public.enforce_vendor_invoice_line_financials_lock();

create or replace function public.touch_vendor_invoice_financials_from_line()
returns trigger
language plpgsql
as $$
begin
  if (
    new.qty                   is distinct from old.qty or
    new.unit_price             is distinct from old.unit_price or
    new.extended                is distinct from old.extended or
    new.kind                    is distinct from old.kind or
    new.purchase_order_id       is distinct from old.purchase_order_id or
    new.purchase_order_item_id  is distinct from old.purchase_order_item_id
  ) then
    update vendor_invoices
       set financials_touched_at = now()
     where id = new.invoice_id;
  end if;
  return new;
end;
$$;

comment on function public.touch_vendor_invoice_financials_from_line() is
  'AFTER UPDATE on vendor_invoice_lines. Stamps the parent invoice''s '
  'financials_touched_at when a locked line column actually changed. Runs '
  'only after enforce_vendor_invoice_line_financials_lock() has already let '
  'the write through, so the parent is guaranteed open at this point. '
  'See 089.';

create trigger trg_vendor_invoice_lines_financials_touch
  after update on vendor_invoice_lines
  for each row execute function public.touch_vendor_invoice_financials_from_line();

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from information_schema.columns
--    where table_name = 'vendor_invoices' and column_name = 'financials_touched_at';
--                                                                          → 1
--   select count(*) from vendor_invoices where financials_touched_at is not null;
--                                                                          → 0
--     (nothing backfilled; every existing row correctly reads "untouched")
--
--   select count(*) from pg_trigger
--    where tgrelid = 'public.vendor_invoices'::regclass and not tgisinternal;
--                                                                          → 2
--     (trg_vendor_invoices_updated from 025, plus this migration's lock trigger)
--   select count(*) from pg_trigger
--    where tgrelid = 'public.vendor_invoice_lines'::regclass and not tgisinternal;
--                                                                          → 3
--     (025's updated-at trigger, plus this migration's lock + touch triggers)
--
--   select count(*) from pg_policy
--    where polrelid in ('public.vendor_invoices'::regclass,
--                        'public.vendor_invoice_lines'::regclass);
--                                                    → unchanged (025's four)
--     No new policy — the lock is a trigger, not a role rule, and 025's
--     purchaser+ update policies are exactly right for who may attempt a
--     write; this migration decides only whether that write is allowed to
--     land.
-- ============================================================================
