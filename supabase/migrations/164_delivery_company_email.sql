-- ============================================================================
-- 164 — THE DELIVERY COMPANY'S EMAIL ON THE ORDER
--
-- Mark, 2026-10-01: "add a delivery vendor email field to the delivery tab.
-- Fill it in when the user selects a delivery vendor", for the Request Quote
-- button, which emails that address.
--
-- Beside `delivery_company_phone` (051), and like it a COPY taken when the
-- company is chosen — the vendor's `vendor_locations.rep_email` at the
-- order's kitchen — so it can be corrected for one order without touching the
-- vendor, and an order keeps the address its request actually went to.
--
-- THE APP SELECTS THIS COLUMN on every order record, so apply this BEFORE the
-- web change ships, or the record answers "column does not exist". RERUNNABLE.
-- ============================================================================

alter table special_orders add column if not exists delivery_company_email text;

notify pgrst, 'reload schema';
