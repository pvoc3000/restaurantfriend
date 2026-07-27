# Table-rename sweep — instructions for Claude Code

Migration `supabase/migrations/005_table_renames.sql` renames six tables
(decided with Mark 2026-07-22; naming rules now documented in CLAUDE.md →
Conventions → "Table naming"):

| old | new |
|---|---|
| `item_locations` | `inventory_item_locations` |
| `item_order_days` | `order_guide_plan_days` |
| `guide_entries` | `order_guide_entries` |
| `po_items` | `purchase_order_items` |
| `po_attachments` | `purchase_order_attachments` |
| `reminders` | `purchase_reminders` |

**Column names did NOT change** — `po_id`, `item_location_id`, etc. remain.
Views (`v_order_guide`, `v_last_orders`, `v_item_last_ordered`) and their
output columns are unchanged. RLS policies were renamed with their tables but
behave identically.

## Order of operations

1. Mark runs 005 in the Supabase SQL editor (the app's item_locations /
   item_order_days queries 404 from that moment until step 2 ships).
2. You make the code sweep below, Mark restarts the dev server.

## The sweep (web/src)

Only TWO old names appear in app code. Replace the string in `.from("…")`
calls and fix the adjacent comments:

`item_locations` → `inventory_item_locations`:
- `web/src/app/(app)/cleanup/page.tsx` — `.from("item_locations")` (~line 50) + comment ~53
- `web/src/components/cleanup/AssignVendorItem.tsx` — two `.from()` calls (~115, ~129)
- `web/src/components/cleanup/CleanupQueue.tsx` — two `.from()` calls (~113, ~126)
- `web/src/components/cleanup/FixDrawer.tsx` — one `.from()` call (~338)
- `web/src/lib/cleanup.ts` — comments only (~28, ~31)

`item_order_days` → `order_guide_plan_days`:
- `web/src/components/cleanup/FavoritesEditor.tsx` — five `.from()` calls
  (~69, 111, 122, 139, 155) + comment ~34

No other web/src file references any renamed table (verified by grep,
including embed hints — the `!inner` hints all target unrenamed tables).

## Do NOT touch

- `supabase/migrations/001–004` — applied history; never edit applied migrations.
- `migration/load.mjs`, `migration/field-map.md` — already updated.
- The transformed JSON in `../../FMP Export/transformed/` — files keep their
  old names (`item_locations.json`, `item_order_days.json`, `po_items_1/2.json`);
  the loader maps file → table.
- `docs/purchasing-spec.md` — frozen at v0.10, predates the renames; CLAUDE.md
  carries the translation mapping.

## Verify

1. `grep -rn "item_locations\|item_order_days\|guide_entries\|po_items\|po_attachments" web/src` → only `inventory_item_locations` / `order_guide_plan_days` matches (substring hits), no bare old names.
2. `/cleanup` loads with the same queue counts as before the rename, and the
   favorites grid in the fix drawer loads + saves a checkbox toggle.
3. Commit as one small commit: `rename tables per migration 005`.
