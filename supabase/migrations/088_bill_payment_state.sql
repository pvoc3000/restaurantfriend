-- ============================================================================
-- restaurantfriend — migration 088 · what QuickBooks last said a bill still owes
--
-- Mark, 2026-09-02: "It would be nice for the app to indicate when bills have
-- been paid." The reading already existed — `refresh_status` pulls `Balance`
-- and a bill's own screen says "paid in QuickBooks" or what is owed — but it
-- was held in state and lost on reload, so a LIST column was blank until you
-- pressed a button, which is no use at all.
--
-- ---------------------------------------------------------------------------
-- THIS BENDS A RULE ON PURPOSE, AND THE BEND IS THE POINT
--
-- 025, 051 and `lib/invoices` all say payment is a fact QuickBooks owns, and
-- `refresh_status` was written to RETURN a balance and store nothing —
-- "a balance written into our row is stale the moment it lands while still
-- being rendered as though it were current."
--
-- That rule was about a BARE figure rendered as current. It is not an argument
-- against a figure stored WITH the moment it was true, and rendered with it
-- every time. So `qbo_checked_at` is not bookkeeping beside the balance, it is
-- the thing that makes storing the balance honest — the two are one fact and
-- neither may be shown without the other.
--
-- What has NOT changed: this app still records no vendor payment of its own.
-- QuickBooks remains the only place an A/P payment exists, so this is a CACHE
-- of somebody else's fact and never a second source of truth. (The A/R side is
-- the opposite and is why the same pull is refused there: a customer's payment
-- already lives in `special_order_payments`.)
--
-- ---------------------------------------------------------------------------
-- THE TRI-STATE, which a tidy-up would collapse and must not
--
--   qbo_checked_at IS NULL                   → nobody has asked yet
--   qbo_checked_at SET, qbo_balance IS NULL  → we asked, and QuickBooks does
--                                              not have it any more (deleted or
--                                              voided there)
--   qbo_checked_at SET, qbo_balance = 0      → paid in full
--   qbo_checked_at SET, qbo_balance > 0      → that much still owed
--
-- "Never asked" and "asked, and it is gone" are different sentences and only
-- one of them is alarming. Collapsing them — treating a null balance as
-- unknown — would let a bill deleted in QuickBooks read as merely unchecked,
-- which is the one outcome this column exists to surface.
--
-- ---------------------------------------------------------------------------
-- NO DEFAULT, NO BACKFILL, NO NOT NULL
--
-- Every existing row means "nobody has asked", which is true. A default of 0
-- would say every bill on file is paid.
--
-- The realm change clears both, in the SAME statement that already clears
-- `external_ref` and `synced_at` — a balance from another company file is
-- worse than no balance, and putting it in that statement is what stops the
-- next person forgetting it (083's lesson, where the clear was left pointing at
-- a table nothing read any more).
--
-- Depends on 025. NOT rerunnable — `add column` fails the second time.
-- ============================================================================

alter table vendor_invoices add column qbo_balance    numeric(14,2);
alter table vendor_invoices add column qbo_checked_at timestamptz;

comment on column vendor_invoices.qbo_balance is
  'What QuickBooks last said is still owed on this bill. A CACHE of their fact, '
  'never ours — this app records no vendor payment. NULL with qbo_checked_at '
  'set means QuickBooks no longer has the document; NULL with it also null '
  'means nobody has asked. Never render it without qbo_checked_at. See 088.';

comment on column vendor_invoices.qbo_checked_at is
  'When qbo_balance was true. Not bookkeeping beside the balance — the thing '
  'that makes storing it honest, since a payment can land a minute later. See 088.';

-- Only the pushed ones are ever asked about, and only the unsettled ones are
-- worth asking about twice; both are the same narrow slice of the table.
create index if not exists vendor_invoices_qbo_unsettled_idx
  on vendor_invoices (org_id, qbo_checked_at)
  where qbo_balance is not null and qbo_balance > 0;

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from information_schema.columns
--    where table_name = 'vendor_invoices'
--      and column_name in ('qbo_balance','qbo_checked_at');            → 2
--
--   select count(*) from vendor_invoices where qbo_checked_at is not null;
--                                                                     → 0
--     (nothing is backfilled; every row correctly means "nobody has asked")
--
--   select count(*) from pg_policy
--    where polrelid = 'public.vendor_invoices'::regclass;   → unchanged (025's)
--     No new policy: 025's update policy is purchaser+ with no column list, and
--     whoever may push a bill may cache what QuickBooks says about it.
-- ============================================================================
