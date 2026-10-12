-- ============================================================================
-- 195 — DROP v_last_orders: AN UNUSED VIEW THAT ANYONE COULD READ SIGNED OUT
--
-- Found 2026-10-12 from Supabase's "Security Definer View" lint.
--
-- 001 created the view without `security_invoker = true`, so it ran as its
-- owner and skipped the row-level security on purchase_orders and
-- purchase_order_items. Supabase's default privileges had also granted it to
-- `anon`. Measured before this migration: a request carrying only the anon
-- key (which ships in the browser bundle) read all 3,158 rows — last order
-- date, quantities and unit price for every vendor item at every shop.
--
-- Nothing reads it. The vendor item screen reads the purchase order tables
-- directly, and no other view depends on it (checked in pg_depend).
--
-- A view holds no data, so nothing is lost. Its definition, should it ever be
-- wanted again — and then WITH (security_invoker = true) and no anon grant:
--
--   select distinct on (poi.vendor_item_id, po.location_id)
--     po.org_id, poi.vendor_item_id, po.location_id,
--     po.order_date    as last_order_date,
--     poi.qty_ordered  as last_qty_ordered,
--     poi.qty_received as last_qty_received,
--     poi.unit_price   as last_unit_price
--   from purchase_order_items poi
--   join purchase_orders po on po.id = poi.po_id
--   where po.status <> 'void'
--   order by poi.vendor_item_id, po.location_id, po.order_date desc;
--
-- RERUNNABLE.
-- ============================================================================

begin;

drop view if exists public.v_last_orders;

commit;
