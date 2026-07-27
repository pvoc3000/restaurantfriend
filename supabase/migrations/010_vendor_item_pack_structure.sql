-- ============================================================================
-- restaurantfriend — migration 010 · restore the vendor item's pack structure
--
-- Why (Mark, 2026-07-23): FileMaker recorded a pack as THREE facts —
-- `UnitAmount` × `UnitSize` `UnitMeasure`, e.g. CS 12 × 32oz. The migration
-- multiplied them into one number in the item's base unit
-- (12 × 32oz = 384oz = 24 lbs) and kept only that, so the guide reads
-- "1 × 24 lbs". Arithmetically the same, operationally useless: 12 × 32oz tells
-- you there are twelve 32oz containers in the case, and 24 lbs tells you
-- nothing you can count on a shelf or check against a packing slip. Worse, the
-- "1 ×" was a hardcoded literal in the UI — it always said 1.
--
-- Measured over the raw export before writing this:
--   2,887 of 2,888 live vendor items match a VendorItems.mer row by legacy_id
--   2,639 have pack structure to restore
--     699 are genuine multi-packs (UnitAmount > 1) — the ones that lost most
--   e.g. "MULTI-FOLD TOWEL" reads 1 × 4000 ea today; it is really 16 × 250ea
--
-- `package_content` is NOT touched: it stays the authoritative base-unit total
-- that count mode divides by (`ceil((par − on_hand) / package_content)`). These
-- three columns are the human-readable provenance beside it, so there is no
-- conversion and no arithmetic risk in this migration.
--
-- The COLUMNS are added here; the VALUES come from the raw .mer, which lives
-- outside the database — run `migration/backfill-pack.mjs` afterwards (it is
-- idempotent and reports before writing).
--
-- Run in the Supabase SQL editor. NOT rerunnable (add column fails a second
-- time — that means it already ran).
-- ============================================================================

alter table vendor_items
  add column pack_count integer,
  add column pack_size  numeric(10,3),
  add column pack_unit  text;

comment on column vendor_items.pack_count is
  'FMP UnitAmount — how many inner units per purchase package (12 in "12 x 32oz").';
comment on column vendor_items.pack_size is
  'FMP UnitSize — size of ONE inner unit (32 in "12 x 32oz").';
comment on column vendor_items.pack_unit is
  'FMP UnitMeasure — unit of the inner size ("oz"). Free text: the export also '
  'carries box / dz / ct / flat / pair / ft on a handful of rows. Display only; '
  'package_content remains the base-unit total used for ordering math.';

-- A pack count with nothing to count is meaningless; allow all-null (249 rows
-- never had the structure) or a usable size.
alter table vendor_items
  add constraint vendor_items_pack_shape
    check (pack_count is null or pack_size is not null);

-- ----------------------------------------------------------------------------
-- v_order_guide: carry the three fields through so the walk can print the pack
-- the way the printed guide did. Everything else is byte-identical to 009.
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

-- ----------------------------------------------------------------------------
-- Verification — run AFTER migration/backfill-pack.mjs
-- ----------------------------------------------------------------------------

-- 1. Coverage (expect ~2,639 with structure, ~699 multi-packs):
-- select count(*) filter (where pack_count is not null) as with_structure,
--        count(*) filter (where pack_count > 1)         as multipacks
--   from vendor_items;

-- 2. Mark's example — should read CS 12 × 32 oz, package_content still 24:
-- select description, package_desc, pack_count, pack_size, pack_unit, package_content
--   from vendor_items where description = 'Original Almond Barista Blend';

-- 3. package_content untouched by the backfill (compare against your own
--    expectation; the script never writes this column):
-- select count(*) from vendor_items where package_content is not null;
