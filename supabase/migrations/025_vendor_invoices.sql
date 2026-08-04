-- ============================================================================
-- restaurantfriend — migration 025 · the invoice becomes a record
--
-- Why (Mark, 2026-08-04, after using the receiving screen): "Every time we
-- upload an invoice to a purchase order we could create an invoice record.
-- Invoice records could sync to Quickbooks online or Bill.com […] Paid/Unpaid
-- invoices could be flagged in our app. It would complete the work flow."
--
-- The READING half already exists — `extract-invoice` returns the vendor, the
-- number, the dates, the total and the lines, and 019 stores all of it on
-- `purchase_order_attachments.extraction`. What has never existed is a RECORD:
-- something with a status, a due date, and an identity independent of one
-- attachment on one purchase order.
--
-- Three things that record has to do which the jsonb reading cannot:
--
--   1. EXIST WITHOUT A PURCHASE ORDER. `vendors` already holds the landlord,
--      the plumber and the utilities with order_type = 'none'. They never
--      produce a PO and always produce a bill you must pay.
--   2. CARRY A MANY-TO-MANY LINK. One invoice covering two orders, and one
--      order invoiced in two parts (backorders), are both routine.
--   3. BE EDITED. A machine's reading of a photograph is a proposal; the
--      corrections a human makes to it have to survive a re-read.
--
-- 026 makes `purchase_order_attachments` able to point at an invoice and
-- depends on this file (FK to vendor_invoices). Apply 025 first. Split so a
-- problem in the alter half cannot hold the create half hostage — 021's
-- precedent, which was 018's.
--
-- See docs/invoices-brief.md for the reasoning behind every choice below.
--
-- Run in the Supabase SQL editor. NOT rerunnable (create table fails a second
-- time — that means it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The invoice
-- ----------------------------------------------------------------------------
--
-- Named `vendor_invoices`, not `invoices`, and the UI label is still
-- "Invoices" (design rule 2 makes the label free). docs/master-plan.md's
-- unbuilt Quotes & Orders module has a customer-facing "Quote → Invoice →
-- Receipt" lifecycle over 8.3k orders, so a bare `invoices` is a name the
-- CUSTOMER side will want — the same collision `purchase_orders` already
-- dodged with a future `orders`, and `vendor_` is the prefix this schema
-- already uses for the supplier side (vendor_items, vendor_locations).
-- Renaming a table with RLS policies and app queries is migration 005's whole
-- ceremony; this is the one name here that is expensive to change afterwards.

create table vendor_invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,

  -- NOT NULL, deliberately. Rent, utilities and a plumber are per-shop costs.
  -- A PO-born invoice inherits the order's location; a hand-typed one takes
  -- the working location. Nullable-means-org-wide would be worse than either:
  -- a null row either vanishes from every location-scoped screen or shows up
  -- on all of them, and both read as a bug. If a genuinely org-wide bill needs
  -- a home, the answer is a scope on the LIST (/cleanup's all-locations mode),
  -- not a null in the column.
  location_id    uuid not null references locations(id),
  vendor_id      uuid not null references vendors(id),

  -- Nullable: a rent bill or a handwritten receipt has no number at all.
  invoice_number text,
  invoice_date   date,
  due_date       date,
  -- As PRINTED ("Net 30", "COD", "2% 10 Net 30"). Free text, not a vocabulary:
  -- the words are the vendor's, not ours.
  terms          text,

  subtotal       numeric(12,2),
  tax            numeric(12,2),
  freight        numeric(12,2),
  other_charges  numeric(12,2),
  total          numeric(12,2),

  -- A credit memo, with the amounts above stored POSITIVE.
  --
  -- OCR hands back "-142.10", "142.10 CR" and "142.10" on a page headed CREDIT
  -- MEMO unpredictably. A flag plus positive magnitudes gives exactly one
  -- convention; a signed total would mean every reader has to know whether a
  -- given row is already signed. `signedTotal()` in lib/invoices is the single
  -- place the sign lives. The READING transcribes as printed; the RECORD
  -- normalizes — that seam is `invoiceHeaderFromExtraction`.
  is_credit      boolean not null default false,

  -- Three statuses, and no `paid`: v1 has no payment writer, and once the
  -- QuickBooks sync exists "paid" is a fact QBO owns. Two truths about the
  -- same money is worse than one truth elsewhere; the check widens in one line
  -- when the sync lands.
  --
  -- No `draft` either. A half-typed bill and a machine-read one are both open
  -- bills — what distinguishes them is `source` below, not a status. A second
  -- unapproved state that nothing operationally distinguishes is the mistake
  -- `closed` made in 001: it sorted and badged correctly and sat unused for
  -- months because nothing routed you to it.
  --
  -- `open` deliberately rhymes with the PO list's own Open roll-up
  -- ("everything not yet inert"), so the two lists read as one system.
  status         text not null default 'open'
                 check (status in ('open', 'approved', 'void')),
  approved_at    timestamptz,
  approved_by    uuid references auth.users(id),

  -- How this record came to exist. Not a status: it never changes, and it is
  -- what tells a hand-typed rent bill from a read one when both are `open`.
  source         text not null default 'manual'
                 check (source in ('manual', 'extraction')),

  notes          text,

  -- The QuickBooks seam, and the ONLY part of the sync built now.
  --
  -- jsonb rather than a `qbo_id text`, because QBO also needs its SyncToken for
  -- optimistic concurrency and a second provider (or a second company file)
  -- shouldn't need a migration: {"qbo": {"id": "1234", "sync_token": "3"}}.
  -- Deliberately NO sync-log table — its shape depends entirely on a sync
  -- design that doesn't exist yet (per-record? batched? webhook-driven?), and
  -- an empty table with no writer is the thing this schema keeps regretting.
  -- A per-record external id is the only piece that is painful to retrofit.
  external_ref   jsonb not null default '{}'::jsonb,
  synced_at      timestamptz,

  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The list's own query: location-scoped, newest first, bounded by a date window.
create index vendor_invoices_location_idx
  on vendor_invoices (location_id, invoice_date desc);

-- Duplicate detection reads this — see the note on the absent unique
-- constraint under section 3.
create index vendor_invoices_vendor_idx
  on vendor_invoices (org_id, vendor_id, invoice_number);

create trigger trg_vendor_invoices_updated before update on vendor_invoices
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. The invoice's lines — and the many-to-many
-- ----------------------------------------------------------------------------
--
-- REAL ROWS, not the jsonb reading, for four reasons in order of force:
--
--   1. The many-to-many lives on the line and needs a foreign key. A jsonb
--      array can't have one and can't be indexed for "which invoices touch
--      this PO".
--   2. A line gets EDITED, and a jsonb path is POSITIONAL. A re-read renumbers
--      the positions and silently retargets every correction someone made —
--      data loss with no symptom.
--   3. A hand-typed rent bill has no extraction to live in, so the column
--      would end up meaning two different things.
--   4. Money has to sum. `purchase_order_items` is real rows for exactly this.
--
-- `purchase_order_attachments.extraction` (019) is UNCHANGED and keeps its own
-- meaning: the raw reading, on the document row, never edited. The chain is
-- document → raw reading → seeded lines → corrected lines, so you can always
-- ask what the machine actually said after six edits.

create table vendor_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  invoice_id  uuid not null references vendor_invoices(id) on delete cascade,

  -- THE JOIN. Both columns, on the LINE — no FK on the invoice header and no
  -- `invoice_purchase_orders` join table.
  --
  -- This is the same granularity as the reconciliation the app already does:
  -- `matchInvoiceToOrder` produces exactly a per-line pairing, so persisting it
  -- is a one-column write. Both directions are then one index, and split and
  -- merge need no schema at all — one invoice across two orders is lines
  -- pointing at two orders, and one order invoiced in two parts is two
  -- invoices whose lines point at disjoint subsets (hence NO unique constraint
  -- on purchase_order_item_id: a PO line genuinely can be billed twice).
  --
  -- A derived link also cannot go stale, where an explicit join table can
  -- claim "invoice A relates to PO 7" while none of A's lines touch 7.
  --
  -- `purchase_order_id` is the coarser attribution, for the two things a pure
  -- line-item join can't express: a line matching no PO line (freight, a fuel
  -- surcharge, something billed but never ordered), and an invoice you know
  -- belongs to PO 7 where every line match failed.
  --
  -- Denormalized on purpose, and safe: `purchase_order_items.po_id` is written
  -- at insert and is never updated anywhere in web/src, so a PO item cannot
  -- move between orders and this copy cannot drift. Verified 2026-08-04. Don't
  -- add a trigger to defend an invariant the app already has.
  purchase_order_id      uuid references purchase_orders(id) on delete set null,
  purchase_order_item_id uuid references purchase_order_items(id) on delete set null,

  line_no        integer,
  -- The two identifier columns an invoice can print, mirroring InvoiceLine.
  product_id     text,
  alt_product_id text,
  description    text,
  pack           text,

  qty            numeric(12,3),
  -- FOUR decimals, deliberately. `invoiceUnitPrice` derives extended ÷ qty and
  -- catch-weight lines produce fractions of a cent; rounding at storage would
  -- make the invoice's own arithmetic stop closing.
  --
  -- Do NOT "fix" purchase_order_items.unit_price to match. Its two decimals are
  -- load-bearing: they are what makes the receiving screen's two-stage price
  -- button terminate.
  unit_price     numeric(12,4),
  extended       numeric(12,2),

  -- Three values, not five. Tax is a HEADER amount and a discount is a negative
  -- `other`. This exists so the totals check and the billed-but-not-ordered
  -- list can tell a freight line from an unmatched ITEM.
  kind        text not null default 'item'
              check (kind in ('item', 'freight', 'other')),
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Naming a LINE obliges you to name its ORDER, which keeps one
  -- representation at one granularity.
  constraint vendor_invoice_lines_po_consistent
    check (purchase_order_item_id is null or purchase_order_id is not null)
);

create index vendor_invoice_lines_invoice_idx
  on vendor_invoice_lines (invoice_id);

-- "Which invoices touch this purchase order" — the receiving screen's question.
create index vendor_invoice_lines_po_idx
  on vendor_invoice_lines (purchase_order_id)
  where purchase_order_id is not null;

create trigger trg_vendor_invoice_lines_updated before update on vendor_invoice_lines
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
--
-- Explicit policies, like 020 and 021, rather than 001's generic do-loop.
--
-- READ is any member. An invoice carries prices, not personal data; the
-- purchase order it mirrors is already member-readable, and whoever is standing
-- at the delivery has to be able to see it. (Contrast `employees`, whose read
-- gate exists because of home addresses and dates of birth.)
--
-- WRITE is purchaser+ — the same set that receives an order and files its
-- paperwork in the first place.
--
-- There is NO unique constraint on (org_id, vendor_id, invoice_number), and
-- that is deliberate: duplicate detection WARNS and never blocks, following
-- `findPossibleRehires`. A credit memo legitimately carries the number of the
-- invoice it credits; `invoice_number` is nullable and Postgres allows
-- unlimited NULLs in a unique index, so the constraint would silently skip the
-- numberless rent bill — the row most likely to be entered twice; and one
-- misread digit lets a real duplicate through while refusing a correctly-read
-- reissue. The failure would arrive as a raw 23505 in front of someone holding
-- paper at a delivery.
--
-- The structural guard that actually matters is better anyway: a document row
-- carries at most one invoice_id (026) and auto-creation fires only when it is
-- null, so re-reading a filed invoice can never create a second record.

alter table vendor_invoices      enable row level security;
alter table vendor_invoice_lines enable row level security;

create policy vendor_invoices_select on vendor_invoices for select
  using (org_id in (select user_org_ids()));

create policy vendor_invoices_insert on vendor_invoices for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy vendor_invoices_update on vendor_invoices for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy vendor_invoices_delete on vendor_invoices for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy vendor_invoice_lines_select on vendor_invoice_lines for select
  using (org_id in (select user_org_ids()));

create policy vendor_invoice_lines_insert on vendor_invoice_lines for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy vendor_invoice_lines_update on vendor_invoice_lines for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy vendor_invoice_lines_delete on vendor_invoice_lines for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

-- ----------------------------------------------------------------------------
-- 4. Approval — a definer function, because RLS filters ROWS, not COLUMNS
-- ----------------------------------------------------------------------------
--
-- The rule Mark chose is "a purchaser may edit this invoice, but only a
-- manager may say we owe this money". That is a COLUMN rule, and no policy can
-- express it: the update policy above either lets a purchaser write the row or
-- it doesn't. So the columns get named by a `security definer` function
-- instead — the `set_my_member_profile` pattern from migration 002.
--
-- A definer function bypasses RLS, so its body re-checks what RLS would have.
--
-- ONE function does both directions. An approval with no way back means people
-- stop approving.

create or replace function public.set_vendor_invoice_approval(
  p_invoice  uuid,
  p_approved boolean
)
returns setof vendor_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status
    from vendor_invoices where id = p_invoice;

  -- No such invoice, not your org, or an invoice that has been voided: return
  -- NO ROWS rather than raising. The caller checks the count — see below.
  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin']) then return; end if;
  if v_status = 'void' then return; end if;

  return query
    update vendor_invoices set
      status      = case when p_approved then 'approved' else 'open' end,
      -- Never from the client. Approval is a claim about who said so.
      approved_at = case when p_approved then now() else null end,
      approved_by = case when p_approved then auth.uid() else null end
    where id = p_invoice
    returning *;
end $$;

-- BOTH revokes, per 002: a new public-schema function is executable by PUBLIC,
-- and Supabase's default privileges ALSO grant execute to `anon` explicitly —
-- an explicit grant survives a revoke from PUBLIC, so anon has to be named.
revoke all on function public.set_vendor_invoice_approval(uuid, boolean) from public;
revoke all on function public.set_vendor_invoice_approval(uuid, boolean) from anon;
grant execute on function public.set_vendor_invoice_approval(uuid, boolean) to authenticated;

-- It RETURNS ROWS so the caller can check how many it got. An update that
-- matches no policy — or, here, that fails the role check inside the function —
-- changes nothing and PostgREST returns NO ERROR. A cheerful false success is
-- how the employee delete navigated back to a roster that had grown by one, and
-- how Finalize reported closing an order it hadn't. Zero rows means refused.

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from vendor_invoices;               -- 0, table exists
--   select count(*) from vendor_invoice_lines;          -- 0, table exists
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.vendor_invoices'::regclass;      -- four rows
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.vendor_invoice_lines'::regclass; -- four rows
--
--   -- Raises on its first statement instead of doing any work:
--   select * from set_vendor_invoice_approval(
--     '00000000-0000-0000-0000-000000000000'::uuid, true);     -- 0 rows
--
--   -- The check constraint means what it says:
--   select conname from pg_constraint
--    where conrelid = 'public.vendor_invoice_lines'::regclass; -- includes
--                                                -- vendor_invoice_lines_po_consistent
-- ============================================================================
