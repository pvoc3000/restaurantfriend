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
  `/cleanup` — and, since, most of the rest of the menu; the build sequence
  below is the authority on what exists. (Note: Next 16
  renamed the middleware convention — session refresh lives in `web/src/proxy.ts`.)
  **There are TWO route groups.** `(app)` carries the masthead, the nav, the
  page gutter and `InactiveLocationGate`. **`(fullscreen)`** (2026-08-28) is
  chrome-less and signed in — its layout calls `getAppSession()` itself and
  keeps only `ConfirmProvider` and `CalcPad` — for a surface that is a TASK
  rather than a screen: today just the shift report's runner. `proxy.ts` needs
  no entry for it, since anything not explicitly exempted there is auth-gated.
  It is NOT the place for a public page: `/login`, `/welcome`, `/q/[token]`,
  `/inquiry`, `/legal` and `/guides` sit outside both groups and are exempted by
  name. **`/guides` holds staff how-to guides, readable signed out** (Mark,
  2026-09-18) — static text like `/legal`, because the first guide explains how
  to get a login. Its labels are copied from the screens, so a relabelled button
  is also an edit to `app/guides/shift-report/page.tsx`; add a row to
  `app/guides/page.tsx` when a guide ships.
- **Migration** (`migration/`): FMP data is LOADED to the hosted DB — 80 vendors,
  790 items, 2,888 vendor items, 1,237 item-locations, full PO history. Loader
  is `migration/load.mjs` (service_role, local only). Transformed JSON lives
  OUTSIDE the repo (`../../FMP Export/transformed/`, has account numbers).
- **SwiftUI iPad/iPhone app**: phase 5, NOT yet. Do not create an Xcode project.

## Build sequence (locked — do not reorder)

1. ✅ Schema + RLS applied
2. ✅ Web skeleton: auth (email/password), org/location context, vendor list
3. ✅ FMP → Postgres migration + web catalog admin (inventory, vendors, vendor items) — `docs/history/03-catalog.md`
4. 🚧 Order guide, PO generation/processing/email, receiving screen, purchase requests — `docs/history/04-order-guide-and-pos.md`
4b. 🚧 Location module (`/locations`, shop sections, working location) — `docs/history/04b-locations.md`
4c. 🚧 HR + app access (employees, invites, /welcome, revoke) — `docs/history/04c-hr-access.md`
4d. 🚧 Timesheets / payroll prep (pay periods, overtime, breaks, tips, Gusto export, benefits, workday boundary) — `docs/history/04d-timesheets.md`
4d. 🚧 Bills (vendor bills, approval, financials lock, filing on close) — `docs/history/04d-invoices.md` (named Invoices until 2026-09-20; see Table naming)
4e. ✅ Employee events (`employee_events`, `/events`) — `docs/history/04e-employee-events.md`
4f. 🚧 Production (elements, recipes, items, price grid, plans, schedules, batch logs, costing) — `docs/history/04f-production.md`
4g. 🚧 Special orders (quotes, documents, /q approval, /inquiry, standing orders, scheduling, /pay link via Square, customer invoices — 124–128 applied, 129 written) — `docs/history/04g-special-orders.md`
4h. ✅ Supervisor shift report (runner, email, reopen) — `docs/history/04h-shift-report.md`
4i. ✅ Which shops a member may work at (migration 073) — `docs/history/04i-location-access.md`
4j. ✅ Password reset (migration 074 + `request-password-reset`) — `docs/history/04j-password-reset.md`
4k. 🚧 Facility checks (checklists, tasks, maintenance, inspections, documents, equipment) — `docs/history/04k-facility-checks.md`
4l. ✅ QuickBooks Online (bills, invoices, connection, credentials) — `docs/history/04l-quickbooks.md`
4m. ✅ Page permissions (`lib/pageAccess.ts`, migration 092) — `docs/history/04m-page-permissions.md`
4n. ✅ Tags (display signs priced at print time) — `docs/history/04n-tags.md`
4o. ✅ Shared iPad PIN switching (migration 097) — `docs/history/04o-shared-ipad.md`
4p. ✅ Tablet shell (bar, `/start` tiles, batch log on tablet) — `docs/history/04p-tablet-shell.md`
4q. ✅ Desk start page (`/start`) — `docs/history/04q-desk-start.md`
4r. 🚧 Square sales posted to QuickBooks (journal entries, deposits) — `docs/history/04r-square-sales-to-qbo.md`
5. SwiftUI floor app (only after 4 is proven in real use)

**Each module's full history — decisions, measurements, traps, probes and what was verified — lives in `docs/history/`**, moved out of this file verbatim on 2026-09-18 because it had grown to ~1M characters loaded into every session. **Read the module's history file before designing or changing anything in that module**, the same way the briefs in `docs/` are read. The catalog-cleanup notes and the per-migration ledger (001–019 and which are applied) are in `docs/history/migration-ledger.md`. **Record new module history in its `docs/history/` file, not here**; this file keeps only a one-line status per module.

## Non-negotiable design rules

1. **Multi-tenant-ready**: every table has `org_id`; all queries flow through
   RLS (org-scoped policies exist). Never bypass RLS from the web app; the
   `service_role` key is for local migration scripts only and must never appear
   in `web/` or in git.
   **EVERY INSERT MUST PASS `org_id` EXPLICITLY, and forgetting it does NOT say
   so** (Mark, 2026-08-05, on `pay_periods`). No table has a default or a
   trigger for it, and an insert policy is `with check (user_has_role(org_id,
   …))` — a WITH CHECK is evaluated BEFORE the NOT NULL constraint, so an
   omitted `org_id` arrives as null, `user_has_role(null, …)` is not true, and
   Postgres reports **"new row violates row-level security policy"**. The
   message names the policy, which sends you to look at roles and grants when
   the actual fault is a missing column. `NewPayPeriod` had shipped this way and
   nothing caught it, because all 177 existing periods came from the
   service_role loader, which bypasses RLS entirely — so the app's only path to
   creating one had never once been exercised. Swept 2026-08-05: every other
   insert in `web/src` passes it (two look like they don't and do — one via a
   spread, one via a copied-columns list). **A create that a loader also
   performs is a create nobody has tested.**
2. **Zero business hardcoding**: business names, billing entity, PO number
   format, email templates, terminology live in `orgs.settings` /
   `locations.settings` jsonb — never in code. (The old system hardcoded
   "The Donut Friend Team" into a script; we don't.)
3. **Location context**: the user is always "working at" one active location
   (persisted per user in `org_members.last_active_location_id`); every
   location-scoped screen filters by it; you switch by picking a row on
   `/locations`, or from the picker at the right of the masthead. TWO routes,
   deliberately (Mark, 2026-08-27): a header control was the ONLY route until
   2026-08-01, the list was the only one from then until 2026-08-27, and each
   was missing what the other has — the list is where you READ about a shop
   before acting on the row in front of you, the picker is for switching on the
   way to somewhere else, without leaving the screen you are on.
   The session carries TWO lists and picking the wrong one is a silent bug
   (2026-07-30): **`session.locations` is every location**, closed ones
   included — use it to LOOK UP a code by id, and a `vendor_locations` row at
   DF03 stops rendering an em dash. **`session.activeLocations` is the subset
   you ENUMERATE** — a row per location, a scope over locations (item detail's
   per-location rows, the vendor item's price rows, cleanup's all-locations
   mode), so three closed shops don't sprout dead rows everywhere. And
   `activeLocation` must resolve over the FULL list: resolving it over the
   active-only one falls through to the `?? …[0]` fallback and snaps a switch
   to DF04 silently back to DF01, which looks exactly like switching being
   broken.
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

**The long-form conventions — each rule with the incident and measurement behind it — are in `docs/conventions.md`.** Read the relevant entry before touching the area it names. Its headlines, in order:

- A CREATE DIALOG ASKS FOR THE FIELDS THE REST OF THE APP READS, AND STOPS
- A FIXED px WIDTH INSIDE A `DataTable` CELL WILL BE CLIPPED, AND SILENTLY
- `InlineValue`'s `className` REACHES ITS RESTING BUTTON ONLY, so a width passed to it does not survive the click
- `InlineValue`'s `scale` AND `format` ARE FUNCTIONS, SO A SERVER COMPONENT CANNOT PASS THEM — `tsc` cannot see it and the page fails at runtime
- A CELL IS THE SAME SIZE BEFORE AND AFTER YOU CLICK IT, IN BOTH DIRECTIONS — whatever the resting button wears, the Sizer wears
- EVERY LIST SCREEN'S HEADER IS `ui/PageHeading`. THIS IS THE DEFAULT — a new page uses it without being asked
- A NAV LABEL AND A PAGE TITLE NEED NOT MATCH
- A FIELD STARTS EMPTY. A PLACEHOLDER IS EITHER A FORMAT OR IT IS GONE
- THE SCREEN EXPLAINS ITSELF. STOP WRITING HINTS
- IT IS A PAY PERIOD, NEVER A "FORTNIGHT"
- The look is the `restaurantfriend-design` skill
- THE CLASSIC MAC LOOK IS APP-WIDE
- A DETAIL SCREEN'S EDITABLE FIELDS WEAR A BOX — read `docs/detail-field-styling-brief.md` before restyling one.
- USE LITERAL TYPOGRAPHIC CHARACTERS IN JSX TEXT, NEVER HTML ENTITIES
- A SHARED CLASS STRING STATES LAYOUT; EACH CALLER STATES ITS OWN COLOURS
- `flex-wrap` ONLY HELPS WHEN A CHILD CAN CLAIM THE NEXT LINE
- YELLOW IS A FILL, NEVER AN INK — do not use `text-mark` on a light background
- SUPERSEDED 2026-09-11 FOR ANYTHING WITH A BORDER
- A CONTROL YOU PRESS FILLS GREY ON HOVER — `hover:bg-neutral-100`
- EVERY BUTTON IS WHITE; only a SET FILTER is black
- The menu is two tiers, from FMP
- A days-old `next dev` will start reload-looping
- A FRESH `next dev` that reload-loops is a different bug: stale clients
- A reload loop tied to a specific ACTION is neither of the two bugs above
- The masthead publishes its MEASURED height as `--rf-header-h`
- An overlay INHERITS from wherever its trigger sits, and `position: fixed` doesn't save it.
- ENTER COMMITS A DIALOG THAT IS A FORM, and it is OPT-IN
- ESCAPE CLOSES ONLY THE TOPMOST THING
- A dialog pins its title bar and its footer, and scrolls only the middle
- RESIZING A COLUMN MOVES THAT COLUMN AND ONE OTHER, NEVER THE ROW
- A DataTable column holding a day picker must be `WEEKDAY_PICKER_WIDTH`
- Every slow route needs a `loading.tsx`
- POSTGREST RETURNS AT MOST 1,000 ROWS AND SAYS NOTHING ABOUT IT.
- Page speed: round trips and payload, in that order
- A client component that seeds `useState` from server data must be KEYED by that data's identity
- The Active toggle is the FIRST column
- EVERY date field shows a calendar picker
- A read-only value in a detail `dl` wears the editable one's padding.
- A known vocabulary is CHOSEN, never typed
- The "Sold as" vocabulary is the CONTAINER, never the size
- The unit menu offers PACKAGES as well as measurements
- Wide free-text fields are `components/ui/TextInput.tsx`, and they clear
- Every list uses `DataTable`
- A group band is BLACK with white text
- A column label WRAPS; it never truncates while there's room
- Column labels STICK, in every list
- A detail screen walks the found set
- Every multi-column table can hide columns
- Every multi-column table can also REORDER columns
- Every one-of-N choice is a `ui/TabPicker`
- A detail screen's section headings are `ui/SectionHeading`
- A filter's label sits ABOVE its TabPicker, not beside it
- The strip above a table carries that table's heading or filters
- A scrolling table pane ends where the WINDOW does, and the height is measured
- A pane is `overflow-x-hidden`, never `overflow-auto`
- THE WEEKDAY PAR HAS AN EDITOR AT LAST
- THE INVENTORY ITEM RECORD HAS THREE TABS — Info · Vendor Items · Purchase History
- THE VENDOR RECORD HAS FOUR TABS — Info · Items · Purchase Orders · Bills
- THE VENDOR RECORD CAN ACTIVATE AND DEACTIVATE AT LAST
- THE INVENTORY ITEM'S RECORD FOLLOWED IT (2026-09-12)
- Vendor detail has an editable field block
- A VENDOR'S NAME IS EDITABLE, AND SO IS ITS CONFIG AT A SHOP IT HAS NONE AT
- THE THREE PURCHASING LISTS FILTER BY VENDOR, AND SEVERAL AT ONCE
- View state in the URL, display preferences in localStorage.
- Scroll restoration is UNIVERSAL and nothing opts in
- Breadcrumbs follow the route taken
- Detail views are FULL-SCREEN PAGES
- A detail screen that outgrows one page becomes TABS, and the employee record is the pattern

- **USE THE PARTS THAT EXIST — don't hand-roll a second one.** Every shared control encodes a decision that was expensive to reach. **Read `docs/ui-parts.md` (the parts table: what to reach for instead of a raw `<input>`, `<select>`, `<table>`, panel or button) before building or changing any UI.** A new shared part goes in `components/ui/`, gets a row in that table, and a specimen on `/interface`.
- **Safari:** a table cell under `border-collapse` is NOT a containing block in
  WebKit — anchor absolutely-positioned children to an inner `<div>`. And see
  web/README.md on Safari caching a stale dev stylesheet.
- **The browser floor is Safari 16.4 / iOS 16.4** (established 2026-07-29, when
  Mark couldn't get past the login screen on an iPad Air 2). Not a policy — a
  measurement: the built stylesheet uses `@property` (46×, Safari 16.4+) and
  `color-mix()` (20×, Safari 16.2+), which is also Tailwind v4's own stated
  minimum. There is no `browserslist` override and no polyfill, and adding one
  would mean dropping to Tailwind v3 and unpicking the design-system port.
  **On iOS every browser is WebKit at the OS version**, so Chrome/Firefox/Edge
  are the same engine — a browser choice can never work around this, and neither
  can "request desktop site" (user-agent only). Alternative engines need iOS
  17.4+ in the EU and no major browser shipped one anyway.
  **The symptom is not a styling one, which is what makes it confusing:** below
  the floor React doesn't hydrate, so `login/page.tsx`'s `onSubmit` never
  attaches, the form does a NATIVE submit to its own URL, and the screen
  "refreshes with the credentials gone" — no error, because the code that would
  show one never ran. Tells: a trailing `?` on `/login`, and an unstyled login
  card. (Harmless at least: neither input has a `name`, so a native GET submits
  nothing and the password stays out of the URL and history.)
  Consequence for the roadmap: **an iPad Air 2 can't be the phase-4 ordering
  stopgap** (iOS 15.8.8 is its terminal version, A8X). Remote-desktopping into a
  Mac is the only thing that works on that hardware. Do NOT reach for a
  server-side rendering browser (Puffin et al) — it would bypass the engine
  limit by routing sign-in through a third party. Whether it can be a phase-5
  SwiftUI target is a separate question and UNVERIFIED: SwiftUI runs on iOS 15,
  but NavigationStack, Observation and SwiftData all need 16/17, so check real
  Xcode deployment-target minimums before counting it in or out.
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
  **Migration 110, 2026-09-20 — BILLS, NOT INVOICES** (Mark: "Bills are
  documents we have to pay. An invoice, by contrast, is a document our customers
  have to pay"), freeing the word for a future A/R feature on Special Orders.
  Old → new, for reading pre-110 docs and every file in `docs/history/`:
  `vendor_invoices` → `vendor_bills` · `vendor_invoice_lines` →
  `vendor_bill_lines` · `vendor_invoice_lines.invoice_id` → `bill_id` ·
  `purchase_order_attachments.invoice_id` → `bill_id` ·
  `location_tasks.vendor_invoice_id` → `vendor_bill_id` ·
  `set_vendor_invoice_approval(p_invoice)` → `set_vendor_bill_approval(p_bill)`
  · `record_accounting_push(p_invoice)` → `(p_bill)` · the three
  `*_vendor_invoice_*` lock/touch functions → `*_vendor_bill_*`. In the app:
  `/invoices` → `/bills`, `lib/invoices` → `lib/bills` (+ `billQueries`,
  `billFilters`, `billFromExtraction`), `Invoice*` components → `Bill*`,
  `BillInvoice` → `PushableBill`, and `invoice_id`/`invoice_ids` → `bill_id`/
  `bill_ids` on `qbo-sync`'s wire.
  **WHAT KEPT THE WORD, because it names the VENDOR'S PRINTED PAPER and not our
  record:** the columns `invoice_number` and `invoice_date`; all of
  `lib/invoiceExtraction` and `lib/invoiceMatch`; the edge function
  `extract-invoice`; the attachment kind value `'invoice'`; and the storage key
  segment `{org_id}/invoices/{id}/…`, which is a KEY every uploaded document was
  written under rather than a name (018 never reads that segment).
- Weekdays: ISO smallint, 1 = Monday … 7 = Sunday (all ordering currently
  happens Monday; don't foreground the day dimension in UI).
- Roles: owner / admin / purchaser / **supervisor** / staff (in
  `org_members.role`; supervisor added by 020). The ladder is Mark's mapping of
  FMP's 1–5 user levels — staff · supervisor · purchaser · manager · owner —
  with purchasing slotted between supervisor and manager.
  Staff can create purchase requests + guide entries; catalog/PO writes need
  purchaser+; HR and member management need admin+. **WHICH SCREENS A ROLE MAY
  OPEN, AND WHETHER A SCREEN OFFERS WRITES, IS `web/src/lib/pageAccess.ts`** —
  the Page Permissions sheet as code, read by the menu, the layout gate and
  every page's editable flag (build step 4m). Edit the cell, not the screen.
  **`admin` displays as "Manager"** and is NOT renamed in the DB — it's the
  value every policy names. Labels and the gate predicates live in
  `web/src/lib/roles.ts` (`ROLE_LABEL`, `canWriteCatalog`, `canManageMembers`,
  `canReadHr`); never re-inline `["owner","admin","purchaser"].includes(...)`,
  which was copy-pasted at ten sites before 020.
  **A supervisor is DB-equivalent to staff in v1**, deliberately: every policy
  is either membership-only (role-blind, so they inherit it — all reads, guide
  entries, purchase requests, `set_my_member_profile`) or names the purchaser+
  array explicitly (so they're excluded). Adding the role therefore edited NO
  existing policy. When shift reports and production schedules arrive, those
  tables' own policies name the role.
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
- **`npm run fixtures` is the test suite** (`web/scripts/fixtures/`, added
  2026-07-31). 1,916 cases over the pure modules — `lib/invoiceMatch` (the SKU
  join, its two relaxations, the description fallback, and the real Guittard
  pair that killed Jaccard) and `lib/receiving` (the two-stage price button, the
  never-overwrite fill rule, pack labels). Before this the repo had no runnable
  tests at all and the bills brief told you to "re-run the 23 fixtures", which
  had only ever existed in an ad-hoc esbuild slice.
  It adds **no dependency**: `tsc` (already installed) compiles the modules and
  the cases to CommonJS in `.fixtures-build/` and plain Node runs them. Node
  can't run the `.ts` directly because the source imports are extensionless.
  `.fixtures-build` is gitignored and eslint-ignored — lint objects to the
  `require()` in emitted CJS. Write assertions that FAIL when the code is wrong:
  the suite was checked by breaking `needsUpdate`'s epsilon and `fillable`'s
  never-overwrite guard and confirming three cases went red.
- Git: small commits, plain messages. Mark reviews on GitHub.

## Domain cheat-sheet (why screens look the way they do)

- The order guide walks the physical shop: grouped by `shop_sections`
  (sort_order, e.g. "Storage - R1 S1" — maintained at `/shop-sections`,
  per location), item headers show par, vendor items
  nested with pack + unit price ($/oz comparison matters — pack sizes differ).
  **The names used to carry FileMaker's leading number** ("31 Storage - R1 S1")
  and no longer do (Mark, 2026-08-02, `migration/strip-section-prefix.mjs`):
  the number duplicated `sort_order`, which is what the walk actually orders
  by, so it had to be kept in step by hand and lied the moment a shelf moved.
  125 renamed across DF01 and DF02.
  It also surfaced four DUPLICATE shelves the prefix had been hiding — the
  same place entered twice, once numbered and once not, with items split across
  both. Three at DF02 were merged into the copy holding the real walk position
  (`Mop Room` 50, `Kitchen` 60, `Office` 80, 12 item-locations moved); Mark
  deleted DF01's himself. **`display_name` is unique per location AND is the
  key the guide groups by**, so any future bulk edit of these names has to
  check for collisions BEFORE writing — a half-applied rename is worse than
  none, which is why that script refuses the whole run rather than stopping
  partway.
- Favorites = plan rows (`order_guide_plan_days`): the preferred source per
  weekday, **♥-marked** on the guide, overridable in the moment. The heart and
  the **★** beside a line's description are a PAIR and mean opposite halves of
  one question (Mark, 2026-08-10): ♥ is the source you INTEND to buy, ★ is the
  one you actually DID buy last (migration 048). They routinely disagree — on
  DF01's Monday, Coke, Mexican carries two hearts and the star sits on the
  dearer of them — which is the whole reason both are shown. BOTH ARE BLACK
  (Mark, 2026-08-10, in two steps — the heart, then the star), which is the
  design system applying rather than being bent: colour means record STATE and
  neither of these is a state, so they are told apart by SHAPE. Both glyphs
  carry U+FE0E so Apple platforms can't render them as colour emoji — a red
  heart would put colour on a row that has deliberately given it up. The star is absent
  rather than transparent on lines that aren't it, unlike the heart: most lines
  never carry one, and a reserved slot would cost description width to say
  nothing. NO star anywhere under an item does not mean "never bought" — the
  last purchase may have been from a source that isn't orderable today, so
  isn't on screen to mark; the header's date is the authority.
  Since 008 a favorite is one of
  four should-order conditions, not guide membership. The real vendor decision
  is basket-level: a **vendor
  totals bar** shows each vendor's running subtotal vs its minimum
  (`vendor_locations.minimum_order`); an under-minimum vendor simply gets no PO
  that week (flour is deliberately "ballast" to hit Bakemark's $900 minimum).
- PO processing by vendor `order_type`: email_po → PDF emailed (edge function,
  later), online → open vendor URL, in_person → shopping list sorted by shop
  section. PO PDF spec: docs/purchasing-spec.md §4.9 — the vendor-facing
  document carries **NO PRICES AT ALL** (Mark, 2026-07-28: not unit prices, not
  extended prices, not a total) and its Pack column prints the package TYPE the
  vendor sells in — "CS", "EA" — from `vendor_items.package_desc`, falling back
  to the line snapshot only when that snapshot is a bare type (FMP history) and
  not migration 013's composed "12 × 32 oz" — that composed pack tails the
  description instead. Each line reads
  **`<vendor description or, failing that, our item name> // <brand> // <pack>`**
  (Mark, 2026-07-28): the VENDOR's own description leads, because they fill the
  order off their product list and our catalog name isn't on it. The per-line
  ordering note is the
  LINE's own `notes` (migration 015), not a live read of `vendor_items.notes`.
  **Within a group the lines are alphabetical by that leading description**
  (Mark, 2026-08-03) — `compareDocumentLines` in `lib/purchaseOrders`, numeric
  aware and empty-last like `lib/tableSort`, so the whole app orders text one
  way. It sorts by the VENDOR's wording, never our catalog name, or the page
  would be ordered by words that aren't printed on it. Before this the
  within-group order was whatever PostgREST returned: nothing in the query asks
  for an order, so it looked deliberate without being reproducible. It lives in
  `groupBy`, which both documents share, because one of them sorted and the
  other not is the drift this file keeps warning about.
  The in_person **shopping list is internal** and keeps its prices, its
  estimated total, and the composed pack.
- Receiving: per-line qty_received, invoice photo → Storage, and a one-tap
  "invoice price differs → update catalog?" flow.
- Vendors include non-food suppliers (landlord, plumber) — `order_type: none`.

## Open threads (pinned by Mark — don't act without asking)

- **CUSTOMER INVOICES (A/R) ON SPECIAL ORDERS — explored 2026-09-20, NOTHING
  BUILT, don't start without asking.** This is what migration 110's rename
  freed the word for. Mark: "Bills are documents we have to pay. An invoice, by
  contrast, is a document our customers have to pay."
  **The case is WHOLESALE, not proper special orders.** Those get billed once
  and paid in full and have never been a problem. Cafe Knotted is billed WEEKLY
  IN ADVANCE — one invoice per week, a line for each day's donuts and a line
  for each day's delivery, 14 lines, **sent Sunday and due Thursday or service
  stops**. Mark wants to select the week's seven standing orders and have them
  become one invoice. So the shape is SEVEN ORDERS BILLED ONCE, which no view
  over `special_orders` can express. Deposits on far-out bookings ("take a
  deposit to hold the date") are the other direction — one order billed twice.
  **THE MODEL IS ALREADY DESIGNED, on the A/P side.** 025 put the PO join on the
  LINE and said why: "split and merge need no schema at all — one invoice across
  two orders is lines pointing at two orders, and one order invoiced in two
  parts is two invoices whose lines point at disjoint subsets (hence NO unique
  constraint)". That paragraph describes Knotted's week and Mark's deposit,
  written before either was asked for. Mirror it: `customer_invoices` +
  `customer_invoice_lines` carrying `special_order_id` + `special_order_line_id`
  on the LINE, with its own issue date, due date and terms (a deposit is months
  from `date_initiated`, which the push currently uses as `TxnDate`).
  **TWO HALVES OF THIS ARE ALREADY BUILT AND WERE NEVER JOINED.**
  `ignore_balance` (45 orders) means "billed weekly by statement, not per
  order", and `invoicePushRefusals` REFUSES to push such an order on its own —
  the app already knows these must be billed together and has no way to do it.
  `CustomerStatement` (decision 21) renders exactly that week and calls itself
  "the dry run for the QBO era"; it stores nothing and can't be pushed. The
  invoice record is the join between them.
  **IT COLLIDES WITH THE STAGE MODEL.** `special_orders.status = 'invoice'`,
  `invoice_sent_at` and `invoice_paid_at` make an invoice a STAGE OF THE ORDER;
  once one invoice covers seven, those three become DERIVED from the records.
  **OPEN QUESTIONS, in the order they block things:** is Cafe Knotted taxable
  at all (a resale certificate makes every line NON and the QBO tax split stops
  mattering); does a pushed invoice carry FOURTEEN lines or the two summary
  lines `buildInvoicePayload` sends today. ~~WHERE A CUSTOMER PAYMENT GETS
  RECORDED~~ — answered 2026-09-22, below.
  **COLLECTION IS DECIDED (Mark, 2026-09-22): SQUARE COLLECTS, ON OUR OWN PAGE.**
  (1) **Square is the processor for everything that is not a shop sale** —
  special orders now, wholesale later. It is dearer than QuickBooks Payments
  and it wins anyway: customers can pay with Square GIFT CARDS and earn LOYALTY
  points, it is one merchant account, and the API rates (card 2.9% + 30¢, ACH
  1% with a $1 minimum and a **$5 cap**) undercut Square Invoices' own (3.3% +
  30¢). The $5 cap is what makes it right for wholesale-sized bills.
  (2) **OUR invoices, paid on OUR page (`/pay/[token]`) through Square's Web
  Payments SDK** — Square's own card/gift-card/wallet fields embedded in our
  page. It has to be one or the other: Square's Invoices docs say "You cannot
  use Square APIs such as PayOrder or CreatePayment to process a payment for an
  order that is associated with an invoice", so a Square invoice can only be
  paid on Square's hosted page. We build the invoice, so the page is ours.
  (3) **THE MONEY LANDS AT THE SHOP THAT MAKES THE ORDER** (Mark, same day,
  after 119 was applied: "I don't want to create an 'Orders' location. I think
  sales should stay with the location that makes the donuts"). Migration 120:
  the order's KITCHEN's `square_location_id`, then its pickup shop's, else no
  online payment. ~~A dedicated Square location for invoiced sales that the
  sync never reads~~ was the first plan and is withdrawn — so a pay-link payment
  IS in that shop's Square sales, `sync-square-sales` reads it and the nightly
  journal entry posts it, exactly where a hand-sent Square invoice's payment
  lands today. A large special order now shows in its kitchen's day, on purpose.
  Splitting special orders onto QBO and wholesale onto Square was considered and
  rejected: both are invoiced, both have due dates and deposits, and one
  customer buying both would meet two pay pages from one bakery.
  (4) **Double-counting is set aside, not solved** — Mark: "we'll make sure that
  doesn't happen". Since (3), the nightly journal entry ALREADY books a
  pay-link payment as that shop's sales, so the "Square invoice → DO NOT PUSH"
  rule under "What NOT to build" applies to pay-link orders too: pushing one to
  QBO as an invoice books its revenue twice.
  Phase 1 is a pay link on today's per-order invoice (balance due; card, Apple
  Pay, Google Pay, gift card); ACH + webhook, loyalty, the QBO Payment push and
  `customer_invoices` follow. Plan: `docs/history/04g-special-orders.md`.
  **`customer_invoices` IS BUILT (2026-09-23, migrations 124 + 125 applied,
  functions deployed).** The open questions
  above are answered: Knotted is NOT taxable (resale certificate; their orders
  already carry `tax_rate = 0`), and an invoice carries ONE LINE PER ORDER
  (Mark), delivery inside each order's amount — so not fourteen lines and not
  the QBO push's two. The stage collision is settled by WRITING THROUGH: the
  order keeps `status` / `invoice_sent_at` / `invoice_paid_at`, and the invoice
  stamps them (sent) and settles each order its payment covers, through
  `settle_special_order_paid` — the same function the per-order link uses.
  Mark's direction for what comes next: regular special orders move onto this
  record too, "so we have one workflow for everything" — a one-order invoice
  is one line, and nothing in 124 assumes a week. Don't build that move
  without asking.
  Read `docs/history/04g-special-orders.md` and `docs/bill-rename-sweep.md` first.


- **A PAY-LINK REFUND BOOKS TO THE WRONG ACCOUNTS — LEFT AS IS FOR NOW (Mark,
  2026-09-22: "3 for now, but make a note that this is something we should
  figure out down the line. maybe there's another payment solution that would
  work better").** The Refund… command (`square-refund`) works, but Square's
  API can only refund BY AMOUNT — "the Refunds API doesn't support itemized
  refunds", itemized returns are dashboard/app only (Square staff, forums
  2024-02 and 2025-01). A refund by amount is a CUSTOM_AMOUNT return on
  UNCATEGORIZED, tax included, so the nightly journal entry reverses a
  Special Orders + sales tax + delivery sale into Uncategorized Income:
  balanced, wrong accounts, tax never reversed. Refunds are rare, so for now
  whoever does the books reclassifies by hand. **Options when this comes
  back:** (1) the 4r journal-entry builder spots a refund whose id is on a
  `Square Refund` payment row and splits it by the pay token's `breakdown`,
  mirroring the sale — the in-app fix, no new vendor; (2) refund in Square's
  dashboard, choosing the items, and record the negative payment by hand;
  (3) a different processor whose API refunds line items — which reopens the
  2026-09-22 Square decision (gift cards, loyalty, one merchant account) and
  should be weighed against those, not just this. See
  `docs/history/04g-special-orders.md`.

- **`InlineValue`'s OPEN EDITOR CARRIES NO `aria-label`, where its resting
  button does** (found 2026-09-03 while testing the checklist template's unit
  cell). **Half done 2026-09-23:** the single-line text/number editor now
  carries it, because `ui/CalcPad`'s title bar reads it; the other editing
  branches (multiline etc.) still don't. A screen reader names the field until you click it and then loses the
  name at the moment you are typing into it — every inline cell in the app, not
  one screen. One prop threaded through the editing branch; not done, because it
  is a pass of its own and nobody asked for it.

- **FOUR SCREENS STILL HAVE NO CREATE COMMAND, and only one is a gap.** Scanned
  2026-09-03 after Mark asked. `/events` is created from the employee record —
  an event is about a PERSON, and a dialog here would have to ask which one
  first. `/prices` is a matrix whose cells are `set`, not rows to create.
  `/order-guide`, `/purchase-orders`, `/cleanup` and `/production-day` are all
  DERIVED and a create button would be wrong on each. `/benefits` has one and it
  IS in the filter row — that list has no search and no tabs, so its command's
  own strip above the table is that row.
  **`/sales` IS THE ONE SCREEN LEFT PUTTING A COMMAND IN THE HEADER**, and
  `Sync from Square` is not a create — it is an import, so whether the filter-row
  rule applies to it is a question rather than an oversight. It and
  `PayrollBenefitsList` are the last two `action` props; once `/sales` is
  settled, `PageHeading.action` has no callers and should be deleted rather than
  left as a second sanctioned place to put a button.

- **Does an overnight baker belong in the tip pool, and what happens to a
  straddling shop-day?** Raised 2026-08-22 by 061 and NOT answered. All eleven
  people with a workday boundary have `excludes_tips = false`, which is the
  DEFAULT rather than a decision anyone made. Since 061 a shift can have its
  `workday` in one pay period and its `business_date` in the previous one, so its
  shop-day pool is visible from two worksheets. `/timesheets` widens the
  `tip_pools` fetch by ONE DAY to stop that pool reading as missing — provably
  enough, since 061's noon floor means the workday moves forward by at most one
  — but whether the same pool could then be allocated twice depends on whether
  these people share in tips at all. Settle the `excludes_tips` question first;
  the allocation question may not exist.

- **The 101 evening starts are the whole problem, and moving them would delete
  the feature.** 1,148 of the kitchen crew's 1,490 shifts already begin
  00:00–03:59, which never collides with anything; only the 44 starts at
  18:00–20:59 and 57 at 21:00–23:59 create the stacking that 061 exists for.
  Nobody has asked whether those evening starts are deliberate (volume, a
  wholesale order) or drift. If they could move to 00:0x there would be no
  boundary, no per-employee field and no review queue. An operations question,
  not a software one — worth asking before building anything further here.

- **Weekday FAVORITES may belong on the vendor items table, not behind a
  location row** (Mark, 2026-08-04, on item detail: "seems to me that setting
  the daily favorites should be done in the vendor item section… part of me
  feels like it's weird to be able to edit DF01 settings when we're working in
  DF02"). Reconsider; don't build it unasked.
  Where it sits today and why: a favorite is `order_guide_plan_days`, keyed
  `item_location_id` + `weekday` + `vendor_item_id`, so it is a fact about a
  vendor item **at a location**. Per-location config has one row per location
  and therefore knows which `item_location_id` to write; the Vendor items
  section below is ORG-level (its Price cell writes `vendor_items.price`, the
  base, not the override), so it has no location in hand. That is the whole
  reason the grid is behind the location row's disclosure.
  What we concluded: the two halves of Mark's proposal are SEPARABLE. Moving
  favorites down needs only *a* location, and the WORKING one is a fine choice
  — a column labelled "Favorite days at DF01" is unambiguous and costs nothing
  above it. It's arguably the better shape, too: a favorite is a cell in a grid
  of vendor items × weekdays, and it currently hangs off the other axis.
  Scoping the WHOLE screen to one location is the expensive half and probably
  wrong: it loses shops side by side, and it loses **Stock here**, which is the
  only way to add an item to a shop that doesn't carry it — you cannot act on a
  location you can't see. It also cuts against the pattern Mark already settled
  on 2026-08-01, where `/locations` edits any location's record from anywhere:
  RECORD screens aren't bound to the working location, OPERATIONAL ones (guide,
  POs, cleanup) are. Design rule 3 names "item detail's per-location rows" as
  the example of enumerating over locations.
  The better framing of the discomfort: it isn't that you can see DF01 from
  DF02 — it's that **a favorite is an operational setting living on a record
  screen**, which is why it feels like it should follow you while the par beside
  it doesn't.
  Wrinkle to design for either way: a favorites column would make a vendor item
  row where most cells write org-wide and one writes only for your shop. That
  has to be visible in the table, or it becomes the next "I edited this and it
  only changed here".
- ~~**Per-location app access is deferred.**~~ **RESOLVED 2026-08-29 —
  built (migration 073).** It came back, the "may work at" vs "may see"
  question this note said to ask was asked, and Mark chose **may work at**.
  See build step 4i for what that means and what it deliberately does not do.
  **The half that is still open is "MAY SEE"**, and it is a much larger
  decision rather than a follow-up: it would mean every location-scoped policy
  in the schema, and rethinking `/special-orders`, `/customers`, `/employees`,
  `/events` and `/sales`, which all treat location as a FILTER rather than a
  scope on purpose. `location_members` is the table it would read. Don't build
  it speculatively; ask what problem it is solving first, because "a supervisor
  should not read another shop's numbers at all" is a claim about people rather
  than about software.
- **`REQUIRED_ONBOARDING_KINDS` now matches FMP's own value list**
  (`web/src/lib/employeeDocuments.ts`) — Application, W-4, I-9, I-9 documents,
  food handler card, handbook, **Orientation**, notice to employee, with the
  meal-break waiver deliberately optional (a separate FMP field, 51 of 445
  signed). Read off the real data rather than the layout, which is how the
  Orientation/Training-Acknowledgement mix-up surfaced. Still worth Mark's
  confirmation before anyone treats "Paperwork complete" as a compliance
  statement. A constant rather than `orgs.settings` on purpose: this is federal
  and California employment paperwork, not org configuration. If a second org
  ever needs a different set, that's the moment it moves — and design rule 2
  will be why.
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
- **Duplicate/delete INVENTORY items — built 2026-09-04**
  (`catalog/InventoryItemActions.tsx`, a ⋯ at the end of every `/items` row,
  purchaser+). **Duplicate copies EVERYTHING** (Mark's word): the master, every
  per-location row (section, par, per-weekday pars, order days, note), every
  vendor item pointing at it with its per-location price overrides, and the
  favorites re-pointed at the COPIED vendor items — so the copy is orderable on
  day one. Named "… copy" (`duplicateTitle`) and the screen lands on it.
  Client-side, parent-first; vendor items inserted ONE AT A TIME so old→new is
  certain. Verified against the live DB by script: 2 location rows
  byte-identical, 11 of 11 favorites, counts restored after cleanup.
  **Delete counts first**: item-locations cascade (taking favorites and guide
  counts), reminders cascade, and `vendor_items` / production elements /
  purchase requests are `set null` — the vendor items survive UNLINKED and off
  every guide, which the dialog says. Stocked anywhere → Deactivate is the
  default. Every write `.select()`s its row count.
- ~~**Delete/duplicate vendor items.**~~ **RESOLVED 2026-07-31 — built**
  (`catalog/VendorItemActions.tsx`, on `VendorItemsTable` and the vendor-item
  screen, purchaser+). A `⋯` menu as agreed, not a right-click — no touch
  equivalent, and iPad Safari is the ordering stopgap.
  **Duplicate** copies every field except `id`, the timestamps and `legacy_id`
  (the FileMaker row's identity; two rows claiming it would corrupt any future
  reconciliation against the export), and deliberately carries over **neither
  favorites nor per-location price overrides** — a duplicate is a new SKU, the
  pack-size-variant case it exists for, not a second favorite.
  **Delete counts the damage first** and reports it: `price_history`,
  `vendor_item_location_prices`, `order_guide_entries` and — since 008 —
  `order_guide_plan_days` all CASCADE, so a delete silently takes the price audit
  trail, the overrides and **the favorites** with it; `purchase_order_items` is
  `on delete set null`, so history survives but loses the anchor "last ordered"
  and price reconciliation need. Anything ever ordered defaults to
  **Deactivate**, with Delete still reachable beside the real counts. It's a
  `ui/Dialog`, not `window.confirm`, precisely because it needs three answers.

CLOSED 2026-08-04, all three by Mark ("these are all fine") — kept as answers,
not as questions:
- **Should-order counts.** The brief's figures (Mon 229 / Wed 118 at DF01) never
  reproduced; the model over live data gives Mon 394 / Wed 222. The MODEL is
  right and the brief's totals were wrong. Judge the guide by the per-vendor
  breakdown against the real Monday POs.
- **`rep_email` carrying `info@donutfriend.com`** on Restaurant Depot's rows is
  not a mis-mapping to chase.
- **"Last ordered" on the vendor screen** means "this item, at this location,
  from any vendor" — the Inventory semantics — and that is the intended reading.
  It does NOT need a per-vendor-item view.

## What NOT to build (deliberately killed or deferred)

Killed: location transfers/packing lists, PO_Type taxonomy, most legacy
reports, standalone inventory-count UI. **`/cleanup` was REMOVED 2026-09-05**
(Mark: "you can remove the Cleanup page") — the route, `CleanupQueue`,
`FixDrawer` and `lib/cleanup.ts` are gone; `FavoritesEditor` moved to
`components/catalog/` because the item record's per-location rows use it. The
catalog notes above that mention the cleanup queue are history. Deferred to v2+: order suggestions,
minimum helper, spend dashboard, collaborative ordering, offline.
~~Invoice OCR~~ **built 2026-07-31** — it moved out of v2 because attachments
made it a small feature rather than a project: the invoice was already in the
system, the PO line already snapshotted the vendor's SKU to join on, and the
price-reconciliation band was already the place an answer could land. See build
step 4.
~~**CHECKLISTS are deferred**~~ **BUILT 2026-08-29/30** — migrations 075–078,
see build step 4k, `docs/checklists-brief.md` for the decisions and
`docs/checklists-handoff.md` for what is still outstanding. They came back a day
after being scoped out, as one module with tasks, maintenance requests,
inspections and a new equipment register, and moved from Operations to the
LOCATION section. The shift report gained its page and NO flag:
`task_checklist_done` still does not exist, because with checklists as rows the
question it would answer is observable from a linked run.
**A flagged issue now reaches the emailed shift report** (2026-08-30), which is
the requirement the module was asked for. See the handoff for what remains.
**QUICKBOOKS PAYMENTS is killed, and the reasoning matters more than the
verdict** (2026-09-02): it would mean a second merchant account beside Square,
it fights the document flow this app deliberately owns, and it would make
QuickBooks a second writer of a fact `special_order_payments` already holds.
The live question underneath it is **ACH on wholesale**, and that belongs with
Square — **DECIDED 2026-09-22: Square collects everything not rung up in a shop,
on the app's own `/pay` page** (see the customer-invoices thread). Also killed: any **A/R status pull** from QuickBooks, for the same
second-source reason — where the A/P pull is right, because nothing here stores
a vendor payment. See build step 4l.
**QBO A/R INVOICING IS PROVISIONAL** — it comes out if special-order collection
moves to a channel that books the revenue in QBO itself, at which point pushing
an Invoice here would double-count it.
**THE 2026-09-02 READING OF THIS WAS WRONG IN ITS REASONING AND RIGHT IN ITS
VERDICT, corrected by Mark 2026-09-20.** It said "special orders are not
invoiced through Square yet". They ARE: retail special orders are sent as
SQUARE invoices, the customer pays online or in the shop, and the payment is
noted by hand in FMP. What keeps it from double-counting is not that Square is
unused — it is that **THE QBO INVOICE PUSH ITSELF IS UNUSED** ("the
functionality to send invoices to QBO is in place but we aren't using it yet").
So the guard is a habit, not a mechanism, and the first person to press Send to
QuickBooks on a Square-collected order books that revenue twice.
**THE RULE THIS IMPLIES: WHETHER THE APP PUSHES DEPENDS ON WHO COLLECTS**, and
that belongs on the CUSTOMER, not in a comment. Bill.com (which **pulls from
QBO as well as pushing to it** — Mark tested this 2026-09-20, so app → QBO →
Bill.com works and `push_invoice` is already the mechanism) → the app's push
books the revenue, so PUSH. Square invoice → Square's nightly sync books it, so
DO NOT PUSH. Collected directly by cheque or cash → PUSH. `ignore_balance` is
the nearest thing to that field today and it only says "by statement".
**Since 2026-09-22 the pay link collects through Square too** (migrations 119,
120), into the Square location of the shop that makes the order — so the nightly
sync books it exactly as it books a hand-sent Square invoice, and the rule above
holds for it: DO NOT PUSH a pay-link order to QBO as an invoice.
**TWO THINGS TO KNOW BEFORE SENDING FROM ANYWHERE BUT THIS APP:**
`buildInvoicePayload` sends TWO SUMMARY LINES (a tax split, because QBO computes
the tax and delivery is not taxed), not the itemisation a wholesale customer
checks against their deliveries; and the customer's sheet is attached with
`IncludeOnSend: false`, so an invoice emailed by QuickBooks or Bill.com arrives
with no detail at all.
**KILLING BILL.COM IS STILL ON THE TABLE (Mark, 2026-09-20)** and splits in two.
The A/P half needs NO app work — bills already reach QBO with their coding and
their scan, and where they are PAID from (QBO Bill Pay, the bank) is a
QuickBooks-side choice; `proposeBillLink`/`find_bills` retires itself the day
Bill.com stops creating bills, as its own comment says. The A/R half needs a rail
that collects ACH from wholesale, which is the pinned "ACH on wholesale belongs
with Square" question above — now answered: Square, on the app's pay page
(2026-09-22), so Bill.com is no longer needed to COLLECT. **The trade-off nobody has priced:** billing a week
in advance through QBO/Bill.com puts the receivable ON the books from Sunday and
gives QBO A/R aging; collecting through Square books a SALE when they pay, so
nothing is on the books Sunday to Wednesday and "who owes us" lives only here.
That is a question for whoever does the books, not a software one.
Removal of the push is still about an hour and touches nothing A/P uses — but
only until `customer_invoices` exists, after which it is a module.
When in doubt whether a feature belongs, check the spec's kill list or ask Mark.
