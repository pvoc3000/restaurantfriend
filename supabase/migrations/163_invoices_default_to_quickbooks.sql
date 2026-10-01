-- ============================================================================
-- 163 — A NEW CUSTOMER INVOICE COLLECTS THROUGH QUICKBOOKS BY DEFAULT
--
-- Mark, 2026-10-01: "change the database default to quickbooks too", after
-- both create dialogs were moved to QuickBooks (`DEFAULT_PROCESSOR` in
-- `lib/customerInvoices`). Square was 131's default.
--
-- The column default only. Every caller in the app names the processor
-- (`create_customer_invoice`'s `p_processor` has no default, and 124's old
-- five-argument signature that passed 'square' was dropped by 145), so this
-- changes nothing a person sees — it is where an insert that names none lands.
-- Existing invoices keep what they have. RERUNNABLE.
-- ============================================================================

alter table customer_invoices alter column processor set default 'quickbooks';
