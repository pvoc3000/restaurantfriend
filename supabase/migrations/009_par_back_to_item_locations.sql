-- ============================================================================
-- restaurantfriend — migration 009 · per-weekday par returns to the item-location
--
-- Why (Mark, 2026-07-23): par belongs to the inventory item at a location, not
-- to the order guide. FMP stored it that way — InventoryLoc.Par__array, a
-- 7-repetition field (slot n = weekday n), with isFixed_array alongside it.
--
-- How it drifted:
--   * 001 normalized that array. `inventory_item_locations.default_par` took
--     slot 1; slots 2..7 became `item_order_days.par_qty`, because that table
--     was the only one carrying a weekday. Faithful at the time: the key was
--     unique (item_location_id, weekday), so one par per item per day.
--   * 003 added vendor_item_id to that key for multi-favourites, and par_qty
--     silently became a PER-VENDOR-ITEM par — a distinction FMP never had and
--     the data never used (measured below: zero cells disagree).
--   * 008 made the plan row mean only "favourite", so the par then hung off a
--     row that gets toggled on and off. Un-favouriting destroyed the par, and
--     no trigger logged it (the par trigger was AFTER UPDATE only).
--
-- This puts par back where it started and reduces the plan row to a pure
-- favourite record with no payload — so deleting one on un-favourite is
-- harmless, which is the real fix rather than a flag guarding the delete.
--
-- Measured on live data before writing this:
--   58 (item-location, weekday) cells carry a par; 0 have vendor items
--   disagreeing, so the backfill is unambiguous. 8 rows carry par_mode='fixed'
--   (7 of them Bananas, Fresh with no par); 2 cells disagree on mode, resolved
--   as "any fixed wins" so nothing is silently dropped.
--
-- The VIEW'S OUTPUT IS UNCHANGED — still `par_qty` and `par_mode`, only the
-- source moves — so no application code has to change for par to keep working.
--
-- Run in the Supabase SQL editor. NOT rerunnable (add column fails a second
-- time — that means it already ran). Verification queries at the bottom.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The columns, mirroring FMP's two repeating fields
--    Nullable rather than defaulted: indexing a NULL array yields NULL, which
--    the view's coalesce already handles, so ~1,800 rows stay untouched.
-- ----------------------------------------------------------------------------

alter table inventory_item_locations
  add column par_by_weekday       numeric(10,2)[],
  add column par_fixed_by_weekday boolean[];

alter table inventory_item_locations
  add constraint inventory_item_locations_par_by_weekday_len
    check (par_by_weekday is null or array_length(par_by_weekday, 1) = 7),
  add constraint inventory_item_locations_par_fixed_by_weekday_len
    check (par_fixed_by_weekday is null or array_length(par_fixed_by_weekday, 1) = 7);

comment on column inventory_item_locations.par_by_weekday is
  'Per-weekday par override, slot n = ISO weekday n. NULL slot falls back to default_par.';
comment on column inventory_item_locations.par_fixed_by_weekday is
  'Per-weekday "order a fixed amount" flag (FMP isFixed_array). NULL slot = false.';

-- ----------------------------------------------------------------------------
-- 2. Backfill from the plan rows, then prove nothing was lost
-- ----------------------------------------------------------------------------

do $$
declare
  n_cells   int;
  n_conflict int;
  n_updated int;
  n_pars_before int;
  n_pars_after  int;
begin
  select count(*) into n_pars_before
    from order_guide_plan_days where par_qty is not null;

  -- A cell is (item-location, weekday). Vendor items within a cell must agree
  -- on the par; abort rather than silently pick one if that ever stops holding.
  select count(*) into n_conflict
    from (
      select item_location_id, weekday
        from order_guide_plan_days
       where par_qty is not null
       group by item_location_id, weekday
      having count(distinct par_qty) > 1
    ) x;

  if n_conflict > 0 then
    raise exception 'aborting: % (item-location, weekday) cells have vendor items disagreeing on par_qty', n_conflict;
  end if;

  with per_cell as (
    select item_location_id,
           weekday,
           max(par_qty)                     as par_qty,
           bool_or(par_mode = 'fixed')      as fixed
      from order_guide_plan_days
     group by item_location_id, weekday
    having max(par_qty) is not null or bool_or(par_mode = 'fixed')
  ),
  packed as (
    select c.item_location_id,
           array_agg(pc.par_qty                 order by d.weekday) as pars,
           array_agg(coalesce(pc.fixed, false)  order by d.weekday) as fixeds
      from (select distinct item_location_id from per_cell) c
      cross join generate_series(1, 7) as d(weekday)
      left join per_cell pc
             on pc.item_location_id = c.item_location_id
            and pc.weekday = d.weekday
     group by c.item_location_id
  )
  update inventory_item_locations il
     set par_by_weekday       = packed.pars,
         par_fixed_by_weekday = packed.fixeds
    from packed
   where packed.item_location_id = il.id;

  get diagnostics n_updated = row_count;

  select count(*) into n_cells
    from (
      select item_location_id, weekday
        from order_guide_plan_days
       where par_qty is not null
       group by item_location_id, weekday
    ) x;

  -- Every par that existed must now be readable from the array.
  select count(*) into n_pars_after
    from inventory_item_locations il, generate_series(1, 7) d(weekday)
   where il.par_by_weekday[d.weekday] is not null;

  -- rows > cells is expected and is the point: 003 duplicated one par across
  -- every vendor item of the same item-day, and those collapse back to one.
  raise notice 'par rows in: % → distinct cells: % · item-locations updated: %',
    n_pars_before, n_cells, n_updated;

  if n_pars_after <> n_cells then
    raise exception 'par count mismatch: % cells in, % readable out', n_cells, n_pars_after;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. The plan row becomes a pure favourite record
--    Its par trigger goes with the columns; per-weekday par changes are logged
--    by the item-location trigger below instead — which also closes a real gap,
--    since the old trigger was AFTER UPDATE only and never saw a DELETE.
-- ----------------------------------------------------------------------------

drop trigger if exists trg_order_guide_plan_days_par on order_guide_plan_days;
drop function if exists public.log_par_override_change();

-- The 008 view selects pd.par_qty / pd.par_mode, so it has to go before the
-- columns can. It is recreated in section 5 against the new source.
drop view v_order_guide;

alter table order_guide_plan_days
  drop column par_qty,
  drop column par_mode;

-- ----------------------------------------------------------------------------
-- 4. Par history now covers the default AND every weekday slot
-- ----------------------------------------------------------------------------

create or replace function public.log_par_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d int;
begin
  if new.default_par is distinct from old.default_par then
    insert into par_history (org_id, item_location_id, weekday, old_par, new_par, changed_by)
    values (new.org_id, new.id, null, old.default_par, new.default_par, auth.uid());
  end if;

  -- weekday slots: null weekday means the default par, 1..7 the overrides
  for d in 1..7 loop
    if new.par_by_weekday[d] is distinct from old.par_by_weekday[d] then
      insert into par_history (org_id, item_location_id, weekday, old_par, new_par, changed_by)
      values (new.org_id, new.id, d, old.par_by_weekday[d], new.par_by_weekday[d], auth.uid());
    end if;
  end loop;

  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 5. v_order_guide — same output columns, par now sourced from the item-location
--    (dropped in section 3, because the old definition read the columns we
--    removed there)
-- ----------------------------------------------------------------------------

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
-- Verification (all read-only) — run after
-- ----------------------------------------------------------------------------

-- 1. Plan rows carry no par payload any more (both must error / be absent):
-- select column_name from information_schema.columns
--  where table_name = 'order_guide_plan_days' order by 1;

-- 2. The 58 per-weekday pars survived the move (expect 58):
-- select count(*) from inventory_item_locations il, generate_series(1,7) d(weekday)
--  where il.par_by_weekday[d.weekday] is not null;

-- 3. Spot-check the weekend ramp that motivated keeping per-weekday pars —
--    DF02 "Flour, Mix, Raised, Vegan" should read 1500/1450/1350/1250/1100
--    on Wed..Sun:
-- select l.code, ii.name, d.weekday, coalesce(il.par_by_weekday[d.weekday], il.default_par) as par
--   from inventory_item_locations il
--   join inventory_items ii on ii.id = il.inventory_item_id
--   join locations l on l.id = il.location_id
--   cross join generate_series(1,7) d(weekday)
--  where ii.name = 'Flour, Mix, Raised, Vegan' and l.code = 'DF02'
--  order by d.weekday;

-- 4. The guide resolves the same par for every vendor item of an item on a day
--    (it is now an item-level fact) — expect 0 rows:
-- select item_location_id, weekday, count(distinct par_qty)
--   from v_order_guide group by item_location_id, weekday
--  having count(distinct par_qty) > 1;

-- 5. Editing a weekday par now writes par_history (previously a delete logged
--    nothing). After changing one in the UI:
-- select weekday, old_par, new_par, changed_at from par_history
--  order by changed_at desc limit 5;
