-- ============================================================================
-- restaurantfriend — migration 011 · pack_count must be numeric, not integer
--
-- 010 typed `pack_count` as integer. FileMaker allows a fractional UnitAmount
-- and exactly one row uses it: "Strawbverry Dust", 0.5 × 1qt — half a quart,
-- which is a real thing to buy. The backfill hit it and stopped:
--
--     invalid input syntax for type integer: "0.5"
--
-- so 2,505 of ~2,628 rows were written and 123 were left behind. My error in
-- 010, not a data problem.
--
-- The view has to be dropped and recreated around the type change: Postgres
-- refuses to alter the type of a column a view depends on, and v_order_guide
-- selects pack_count since 010. The view's definition is otherwise unchanged.
--
-- Re-run `migration/backfill-pack.mjs --apply` afterwards; it is idempotent and
-- will write only the rows still outstanding.
--
-- Run in the Supabase SQL editor.
-- ============================================================================

drop view v_order_guide;

alter table vendor_items
  alter column pack_count type numeric(10,3);

comment on column vendor_items.pack_count is
  'FMP UnitAmount — how many inner units per purchase package (12 in "12 x 32oz"). '
  'Numeric, not integer: fractional packs exist (0.5 x 1qt).';

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
  -- par is a fact about the ITEM at this location on this weekday — never
  -- about which vendor you happen to prefer (migration 009)
  coalesce(il.par_by_weekday[d.weekday], il.default_par) as par_qty,
  case when coalesce(il.par_fixed_by_weekday[d.weekday], false)
       then 'fixed' else 'par' end        as par_mode,
  vi.id                                   as vendor_item_id,
  v.id                                    as vendor_id,
  v.name                                  as vendor_name,
  v.order_type                            as vendor_order_type,
  vi.brand,
  vi.description                          as vendor_item_description,
  vi.product_id,
  vi.package_desc,
  vi.package_content,
  vi.pack_count,
  vi.pack_size,
  vi.pack_unit,
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
  coalesce(vl.order_days, '{}')           as vendor_order_days,
  il.order_days                           as item_order_days,
  coalesce(fav.days, '{}')                as favorite_days,
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

-- Verify (expect numeric, and the 0.5 row writes cleanly on the next backfill):
-- select data_type, numeric_scale from information_schema.columns
--  where table_name = 'vendor_items' and column_name = 'pack_count';
-- select description, pack_count, pack_size, pack_unit
--   from vendor_items where description = 'Strawbverry Dust';
