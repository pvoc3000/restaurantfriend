-- ============================================================================
-- restaurantfriend — migration 004 · last-ordered triage view
--
-- The cleanup queue's biggest time-sink is Mark hand-fixing items he stopped
-- ordering years ago (brief §B). PO history is loaded (16.8k POs, 105k lines,
-- 2014→2026) — this view turns it into a single per-item-location "last
-- ordered" date so the queue can show a column + stale-age filter chips and
-- Mark can bulk-deactivate dead rows instead of fixing them.
--
-- Semantics (decided 2026-07-21): PER LOCATION. last_order_date is the most
-- recent NON-void PO for THIS item's vendor items AT THIS location. An item
-- ordered weekly at DF01 but never at DF03 reads as "never ordered" on its
-- DF03 row — which is the correct signal for deactivating that one row. (The
-- brief's prose said per-location; its sample counts were computed per-item-
-- anywhere, which we deliberately did not follow.)
--
-- One view, not N+1: the page joins the queue rows to this by item_location_id.
-- ============================================================================

create or replace view v_item_last_ordered
with (security_invoker = true) as
select
  il.id           as item_location_id,
  il.location_id,
  max(po.order_date) as last_order_date
from item_locations il
join vendor_items vi      on vi.inventory_item_id = il.inventory_item_id
join po_items poi         on poi.vendor_item_id = vi.id
join purchase_orders po   on po.id = poi.po_id
                         and po.location_id = il.location_id
where po.status <> 'void'
group by il.id, il.location_id;

-- PostgREST exposes it via the authenticated role; security_invoker means the
-- underlying tables' org-scoped RLS still applies (anon sees nothing).
grant select on v_item_last_ordered to authenticated;
