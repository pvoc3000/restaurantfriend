-- ============================================================================
-- restaurantfriend — migration 048 · what an item was last bought AS
--
-- WHY
--
-- The order guide's item header names the item and nothing else, so a walk
-- can't answer the question you actually have in front of a shelf: when did we
-- last buy this, and which source did we buy it from? (Mark, 2026-08-10 — "the
-- last date and vendor item this inventory item was purchased… would be
-- helpful".)
--
-- 004's `v_item_last_ordered` already answers half of it and CANNOT answer the
-- other half: it is `max(po.order_date)` grouped by item-location, so the
-- aggregate discards the row the date came from. There is no way to recover
-- "which vendor item" from a max.
--
-- WHY A SECOND VIEW RATHER THAN WIDENING THE FIRST
--
-- `v_item_last_ordered` is read by /items, /cleanup and vendor detail, and its
-- shape — one row per item-location, one date column — is what `lib/lastOrdered`
-- buckets and what three screens sort on. Widening it to `distinct on` changes
-- the row it returns from an aggregate to a concrete purchase line, which is a
-- different contract for every existing caller and would put 014's measured
-- 20x win back in play on screens that don't need the extra columns.
--
-- So this is additive. The two overlap deliberately, and if the guide's version
-- proves as fast on every caller, folding /items onto it is a later, deliberate
-- change with its own measurement — not a side effect of this one.
--
-- SECURITY — 014's pattern exactly, and for 014's reason
--
-- `security_invoker = false` plus ONE top-level `user_org_ids()` guard, rather
-- than letting four tables' RLS be evaluated inside the join. Read access on
-- every table touched here is the same purely org-scoped policy from 001
-- (`using (org_id in (select user_org_ids()))`), so `il.org_id in (select
-- user_org_ids())` reproduces the same visibility, and `po.org_id = il.org_id`
-- keeps a cross-org row from being reachable through the join.
--
-- KNOWN FOOTGUN, inherited: a definer view carrying a `user_org_ids()` guard
-- reads EMPTY under service_role, because there is no auth.uid() to resolve.
-- A local audit script will conclude nothing was ever purchased and be wrong.
-- Verify this from a signed-in session, or query the base tables directly.
--
-- `poi.vendor_item_id` is `on delete set null` (001), so a purchase of a vendor
-- item that has since been deleted is invisible here — same as 014, and the
-- honest answer either way: we no longer know what it was bought as.
-- ============================================================================

create or replace view v_item_last_purchase as
select distinct on (il.id)
  il.id                as item_location_id,
  il.location_id,
  po.order_date        as last_order_date,
  po.id                as last_po_id,
  vi.id                as vendor_item_id,
  v.name               as vendor_name,
  -- Every slot `lib/catalog.vendorItemTitle` reads, so the guide can name the
  -- source the same way its own lines and the vendor-item record do rather
  -- than inventing a third wording for the same thing.
  vi.description       as vendor_item_description,
  vi.brand,
  vi.package_desc,
  vi.package_content,
  vi.pack_count,
  vi.pack_size,
  vi.pack_unit
from inventory_item_locations il
join vendor_items vi          on vi.inventory_item_id = il.inventory_item_id
join vendors v                on v.id = vi.vendor_id
join purchase_order_items poi on poi.vendor_item_id = vi.id
join purchase_orders po       on po.id = poi.po_id
                             and po.location_id = il.location_id
where po.status <> 'void'
  -- Stands in for the RLS that security_invoker would apply per underlying
  -- table. Do not remove without putting security_invoker back.
  and il.org_id in (select user_org_ids())
  and po.org_id = il.org_id
-- `distinct on (il.id)` keeps the FIRST row per item-location under this order,
-- so the ordering is the definition of "last purchase", not decoration.
-- `po.id` is the tiebreak because two orders can share a date and the answer
-- must not change between page loads.
order by il.id, po.order_date desc, po.id desc;

-- Must come after the body, so a partial run can't leave the view unguarded.
alter view v_item_last_purchase set (security_invoker = false);

grant select on v_item_last_purchase to authenticated;
revoke all on v_item_last_purchase from anon;

-- Verify after applying, FROM A SIGNED-IN SESSION (service_role sees zero —
-- see the footgun above). Expect the same 452 rows at DF01 that 014 returns,
-- since both views cover exactly the item-locations with a non-void purchase:
--
--   select count(*) from v_item_last_purchase
--   where location_id = (select id from locations where code = 'DF01');
--
-- and the two must agree on every date:
--
--   select count(*) from v_item_last_purchase p
--   join v_item_last_ordered o using (item_location_id)
--   where p.last_order_date <> o.last_order_date;   -- expect 0
