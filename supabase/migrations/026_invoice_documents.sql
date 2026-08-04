-- ============================================================================
-- restaurantfriend — migration 026 · a document can belong to an invoice
--
-- 025 gave the invoice a record. This gives it the FILE.
--
-- Today `purchase_order_attachments` (001, given metadata by 018 and a reading
-- by 019) hangs every document off a purchase order. An invoice with no PO —
-- rent, the plumber, a Restaurant Depot receipt — cannot use that table at all,
-- because `po_id` is NOT NULL and the Storage key is {org_id}/{po_id}/{uuid}.
--
-- WHY THIS TABLE RATHER THAN A SECOND ONE. 021 created its own bucket for
-- employee documents, and that precedent does NOT apply here — the deciding
-- test is RLS. 021 needed a separate bucket because employee documents have a
-- DIFFERENT audience (owner/admin). Invoice documents want exactly the audience
-- PO attachments already have, so a second bucket would exist to carry a policy
-- that is identical. A second TABLE would be worse still: the physical invoice
-- PDF arrives on the ORDER at the delivery and then needs to be on the invoice,
-- so it would be either stored twice or owned by one side, and 018's careful
-- delete ordering would have two rows pointing at one object to reason about.
--
-- WHY NO STORAGE CHANGES ARE NEEDED. 018's four policies on storage.objects
-- test `bucket_id` and `public.storage_folder_org(name)`, which is
-- `(storage.foldername(name))[1]::uuid` — the FIRST path segment. They say
-- nothing whatever about the second. So a key
--
--     {org_id}/invoices/{invoice_id}/{uuid}.pdf
--
-- is authorized by the existing policies with no new function, no new policy
-- and no new grant. Verified against 018's own SQL, 2026-08-04.
--
-- NOTHING MIGRATES. A file already attached to a purchase order keeps today's
-- key even when it later gains an invoice_id — the path records where the file
-- landed, not a claim about who owns it.
--
-- `extract-invoice` needs no structural change either: it selects po_id and
-- uses it for nothing, checks the role on org_id, downloads through the
-- caller's JWT (018's storage policy decides) and writes `extraction` back to
-- this same table. All of that works unchanged on a po_id-null row.
--
-- Depends on 025 (FK to vendor_invoices). Apply 025 first.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A document can belong to a purchase order, an invoice, or both
-- ----------------------------------------------------------------------------

alter table purchase_order_attachments
  alter column po_id drop not null;

-- `on delete set null`, NOT cascade: a document can belong to BOTH a purchase
-- order and an invoice, and deleting the invoice record must not delete the
-- order's paperwork.
alter table purchase_order_attachments
  add column invoice_id uuid references vendor_invoices(id) on delete set null;

create index purchase_order_attachments_invoice_idx
  on purchase_order_attachments (invoice_id)
  where invoice_id is not null;

-- Deliberately NO `check (po_id is not null or invoice_id is not null)`, and
-- this is a real trade rather than an oversight. With `set null` above, that
-- check would make deleting an invoice whose only document is invoice-only fail
-- with a raw constraint violation — in front of the person doing the deleting.
--
-- Instead the app's invoice-delete path removes `where invoice_id = x and
-- po_id is null` documents FIRST (row then object, 018's order), and any row
-- that somehow survives is unreachable — which is the tolerance 018 already
-- states for orphaned objects: invisible and harmless.
--
-- The table's NAME is now slightly wrong. Renaming it is right eventually and
-- wrong bundled with a new module and a live edge-function redeploy; propose it
-- later as its own content-free migration (005's precedent).

comment on column purchase_order_attachments.invoice_id is
  'The vendor invoice this document belongs to, if any. A document may belong '
  'to a purchase order, an invoice, or both. Storage key is '
  '{org_id}/{po_id}/{uuid} for PO-born files and '
  '{org_id}/invoices/{invoice_id}/{uuid} for invoice-born ones; 018''s policies '
  'authorize off the first segment only, so both are covered.';

-- ----------------------------------------------------------------------------
-- 2. The other half of the QuickBooks seam
-- ----------------------------------------------------------------------------
--
-- 025 put `external_ref` on the invoice. This is the VENDOR mapping — QBO needs
-- to know which of its own Vendor records a bill belongs to.
--
-- On `vendor_locations` rather than `vendors` because (vendor, location) is the
-- honest key: a per-location company file has its own vendor ids. For a
-- single-file org it simply holds the same value on every row, which costs
-- nothing. Deliberately ONE place, not both tables.
--
-- Nothing reads this yet. It is here because a per-record external id is the
-- only part of the sync that is painful to retrofit once invoices exist.

alter table vendor_locations
  add column external_ref jsonb not null default '{}'::jsonb;

comment on column vendor_locations.external_ref is
  'Accounting-system identity for this vendor at this location, e.g. '
  '{"qbo": {"id": "58"}}. Written by a future sync; unread in v1.';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select is_nullable from information_schema.columns
--    where table_name = 'purchase_order_attachments'
--      and column_name = 'po_id';                     -- YES
--
--   select count(*) from purchase_order_attachments
--    where invoice_id is not null;                    -- 0, column exists
--
--   select external_ref from vendor_locations limit 1; -- {}
--
--   -- Existing paperwork is untouched — every row still names its order:
--   select count(*) from purchase_order_attachments where po_id is null;  -- 0
-- ============================================================================
