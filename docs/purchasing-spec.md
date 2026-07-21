# Purchasing Module — Functional Spec (v0.10 — INPUT-COMPLETE)

**Source:** DF-PO-System DDR + Mark's walkthrough answers + ordering-model design discussions + iPad screenshots (2026-07-19) + 18 desktop screenshots + sent PO PDF 112-18008-01 (2026-07-20)
**Status:** All inputs in. Ordering model settled (§4); UX grounded (§4.6–§4.9). Per-location pricing accepted (§4.8). **Build sequence locked: web first, iPad second.** Next artifact: Postgres DDL + RLS + web skeleton, on Mark's go.

**Context note:** the iPad app is the floor tool; the FMP *desktop* layouts are the power tool where Mark spends most of his time. In the new architecture the **web app inherits the power-tool role** — bulk editing, cross-location grids, big filterable tables, reports — and must be scoped as a first-class surface, not a companion.

**Build sequence (LOCKED 2026-07-19): web first, iPad second.**
1. Schema + RLS + auth (Supabase)
2. Migration dry run → real catalog data in staging
3. **Web catalog admin** (vendors, vendor items, inventory items, pars grid, shop sections) — used to clean the migrated data; dogfooding from day one
4. **Web ordering flow** (order guide + vendor totals bar + PO generation/processing + receiving) — proven on real Monday orders, iPad Safari as the floor stopgap; FMP purchasing functionally retired for Mark at this milestone
5. **SwiftUI iPad/iPhone app** — the polish layer on the proven backend: native guide ergonomics, camera receiving, offline cache, staff request submission
6. Staff rollout
Rationale: migration cleanup needs bulk-edit surfaces; web iterates fastest while the schema is still moving; the module's only v1 user is Mark on the power surface; Swift then targets stable APIs in his most fluent stack. Guardrail: web-first is purchasing-scoped — no desktop-layout rebuilding beyond this module's screens.
**Context that shapes everything:** Mark is currently the only person ordering, for 2 active locations (of 6 in the system). He built the original with no foodservice-software experience and wants improvement suggestions, not a faithful recreation. **The app should be designed so it could one day serve other businesses** — no architectural decisions that lock it to Donut Friend (§0).

---

## 0. Design Principles: Location Context & Future Multi-Tenancy

**Location as session context — kept, made fluid.** The FMP pattern (log in → you *are at* a location → everything scopes to it) is conceptually right and carries forward. What changes is the mechanics: instead of a heavyweight "change locations and reset everything" module, the active location is a persistent session value shown in the toolbar/sidebar, switchable in two taps from anywhere. Every location-scoped screen (order guide, POs, receiving, reminders, pars) filters by it automatically; per-location settings live in a settings store per location, not scattered fields. The app remembers your last active location per device. Admin/web screens can additionally offer "all locations" views — something FMP's model made painful — without breaking the mental model of "I'm working HP right now."

**Multi-tenant-ready, not multi-tenant-built.** To keep the door open for other businesses later, three cheap rules apply from the first migration, and nothing more:

1. **Every table carries `org_id`** (one org — Donut Friend — exists for years, so it's an invisible constant), and RLS policies are written as `org_id = current_org AND …` from day one. Retrofitting tenant scoping onto a live schema is the single most painful migration in SaaS; adding the column now costs nothing.
2. **No business-specific hardcoding.** Email templates, PO number formats, terminology, category lists, CC addresses, vendor types — all per-org/per-location configuration with sensible defaults, never string literals in code. (The old system hardcoded "The Donut Friend Team" into a script step; that becomes a template setting.)
3. **Auth models membership, not identity.** A user *belongs to an org* and *has roles at locations*, even while every real user belongs to the same org. This also gives the per-location roles the current privilege sets can't express.

Explicitly **not** now: billing, org onboarding/signup, per-org theming, tenant admin UI. That's product work for a future that may or may not arrive; the rules above just guarantee it stays possible.

---

## 1. Scope Decisions (from walkthrough)

### Carried forward, improved
- **Order guide daily loop** — location + day → walk the guide → generate POs per vendor → process per vendor type (email PDF / vendor website / shopping list). The core mechanic works; keep it.
- **Favorites mechanic** — items whose vendor-item order days intersect the inventory item's order days are highlighted, and "favorites only" view removes all decision friction. This is the heart of why the guide works for Mark; preserve exactly, then extend (see §4).
- **Receiving** — actively used, keep and upgrade. Today: scan invoices/packing slips, note ordered-vs-received discrepancies, occasionally update vendor item prices from invoices. Frequently consulted while ordering ("when did I last order this? how much?"). v1 makes all three first-class (§3).
- **Reminders** (the old Messages table) — rarely triggered but valued. Rebuild as lightweight order reminders: a note attached to a date + location (optionally a vendor or item) that surfaces when the relevant order guide opens.
- **Duplicate guide/config to new location** — rare but handy. Becomes a simple admin action on the web side; low priority within v1.
- **Vendor catalog report** — "what each vendor offers." The one report that clearly survives.
- **Price history** — kept automatically (it's one trigger); minimal UI (a history list on the vendor item). Rarely consulted, but free to keep.

### Killed (not carried to v1)
- **PackingList / PackingListItem** — partially implemented location transfers, never used. Dropped; "transfers" goes on the future list as a properly designed feature if ever needed.
- **PO_Type** — purpose unknown even to the author. Gone.
- **~8 of 10 report layouts** — inventory 2-col/3-col/order-sheet variants, POItems summary, etc. Replaced by a couple of well-chosen web reports later.
- **On-hand *UI*** — no dedicated inventory-count screens in v1. But the schema quietly keeps every on-hand and order quantity entered during guide sessions (§5), so usage history accumulates from day one and the future feature costs nothing extra when wanted.

### Deferred (designed-for, not built)
- **Multi-person ordering** — schema and sync model must not assume one user (Supabase realtime makes "two people working different sections of the same guide" cheap to add later), but no collaborative UI in v1.
- **Assigned-to on items** — column exists, no UI.
- **On-hand trends / usage tracking** — data captured from v1, feature later.
- **Location transfers** — future, from scratch, if needed.

## 2. The v1 Workflow (target design)

1. **Open Order Guide** — defaults to current location + today; renders instantly from a live query (no clear/update ceremony, §4.6). Due reminders and open purchase requests appear at top. Items grouped by shop section in walk order (§4.6), favorites highlighted, "favorites only" toggle default-on.
2. **Walk the guide** — per line: par, last-order info (date, qty, price — inline, not a lookup), and either direct qty entry or on-hand entry with computed suggestion (two coexisting modes, §4.3). The **vendor totals bar** tracks each vendor's running subtotal against its minimum live; lines reassign to alternate vendors with one tap (§4.2). A vendor left under minimum generates no PO.
3. **Generate POs** — one per vendor from will-order lines; per-vendor numbering with prefix preserved; "<7 days since last PO for this vendor" guard preserved.
4. **Process** — email PDF (improved template: delivery date, account number, per-vendor notes, reply-to; CC configurable), open vendor site, or shopping-list mode sorted by store section. Batch processing preserved.
5. **Receive** — open recent POs; tap through lines confirming/adjusting received qty; **attach invoice/packing-slip photo to the PO** (camera → Supabase Storage); when a line's invoice price differs from catalog, one tap updates the vendor item price (and logs it). Short/wrong lines flagged with a note.

## 3. Improvements Beyond Parity (suggested — Mark asked)

Since you haven't used commercial ordering apps (MarketMan, BlueCart, Choco, etc.), here's what they do that maps onto your operation, tiered by cost:

**Cheap enough to include in v1**
- **Vendor totals bar with minimum tracking** (§4.2) — promoted from "warning" to the guide's central instrument: live subtotal vs. minimum per vendor, one-tap line reassignment, under-minimum vendors generate no PO.
- **Last-order context inline** (you already do this manually via POItem searches — it becomes zero-effort).
- **Price-change detection at receiving** — "invoice says $42.10, catalog says $39.80 → update?" (you do this manually today).
- **PO status at a glance** — draft / sent / received with badge counts, replacing wasProcessed/wasReceived flags and date-range finds.
- **Delivery-day chips** — each vendor option shows "arrives Thu" from vendor_locations data.

**v2 candidates (after v1 ships)**
- **Order suggestions** — once a few months of order + on-hand data accumulate: "you order ~6 of these every Tuesday; suggest 6." This is the single highest-value feature of commercial tools, and your schema will already have the data.
- **Minimum helper** — "Bakemark is $188 short — flexible items you could shift: flour +$95/bag, …" (§4.4).
- **Coverage-aware suggestions** — order quantity computed from the chosen vendor's actual delivery gap (§4.4).
- **Price-trend flags** — "this item is up 18% over 90 days; here's the alternate vendor item for the same inventory item and its price."
- **Invoice OCR** — photograph the invoice and have line items + prices extracted automatically (AI-assisted; pairs perfectly with the receiving flow).
- **Spend dashboard** — by vendor / category / location / month, from data v1 already collects.

**Backlog / someday**
- Collaborative ordering by section; assigned-to items; barcode scanning for counts; location transfers; budget targets.

Recommendation: build v1 as parity-plus-the-cheap-four. Resist v2 items until real data exists — order suggestions built on day one would suggest nothing.

## 4. The Ordering Plan (settled v0.5 — favorites, pars, on-hand, and minimums as one system)

The FMP mechanics (favorites = vendor-item days ∩ item days; pars per weekday with Monday-carries-through fallback) were clever encodings of one underlying thing: **a sourcing plan** — for each item, at each location: *ordered when, from whom by default, and up to how much*. v0.5 states that plan explicitly, and adds the lesson of the AP-flour stress test: the final vendor choice is a **basket-level decision made weekly**, not an item-level fact.

### 4.1 The model

- **Ordering plan.** Each item-location has weekday rows; a row's existence means "we order this item, here, on this day." Each row carries the **default vendor item** and an optional **par override**; the item-location holds a default vendor item and default par that rows inherit. Items/categories not stocked at a store simply have no rows there.
- **Favorite = default, not rule.** The row's vendor assignment is what the guide highlights and preselects — but any line can be reassigned to an alternate vendor item in the moment (tap the vendor chip → alternates for the same inventory item, with price, package, and delivery day). The plan is where you *start*; the week decides where you *end*.
- **Pars live in item base units.** Each inventory item declares a base unit (lbs, each, case-equivalent); par and on-hand are counted in it; each vendor item declares its package content in that unit. Suggestions convert: need 70 lbs → Bakemark (50 lb bags) suggests 2, Chef's Warehouse (25 lb bags) suggests 3. The math survives any vendor swap — pars counted in "packages" would lie the moment pack sizes differ.
- **Vendor schedule and minimums are constraints, surfaced live.** Order/delivery days and minimum order live on `vendor_locations`. The guide shows a **vendor totals bar** — running subtotal vs. minimum per vendor (*Bakemark $712 / $900*), updating as lines are entered — and each vendor chip shows its delivery day ("arrives Thu"). Assigning a vendor on a day it doesn't take orders warns.
- **Pars attach only to order days.** A par is an order-up-to level covering the gap to the next delivery. One par if you order once a week; overrides per day only where they differ.

### 4.2 The worked example (AP flour, real numbers)

Setup: AP Flour, base unit **lbs**. Usage ~2×50 lb/week Downtown, ~3×50 lb/week Highland Park → pars ≈ **120 lbs DT / 175 lbs HP** (tuned in practice). Vendor items: Bakemark 50lb (default — ballast for their $900 min), Dawn 50lb (best price, $500 min, delivers Fri), Chef's Warehouse 25lb ($300 min, next-day), Restaurant Depot 50lb (self-shop, no min). All ordering happens Monday at both locations, so each plan has one row: Mon.

Monday, Downtown: guide shows flour under Bakemark (favorite), last order inline. Count mode: shelf has 30 lbs → need 90 → **suggest 2 bags Bakemark**, editable. As the guide fills, the totals bar reads *Bakemark $712/$900*. Two moves, both one tap: add ballast (flour → 3 bags), or reassign the flour line → chip shows Dawn 50lb $X (arrives Fri) / CW 25lb $Y (arrives Tue, would suggest 4) / RD → pick one, and if Bakemark ends the session below minimum, it simply generates no PO this week. That's the "skip Bakemark entirely" week, expressed in the tool instead of in your head.

### 4.3 Guide entry: two modes per line, coexisting

1. **Direct** (today's habit): type the quantity to order (in packages of the chosen vendor item).
2. **Count-based**: enter on-hand in base units → app proposes `ceil((par − on_hand) / package_content)` → prefilled in the same editable stepper. Always a suggestion, never a mandate.

Count-based ordering is what makes the process delegable (a new hire can count a shelf; they can't replicate 13 years of in-head judgment), and it captures the on-hand history v2's usage analytics need. Overrides are themselves signal (suggested 2, ordered 3 → par may be stale — future par-tuning report). Expect a calibration period: pars have never had to be precise before because Mark's head did the correcting; the override log shows exactly which pars to fix.

### 4.4 Deliberately deferred

- **Coverage-aware suggestions** (quantity depends on chosen vendor's delivery day: CW arrives Tue, Dawn Fri — different gaps to cover). v1 shows the delivery day on the chip and leaves the judgment to the human; v2 can compute it. Not a rearchitecture — delivery days are already in the data.
- **Minimum helper** (v2): "Bakemark is $188 short — flexible items you could shift: flour +$95/bag, …". The data exists from day one; the feature waits until the basic loop is habitual.
- **Note on the day dimension:** all ordering currently happens Monday, so every plan row will initially say Mon and the weekday machinery runs at trivial capacity. It stays — it costs nothing, FMP history has day spreads, and a future per-location orderer might split cadences — but v1 UI should not make users think about days they never use (default everything to the location's ordering day).

### 4.5 Migration

Mechanical: vendor-item order days ∩ item order days → plan rows with the intersecting vendor item as default; per-day pars → converted to base units, most common value becomes the item default, differing days become row overrides; package contents derived from existing UnitSize/UnitMeasure/UnitAmount fields (needs a one-time audit — those fields look inconsistently filled). Screenshots confirm pars are stored as pack-format text today ("PAR 2 CS", "PAR 2X12/32OZ", "PAR 1X 25LBS") — the migration parses these into base units mechanically and flags unparseable ones for Mark's review.

### 4.6 Guide UX — grounded by screenshots (2026-07-19)

The screenshots settled how the guide should feel; the rewrite preserves the shape and deletes the friction:

- **Walk order is physical.** The guide is organized by **shop section** in walk order — "02 WALK IN – R1 S1", "31 STORAGE – R1 S1" (area / rack / shelf) — with inventory-item headers (name + par) and vendor items nested beneath. Shop sections become first-class ordered entities per location (today they're semi-structured labels). Section-level actions (zero out) and jump navigation (next section / next favorite) carry forward. An "Uncategorized" bucket catches unassigned items.
- **Line display**: vendor + brand, description, pack (24 × 1 ea), price, and **unit price** ($.03/oz) — the unit-price comparison across pack sizes is actively used and stays. Favorites get the highlighted quantity box (green accent today); favorites-only view is the default working mode.
- **The item card is the vendor switcher.** Tapping an item opens all its vendor items — including ones not on today's guide — with price/pack/unit-price and per-vendor steppers (the old SHOULD ORDER buttons). This maps 1:1 to §4.1's "reassign in the moment."
- **The startup ceremony is deleted.** Today: set day/location → "Clear?" dialog → record-by-record clearing spinner (1,589 records) → "Update?" dialog → record-by-record update spinner (710 records) — minutes of cache rebuild before ordering can begin. New app: pick location + day (defaulted), guide renders from a live query in under a second. No clear, no update, no dialogs. This is the flagship before/after of the whole rewrite.
- **Find/filter panel** (day, location, vendor, item type, item, shop section + quick filters full/favorites/skipped/will-order) becomes standard search + filter chips.

### 4.7a Item panels — grounded by screenshots (2026-07-19)

The inventory/vendor-item/OG-item cards revealed structure the DDR alone couldn't:

- **Par grid = default + overrides already.** The FMP par grid shows a DEFAULT column plus per-day columns, with only DEFAULT filled for most items — v0.5's default-plus-override model is a formalization of existing behavior, not a change. **Refinement: FIXED AMOUNT is per day** in FMP, so fixed-vs-par lives on the plan row (`item_order_days.par_mode`), not the item-location.
- **Package data is structured**: vendor items carry AMOUNT × SIZE + UNIT per PACKAGE (1 × 50 lbs per BAG) with computed unit price. `package_content` migration is mechanical; the audit narrows to missing/zero prices (e.g. "$0 per oz" rows) and oddballs.
- **Vendor-item order days are a per-vendor-item day set** (e.g. Bakemark flour: Mon/Fri/Sat/Sun) intersecting the item-location's day set — migration maps intersections to plan rows as designed (§4.5).
- **Active cascade, made visible.** FMP: a guide pairing is active only when vendor ∧ vendor item ∧ inventory item ∧ item-location are all active. The new guide view composes the same flags — plus an improvement FMP lacks: when an expected item is missing, the item page says *why* ("hidden: vendor inactive").
- **Par change log is used** (user-attributed from/to entries back to 2020) → v1 adds `par_history` (same trigger pattern as price_history); doubles as input for the future par-tuning report.
- **Item detail structure carries forward**: Info / Vendor Items / History / Log tabs map to the new item page on both surfaces — iPad card (read-mostly) and web page (full editing + bulk operations). The History tab (ordered vs. received per week, shorts visible) is exactly the data that becomes inline last-order context on guide lines.

### 4.8 Desktop findings (18 screenshots, 2026-07-20) — the web app's requirements source

The FMP desktop Purchasing module (Order Guide / Vendors / Vendor Items / Inventory / Purchase Orders / PO Items tabs) is the direct blueprint for the web app's screens. What it settled:

- **Favorites are per-location — confirmed.** The vendor-item detail carries a favorite-days row *per location* (DF01, DF02, "ADD LOCATIONS…"), exactly matching the plan-row model. **Resolved (2026-07-20): per-location pricing is real** — rare, but per-account pricing differing by location happens in foodservice (accounts already differ per location). Supported via a small `vendor_item_location_prices` override table; guide/PO price resolution = location override → global price. Migration populates it only where FMP per-location prices actually differ. `price_history` gains a nullable location scope.
- **PO numbering format:** `{vendorID}-{globalSeq}-{locNum}` (e.g. 135-18012-01) — a global sequence with vendor + location context, not per-vendor counters. New system: number format is an org-level setting, default matching this.
- **Batch PO operations are the Monday workflow.** Live data: 11 POs, $6,545.76, one session — driven from a PO list with multi-select checkboxes, batch preview/process, batch shopping list, delete-checked, and a totals row. The web PO list gets all of it.
- **PO detail mechanics to preserve:** ordered vs. received qty per line with dual totals; price reconciliation actions (reset all / reset current / revert / commit-received prices); processed + received flags; PO type inherited from vendor, overridable per PO; per-PO packing-list tab exists in FMP but is unused (already killed).
- **Vendors double as a general supplier directory** (Landlord, plumber, HVAC, linens, printers) with order days simply unchecked — keep the table inclusive; ordering-specific behavior keys off order_type/order days, not existence.
- **Vendor per-location config confirmed in full:** account, rep, phone/email, address, order days AND delivery days, active — per location. Vendor notes carry operational constraints ("1pm cutoff for next day delivery") → surface as a visible chip/warning during PO processing, not buried.
- **Shop sections are already a config table** on the location record: sort key (numeric, decimals like 09.5/13.1), area, sub-area, display name → imports directly into `shop_sections` (sort_order numeric).
- **Three-state quantity boxes on the guide:** green = qty entered, red = explicitly zeroed, white = untouched. "I decided no" vs "haven't looked yet" is real information during a walk — preserve in the new guide.
- **EVENT / Offsite Events is a pseudo-location** → locations support virtual locations (matters for the master schema; purchasing treats it as orderable-to context).
- **Inline-editable power lists** (vendors with order-day checkboxes in the grid; inventory list with par/day grids per row) — the web catalog should match this editing density, not dumb it down to click-into-detail-pages.
- Confirmed again for the risk file: SMTP password displayed in plain text on the location screen → email creds go to server secrets (§2).

### 4.9 The PO document (from sent PO 112-18008-01, 2026-07-20)

Template for the new PDF (edge-function generated, HTML→PDF, per-org branding from settings):

- **Header:** org brand block; "PURCHASE ORDER {number}" ({vendorID}-{seq}-{locNum}).
- **Meta:** date, vendor, account # (from vendor_locations), **delivery day** (explicit date), **ship-to = location address**, **bill-to = org-level billing entity** (Donut Friend, Inc., separate address — billing identity is org config, per §0 no-hardcoding).
- **Summary line:** "N PRODUCTS / M QUANTITY".
- **Lines, grouped by item category:** checkbox (pick-list affordance for the vendor/shopper), product ID, qty, unit, composed description (item // brand // pack // unit price), notes. Embedded ordering instructions from vendor-item notes print on the line ("only order when the container is 1/4 full") — preserved.
- **No extended prices or PO total on the vendor-facing document** (unit prices only) — intentional; keep. Internal PO preview and archive show full totals.

### 4.7 Purchase requests (added to v1 scope)

The Purchasing menu and the guide's "N REQUESTS" badge revealed purchase requisitions as an active part of the ordering workflow (previously unscoped — the table lives in DF-Locations). v1 includes: any staff member can submit a simple request ("we need X", optional note/photo); open requests badge on the order guide; the purchaser resolves each by converting it to a PO line (picking the vendor item) or dismissing with a reason; requester can see status. Maps to a `purchase_requests` table (location, requested_by, text, photo?, status, resolved_into_po_item?, resolved_by, timestamps).

## 5. Clean Schema v0.3

Every table below additionally carries `org_id` (§0) — omitted for readability.

```
orgs                id, name, settings jsonb            (one row for years: Donut Friend)
locations           id, name, addresses, open_days/hours, settings jsonb
                      -- settings: email CC, PO email template overrides, defaults
users / memberships user ↔ org, role; user ↔ location roles; last_active_location
vendors             id, name, order_type (email_po|online|in_person),
                    url, po_prefix, notes, is_active
vendor_locations    vendor_id, location_id, account_number, minimum_order,
                    sales_rep, rep_phone, rep_email, order_days[],
                    delivery_days[], is_active
vendor_items        id, vendor_id, inventory_item_id, brand, product_id,
                    description, package_desc, package_content   -- in the item's
                    base unit, e.g. 50 (lbs) — drives suggestion math (§4.1),
                    price, url, notes, is_active
vendor_item_location_prices  vendor_item_id, location_id, price   -- rare override (§4.8)
price_history       vendor_item_id, location_id?, old_price, new_price, source
                    (manual|receiving), changed_by, changed_at
inventory_items     id, name, category, base_unit (lbs|each|case|…),
                    note, assigned_to?, is_active
shop_sections       location_id, name (e.g. "Walk In"), rack, shelf, sort_order
item_locations      inventory_item_id, location_id, shop_section_id?, note, is_active,
                    default_vendor_item_id, default_par   -- par in base units
item_order_days     item_location_id, weekday,
                    vendor_item_id? (override), par_qty? (override, base units),
                    par_mode (par|fixed)  -- fixed is per-day in FMP (§4.7a)
                      -- row exists = ordered this day; the ordering plan (§4)
par_history         item_location_id, weekday?, old_par, new_par, changed_by,
                    changed_at   -- FMP's par log is actively used (§4.7a)
guide_entries       location_id, guide_date, vendor_item_id, on_hand?  -- base units,
                    qty_to_order  -- packages of the chosen vendor item,
                    entered_by, entered_at
                      -- the only persisted output of a guide session;
                      -- doubles as on-hand/usage history for free
purchase_orders     id, po_number  -- format {vendorID}-{seq}-{locNum}, org setting,
                    vendor_id, location_id,
                    status (draft|sent|received|closed), order_date,
                    delivery_date?, notes, sent_via, created_by, timestamps
po_items            po_id, vendor_item_id, qty_ordered, qty_received?,
                    unit_price, discrepancy_note?
po_attachments      po_id, storage_path, kind (invoice|packing_slip|other), added_by
reminders           location_id, show_on_date, vendor_id?, inventory_item_id?,
                    message, dismissed_at?, created_by
purchase_requests   location_id, requested_by, text, photo_path?,
                    status (open|ordered|dismissed), resolved_po_item_id?,
                    resolved_by?, dismiss_reason?, timestamps
```

No denormalized caches, no arrays-in-strings, no favorite flag (the plan row's vendor assignment *is* the favorite, §4). The order guide itself is a view over `item_order_days` (for the guide day) × item/vendor-item defaults × latest `guide_entries` × last `po_items` per item, with vendor_locations order-day constraints surfaced as warnings. `sent_via` records how the PO went out (email/site/shopping); email sending happens in an edge function with credentials in server secrets, using per-org/per-location templates from `settings`.

## 6. v1 Screen List

iPad/iPhone (floor tool): Order Guide (walk-order sections, reminders, requests badge, vendor totals bar), item card (Info / Vendor Items / History tabs; vendor switcher), PO draft review, PO processing (email/site/shopping modes), Receiving (with camera attach + price-update prompt), Purchase request submission (any staff), Vendor item quick-view/edit card.
Web (power tool — mirrors the FMP desktop Purchasing tabs, grounded by §4.8): Order Guide (full desktop version incl. three-state boxes + vendor totals bar), Vendors list with inline order-day editing + vendor detail (per-location config incl. delivery days), Vendor Items + Inventory catalog with inline-editable grids (pars/day per row, favorites per location), PO list with multi-select batch process/preview/shopping-list + totals row, PO detail (items, receiving, price reconciliation), Vendor catalog report, price/par history views, Reminders + requests management, "duplicate config to new location" admin action.

## 7. Next Steps

1. ~~Ordering-plan model~~ ✓ · ~~iPad + desktop screenshots~~ ✓ · ~~per-location pricing~~ ✓ · ~~sent PO PDF~~ ✓ — **spec is input-complete.**
2. On Mark's go: Postgres DDL + RLS policies (org- and location-scoped per §0) + the **web project skeleton** (per the locked build sequence — SwiftUI starts at sequence step 5).
3. Data migration dry run: Vendor, VendorItems, InventoryItem/Loc export from FMP → transform → load (incl. favorites→plan-rows, shop-section import, per-location price-override detection), to validate the mapping early. POs/POItems (121k rows) migrate as history.
