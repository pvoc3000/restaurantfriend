-- ============================================================================
-- restaurantfriend — migration 082 · a vendor posts to its own expense account
--
-- Why (Mark, 2026-09-01): "Cost of Goods Sold should have a few different sub
-- accounts and I would want to connect them to different vendors. For instance,
-- Bakemark invoices should default to 'Cost of Goods Sold -> Baker Items COGs'.
-- Vesta invoices should default to 'Cost of Goods Sold -> Produce Items COGs'."
--
-- 081 gave the CONNECTION one `bill_expense_account_ref`, which is right as a
-- floor and wrong as the whole answer: a bakery's flour and its produce are
-- different lines on the P&L, and posting every bill to one account throws away
-- the distinction at the moment it is easiest to keep.
--
-- ---------------------------------------------------------------------------
-- IT IS AN OVERRIDE, NOT A REPLACEMENT
--
-- Design rule 6's shape, the one this schema already uses for money:
-- `vendor_item_location_prices` overrides `vendor_items.price`, and here the
-- vendor overrides the connection's default. NULL means "use the default",
-- which is why both columns are nullable and why nothing is backfilled — 80
-- vendors keep working the moment this runs, and only the ones worth splitting
-- out need touching.
--
-- ---------------------------------------------------------------------------
-- TWO COLUMNS, NOT ONE, AND THE NAME IS A SNAPSHOT
--
-- `_ref` is the QuickBooks account id, which is what the push sends. `_name` is
-- what it was called when it was chosen, which is what the vendor record shows
-- and what an audit reads — and it is a SNAPSHOT for 013's reason: renaming an
-- account in QuickBooks must not silently rewrite what this app says it posts
-- to. The pair mirrors `accounting_connections.bill_expense_account_ref/_name`
-- exactly, so the override and the default read the same way.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `vendors.external_ref`, WHICH IS ALREADY JSONB AND ALREADY THERE
--
-- Because that column means IDENTITY — which vendor this is in QuickBooks —
-- and an expense account is CONFIGURATION: how we choose to post them. One
-- column holding both is a name that lies, which this schema has already paid
-- for twice (015's `notes` vs Receiving, 059's `dismiss_reason`). It also keeps
-- 081's unique index on `external_ref->'qbo'->>'id'` about identity alone.
--
-- No RLS change: `vendors` already has its own policies and these are two more
-- columns on a row a purchaser may already edit. Unlike `external_ref` on
-- `vendor_invoices`, there is nothing to protect here — a wrong account is a
-- visible bookkeeping mistake on a screen, not a forged sync record.
--
-- Depends on 001 (vendors) and 081 (the connection whose default this
-- overrides). Rerunnable is NOT claimed: `add column` fails the second time,
-- which is the signal it already ran.
-- ============================================================================

alter table vendors add column expense_account_ref  text;
alter table vendors add column expense_account_name text;

comment on column vendors.expense_account_ref is
  'QuickBooks account id this vendor''s bills post to. NULL means use '
  'accounting_connections.bill_expense_account_ref. See migration 082.';
comment on column vendors.expense_account_name is
  'What that account was called when it was chosen — a snapshot, so renaming '
  'it in QuickBooks cannot rewrite what this record says it posts to.';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from vendors where expense_account_ref is not null;   → 0
--     (nothing is backfilled: every vendor falls back to the org default
--      until somebody deliberately splits one out)
--
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'vendors'
--      and column_name in ('expense_account_ref','expense_account_name');
--                                                          → 2 rows, both YES
--
--   select count(*) from pg_policy
--    where polrelid = 'public.vendors'::regclass;          → unchanged (2)
-- ============================================================================
