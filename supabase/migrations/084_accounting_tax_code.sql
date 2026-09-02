-- ============================================================================
-- restaurantfriend — migration 084 · the tax code customer invoices are sent at
--
-- Why: Mark chose (2026-09-02) to let QuickBooks compute the sales tax on a
-- customer invoice rather than accept ours, after three probes against a real
-- company showed it will not take our figure:
--
--   net line + TotalTax                    → tax DROPPED, stored as 0
--   net line + TotalTax + TaxLine + code   → OVERRIDDEN with its own rate
--   taxable line, QuickBooks computes      → its own rate, honoured
--
-- The catch this column exists for is the fourth probe: with `TxnTaxDetail`
-- present but EMPTY, QuickBooks computed NOTHING. It needs a tax code named,
-- and none of the sandbox's customers carries a `DefaultTaxCodeRef` to fall
-- back on — 0 of 5 — so it cannot be left to the customer record either.
--
-- ---------------------------------------------------------------------------
-- ON THE CONNECTION, for 081's reason, restated
--
-- A tax code id means something only inside one company file, exactly like
-- `bill_expense_account_ref` and `invoice_item_ref` beside it. In
-- `orgs.settings` it would silently point at a different code the moment the
-- realm changed; here it is cleared with the rest when `qbo-oauth` sees a new
-- realm, which is the whole reason those ids live on this row.
--
-- Nullable, and null is a real state: an org that sends no taxable customer
-- invoices never sets it, and `buildInvoicePayload` then sends no
-- `TxnTaxDetail` at all — which is how QuickBooks is told not to tax.
--
-- The NAME is a snapshot (013's rule, and 082's): renaming a code in
-- QuickBooks must not rewrite what this connection says it sends at.
--
-- Depends on 081. NOT rerunnable — `add column` fails the second time.
-- ============================================================================

alter table accounting_connections add column tax_code_ref  text;
alter table accounting_connections add column tax_code_name text;

comment on column accounting_connections.tax_code_ref is
  'QuickBooks TaxCode id customer invoices are sent under. QuickBooks computes '
  'the tax itself from this; ours is only compared against it. NULL means send '
  'no TxnTaxDetail, which is how QuickBooks is told not to tax. See 084.';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from information_schema.columns
--    where table_name = 'accounting_connections'
--      and column_name in ('tax_code_ref','tax_code_name');            → 2
--
--   select count(*) from accounting_connections where tax_code_ref is not null;
--                                                                     → 0
--     (nothing is backfilled; it is chosen in Settings → Accounting)
--
--   select count(*) from pg_policy
--    where polrelid = 'public.accounting_connections'::regclass;       → 0
--     (unchanged, and deliberate — 081's header says why)
-- ============================================================================
