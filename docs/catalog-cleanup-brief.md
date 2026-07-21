# Build brief: Catalog admin + Cleanup queue

**Context:** Migration is loaded (80 vendors, 790 items, 2,888 vendor items, 1,237
item-location rows, full PO history). `Catalog-Audit.xlsx` found 465 active
item/location rows whose ordering math is broken. This brief covers the screens
Mark needs to fix them — the "web catalog admin" phase from docs/master-plan.md.
Read docs/purchasing-spec.md §4.1/§4.5-4.8 first; follow CLAUDE.md conventions.

## Priority 1 — Cleanup page (`/cleanup`)

A queue that computes the problem list **live from the database** (do NOT import
the audit spreadsheet — same checks, fresh data, count burns down as Mark works):

For every active `item_locations` row (joined to active `inventory_items`), flag:

1. `default_vendor_item_id is null` → **"No default vendor item"**
2. default vendor item exists but `vendor_items.is_active = false` (or its vendor
   is inactive) → **"Default vendor item inactive"**
3. default vendor item has `package_content is null` → **"No package content"**
4. default vendor item has `price is null or price = 0` → **"No price"**
5. `default_par is null` → **"No par"** (lowest priority — some items genuinely
   have no par; provide a "no par needed" dismissal that just leaves it null and
   remembers dismissal, e.g. a `cleanup_dismissed` flag in `item_locations.note`
   is NOT acceptable — add a proper `par_not_needed boolean default false` column
   via a new migration if dismissal is wanted, or simply let Mark ignore the tab)

UI: tabs or filter chips per problem type with counts; table rows = item name,
location, category, default vendor (if any), the specific problem; clicking a row
opens the fix affordance **inline or in a drawer** — never navigate away from the
queue. Fixing one problem re-evaluates the row (it may have two problems).

## Priority 2 — the fix affordances the queue needs

1. **Assign default vendor item** (fixes #1, #2): searchable picker of the item's
   vendor items (show vendor name, description, package, price, active badge);
   option to search ALL vendor items and link one to this item; writes
   `item_locations.default_vendor_item_id`. Also offer "deactivate this item
   here" (`item_locations.is_active = false`) and "deactivate item everywhere"
   (`inventory_items.is_active = false`) — many of the 237 are dead items.
2. **Package content editor** (fixes #3): on the vendor item — inputs for
   amount × size + unit with live math preview ("1 × 50 lbs = 50 lbs per BAG →
   $0.43/lb"), writes `vendor_items.package_content` (numeric, in the inventory
   item's `base_unit`). Show the item's base_unit prominently; warn if the
   entered unit family can't convert to it.
3. **Price editor** (fixes #4): plain numeric edit on `vendor_items.price`
   (the DB trigger logs price_history automatically — no extra work).
4. **Par editor** (fixes #5): numeric par in base units on
   `item_locations.default_par`; show the FMP-era par text if helpful — it's
   gone from the DB (deliberately), so just leave a free-text placeholder like
   "e.g. 100 (lbs)".

## Priority 3 — general catalog admin (grow from the above)

- Items list (search, category filter, active filter) → item detail with its
  vendor items and per-location rows.
- Vendor items list per vendor (extends existing vendor pages).
- Keep bulk-ness in mind: multi-select + "deactivate selected" on the items list
  is the single highest-value bulk action for cleanup.

## Rules

- All writes go through supabase-js with RLS as the signed-in user (owner) — no
  service_role in the web app, ever.
- Location context matters: the cleanup queue is **per current location** by
  default with an "all locations" toggle (same item may be broken at DF01 but
  fine at DF02).
- No new tables needed. If you find yourself wanting one, stop and flag it.
- Update CLAUDE.md's status section when this ships.
