-- ============================================================================
-- restaurantfriend — migration 038 · an item's NAME is not its identity
--
-- 037 shipped `unique (org_id, name)` on `production_items`, copying 036's
-- rule for elements. For an element that is right — "Raised Dough" is one
-- thing. For an ITEM it is wrong, and the real data says so loudly: the load
-- collapsed 307 items to 173.
--
-- ONE NAME, SEVERAL PRODUCTS. "Angry Samoa" is four different donuts:
--
--   Regular Cake Vanilla         price class Regular
--   Mini Raised Promise Ring     price class Mini
--   Regular Raised Letter        price class Letter
--   Giant Raised Promise Ring    price class Giant
--
-- Same flavour, four things you can buy, four prices. The menu name is a
-- LABEL; what makes a product distinct is the name plus its taxonomy.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DROPS THE CONSTRAINT RATHER THAN WIDENING IT
--
-- `(name, size, item_type, subtype)` is exactly unique over all 307 rows —
-- measured — so a composite unique index is available and tempting.
--
-- It is migration 024's mistake waiting to happen. That constraint said "a
-- pack count needs a pack size", which was true of finished data and wrong as
-- a rule, because the columns are edited ONE AT A TIME and the first cell you
-- reach is the one it forbids. Mark hit it and got raw Postgres text in a
-- table cell.
--
-- These four columns are four separate `InlineValue` cells on the item screen.
-- Changing a Regular to a Mini when that Mini already exists would fail on the
-- FIRST edit, and there is no order of edits that works — you cannot set the
-- size and the cut in one keystroke. A menu that refuses a legitimate new
-- variant mid-edit is worse than one that lets a duplicate through.
--
-- So identity is the id, as it is for every other record here, and duplicates
-- are handled the way `findPossibleRehires` handles a returning employee: the
-- create form WARNS and lets you through, because the person typing knows
-- something the constraint does not.
--
-- `unique (org_id, legacy_id)` stays. That one is about migration identity —
-- two rows claiming the same FileMaker row really is corruption.
--
-- Depends on 037. Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

alter table production_items
  drop constraint if exists production_items_org_id_name_key;

-- Names are still what you search and read by, and there is no unique index
-- doing that job any more.
create index if not exists production_items_org_name_idx
  on production_items (org_id, name);

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select conname from pg_constraint
--    where conrelid = 'public.production_items'::regclass and contype = 'u';
--     → production_items_org_id_legacy_id_key ONLY. If the name key is still
--       listed, this migration has not been applied.
--
--   select count(*) from production_items;            → 307 after the load
--   select count(distinct name) from production_items; → 173, and that is
--     CORRECT: 134 of the items share a name with another size or cut.
