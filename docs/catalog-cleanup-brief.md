# Build brief: Catalog admin + Cleanup queue — v2

**v2 changes (2026-07-21, after schema 003):** multi-favorite plan rows are now
real (§A below) — the guide and editors must handle them; and the cleanup queue
gains PO-history-driven triage (§B) so Mark can bulk-deactivate dead catalog
instead of "fixing" it. If v1 of this brief is already built, §A and §B are the
delta. Read docs/purchasing-spec.md + CLAUDE.md first; migration 003
(`supabase/migrations/003_multi_favorites.sql`) documents the new semantics.

## A. Multi-favorite plan rows (schema 003)

`item_order_days` is now unique on (item_location, weekday, **vendor_item**) —
an item can have several favorited vendor items on the same weekday. The data
loaded this way: 10,462 plan rows, ~2,370 day-groups with >1 line. Two intents:

- multi-vendor sourcing (same need, pick source on the fly — "Soap, Hand" from
  Restaurant Depot / Unified Paper)
- pack-size variants (CS + EA of the same product; 3-gal + 1.5-gal ice cream)

Consequences for UI:

1. **Order guide (when built): group lines by inventory item.** Item header row
   (name, section, item par); one child line per plan row (vendor, description,
   package, price, qty box). `v_order_guide` already emits one row per plan row.
2. **`par_qty` on a plan row = per-LINE par** (rare; item-level
   `item_locations.default_par` is the group total). Don't sum line pars into
   the item par — they're overrides for specific lines only.
3. **Favorites editor** (item detail, per location): the item's vendor items in
   a weekday × vendor-item grid of checkboxes mirroring FMP's favorites row;
   writes plan rows. Include "all days" toggle per vendor item.
4. **Splitting guidance** (help text on the favorites editor, one line): if the
   variants are substitutes (either one fills the need) keep one item with
   multiple favorites; if they're distinct needs (flavors each deserving their
   own par/on-hand, e.g. San Pellegrino flavors) split into separate items.
   A "split" helper is NOT required for v1 — Mark will split by hand: create
   item, repoint vendor item, set par.

## B. Cleanup queue: add last-ordered triage

The queue's biggest waste-of-time risk is Mark hand-fixing items he stopped
ordering years ago. PO history is loaded — use it:

1. Add a **"Last ordered"** column to the cleanup queue and items list:
   `max(purchase_orders.order_date)` over the item's vendor items' po_items at
   that location (one query/view, not N+1 — consider a small SQL view
   `v_item_last_ordered(item_location_id, last_order_date)`).
2. Add filter chips: **never ordered** (37 active rows) · **2+ years** (143) ·
   **1-2 years** (80) · **within a year** (650).
3. Add **bulk select + "Deactivate selected"** (sets `item_locations.is_active
   = false`; separate action for `inventory_items.is_active = false` when the
   item is inactive at ALL locations — offer as a follow-up prompt).
4. Suggested flow shown in the UI: triage stale rows first, then fix what's
   left. The queue counts should visibly shrink.

## C. Cleanup queue checks (unchanged from v1)

Live-computed per active item_location (joined to active inventory_items):
no default vendor item · default VI inactive (or its vendor inactive) ·
default VI missing package_content · default VI price null/0 · default_par
null (lowest priority, ignorable). Fix affordances inline/drawer: default-VI
picker (searchable, with deactivate shortcuts), package-content editor with
live math preview and unit-family warning, price edit (trigger logs history),
par edit in base units.

## D. General catalog admin (unchanged from v1)

Items list (search/category/active/last-ordered) → item detail (vendor items,
per-location rows, favorites editor). Vendor items per vendor. Multi-select
deactivate on the items list.

## Rules

- All writes via supabase-js as the signed-in user under RLS — never service_role.
- Cleanup queue is per current location with an "all locations" toggle.
- No new tables without flagging it first. Small SQL views are fine (add as a
  numbered migration).
- Update CLAUDE.md status when shipped.
