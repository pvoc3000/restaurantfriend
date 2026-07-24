-- ============================================================================
-- restaurantfriend — migration 012 · retire inventory_item_locations.default_vendor_item_id
--
-- Why (Mark, 2026-07-23): "it's no longer needed."
--
-- In 001 the default was load-bearing: a plan row with a null vendor_item_id
-- meant "inherit the item-location's default", and v_order_guide resolved a
-- line through `coalesce(plan.vendor_item_id, il.default_vendor_item_id)`.
-- Migration 008 materialised those null rows and made vendor_item_id NOT NULL,
-- which left the column with no reader at all — the guide has not consulted it
-- since.
--
-- What remained was a closed loop: the only writer was the cleanup queue's
-- "assign default vendor item" fix editor, and the only readers were the
-- cleanup checks complaining that it was unset or pointed at a retired vendor.
-- Measured over 665 active item-locations at DF01+DF02, `no_default` flagged
-- 146 rows of which 130 (89%) already had a healthy favorite and ordered fine;
-- `default_inactive` flagged 193 of which 124 (64%) did. Both checks and that
-- editor are gone as of this migration; the remaining checks ask about
-- favorites, which is what the guide actually emits.
--
-- Nothing else references the column: v_order_guide has not mentioned it since
-- 008, and v_item_last_ordered never did. So no view needs recreating here —
-- dropping the column takes its foreign key with it.
--
-- APPLY THE APP CHANGES FIRST (they are in the same commit): the item detail
-- and Inventory list selected this column, and a stale deploy would 400 on
-- every query the moment it disappears.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- Guard: refuse to run if some view still depends on the column, rather than
-- discovering it when a screen goes blank.
do $$
declare
  dependents text;
begin
  select string_agg(distinct c.relname, ', ')
    into dependents
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class   c on c.oid = r.ev_class
    join pg_attribute a
      on a.attrelid = d.refobjid
     and a.attnum   = d.refobjsubid
   where d.refobjid = 'inventory_item_locations'::regclass
     and a.attname  = 'default_vendor_item_id'
     and c.relkind  = 'v';

  if dependents is not null then
    raise exception 'still referenced by view(s): % — update them first', dependents;
  end if;
end $$;

alter table inventory_item_locations
  drop column default_vendor_item_id;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Verify (read-only, run after)
-- ----------------------------------------------------------------------------

-- 1. The column is gone (expect it absent from the list):
-- select column_name from information_schema.columns
--  where table_name = 'inventory_item_locations' order by ordinal_position;

-- 2. The guide is unaffected — membership per weekday at DF01 should be
--    unchanged from before this migration:
-- select weekday, count(*) filter (where is_orderable) as membership,
--        count(*) filter (where should_order)          as should_order
--   from v_order_guide vg join locations l on l.id = vg.location_id
--  where l.code = 'DF01' group by weekday order by weekday;
