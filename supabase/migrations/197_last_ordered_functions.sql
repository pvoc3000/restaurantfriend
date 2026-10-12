-- ============================================================================
-- 197 — "LAST ORDERED" AND "LAST PURCHASE" AS FUNCTIONS, NOT OWNER-RUN VIEWS
--
-- Mark, 2026-10-12, after Supabase's "Security Definer View" lint: "do option
-- 2" — the same rows, the same speed, without a view that skips RLS.
--
--   item_last_ordered(p_location)    what v_item_last_ordered (004, 014) gave
--   item_last_purchase(p_location)   what v_item_last_purchase (048) gave
--
-- WHY THEY WERE OWNER-RUN, WHICH STILL HOLDS: 014 measured the read at
-- 160-250 ms without RLS and 4,336 ms with it, because four tables' policies
-- were evaluated inside the aggregate. A definer FUNCTION keeps that, and is
-- the form CLAUDE.md already sets for anything that bypasses RLS: the body
-- re-checks what RLS would have.
--
-- THE LOCATION IS AN ARGUMENT, NOT A FILTER ON THE RESULT. A definer function
-- is never inlined, so `.eq("location_id", …)` on its rows would work out
-- every shop's answer and then throw most of it away.
--
-- THE GUARD IS 014's, PLUS TWO LINES. `il.org_id in (select user_org_ids())`
-- and `po.org_id = il.org_id` are unchanged; `vi.org_id` and `v.org_id` are
-- now checked as well, because the views trusted that a vendor item points at
-- an inventory item of its own org and no constraint says so. With one org it
-- changes no row: dry-run on the live DB as a signed-in owner, both
-- functions return the views' 1,096 rows.
--
-- ONE DELIBERATE DIFFERENCE. 048 ordered by date then `po.id`, which does not
-- decide between two vendor items of one inventory item on the SAME order —
-- 18 item-locations today, where the view's ★ could land on either from one
-- load to the next. `poi.id` is added as the last tiebreak so it cannot.
--
-- Under service_role these return NOTHING, as the views did: user_org_ids()
-- is empty without an auth.uid(). Verify from a signed-in session.
--
-- One row per item-location with a non-void purchase at that shop — a few
-- hundred, so PostgREST's 1,000-row cap is not in reach; it would be the day
-- one shop stocks more than 1,000 items.
--
-- The views stay until the app that calls these is deployed; 198 drops them.
-- RERUNNABLE.
-- ============================================================================

begin;

create or replace function item_last_ordered(p_location uuid)
returns table (
  item_location_id uuid,
  location_id      uuid,
  last_order_date  date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    il.id,
    il.location_id,
    max(po.order_date)
  from inventory_item_locations il
  join vendor_items vi          on vi.inventory_item_id = il.inventory_item_id
                               and vi.org_id = il.org_id
  join purchase_order_items poi on poi.vendor_item_id = vi.id
  join purchase_orders po       on po.id = poi.po_id
                               and po.location_id = il.location_id
  where il.location_id = p_location
    and po.status <> 'void'
    -- Stands in for the tables' read policies. Do not remove.
    and il.org_id in (select user_org_ids())
    and po.org_id = il.org_id
  group by il.id, il.location_id;
$$;

create or replace function item_last_purchase(p_location uuid)
returns table (
  item_location_id        uuid,
  location_id             uuid,
  last_order_date         date,
  last_po_id              uuid,
  vendor_item_id          uuid,
  vendor_name             text,
  vendor_item_description text,
  brand                   text,
  package_desc            text,
  package_content         numeric,
  pack_count              numeric,
  pack_size               numeric,
  pack_unit               text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (il.id)
    il.id,
    il.location_id,
    po.order_date,
    po.id,
    vi.id,
    v.name,
    vi.description,
    vi.brand,
    vi.package_desc,
    vi.package_content,
    vi.pack_count,
    vi.pack_size,
    vi.pack_unit
  from inventory_item_locations il
  join vendor_items vi          on vi.inventory_item_id = il.inventory_item_id
                               and vi.org_id = il.org_id
  join vendors v                on v.id = vi.vendor_id
                               and v.org_id = il.org_id
  join purchase_order_items poi on poi.vendor_item_id = vi.id
  join purchase_orders po       on po.id = poi.po_id
                               and po.location_id = il.location_id
  where il.location_id = p_location
    and po.status <> 'void'
    -- Stands in for the tables' read policies. Do not remove.
    and il.org_id in (select user_org_ids())
    and po.org_id = il.org_id
  -- The ordering DEFINES "last purchase": newest order, `po.id` as the
  -- tiebreak so two orders on one date give the same answer every load, and
  -- `poi.id` so one order holding the item as two vendor items does too.
  order by il.id, po.order_date desc, po.id desc, poi.id desc;
$$;

-- Supabase's default privileges make a new function executable by anon, and
-- revoking from PUBLIC does not undo that: by name.
revoke all on function item_last_ordered(uuid)  from public, anon;
revoke all on function item_last_purchase(uuid) from public, anon;
grant execute on function item_last_ordered(uuid)  to authenticated;
grant execute on function item_last_purchase(uuid) to authenticated;

commit;
