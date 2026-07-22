-- ============================================================================
-- restaurantfriend — migration 005 · descriptive table names
--
-- Why (decided 2026-07-22 with Mark): table names should say what a row is
-- and which tables they hang off, without opening them. Two rules going
-- forward, so future modules stay consistent:
--   * junction/config tables are named by their endpoints
--     (vendor_locations, inventory_item_locations)
--   * workflow tables are named by their business concept
--     (purchase_orders, order_guide_plan_days)
--
-- Renames (6):
--   item_locations   -> inventory_item_locations   (a row = inventory item @ location)
--   item_order_days  -> order_guide_plan_days      (the ordering plan feeding v_order_guide;
--                                                   one row = item-location × weekday × vendor item)
--   guide_entries    -> order_guide_entries        (what you typed walking the guide)
--   po_items         -> purchase_order_items       (consistent with parent purchase_orders)
--   po_attachments   -> purchase_order_attachments
--   reminders        -> purchase_reminders         (frees the generic name for future modules)
--
-- Deliberately KEPT:
--   * par_history, price_history — nothing else has pars/prices; short reads fine.
--   * column names (po_items.po_id -> purchase_order_items.po_id,
--     item_location_id, …) — renaming columns would ripple through the loader,
--     app selects, and view outputs for little gain. Tables only, this pass.
--
-- What Postgres handles for us on RENAME:
--   * All FKs, triggers, and RLS policies keep working (they bind by OID).
--   * Views (v_order_guide, v_last_orders, v_item_last_ordered) track the
--     rename automatically — their stored definitions now deparse with the
--     new names. No recreation needed.
-- What it does NOT rename (and this migration therefore does):
--   * constraint/index names (item_locations_pkey, item_order_days_plan_row_key, …)
--   * trigger names, policy names — cosmetic, but stale names in Studio and
--     error messages ("violates item_order_days_plan_row_key") would lie.
--
-- Run in the Supabase SQL editor. Idempotence: NOT rerunnable (second run
-- fails on "relation does not exist" — that's fine, it means it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables + their constraints/indexes, driven by one rename map
-- ----------------------------------------------------------------------------

do $$
declare
  m constant text[][] := array[
    ['item_locations',  'inventory_item_locations'],
    ['item_order_days', 'order_guide_plan_days'],
    ['guide_entries',   'order_guide_entries'],
    ['po_items',        'purchase_order_items'],
    ['po_attachments',  'purchase_order_attachments'],
    ['reminders',       'purchase_reminders']
  ];
  pair text[];
  r record;
begin
  -- tables first
  foreach pair slice 1 in array m loop
    execute format('alter table %I rename to %I', pair[1], pair[2]);
  end loop;

  -- then every constraint whose name still carries the old prefix
  -- (renaming a constraint renames its underlying index too)
  foreach pair slice 1 in array m loop
    for r in
      select conname
        from pg_constraint
       where conrelid = pair[2]::regclass
         and (conname like pair[1] || '\_%' or conname = pair[1] || '_pkey')
    loop
      execute format('alter table %I rename constraint %I to %I',
                     pair[2], r.conname,
                     pair[2] || substr(r.conname, length(pair[1]) + 1));
    end loop;
  end loop;

  -- RLS policies whose names carry the old table name
  foreach pair slice 1 in array m loop
    for r in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = pair[2]
         and policyname like pair[1] || '\_%'
    loop
      execute format('alter policy %I on %I rename to %I',
                     r.policyname, pair[2],
                     pair[2] || substr(r.policyname, length(pair[1]) + 1));
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Stragglers the map can't catch: triggers + short-form policy names
-- ----------------------------------------------------------------------------

alter trigger trg_item_locations_updated on inventory_item_locations
  rename to trg_inventory_item_locations_updated;
alter trigger trg_item_loc_par on inventory_item_locations
  rename to trg_inventory_item_locations_par;
alter trigger trg_item_order_day_par on order_guide_plan_days
  rename to trg_order_guide_plan_days_par;
alter trigger trg_po_items_updated on purchase_order_items
  rename to trg_purchase_order_items_updated;

-- guide_* policies (001 named them without the table prefix)
alter policy guide_read   on order_guide_entries rename to order_guide_entries_read;
alter policy guide_insert on order_guide_entries rename to order_guide_entries_insert;
alter policy guide_update on order_guide_entries rename to order_guide_entries_update;

-- ----------------------------------------------------------------------------
-- 3. Tell PostgREST (Supabase's API layer) to pick up the new names now.
--    Supabase usually reloads on DDL automatically; this makes it immediate.
-- ----------------------------------------------------------------------------

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 4. Verify (run after; every row should show the new names)
-- ----------------------------------------------------------------------------
-- select tablename from pg_tables where schemaname = 'public' order by 1;
-- select conname, conrelid::regclass from pg_constraint
--   where conrelid::regclass::text in
--     ('inventory_item_locations','order_guide_plan_days','order_guide_entries',
--      'purchase_order_items','purchase_order_attachments','purchase_reminders')
--   order by 2, 1;
-- select tablename, policyname from pg_policies where schemaname='public' order by 1,2;
