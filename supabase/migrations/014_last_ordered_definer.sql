-- ============================================================================
-- restaurantfriend — migration 014 · make v_item_last_ordered affordable
--
-- WHY (measured 2026-07-26, DF01, hosted DB)
--
--   the same query, service_role (no RLS) ......  160-250 ms
--   the same query, in the app (RLS applied) ... 4,336 ms
--
-- /items spends ~4.3s of its ~5.1s in this ONE view; the item list query
-- beside it costs 280ms. /cleanup and the vendor detail pay it too.
--
-- 004 created the view `with (security_invoker = true)` so the underlying
-- tables' org policies would apply. That is the safe default and the right
-- instinct, but it means the read policy on all four tables is evaluated
-- INSIDE an aggregate over 104,669 purchase_order_items rows, and the quals
-- block the plan the planner would otherwise pick. The cost is ~20x.
--
-- THE FIX, and why it is not a loosening
--
-- Run the view as its owner and re-check, ONCE at the top, exactly what RLS
-- would have checked. Read access on every table this view touches
-- (inventory_item_locations, vendor_items, purchase_order_items,
-- purchase_orders) is the same generic policy from 001:
--
--     using (org_id in (select user_org_ids()))
--
-- purely org-scoped — no location or role dimension. So `il.org_id in (select
-- user_org_ids())` reproduces the same visibility, and `po.org_id = il.org_id`
-- keeps a cross-org row from ever being reachable through the join. This is
-- the pattern CLAUDE.md already sets for security definer functions: it
-- bypasses RLS, so its body must re-check what RLS would have.
--
-- anon is not granted select, and would see nothing regardless: user_org_ids()
-- is empty without an auth.uid(), so the guard yields zero rows.
--
-- Verified before writing this: 1,237 inventory_item_locations and every
-- purchase_order row belong to the one org, and the view returns 452 rows at
-- DF01 — that count must not change after applying.
-- ============================================================================

create or replace view v_item_last_ordered as
select
  il.id              as item_location_id,
  il.location_id,
  max(po.order_date) as last_order_date
from inventory_item_locations il
join vendor_items vi          on vi.inventory_item_id = il.inventory_item_id
join purchase_order_items poi on poi.vendor_item_id = vi.id
join purchase_orders po       on po.id = poi.po_id
                             and po.location_id = il.location_id
where po.status <> 'void'
  -- Stands in for the RLS that security_invoker used to apply per underlying
  -- table. Do not remove without putting security_invoker back.
  and il.org_id in (select user_org_ids())
  and po.org_id = il.org_id
group by il.id, il.location_id;

-- The point of the migration: stop evaluating four tables' policies inside the
-- aggregate. Must come after the body above, so a partial run can't leave the
-- view unguarded.
alter view v_item_last_ordered set (security_invoker = false);

grant select on v_item_last_ordered to authenticated;
revoke all on v_item_last_ordered from anon;

-- Verify after applying (expect 452 at DF01, and fast):
--   select count(*) from v_item_last_ordered
--   where location_id = (select id from locations where code = 'DF01');
