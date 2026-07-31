-- ============================================================================
-- restaurantfriend — migration 019 · what the invoice says
--
-- Migration 018 got the invoice INTO the system. This one gives it somewhere
-- to put what the invoice SAYS: the line items read off the attachment by the
-- `extract-invoice` edge function, so receiving can compare billed-vs-ordered
-- instead of asking a human to read two documents side by side.
--
-- Spec §3 listed invoice OCR as a v2 improvement ("pairs perfectly with the
-- receiving flow"); attachments are what made it buildable.
--
-- On the ATTACHMENT rather than a table of its own: the extraction is 1:1 with
-- the file it was read from and has no life without it — re-reading the same
-- invoice replaces the previous answer rather than accumulating versions, and a
-- deleted attachment should take its extraction with it (which a column does
-- for free). An invoice has 5–20 lines, so the app matches them against the PO
-- in the browser; there is nothing here to index or join on.
--
-- Run in the Supabase SQL editor. NOT rerunnable — `add column` fails a second
-- time.
-- ============================================================================

alter table purchase_order_attachments
  -- The whole reading: header fields (vendor, invoice number, date, total) plus
  -- a `lines` array. Shape is `InvoiceExtraction` in web/src/lib/invoiceExtraction.ts
  -- and the json_schema the model is held to in the edge function — those two
  -- are the same contract written twice (Deno can't import from web/), so a
  -- change to one is a change to both.
  add column extraction jsonb,
  add column extracted_at timestamptz,
  -- Which model produced it. An extraction read months ago by a different model
  -- is still a fact about this order, and knowing what read it is the
  -- difference between "the invoice said 4" and "something said the invoice
  -- said 4".
  add column extraction_model text;

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select extraction, extracted_at, extraction_model
--     from purchase_order_attachments limit 1;
-- ============================================================================
