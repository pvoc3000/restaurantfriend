-- ============================================================================
-- restaurantfriend — migration 083 · QuickBooks settings per vendor sub-location
--
-- Why (Mark, 2026-09-01): "make sure that QBO settings are done at the location
-- level. We should be able to set the expense account, location, and class for
-- each vendor sub-location."
--
-- 082 put the expense account on the VENDOR, which was the right grain for the
-- question it answered — BakeMark's bills are baker items wherever they land —
-- and the wrong one for this. A bill also has to say WHICH SHOP it belongs to,
-- and in QuickBooks that is Location (Department) and Class tracking, both of
-- which are properties of where the goods went rather than of who sold them.
--
-- Settled with Mark the same day: ONE QuickBooks company for both shops, on the
-- Plus plan, with DF01 and DF02 separated inside it by Location and Class. So
-- the connection stays per-org (081 is untouched) and only the mapping moves.
--
-- ---------------------------------------------------------------------------
-- THE ACCOUNT NOW CASCADES THREE DEEP
--
--   vendor_locations.expense_account_ref   this vendor, at this shop
--     → vendors.expense_account_ref        this vendor, anywhere (082)
--       → accounting_connections.bill_expense_account_ref   the org (081)
--
-- Design rule 6's shape, the one the prices already use, with 082 keeping a
-- real job rather than being superseded: which ACCOUNT a purchase belongs to is
-- usually a fact about the vendor, and the shop is expressed by Location and
-- Class instead. The middle tier is what stops eighty vendors needing a row per
-- shop to say the same thing twice.
--
-- Location and Class are DELIBERATELY one tier and not three (Mark's choice
-- against the alternative of setting them once per shop): they are set here or
-- they are not sent at all.
--
-- ---------------------------------------------------------------------------
-- THE ROW MAY NOT EXIST, AND THAT IS THE TRAP THIS HAS TO SURVIVE
--
-- `vendor_locations` has NO INSERT anywhere in `web/src` — verified: reads and
-- inline updates only. So a vendor that has never been configured at a shop has
-- no row here at all, and the landlord and the plumber (`order_type: 'none'`)
-- are both the most likely to be missing one AND exactly the bills this
-- feature exists to send. The app must UPSERT on `(vendor_id, location_id)` —
-- which 001 already made unique — rather than update, or those vendors can
-- never be configured. There is nothing to do in the schema for that; it is
-- written here because the next reader will meet it.
--
-- ---------------------------------------------------------------------------
-- NAMES ARE SNAPSHOTS, refs are what gets sent
--
-- 013's rule and 082's, again: renaming a class or a location in QuickBooks
-- must not rewrite what this record says it posts to. The `_name` columns are
-- what the screen shows and what an audit reads; only the `_ref` travels.
--
-- No RLS change — `vendors_locations`' own policies already govern the row, and
-- a wrong class is a visible bookkeeping mistake on a screen rather than a
-- forged sync record. Depends on 001 (vendor_locations), 081 and 082.
-- NOT rerunnable: `add column` fails the second time, which is the signal.
-- ============================================================================

alter table vendor_locations add column expense_account_ref  text;
alter table vendor_locations add column expense_account_name text;
alter table vendor_locations add column qbo_location_ref     text;
alter table vendor_locations add column qbo_location_name    text;
alter table vendor_locations add column qbo_class_ref        text;
alter table vendor_locations add column qbo_class_name       text;

comment on column vendor_locations.expense_account_ref is
  'QuickBooks account this vendor''s bills at this shop post to. NULL falls '
  'back to vendors.expense_account_ref, then to the connection default (083).';
comment on column vendor_locations.qbo_location_ref is
  'QuickBooks Location (Department) id. Sent as DepartmentRef on the bill '
  'HEADER. NULL means the bill carries no location.';
comment on column vendor_locations.qbo_class_ref is
  'QuickBooks Class id. Sent as ClassRef on the expense LINE, not the header — '
  'a Bill takes its class per line. NULL means the bill carries no class.';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from vendor_locations
--    where expense_account_ref is not null
--       or qbo_location_ref is not null
--       or qbo_class_ref is not null;                                    → 0
--     (nothing is backfilled — every row falls through to the vendor and then
--      the org default until somebody sets one deliberately)
--
--   select count(*) from information_schema.columns
--    where table_name = 'vendor_locations'
--      and column_name like 'qbo\_%' escape '\';                         → 4
--
--   select count(*) from pg_constraint
--    where conrelid = 'public.vendor_locations'::regclass
--      and contype = 'u';                       → 1  (001's vendor_id+location_id,
--                                                     which the upsert needs)
-- ============================================================================
