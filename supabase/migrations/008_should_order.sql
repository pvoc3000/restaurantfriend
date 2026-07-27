-- ============================================================================
-- restaurantfriend — migration 008 · guide membership vs "should order"
--
-- Implements docs/order-days-refactor.md (model settled with Mark 2026-07-22,
-- amended 2026-07-23). Two separate questions the schema now answers cleanly:
--
--   1. MEMBERSHIP — does this line appear on the guide at all?
--      Active vendor item AND active inventory item AND active vendor
--      (AND active item-location). Nothing else.
--   2. SHOULD ORDER — is this a line to touch today? Membership AND the day is
--      in the vendor's order days AND the item's order days AND that vendor
--      item's favorite days.
--
-- Three parts, one script (the SQL editor runs it as a single transaction):
--   a. inventory_item_locations.order_days — item order days become STORED,
--      backfilled from the distinct weekdays each item-location currently has
--      plan rows for (faithful to the present data).
--   b. Kill the null-means-default indirection on order_guide_plan_days:
--      materialize NULL vendor_item_id rows to the item-location's default,
--      then NOT NULL + on delete cascade. A plan row now means exactly "this
--      vendor item is a favorite on this weekday" (plus par overrides).
--   c. Recreate v_order_guide at the new grain: item-location × vendor item ×
--      weekday. Membership is the active cascade; plan rows only decorate.
--
-- Run in the Supabase SQL editor. NOT rerunnable (the add column fails on a
-- second run — that means it already ran). Verification queries at the bottom.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- a. Item order days, stored per item-location (mirrors vendor_locations)
-- ----------------------------------------------------------------------------

alter table inventory_item_locations
  add column order_days smallint[] not null default '{}';

-- Backfill from the plan rows as they stand — including NULL-vendor-item rows,
-- because today those DO put the day on (OrderDaysPicker inserts them).
-- Empty stays empty: '{}' is meaningful ("not in focus any day"), never
-- auto-filled (Mark, 2026-07-22).
update inventory_item_locations il
   set order_days = sub.days
  from (
    select item_location_id,
           array_agg(distinct weekday order by weekday) as days
      from order_guide_plan_days
     group by item_location_id
  ) sub
 where sub.item_location_id = il.id;

-- ----------------------------------------------------------------------------
-- b. Materialize the NULL-vendor-item plan rows, then forbid them
-- ----------------------------------------------------------------------------

do $$
declare
  n_null   int;
  n_dup    int;
  n_orphan int;
  n_mat    int;
begin
  select count(*) into n_null
    from order_guide_plan_days
   where vendor_item_id is null;

  -- Where an explicit row for (item-location, weekday, default vendor item)
  -- already exists, keep the explicit row — its par override is deliberate —
  -- and drop the NULL twin. Must happen before the UPDATE, which would
  -- otherwise collide with the unique (item_location_id, weekday,
  -- vendor_item_id) key.
  delete from order_guide_plan_days pd
   using inventory_item_locations il
   where pd.vendor_item_id is null
     and il.id = pd.item_location_id
     and il.default_vendor_item_id is not null
     and exists (
       select 1 from order_guide_plan_days x
        where x.item_location_id = pd.item_location_id
          and x.weekday = pd.weekday
          and x.vendor_item_id = il.default_vendor_item_id
     );
  get diagnostics n_dup = row_count;

  -- A NULL row with no default to resolve to favorites nothing; delete it.
  delete from order_guide_plan_days pd
   using inventory_item_locations il
   where pd.vendor_item_id is null
     and il.id = pd.item_location_id
     and il.default_vendor_item_id is null;
  get diagnostics n_orphan = row_count;

  update order_guide_plan_days pd
     set vendor_item_id = il.default_vendor_item_id
    from inventory_item_locations il
   where pd.vendor_item_id is null
     and il.id = pd.item_location_id;
  get diagnostics n_mat = row_count;

  raise notice 'NULL plan rows: % total -> % materialized, % deleted (explicit twin), % deleted (no default)',
    n_null, n_mat, n_dup, n_orphan;

  -- The three buckets must account for every NULL row, or something above
  -- missed a case — abort the whole transaction rather than guess.
  if n_mat + n_dup + n_orphan <> n_null then
    raise exception 'NULL-row accounting mismatch: %+%+% <> %', n_mat, n_dup, n_orphan, n_null;
  end if;
end $$;

alter table order_guide_plan_days
  alter column vendor_item_id set not null;

-- on delete set null would now violate NOT NULL; a deleted vendor item's
-- favorites should die with it (its par overrides describe that source).
alter table order_guide_plan_days
  drop constraint order_guide_plan_days_vendor_item_id_fkey,
  add constraint order_guide_plan_days_vendor_item_id_fkey
    foreign key (vendor_item_id) references vendor_items(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- c. v_order_guide at the new grain: item-location × vendor item × weekday
--
-- Drop + recreate — the column set changes, so create-or-replace won't do.
-- The weekday dimension STAYS even though membership is day-independent:
-- per-line par overrides live on plan rows per weekday, so a day-less view
-- couldn't surface the right day's par in one column. The page keeps its
-- .eq("weekday", …) query shape.
--
-- security_invoker (like v_item_last_ordered, 004): the underlying tables'
-- org-scoped RLS applies to the caller. 001's view predated the convention and
-- ran as owner.
-- ----------------------------------------------------------------------------

drop view v_order_guide;

create view v_order_guide
with (security_invoker = true) as
select
  il.org_id,
  il.location_id,
  d.weekday,
  ii.id                                   as inventory_item_id,
  ii.name                                 as item_name,
  ii.category,
  ii.base_unit,
  ss.display_name                         as shop_section,
  ss.sort_order                           as shop_section_sort,
  il.id                                   as item_location_id,
  coalesce(pd.par_qty, il.default_par)    as par_qty,
  pd.par_mode,
  vi.id                                   as vendor_item_id,
  v.id                                    as vendor_id,
  v.name                                  as vendor_name,
  v.order_type                            as vendor_order_type,
  vi.brand,
  vi.description                          as vendor_item_description,
  vi.product_id,
  vi.package_desc,
  vi.package_content,
  coalesce(vilp.price, vi.price)          as effective_price,
  case when vi.package_content > 0
       then round(coalesce(vilp.price, vi.price) / vi.package_content, 4)
  end                                     as unit_price,   -- $ per base unit
  vl.minimum_order                        as vendor_minimum,
  vl.delivery_days                        as vendor_delivery_days,
  -- membership, composed — and explainable (§4.7a)
  (v.is_active and vi.is_active and ii.is_active and il.is_active) as is_orderable,
  case
    when not v.is_active  then 'vendor inactive'
    when not vi.is_active then 'vendor item inactive'
    when not ii.is_active then 'item inactive'
    when not il.is_active then 'item inactive at location'
  end                                     as hidden_reason,
  -- a plan row exists for this line on this weekday
  (pd.id is not null)                     as is_favorite,
  -- the three raw day arrays: what makes "why isn't this green" free on the
  -- client — compare the walked day against each, no text columns needed
  coalesce(vl.order_days, '{}')           as vendor_order_days,
  il.order_days                           as item_order_days,
  coalesce(fav.days, '{}')                as favorite_days,
  -- the four-way AND (membership + the three day conditions)
  (v.is_active and vi.is_active and ii.is_active and il.is_active
     and coalesce(d.weekday = any(vl.order_days), false)
     and d.weekday = any(il.order_days)
     and coalesce(d.weekday = any(fav.days), false)) as should_order
from inventory_item_locations il
join inventory_items ii on ii.id = il.inventory_item_id
join vendor_items    vi on vi.inventory_item_id = ii.id
join vendors         v  on v.id = vi.vendor_id
cross join generate_series(1, 7) as d(weekday)
left join shop_sections ss on ss.id = il.shop_section_id
left join order_guide_plan_days pd
       on pd.item_location_id = il.id
      and pd.weekday          = d.weekday
      and pd.vendor_item_id   = vi.id
left join (
    select item_location_id,
           vendor_item_id,
           array_agg(weekday order by weekday) as days
      from order_guide_plan_days
     group by item_location_id, vendor_item_id
  ) fav
       on fav.item_location_id = il.id
      and fav.vendor_item_id   = vi.id
left join vendor_locations vl
       on vl.vendor_id = v.id and vl.location_id = il.location_id
left join vendor_item_location_prices vilp
       on vilp.vendor_item_id = vi.id and vilp.location_id = il.location_id;

grant select on v_order_guide to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Verification (docs/order-days-refactor.md §Verification) — run after, all
-- read-only.
-- ----------------------------------------------------------------------------

-- 1. No plan row has a NULL vendor_item_id (must be 0):
-- select count(*) from order_guide_plan_days where vendor_item_id is null;

-- 2. Membership per weekday at DF01 — same for every weekday; measured
--    2026-07-23 this should land at 883 lines:
-- select weekday, count(*) filter (where is_orderable) as membership
--   from v_order_guide vg
--   join locations l on l.id = vg.location_id
--  where l.code = 'DF01'
--  group by weekday order by weekday;

-- 3. Should-order per weekday at DF01. NOTE: the brief's 2026-07-22 figures
--    (Mon 229 / Wed 118) could not be reproduced from any data source during
--    pre-flight on 2026-07-23; simulating this exact view against the live
--    data gives Mon 394 / Wed 222. The Wed 222 DOES match the earlier draft's
--    same-day measurement of "orderable lines whose vendor takes Wednesday
--    orders", so the vendor-day gate is behaving as measured — eyeball the
--    per-vendor breakdown (query 4) against the real ~11 Monday POs instead
--    of chasing the brief's totals.
-- select weekday, count(*) filter (where should_order) as should_order
--   from v_order_guide vg
--   join locations l on l.id = vg.location_id
--  where l.code = 'DF01'
--  group by weekday order by weekday;

-- 4. Monday should-order lines by vendor at DF01 (the eyeball-vs-real-POs check):
-- select vendor_name, count(*)
--   from v_order_guide vg
--   join locations l on l.id = vg.location_id
--  where l.code = 'DF01' and weekday = 1 and should_order
--  group by vendor_name order by count(*) desc;

-- 5. An item-location with order_days = '{}' is reachable but never green:
-- select count(*) filter (where is_orderable)   as reachable,
--        count(*) filter (where should_order)   as green   -- must be 0
--   from v_order_guide vg
--   join inventory_item_locations il on il.id = vg.item_location_id
--  where il.order_days = '{}';
