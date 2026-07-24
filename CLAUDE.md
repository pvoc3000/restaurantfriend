# restaurantfriend — project brief for Claude Code

Multi-location restaurant operations platform replacing a 13-year-old FileMaker
Pro solution ("DF Operations") for Donut Friend (donutfriend.com), module by
module. **First module: Purchasing** (order guide → POs → receiving).
The owner/developer is Mark: fluent in SwiftUI (built "Empty Basket"), new to
web/TS/SQL — explain non-obvious choices briefly; prefer boring, conventional
solutions over clever ones.

**Read `docs/purchasing-spec.md` before designing or changing any purchasing
feature.** `docs/master-plan.md` has the overall roadmap.

## Stack & state

- **Supabase** hosted project `kltxioacvneshbyhxtaj` (Postgres + Auth + Storage
  + Edge Functions). Schema `supabase/migrations/001_initial_schema.sql` is
  APPLIED to the hosted DB. One org (Donut Friend), 6 locations seeded
  (DF01, DF02 active; EVENT is virtual). Mark has an auth user + `org_members`
  owner row.
- **Web app** (`web/`): Next.js 16 (App Router) + TypeScript +
  Tailwind + `@supabase/supabase-js` + `@supabase/ssr`. This is the POWER TOOL —
  it replaces FMP's desktop layouts: dense, inline-editable tables, bulk
  operations, keyboard-friendly. Not a mobile-first marketing site. Auth +
  location context live. Shipped: `/order-guide`, `/items` (nav
  label "Inventory") + detail, `/vendors` + detail, `/purchase-orders` + detail,
  `/cleanup`. (Note: Next 16
  renamed the middleware convention — session refresh lives in `web/src/proxy.ts`.)
- **Migration** (`migration/`): FMP data is LOADED to the hosted DB — 80 vendors,
  790 items, 2,888 vendor items, 1,237 item-locations, full PO history. Loader
  is `migration/load.mjs` (service_role, local only). Transformed JSON lives
  OUTSIDE the repo (`../../FMP Export/transformed/`, has account numbers).
- **SwiftUI iPad/iPhone app**: phase 5, NOT yet. Do not create an Xcode project.

## Build sequence (locked — do not reorder)

1. ✅ Schema + RLS applied
2. ✅ Web skeleton: auth (email/password), org/location context, vendor list
3. ✅ FMP → Postgres migration (`migration/`) loaded; web catalog admin shipped.
   `/cleanup` queue (live from DB, per-location + all-locations, 3 problem
   checks, burn-down) with inline fix editors (package content w/ unit
   conversion, price, par — one per offending FAVORITE); multi-favorite plan-row grid
   editor (schema 003); last-ordered triage (view `v_item_last_ordered`,
   per-location, staleness chips, bulk-deactivate with "inactive everywhere"
   follow-up). Then brief §D: Inventory list + item detail, vendor detail with
   editable per-location config, vendor items everywhere.
4. 🚧 Web order guide + PO generation/processing + receiving (real Monday orders).
   Shipped: `/order-guide` — walk-order sections, item headers with par, lines
   nested (multi-favorite), three-state qty boxes, count mode
   (`ceil((par-on_hand)/package_content)`), vendor totals bar vs minimums,
   writes to `order_guide_entries` per line. No clear/update ceremony.
   Rebuilt 2026-07-23 on the membership/should-order model (schema 008,
   `docs/order-days-refactor.md`): membership = the active cascade, green =
   should-order (vendor + item + favorite day sets all include the walked day),
   per-line "why isn't this green" tooltips. Filters are two day tiers —
   **All** = orderable AND day-relevant (vendor order days ∧ item order days),
   **Favorites** = All ∧ favorite that day (= the view's `should_order`; within
   All the favorite check is the only thing left, hence the name), Skipped /
   Will order qty-based. Default filter Favorites; all 7 day chips always show;
   an **Ignore ordering days** switch lifts the day gates for lookup (FMP's
   `g_IgnoreOrderDayWhenSearching_b`), which suppresses green and disables the
   two day-scoped filters.
   **Broken against the live DB until 008 is applied** — the page selects the
   view's new columns.
   Shipped: `/purchase-orders` list (location-scoped, date window, status chips,
   totals, selection) and PO detail (ordered-vs-received with dual totals,
   inline receiving, price reconciliation → catalog). NOT built: **PO generation**
   (needs the order guide — build that next) and **batch process / email PDF /
   shopping list** (needs the edge function, deferred). The order guide is the
   remaining prerequisite for a real Monday order.
5. SwiftUI floor app (only after 4 is proven in real use)

The cleanup work is specced in `docs/catalog-cleanup-brief.md` (v2 = §A
multi-favorites + §B last-ordered triage). Cleanup checks live in
`web/src/lib/cleanup.ts`; unit conversion in `web/src/lib/units.ts`;
last-ordered buckets in `web/src/lib/lastOrdered.ts`. Schema: migration 003
makes `order_guide_plan_days` unique per (item, weekday, **vendor_item**) — multiple
favorites per day (multi-vendor sourcing / pack-size variants), so the guide
groups lines by inventory item. (003 also made `par_qty` a per-VENDOR-ITEM par —
a distinction FMP never had and the data never used; migration 009 undid it.)
Migration 004 adds the last-ordered view (per-location semantics: "last ordered
AT this location"). Migration 005 renames tables for clarity — see
"Table naming" under Conventions; docs/purchasing-spec.md §5 predates the
renames, translate via that mapping when reading it. Migration 006 adds
`po_number_seq` + `next_po_number()` for PO generation and 007 sets
`orgs.settings.timezone` (the order guide derives "today" from it — without it
a UTC host rolls the guide date at 5pm local). Migration 008 stores item order
days on `inventory_item_locations.order_days`, makes plan-row `vendor_item_id`
NOT NULL (materializing the old null-means-default rows), and recreates
`v_order_guide` at item-location × vendor item × weekday grain with
`should_order` / `is_favorite` / the three day arrays. Migration 009 returns
per-weekday par to `inventory_item_locations` (`par_by_weekday` /
`par_fixed_by_weekday`, slot n = weekday n, mirroring FMP's `Par__array` +
`isFixed_array`) and drops `par_qty` / `par_mode` from plan rows, leaving the
plan row a PURE FAVORITE record with no payload — so un-favoriting a day can no
longer destroy a par. The view's output is unchanged (`par_qty` / `par_mode`
still, just sourced differently), so no app code changed for par.
Migration 012 retires `inventory_item_locations.default_vendor_item_id` — dead
since 008 and read only by the cleanup checks that complained about it.
**Migrations 001–012 are ALL APPLIED to the hosted DB** (verified 2026-07-23).
Mark runs them himself in the Supabase SQL editor — never assume a written
migration has been applied, and never assume it hasn't: check. Cheap probes:
`select settings->>'timezone' from orgs` for 007, and for a function, call it
via RPC with a bogus argument so it raises on its first statement instead of
doing any work.

Migration 010 restores the vendor item's PACK STRUCTURE — FMP recorded
`UnitAmount × UnitSize UnitMeasure` ("CS 12 × 32oz") and the original load
multiplied it into `package_content` alone, so the guide printed a hardcoded
"1 × 24 lbs" (the "1 ×" was a literal in the UI; it always said 1). 010 adds
`vendor_items.pack_count / pack_size / pack_unit` and exposes them on the view;
`package_content` is untouched and remains the base-unit total count mode
divides by. The VALUES come from the raw export, not the migration — run
`migration/backfill-pack.mjs` (dry run by default, `--apply` to write) after
010. Backfill is DONE (2,621 rows, verified field-by-field against the export;
698 multi-packs). Migration 011 retyped `pack_count` integer → numeric: FMP
allows a fractional UnitAmount and one row uses it (0.5 × 1qt), which killed
the first backfill run partway through. **The web app on this branch requires
010/011** — the guide selects the new columns — **and must ship BEFORE 012**,
which drops a column the Inventory list and item detail used to select.

**Par belongs to the item at a location, never to the order guide** (Mark,
2026-07-23). If a future change wants a par that varies by anything other than
(item, location, weekday), that is a signal the model is drifting again — 001
put per-weekday par on plan rows only because that table happened to carry the
weekday column, and 003 then silently made it per-vendor-item.

## Non-negotiable design rules

1. **Multi-tenant-ready**: every table has `org_id`; all queries flow through
   RLS (org-scoped policies exist). Never bypass RLS from the web app; the
   `service_role` key is for local migration scripts only and must never appear
   in `web/` or in git.
2. **Zero business hardcoding**: business names, billing entity, PO number
   format, email templates, terminology live in `orgs.settings` /
   `locations.settings` jsonb — never in code. (The old system hardcoded
   "The Donut Friend Team" into a script; we don't.)
3. **Location context**: the user is always "working at" one active location
   (persisted per user in `org_members.last_active_location_id`); every
   location-scoped screen filters by it; switching is a 2-tap header control.
4. **The order guide is the VIEW `v_order_guide`** — never materialize it into
   a table, never cache-and-sync. This rule exists because the FMP version did
   the opposite and it was the single worst source of bugs and slowness.
5. **Units discipline**: pars and on-hand counts are in the inventory item's
   `base_unit` (lbs, each…); order quantities are in PACKAGES of the chosen
   vendor item; `vendor_items.package_content` converts. Suggested qty =
   `ceil((par − on_hand) / package_content)` — always editable, never forced.
6. Price resolution: `vendor_item_location_prices` override → `vendor_items.price`.
   Price and par changes are logged automatically by DB triggers — don't log in
   app code.

## Conventions

- **The Active toggle is the FIRST column** on every catalog table (Mark,
  2026-07-23) — vendors list, vendor/item per-location config, vendor items.
  "Stock here" shares that slot where a row doesn't exist yet.
- **Every list uses `DataTable`** (`web/src/components/catalog/DataTable.tsx`):
  sortable headers, drag-resizable columns, optional scroll pane with a sticky
  header, optional expandable rows. Give it columns + rows; don't hand-roll a
  `<table>`. Supporting pieces: `ColumnHeader` (the header cell + resize grip),
  `lib/tableSort.ts` (comparator — empty cells sink last in BOTH directions),
  `lib/columnWidths.ts` (`useResizableColumns`). `/cleanup` predates this and is
  deliberately left alone.
- **View state in the URL, display preferences in localStorage.** Filters and
  sort describe the view (shareable, survive detail round-trips) → query string,
  written with `history.replaceState` so a keystroke doesn't re-run the server
  component. Column widths are personal → localStorage, read via
  `useSyncExternalStore` (an effect would trip the `set-state-in-effect` lint).
  **The order guide is the exception**: its day / filter / grouping / ignore-days
  live in a SESSION cookie (`rf.guide.view`, see `lib/orderGuide.ts`) because the
  nav link is a bare `/order-guide` with no query to carry, and the weekday must
  be known SERVER-side before the view is queried — a client store would paint
  the wrong day first. `signOut` deletes it, so it lasts "until you log out"
  (Mark, 2026-07-23). An explicit `?day=` still wins over the remembered day.
  The search box is deliberately NOT remembered.
  A list that persists sort in the URL must pass `sort`/`onSortChange` to
  `DataTable`, or the header arrow and the URL disagree.
- **Breadcrumbs follow the route taken**, not a fixed hierarchy (`lib/breadcrumbs.ts`):
  links stamp `from`, the trail nests, recorded hrefs are trimmed so the URL
  can't grow unbounded. An item reached from a vendor leads back to that vendor.
- **Detail views open as a slide-over panel on in-app navigation** (Mark,
  2026-07-23): `(app)/@panel` intercepting routes float `/items/[id]`,
  `/vendors/[id]` and `/vendor-items/[id]` over the current page
  (`DetailPanel.tsx`; close = back). Each detail view leads with a type label
  ("Inventory" / "Vendor" / "Vendor Item") — the panel hides breadcrumbs, so
  it's the only cue to which kind of record you're looking at.
  It is a **slide-over, not a modal**: the header is `sticky z-50`, the panel
  `z-40` starting below it, so nav stays clickable (a click navigates and the
  `@panel` catch-all closes the panel). The panel's top offset is MEASURED from
  the header at runtime — the header wraps to 2–3 rows on a narrow window, so a
  hardcoded offset silently covers the nav again. Verify overlay changes with a
  REAL click (`computer`), never a programmatic `.click()`: JS clicks bypass
  hit-testing and will pass on a nav link that a user physically cannot reach.
  The page underneath stays mounted — guide scroll/filter survive. Hard loads
  and deep links render the dedicated pages, which is where breadcrumbs live
  (the panel shows none). Detail bodies are shared server components
  (`ItemDetail.tsx` / `VendorDetail.tsx`) — edit those, not the page shells;
  new detail screens should follow this pattern (slot + `(.)` intercept +
  catch-all null so nav clicks close the panel).
- **Safari:** a table cell under `border-collapse` is NOT a containing block in
  WebKit — anchor absolutely-positioned children to an inner `<div>`. And see
  web/README.md on Safari caching a stale dev stylesheet.
- **Table naming** (migration 005, 2026-07-22): junction/config tables are named
  by their endpoints (`vendor_locations`, `inventory_item_locations`); workflow
  tables by their business concept (`purchase_orders`, `order_guide_plan_days`).
  Follow these rules for every new table. Renames applied (old → new, for
  reading pre-005 docs/specs): `item_locations` → `inventory_item_locations` ·
  `item_order_days` → `order_guide_plan_days` · `guide_entries` →
  `order_guide_entries` · `po_items` → `purchase_order_items` ·
  `po_attachments` → `purchase_order_attachments` · `reminders` →
  `purchase_reminders`. Column names were NOT renamed (`po_id`,
  `item_location_id` remain). The migration JSON files also keep old names.
- Weekdays: ISO smallint, 1 = Monday … 7 = Sunday (all ordering currently
  happens Monday; don't foreground the day dimension in UI).
- Roles: owner / admin / purchaser / staff (in `org_members.role`).
  Staff can create purchase requests + guide entries; catalog/PO writes need
  purchaser+.
- RLS filters ROWS, not COLUMNS. When the rule is "a user may change *this
  field* on their own row", write a `security definer` function naming those
  columns (see `set_my_member_profile`, migration 002) — a self-update policy
  would also let staff edit their own `role`. Such a function bypasses RLS, so
  its body must re-check what RLS would have. Every new public-schema function
  is executable by `anon` via Supabase's default privileges, and revoking from
  `PUBLIC` does NOT undo that: `revoke all on function … from anon` by name.
- Guide quantity three-state (from FMP, deliberately preserved): entered (>0),
  explicitly zeroed (0), untouched (null). Render distinctly (green/red/neutral).
- Secrets: `web/.env.local` only (gitignored). `NEXT_PUBLIC_SUPABASE_URL` =
  https://kltxioacvneshbyhxtaj.supabase.co, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  from Supabase Studio → Settings → API. Ask Mark to paste it; never commit it.
- Git: small commits, plain messages. Mark reviews on GitHub.

## Domain cheat-sheet (why screens look the way they do)

- The order guide walks the physical shop: grouped by `shop_sections`
  (sort_order, e.g. "31 Storage - R1 S1"), item headers show par, vendor items
  nested with pack + unit price ($/oz comparison matters — pack sizes differ).
- Favorites = plan rows (`order_guide_plan_days`): the preferred source per
  weekday, ★-marked, overridable in the moment. Since 008 a favorite is one of
  four should-order conditions, not guide membership. The real vendor decision
  is basket-level: a **vendor
  totals bar** shows each vendor's running subtotal vs its minimum
  (`vendor_locations.minimum_order`); an under-minimum vendor simply gets no PO
  that week (flour is deliberately "ballast" to hit Bakemark's $900 minimum).
- PO processing by vendor `order_type`: email_po → PDF emailed (edge function,
  later), online → open vendor URL, in_person → shopping list sorted by shop
  section. PO PDF spec: docs/purchasing-spec.md §4.9 (no totals on the
  vendor-facing document — intentional).
- Receiving: per-line qty_received, invoice photo → Storage, and a one-tap
  "invoice price differs → update catalog?" flow.
- Vendors include non-food suppliers (landlord, plumber) — `order_type: none`.

## Open threads (pinned by Mark — don't act without asking)

- **Should-order counts don't match the brief's measurement.** The
  2026-07-23 build implements the settled model exactly (fixture-tested), and
  membership verifies at the brief's 883 — but the brief's should-order figures
  (Mon 229 / Wed 118 at DF01) could not be reproduced from any data source
  during pre-flight; the model over live data gives Mon 394 / Wed 222. Wed 222
  matches the earlier draft's same-day vendor-gate measurement, so the gate
  behaves as measured. Judge the guide by the per-vendor breakdown vs the real
  ~11 Monday POs (query 4 in migration 008's comments), not the brief's totals.
- ~~**"Default vendor item" may be the wrong concept."**~~ **RESOLVED
  2026-07-23 — retired (migration 012).** It stopped having any reader when 008
  killed the null-plan-row indirection, leaving a closed loop: the only writer
  was the cleanup queue's own "assign default" editor and the only readers were
  the checks complaining about it. Measured over 665 active item-locations at
  DF01+DF02, `no_default` flagged 146 of which 130 (89%) already had a healthy
  favorite, and `default_inactive` flagged 193 of which 124 (64%) did. Both
  checks and that editor are gone; `lib/cleanup.ts` now asks about FAVORITES —
  `no_package_content` and `no_price` evaluate each ACTIVE favorite (the sources
  the guide actually emits) and `no_par` is unchanged. Those two counts went UP
  (46→105, 55→59) because they had been inspecting the wrong vendor item and
  missing real gaps. Also dropped with the column: the "Default vendor item" and
  "Price" columns on the Inventory list and item detail, and their sort keys —
  there is no single vendor item that speaks for an item-location any more.
- **Delete/duplicate vendor items.** Design agreed but not built: a per-row `⋯`
  menu (not right-click — no touch equivalent, and iPad Safari is the ordering
  stopgap). Delete must be usage-aware: `price_history` is `on delete cascade`
  (audit trail lost) and since 008 `order_guide_plan_days.vendor_item_id` is
  `on delete cascade` too — deleting a vendor item silently deletes its
  favorites and their par overrides. Offer deactivate for anything ever ordered.
- **`rep_email` looks mis-mapped by the migration** — Restaurant Depot's rows
  carry `info@donutfriend.com` (our address, not the vendor's). Check the other
  79 vendors before trusting the column.
- **"Last ordered" on the vendor screen** means "this item, at this location,
  from any vendor" — the Inventory semantics. A true per-vendor-item last-order
  date needs a small view over `purchase_order_items` (migration 006).

## What NOT to build (deliberately killed or deferred)

Killed: location transfers/packing lists, PO_Type taxonomy, most legacy
reports, standalone inventory-count UI. Deferred to v2+: order suggestions,
minimum helper, invoice OCR, spend dashboard, collaborative ordering, offline.
When in doubt whether a feature belongs, check the spec's kill list or ask Mark.
