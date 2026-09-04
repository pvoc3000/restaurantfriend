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
  It is NOT the place for a public page: `/login`, `/welcome`, `/q/[token]` and
  `/inquiry` sit outside both groups and are exempted by name.
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
   The status chips carry two ROLL-UPS beside the five raw statuses: `all`, and
   **`open` — everything not yet closed** (Mark, 2026-08-03), which is the list
   you work from. Open reads as NOT INERT rather than as "not closed"
   (`isPoOpen`): a void order hasn't been closed either and is emphatically not
   outstanding work, which is where `canClose` already draws the line. Both
   roll-ups are shown ALWAYS, where an empty raw status is dropped from the row
   — "Draft 0" says only that nothing is in that state right now, while
   "Open 0" says nothing is outstanding, which is the answer you came for.
   Shipped: `/purchase-orders` list (location-scoped, date window, status chips,
   totals, selection) and PO detail (ordered-vs-received with dual totals,
   inline receiving, price reconciliation → catalog).
   Shipped 2026-07-23: **PO generation** — migration 013's
   `create_purchase_orders_from_guide(location, guide_date, vendor_ids[])`
   creates one draft PO per selected vendor from that date's qty>0 guide
   entries in ONE transaction (snapshot description/brand/pack/price; price =
   location override → catalog; pack label composed via `trim_scale` from 010's
   structure; zeroed/untouched entries excluded; vendors with no lines skipped
   without burning a sequence number). SECURITY INVOKER on purpose — inserts
   flow through the purchaser+ RLS policies. UI: "Generate POs…" on the guide's
   totals bar (purchaser+ only) → confirm dialog; vendors at/above minimum
   preselected, under-minimum unchecked-but-checkable (§4.2), FMP's "<7 days
   since last PO" guard is a warning chip and a same-day PO defaults the vendor
   unchecked (re-run guard). Fixture-tested in the Docker harness (numbering,
   snapshots, override price, zeroed-skip, fractional pack_count, empty-day
   no-op).
   Shipped 2026-07-23: **PO processing** (spec §2 step 4), no edge function —
   Mark chose generate-PDF-then-open-mail-draft over automated sending. PDFs
   render CLIENT-side with @react-pdf/renderer, dynamically imported at click.
   `lib/poProcessing.ts` (client-safe): `fetchPoDocData` assembles document
   data for 1..n POs in four bulk queries (org billing/settings, POs + vendor +
   location address, lines + category/instructions, shop sections — NB
   `shop_sections.display_name`, there is no `name` column); mailto builder
   with subject/body templates from `orgs.settings.po_email.subject/body`
   (generic fallbacks in code, placeholders like {po_number} {rep_first}
   {account_line}); `nextDeliveryDate` suggests the vendor's next delivery day.
   `pdf/PoPdfDocs.tsx`: `PoPdf` = §4.9 vendor-facing doc (category-grouped,
   checkbox/product/qty/pack/composed description, account #, ship-to from
   `locations.address.shipping`, NO totals — intentional) and
   `ShoppingListPdf` = in_person mode by shop section (internal: prices +
   estimated total). Multi-PO = one file, a page run per PO. `ProcessPo.tsx`
   card on PO detail (purchaser+): per-order_type actions (email_po → PDF
   download + mailto draft, the human attaches + edits; online → open vendor
   URL; in_person → shopping list), delivery-date input with suggestion chip,
   "Mark as sent" (status + sent_via per SENT_VIA_FOR_ORDER_TYPE). PO list
   selection bar: batch PO PDFs / shopping lists / mark-sent (drafts only) /
   mark-received / DELETE (confirm names non-drafts — sent/received POs are
   order history and feed "last ordered"); PO detail lines get a purchaser+
   selection column with the same confirm-gated delete (received quantities
   named).
   **THE PO LIST'S ROWS HAVE THEIR OWN ⋯ MENU** (Mark, 2026-08-31) — Preview
   purchase order · Download purchase order · Delete purchase order. All three
   existed only on the SELECTION BAR, so acting on one order meant ticking it,
   reading a bar written for a batch, and remembering to untick. `renderPoPdf`
   and `deleteOrders` are ONE implementation behind both doors, taking the ids
   as a parameter — which matters most for the confirm and for the popup rule,
   both of which are the kind of thing remembered in one copy and forgotten in
   the other. **`openWindowNow` is still inside the click gesture from a
   RowMenu**, because `MenuButton` closes synchronously; a window opened after
   an await is silently blocked. The single-order confirm NAMES the order
   ("Delete purchase order 132-181227-01 and its lines?"), since from a row menu
   "1 purchase order" is a worse answer to "which one?" than the number on the
   row you just pressed.
   **The delete now `.select()`s its own result** — the batch one never did, so
   below purchaser+ it removed zero rows, returned NO error and reported a
   cheerful success (the employee-delete lesson, latent here since the bar
   shipped). Both doors now say how many were actually deleted.
   **THE COLUMN WAS PAID FOR, AND EVERY PIXEL OF IT WAS MEASURED.** Widths are
   WEIGHTS, so what a column resolves to depends on the table's total: at 1280 —
   the tight case, since `compactBelow` has not fired — `TasksScreen`'s weight of
   50 came out a 42px cell holding a 36px button. The total stays at the 1338 the
   storageKey note tuned this table to, which is what keeps every untouched
   column at exactly the pixels it had. **The factor is 0.874 px per weight**, and
   guessing it wrong is what made the first two passes clip; the third measured
   it off a column that had not moved. Slack came from Lines and Files (whose own
   LABEL is the binding constraint, so their spare is structural rather than a
   fact about today's data), the two money columns, Sent via, and Vendor — whose
   cells are proper nouns where an ellipsis is idiomatic. NOTHING came from
   Status, which had zero spare ("RECEIVED" fills its chip exactly), or from the
   two DATE columns, which had 2px each and are what you read this list for.
   Verified at 1440 (nothing clipped), 1280 (only the longest vendor name
   truncates, by 15px) and 1100 (compact, ten columns, nothing clipped, no page
   overflow) — and the baseline was measured first, so every clip found was
   known to be one this change had caused.
   **Harness note that cost two passes**: after `resize_window` the table
   re-renders but the compact tier does not re-evaluate until a reload, so a
   post-resize reading shows the OLD column set. And a hidden pane reports every
   rect as 0 — check `innerWidth !== 0` before believing any geometry.
   **THE RECEIVING SCREEN'S READER'S NOTES ARE A DISCLOSURE, NOT AN OVERLAY**
   (Mark, 2026-08-31: "a lot of noise… for the most part it's unnecessary, but
   it's still there if we need it", offering either a pop-up or a caret and
   asking which is better). Measured on the live database: **39 of 40 stored
   extractions carry notes**, and they run to five lines — so on nearly every
   invoice a full-width yellow block sat between the summary and the split row.
   The caret wins for a reason particular to THIS screen: an overlay would cover
   the invoice AND the lines, which are the two documents you are standing there
   comparing, and it would have to be dismissed before you could go back to
   counting. It also costs nothing to expand, because the split row MEASURES
   whatever sits above it and a ResizeObserver keeps that honest as bands come
   and go — the invoice band growing with the reader's notes is the case that
   measurement is named for. The trigger's WORDS are quiet, reading like the
   small-caps labels beside them rather than wearing the yellow: the fill means
   "worth your eye", and on a note that is usually a rate-per-case caveat that
   is a claim it cannot keep. The CONTENT keeps the fill, because opened, it is.
   **Its caret is ▶ (U+25B6) at 18px, and the GLYPH is doing most of that work
   rather than the font size** (Mark, 2026-08-31, in two passes: "too small…
   make it 3 or 4 times larger", then "too big… split the difference").
   Measured as INK rather than em box, which is the whole point: ▸ (U+25B8) at
   the label's own 12px paints **4×5 PIXELS**, so scaling THAT character to a
   readable mark would have needed a ~60px font — a line box several times the
   height of the band it sits in. ▶ paints **12×11 at 18px**, the midpoint
   between 5px of ink and the 17px that read as too big, and it costs the button
   ONE pixel over the original 17. The size it was always going to be is the one
   where the character is the right character. It is also the order guide's own
   disclosure triangle, so the app has one shape for this.
   **Reach for the bigger GLYPH before the bigger size** — for box-drawing
   characters the em box and the ink are only loosely related, so measure what
   is painted (draw it to a canvas and find the alpha bounds) rather than
   trusting `font-size`. Collapsed per
   mount, deliberately — it resets when a different document is read, and a
   remembered preference for something opened once a month is machinery nobody
   asked for. Measured at a 720px viewport: collapsed the page is one viewport
   (31px of residue), expanded it scrolls 133px because the split row hits its
   documented 280px floor.
   **Mark received writes QUANTITIES, not just the status** (2026-07-28): the
   list's Received column flags any received PO whose total falls short of what
   was ordered, so a status-only "received" would paint every order red for a
   shortfall that never happened. It fills only lines with NO received quantity
   — a short case someone recorded on the detail screen is a measurement, and a
   batch button must not overwrite it (PO detail's "Receive all as ordered"
   deliberately DOES overwrite; it's aimed at one order you're looking at).
   Eligible = draft or sent: a phone order never passes through "sent", while
   closed and void are inert states you'd have to leave deliberately.
   **Popup gotcha:** a window.open after `await` is silently blocked — open the
   window synchronously in the click handler (`openWindowNow`), navigate it to
   the blob later (`showBlob`, download fallback).
   2026-07-23 (Mark, after seeing the share-sheet caveats: "roll our own
   in-app solution"): email POs now use an **in-app compose card** on the
   Process card — to/cc/subject/body prefilled from the templates, editable in
   place, Send posts them + the client-rendered PDF (base64) to the
   **`send-po-email` edge function** (`supabase/functions/send-po-email/`),
   which sends through a **generalized provider layer** (Mark, 2026-07-24:
   "every org, or even every location, should have its own way to send") and
   stamps status/sent_via/sent_notes (`emailed to … · resend <id>`).
   Transport resolves three-tier (Mark, 2026-07-24, after reconsidering:
   "sending emails is something the app provides", the Bill.com model):
   `locations.settings.email_provider` → `orgs.settings.email_provider` →
   **the app's own default sender**. Explicit config =
   `{kind: "gmail"|"resend", secret_ref, from, reply_to?}` with credentials in
   edge-function secrets `EMAIL_CREDS_<secret_ref>` (JSON per provider —
   NEVER in the DB, settings are member-readable). The app default is ONE
   self-contained secret `EMAIL_CREDS_DEFAULT`
   (`{"kind":"resend","api_key","from":"{org} <po@domain>"}`) — `{org}`
   becomes the org name and Reply-To derives from the org's own addresses
   (po_email.reply_to → cc → billing.email) so vendor replies reach the org.
   Donut Friend uses an **org-level `gmail` override** (Mark, 2026-07-24 —
   Resend + InMotion DNS abandoned mid-setup, InMotion issues): Gmail API over
   HTTPS, OAuth refresh token, sent POs land in info@'s Sent folder. The app
   default (`EMAIL_CREDS_DEFAULT`, Resend) remains the platform story for
   future orgs. The MIME builder
   (multipart/mixed, folded base64, chunked RFC 2047 subjects) is
   fixture-tested in Node via an esbuild slice — PDF round-trips
   byte-for-byte. The function authenticates with the CALLER's JWT so all its
   queries and the status write flow through RLS, plus an explicit purchaser+
   check for a readable error. **LIVE and smoke-tested 2026-07-24**: function
   deployed, Gmail OAuth done (Google Cloud project 765339329273 — the Gmail
   API had to be enabled in THAT project, the error names the fix), org
   config set, self-addressed send verified end-to-end (`emailed to
   mark@donutfriend.com … · gmail 19f9…` in sent_notes). Setup guide:
   docs/po-email-setup.md. The compose is a floating modal (Generate-POs overlay
   pattern) with a live preview: the PDF renders ONCE at open, shows in an
   `<object type="application/pdf">` pane (text fallback for browsers without
   an inline viewer — the Claude browser pane is one), and Send transmits that
   exact blob. "Use Mail app" in the compose card is the escape hatch and
   carries the EDITED fields: Web Share sheet where supported (`sharePdf` —
   puts the PDF inside Mail's composer; needs a secure context, so plain http
   over LAN to an iPad does NOT get it), else download + mailto draft (mailto
   can never attach, RFC 6068). Verified by rendering Mark's
   two real 2026-07-23 drafts through the actual components in Node (esbuild
   bundle, read-only service_role fetch) and inspecting the PDFs.
   NOT built: automated email sending (edge function — revisit if the manual
   draft flow gets old).
   Shipped 2026-07-25: the **design system port** (see Conventions) — a restyle
   only, no query/route/state/copy changes, EXCEPT one new behaviour it needed:
   **Zero section**, a button inside each shop-section band that marks that
   section's still-untouched **should-order** lines explicitly zero in one
   upsert (Mark, 2026-07-25 — FMP's semantics). Entered quantities are never
   overwritten; lines that weren't that day's work are left untouched. Also new:
   `components/ui/ActionBar.tsx` (black bottom bar, on `/order-guide` carrying
   Generate POs) and `components/ui/Checkbox.tsx`.
   Shipped 2026-07-26: **per-item disclosure on the guide** — FMP's per-item
   "other sources" popup, done inline. A large bare triangle on each item
   header: collapsed the item shows what the filter shows, expanded it also
   shows that item's other sources orderable today (`isDayRelevant` = vendor
   order day ∧ item order day, i.e. the `All` tier). Costs no query — the page
   already loads every orderable line for the weekday and filters in the
   browser. The triangle **LEADS the item name** (Mark, 2026-08-10), reversing
   his own 2026-07-26 call that it should TRAIL it because "the name is what you
   scan for down the walk, so nothing sits to its left". What changed is that
   the triangle became a column in its own right — every header carries one,
   live or greyed — so trailing put it at a ragged left edge that moved with the
   length of every item name. Leading, the triangles line up and the names still
   start on one margin. It is offered
   **only under Favorites, with Ignore-days OFF**: All already shows every
   day-relevant source, Skipped is a burn-down of what you haven't looked at,
   under Will order you're reviewing decisions rather than shopping for
   alternatives, and with the day gates lifted the expansion's own definition is
   void (the switch is already its global form). Outside Favorites the header
   shows NO triangle, not even the greyed one — the grey asserts "no other
   source today", which only Favorites is positioned to claim. Keyed per (group,
   item), so in Vendor grouping a block opens onto **that vendor's** other pack
   sizes only.
   Expansion never sticks — dropped on any filter/grouping/ignore-days change
   and on reload — and deliberately ignores the search box. Items with nothing
   to reveal show a greyed inert triangle (Mark, 2026-07-26) so the column stays
   unbroken; measured 189 live / 71 inert of 260 item headers on a Saturday at
   DF01, and 56 of 351 blocks in Vendor grouping.
   Its safety net lives in `matchesGuideFilter`: **both day filters also show
   any line carrying a quantity** (Mark's "temporary favorite"), because a
   quantity counts toward the vendor totals bar and becomes a PO line, so it
   must never be hidden by a day filter. That closed a hole predating this
   feature — enter a qty under All, switch to Favorites, watch a live order line
   vanish — which per-item disclosure would otherwise have made routine. Zeroed
   lines don't qualify (an explicit no produces nothing); Skipped is unaffected,
   being untouched-only. The search box still narrows everything, expansions
   included.
   **THE LAST-PURCHASE LABEL IS A NARROW BLOCK, NOT A LONG LINE** (Mark,
   2026-08-31: it "takes up too much space and causes the inventory item to get
   truncated… especially on tablets"). It shipped as one `truncate` line beside
   the name, which meant its width was set by THE LONGEST VENDOR DESCRIPTION IN
   THE CATALOG — arbitrary text nobody chose — and it won. Measured at 820, the
   portrait iPad this is walked on: the label took ~420px of a 768px row and the
   item name, the thing you scan for down the walk, read "COCOA POWDER, DUT…".
   **THE NAME NOW TAKES WHAT IT NEEDS AND THE LABEL TAKES THE REST** (Mark's
   second pass, same day: "make the inventory item as wide as it needs to be,
   whatever that is, and use the remaining space on that line"). The name group
   is `shrink-0` at its natural width, the label is `flex-1`, and the 12rem cap
   that stood here in between is GONE — it was only ever a way of bounding the
   label without knowing what the name wanted. `line-clamp-3` stays as the
   wrap-don't-truncate rule.
   Measured over all 261 item headers: **0 names clipped at any width**, and
   with the row's full leftover the label needs only ONE line on 261 of 261 at
   1280 and 1440, 226 of 261 at 820, 220 at 768 — so **every row is back to its
   original 38px** (one three-line straggler at 768).
   **`max-w-[75%]` on the name group is a safety valve, not a working limit** —
   the widest name group is 430px, which is 57% of the row at 768, the narrowest
   width this is really used at. It cannot bite until about a 550px window, and
   what it prevents is a pathologically long name pushing the label to nothing
   and the par off the screen; the link keeps `truncate` as that failure, which
   is the old behaviour and a graceful one.
   **`items-end` LEVELS BOXES, NOT TEXT — the label carries
   `relative bottom-[2.75px]`** (Mark, 2026-08-31: "the bottoms… don't appear to
   be aligned"). A line box holds descender space below its baseline in
   proportion to its font size, so at 22px against 11px the two BASELINES sat
   2.75px apart while their BOXES were level to half a pixel — which is why the
   earlier "261 of 261 bottoms level" passed and the screen still looked wrong.
   That check measured `getBoundingClientRect().bottom`; **measure the baseline
   instead, by appending a zero-sized `inline-block` and reading its bottom.**
   Both line-heights are 1.25, so the space below each baseline is proportional
   to the font size and the gap is exactly `(22 − 11) × 0.25`. Re-measure it if
   either size or either line-height moves.
   A RELATIVE OFFSET, not a margin: a margin is layout, so on the rows where the
   block wraps it made the row 2px taller for a purely optical correction.
   Verified 0.00px on all 261 headers at 768, 820 and 1280, with every row at
   its original 38px. `align-self: last baseline` is what this means and is not
   used — at the Safari 16.4 floor its fallback and its baseline-group semantics
   beside an `items-end` sibling cannot be verified from here.
   **MEASURE A TITLE AS RENDERED, never with a probe span carrying only `font`.**
   The name is `tracking-[0.06em]` and the `font` shorthand does NOT include
   letter-spacing, so a probe reported 309px for a name that really occupies
   390 — which is how the cap first got set to 60% with a three-point margin
   against the real widest name.
   **THE ROW IS `items-end` NOW, NOT `items-baseline`**, which is the half worth
   understanding. Baseline is right while every child is one line and wrong the
   moment one is a paragraph: a flex item's baseline is its FIRST line, so the
   label pinned its top to the title and hung the rest below — which is the
   opposite of the "bottom aligned" Mark asked for. On the bottom edge the block
   grows UPWARD and its last line stays beside the name; verified 261 of 261
   bottoms level to within 1px at every width. `align-self: last baseline` says
   this exactly and is not safe at the Safari 16.4 floor.
   Known cost, and it is small: a two-line label fits the existing 38px header
   row, so **164 of 261 rows cost nothing**; the 97 three-line ones grow to 51px.
   Shipped 2026-07-26: **Clear guide** — an ActionBar command (left of Generate
   POs, never the primary cell) that resets the whole day at this location to
   untouched: quantities entered, quantities explicitly zeroed, AND on-hand
   counts (Mark, 2026-07-26 — a full reset of the walk, not just the order
   column). Any member may run it; that's what the RLS update policy allows and
   whoever can walk the guide can restart it. `window.confirm`, matching the PO
   batch-delete pattern, naming what's being discarded and its dollar value.
   **It is an UPDATE to nulls, not a DELETE** — `order_guide_entries` has
   select/insert/update policies and NO delete policy (001), so a delete from
   the app would match zero rows and cheerfully report success. Nulling is
   equivalent anyway: every reader treats a (null, null) row exactly as an
   absent one. Scoped by location + guide_date rather than by the loaded rows,
   so it also clears entries against vendor items that have since stopped being
   orderable and so aren't on screen. Verified end-to-end at DF02 with DF01's
   rows left intact.
   Shipped 2026-07-27: the **PO detail line table fits the screen** (Mark — "a
   lot of the info runs off"). Columns are now Type · Product ID · Item, where
   Type is `inventory_items.category` (short, repeats down the order, and is
   what the vendor PDF groups by) and Item is one WRAPPING cell carrying the
   catalog name over `brand · vendor description` — two columns' information in
   one column's width. Type wraps too, and Pack took 40px from Note so
   multi-packs stop reading "1 × 5 l…". Total 1410 → 1290px, which fits a 1440
   window without horizontal scroll. Widths key bumped to v2 (v1's are wrong
   now).
   Shipped 2026-07-27 (first real use of the guide, Mark's notes): the **order
   column is the row's LAST cell** — pack label, −, box, + against the right
   edge, with the line total moved inboard, because the stepper is the only
   thing on a line you touch and a thumb lives at the right edge; and the
   **masthead was made to collapse** (since removed — see Conventions).
   Shipped 2026-07-28: **a PO is a working document, not a frozen record.**
   Three changes, all Mark's.
   (a) **Add item** on the line bar (`AddPoLines.tsx`, purchaser+) opens a panel
   of every ACTIVE vendor item for that PO's vendor — search box, an order
   amount and an "Add to PO" button per row — and STAYS OPEN after each add,
   because adding four things is the shape of the task. Lines snapshot the
   catalog exactly the way migration 013 does (composed pack label, price =
   location override → `vendor_items.price`) so an added line is
   indistinguishable from a generated one. An item already on the order RAISES
   ITS EXISTING LINE rather than creating a second line of the same SKU; each
   row shows what's already on order so the arithmetic is visible.
   (b) **Every field on the order is inline-editable** ("I should be able to
   edit the information in a purchase order, especially before it's sent. At the
   very least the item amount") — ordered qty, unit price, product ID, pack, the
   brand/description snapshot, received qty, note, and the order/delivery dates.
   Read-only still: the catalog item's NAME (edit it on the item), the line
   total (derived), and the ≠ price-reconciliation action, which writes the
   other way onto `vendor_items`. NOT gated on status — you can already delete a
   line off a received order — but gated on purchaser+, which is what the RLS
   policy allows; below that every cell renders as plain text instead of
   offering a write the DB would reject. `InlineValue` gained `kind="date"` and
   `nullable={false}` (a NOT NULL column asks for a value instead of bouncing a
   Postgres constraint back at you).
   (c) **The vendor PDF carries no money at all** and its Pack column prints the
   package TYPE ("CS", "EA") rather than 013's composed structure — see the
   PoPdf note under §4.9 below. Prices baked into FMP's description text are
   deliberately NOT stripped (Mark: "ignore historical purchase orders… just
   change the behavior going forward"); nor are the 28 active vendor items whose
   NOTES carry a price, since 24 of those are real quantity-break instructions
   ("$8.25 ea in lots of 48") that belong on the order.
   (d) **The line's printed note is now the LINE's** (migration 015, needs
   applying): snapshotted at generation and editable in a new "Note" column on
   PO detail, with the old discrepancy column relabelled **"Receiving"** so the
   two are told apart — Note goes to the vendor, Receiving never leaves the
   building. Every other column gave up a few pixels to pay for it, so the table
   is still 1290px; widths key bumped to v3.
   (e) **A generated PO knows its delivery date** (migration 016) — the
   vendor's next delivery day after the order date, from
   `vendor_locations.delivery_days`, so the PDF's Delivery block is filled in
   without anyone remembering. The Process card's date input stays for the
   exceptions.
   Shipped 2026-07-31 (**needs migration 018**): **receiving gets the invoice**,
   which finishes step 4's last named piece. A **Paperwork card** on PO detail
   (`PoAttachments.tsx`, `lib/attachments.ts`) takes photos and PDFs into the
   private `po-attachments` bucket — kind chosen with `PickList`, thumbnails for
   images, PDFs as document rows. Signed URLs are minted **server-side** in one
   `createSignedUrls` batch (one round trip instead of one per card, and a URL
   built to expire doesn't outlive the page). The two write orders are opposite
   on purpose: **upload = Storage then row** (a row pointing at nothing renders
   broken), **delete = row then object** (an orphan object is invisible and
   harmless). The file input carries **no `capture` attribute** — `capture` forces
   the camera, and without it iOS offers Photo Library / Take Photo / Choose File
   in one sheet, which is what you want when the invoice is sometimes a
   photograph and sometimes a PDF the vendor emailed. The PO list gained a
   narrow **Files** count: on a Friday the only question it answers is which
   delivery still has nothing filed.
   Also shipped: **closing an order means something** (`closeReadiness` in
   `lib/purchaseOrders.ts`). `closed` existed in 001, sorted and badged, and
   nothing ever routed you to it. It now means "received, reconciled and filed",
   with a Close order button on detail (status received or sent) and a batch
   Close on the list (received only — a draft hasn't arrived). The confirm NAMES
   what's unresolved — unreceived lines, prices still differing, no paperwork —
   and then **lets you through anyway**, deliberately: gate closing on a complete
   set and the order whose invoice never comes is stuck in `received` forever,
   which is how a status stops meaning anything.
   And **reminders** (`lib/reminders.ts`, `Reminders.tsx`) — spec §2 step 1, the
   other 001 table that had never had a writer. Due ones band the top of the
   guide (`show_on_date <= guideDate`, not `=`, so a day you skip doesn't lose
   one) and are written from the guide or from a vendor via the same dialog.
   **The band renders OUTSIDE the collapsing shelf** and that placement is the
   whole design: everything in the shelf is something you set before you start
   walking, so it hides with the masthead — but walking with the chrome collapsed
   is the normal way to walk, and a reminder you only see when you're not working
   is no reminder. Dismissing is an UPDATE, so it's purchaser+ like every other
   write on that table; staff see reminders and can't clear them.
   Shipped 2026-07-31 (**needs migration 019 + an edge-function secret**):
   **the invoice gets READ** — spec §3's invoice OCR, which was deferred to v2+
   until attachments made it buildable. "Read invoice" on the Paperwork card
   calls the **`extract-invoice` edge function**
   (`supabase/functions/extract-invoice/`), which downloads the object through
   the CALLER's JWT (so 018's storage policy decides), hands it to Claude as a
   vision/document input with a **json_schema `output_config`** so the answer
   arrives as a guaranteed shape rather than coaxed-out prose, and writes the
   result onto `purchase_order_attachments.extraction` (019). One secret:
   `ANTHROPIC_API_KEY`. Model `claude-opus-5` at `effort: "medium"` —
   transcription, not deduction. Two API details are load-bearing: thinking is
   ON by default on that model, so **`content[0]` is a thinking block, not the
   answer** (find the text block); and `stop_reason: "refusal"` returns HTTP
   200, so it's checked before the content is read.
   **The extraction is a PROPOSAL and nothing in it ever writes itself.** It
   feeds **reconcile mode** on the PO line table — a view toggle, so it sits
   with the table rather than the command bar — which swaps Type and Note for
   **Invoice qty** and **Invoice price** (1290px either way; the columns are
   paid for, not added). A value that agrees is quiet text; one that disagrees
   is a button carrying the same `≠` the price-reconciliation band uses, and
   tapping it is what writes. `lib/invoiceMatch.ts` pairs the two sides:
   **`product_id` is the join key** — distributor invoices print the supplier's
   SKU and 013 snapshots that same value onto the line, which is what makes
   this a join rather than a research problem. Formatting differences (case,
   dashes, leading zeros) are normalised away; a SKU that appears twice on
   either side is **left unmatched rather than paired arbitrarily**, and
   description similarity (marked `≈` in the UI) is a fallback only for lines
   with no printed SKU. That similarity is **containment of the shorter
   description, not Jaccard** (fixed 2026-07-31 against Mark's real DF01 data,
   which the tidy fixtures had missed): an invoice prints "CHOC GUITTARD 66%
   ORGANIC 25 LB" while our line carries FileMaker's boilerplate —
   "CHOC-GUITTARD 66% ORGANIC 25 LB // Guittard // CS (1*25lbs) // $.98 per oz
   //" — and every extra token is one the invoice can't match, so Jaccard
   scored an identical pair 0.55 and refused it. Containment answers 1.0. Its
   own failure mode (a short description being a subset of an unrelated longer
   one — "Milk" inside "Milk Chocolate Bar") is closed by **also requiring three
   shared words**, which is the same condition that keeps "Bananas, Ripe" away
   from "Bananas, Fresh". Fixture-tested in Node via an esbuild slice, 23 cases,
   most of them the negative ones.
   The one bulk action is **Receive n from invoice**, which fills `qty_received`
   on matched lines that have NONE — never overwriting a counted quantity, the
   same rule the PO list's batch mark-received follows. Prices stay per-line:
   a quantity is a receiving fact, a price is money.
   Consequence for uploads: the attach control now names
   `image/jpeg,image/png,image/webp,application/pdf` instead of `image/*`,
   because a photo picked from an iPhone's library arrives as **HEIC**, which
   the model API won't take — naming formats makes iOS transcode on the way
   out, so the failure happens at pick time rather than at extraction time with
   the invoice already filed.
   **Reconcile mode is superseded before it was ever used in anger** (Mark,
   2026-07-31, after running the whole flow against a real Chefs' Warehouse
   invoice: *"As it stands, I would never use this feature."*). The ENGINE held
   up — 19/19 lines joined on `product_id`, and the `extended ÷ qty` price
   derivation survived catch-weight lines — but reconciliation was built as a
   MODE on the PO detail table instead of a surface of its own, on the reasoning
   that a second surface would mean a second place to edit a PO line. That
   reasoning is about WRITE PATHS and was wrongly applied to a VIEW: receiving
   against an invoice is a distinct task with a distinct posture (standing at a
   delivery, holding paper, comparing two documents), and a dedicated screen can
   write through the same code. The consequences were a seven-step flow, two
   different places to change a price, a mode you can't tell you're in, and no
   way to see the invoice while receiving it.
   Shipped 2026-07-31, specced in **`docs/receiving-screen-brief.md`**: the
   **receiving screen**, `/purchase-orders/[id]/receive`. Reconcile mode, the
   price-differs band, `InvoiceCell`, `InvoiceReconcile` and "Receive all as
   ordered" are DELETED; PO detail keeps its inline cells for desk corrections
   and gains a "Receive…" link. `lib/nav.ts` needed no change — `resolveRoute`
   prefix-matches.
   **Layout: document LEFT, lines RIGHT, draggable divider** (Mark supplied
   Bill.com's bill-entry screen as a layout reference). Side by side, ONE height
   governs the row so the two columns end level, and the lines pane scrolls its
   own rows under a fixed header (`min-h-0 flex-1 overflow-y-auto` — without the
   `min-h-0` a flex child takes its content height and overflows instead of
   scrolling). Consequence: that scroll is NOT covered by the universal
   `ScrollMemory`, which watches the window; it resets on a round trip, which is
   fine while receiving is a single-screen task.
   **That height is MEASURED, never a CSS constant.** `100vh - header - <guess>`
   ran the columns off the bottom of the window (Mark, 2026-07-31), because what
   sits above the row varies — the invoice band grows with the reader's notes
   and the billed-but-not-ordered list, and the progress and undo bands come and
   go. A `useLayoutEffect` measures the row's own top AND whatever follows it
   (hard-coding the container's `pb-22` still left ~56px scrolling, because the
   app layout's `py-8` sits under that too) and writes `style.height` straight
   to the node — no state, so a resize doesn't re-render nineteen rows and the
   `set-state-in-effect` lint has nothing to object to. A `ResizeObserver` on
   the body keeps it honest as bands appear; a >1px guard stops it observing its
   own write. Split mode also drops `pb-22` to `pb-8`, since a page that doesn't
   scroll needs no clearance to scroll past the bar — that padding was 90px of
   dead air. Measured: columns equal, 36px above the bar, page exactly one
   viewport tall. Below a usable minimum (280px) it stops shrinking and lets the
   page scroll instead.
   Below `xl` it STACKS
   rather than offering a Lines/Invoice toggle — nothing hidden, no mode to be
   lost in — and an empty document pane sizes to its own sentence instead of
   reserving 70vh of nothing to scroll past on an iPad. `Auto` / `Side by side`
   / `Stacked` and the split fraction persist in localStorage
   (`lib/receivingLayout.ts`, the `columnWidths` idiom); the
   control sits with the view, never in the ActionBar.
   **Both columns are `ui/Pane`** (2026-07-31, after Mark: "the header areas of
   the two columns are different heights… the lines around each column look like
   different thickness"). They were two hand-rolled frames and they drifted, the
   `ui/Dialog` story again. Measured with an invoice open: the document band
   WRAPPED to a second row (filename + Open + kind + Attach + Remove) at 79px
   against the lines band's 53px, so the two rules that should read as one line
   across the screen sat 26px apart. The band is now fixed-height and never
   wraps — the filename truncates, which also stops the controls jumping when
   you open a different file. Two consequences worth knowing:
   the `<object>` carried `min-h-64`, which on a short pane was 2px MORE than the
   flex row had to give, so the PDF plugin painted over the pane's own bottom
   border (this is why it only ever looked wrong with a document open) — no
   min-height now, plus `overflow-hidden` on the frame; and a band that can't
   wrap has a much wider MIN-CONTENT, which outranks `flex-basis`, so the
   document column silently took 58% of a 50% split until its wrapper got
   `min-w-0` (the lines side always had it).
   **Rows are work units, not a `DataTable`** (Mark's call — eight columns of
   live controls at half width would scroll sideways): identity (name, SKU ·
   brand · description, the `≈` and `?` markers with their original tooltips),
   quantities (Ordered · Invoice tap-to-take chips + the guide's three-state
   box with 44px steppers), then money and the receiving note.
   **The per-row Invoice chip is NOT gated on `LineMatch.qtyDiffers`** — that
   flag compares against `qty_received` and so is false on every untouched line,
   which was the mechanical cause of "what did reading the invoice actually
   buy?". `qtyDiffers` now only COLOURS the row.
   **The two-stage price button carries no staging state** — `priceAction` in
   `lib/receiving.ts` derives it: invoice ≠ order → "Update PO"; else catalog ≠
   order → "Update vendor"; else nothing. Taking stage 1 makes stage 2 appear by
   itself, and with no invoice read stage 2 alone does the deleted band's job.
   Two corrections it forced: it needs its OWN comparator (`needsUpdate` — a
   null target is a difference, which `invoiceExtraction.priceDiffers` says
   false to, and that's exactly the line that most needs the button) and it
   writes **`vendor_item_location_prices` when this location has an override**
   (design rule 6 — the old `adoptPrice` wrote `vendor_items.price`
   unconditionally, which at an override location succeeds, reports success and
   changes nothing). That table is keyed `(vendor_item_id, location_id)` with no
   surrogate id.
   **`closeReadiness` must ask EXACTLY what the button asks — and that is two
   halves, not one.** It first moved only to the same epsilon, which shipped a
   bug Mark hit immediately on BakeMark 112-181120-01: Finalize warned that a
   price differed from the catalog while no row offered any button to settle it.
   Cause — the caramel icing has a **DF01 override of $92.80 that matches the
   line**, while `vendor_items.price` still says $68.80, and `closeReadiness`
   was comparing against the base catalog price rather than the one in force
   (design rule 6). A confirm that names something the screen gives you no way
   to fix teaches you to stop reading confirms. `effectiveCatalogPrice` now
   lives in **`lib/purchaseOrders`** — not `lib/receiving`, which would be a
   circular import — and both callers use it; `closeReadiness` takes a
   `locationId`. Pinned in both directions by fixtures: a matching override
   reports nothing, a disagreeing one still reports, and an override at another
   location doesn't speak for this one.
   **The `≈` and `?` markers are YELLOW and carry words** (Mark, 2026-07-31 —
   he read two red `≈` beside the price warning as part of it). Red means
   something is WRONG; these mean "worth your eye", which is the mark colour
   everywhere else. They also say what they mean — `≈ matched by description`,
   `? invoice math` — because a bare glyph explains itself only on hover and the
   iPad has none. The `?` moved from beside the item NAME to beside the PRICE it
   is actually about, and shows with or without a button.
   **Nothing is prefilled** (Mark, 2026-07-31, rejecting a proposed prefill):
   each quantity carries a **→ button** that pushes it into the received box.
   An arrow is an unmistakable action where an underlined number was only a
   hint, the numbers stay readable while you compare three columns, and a box
   that fills itself would make merely OPENING an order look like someone had
   checked the delivery — which is what the PO list's Received column exists to
   tell you. The label is **"Invoiced"**, to rhyme with "Ordered".
   **The receiving price is TYPED, not only accepted** (Mark, 2026-07-31: "you
   should be able to manually edit the price in the invoice receiving panel").
   The two buttons only ever offered the two prices the app already knew, and a
   delivery produces plenty it doesn't — a catch-weight line the reader got wrong
   (the `?` sits beside that very number), a credit agreed at the door, a line
   that went out with no price at all. The received quantity had always been
   typeable and the money beside it hadn't. It's `InlineValue` on
   `purchase_order_items.unit_price` — the same cell and column PO detail edits,
   so a correction at the delivery and one at the desk are one act — and it sits
   on whichever SIDE of the arrow the stage isn't replacing, so the editable
   number is always the LINE's: `[price] → $invoice` at stage 1,
   `Catalog $x → [price]` at stage 2. Editing re-derives `priceAction`, so
   typing what you were actually billed is another way to arrive at
   "Update vendor".
   **Manual match** (Mark, 2026-07-31, after BakeMark 112-181120-01): vendors
   renumber items, so no matcher catches them all. A row with no invoice match
   offers `Match…` when the invoice has unpaired lines; picking one **writes the
   invoice's `product_id` onto the PO line**, which makes the ordinary SKU join
   find it — no new column, survives a reload. Then `skuAction` offers a second,
   separate button to teach the CATALOG the new number so the next order matches
   on its own. Same two-stage shape as the price button and for the same reason:
   fixing this order is not consent to edit the catalog. Editing a line's
   product ID was already policy (2026-07-28) and isn't gated on status.
   Measured on that invoice: 5 lines joined on SKU (three of them only after the
   leading-zero pass — BakeMark drops ours), 2 were rescued by description where
   BakeMark had renumbered, and Coconut failed on a plural ("Coconut Flakes" vs
   "COCONUT FLAKE SWEET" share one word, and the fallback needs three). After a
   manual match: 8 of 8.
   Shipped 2026-08-04, **DEPLOYED and confirmed against the real invoice the
   same day** (Mark: "the Dawn invoice mapped perfectly after the fix"):
   **a line can print TWO item numbers, and we only read one.**
   Dawn Foods invoice 96461403 (PO 135-181118-01) has separate `PRODUCT ID` and
   `MATERIAL` columns; three of its four lines leave PRODUCT ID blank and carry
   OUR sku under MATERIAL, while the fourth has ours under PRODUCT ID and a
   different number under MATERIAL. Every number needed for a 4-of-4 join was
   on the page — the schema had one field, so the reader chose the column
   literally labelled PRODUCT ID and **said so in its notes**, which is how this
   was found. So `alt_product_id` joins `product_id` on the line (declared on
   both sides, optional in TS and required in the schema, exactly like
   `ship_date`), and the SKU join is now FOUR passes: primary exact, alternate
   exact, then each again ignoring leading zeros. **Primary before alternate is
   deliberate** — the column a vendor labelled as the item number is the better
   claim when two lines could each take ours — and uniqueness is recomputed per
   pass over what's still unclaimed, so an ambiguous number is still refused
   rather than paired arbitrarily. Every stored reading predates the field and
   is unaffected; nothing changes for it until that invoice is read again.
   Pinned by the whole Dawn invoice as a fixture, both ways round: **4 of 4 with
   the material number, 1 of 4 without** — which is precisely the symptom Mark
   reported, so the fixture is known to model the real thing.
   Manual match now pairs on EITHER number (`matchableSku`), since on a
   two-column invoice the one we ordered under can be in either. A line printing
   NO number still can't be paired at all — pairing IS copying a number onto the
   PO line — and the dialog now says "no item number to match on" **in place of**
   the greyed button, because a disabled control explains itself only on hover
   and the iPad has none. That greying is what prompted all of this (Mark,
   2026-08-04: "why are they disabled?").
   If a pairing ever has to be recorded for a line with no number anywhere, that
   needs somewhere to STORE it — a column on `purchase_order_items` — and is a
   migration, not a tweak. Not built; ask first.
   Shipped 2026-08-03, deployed 2026-08-04: **the invoice
   says when the delivery happened**, and you can take it. The extraction schema
   gained **`ship_date`** — a field the page labels Ship Date / Delivered /
   Service Date, never the invoice date wearing a different hat — declared on
   both sides as ever (the Deno function can't import from `web/`). Until the
   function is redeployed the key is simply never written; every reading stored
   before this has no `ship_date` either, which is why it's optional in the TS
   type and required in the schema. Those fall back to the **invoice date**,
   labelled `Invoiced` where a real ship date is labelled `Shipped`, because
   "the day it moved" and "the day they billed us" are different claims and the
   person taking one should see which. The identity line drops its own date in
   that case — `73341407 · 2026-08-03  Invoiced 2026-08-03` reads as two dates
   that happen to agree.
   **It writes `delivery_date`** (Mark, 2026-08-03, choosing that over a
   migration adding `received_date`). Known consequence, accepted: that column
   is what the vendor PDF prints in its Delivery block, so taking a ship date
   onto an emailed order leaves the record saying a different day than the
   document the vendor holds — the same objection that stopped 016 backfilling
   the 16 POs sent 2026-07-27. It's outweighed at the delivery, where the day it
   actually came is the answer every later reader wants. Which is why nothing
   prefills: it's the screen's `→` idiom, the date shown beside the date it
   would replace (the tooltip names both, since a generated PO's `delivery_date`
   is 016's PREDICTION and this usually overwrites one), and quiet text when
   they already agree or you're below purchaser+.
   **The date is format-checked before it goes near the column**
   (`invoiceDeliveryDate` in `lib/invoiceExtraction`): the json_schema holds the
   model to a STRING and says nothing about its shape, while `delivery_date` is
   a `date` column, so an unchecked reading returns a raw Postgres error to
   someone standing at a delivery holding paper. The check is a ROUND TRIP, not
   a regex — `new Date("2026-02-31")` does not fail, it rolls over to March 2nd.
   13 fixtures, most of them the refusals.
   **One receive control**, in the ActionBar: `Receive n from invoice` when an
   extraction exists, `Receive n as ordered` when not, filling only lines with
   NO quantity. With an invoice it fills MATCHED lines only — filling the rest
   from the ordered quantity would assert that something arrived which nobody
   billed us for. **And it can be undone**: a band offers Undo, which nulls back
   the specific line ids it just set (held in state, not re-derived). Not a
   general undo stack — this is the only action that changes fifteen rows on one
   tap.
   **There is no ActionBar on this screen** (Mark, 2026-08-04: "get rid of the
   black band at the bottom… just two buttons"). The footer is `Close` ·
   `Complete` in the page's own FLOW, right-aligned, and `Complete` is the old
   Finalize renamed — still `closeReadiness`, which names what's unresolved and
   lets you through anyway, still writing status `closed`. The status chip and
   the PO list still say Closed; only the verb on the button changed.
   **`Complete` is BLACK**, which is a real exception to "every button is white;
   only a set filter is black" and a deliberate one: it's the panel-commit
   exception (`DIALOG_COMMIT_CLASS`, which it literally reuses) applied to a
   screen that behaves like a panel — receiving produces ONE outcome, and this
   row is an escape beside a commit rather than a row of peers, which is exactly
   the distinction that rule turns on. The bar had already called this pair "a
   form's footer"; it is now actually one.
   Two consequences. The container's `pb-*` is GONE — every value it ever held
   was clearance for a fixed bar — and the footer being the last IN-FLOW child
   is what keeps the split row honest, since `spaceBelow` measures whatever
   follows the row and now something really does. Confirmed by Mark the same
   day ("split columns look good"): the columns still end level, which was the
   one thing this change put at risk. The ActionBar's leading
   command went with it: **`Receive n from invoice` now sits in the lines pane
   band, next to Add item** (Mark's placement), which is the thing it acts on.
   Both are `shrink-0` in a band that cannot wrap, so a hard-dragged narrow
   split clips them — the same edge the document band has, and the reason five
   controls is about that band's limit.
   **Finalize LEAVES on success** (Mark, 2026-08-03) — it closes the order and
   navigates to `closeHref`, because finalizing is the end of the task and every
   control left on screen is for a delivery you have just declared done; staying
   put made you press Close afterwards for the same destination, two taps for
   one decision. The write now takes **`.select("id")`** and checks the row
   count: an update matching no RLS policy changes nothing and PostgREST
   returns NO error, and a cheerful false success that also NAVIGATES reads as
   the order having been closed. Same lesson as the employee delete.
   **The strip under the bands carries the RECEIVED DATE**, with the layout
   picker pushed to the right edge by `ml-auto` (Mark, 2026-08-03 — the layout
   is set once and then left alone; the date is checked every time). It is
   `InlineValue kind="date"` on **`delivery_date`** — the same column the
   invoice band's `→` writes, so a machine's reading of a photograph lands in a
   field you can see and correct rather than one you take on trust. Labelled
   **Received** here where PO detail labels it Delivery: one column, and the
   honest label depends on which end of the order you're standing at. The
   header's `· due <date>` went with it, since the same value reading "due" in
   one place and "Received" 100px below is two claims about one column.
   `READ_ONLY_VALUE` moved to `catalog/InlineValue` when this made it a second
   caller — it's defined by that component's own resting padding, so it belongs
   beside it.
   **A file can be DROPPED on the document pane** (Mark, 2026-08-03: "can the
   user drag a pdf onto the pdf viewer… to attach it"), `ui/FileDropZone`
   wrapping the viewer — not the whole pane, so the header band's controls keep
   working mid-drag. It attaches as whatever KIND the band's picker currently
   says, so a dropped invoice auto-reads like a picked one.
   Two things it has to do that a naive `onDrop` wouldn't. **A PDF in an
   `<object>` is a plugin and swallows drag events**, so aiming at the document
   you are looking at — the obvious place to aim — would do nothing; the zone
   arms off WINDOW drag events and puts an overlay over the region, and the
   overlay is what takes the drop. **And `accept` does not apply to a drop** —
   that attribute governs the PICKER only, so the HEIC guard the picker's format
   list exists for is absent on this path and the zone re-checks types itself
   (`lib/fileTypes`), before anything is uploaded. `ATTACHMENT_ACCEPT` in
   `lib/attachments` is now the one list both routes read, and
   `attachmentRejection` words the refusal — HEIC gets its own sentence naming
   the Attach button, which asks iOS to transcode where a drag never will.
   A file dropped ANYWHERE else on the page while a drag is live is swallowed
   rather than opened, or the browser's own default would replace a half-counted
   delivery with a PDF viewer. 17 fixtures.
   **PO detail's Paperwork card takes a drop too** (Mark, 2026-08-03), the
   WHOLE card being the target. A refused drop is reported through
   `useAttachmentActions.reportError` rather than either screen's own error
   state, so it lands in the same line as an upload failure and reads the same
   on both — the same argument auto-read lives in that hook for. Its empty
   state says "Nothing attached — drop one here" only when you can actually
   write.
   **The document pane can RE-READ** (Mark, 2026-08-04: "there's no way to
   'read invoice again' on the reconcile screen. there should be"). `read` was
   in `useAttachmentActions` all along and only PO detail's Paperwork card ever
   called it, so the one screen built for standing at a delivery couldn't retry
   a reading. It sits with Remove — both act on the document SHOWN, where the
   kind picker and Attach are about adding a new one — and reads "Read" or
   "Read again" depending on whether there's an extraction. Auto-read covers
   the ordinary case; this is for the ones it can't: a read that failed, a
   photo retaken, and a reader that has since learned to see something it
   didn't, which is what a redeployed `extract-invoice` is.
   Known edge, not fixed: the band cannot wrap and every control in it is
   `shrink-0`, so at a hard-dragged narrow split (~320px of document column)
   the cluster outgrows the pane and `overflow-hidden` clips Remove. Five
   controls is what that band can hold.
   **Auto-read on attach, `invoice` kind only**, in `useAttachmentActions`
   (shared with PO detail's Paperwork card, because it's a decision about the
   ACT of attaching, not about a screen). The upload STANDS if the read fails.
   Feedback is `ui/ProgressBand`, not a Dialog — a 30-second Opus call must not
   stop you counting.
   **`DocumentPane` holds its signed URL in `useState` and is KEYED by
   attachment id.** `createSignedUrls` mints a fresh JWT per call, so every
   `router.refresh()` hands down a different URL string; without the key the PDF
   re-fetches and jumps to page 1 on every quantity you type. Images get zoom
   and rotate (half these invoices are phone photos of paper, arriving sideways);
   PDFs get the plugin's viewer plus an always-visible **Open** link, which is
   not optional — iOS Safari renders page 1 only in `<object>`.
   Verified 2026-07-31 against **`132-181132-02`** (Chefs' Warehouse, DF02, 15
   lines): 9 of 15 joined by SKU against the stored invoice, 6 not on it, 10
   billed but not ordered, 4 catch-weight `?`; bulk fill 9 with the invoice / 15
   without; a hand-counted 0 survived a bulk receive and Undo restored exactly
   the 14 it had filled. The order was left as found.
   **Shipped 2026-08-21 — PURCHASE REQUESTS (migration 059, NEEDS APPLYING).**
   `purchase_requests` was the last table 001 created that had never had a
   writer; spec §4.7 has wanted it since the beginning ("any staff member can
   submit a simple request… the purchaser resolves each") and the only trace of
   it in the app was a dead nav stub. **No FMP history migrates** (Mark: "we
   don't need any history on this… we'll roll this one from scratch") — the
   source table is `PurchaseReq` in DF-Locations, 21 fields, 116 records, and
   there is no export of it. Screens: `/purchase-requests` (list, no detail
   route — `/shop-sections`' shape) plus a create dialog and a per-row `⋯`.
   **IT LIVES UNDER PURCHASING, NOT LOCATION** (Mark chose it; the stub had been
   under Location). The nav is organised by the WORK, not by the FileMaker FILE
   a table happens to sit in — the Location stubs beside it (Tasks, Maintenance
   Requests, Inspection Logs) are all about the BUILDING, where a request for
   sprinkles is about the catalog and the order, and its only consumer is the
   purchaser standing in front of the guide. Even FMP surfaced it in Purchasing,
   as the guide's "N REQUESTS" badge. Between Inventory and Order Guide, in work
   order, labelled just **Requests** (the section says Purchasing).
   **ONE NOTE COLUMN, NOT TWO.** 059 RENAMES `dismiss_reason` → `resolution_note`
   — both exits produce a sentence, and a column called `dismiss_reason` holding
   "ordered from Sysco Tuesday" is a name that lies (015's Receiving relabel).
   005 declined to rename columns on the grounds that they ripple through the
   loader, app selects and view outputs; every clause of that is absent here —
   the table is EMPTY, the column had zero readers in `web/src`, no view
   depends on it, and `load.mjs` never wrote it. **The requirement rides the
   DECISION** (032's shape, verbatim predicate spelling):
   `purchase_requests_reason_when_dismissed` demands a non-blank note for a
   dismissal and asks nothing of "ordered", because saying no is the only record
   a vanished request gets and demanding a sentence for the common case is how
   people learn to stop reading the dialog.
   **THE TWO EXITS ARE DIALOGS, NEVER AN INLINE STATUS PICK** — dismissing must
   write status and note in ONE statement or the CHECK bounces a raw 23514 into
   a cell, which is the one refusal `InlineValue` cannot explain (the
   `special_orders_status_iff_order` trap). Reopen clears status, note,
   `resolved_at` and `resolved_by` together, or the row reads open while
   claiming somebody resolved it on Tuesday. **`resolved_by` finally has a
   writer**; it has been a column since 001.
   **059 ADDS A FOURTH POLICY: `preq_author_update`** (Mark's call). 001's three
   are right about who RESOLVES and wrong about the person who FILED: with them
   alone, filing a request is the only irreversible act staff have anywhere in
   this app. USING says which rows — your own, still open; **WITH CHECK says
   what it may BECOME**, and that is where the care is, because a policy is a
   ROW rule and without the value tests an author-scoped policy hands the author
   every column including the verdict. `status in ('open','dismissed')` is what
   keeps "ordered" the purchaser's word. Withdrawing IS a dismissal, so it has
   to say why.
   **THE TWO REFUSALS ARE NOT THE SAME SHAPE, measured on the harness rather
   than assumed:** a USING exclusion matches ZERO ROWS and returns NO error
   (PostgREST reports success), while a WITH CHECK refusal RAISES **42501**.
   Every write `.select()`s its own result AND maps 42501, and the menu never
   offers a command the person can't run — the two checks are the stale-session
   backstop, not the gate. **There is still no delete policy and there must not
   be one**: a delete removes 0 rows and cheerfully succeeds, so dismissal is
   the eraser and the dialog's copy invites "duplicate" and "filed by mistake".
   **`migration/load.mjs`'s `--wipe` list held `purchase_requests` AND
   `purchase_reminders`**, from when both were permanently empty. Reminders have
   had a writer since 2026-07-31, so that was a LIVE data-loss path — one
   `--wipe` to reload the catalog would have destroyed every reminder in the
   system with no export to restore from. Both are off the list.
   Filters follow `/recipes`: ONE dimension (Status), so it stays a `TabPicker`
   and borrows only `lib/filterMenus`' URL CONTRACT — which also sidesteps that
   bar's two-entries-reading-"All" wart, much more visible on a three-value
   vocabulary. `?status=all` is a real token beside the `open` default. Priority
   is a sortable column rather than a filter, ranked in TypeScript because
   **`priority` is TEXT and SQL would order it `high < low < normal`** — the
   resting sort is priority DESC with `created_at` as a tiebreak, which reads
   FIFO within a tier because a tiebreak always reads ascending. **No grouping**:
   the only candidate is the resting sort, so bands would be permanent over a
   twelve-row queue.
   **THE GUIDE'S HEADER IS TWO COLUMNS** (Mark, 2026-08-22: "in the header area
   where the reminders live on the order guide, let's try splitting it into two
   columns, one for the reminders, and the other for purchase requests") —
   what's due on the left, what the shop has asked for on the right, both above
   the shelf because both are alerts rather than view controls.
   **This RETIRED the "N open requests" link** that had sat in the sticky
   controls band since 2026-08-21. That link was defended as the guide's only
   route to the screen; the band is now that route and says WHAT was asked
   rather than how many, so keeping both would be one fact stated twice, three
   inches apart, with the weaker copy surviving. Known cost, which is the thing
   the link was good at: **this band scrolls away where the controls band
   sticks**, so halfway down a walk there is nothing on screen about requests.
   That is the right trade — you read this before you set off, which is when it
   can still change what you buy — and the link is five lines if it wants to
   come back.
   **`GuideBand` is the frame they SHARE**, and it exists because they sit side
   by side: two hand-rolled frames a column apart is the `ui/Dialog` story
   again, except here the drift is visible in one glance, because the two rules
   are meant to read as one line across the screen. **The tones are not
   decoration** — yellow is "worth your eye" and a reminder has earned it (it is
   dated and can be overdue), where an open request is a TO-DO that gets no
   worse at 3pm, so its band is plain and the marks inside carry the state (a
   high priority, in the same yellow). Painting both yellow would spend the
   alert colour on the half of the screen that is merely a list.
   **The two `showEmpty` flags keep it a GRID**: with anything in either
   column, both render and the empty one says so, rather than leaving a hole
   where a column should be; with BOTH empty neither renders and the guide's
   first row is the guide, which is the rule `Reminders` already had.
   `items-start`, so a tall column does not stretch the short one into a box of
   white space. Each request row carries the same `RequestActions` menu the list
   row does — answering one WHILE WALKING is most of the point of it being here.
   Verified at 1440 (two 657px columns, tops and headings aligned to the pixel,
   2px borders and 12px padding on both) and stacked below `md` with reminders
   first and no horizontal overflow. The one-empty state came free the next
   day, when Mark cleared his reminders: "Reminders / Nothing due today." holds
   the left column beside six requests, tops still aligned.
   **A REQUEST ROW IS `<request> (<item>) - <requestor>`** — Mark's own format,
   2026-08-22, arrived at in two passes after seeing the name and the item
   beside each other. The dash rides INSIDE the requester's span, so it comes
   and goes with the name it attributes and the row's `gap-2` cannot strand it.
   The
   parentheses earn their keep on a catalog whose names carry commas: without
   them "Cherries Cherries, Maraschino Mark" is three things running together.
   The bracket is ONE span, so the row's `gap-2` cannot get inside it and set
   "( Cherries, Maraschino )", and only the NAME is underlined — the brackets
   are punctuation, not part of the control.
   **It names who asked, and its item is a JUMP** (same day, two asks — the
   second clarified mid-turn as "go to the inventory item ON THE
   ORDER GUIDE"). The name is resolved
   from `org_members` (a fourth overlapped query — `requested_by` points at
   `auth.users`, so there is no FK to embed through). It is null rather than a
   stand-in word, unlike the LIST, which says "Someone" to stop a table column
   reading as nobody having asked: a band row is a sentence, and an unknown
   name is better left off than padded out.
   **HIGH PRIORITY IS RED, NOT THE MARK COLOUR** (Mark, 2026-08-22), on both
   the band's chip and the list's priority cell. It shipped yellow on the
   reasoning that yellow means "worth your eye" where red means something is
   WRONG — and the better reading is that a high-priority request is the same
   class of thing as a FLAGGED special order, which 058 paints full-width red:
   not an error, a thing that cannot wait.
   **The measurement settles it independently, and generalises**: `text-mark`
   on white is **1.5:1**, which is not a legibility complaint, it is text you
   cannot read — against 5.61:1 for `text-accent`, which passes AA. The mark
   colour is a FILL (`bg-mark-fill`) or a border; as 11–12px TEXT on white it
   is decoration that happens to have a shape. Worth knowing before reaching
   for `text-mark` again — several older screens use it exactly that way
   (`/recipes`' "none", receiving's `≈` and `?` markers) and were not touched
   here.
   **The item goes to the ROW IN THIS WALK, not to `/items/[id]`.** The
   destination that matters from the guide is fifteen feet down the same page —
   the row that lets you order the thing — where the Requests list keeps the
   link, having no walk to scroll. One component, two behaviours, decided by
   whether `onJumpToItem` is passed.
   `jumpToItem` has three outcomes, in order: scroll to the row under the
   measured chrome; else, if the item IS in today's `rows` but this VIEW is
   hiding it, widen the filter to All and clear the search and scroll on the
   next render (deliberately visible — a jump that silently rearranged the
   screen would be worse than one that explained nothing); else say **"not on
   today's guide"** on that row, decided SYNCHRONOUSLY off `rows` rather than by
   hunting for a row that was never going to appear. The pending id is a REF,
   not state, so the deferred scroll never becomes a set-state-in-effect.
   `chromeOffset` was extracted from `scrollToNext` so the two jumps measure the
   same three bands.
   **And the item link was already there and simply invisible** — `text-muted
   hover:underline`, which on an iPad has no hover and beside a muted requester
   name reads as more description. It is underlined at rest now. Worth
   remembering as a class: "add a way to X" can mean X exists and does not look
   like a control.
   Verified against the live guide: Cherries jumped 0 → 48,454px and landed at
   exactly the sticky labels' bottom edge (218px, measured both ways); narrowing
   to Will order (0 rows rendered) and then jumping widened to All, re-rendered
   242 item rows and landed on CUP, ICE CREAM under the chrome. The remembered
   view was set back to Favorites afterwards — `rf.guide.view` is a session
   cookie and it is Mark's.
   That comment in `Reminders` about surviving "the collapsing shelf" was
   already vestigial — the collapse went on 2026-08-02 — and now says so.
   **`components/catalog/InventoryItemChooser`** is `InventoryItemPicker`'s pure
   sibling — value + onPick, WRITES NOTHING — because a create dialog has no row
   to update yet and one that had already written something by the time you
   press Cancel lies about what Cancel means (`CustomerPicker`'s rule). The
   shared query stays in each component rather than moving to `lib/catalog`:
   that module is PURE and compiled into the Node fixture run, so importing the
   browser client would drag `@supabase/ssr` in behind it.
   Verified: all 59 migrations replay on the Docker harness, and every rule was
   checked by exercising it as a real authenticated role — a staffer files one
   and fixes their own words, is refused `ordered` by the WITH CHECK, cannot
   dismiss without a reason (whitespace included), loses the row once it closes,
   and a `delete` removes **0 rows with no error**; another staffer gets UPDATE
   0; a purchaser marks ordered with no note, reopens clearing all four columns,
   and is still refused a bare dismissal; `anon` with no claim sees 0 and is
   refused an insert; the dependency guard fires when a view really does depend;
   and a re-run of 059 fails loudly at every step. **1105 fixtures pass**, 11
   new, each checked by breaking it.
   **059 IS APPLIED and the whole flow was WALKED against the live database
   2026-08-21, then left exactly as found** (0 rows). What that proved beyond
   the harness: the create dialog files a row and stays open with Cancel
   reading **Done**; the dismiss dialog's commit is **disabled on a blank note
   AND on whitespace**, so the check constraint never has to refuse anything,
   while Mark-ordered's commit is enabled with no note at all; marking ordered
   writes status, note, `resolved_at` and `resolved_by` in ONE statement and
   Reopen clears all four; the row menu offers Mark ordered / Dismiss / Link
   while open and **Reopen / Link once resolved**; the inline priority cell
   writes; and the item chooser searched the real catalog (19 hits for
   "sprinkle", active first, the inactive one last and marked) and left a live
   link to `/items/[id]`.
   **The org-timezone date earned itself on the first row.** `created_at` was
   `2026-08-22T05:08Z` and the list correctly reads **2026-08-21** —
   `created_at.slice(0, 10)`, which is what a list would ordinarily do, would
   have dated a request that had just been filed to tomorrow. Hence
   `dateInTimeZone` in `lib/today`, beside the two functions that exist for
   exactly this drift.
   **TWO CHANGES CAME OUT OF USING IT** the same day, both Mark's.
   **The create dialog CLOSES on File request.** It shipped with
   `AddShopSection`'s stay-open ending and that is the wrong ending here: that
   one stays up because you seed a shop's whole walk order in a sitting, where
   filing a request is noticing ONE thing is low. There is no confirmation
   strip because there is a better one — the row is on the list behind you the
   moment the panel goes, and the status tab's count moves with it, which is
   also the feedback if you happened to be on the Ordered or Dismissed tab
   where the new row itself would not show.
   **And a request can explain itself (migration 060, NEEDS APPLYING).**
   `request_text` was doing two jobs: "the big rainbow sprinkles" is what you
   scan down a queue, and "the ones we use on the Bacon Maple, not the little
   ones" is what the purchaser needs before they can buy the right thing. One
   field means either the list becomes a wall of paragraphs or the explanation
   never gets written. So the line stays NOT NULL and **`details` is nullable**,
   because most requests really are one line and demanding prose for "we're out
   of gloves" is how people stop filing them. Distinct from `resolution_note`,
   which is the ANSWER — two people, two moments, two columns, and 059's
   merge-into-one-note argument does not apply because that was two spellings
   of one act.
   **The ask and its explanation SHARE THE REQUEST COLUMN** — the line over the
   paragraph, PO detail's Item cell in another costume. A `DataTable` expansion
   was the first instinct and is wrong twice: the chevron rides in the FIRST
   cell and applies `truncate` to it, so hosting it on this column would
   silently stop a request wrapping — the one column that must — and a queue you
   are WORKING is the wrong place to hide each row's reason behind a disclosure,
   because you would open every one. Empty details render as a faint
   "Add details…", which is the only thing on screen saying the field exists.
   **Both walked against the live database 2026-08-22, and THE FEATURE IS IN
   REAL USE** — Mark had filed eight requests across DF01 and DF02 by then
   (magic erasers, 18" plastic wrap, cash drop envelopes, a door stopper,
   cherries, sugar cones, ice cream cups, toilet bowl cleaner), three already
   linked to catalog items, and he filed three more DURING the verification.
   Everything was checked on a row Claude filed and then deleted; his eight
   were left untouched, details still null. Confirmed: the create dialog CLOSES
   on File request, the row lands on the list behind it with its details
   rendered under the request text, the tab counts move, the details box is
   visibly the taller of the two fields, and the inline details cell saves on
   ⌘↵. The resting order held over four rows at equal priority — oldest first.
   In the guide band: "1 open request" → "No open requests" at zero (a numeral
   zero in a sentence reads stiffly), and **the band measured 112px with the
   link and 112px without it** — it already wrapped at 1440, so the link costs
   nothing. Scrolled, the band pins at 64 and the column labels at exactly 176,
   which is its own published height added to the masthead's: zero overlap,
   zero gap.
4b. 🚧 **The Location module** — the first screen outside Purchasing (Mark,
   2026-07-30). `locations` was the one table with no UI at all: nothing in
   `web/src` wrote to it, and its six rows still carried raw FileMaker text in
   `settings` (`"10am␝10am␝…"` for hours, `LaborRate_n` as a string) while 42
   of FMP's 51 location columns had been dropped at transform time. Shipped:
   **`/locations`** (list) **+ `/locations/[id]`** (record). One page, no tabs:
   FMP's INFO2 was SMTP credentials (replaced by the provider layer, and never
   to be displayed) plus three unbuilt modules, and REQUESTS was three more.
   Blocks: identity, the two addresses, operating hours, tax/labor/registers,
   the production mapping, four counts, and a read-only statement of which
   email tier POs go through. **`/shop-sections`** — the 168 rows that
   order the guide's walk, editable at last, location-scoped, with a guarded
   delete (the FK is `on delete set null`, so deleting a section moves its
   items to "No section" rather than deleting them).
   `components/InactiveLocationGate.tsx` in the (app) layout replaces every
   screen except the `/locations` ones with a sentence and an Activate button —
   an inactive location is a record you maintain, not a shop you work in.
   Without it those screens don't break, they just render as inexplicably empty
   tables. One component; delete it and the wiring line to go back. Schema:
   migration 017 + `migration/backfill-locations.mjs`.
   Rebuilt 2026-08-01 on Mark's FileMaker shape, after living with the
   masthead's `<select>`: **the working location is CHOSEN FROM A LIST**, and
   `components/LocationSwitcher.tsx` is deleted.
   **A masthead picker came BACK on 2026-08-27** (Mark) —
   `components/WorkingLocation.tsx`, last in the utilities row, after the gear.
   That is not the 2026-08-01 decision being reversed, it is being HALVED: this
   list is still the right place to READ about a shop and then act on the row in
   front of you, and what it turned out not to be is a good place to SWITCH
   from, because switching is something you do on the way to somewhere else and
   it made you leave wherever you were. Both routes exist and the Working column
   below stays.
   Three things about it worth not rediscovering.
   It is a **`ui/PickList`, not a `<select>`** — there are none of those left in
   the app and a masthead is where an OS menu looks most out of place — which
   needed a third trigger dress, **`variant="masthead"`**: yellow type, a caret,
   NO BOX and no horizontal padding (Mark, 2026-08-27, in two steps). The box
   went the way `Sign out`'s did: up there a box reads as a different KIND of
   object from the type it stands among, and the padding went with it because
   without the border it held the code 8px off the page gutter `Sign out` sits
   on directly beneath (measured — both right edges are the same pixel, and the
   gap to the gear matches Home-to-gear). Everything is STATED rather than
   overridden, because Tailwind resolves competing utilities by stylesheet order
   and a caller passing `bg-transparent` through `className` could not be relied
   on to beat `field`'s `bg-white`. Hover BRIGHTENS (yellow-500 → yellow-200,
   14.67:1 → 18.05:1) where every other quiet control in the app darkens —
   yellow-500 is already near the top of its range. `h-6` stays whatever the
   dress, so the box is a nav tier tall and the masthead's two columns line up.
   Its panel needed **`panelMinWidth`** (`MenuButton`'s idiom, now on
   `PickList`): a four-character trigger opens rows carrying a shop's full name,
   and at the shared 168px floor "Donut Friend 01 Highland Park" broke over four
   lines. 300 puts every row on one.
   **It offers ACTIVE locations only**, which is `WorkingHere`'s rule and not
   the old switcher's — that one listed closed shops because switching to one
   was the only way to reach its record, and this list killed that reason. The
   working shop is listed even if somebody has just closed it, hinted
   "inactive", or the trigger would show a raw id instead of a code.
   The list leads with the Active
   toggle (purchaser+ only, per 001's policy) and ENDS with the **Working**
   column (Mark, 2026-08-01 — read the row, then act on it, and the control you
   press repeatedly sits against the right edge, like the guide's stepper) —
   `components/location/WorkingHere.tsx`, three states: a YELLOW `WORKING HERE`
   chip on the one you're at (`bg-mark-fill`; it was a BLACK fill until
   2026-08-02, when Mark read it as a button — down a table column the boxes sit
   56px apart, so they aren't read as one segmented control the way a
   TabPicker's abutting cells are, and alone a filled box with a label is a
   button. Yellow is already this app's mark for WHICH SHOP YOU ARE AT, and no
   button anywhere is filled yellow. (Where that mark LIVES has moved twice
   without its meaning changing: when this was written the nav marked its active
   SECTION yellow; from 2026-08-06 selection was white in both bands and the
   yellow belonged to the location TAB alone; since 2026-08-27 the tab is
   ordinary and the masthead's picker wears it. Two places carry it now — the
   control that SETS the working shop, and this chip on the row that IS it.) The 130×30 optical compensation went with the black — a pale fill is
   a light area like the outlined box beside it), a `Work here` button
   on any other ACTIVE one, and **nothing at all on an inactive one**. Chip and
   button are ONE box — same width, height and border, only the fill differs —
   or the column's edge moves as the working location moves down the list. The
   working row is `font-bold`; a closed one is **not** dimmed (Mark,
   2026-08-01): its links work like any other row's, and greying text you can
   still click reads as disabled and lies. Only an
   open shop can be worked at (Mark, 2026-08-01): switching to a closed one
   used to be the only way to reach its record, and the list reaches it
   directly. That's a UI rule — `set_my_member_profile` checks only that the
   location is in your org, which is also why the gate is still load-bearing:
   the Active toggle is now one tap from the shop you're standing in.
   The list is **deliberately NOT keyed by the working location**, unlike every
   other location-scoped screen: its rows ARE the locations, so none goes stale
   when the working one changes, and remounting would throw away the reader's
   search and sort on every tap. It writes through the same `setActiveLocation`
   action the switcher used, whose `revalidatePath("/", "layout")` re-renders
   in place — no refresh, no navigation.
   The RECORD is keyed by its id, and that key is the point: `/locations/A` →
   `/locations/B` through the record book is a soft navigation within one
   dynamic segment, so `OperatingHours`, `ProductionMapping` and `ActiveToggle`
   — all `useState(props)` — would show A's data beside B's text.
   Its "In the system" counts are **figures, not links** (Mark, 2026-08-01:
   "drop the links, but keep the info. It's handy."): those screens follow the
   WORKING location, so from any record the link was right by coincidence and
   wrong on the other five. `/location` survives as a redirect shim to
   `/locations/<working id>`; the nav's tier-2 item became "Locations"
   (`lib/nav.ts` — one line) and is **"All"** since 2026-08-27, and the tier-1
   tab wore the working code from this change until the same day, when the
   masthead picker took it back.
4c. 🚧 **HR + app access** — the second module outside Purchasing, and the one
   that makes the app multi-user (Mark, 2026-08-01: "It's time to add users to
   the app"). Specced in `docs/hr-access-brief.md`.
   **An EMPLOYEE and a USER are two records, linked.** FMP conflated them:
   login credentials were two fields on the employee's ADMIN tab — the password
   stored and DISPLAYED in plain text, beside the SSN on the INFO tab of the
   same record — and access was implied by a 1–5 "user level" radio whose
   meaning lived only in script logic. Now `employees` is the HR record (all
   ~445 people, almost all terminated, the referent every rating/timesheet/order
   will hang off) and `org_members` stays the access record; the link is
   `employees.user_id`, nullable and unique. Granting access is an ACTION an
   admin takes on a record, not a job category — so a supervisor who does
   ordering gets `purchaser` without being reclassified.
   Schema: **020** (employees + the supervisor role + `org_members.invited_at`)
   and **021** (employee_documents + a private bucket). Split so a storage
   problem can't hold the data load hostage — 018's precedent.
   **`employees` is the first table where READ is role-gated** (owner/admin, not
   any-member): it carries a home address, a date of birth and eventually a
   write-up. It has **no delete policy at all** — an employee is TERMINATED,
   never deleted, and absence of the policy is the enforcement (the Clear-guide
   lesson). A supervisor phone list and a "my own record" view are both real
   future needs and both COLUMN-scoped, so each arrives as a definer function
   naming the safe columns (the `set_my_member_profile` pattern), never by
   loosening this.
   **Onboarding paperwork is DERIVED, never stored** (Mark: it "should not be a
   check list but flags that are set when those documents are uploaded"). FMP
   had eight checkboxes and the documents themselves nowhere in the system; a
   checkbox is a claim about paper in a drawer and goes stale the moment it's
   ticked optimistically. `missingPaperwork()` asks which kinds exist, so
   "complete" cannot be true without the files. FMP's Events table had already
   been repurposed as a filing cabinet for exactly this reason (81 rows typed
   `Document` since 2024, 73 with a paper original) — those land here at cutover.
   **Access is an INVITATION.** `invite-member` (edge function) mints a
   one-time Supabase link with the admin API and mails it through the SAME
   three-tier provider layer the PO sender uses (org tier only — no location is
   in scope for a member). `/welcome` is where the invitee sets their own
   password; no credential is ever stored, displayed, or known to whoever
   granted access. Revoke = delete the membership FIRST (it's what every policy
   reads, so the door shuts even if the rest fails), then **ban** the auth user,
   then null the link — **never DELETE an auth user**, because 001's audit
   columns reference `auth.users` with no cascade and the history should keep
   its author. Needs one new secret: `APP_URL`.
   Two things the plan had wrong, both worth remembering:
   **`proxy.ts` bounces every signed-out request to `/login`**, which would have
   landed the invite on a password page for an account that has no password —
   `/welcome` is exempted alongside `/login`. And **`InlineValue` hardcoded
   `.eq("id", id)`** while `org_members` is keyed `(org_id, user_id)` with no
   `id` column at all; it takes an optional `match` now, with a hard stop when a
   cell has neither (a cell with no row to write to would otherwise update every
   row in the table).
   **`/welcome` spends the token on SUBMIT, never on load.** Mail scanners and
   link previewers follow URLs in email as a matter of course, so verifying in
   an effect would let a corporate spam filter burn the invitation before the
   person ever clicked it.
   **The submit button is disabled until React hydrates**, which is cheap
   insurance rather than a fix for anything observed: on a browser that never
   hydrates it stays disabled instead of letting the browser submit the form
   natively and strip the token out of the URL. Note this page CAN'T suffer
   that in the normal case — `Suspense fallback={null}` means the server sends
   no form at all, so there is nothing to press until React has rendered it.
   (A 2026-08-02 report of "nothing happens, the fields just clear" was blamed
   on exactly that mechanism and the blame was wrong; the flow was then walked
   end-to-end against a real admin-API token and completed correctly. If it
   recurs, get the URL after the failure — a bare `/welcome?` would prove a
   native submit, anything else rules it out.) The guard uses
   `useSyncExternalStore` (server snapshot false, client true) rather than an
   effect, which is what the `set-state-in-effect` lint wants.
   **A `/welcome` with no `token_hash` says so on ARRIVAL** rather than looking
   normal and failing at submit — reading the parameter doesn't spend it — and
   a failed verify now carries the server's own message instead of a blanket
   "expired or already used", which read as certainty while hiding the reason.
   **It does NOT ask for a name** (Mark, 2026-08-02: "we know their name
   already"). The org name and the person's first name ride the link as
   cosmetic params — the page has no session and so can't read either — so it
   greets them with "Welcome to Donut Friend" rather than a product name they
   have never heard of, and writes `display_name` for them. That write matters:
   a null one is what the App access block reads as "invited, hasn't signed
   in", so it falls back to the email's local part for links minted before the
   param existed. Only `token_hash` carries any authority.
   Screens: `/employees` (defaults to Active — 26 of 445) and `/employees/[id]`,
   both cloned from the locations pattern including the `key={id}` shell. The
   nav gained per-role visibility (`NavSub.roles` + `sectionsForRole`, filtered
   server-side in AppHeader) — a TIDINESS rule, never a security one; RLS is the
   gate and each gated screen says so in a sentence. `/employees` is exempt from
   `InactiveLocationGate`: a person belongs to the ORG, not to a shop.
   Migration: `transform-hr.mjs` → `load-hr.mjs`, mirroring the purchasing
   pipeline, output outside the repo. The transform matches each field against
   candidate column names and names what's missing, which is how the FIRST
   export was caught: every file Mark exported on 2026-08-01 was a LAYOUT
   export (Employees.mer had 14 columns, no employee id, no separate name
   fields, none of the ADMIN tab). **Events, Ratings, Reviews, PayPeriods and
   Timesheets in `FMP Export/HR/` are still those layout exports** — they need
   redoing before any of them can be migrated.
   The re-export is the full table, 89 columns, and it carries **SSN,
   `_security_password`, `Account_password`, `Wage` and the `Bonus_*` fields**.
   None of that is read: the transform declares the seventeen fields it wants
   and ignores the rest, which is why the design is a field allow-list rather
   than a drop-list. The file itself is outside the repo and should stay there.
   Two things the full export settled:
   **the user level is `_security_level`** (124 of 445 filled, values 1–5 —
   NOT `Account_permission_level`, which is empty in every row, and NOT
   `PermissionLevel_c`, a calculation that tracks the job rather than the
   login). 11 current employees had access above staff; that's the invite
   roster.
   And **the eighth onboarding document is "Orientation", not "Training
   Acknowledgement"** — the layout's checkbox label said the latter, but the
   `Paperwork` value list holds both and the data is Orientation 45 to
   Training Acknowledgement 3. Migration **022** widens 021's check constraint;
   `training_ack` stays fileable but is no longer required.
   Four employees are FMP location `DF00`, which isn't a location in this org
   (Mark, two managers, a contractor — evidently "the company, not a shop").
   They load with no main location, which renders as an em dash.
   Shipped 2026-08-02: **hiring someone, and deleting the typo you made doing
   it** — the app's first CREATE and first DELETE of a top-level record. Until
   this, every `.insert()` in `web/src` was a child row and nothing inserted a
   vendor, an item or a location either, so **this is the template those will
   follow** — and on **2026-09-03 all three finally did**: `NewVendor`,
   `NewInventoryItem` and `NewLocation`, plus `NewProductionItem` and
   `NewRecipe`. Every one of those tables already had a purchaser+ write policy
   from 001 or 037; **what was missing was a door, never a migration.** The
   shape: a command right-aligned ABOVE the list's filter row (it sat IN
   that row until 2026-08-21 — see `ui/FilterMenus`) → `ui/Dialog` →
   insert → land on the new record. `components/hr/NewEmployee.tsx` asks for the
   ROSTER fields only (the columns the list groups and filters by — a record
   missing those is invisible in the roster's own organizing scheme) and leaves
   the rest to the detail screen's `InlineValue`s rather than keeping a second
   editor in step. It warns on a surname already present, searching ALL 445
   including the 417 former employees, since a rehire is by definition inactive;
   clicking through to their record IS the rehire flow, so no reactivation UI
   was needed. `findPossibleRehires` is pure and fixture-tested.
   **Delete needed migration 023**, which REVERSES 020's "no delete policy,
   deliberately" for owner/admin — that rule was right about a PERSON and wrong
   about a TYPO, and the guard moved from the schema into the confirm
   (`EmployeeActions.tsx` counts `legacy_id`, app access and documents, defaults
   to Deactivate, lets you through). Deleting YOURSELF is refused outright and
   is the one guard that isn't passable: revoke removes the `org_members` row
   every policy reads. Order is revoke → delete row → remove Storage objects;
   `employee_documents` cascades but Storage does not, and revoke-then-fail is
   recoverable where delete-then-fail leaves someone able to sign in with no HR
   record.
   **A DELETE MUST `.select()` ITS OWN RESULT.** With no matching RLS policy
   Postgres removes zero rows and PostgREST returns no error, so a bare
   `.delete()` reports a cheerful success — caught in the browser here, the
   screen navigated back to a roster that had grown by one. The
   `order_guide_entries` lesson, alive on any table whose delete policy might
   not be applied yet.
   Shipped 2026-08-02: **an item's shop section is chosen from a list**
   (`ItemLocationRows`, `InlineValue kind="pick"` on
   `inventory_item_locations.shop_section_id`). The options are keyed BY
   LOCATION and that is the whole of the care: each row of that table is a
   different shop and a shelf belongs to exactly one of them, so offering DF01's
   shelves on DF02's row would write a section the guide there can never group
   by. Ordered by `sort_order` — walk order is how you think about shelves.
   "No section" is a real option with an empty value, not the absence of one;
   without it there is no way to take an item OFF a shelf.
   **Shipped 2026-08-05 — PAPERWORK CAN LAPSE (migration 034, NEEDS APPLYING).**
   021 made onboarding completeness DERIVED, which fixed "a checkbox is a claim
   about paper in a drawer". This is the other half of the same problem: a food
   handler card that expired in 2023 is on file, so the derived flags said
   complete, and the thing a health inspector would actually ask about was
   invisible. ONE nullable column, `employee_documents.expires_on`, and **null
   means it does not lapse** — the default, and the honest reading for a W-4 or
   a handbook receipt, so no existing row needed touching.
   **There is deliberately no per-kind allow-list.** Which documents expire is a
   fact about the piece of paper in your hand, not about the vocabulary: a card
   issued with no printed expiry says so by staying null, and the next kind that
   turns out to lapse needs no migration.
   `lib/employeeDocuments` gained the whole rule — `expiryState` (60 days is
   "soon", moved here from `lib/employees`' `foodHandlerState`, which is gone),
   `expiryRoll` (soonest first, so its head is both the next thing to deal with
   and the worst thing outstanding), `soonestExpiry`, and `paperworkStatus`.
   **MISSING AND EXPIRED ARE COUNTED SEPARATELY and never merged**: a lapsed
   card is ON FILE, and reporting it as missing sends someone to upload a first
   copy of a document they are looking at. `complete` is stricter than "nothing
   missing" — expired breaks it, expiring soon does not.
   UI: the expiry is on the CHIP and editable there (Mark's placement), as a
   label line over an `InlineValue kind="date"` — two lines because a 176px chip
   cannot hold both side by side, and **the label carries the meaning of an
   empty box** ("Never expires"), or a blank reads as something nobody has got
   round to filling in. The Paperwork block's derived line gained Expired and
   Expiring-soon rows beside Missing. The roster's **Food card column became
   `Expires`** — the soonest date, red if lapsed, yellow if near, with the KIND
   on a second line because "expired" without it sends you to the record to find
   out what.
   **`employees.food_handler_expires` is NOT dropped, and that is the one thing
   here that isn't finished.** Mark's note says this "would negate the need" for
   it and it will, but not on the day it ships. Measured against the live DB:
   124 employees carry that date (16 current staff) and **zero food handler CARDS
   are on file** — 42 documents exist, all handbooks and meal-break waivers. So
   dropping it destroys 124 real dates and moves none, and there is nowhere to
   move them to (a document row requires a file). Until then the app reads the
   two in priority order — `foodHandlerExpiry`, the same shape as receiving
   preferring the FILED invoice over the last raw reading: **a card on file wins
   even when it carries no expiry**, because at that point the card IS the
   record and a date on the employee row is a claim about a different piece of
   paper. `expiryRoll` folds the legacy column in only while no card is filed, so
   the roster loses nobody it used to flag. The detail screen's Food card row
   states which of the two it is showing. 034 names the probe whose answer must
   be 0 before the follow-up migration drops the column.
   **NOT migrated:** SSN (never exported — it's in FMP and Gusto, and a
   web-reachable database is the wrong home for it), pay rates and everything
   payroll-adjacent, and the Events/Ratings/Reviews/Timesheets tables, which
   FMP keeps writing until their own modules are built. See
   `migration/field-map.md` for the per-field reasons and the traps in each
   child file.
4d. 🚧 **Timesheets / payroll prep** — phases 1 and 2 SHIPPED 2026-08-04
   (migrations **027 + 028**, both APPLIED). Full brief:
   **`docs/timesheets-brief.md`** — read it before touching anything here, but
   read the CORRECTIONS below first: the brief was written against the
   2015–2019 partial export, and Mark's 2026-08-04 re-exports contradict it in
   several places. **The brief numbers its migrations 025–028; Invoices took
   025/026 the same day, so this module is 027–030 — add two.**
   The three things worth knowing without opening it:
   **the module exports HOURS and TIP DOLLARS and nothing else** (Mark: "leave
   rates out. They're already set in two places: Homebase and Gusto"), so no wage
   rate is ever stored and no paycheck is ever computed — a meal premium exports
   as 1.00 *hours* on an earning code, which also dodges *Ferra v. Loews*
   regular-rate arithmetic. **Overtime is imported and VERIFIED, never computed
   as authority** — Homebase's split is stored beside ours, a human adjudicates,
   the decision is stored with a reason. And **a timesheet is editable iff its
   pay period is open**, which is the module's one read-only rule: no `locked`
   flag, no archive concept, and historical loads land in already-closed periods.
   Two boundaries drawn once: Homebase owns punches, this app owns decisions,
   Gusto owns money and tax; and **sick hours are a reconciliation column that is
   DELIBERATELY OMITTED from the export file**, because Gusto already pays them
   and including them double-pays.
   **CORRECTIONS TO THE BRIEF, measured on the 2026-08-04 re-exports.** Every
   one is in our favour, and the first is the big one.
   **The brief's central premise is FALSE for the current data.** It says
   Homebase splits a shift at midnight and so under-counts CA daily overtime.
   The real Homebase CSVs (DF01 + DF02, the 07/20–08/02 pay period) have
   separate `Clock in date` and `Clock out date` columns and keep an overnight
   shift WHOLE — zero adjacent-at-local-midnight pairs across both shops — and
   Homebase's own overtime is correct on them: Gaspar López 6:01pm→8:10am =
   13.15h billed as **8.00 regular + 4.00 OT + 1.15 double** (textbook CA), and
   a 6.03h shift billed 0 regular + 2.88 OT + 3.15 double shows the seventh-day
   rule being applied too. FileMaker likewise fills `ts_Date_End` in this era
   (1,148 of 1,148 crossing rows dated start+1), where the brief measured ZERO
   — that figure came from the 2015–2019 ShiftPlanning/Deputy export. **So the
   stitcher is a safety net, not the centrepiece**, the historical load needed
   no stitching at all, and decision 2 (import and VERIFY) is where the module's
   value actually lives. `isLocalMidnight` is built and fixture-tested anyway;
   nothing depends on it yet.
   Also corrected: `ts_Position` is clean (30 values, no FileMaker numbering) —
   **but the Homebase CSV's `Role` still carries it** ("01 Overnight Baker"), so
   the prefix-strip trap moved rather than vanished. `ts_Location` has six
   spellings but only **6 stray rows** (DF1/DF2/df01), not two shops under six
   names. `ts_BreakType` and the break PUNCHES are populated on ~27,500 rows,
   where the brief thought them empty. **`cTimeSheetError` is populated on
   10,143 rows** with real Late/Missed/Short Break findings — so phase 5's
   `breakRules.ts` HAS a reference implementation to diff against, which the
   brief said didn't exist. It rides in `source_payload` rather than becoming a
   column, since decision 3 says a violation is derived and never stored.
   And the idempotency key is far safer than feared: the natural tuple gives
   44,765 distinct over 44,767 rows (the brief measured 23,220/23,673 on the old
   file). **Still no record id in either source** — not in Timesheets.mer's 117
   columns, not in the Homebase CSV — so `source_row_key` is the natural tuple
   plus an occurrence ordinal, stored READABLE rather than hashed so a duplicate
   explains itself.
   **Shipped, phase 1 — migration 027 `pay_periods` + `/pay-periods`.** The
   ladder `open → review → exported → closed`, the reopen stamps with a required
   reason, and a **btree_gist exclusion constraint so periods cannot overlap**,
   which is what makes "which period owns this workday" a TOTAL function so 028
   can fill `pay_period_id` by trigger. Read is membership-only (a period is two
   dates and a status, and a supervisor reporting Saturday's tips must know
   which pay period is open); write is owner/admin; no delete policy. The
   pay period lives in `orgs.settings.payroll` per design rule 2 — 024's lesson
   that a statement true of finished data is still wrong as a constraint.
   Loaded the real calendar: **178 periods, 2019-10-07 → 2026-08-02**, every one
   14 days from a Monday, zero gaps, zero overlaps, re-derived from the file by
   the transform rather than taken from the brief. All land `closed`, so history
   is read-only by construction. The loader deliberately does NOT open the
   current period — that arithmetic lives once, in `nextPeriodAfter`, or it is
   016's `nextDeliveryDate` trap. **So after the load there is no open period**;
   that is expected, and New pay period is how you open one. (Until 2026-08-06
   this read as `/pay-periods` opening on an empty `Current` filter — that screen
   is gone, and the button now sits on the timesheets screen's period bar.)
   **`isPayPeriodEditable` covers `open` AND `review`** — review is where
   corrections are MADE, and gating it would force a reviewer to step the period
   backwards to fix what they found. 028's write policies name the same pair;
   **they must change together.**
   **Shipped, phase 2 — migration 028 `timesheets` + `/timesheets`.** The punch
   as real INSTANTS, what the SOURCE said beside what we DECIDED, and the two
   derived dates. Plus `employees.homebase_id` / `gusto_id` / `excludes_tips` —
   there was no external-id column anywhere in this schema, and an import that
   matches on a NAME pays the wrong Sanchez.
   RLS is **owner/admin on every verb including SELECT** (020's reasoning: what
   a named person was paid for is the same class of fact as their home address),
   and writes additionally require the period to be open or in review.
   **Verified in the harness as a real authenticated admin, which is the only
   way to test a policy** — and it confirmed the footgun rather than assuming
   it: an update against a CLOSED period **changed zero rows and returned NO
   error**, delete likewise zero, insert refused outright, while the same update
   on an open period changed 1 row. A supervisor sees 0 timesheets and 2 pay
   periods. `anon` is refused `timesheet_period_editable`, `authenticated` is
   granted it (002 and 018's lessons, both live). Hence the app covers it BOTH
   ways: every write `.select()`s its own result, **and** the cell renders
   `READ_ONLY_VALUE` rather than offering an edit the database will silently
   swallow.
   **`lib/timeZone.ts` is the module everything rests on**, and it has one
   non-obvious property. The obvious two-pass offset lookup — look it up at the
   guess, correct, look it up again — **CONVERGES**, so on a fall-back night it
   finds one instant and confidently reports no ambiguity. Two fixtures caught
   that. It probes the offset a DAY EITHER SIDE instead, generating a candidate
   from each, and verifies both by formatting back: two survive = ambiguous, one
   = ordinary, none = the wall time does not exist. It REPORTS which rather than
   guessing, because both cases are an hour of somebody's overtime. 22:00→06:00
   is 7h across spring-forward and 9h across fall-back; a wall-clock subtraction
   says 8 for both.
   **Loaded the history: 44,721 rows** (44,766 transformed, 45 skipped and each
   named — five employee ids match nobody, including a `387B` and two
   phone-number-shaped ones; one row refused for an unparsable `"21"` clock-in).
   **Every row landed in a pay period, and FileMaker's own `cPayPeriod` agrees
   with the trigger's answer from the workday on all 44,721** — two independent
   answers, zero disagreements. 10 rows carry a fall-back AMBIGUOUS punch,
   resolved to the earlier instant and flagged in
   `source_payload.local_time_ambiguity`; **FileMaker took the LATER one**,
   which is where 37 of the 133 hour-level disagreements with FMP come from.
   `transform-timesheets.mjs` **imports the app's COMPILED `timeZone` module**
   out of `web/.fixtures-build` rather than keeping a second copy of the DST
   arithmetic, and refuses to run if `npm run fixtures` hasn't been run. It is a
   field ALLOW-LIST, so the 53 wage rates sitting in the file are never read
   (decision 1). Its first crossing-midnight rule trusted `ts_Date_End` and
   produced a **30.58-hour shift**; the TIMES decide now (`minOut < minIn`) and
   `ts_Date_End` is corroboration only.
   `/timesheets` is scoped to ONE pay period (44,721 rows exist) and opens on
   the most recent period that HAS shifts, not the newest — which after the load
   is an empty current pay period. **No `/timesheets/[id]` route**: a shift is a
   row, not a record, and what a detail screen would show lives in the row's
   expansion. The Worked column is DECIMAL, not a `5:13` clock reading, because
   Regular + OT + Double must visibly sum to it.
   **Still blocked**: phase 6's Gusto export. The template arrived and settles
   decision 1 — Gusto has a native **`missed_break_hours`** column, so a premium
   CAN export as hours — but Donut Friend's current FMP export puts premiums in
   **`custom_earning_premium` as DOLLARS** (values 16–26, matching
   `ts_Premium_Pay`), so which one to write is Mark's call. The template also
   shows the export is **one row per (employee, WAGE TYPE)**, not per employee —
   tips and premiums ride the `(Primary)` row while hours split across rate
   cards — which `gustoExport.ts` has to model. Not built.
   **Shipped 2026-08-04, phases 3, 4 and 5 — migrations 029 + 030, both
   APPLIED.** (Mark ran 030 before 029; they are independent — 029 references
   only 027/028, 030 only 018's storage helper and 028 — and both verified
   afterwards.)
   **Phase 4, `lib/overtime.ts`** — CA daily (>8 at 1.5×, >12 at 2×), weekly
   (>40) and the seventh-consecutive-day rule. **DAILY AND WEEKLY DO NOT
   STACK**, and that is the rule a rewrite is most likely to break silently:
   five 9h days is 45 hours and owes FIVE overtime hours, not ten. The weekly
   pass looks only at hours still REGULAR after the daily pass, which is what
   enforces it. A workday's answer is poured back over its shifts
   chronologically, so a day holding two shifts gets ONE decision and it lands
   on the shift that ran late. Seventh-day counts DAYS WORKED, not calendar days
   with rows.
   **`EPSILON` is 0.015 and that is a MEASUREMENT, not a taste.** Over all
   44,537 real shifts: at a half-cent tolerance 4,388 rows (9.9%) disagree with
   the source; at more than one cent, 267 (0.6%). The 4,121 difference is
   rounding convention — ours is exact from instants, the source's is its own
   rounded decimal — and a 9.9% disagreement rate is the same as flagging
   nothing. 239 of the surviving 267 are a real movement between buckets.
   Totals: overtime ours 5,071.57h vs source 4,911.62h, double-time 264.62 vs
   165.70. **Only 5 seventh-day shifts exist in seven years and FileMaker
   applied the rule to none of them.**
   The adjudication UI is the receiving screen's idiom — nothing prefills, and
   both buttons are a decision: Adopt writes `ot_decision='recomputed'`, Keep
   writes `'manual'` with a REQUIRED reason (leaving it `'source'` would say
   nobody had looked). The "needs review" queue compares against `hours_*`, NOT
   `source_hours_*`, or a row already adjudicated to disagree with its source
   would never leave the queue.
   **Phase 5, migration 029** — `break_premiums` unique
   `(org_id, employee_id, workday, kind)`, which IS the California one-per-day
   cap; `reason` NOT NULL and non-empty; HOURS never dollars. `tip_pools` keeps
   the reported AND corrected figure and works in integer CENTS throughout,
   because the allocations must sum to the pool exactly or the shop pays out
   more or less than Square collected every day. `report_pooled_tips` is a
   definer function so a supervisor can write ONE column (RLS filters rows, not
   columns); `freeze_pay_period` validates a client-computed payload and commits
   it, because reimplementing the allocator in PL/pgSQL would be 016's
   `nextDeliveryDate` trap.
   `lib/breakRules` assesses the WORKDAY and returns at most one meal finding —
   the cap as the function's shape. It NEVER returns a rest finding: a rest
   break is paid, leaves no punch, and anything derived from shift length would
   flag nearly every shift.
   **Diffed against FileMaker's own `cTimeSheetError` over 44,284
   employee-workdays** — the reference the brief said didn't exist: both flag
   10,078 (same KIND on 9,911, 98.3%), neither flags 26,491, only FileMaker 24
   (all on days under 5h that need no meal at all), only us 7,691 — 82.6%
   agreement. **The excess is a DATA GAP, not a rule bug: 6,374 of the 6,562
   excess no-meal days are six hours or less, exactly what a signed waiver
   covers, and ZERO waivers are loaded**.
   **CORRECTED 2026-08-06 — the waivers were never in FMP's Events table.** This
   note said twice that they were, and the fresh Events export has no waiver
   among its thirteen `EventType` values; `migration/field-map.md:146` has
   `MEALBREAK WAIVER` as an onboarding CHECKBOX on the employee record, dropped
   at the 020 load with the other paperwork ticks. Both halves of the gap have
   since closed by other routes: **Mark filed 21 real waiver PDFs on 2026-08-05**
   (`employee_documents`, kind `meal_break_waiver`), which `assessWorkday`
   already reads; and `migration/backfill-break-premiums.mjs` wrote **10,453
   `not_owed` decisions** from the break reasons FileMaker kept in its RATINGS
   table, resolving 3,138 of the excess findings. See build step 4e.
   **Phase 3, migration 030 + `lib/homebaseImport.ts` + `/timesheets/import`.**
   Drop → plan → commit, with NOTHING WRITTEN BEFORE COMMIT, and a commit into a
   closed period BLOCKED rather than left to fail silently. The parser is pinned
   against an ACTUAL SLICE of the DF01 export (`scripts/fixtures/data/`),
   preamble and totals rows and hyphen separators intact — a tidied-up imitation
   passed the first version, which imported the separators as a person called
   "-" with eighteen shifts. Two further classification bugs the real file
   found: a bare `Totals` grand-total row (every block ends `Totals for <name>`,
   the FILE ends `Totals`), and ten rows carrying a date with NO punches — a
   scheduled day nobody clocked in for, which are read perfectly and hold
   nothing, so they are listed apart from the failures. Every row of the real
   file is now accounted for: 102 shifts + 10 empty + 17 repeated headers + 19
   totals + 18 separators + 18 blank = 184, zero refusals.
   **The idempotency key was tested reversibly against the live database** — a
   throwaway open period, one row imported, the same row re-imported with a
   changed figure, one row in the table with the value updated, FileMaker's
   44,721 untouched, then everything deleted leaving 44,721 timesheets and 178
   periods exactly as found. That is the case that matters: Homebase emits no
   shift id and a pay period is re-exported whenever somebody fixes a punch.
   **393 fixtures pass**, and every rule above was checked by BREAKING it. Two
   fixture gaps were found that way rather than by reading: the
   one-premium-per-day case only asserted "at most one finding" (which the
   function's shape guarantees anyway), and the zero-hour-day guard put its
   empty day last, where `splitDay`'s own guard hides the bug. Both rewritten
   and both now fail correctly.
   **What remains is phase 6, the Gusto export.** Its FILE SHAPE is now known
   exactly, measured over the real template (24 people, 34 rows) and corrected
   by Mark 2026-08-04 — it is finickier than "one row per employee":
   - **One row per (employee, WAGE TYPE)**, and hours genuinely split across
     them: 7 of the 34 rows are non-primary and carry hours.
   - **The primary job title is IDENTIFIED BY THE SUFFIX `(Primary)`** on the
     `title` column — it is not a separate flag. Every one of the 24 people has
     exactly one such row. Getting this wrong doesn't mis-sort the file, it
     leaves Gusto unable to tell which job is the primary one.
   - **Every non-hours earning rides the `(Primary)` row and only that row** —
     `paycheck_tips`, `custom_earning_premium`, `custom_earning_commuter_benefit`,
     `bonus`, `reimbursement`. Measured: zero violations across the template.
   - `gusto_employee_id` is in the file (6-char, e.g. `n4smoy`), which is what
     028's `employees.gusto_id` exists to hold.
   **Premiums export as HOURS on `missed_break_hours`** (Mark asked for a
   recommendation, 2026-08-04; he was happy either way). The reasons are
   decision 1 — dollars means somebody computes dollars, and this module stores
   no wage rate — plus the fact that Gusto already knows every rate, so a dollar
   figure would be a second copy of a number we deliberately don't keep, frozen
   wrong the moment a rate changes retroactively.
   The *Ferra v. Loews* worry that made the brief hesitate turns out to be
   **largely theoretical here**: 60 of the 62 premiums FileMaker ever recorded
   equal that row's base `ts_Rate` exactly, ZERO rows carry an
   `hourlyBonusRate`, and none of the 20 rate cards actually used on timesheets
   mentions a bonus. So the regular rate of compensation and the base rate
   coincide for essentially everyone, and handing Gusto hours gives up no
   arithmetic. (The brief's "nine rate cards including Morning Bonus" came from
   the rate-card table, not from what the timesheets use.)
   **Still worth confirming in the parallel run: what rate Gusto actually pays
   `missed_break_hours` at.** If it ever disagrees with the base rate, the
   fallback is `custom_earning_premium` in dollars — and because the export is a
   DESCRIBED format in `orgs.settings.payroll_export` (design rule 2), that
   switch is configuration rather than a rewrite.
   **Shipped 2026-08-04, phase 6 — migration 031 + `lib/gustoExport.ts` + the
   export block on the pay-period record. NEEDS 031 APPLIED.**
   031 adds `timesheets.wage_type` and `employees.primary_wage_type`, and the
   export cannot be right without them. `timesheets.position` is NOT the wage
   type — it holds Homebase's `Role` and FMP's `ts_Position`, while
   `employees.position` holds a THIRD vocabulary of abbreviations ("DF",
   "Sr. DF") matching shift positions on only 8 of 22 people in the last real
   pay period.
   **THE `(Primary)` SUFFIX IS NEVER STORED.** Both columns hold the bare title
   and the export appends it by comparing them, which makes the file's central
   invariant STRUCTURAL: one `primary_wage_type` per person → exactly one
   primary row → exactly one place for the earnings. Storing it per shift would
   let a pay period produce two primary rows, or none. The backfill reads FMP's
   `ts_Wage_Type` out of `source_payload`; 198 employees have one in history,
   134 have exactly one ever and **64 CHANGED** (promotions), so **latest
   wins** — verified with a seeded promotion resolving to Manager, and zero
   suffixes stored on either table.
   **The most important assertion in this repo** is that SICK HOURS DO NOT
   APPEAR IN THE FILE, made against the produced **CSV header string** and not
   an object shape (a rename would slip the column back in). Decision 7 — Gusto
   already pays sick time, so including it pays the person twice. Checked by
   putting the column back exactly as an "improvement" would.
   Download and Finalize are TWO ACTS. Download changes nothing and may be taken
   repeatedly; Finalize calls `freeze_pay_period`, which snapshots every
   allocation and flips the status in ONE transaction. Verified in the harness
   as a real authenticated admin: a partial payload is refused BY NAME
   ("Allocations cover 1 of 4 timesheets"), a complete one freezes and stamps
   `exported_at`/`exported_by`, re-freezing is refused, and the period is then
   read-only to timesheet writes. `exportReadiness` follows `closeReadiness` —
   names what's unresolved, lets you through anyway.
   **`getAppSession` now embeds `orgs(name, settings)`**, not settings alone, so
   the export names its file without a second query. `session.orgName` is new.
   Then phase 7's parallel run, which `docs/master-plan.md` already requires —
   one full pay period through both FMP and this module, diffed per employee,
   before anyone trusts the export. **The one thing still unverified is what
   rate Gusto actually pays `missed_break_hours` at**; if it ever disagrees with
   the base rate, the fallback is `custom_earning_premium` in dollars, and
   because this is a described format that switch is configuration.
   **Reworked 2026-08-05 from Mark's first real test pass** (16 comments). Two
   were bugs; the rest were the module not saying what it already knew.
   **THE BREAK RULES COULD NOT SEE IMPORTED DATA.** `toBreakShift` read the meal
   punches out of `source_payload` as `break_start` / `break_end` / `time_in` —
   FileMaker's spelling, written by `transform-timesheets.mjs` — while the
   Homebase importer spread its own row shape and got `breakStart` / `breakEnd`
   / `clockInTime`. So on every IMPORTED shift the punches read as null, it fell
   through to `unpaid_break_minutes`, and **`late_meal` could never fire at all**
   while a missed meal was inferred from the absence of a deduction (Mark:
   "missed break not flagged by app… what about late breaks?"). The reader now
   accepts BOTH spellings — which is what makes the pay period already imported
   work with no backfill and no re-import — and the importer writes the canonical
   snake_case names beside the raw row, so the two sources stop drifting. That
   also fixes the row expansion, which reads the same keys and had shown em
   dashes for every imported shift.
   Measured on the real 07/06–07/19 pay period: **61 late meals found where the
   rule had been structurally silent**, against FileMaker's own
   `cTimeSheetError` flagging 49 Late Break on the same 163 rows — the extras are
   overnight shifts, where FMP's wall-clock arithmetic goes wrong and ours
   doesn't. 14 fixtures run one shift through both spellings; checked by
   reverting the fix, 8 go red and a late meal degrades to "no meal", which is
   exactly the symptom.
   **A grouping now always bands.** `DataTable` bands a run of like-labelled
   rows, so it can only band what the ORDER already groups; the list passed
   `sortKey`, so picking Day while the sort was Employee produced no band at all
   and grouping looked broken. The group is now the PRIMARY sort with the chosen
   column sorting WITHIN each run — which is what a grouped report is — so every
   grouping bands, Shop included (new). `DataGroup` gained **`summary`** — hour
   subtotals, which first went IN the band on the reasoning that a table of 56px
   rows cannot afford an extra row per group, and were moved the same day to a
   CLOSING ROW under a rule once Mark used them: "subtotals should be trailing
   the data, not leading in the header band, and the values should align with
   their columns." Alignment is the whole argument — a subtotal is a number you
   check against the column above it, and one set as a sentence in the band has
   to be re-read to be placed. So `summary` returns a map KEYED BY COLUMN and the
   table renders one cell per visible column, which keeps each figure under its
   own heading when a column is hidden or dragged. Verified summing exactly to
   the period totals (regular/OT/double to the cent; Worked and Break differ
   ~0.02 from summing the DISPLAYED rows, because the subtotal sums raw and
   rounds once — the more accurate of the two).
   **The cells now say what the app knows.** Columns are Worked · Regular · OT ·
   Double · Break (Mark gave the order twice the same day and the second is what
   shipped: the total leads, the three figures that make it up follow, and Break
   — what was deducted to REACH Worked rather than a part of it — sits last), with a new **Shift** column after
   Shop carrying `position`. A `≠` chip on an hours cell names our recomputed
   figure beside the stored one, because "the app disagrees with 5 rows" had
   lived only behind a tab and a row expansion; the OT cells carry
   `proposeOvertime`'s own `reasons` as a tooltip; the Break cell carries the
   meal finding. All yellow, none red — a disagreement is work for a human, not
   an error. Adding a column cost every other one width, so all twelve were
   rebalanced to 1402 and the labels checked for clipping in the browser; the
   widths key is **v3**, which covers widths,
   visibility AND ORDER — a stored order outranks the declared one, so without
   the bump anyone who already had the table would keep the old arrangement.
   **Break reads in HOURS**, the column staying `unpaid_break_minutes`.
   `InlineValue` gained **`scale`** for it — a stored-vs-shown unit pair
   converting on BOTH read and write, where `format` is display-only and would
   have put 30 in the box the moment you clicked a cell reading 0.50.
   **`NewTimesheet`** is the module's first write that isn't an import: a worked
   shift nobody punched, or paid time that produced none (028's `adjustment`
   kind), which is where a **sick day** finally lands — `sick_hours` had been
   editable only on a shift the person had also worked, which is backwards. It
   writes no overtime split and never touches `source_*`: there was no source,
   and the list's recompute argues with it out loud instead. A reason is
   required, like every other decision in this module.
   Its button is **always rendered and DISABLED on a closed period, never
   hidden** (Mark, 2026-08-05: "instead of hiding the button we should disable it
   then") — a control that vanishes can't be told from a feature that doesn't
   exist, and the filter row shouldn't change width as you page between periods.
   The usual objection, that a greyed control explains itself only on hover and
   the iPad has none, doesn't bite here: the sentence directly beneath already
   reads "This period is closed, so these shifts are read-only", so the reason is
   on screen in words. **Known consequence, accepted:** the Import link lives in
   that dialog, so from a closed period there is no visible route to the import
   screen — switch to the open period, or go to `/timesheets/import` directly,
   which is no loss because a closed period refuses an import anyway.
   Its button was pulled from the list and PUT BACK the same day (Mark,
   2026-08-05) — "remove the add timesheet button on pay period sheet" meant a
   different screen than the one it was on. It reads **New timesheet** now, per
   the app's `New <thing>` create convention, and the component is
   `NewTimesheet.tsx`.
   **"TIMESHEET", ONE WORD, EVERYWHERE** (Mark, 2026-08-05: "I think
   'timesheet' unless that is technically incorrect"). It isn't — both spellings
   are dictionary-valid and one word is what payroll software uses — and it was
   already the majority here: the tables are `timesheets` and
   `timesheet_imports`, the modules `lib/timesheets`, the components
   `TimesheetsList` / `ImportTimesheets`. Only the visible strings and the ROUTE
   said "time sheets", so the route moved `/time-sheets` → `/timesheets` (with
   `/timesheets/import`), and `lib/nav.ts`'s slug and label with it.
   **A TIMESHEET AND A SHIFT ARE NOT THE SAME WORD** and both survive: a
   timesheet is the RECORD, a shift is the period of work it describes. Hence
   "New timesheet" on the button, "Worked shift" in its kind picker, and "163
   shifts" in the list's totals — that last one counts periods worked and is
   right as it stands.
   Also: importing had **exactly ONE door, inside the New timesheet dialog**
   (Mark, 2026-08-05: "It adds a click, but is a clear work flow New
   Timesheet → Import"). It began as a link buried in a paragraph, became a
   button on the timesheets list AND the pay-period list, and ended as a single
   control in that dialog's footer, on the argument that "I need a timesheet
   that isn't here" is the question the form and the import both answer.
   **REVERSED 2026-08-22** (Mark: "move the 'import timesheets' button out from
   the new timesheet dialogue and directly onto the timesheet screen"). It is a
   `Link` beside New timesheet in the filter row's right-hand cluster now. The
   2026-08-05 argument reads well and had the frequencies backwards: it costs a
   click on the thing you do EVERY PAY PERIOD to save one on the thing you do
   rarely. Importing is the routine; typing a shift by hand is the exception.
   It is deliberately **NOT disabled on a closed period** where New timesheet
   beside it is — it navigates rather than writing, the import screen states any
   period problem in its own words, and it is also how you reach a DIFFERENT
   pay period's file. The importer OFFERS to open the period a file needs,
   continuing the cadence from `nextPeriodAfter` rather than wrapping the file's
   dates, where it used to state that none covered them and stop; the import screen ends with
   a **`Done`** at the lower right, OUTSIDE the `plan &&` block so it is
   there both before a file is dropped and after one is committed — committing
   clears the plan, so the screen had been leaving you on a success banner with
   nothing to press. **IT IS BLACK ONLY WHILE THERE IS NO PLAN** (Mark,
   2026-08-22: "the 'import x sheets' button should be black and not the 'done'
   button, shouldn't it?"). It should: the panel-commit exception is about the
   ONE OUTCOME A SCREEN IS FOR, and on this screen that outcome MOVES. With a
   file loaded it is `Import n shifts`, so that takes the fill and Done becomes
   the escape beside it; before and after, Done is the only thing to press and
   is the commit. Two black buttons in one row say nothing about which finishes
   the task. Same `DIALOG_COMMIT_CLASS` either way. The rows-with-no-punches list is one collapsed
   line, because those rows are the NORMAL case
   — Homebase prints one for every scheduled day — and ten warnings in front of
   someone whose file is perfect teaches them to skim the section that also holds
   the real failures; and **"fortnight" is "pay period"** in every visible
   string — a rule since widened to EVERYTHING, comments and conversation
   included; see Conventions.
   Known and NOT a bug: 90 meal findings on that pay period's 163 shifts reads as
   a lot, and 28 of the 31 no-meal days would be covered by a signed waiver.
   (This said "zero waivers are loaded — FMP keeps them in its Events table";
   both clauses were wrong by 2026-08-06. 21 waiver PDFs are on file and the
   waivers were never in Events — see the correction under phase 5.)
   **A DAY'S OVERTIME WAS POURED OVER ITS SHIFTS IN UUID ORDER** (found by Mark
   reading one row, 2026-08-05). `pourOverShifts` fills regular hours first and
   then overtime, so the order it walks decides which shift CARRIES the premium
   — and `proposeOvertime` sorted a workday's shifts by `id` while its own
   comment said "chronologically". The day's TOTAL was always right, which is
   why seven years of totals looked fine and nothing caught it; what was wrong
   was the allocation, and it only shows when you read a single shift.
   Eddy Salazar, workday 2026-07-26: 7.20h from 12:18am and 9.50h from 10:10pm.
   The day is 16.70h → 8 regular, 4 OT, 4.70 double. Poured by uuid the LATE
   shift sorted first and took the 8 regular hours, so the app proposed 2.50 OT
   and 4.70 DOUBLE on the seven-hour shift and explained it with "over 8 hours
   in the day; over 12 hours in the day". `ShiftHours` gained **`starts_at`**
   and the pour is chronological, with a shift that has no punch sinking last
   and `id` as the final tiebreak so the answer never depends on row arrival
   order. Measured over all 178 periods: 174 shifts moved, the **needs-review
   queue fell 267 → 135 (132 of it was this bug)**, and the totals did not
   move at all (Δ 0.00), which is the invariant that says only the allocation
   changed. 8 fixtures, checked by reverting: 5 go red and reproduce Mark's
   exact numbers.
   `ShiftProposal` also gained **`day_hours` / `day_shifts`**, and the tooltip
   names them — "That day totals 16.70h across 2 shifts". Overtime belongs to
   the DAY, so a five-hour shift can correctly be told "over 8 hours in the
   day"; on a single row that reads as a contradiction unless the day's own
   total is stated. 126 shifts under 8h still legitimately carry a daily reason.
   **THE MEAL RULE WAS RIGHT AND ITS SENTENCE WAS WRONG.** Mark read "it must
   begin before the end of the fifth hour" as meaning 6h00 and reported breaks
   at 5h32m as wrongly flagged. The threshold is 5h00 — *Brinker* puts the meal
   "no later than the end of the employee's fifth hour of work", and the fifth
   hour RUNS FROM 4h00 TO 5h00 — but the phrasing invites exactly that
   misreading. Settled empirically rather than by argument, over 28,385 real
   shifts carrying both a clock-in and a meal punch: `cTimeSheetError` says
   "Late Break" on **0 of the 18,314** beginning before 5h00 and on **93–95%**
   of those after it, including 3,135 of 3,371 in the 5h00–5h30 band. Thirteen
   years of FileMaker enforce exactly 5h00. Every message now says "within 5
   hours" and never "the fifth hour".
   **A HOMEBASE ROW CARRIES TWO BREAK FIGURES AND WE DEDUCTED THE WRONG ONE**
   (Mark, 2026-08-05, reading Gaspar López's 07-23 shift). The export has
   `Break start` · `Break end` · `Break length` — the ONE recorded meal punch —
   and, twelve columns later, **`Unpaid breaks`**, the TOTAL deducted, in HOURS.
   The importer wrote `Break length` to `unpaid_break_minutes`, which
   `workedHours` subtracts from the clock span. On most shifts the two agree and
   nothing showed; on a long overnight they don't, because a second meal is taken
   and deducted while Homebase's single punch pair still shows only the first.
   Gaspar punched 6:01pm → 8:10am with `Break length` 30 min and `Unpaid breaks`
   1.00, so we came out 0.50h long and the overtime recompute proposed half an
   hour of extra DOUBLE time on it. Measured over both real exports, 159 punched
   rows: **span − `Unpaid breaks` equals Homebase's own `Actual hours` on 159 of
   159**, where `Break length` matches on 153. So `Unpaid breaks` is the
   authority for HOURS WORKED and `breakMinutes` stays the authority for how long
   the recorded MEAL was — which is what the meal rule needs and what the total
   cannot give. The stitcher ADDS the two segments' totals where it merges. 6
   fixtures, one of them Gaspar's verbatim line; reverting turns 3 red and
   reproduces 13.65 against 13.15.
   **Consequence for data already imported:** the fix is in the parser, so rows
   written before it keep the wrong figure until the file is imported again —
   which corrects them in place, the upsert being on `source_row_key`. Measured
   on the 07/20–08/02 pay period: 6 rows, all Gaspar's, 3.03 hours over-counted.
   **ONE PLACE TO DO THE WORK, AND IT IS THE TIMESHEET ROW** (Mark, 2026-08-05:
   "I'm not sure whether it's in pay periods or in timesheets, but there should
   be one place to do what we need… Timesheets seems more natural to me because
   there's more info there so you can judge errors more clearly. In Pay Periods
   you have to just take the app's word for it"). The meal-premium decision and
   the tip-pool figure moved out of the pay-period worksheet and into the row's
   own expansion (`ShiftDecisions.tsx`), beside the punches, the recorded meal
   and the day's hours. The worksheet KEPT its totals and lost both
   editors; it is now the view before you export — how many decisions are
   **ITS VIEWS BECAME FOUR 2026-08-22** (Mark: "can we add an issue filter, to
   make 4 total: Hours, Late Breaks, No Breaks, Tips"). Breaks split because
   they are different problems with different answers — a late meal WAS
   provided and taken at the wrong time, where a missing one was never provided
   — and on the real 08-03 → 08-16 period they run **51 to 4**, so one list of
   55 buried the four that matter under fifty sharing one cause.
   **The other two codes have a home, or the split would silently drop them.**
   `no_second_meal` is a meal that never happened, so it goes with No breaks;
   `short_meal` does too, and that is a LEGAL reading rather than a
   convenience — §512 wants a meal of at least thirty minutes, so one under
   that is not a short meal, it is no meal. The split is TIMING against
   PROVISION and the two counts SUM to every finding, which is the property to
   preserve if a fifth code is ever added.
   outstanding and what they come to.
   **Shipped 2026-08-06: THE PAY-PERIOD SCREENS ARE GONE, and the export is a
   PANEL** (Mark: "since pay periods are now on the timesheet screen, there's no
   need for a pay period menu item"; the record "can be rolled into an 'Export
   Timesheets…' routine that opens the pay periods detail screen like a panel").
   That finished the sentence the 2026-08-05 rework started. Once every DECISION
   had moved onto the shift row, what was left on `/pay-periods/[id]` decided
   nothing — it stated the period, stepped it along the ladder, rolled the shifts
   up and produced the file — and the 178-row LIST beside it existed only to
   choose a pay period, which `/timesheets`' own `PickList` already did.
   So: `components/payroll/ExportTimesheets.tsx` is the old record, opened as a
   `ui/Dialog` at `h-[88vh]` from a command on the new `PeriodBar` (period picker
   · `StatusChip` · New pay period · Export timesheets…) above the shift filters.
   **The screen keeps its name** — "Payroll" was considered and dropped — and the
   routes did not move, so breadcrumbs, `loading.tsx`, scroll keys and nav-memory
   keys were all untouched. `/pay-periods` and `/pay-periods/[id]` are redirect
   shims (`/location`'s pattern, no `loading.tsx` — a redirect thrown during
   render never paints), and the Timesheets sub carries `also: ["/pay-periods"]`
   so a shim lights the right tab on the way through. `PayPeriodsList`,
   `PayPeriodDetail`, `ExportPayroll` and `lib/payPeriodRoutes` are deleted;
   `StatusChip` got its own file, having outlived the list it lived in.
   Three things worth knowing.
   **`Mark exported` is no longer offered on the ladder.** `nextStatuses` still
   returns it — `lib/payPeriods` is untouched and a reopen still clears
   `exported_at` — but `PayPeriodActions` filters it out, because Finalize is the
   only route to that status that also FREEZES. Four rem apart on a long screen
   it was merely redundant; side by side in one panel it is a trap that leaves a
   period reading exported with nothing snapshotted and no file anywhere.
   **Finalize is BLACK here** where it was white on the screen, and that is the
   rule applying rather than bending: a panel produces one outcome, so its footer
   is a two-weight decision (`DIALOG_COMMIT_CLASS` beside a text Close and a
   white Download). It also LEAVES on success by closing the panel rather than
   navigating — the receiving screen's lesson, same gesture in a panel's terms.
   The confirm is a SECOND `Dialog` rendered as a SIBLING, not nested inside the
   first: both are `z-[60]`, so the later portal paints on top and the panel stays
   up behind it.
   **The commit row had to move to the `footer` prop**, which is what forced the
   old `ExportPayroll` to be absorbed rather than composed — its buttons were the
   last row of a body that now scrolls, and a commit that scrolls away is the
   exact thing that bullet exists to prevent.
   Measured win: the two screens ran the same seven queries over the same seven
   tables, so the merge is ONE wave — 8 queries where the pair needed ~15. The
   export panel's inputs are derived on the server beside the table's own rows,
   from the same `sheets`; nothing in the panel renders until it is opened.
   Known cost, accepted: the cross-period view goes — status bands over 178 rows,
   the notes column, the "days ≠ 14" flag, filtering to everything exported. Every
   period is still reachable by range and status in the picker, which grows a find
   box past eight options.
   The export stays with the period regardless: `freeze_pay_period` is
   period-scoped.
   **BOTH CONTROLS ARE COARSER THAN THE ROW THEY SIT IN, and each says so.** A
   row is one SHIFT; a meal premium is per employee-WORKDAY (§226.7 pays one
   hour per workday per CATEGORY — *UPS v. Superior Court* (2011) allows a meal
   hour and a rest hour on one day but never two of either, which is exactly
   029's `unique (org_id, employee_id, workday, kind)`); a tip pool is per
   SHOP-DAY. So on a two-shift day both expansions show the same premium and
   write the same row, and every shift at one shop on one day shows the same
   pool. The premium UPSERTS on the cap's own key, so recording from the second
   shift CHANGES the decision rather than returning a unique-violation to
   somebody standing in a shop — verified: two sends, one row, the same id.
   **Tips have a writer at last.** There was none outside the worksheet, and
   the worksheet could not show you the shift the money was being divided over.
   It goes through `report_pooled_tips`, the definer function 029 added, not a
   direct update — RLS filters rows and not columns, and that function is what
   will let a supervisor report the day's figure without also being able to
   touch the corrected one beside it.
   **Migration 032 — a reason is required only when the premium is OWED.** 029
   made it NOT NULL with a non-empty check on the reasoning that a decision
   nobody can audit is worthless; that is true of the one that PAYS and false of
   the other two, and a pay period carries ninety findings, most of them a short
   shift that needed no meal at all. Demanding a sentence for each is how a
   reviewer learns to stop reviewing (Mark: "don't make it required to enter a
   'why' when waiving or declaring not owed"). The requirement moved onto the
   decision: `check (decision <> 'owed' or reason is non-empty)`.
   **Until 032 is applied a waiver with no reason is refused** with "null value
   in column reason violates not-null constraint" — verified against the live
   database, along with the owed-with-a-reason path and the upsert.
   **Audit scripts must `.order()` before paginating.** A `.range()` sweep with
   no ORDER BY returns rows in whatever order Postgres likes, so pages overlap:
   measured, 44,661 rows fetched held only 27,795 distinct ids. That fabricated
   duplicate shifts, 45-hour workdays and 112,338 double-time hours, and read
   exactly like a catastrophic data-integrity problem. The data is clean —
   44,661 rows, 44,661 distinct `source_row_key`. Check `ids.size === rows.length`
   before believing any whole-table audit.
   **Shipped 2026-08-22 — A BAKER'S DAY IS A NIGHT (migrations 061 + 062, both
   APPLIED).** Mark: "Homebase is simply checking if the shift is on the same
   day, and ignoring if there's enough turnaround time between shifts. It's
   using midnight to delineate between days instead of a 24 hour period that
   could start at 10pm."
   **HOMEBASE IS NOT THE DISAGREEMENT, and that is the first thing to know
   before touching any of this.** `lib/overtime` recomputes Homebase's split
   EXACTLY — 322 shifts over two pay periods, **ZERO disagreements** — because
   our workday was the same midnight-to-midnight default. So neither of the two
   obvious fixes does anything: "recompute it ourselves" writes the same numbers
   back, and "flag where we differ" is silent because there is no difference.
   The only variable is where the workday STARTS.
   Angelica Castellanos, 2026-08-13: 00:13→09:13 then 23:21→07:17, two shifts
   beginning on one calendar date, summed to 15.91h and billed 8 regular / 4 OT
   / 3.91 double with FOURTEEN HOURS of rest in the middle. 28 of these a year,
   all hand-corrected until now — which means the hand-corrections, not the
   overtime, were the non-compliant half. §510 is mechanical about hours over 8
   in a workday; §500(a) is what lets an employer move the workday, and it is
   the mechanism that makes Mark's preferred outcome lawful rather than merely
   cheaper. (Considered and declined, 2026-08-22: a "12 hours of rest between
   shifts" rule instead. There is no rest exception in §510, it has no statutory
   basis, and it pays LESS than the boundary on a short-rest day — most wrong
   exactly where the law is most right.)
   **061: `employees.workday_starts_at`, nullable, null = midnight.**
   PER EMPLOYEE and there is deliberately NO org default: eleven of
   thirty-seven people need it, and an org default of midnight is only the
   absence of a value. Front of house is untouched — their closing shifts start
   19:00 and no single boundary clears both crews.
   **14:00 WAS MEASURED, NOT CHOSEN.** Two error kinds scored at 15-minute
   steps across the whole clock: a *false stack* (two shifts on one workday with
   ≥8h rest) and a *broken double* (two back-to-back shifts split apart). Over
   4,331 shifts in 12 months — midnight 28/8, **14:00 back-of-house 2/8**. The
   kitchen's dead zone (no shift starts at all) runs **09:25 to 16:01**, so
   14:00 has four hours of margin either side. Org-wide 14:00 is 3× WORSE than
   doing nothing; the best org-wide value is 21:00 (15 total), which still
   leaves Erick Mejia's five 18:00 starts. And **every early-morning boundary is
   three to seven times worse than midnight** — 01:00–03:00 drags the
   766-shift-a-year just-after-midnight cluster backwards onto a day already
   full. Don't re-litigate the hour without re-running that sweep.
   **THE CHECK REFUSES ANYTHING UNDER NOON**, and it is load-bearing twice: at
   noon or later at least twelve of the workday's hours fall on the date it is
   named for, and — the real reason — the workday can then only move FORWARD
   from the punch date, so no shift can be pushed into a CLOSED period and no
   backfill is needed. It also refuses `24:00` (midnight by another spelling)
   and seconds (`lib/workday` reads whole minutes, so `14:00:30` would truncate
   silently).
   **`ParsedShift.workday` became `punchDate`**, and `clockInISO`/`clockOutISO`
   became `punchDate`/`clockOutDate`. Two names for one string is how this got
   confusing; the parser now CANNOT state a workday, which is honest, because
   the workday depends on the employee and a CSV parser has none.
   **THE BOUNDARY IS APPLIED IN THE `matched` MEMO, never inside `planImport`.**
   A resolver in the parser fixes the workday at plan time, so linking an
   unmatched person afterwards would import their shifts with the phantom
   overtime day this whole change exists to remove. Deriving it beside the match
   recomputes for free, because `matched` already depends on the manual links.
   **`source_row_key` keys on the PUNCH DATE, never the workday** — it is the
   upsert's conflict target and a workday can move, which would mint a new key
   for a row that already exists and DUPLICATE it. Verified before the change:
   field [1] equals `workday` on 321/321 Homebase and 1000/1000 FileMaker rows,
   so the swap left every existing key byte-identical and needed no backfill.
   **062 EXISTS BECAUSE 061 EXPOSED 028 READING THE WRONG COLUMN** (Mark, on the
   first real import: "Now we have two shifts that the employees have already
   been paid for counting towards the next pay period. I hate it."). 028 derived
   `pay_period_id` from `workday`, harmless while workday was always the punch's
   own date. **WHICH 24 HOURS THE OVERTIME IS COUNTED OVER AND WHICH PAYCHECK
   THE HOURS LAND ON ARE TWO QUESTIONS**, and 028 had already split the columns
   that answer them before reading the wrong one. `pay_period_id` now comes from
   `business_date`; **`workweek_start` STAYS on `workday`**, because the
   workweek exists for the weekly-over-40 and seventh-day rules and those are
   overtime rules. Its trigger had to be RECREATED to fire on `business_date`
   too — `create or replace` on a function does not widen its trigger's events
   (055's lesson). Measured: exactly 2 rows moved, back where they were worked.
   **THE MONEY DOES NOT MOVE ON IMPORT.** The importer writes `hours_*` from
   the SOURCE with `ot_decision: 'source'`; the boundary changes only `workday`,
   and therefore only what `proposeOvertime` PROPOSES. On the real 08-03→08-16
   period that is 80.04h stored (exactly what Gusto paid) against 59.73h
   proposed, flagged on **3 rows, not 24** — most moved shifts were alone on
   their workday either way. Adopting is decision 2 working as designed.
   **Consequence for the parallel run, which will otherwise read as a defect:
   Homebase does not know about the boundary and never will**, so its OT column
   disagrees with ours on the kitchen's evening shifts EVERY pay period, forever.
   That is the feature, not a reconciliation failure. ~3 rows a pay period.
   Screens: the field is on the employee record's Payroll block, and
   **`InlineValue` gained `kind="time"`** (delegating to `ui/TimeField`, which
   already handles Postgres's `HH:MM:SS` → `HH:MM`) — the third kind that does
   not click-to-edit, for the same reason as `date`.
   The import screen gained `uncoveredDays`, which blocks a commit whose punch
   dates no period covers — 028's `timesheet_period_editable(null)` is
   deliberately TRUE, so a periodless row writes with NO error, no trigger ever
   fills the column in, and `/timesheets` fetches BY `pay_period_id`: the shift
   would be invisible and never paid. It first keyed on the WORKDAY and blocked
   Mark's first real import; 062 is why it now keys on the punch.
   **AND THE BUTTON THAT FIXES IT WAS UNREACHABLE** — the "Open <period>" block
   was nested inside `targetPeriods.length === 0`, which was the whole story
   before 061 (either a period covered the file or none did). The case 061
   introduces is neither. A refusal naming something the screen gives you no way
   to settle is how people stop reading refusals — `closeReadiness`'s lesson,
   learned again. `whyCommitIsBlocked` is pure, exported and fixture-pinned so
   the sentence beside the Import button and its `disabled` cannot drift.
   **1122 fixtures pass**, and the suite also passes under UTC+14 and UTC−11,
   which is the real property `workdayFor`'s date arithmetic needs.
   **Shipped the same day: RECALCULATE, on the period bar** (Mark: "Is there a
   way to re-calculate the timesheets without re-importing them?"). There is,
   and it needs no file: the punch is stored as an INSTANT and the boundary is
   on the employee, so `workday` can be re-derived from what is already on the
   row. Before this, applying a boundary to shifts already imported meant
   dropping the same CSV through the importer again — which needs the file, and
   the file is the one thing you do not have three weeks later. It is the
   production module's **Recost** in payroll's terms: read today's inputs,
   restate one derived column.
   **IT WRITES `workday` AND NOTHING ELSE.** 028's trigger then re-derives
   `workweek_start` and 062's re-derives `pay_period_id` from `business_date`,
   which this never touches — so **a row cannot leave the period you are looking
   at**, and the punches, the decided hours, `ot_decision` and every note are
   untouched. The money follows separately and on purpose: moving a workday
   changes what `proposeOvertime` PROPOSES, and adopting stays a per-row
   decision (decision 2).
   **A row with NO PUNCH is skipped.** An `adjustment`'s workday was typed by
   hand and there is nothing to derive it from; recalculating it would move
   somebody's sick day to whatever the epoch renders as.
   It COUNTS BEFORE IT WRITES and names every shift that would move, because
   the answer is usually zero — and it checks the row count afterwards, since a
   closed period matches no policy, changes nothing and returns NO error.
   Verified against the live 08-03 → 08-16 period, all three directions: **0
   moves as things stand** (idempotent, the pay period is already right), **24
   would move back if every boundary were cleared** (the undo path, and exactly
   the 24 that moved), and giving a 6:30am starter a 14:00 boundary moves
   **nothing** — which is the front-of-house-is-untouched property demonstrated
   on a real person rather than argued.

   **The genuinely simplest fix was never a code change and is still open:**
   1,148 of the crew's 1,490 shifts already start 00:00–03:59, and only **101
   evening starts** cause every bit of this. Moving those to 00:0x would delete
   the feature rather than configure it. Ops decision, not ours.

   **Shipped 2026-08-05 — PAYROLL BENEFITS (migration 033, NEEDS APPLYING).**
   Flat money somebody earns for working a shift: the commuter allowance, and a
   shape general enough for the overnight differential and reimbursements Mark
   has already named. It fills `custom_earning_commuter_benefit`, which
   `lib/gustoExport` had been emitting as a hardcoded empty string — so the
   export as it stood was **$432 a pay period short across five people**.
   Three measurements out of the real FileMaker export decided the design, and
   each one killed a piece of the FMP model:
   **(a) `locations` is not touched at all.** FMP had a boolean + amount +
   period on Location AND an amount + unit + repeating location list on the
   employee. The employee's list classifies every stamped shift on its own:
   Angelica Castellanos (configured DF02) 0 of 359 DF01 shifts, 4 of 4 DF02;
   Erick Mejia 0 of 615 DF01, 32 of 34 DF02. DF01's flag is on with **no
   amount**, so the location row isn't even the source of the money — it carries
   one redundant bit, and a second place to state one fact is 016's
   `nextDeliveryDate` trap. The amount cascades entitlement → benefit default,
   design rule 6's shape.
   **(b) Nothing is stamped onto a timesheet.** FMP's script wrote a dollar
   figure at import and **the stamp has holes** — Casildo Herrera worked seven
   consecutive DF02 overnights in July 2024 unstamped, and two configured people
   (one active) were never stamped at all. Nothing surfaced it, because a
   stamped number cannot explain itself: a $0 and a person who was never
   entitled look identical. So an accrual is DERIVED (decision 3's posture) and
   FROZEN at export (decision 10's), which is exactly how tips already work.
   **(c) It paid per SHIFT** — 32 employee-days carry two $12 stamps, 16 of them
   in 2026 — while both FMP unit fields literally read `Day`. Mark's reading is
   per shift and the money agrees with him; seeded `per_shift`, one tap to
   change on the new screen.
   Schema: `payroll_benefits` (the catalog: code, name, `gusto_column`, unit,
   `default_amount`, **`is_active`** — that spelling, because
   `catalog/ActiveToggle` hardcodes `.update({ is_active })`), `employee_benefits`
   (the entitlement, **`location_id` NOT NULL**, one row per shop), and
   `timesheet_benefits` (the frozen snapshot, **SELECT-only policy and no
   insert/update/delete at all** — the sole writer is `freeze_pay_period`, which
   is definer and bypasses RLS, so the snapshot is structurally unwritable from
   the app).
   **The entitlement's constraint is an EXCLUSION, not a unique index** (027's
   btree_gist idiom, second outing): `(org, employee, benefit, location)` plus
   `daterange(starts_on, ends_on, '[]')`. A plain unique index would make the two
   date columns decoration — "$12 through June, $15 from July" would be
   inexpressible — and this makes "which entitlement pays this shift" a TOTAL
   function, which is what lets `lib/payrollBenefits` be deterministic. Its one
   cost is real: no `on conflict` target, so the backfill selects-then-updates
   rather than upserting.
   **Entitlement writes are deliberately NOT gated on period editability**,
   unlike `break_premiums` and `tip_pools`. An entitlement is a standing fact
   about a PERSON (the class of `employees.excludes_tips`, which 028 left
   ungated for the same reason); `period_editable_on` takes ONE day while an
   entitlement carries an unbounded range spanning closed periods; and what
   decision 8 protects is money already PAID, which the freeze protects instead.
   **The snapshot is what earns this table its ungated write** — which is also
   why `mergeFrozen` makes the frozen figure WIN, backwards from `ExportPayroll`
   preferring its tip recompute. That asymmetry is commented at both ends; a
   tidy-up would restate July's dollars from a September correction.
   **`freeze_pay_period` gained a 4th argument and 033 DROPS IT FIRST.**
   `create or replace` cannot change an argument list — it would create an
   OVERLOAD and leave 029's three-arg version live, so a stale tab would keep
   freezing pay periods with no benefits in them and no error. With the drop a
   stale tab gets PostgREST's `PGRST202`, which is loud. The benefit payload is
   **sparse by construction** (most shifts accrue nothing), so it checks that
   every row it was GIVEN landed rather than that every timesheet is covered —
   the opposite of the allocations guard beside it — and it DELETES the period's
   accruals before inserting, or a reopened period keeps an orphan for a shift
   that stopped qualifying.
   `lib/gustoExport` is now **data-driven for non-hours earnings**: a new
   `EARNING_COLUMNS` allow-list, `ExportRow.earnings` (a plain **object, not a
   `Map`** — the fixture harness compares with `JSON.stringify` and two different
   Maps both stringify to `{}`, so every assertion would pass unconditionally;
   verified), an optional 4th argument to `buildExportRows` so no existing caller
   moved, and `toCsv`'s eight positional `""` literals replaced by a lookup.
   **It still walks `GUSTO_COLUMNS` and never the earnings map**, so no data can
   add a column — which is what keeps the sick-hours assertion load-bearing, and
   is itself pinned by a fixture that puts `sick_hours` in the map and demands a
   byte-identical file. `touched` widened with `earnings.keys()` or a
   benefit-only person is dropped.
   UI: a read-only **Benefits** block in the timesheet row expansion — the two
   above it are decisions and carry editors, this one explains itself instead,
   naming *"Earned at DF02, and this shift was at DF01"*, which is Angelica's 359
   rows in one sentence and the thing FMP's stamp could never say. A **Benefits**
   column on the worksheet's Hours block (dollars, beside Premium's hours) and a
   per-benefit total on the export summary bar. **`/payroll-benefits`**, a list
   with no detail route (`/shop-sections`' shape) where `gusto_column` is a
   `PickList` over `EARNING_COLUMNS` so a typo is *unenterable*. And a **Payroll
   block on the employee record** carrying the entitlements plus the four columns
   that had **no UI writer anywhere in the app** — `gusto_id`, `homebase_id`,
   `primary_wage_type`, `excludes_tips` — while `exportReadiness` had been
   reporting "N people have no Gusto id" with no way to act on it.
   `migration/backfill-employee-benefits.mjs` (dry run by default) recovers the
   13 people × 19 rows and **diffs its own answer against FileMaker's 4,663
   stamps**, which is what actually proves the rule. It sets
   **`starts_on = 2022-06-27`**, and that is a measurement rather than a guess:
   zero stamps exist before that date in seven years and the first day is a solid
   block of people. Without it Gaspar López Alarcon alone picks up 343 days in
   2020–21 that nobody was ever paid for.
   **The diff's verdict: ZERO days where a currently active person was paid and
   we would not**, and 56 days FileMaker's script missed (Casildo's seven among
   them). All 531 "only FileMaker" days belong to eight **inactive** people whose
   FMP config was cleared when they left, or to a **punchless bare-stamp row** —
   FMP sometimes carried the $12 on a third row with no position, no punches and
   no hours, which the punch-based rule correctly refuses.
   Verified end to end: all 33 migrations apply on the Docker harness, the
   exclusion constraint refused an overlap and accepted an abutting range, the
   freeze refused bogus ids BY NAME and replaced rather than duplicated on
   re-freeze, 479 fixtures pass (29 new, each rule checked by breaking it), and
   **the real export rendered through the real components over the real
   07/20–08/02 pay period matches Mark's actual Gusto file person for person —
   $432.00 vs $432.00.**
   **Qualification is PUNCH-BASED, not hours-based**, and that is the choice a
   rewrite would most likely flip: a flat allowance pays for showing up, so a
   quarter-hour shift earns it in full and a nine-hour PTO adjustment earns
   nothing. There is **no per-hour or percentage unit and there must never be
   one** — a percentage would be a percentage of wages, which needs a rate, which
   decision 1 forbids storing.
   **Shipped 2026-08-21 — THE WORKFLOW GUIDES YOU** (Mark: "there's a workflow
   here and the app should help guide the user through it as various events
   occur. Identify those events and proper responses to them").
   **THE RULES ARE DATA, IN `lib/orderWorkflow`, AND THEY CLOSE THEMSELVES.**
   The six behaviours Mark listed are the same rule from two directions — an ACT
   implies a DATE ("the quote went out, so it was sent today"), a DATE implies a
   STATE ("a quote was sent, so this is a Quote"). Wired as six handlers they
   CHAIN: downloading a quote asks "set the sent date?", and the write answering
   THAT asks "move to Quote?" — two dialogs for one act, the second looking like
   the app second-guessing the answer you just gave. So `whatFollows` closes the
   chain itself and the caller asks ONCE, with a line per consequence.
   **A FINDING THAT CHANGED THE ASK: emailing already stamped its own date.**
   `send-special-order-email`'s `STAGE_COLUMN` has always written
   `quote_sent_at` / `invoice_sent_at` / `receipt_sent_at` / `order_printed_at`,
   so two of the six were already half-built. What was missing everywhere was
   that **nothing ever touched `status` or `todo`**.
   **DOWNLOAD NOW STAMPS SILENTLY TOO** (Mark's call over asking): downloading
   is how a document gets printed, so both routes out of the card record the
   same fact the same way — and **only PREVIEW leaves no trace**, because
   previewing is how you check the wording before committing to either. The
   stamp is skipped when the date is already there: a second copy printed next
   week is not a second send, and overwriting would move the date the customer's
   own copy carries.
   **THREE GUARDS, each a real order that would otherwise break.** *Forward
   only* — 8,330 orders came out of FileMaker and backfilling a quote date onto
   a finished one must not drag its status back. *Never a template or standing
   order* — 051's `special_orders_status_iff_order` makes `status` NULL exactly
   when `kind` isn't `order`, so proposing one proposes a write a CHECK refuses,
   which is the one refusal `InlineValue` cannot explain. *Never a cancelled
   order.* A fourth lives in the CALLERS: **only ask when a date goes EMPTY →
   SET**, since only they know what was there before — correcting a typo is not
   a workflow event, and unsetting a date is somebody undoing something.
   **IT ASKS AFTER THE WRITE, which is why `CompletionDates` uses `onWrite` and
   not `alsoUpdate`** — the latter composes the statement and so runs BEFORE it,
   which would put the question on screen for something that hadn't happened and
   leave it there if the write then failed. `onWrite` carries the `.select()`
   discipline with it, or a silently-refused write would report success and then
   offer to advance an order that never moved.
   **EVERY LINE IS INDIVIDUALLY UNTICKABLE**, and that is decision 4 surviving:
   the app may suggest a to-do and must never write one, so a pre-ticked box you
   can clear keeps the human the author while saving the typing. All accepted
   lines land in ONE statement, so an order can never rest half-advanced — and
   054's trigger then narrates it as one line ("Status changed from lead to
   order; To-do set to Print Order"), so the history reads the same whether a
   person typed it or accepted it here, which is true: they did accept it.
   **THE CATCH-UP OFFER IS THE QUIET HALF** — `StatusCatchUp`, the receiving
   screen's `→` beside the Status cell, yellow, dismissible. The prompts catch
   the moment; this catches the 8,330 imported orders, a date set from a screen
   that doesn't ask, and anyone who declined on Tuesday and wants it on
   Thursday. It reads the DATES ONLY and never the to-do: a stale to-do is
   somebody's note to themselves, where a status behind its own evidence is the
   record disagreeing with itself.
   **A SETTLING PAYMENT OFFERS THE WHOLE STEP** (Mark's addition to his own
   list) — recording the money IS the paid event. It fires on the BALANCE, not
   the payment, so a deposit on a wedding order doesn't ask; and it reads
   `balance - value` because the server hasn't re-rendered yet.
   **A `Leads` BAND WAS BUILT THE SAME DAY AND WITHDRAWN** (Mark, 2026-08-21:
   "I changed my mind about the leads band. lets revert that change. Flagging
   the order is enough for now. I may want to revisit this in the future"). It
   pinned `source === "inquiry"` leads to the top of the list under their own
   band and exempted them from the `upcoming` date filter. **Reverted whole** —
   no dead predicate left behind, since git has it and unreachable machinery is
   a liability rather than a head start.
   What made the reversal safe is that **058's flag already does the job**: a
   new inquiry arrives with `flag_reason` "New Inquiry", which paints the row
   FULL-WIDTH RED and puts it top of `needsAttention`. Confirmed on the live
   list — #10015 arrived flagged and reads as a red row in the ordinary date
   band, which is the noticing this was meant to provide.
   **The one thing that went with it, and is worth knowing if it comes back:**
   the default `upcoming` view wants `event_date >= today`, so an inquiry whose
   customer left the date blank, or asked for a day that has since passed, does
   not appear there at all — it is reached through Needs attention, the Lead
   status filter, or All orders. Measured at the time: 1 of the 3 real inquiry
   leads (#10014, dated yesterday and already worked). If this is revisited, the
   VISIBILITY question is the substantive half; the band is presentation.
   Verified against the live database and the order restored afterwards: setting
   Invoice paid offered both consequences and wrote them in one statement,
   setting Order printed offered the single one as a sentence with no redundant
   checkbox, and the catch-up appeared on an order whose quote had gone out
   while its status still read Lead. **1094 fixtures pass**, 23 new, each rule
   checked by breaking it.
4d. 🚧 **Invoices** — the third module, and the one that finishes the purchasing
   loop (Mark, 2026-08-04, after using the receiving screen: "this reconcile PO
   workflow is new to me and I love it… Every time we upload an invoice to a
   purchase order we could create an invoice record… It would complete the work
   flow"). Specced in `docs/invoices-brief.md`. **NEEDS MIGRATIONS 025 + 026.**
   The reading half already worked; what never existed was a RECORD — something
   with a status, a due date, and an identity independent of one attachment on
   one PO. That absence is also why two limitations the receiving brief flagged
   stayed open (nothing routes you to orders awaiting receiving; one invoice,
   one PO).
   Mark's six locked decisions: **all vendor bills**, not just PO-born ones (the
   landlord and the plumber are already vendors with `order_type: 'none'` and
   never produce an order); **record + list + approval in v1, no QuickBooks
   sync** but leave the seams (**THE SEAMS ARE NOW USED — see build step 4l**,
   which is live on the real books; `vendor_invoices.external_ref` holds the
   QuickBooks id, token and attachment ids exactly as 025 predicted); an **explicit approval, Manager and Owner only**;
   **many-to-many is real**; the tables are **`vendor_invoices` /
   `vendor_invoice_lines`** (a bare `invoices` is a name the unbuilt Quotes &
   Orders module will want — the collision `purchase_orders` already dodged);
   and **attaching + reading an invoice on a PO files it automatically**.
   **THAT LAST ONE WAS REVERSED 2026-09-01** (Mark, having used it: "when I
   added a scanned invoice document to a purchase order so I could reconcile,
   the app created an invoice record. I think this is premature … it should be
   created only once a purchase order is reconciled and closed"). Attaching
   still auto-READS — the reading is what receiving reconciles against, and it
   is wanted the moment the document is on the order — and it no longer creates
   a BILL. A record on /invoices is something somebody will be asked to approve
   and pay, and a scan taken to help count a delivery is not yet a claim that
   we owe anybody. See "FILING IS AN ACT OF CLOSING" below.
   **The many-to-many lives on the LINE** — `purchase_order_id` +
   `purchase_order_item_id` on `vendor_invoice_lines`, no header FK and no join
   table. It is the same granularity `matchInvoiceToOrder` already produces, so
   persisting a match is a one-column write; both directions are one index; and
   a derived link cannot claim a relationship none of its lines support. **Split
   and merge then need no schema at all**, and only the MERGE direction costs
   any UI: one order invoiced in two parts is two invoices with disjoint
   subsets, and there is no unique constraint to collide on. The coarser
   `purchase_order_id` covers a freight line and an order you know is right when
   every line match failed. Safe to denormalize — `purchase_order_items.po_id`
   is written at insert and never updated anywhere in `web/src` (verified).
   **Lines are real rows, not the jsonb reading.** 019's `extraction` keeps its
   own meaning as the raw reading on the document row; the chain is document →
   raw reading → seeded lines → corrected lines. The decisive argument is that a
   line gets EDITED and a jsonb path is POSITIONAL, so a re-read renumbers the
   positions and silently retargets every correction — data loss with no symptom.
   **The document reuses the PO attachments table and bucket.** 018's four
   policies read `(storage.foldername(name))[1]` — the FIRST segment — and test
   nothing else, so `{org_id}/invoices/{invoice_id}/…` is authorized as it
   stands. 021's separate-bucket precedent doesn't apply, and the deciding test
   is RLS: 021 needed its own bucket because employee documents have a DIFFERENT
   audience. `extract-invoice` needed no structural change at all.
   **Approval cannot be a policy** — RLS filters rows and "only a manager may
   set `approved_at`" is a column rule — so `set_vendor_invoice_approval` is a
   definer function (the `set_my_member_profile` pattern) that returns rows so
   the caller can tell refusal from success. `lib/roles.ts` gains
   `canApprovePayment`.
   **No `paid` status and no payments table**: payment is a fact QuickBooks will
   own, and two truths about the same money is worse than one truth elsewhere.
   The check constraint widens in one line later. **THAT PREDICTION HELD AND IS
   NOW LOAD-BEARING** (4l): because this module never stored a payment,
   QuickBooks is the only place an A/P payment exists, so pulling the balance
   back creates no second source — which is exactly why the SAME pull is refused
   on the A/R side, where `special_order_payments` already answers it. **Duplicate detection warns
   and never blocks** (`findPossibleRehires`' rule): a credit memo legitimately
   repeats the number it credits, and Postgres allows unlimited NULLs in a
   unique index, so a constraint would silently skip the numberless rent bill —
   the row most likely to be entered twice.
   Shipped: `/invoices` (aging tiers, three totals, group bands by status /
   vendor / due-date BUCKET, default `open` + due-date ascending) and
   `/invoices/[id]` (document left, sticky NOT measured — receiving earned its
   ResizeObserver by being a standing task; this is a desk screen). Approve is a
   WHITE button in the page's own flow: the buttons here are a row of peers,
   which CLAUDE.md names as exactly the case that is NOT the
   `DIALOG_COMMIT_CLASS` exception. Plus creation from a reading, "File as
   invoice" for the ~10 stored extractions (no backfill — a PL/pgSQL matcher for
   ten rows is unthinkable, and those readings predate the new fields anyway),
   a New invoice dialog, the printed-PO-number proposal, "Link to PO…", and a
   per-line RowMenu.
   **The extraction schema grew eight header fields and one per line** — due
   date, terms, the customer's PO number (header AND line, because a
   consolidated invoice prints it per line), subtotal/tax/freight/other, and
   `is_credit`. Tax and freight matter because a delivery fee is on the invoice
   and on NO purchase order line, so without them `invoice_total` never equals
   the sum of the lines. **Needs `supabase functions deploy extract-invoice`.**
   **Receiving prefers the FILED invoice over the last read** (`matchesFromLinks`),
   falling back to `latestRead` so day one is a no-op. `closeReadiness` gained a
   fourth argument and its paperwork caveat split in two — nothing attached, vs
   paperwork on file that isn't recorded as a bill — and it deliberately does
   NOT ask whether the bill is approved: a delivery can be complete Friday and
   the bill approved Tuesday.
   **THAT FALLBACK IS THREE TIERS SINCE 2026-09-01**, and the middle one is now
   the ordinary path: filed invoices, else **`billsFromReadings`** (the
   readings on the order, joined into bills), else `latestRead`. The middle
   tier had to exist the day filing moved to close, because until then
   receiving could lean on the FILED records having already been joined and
   unioned for it — `latestRead` alone reconciles against ONE document.
   Measured on the real 132-181178-02, whose Chefs Warehouse 73535581 was
   scanned as two pages: `billsFromReadings` gives **one bill of 11 lines,
   the same set of printed lines the filed record actually holds**, where
   `latestRead` alone offers 7 — so four billed lines would have read as never
   billed. `latestRead` stays the floor and still earns it: it is the only tier
   that covers a document read under some other KIND, which is not a bill and
   so never becomes one above.
   **Shipped 2026-08-25 — THE INVOICE SAYS WHICH ORDER IT IS FOR, and now we
   check** (`printedPoDisagreement` in `lib/invoices`, a chip on receiving's
   `InvoiceSummary` band). The reader had captured `purchase_order_number` since
   the 2026-08-04 redeploy — 22 of 42 stored extractions carry one — and NOTHING
   had ever compared it to the order's own number, so the data sat there unread.
   Found by Mark reconciling 8/17 at DF01 and noticing by eye that the numbers
   on two invoices weren't ours.
   **The cause was a one-off and the check is still worth it**: he was out of
   town, that week's ordering ran through FileMaker, and both shops' invoices
   came back carrying FMP's own numbering — Chefs Warehouse `132-18033-01`
   against our `132-181184-01`, Unified Paper `142-18041-01` against
   `142-181187-01`. FMP's run sat at **18029 on 2026-07-20**, its last day
   before the app took over, and 18033/18041 continue it. Ordering is back in
   the app and this exact cause is retired, but a vendor keys our number BY HAND
   (Chefs Warehouse prints an order taker on every invoice), so filing an
   invoice against the wrong order stays a live way to lose money.
   Three rules, each a real invoice rather than a hypothetical.
   **SILENCE IS NOT DISAGREEMENT** — BakeMark prints no customer PO number at
   all, so an absent value never warns, or the one vendor whose paperwork is
   built differently flags every delivery and the mark stops meaning anything
   where it does. **ANY MATCH IS AGREEMENT** — a consolidated invoice
   legitimately names several orders (which is why `printedPoNumbers` reads the
   lines as well as the header), so ours being among them is agreement, not a
   partial one. **PUNCTUATION IS NOT A MISMATCH** — Chefs Warehouse printed
   `132 181164 01` on 2026-08-10 for our `132-181164-01`, spaces for hyphens, so
   it compares through `normalizeInvoiceNumber`, which is what the printed-number
   LINK already uses: the warning and the link must not disagree about what "the
   same number" means. What it returns is what is PRINTED, never the normalized
   form — the reader is checking paper against a screen, so the screen shows the
   characters on the paper.
   **Yellow FILL, not red and not `text-mark`** (1.43:1 on white). Red says
   something is WRONG; nearly every cause here is benign and none makes the
   delivery in front of you incorrect. The chip says what it means in words
   rather than only in its `title`, because the iPad has no hover.
   **Deliberately NOT in `closeReadiness`.** That confirm names what is
   unresolved and lets you through, and its own rule is that naming something
   the screen gives you no way to fix teaches people to stop reading confirms —
   you cannot change what a vendor printed, and in the common case there is
   nothing to settle. It is a question asked BEFORE you count, not a gate on
   finishing.
   Verified by rendering the real `InvoiceSummary` in Node over the live rows
   (the `PoPdf` idiom): both 8/17 invoices warn with the right copy, 8/10's
   spaces stay silent, and BakeMark stays silent. 8 fixtures, each of the three
   rules checked by BREAKING it — dropping the silence guard reddens BakeMark,
   a raw `===` reddens the spaces case, and `every` for `some` reddens the
   consolidated case.
   Not done, and worth asking about: the same check on `InvoiceDetail`, where a
   FILED invoice is linked to an order and `printedPoNumbers` is already read
   for the link proposal.
   Also shipped: **Delete on invoice detail**, found by using the module — Void
   covers "this isn't payable" and not "this shouldn't exist", and filing was
   one tap with no way back. EmployeeActions' template, and it removes
   invoice-ONLY documents (row then object) while leaving a document that also
   belongs to a purchase order on that order.
   276 fixtures pass, and **the loop was walked end to end on real data and left
   as found** — see the migrations-applied section below for what that measured,
   including 15 of 15 lines joining by SKU on the real Chefs' Warehouse invoice.
   Known pane artefact, not an app bug: `router.refresh()` after a write can
   take several seconds, so a probe run 1.5s after a click reads as "nothing
   happened" — wait longer or re-navigate before concluding anything.
   **Shipped 2026-09-01 — FILING IS AN ACT OF CLOSING** (Mark, having used it:
   "when I added a scanned invoice document to a purchase order so I could
   reconcile, the app created an invoice record. I think this is premature …
   it should be created only once a purchase order is reconciled and closed …
   perhaps with a confirmation dialogue right before so the user can choose not
   to create an invoice"). No migration, and no new UI: **the feature he asked
   for had been built on 2026-08-27, at his own request, and could never
   appear.** `unfiledReadings` returns documents that are READ AND NOT YET
   FILED, so by close time auto-filing had already consumed every one and the
   ticked box in the close confirm was dead code on every order that had ever
   been reconciled. Two features fighting, and the eager one won every time.
   **READING AND FILING ARE TWO ACTS, and only the first happens on attach.**
   Auto-read STAYS — the extraction is what the receiving screen reconciles
   against, and it is wanted the moment the document is on the order — and the
   ~18 lines in `useAttachmentActions.read()` that turned it into a BILL are
   gone. The distinction is what a record MEANS: an extraction is a proposal to
   compare against, where a row on /invoices is something somebody will be
   asked to approve and pay, and a scan taken to help count a delivery is not
   yet a claim that we owe anybody.
   Almost nothing was lost, because receiving was built on the EXTRACTION and
   not on the record — `matchesFromLinks` was already documented as preferring
   a filed invoice with the reading as "the ordinary path", the `→` chips, the
   price buttons, the invoice band and "Receive n from invoice" all read the
   extraction, and MANUAL MATCH writes `product_id` onto the PO LINE, so it
   survives with no record at all. The one real loss was the BACKORDER case,
   which is why the fallback grew its middle tier — see `billsFromReadings`
   above.
   **THE CONFIRM NO LONGER ARGUES WITH ITS OWN OFFER.** `closeReadiness` takes
   a fifth argument, the number of readings the confirm is about to offer to
   file, and suppresses ONLY "the paperwork on file isn't recorded as a bill
   yet" — which would otherwise fire on nearly every order, one line above the
   ticked box that settles it. That is this module's own rule from the other
   side: a confirm naming something the screen gives you no way to fix teaches
   people to stop reading confirms, and so does one naming something they are
   settling as they read it. Paperwork nobody has READ produces no offer and is
   still named, because reading it is a step somebody has to take; "nothing
   attached" is never suppressed, since no offer can close that gap.
   Known and intended: **an order nobody ever closes never produces a bill.**
   The standing "File as bill" on PO detail and "File as invoice" on the
   document are the escape hatch, and they now appear routinely rather than
   almost never.
   Verified live and left exactly as found (53 invoices, 462 lines, 62
   attachments, one storage object, status restored): a REAL invoice PDF
   attached to 142-18017-01 through the app's own file input showed only
   "READING …" and never "FILING IT AS AN INVOICE…", and `vendor_invoices` did
   not move — where the old code would have minted invoice 120274 and 12 lines.
   With that second reading of the SAME number on the order the band still read
   **12 OF 12 LINES MATCHED**, which is `billsFromReadings`' multiset working on
   real data: concatenating the two would have doubled every SKU, and the
   matcher refuses a duplicate, so it would have read 0 of 12. Then the close
   confirm on BOTH screens read "Still unresolved: · 1 line's price differs
   from the catalog" over a ticked **"Also file invoice 120274 as a bill"**,
   with the bill caveat correctly absent. Cancelled; nothing written.
   **Shipped 2026-09-02 — A LINE'S CHARGE IS MAINTAINED, NOT DERIVED** (Mark:
   "I find it annoying to have to enter all the values into the invoice anytime
   I want to change something. Extended should be calculated, full stop. The
   total should be calculated as well. If it's off, we should be warned when
   'approving' and allowed to cancel and edit"). It shipped as
   `extended = qty x unit_price` and **the first real invoice it was verified on
   disproved it.**
   **A BROKEN CASE IS NOT qty x unit_price, and the pack column says so.** Chefs
   Warehouse 73358289 bills packs `24/1 LB BC` / `12/750 ML BC` — **BC**, broken
   case — printing the CASE price as the unit price and charging for EACHES:
   seven pounds out of a $62.68 case is **$18.28**, not $438.76. Measured over
   the whole invoice, deriving the charges turned **$472.13 into $1,952.90** on
   a bill already approved, and the screen showed a header total of $472.13 over
   an Amounts block reading $1,952.90 — a screen may disagree with the page, it
   may never disagree with itself.
   So `extended` STAYS THE STORED CHARGE and stays typeable, and what is
   calculated is the MOVEMENT: **`rescaledExtended` scales by the rate the line
   was really billed at** (`extended / qty`), never by the printed unit price.
   Seven units at $18.28 become fourteen at $36.56; the struck topping on
   BakeMark 452660 at 2 x $88.90 becomes 0 x anything = $0.00; a price edit
   moves the charge in PROPORTION, so a broken case stays one. It is the
   derivation receiving already uses, and for the stated reason — it "survived
   catch-weight lines". Multiplication is the fallback only where there is no
   prior charge to scale, which is a line somebody is typing from nothing.
   **The totals are summed from the CHARGES**, so a rent bill with no lines
   keeps its typed figure (null, never 0 — that would be a claim nothing is
   owed) and nobody types a subtotal again. `totalDisagreesWithDocument` names
   the gap against what the PAGE said at approval and lets you through, which is
   `closeReadiness`'s posture and the half of Mark's ask that survived intact.
   **A quantity of nothing carrying a charge is MARKED** — yellow, on the cell —
   because that is not a pricing subtlety, it is a struck line with a figure
   left behind, which is precisely what 452660 was.
   The regression fixture is the Chefs Warehouse invoice itself and it exists to
   go RED if anybody makes this a computation again; checked by breaking it, 2
   go red and reproduce the $1,952.90.
   **Shipped 2026-09-02 — THE INVOICE READS WHAT THE DRIVER WROTE ON IT.** The
   reader had SEEN the handwriting all along and buried it in a notes paragraph
   behind a caret: BakeMark 452660 sat on screen at $1,001.26 while the page in
   the folder said $823.46, with two cases of whipped topping struck out and a
   credit written by hand. So the extraction schema gained
   **`corrected_total`** on the header and **`struck_through`** on the line,
   both OPTIONAL in TS and required in the schema — the `ship_date` shape, so
   every reading stored before this stays valid and simply never carries them.
   `handAmendment` derives the band from the reading and stores NOTHING, so a
   re-read updates it and nothing has to be kept in step; it sits at the TOP
   because it changes what the whole document means. **Taking the corrected
   total writes ONE FIELD and deliberately not the lines** — zeroing a struck
   line's charge is a second judgement, and a button that quietly rewrote seven
   rows would be doing more than it says. **Needs `extract-invoice` redeployed**
   to see either field; done 2026-09-02.
   **Shipped the same day — THE DETAIL SCREEN IS A DOCUMENT WITH A LEDGER
   BESIDE IT** (Mark, wanting room for the lines). The total sits at the
   document's right edge level with the invoice number, the purchase orders
   moved UNDER the document at its own width, and every command — Void, Delete,
   Approve, **and Send to QuickBooks** — shares one row, with each button's
   explanatory prose spanning BENEATH the row rather than beside its own button.
   That prose placement is what let the QuickBooks bands split: the button joins
   the row of peers and only the sentence stays in the yellow.
   **`order-last basis-full` IS THE MECHANISM** — the prose is a flex sibling
   that claims its own line, so the layout does not depend on DOM order and a
   band can be added without re-threading the row. His ask was VERTICAL room and
   the first pass gave horizontal (Mark: "I meant vertical, not horizontal
   space"), which is why the row is measured with `useFillToBottom` at a **560**
   floor — 660 became the height rather than the floor and left the page
   scrolling 58px.
   **A BILLED QUANTITY THAT DISAGREES WITH WHAT WE RECEIVED IS FLAGGED, NOT
   COLUMNED** (Mark, reversing a Received column he had asked for an hour
   earlier: "just flagging when the billed qty != received qty is better"). A
   column spends width on every row to answer a question about a few; the flag
   is yellow on the billed cell and names the received figure. `receivedFor`
   reads the PO line the invoice line is already joined to, so it costs no
   query. **A PO edited after its invoice was filed does not push anything into
   the invoice** — they are two documents, and this is the app noticing they
   have drifted rather than reconciling them for you.
   **The LIST gained a PO Date column** after PO (sortable and groupable — a
   delivery's date is what you scan a week's bills by) and **lost Tax and
   Freight**, which were two mostly-empty columns of money nobody reconciles at
   list level. **Bulk approve and bulk delete** joined the selection bar;
   approve goes one-by-one through the definer RPC with each row count checked,
   because 025's approval is a COLUMN rule and there is no batch form of it.
   **The report lands on the LIST, not the bar** — clearing the selection
   unmounts the bar, so a summary rendered there vanishes at the moment it is
   read.
   **BOTH AMOUNT CAVEATS ASK ABOUT THE PAGE, NEVER ABOUT OUR OWN COLUMNS**
   (Mark, 2026-09-02, the same day: "there's a warning that isn't appropriate …
   after I changed it back the warning didn't go away"). `amountReconciliation`
   and `lineSumReconciliation` read the STORED columns, which was right while
   those were transcribed off the document and became meaningless the moment the
   figures were computed from the lines: the stored columns are now a CACHE the
   LIST reads, maintained on every line write, so comparing the lines against
   them asks only whether our own bookkeeping kept up. The tell is that the
   Amounts block beside the caveat shows the COMPUTED subtotal — 15490761 read
   *"the item lines come to $535.33 against a subtotal of $452.29"* over a block
   saying $535.33, **naming a number that appeared nowhere on screen**, which is
   a warning nobody can act on. Both now take the READING's own foot
   (`invoiceCharges`), so they are facts about the document again, exactly as
   their wording always claimed, and both go quiet on a bill with no reading.
   **The write that maintains the cache now CHECKS ITS OWN ROW COUNT** — it took
   `.select("id")` and discarded the answer, so a second statement that changed
   nothing left the line right and the invoice's figures behind it, with the
   LIST quoting the stale one. That is how 15490761 came to sit at $452.29 while
   its own lines and its own scan both said $535.33.
   Its cache was repaired by hand, and the guard on that repair is the rule for
   any future one: **only where the lines AND the document agree and the cache
   alone is the odd one out.** Where a document disagrees with its lines that is
   a real finding — 96490390 and 120421 are two — and overwriting it with a line
   sum would destroy the very thing the approval caveat exists to name.
   **1572 fixtures pass.**

   **Shipped 2026-09-03 — AN APPROVED INVOICE'S FIGURES ARE LOCKED (migration
   089, APPLIED 2026-09-03).** Mark: "I think a lot of the invoice should not be
   editable once it has been approved for payment. The billed qty, unit price,
   tax, freight, and other fields at the very least, and any others you
   recommend. If the user wants to edit these things, they need to withdraw
   approval first." Followed by the question that decided the migration's
   second half: "what happens to invoices already sent to QBO if the user
   edits the invoice?"
   **A TRIGGER, NOT JUST `canEdit`** — `canEdit` has been role-only
   (`canWriteCatalog`) since 025 and has never once asked what STATUS an
   invoice is in, so every field has been writable straight through PostgREST
   by any purchaser+, approved or not. RLS cannot express "you may not CHANGE
   this column" either — `USING`/`WITH CHECK` see one row's OLD or NEW state,
   never a comparison BETWEEN them. So the lock is a `BEFORE UPDATE` trigger on
   `vendor_invoices`, plus a pair on `vendor_invoice_lines` (one to refuse,
   reading the PARENT's status by subquery; one AFTER trigger to stamp the
   parent once the write has actually gone through). **NOT ROLE-SCOPED** — an
   owner is blocked from touching an approved bill's figures exactly as a
   purchaser is, because the thing being prevented is changing what was
   approved without first taking the claim back, which has nothing to do with
   who is doing it.
   **WHAT LOCKS: invoice_number, invoice_date, due_date, vendor_id,
   location_id, tax, freight, other_charges, subtotal, total** on the header;
   **qty, unit_price, extended, kind, purchase_order_id,
   purchase_order_item_id** on a line. `kind` locks because the freight/item
   toggle moves money through a side door — `computedAmounts` counts a
   freight-kind line differently without touching qty or price. The PO link
   locks because relinking a line changes what `receivedFor` is measured
   against, which is part of what got approved. **NOT locked**: notes and
   terms (header) — pure annotation — and product_id, description, pack
   (line) — catalog/identity text, correctable without reopening a correctly
   priced bill. Also untouched: attaching/reading paperwork, Void, Delete,
   Approve, Withdraw approval, every QuickBooks action. **EDITABLE IFF
   status = 'open'** — a VOIDED invoice locks the same as an approved one,
   Reopen is its own unlock path, the error message says so
   ("This invoice is void — reopen it before editing its figures" against
   "…is approved — withdraw approval before editing its figures").
   **`financials_touched_at` IS THE SECOND HALF OF MARK'S QUESTION.** Bumped
   ONLY when a LOCKED column actually changes value (`is distinct from`, so
   reasserting the same number is not a touch) — never by a notes or terms
   edit, which is what makes comparing it against `synced_at`
   (`pushIsStale`) precise rather than false-alarming every time someone
   fixes a typo while the invoice happened to be open.
   **THE ANSWER TO "WHAT HAPPENS TO A PUSHED INVOICE THAT GETS EDITED" IS
   TWO HALVES, BOTH HIS CHOICE FROM AskUserQuestion.** The lock is most of
   it: reaching an edit at all means an owner/admin deliberately withdrew
   approval first, the same auditable act this app leans on everywhere else.
   On top of that: a **passive note** in the QuickBooks box
   ("Edited since it was sent to QuickBooks — Update in QuickBooks to keep
   them in sync") whenever `already && stale`; and an **active offer**
   (Mark, refining his own answer: "how about offering to resync once the
   invoice is reapproved?") — a `confirmDialog` fired ONCE, the instant
   `status` transitions INTO `approved` while the bill is linked, stale and
   pushable. Accepting it calls the SAME send as the ordinary "Update in
   QuickBooks" button — one implementation (`sendToQuickBooks`), two doors
   (`push()`'s own confirm, and this one worded for the moment it fires in).
   **THE ACTIVE OFFER COST A REWRITE OVER `react-hooks/refs`.** The natural
   shape — a `useRef`/`useEffect` pair positioned where `already`/`stale`/
   `refusals` are already in scope — sits AFTER this component's two early
   returns (`if (!ctx) return <placeholder>`, `if (!ctx.connected) return
   null`), which hooks cannot do: every hook must run in the same order on
   every render. A "latest ref" written during RENDER (updated on every pass,
   read from the effect) was the first attempt and this project's ESLint
   config refuses it outright — `react-hooks/refs` exists specifically to
   catch a ref mutated outside an effect. The fix: `sendToQuickBooks` takes
   its inputs as PARAMETERS instead of closing over the render body's locals,
   which is what lets it be DECLARED ABOVE the early returns, alongside the
   hooks; the trigger effect (also above the returns) recomputes the small
   amount of business logic itself, reading `ctx` STATE directly rather than
   sharing consts that don't exist yet from a hook's vantage point.
   **VERIFIED ON THE DOCKER HARNESS as real authenticated roles before
   touching the live schema** (033's `freeze_pay_period` discipline, applied
   to a trigger instead of a function): all 89 migrations replay clean; every
   one of the 10 locked header columns and 5 locked line columns individually
   RAISES while approved and again while void, by a real purchaser+ role
   under RLS, not just superuser; notes/terms and product_id/description/pack
   stay writable in both states; Reopen and Withdraw approval both restore
   editability; reasserting an unchanged value does NOT bump
   `financials_touched_at`; a line edit correctly stamps the PARENT row. The
   app itself confirms the wiring is live — a request against the (not yet
   migrated) hosted DB fails with "column vendor_invoices.financials_touched_at
   does not exist" rather than a silent mismatch, matching 018's own
   say-so-out-loud precedent for a pending migration, and Mark confirmed 089
   applied the same day.
   **TERMS JOINED THE LOCK — migration 090, APPLIED 2026-09-03** (Mark, having
   used the screen: "now that I'm seeing it - we should lock the terms too").
   089 had left it open on the reasoning that "Net 30" is informational and
   doesn't change what's owed; seeing the rest of the invoice locked changed
   his mind — payment terms are part of what an approver signs off on, same
   as the due date beside it, which already locked. **One function, widened,
   not a new trigger**: `create or replace` is safe here because the trigger
   function's SIGNATURE is unchanged, only its `v_changed` boolean gains one
   more clause — unlike `freeze_pay_period`'s drop-first rule, which is for a
   CHANGED ARGUMENT LIST. 089 stays exactly as it was run; 090 is its own file
   (055's rule). Verified on the harness as a real authenticated purchaser+:
   `terms` now raises the same "withdraw approval before editing its figures"
   while approved, `notes` still doesn't.
   **THE LOCK EXPLAINS ITSELF, AND SAYING SO WAS THE THING TO CUT** (Mark, the
   same day, seeing it live: "the text 'Its figures are locked — withdraw
   approval to edit them.' is unnecessary"). The fields are already sitting
   there read-only, which is the whole message; restating it in prose was a
   confirm nobody needed to read twice. Both sentences (`InvoiceFooter`'s
   approved and void lines) went back to exactly what they said before 089 —
   for void, that means no sentence at all, which is what it always was.
   **1574 fixtures pass.**

   **Shipped 2026-09-03 — THE DUPLICATE CHECK MOVED FROM LOAD TO THE CLICK**
   (Mark: "avoid checking to see if an unlinked invoice already exists in
   QBO if we, instead, just check when the user clicks 'send to
   quickbooks'… then, if we find a duplicate, we offer to link it instead of
   pushing a duplicate. If the user doesn't want to link, we don't do
   anything… hide the 'Send to Quickbooks' button so the user can only link…
   rename that button to 'Link to Quickbooks'"). The `find_bills` call that
   used to fire on every page load of an approved, unlinked, numbered
   invoice — a real network round trip nobody asked for on a screen someone
   might not even be about to push from — now fires ONCE, inside `push()`,
   the instant Send is clicked.
   **FOUND MEANS STOP, NOT WARN.** The old confirm carried a "QuickBooks
   ALREADY HAS this… makes a SECOND one… unless you mean to duplicate it"
   caveat and then let you send anyway. There is no such path now: finding a
   duplicate returns before the confirm ever opens, `setProposal` swaps the
   button, and sending is gone — matching Mark's own words exactly, "we
   don't do anything" if the offer to link is declined. **SEND ITSELF IS
   HIDDEN, not merely joined by a Link button** — once QuickBooks says it
   already has this bill, there is no reading of "Send" that still means
   send.
   **"Link to it" IS NOW "Link to QuickBooks"** everywhere it appears
   (button label and the "Checking…"/"Linking…" busy states beside it).
   **`checkingDuplicate` IS ITS OWN STATE, SEPARATE FROM `busy`** — the same
   button reads "Checking…" during the lookup and "Sending…" only once it
   actually knows there is nothing to link to, rather than one generic busy
   label covering two different waits.
   Verified live on the real Chefs Warehouse 73358289 (a genuine duplicate,
   used to prove the resync feature two commits ago): a fresh load shows
   only "Send to QuickBooks", no banner, no network call — clicking it
   reveals "QuickBooks already has this as Bill 73358289…" with **Link to
   QuickBooks as the only button**, no confirm dialog in between; reloading
   the page returns to the plain "Send to QuickBooks" state, confirming
   nothing persists from a declined offer.

   **Shipped 2026-09-03 — LINKING SETS THE BALANCE, TOO.** Mark: "when
   linking to an existing invoice, is it possible to check to see if it's
   paid and set the status then, rather than forcing the user to check in a
   separate step?" Linking had written only `external_ref` — the balance
   still needed its own "Check QuickBooks" press right afterward, on a
   figure `find_bills` had **already asked QuickBooks for**: every candidate
   it returns carries `Balance` (`d.Balance`, read since the function was
   written), which `proposeBillLink`/`link()` had simply never looked at.
   **NOT THROUGH THE DEFINER** — `record_accounting_push` exists to stop a
   purchaser INVENTING a QuickBooks id, and there is no equivalent forgery
   risk in recording a figure QuickBooks itself just returned in the same
   response. `link()` now follows `refresh_status`'s own precedent exactly:
   a plain `.update({ qbo_balance, qbo_checked_at })` through the caller's
   client, purchaser+ via ordinary RLS, the same column `refresh_status`
   already writes that way.
   **NULL BALANCE IS LEFT FOR `checkBalance`** rather than guessed at — a
   real Bill or VendorCredit does not omit `Balance`, so `candidate.balance
   === null` only if QuickBooks itself answered oddly, and the escape hatch
   already exists on screen. **SOFT ON FAILURE**: the link itself has
   already succeeded by the time this runs, so a refused write is a warning
   ("press Check QuickBooks to see it"), never a reason to report the whole
   link as having failed — the attachment-write precedent a few lines up in
   `sendToQuickBooks`.
   **`balanceLabel` IS THE ONE IMPLEMENTATION FOR BOTH READINGS** now, in
   `lib/quickbooks` — `checkBalance`'s wording ("paid in QuickBooks" /
   "fully applied in QuickBooks" for a credit / "$X still owed") had been
   inlined only there; pulling it out is what let `link()` describe the
   same fact the same way instead of writing a second sentence for it.
   Verified live on the real Chefs Warehouse 73358289: forgotten, re-sent,
   found as a duplicate, and **linked** — `qbo_balance` and `qbo_checked_at`
   landed in the same statement as the link (`18:41:22`, seconds after
   `record_accounting_push`'s own write), and "paid in QuickBooks · as of
   11:41 AM" rendered immediately, with no second click. **1576 fixtures
   pass**, one new (`balanceLabel`, checked against a credit, a settled
   bill, and a real balance).

   **Shipped 2026-09-03 — THE DETAIL SCREEN NEVER SAID "PAID".** Mark's
   next report, immediately: "no matter what the status on the detail page
   never said 'paid'" — not a gap in the moment right after linking, a gap
   ALWAYS. The header chip had stayed on the raw open/approved/void column
   (`INVOICE_STATUS_LABEL`/`_CLASS`) because **`INVOICE_SELECT` never
   fetched what the LIST already had** — `external_ref`, `qbo_balance`,
   `qbo_checked_at` — so the detail screen was structurally unable to
   compute `billStage`, the Open · Approved · Submitted · Paid ladder
   shipped for the list on 2026-09-02. Two screens, two vocabularies, and
   only one of them had ever been told about the other.
   **THE PRESENCE OF A LINK, NEVER THE ID** — `fetchInvoiceWithLines` now
   derives `qbo_linked: boolean` from `external_ref` and drops the ref
   itself before it reaches `VendorInvoice`, the list's own rule (086
   exists to stop a raw QuickBooks id landing in a server-rendered prop).
   The detail screen's header chip is `BILL_STAGE_LABEL[stage]` /
   `BILL_STAGE_CLASS[stage]` now, exactly the list's pair, off one
   `billStage()` call built from `status`/`qbo_linked`/`qbo_balance`/
   `qbo_checked_at`.
   **`INVOICE_STATUS_LABEL`/`INVOICE_STATUS_CLASS` ARE GONE** — the header
   chip was their only caller, and a comment claiming "There is no `paid`"
   would have been sitting right beside a chip that now says Paid.
   `InvoiceStatus`/`INVOICE_STATUS_ORDER` stay: the raw column is still
   open/approved/void and still what `financialsLocked`/`canApprove`/Void
   gate on — `billStage` is a VIEW of it plus QuickBooks, never a
   replacement.
   **`checkBalance` NOW CALLS `onDone()` TOO**, on both its exits — a
   press of "Check QuickBooks" writes `qbo_balance`/`qbo_checked_at`
   exactly like `link()` does, and the header chip reads those columns off
   the SERVER-rendered `invoice` prop, so without a refresh the button
   could update its own line of text three inches down while the big chip
   at the top kept lying. `link()` and `sendToQuickBooks()` already called
   it; this was the one door on the same panel that didn't.
   Verified live on the same real Chefs Warehouse invoice — reading it
   fresh shows **Paid** (`bg-[var(--rf-green-300)]`, the ladder's own
   stronger green) where it read Approved before this shipped; pressing
   Check QuickBooks round-trips cleanly and the chip stays Paid. 1576
   fixtures pass, unchanged — `billStage` was already fixture-tested for
   the list and this is the same function reading the same shape.

   **Shipped 2026-09-03 — CHECK QUICKBOOKS MOVED NEXT TO NEW INVOICE.**
   Mark, with a screenshot: move the button beside New invoice, and drop
   the "last checked" text under it. It had its own row below the DUE
   filters, alone on the far left, nowhere near the screen's other
   command; the button now sits in the search row, immediately left of
   **New invoice** — `NewInvoice`'s own trigger already carries `ml-auto`,
   so putting Check QuickBooks right before it in the same flex row is the
   whole change, no wrapper needed.
   **THE SUMMARY LINE IS GONE, THE PER-ROW ONE IS NOT** — two different
   things read `qboStatus`/`qboAt`, and only one of them is what Mark
   pointed at. The toolbar's "N of M paid · as of TIME" was a second,
   coarser statement of a fact each row already carries under its own
   invoice number (`billPaymentNote`, live-overridden by a fresh check);
   removing the summary loses nothing the rows don't already say, closer
   to the number it's about. `qboStatus`/`qboAt` state stays — the per-row
   line still needs it — only the toolbar's own rendering of them is gone.
   `qboError` moved with the button rather than being dropped: a failed
   check still needs to say why, beside the control that caused it.

   **Shipped 2026-09-03 — AND THE PER-ROW LINE GOES TOO.** Mark, the same
   session: "remove the 'paid as of...' text under the invoice number. Not
   necessary" — the thing the entry above had just argued FOR keeping. He's
   right that it doesn't earn its place: the Status column's own chip
   already says Paid, in the ladder colour, and a second sentence under the
   number restating it in words was the toolbar summary's mistake at a
   smaller size.
   **THAT TOOK `qboStatus`/`qboAt` WITH IT, FOR REAL THIS TIME** — nothing
   reads them any more, so the state, their setters, the local `QboStatus`
   type, and the `billPaymentNote` import all came out rather than being
   left as machinery with no caller. `checkQuickBooks()` is now four lines
   shorter: ask, refresh if anything was stored, report if anything
   wasn't — no `Map` to build for a line that no longer exists. The
   INVOICE cell is a bare `Link` again, one line, no wrapping `div`.
   Verified live: no `text-[11px] text-faint` span survives anywhere on the
   list, Check QuickBooks still round-trips with no console error, and the
   Status column's Paid/Submitted/Open chips are unaffected — they were
   always `billStage` off the row, never this state. 1576 fixtures pass,
   unchanged.

   **Shipped 2026-09-03 — THE PAIR ONLY LOOKED RIGHT AT ONE WIDTH.** Mark,
   catching it immediately: "the check quickbooks button is placed to the
   right of the status picker, not to the left of the new invoice
   button… in a different section. It should be aligned to the right." He
   was reading the SAME code the "moved next to New invoice" entry above
   describes and getting a different screen, because that fix relied on
   `NewInvoice`'s own baked-in `ml-auto` to do the right-aligning, with
   Check QuickBooks sitting as a plain, unmargined sibling just before it.
   **`ml-auto` claims ALL the row's leftover space for the item that wears
   it — not the gap before that item, the gap before EVERYTHING up to the
   previous auto-margined item.** So Check QuickBooks packed at its natural
   position right after the status tabs (a small `gap-3`), and the row's
   entire leftover width piled up as ONE gap immediately before New
   invoice. At the narrow width this session had been testing at, that
   leftover happened to be small enough to look like the two buttons were
   together; at Mark's actual width there was plenty of leftover, and the
   gap read as a different section entirely — exactly his words.
   **THE FIX IS A WRAPPER WITH ITS OWN `ml-auto`, not a change to
   `NewInvoice`.** `<div className="ml-auto flex items-center gap-3">`
   around both buttons: the wrapper is sized to its own content (no
   `flex-grow`), so it never stretches to fill the outer row — which means
   `NewInvoice`'s inner `ml-auto` finds NOTHING left to eat inside a
   container already sized to fit it, and computes to zero. The two
   buttons pack together with an ordinary `gap-3`, and it's the WRAPPER's
   own `ml-auto` that claims the outer row's leftover space and puts the
   pair at the right edge. One point of "consume the leftover space"
   instead of two competing for it.
   Verified live at both a 2000px window (Mark's own width, where the bug
   showed) and 1280px: the gap between the two buttons measures **12px
   at both**, matching `gap-3` exactly rather than drifting with the
   window — checked by `getBoundingClientRect`, not by eye, which is
   exactly the measurement the first pass skipped.

   **Shipped 2026-09-03 — THE BILLED/RECEIVED FLAG IS A BUTTON.** Mark: "can
   the flag that pops up when a billed qty and po received qty differ be
   turned into a button that, when pressed, updates the billed qty with the
   po received qty number?" The chip was informational ("2.5 rec", a `<span>`
   with a title); it's the SAME chip now, just a `<button>` reading "→ 2.5"
   that writes it.
   **GOES THROUGH `writeLineAmount`, THE SAME PATH A HAND EDIT TAKES** — one
   implementation of "set this line's qty", so the rescale that keeps
   `extended` honest on a broken case (`rescaledExtended`) applies here too,
   and the invoice's cached subtotal/total move with it in the same
   statement. Verified live on a real open invoice with two mismatched lines
   (BakeMark 450364): pressing → 5 moved qty 7→5, rescaled extended $350→$250
   at the line's own $50 rate, and dropped the header total by exactly $100 —
   then restored to its original state.
   **GATED ON `canEditFinancials`, NOT JUST `canEdit`** — qty is one of 089's
   locked columns, so the button only renders once the invoice is open;
   locked, it falls back to the original plain flag, exactly like the
   InlineValue qty cell beside it. Verified on a real approved invoice
   (15501523): the "2.5 rec" chip renders as a `<span>`, not a button.
   **FOUND THE SAME BUG NEXT TO IT WHILE WIRING THIS UP, AND FIXED IT**: the
   handwritten-amendment band's "take the corrected total" button
   (`takeAmendedTotal`) was gated on plain `canEdit`, but `total` is also one
   of 089's locked columns — so it rendered enabled on an approved invoice and
   silently did nothing when pressed (matching `takeAmendedTotal`'s own
   existing on-error behavior, which is why nothing ever surfaced it). Moved
   to `canEditFinancials`. A second `canEdit`-gated control on this same page
   ("Link to PO…") was flagged rather than audited in the same pass — it
   wasn't touched, and whether it also needs the same fix is unconfirmed.

   **1485 fixtures pass**, 14 new, and each rule was checked by BREAKING it —
   dropping the number grouping turns 4 red, a naive concat 2, a set instead of
   a multiset 2 (in BOTH callers, which is what proves they share one
   definition), losing the read order 1, the kind filter 1, joining numberless
   readings 1, and the old caveat clause 2.

   **Shipped 2026-09-03 — THE ON-PAGE TOTAL CHECK STOPPED BEING AN OCR
   SELF-TEST.** Mark, on a real false positive: "there's a discrepancy here.
   If we're comparing page parts, then we should compare it to the invoice
   subtotal and not the invoice total."
   **WHAT WAS ACTUALLY WRONG, measured against the real data (invoice
   15-700541 / 15-700341, both Amoretti):** the on-page band summed the
   READING's own subtotal + tax + freight + other and compared that sum
   against the READING's own total — an OCR SELF-CONSISTENCY check, not "does
   our record match the document." The reading correctly captured `subtotal`
   ($102.04) and `invoice_total` ($86.73) but never populated
   `other_charges` — the printed page has a $15.31 credit the model simply
   missed. **Mark had already typed -15.31 into the invoice's own Other
   field**, correctly reconciling the STORED figures (102.04 + 0 + 0 − 15.31
   = 86.73, exactly matching Total) — and the band kept firing anyway,
   because it was comparing the READING's un-corrected parts (other read as
   missing, silently treated as 0) against the READING's own total, which
   had never agreed with itself in the first place.
   **THE FIX WAS REUSE, NOT INVENTION** — `totalDisagreesWithDocument`
   already existed, built for the approval caveats ("If it's off, we should
   be warned when 'approving'", 2026-09-02), and asks the exactly-right
   question: does `computed.total` — always FRESH, derived live from the
   current lines and stored charges, never a cache that can go stale —
   disagree with what the document says. The on-page band now calls it
   directly (falling back to `invoice.total` for a hand-typed, lineless
   bill), and the old `amounts` `useMemo` reading the extraction's four parts
   is gone from `InvoiceDetail`. **`amountReconciliation` ITSELF IS
   UNTOUCHED** — `approvalReadiness` still uses it, comparing STORED
   subtotal+tax+freight+other against STORED total, which is a genuinely
   different and still-useful question (does our own record cohere) from
   what the on-page band now asks (does our record match the vendor's page).
   Verified live on the real invoice: the Amounts block still shows
   Subtotal $102.04 / Other −$15.31 / Total $86.73, and the false-positive
   band is gone entirely. Pinned as a regression fixture reproducing the
   exact numbers, with the OLD check's own arithmetic computed alongside it
   to prove what it was actually testing. **1575 fixtures pass.**

   **Shipped 2026-09-03 — THE RCVD FLAG READS AS A COMMAND, NOT A LABEL**
   (Mark, in three passes: label it "RCVD: <qty> ==>"; make the arrow the
   real glyph, not "=="; and put a solid black border around it "to denote
   that it's a button"). The button reads `RCVD: 5 →` now, bordered
   `border-ink` like every other button in the app, so it visually matches
   `takeAmendedTotal`'s own `→ $X` button rather than reading as a passive
   yellow tag someone might mistake for decoration.
   **THE NEW `totalDisagreement` BAND LOST ITS BORDER THE SAME DAY** (Mark,
   seeing a real one: "the new warning… should not have a solid black
   border around it"). It had copied the bordered `bg-mark-fill` dress every
   OTHER caveat paragraph on this screen already wears — `lineSums.differs`
   right beside it still has one — but this is the one Mark singled out, so
   only it lost its border; its sibling was left exactly as it was, since he
   named the wording that identifies which band he meant precisely enough
   to tell them apart.

   **Shipped 2026-09-03 — `totalDisagreement` GOES QUIET WHILE `lineSums`
   ALREADY SPOKE** (Mark, on real invoice 15476478: "I'm getting multiple
   similar warnings"). Two bands were both firing over the SAME pair of
   numbers, worded almost identically — "the lines come to $216.35, where
   the invoice says $190.95" stacked directly on "the item lines come to
   $216.35 against a printed subtotal of $190.95". **WHY THEY COLLAPSE TO
   ONE FACT**: with tax, freight and other all zero — the common case —
   `computed.total` REDUCES TO `computed.subtotal`, and the document's own
   total reduces to its own subtotal the same way, so `totalDisagreement`
   and `lineSums.differs` end up comparing the IDENTICAL pair and saying so
   twice. `lineSums` is the more useful of the two when both would fire —
   it names the SUBTOTAL, which is what actually needs checking (15476478's
   own cause: `BANANA-GREEN TIP ^ SUBSTITUTION` entered as two separate
   lines, both $25.40) — so `totalDisagreement` is suppressed whenever
   `lineSums.differs`, treating the subtotal mismatch as the root cause
   rather than restating its consequence. Where the lines agree with the
   printed subtotal but the total still doesn't — a real tax/freight/other
   gap — `totalDisagreement` still fires on its own with something new to
   say. Verified live: 15476478 now shows exactly one band.
   **AND NEITHER BAND KEEPS THE BORDER** (Mark, same thread — first the RCVD
   button "should have a solid black border… to denote that it's a button",
   then the total-check band "should not have a solid black border", and
   finally, once the dedup left `lineSums.differs` as the one band left
   standing, "remove the solid black border around the remaining warning").
   A caveat band is a SENTENCE, not a control — the border belongs to the
   RCVD button because pressing it writes, and a bare `<p>` earns nothing by
   looking like one. Both bands are `bg-mark-fill px-4 py-2 text-sm` with no
   border now; verified live (`getComputedStyle` reads `0px solid` on the
   surviving band on 15476478). **1575 fixtures pass** (unchanged — a pure
   styling edit).

   **Shipped 2026-09-03 — A LINE CAN BE ADDED OR DELETED.** Mark: "we need to
   be able to delete and add lines to the invoice." Every other write on this
   table had a home — Unlink and Mark as freight already lived in each line's
   `⋯` menu, qty/price/extended were already `InlineValue` cells — but adding
   or removing a whole LINE had no door at all.
   **NO PICKER, unlike a purchase order's Add item.** A PO line is chosen off
   the catalog; an invoice line is transcribed off a page, and every cell on
   this table was already typeable. So **New Invoice Item** (`BUTTON_CLASS`,
   in the lines table's `leading` slot, right-aligned beside the "Lines"
   heading — which puts it directly beside the eye's own cell without either
   one knowing the other exists) inserts one blank row (`kind: "item"`,
   everything else null) and leaves it to be typed into, the same way every
   other line already gets corrected.
   **DELETE JOINS THE `⋯` MENU**, last, `danger: true` — the receiving/PO
   line table's own confirm-gated pattern (`confirmDialog`, `tone: "danger"`,
   naming what's lost: `Delete <description> — <extended>?` / "This cannot be
   undone."). It recomputes the invoice's cached subtotal/total from what's
   LEFT (`computedAmounts` over the filtered array), the same discipline
   `writeLineAmount` already follows for an edit — the total lives on
   another table, so removing a line has to write it too or the record
   disagrees with its own lines the moment the row is gone.
   **BOTH ARE GATED ON `canEditFinancials`, not plain `canEdit`** — Delete
   disabled with the same "Withdraw approval to change this" hint as Unlink
   and Mark as freight beside it, New Invoice Item hidden outright. 089's
   trigger only locks UPDATE and would not itself refuse an insert or a
   delete, but adding or removing a line moves the total exactly as an
   edited qty does, so the UI follows 089's rule rather than leaving a hole
   in it — a purchaser could otherwise change what an approved invoice adds
   up to without ever touching a locked column.
   Verified live end to end, twice, on a real open invoice (15492980) and
   left exactly as found both times: New Invoice Item took Lines 6 → 7 with
   a blank row (`line_no` null, sorting last) and the invoice's stored
   totals untouched; deleting that row took it back to 6 with totals
   unmoved. Then a scripted $50 test line was added directly and deleted
   through the same UI path — subtotal $476.75 → $526.75 → $476.75, the
   `lineSums.differs` band correctly appearing and disappearing with it. On
   the approved invoice (15501523) New Invoice Item does not render at all
   and all three `⋯` items — Unlink, Mark as freight, **Delete** — render
   disabled with the withdraw-approval hint. **1575 fixtures pass**
   (unchanged — `computedAmounts` was already exercised by every other
   money write on this screen).

   **Shipped 2026-09-03 — THREE MORE FROM MARK, ALL SMALL, ALL SAME DAY:**
   a computed due date, a Discounts field (migration 091, **APPLIED**), and a
   four-colour status ladder.

   **(a) A DUE DATE FILLS ITSELF IN FROM THE INVOICE DATE AND TERMS, AND ONLY
   WHILE NOTHING HAS BEEN SAID ABOUT IT.** Mark: "when creating a new invoice,
   if no due date is set, can we calculate one based on invoice date and
   terms?" `termsDays`/`dueDateFromTerms` in `lib/invoices` read the ordinary
   spellings — `NET 30`, `N30`, `Net due in 15 days`, a bare number of days,
   `COD`/`C.O.D.` as zero, `2 weeks` as 14 — and add them to the invoice date
   with `Date.UTC` throughout, so a build running west of Greenwich can't roll
   a month boundary back a day (pinned: `2026-08-25` + Net 30 → `2026-09-24`,
   not the 23rd a local-timezone `new Date` would give).
   **IT WRITES IN TWO PLACES, because "creating a new invoice" is two
   different moments here.** `invoiceHeaderFromExtraction` calls it as a
   fallback (`invoiceDueDate(extraction) ?? dueDateFromTerms(invoiceDate,
   terms)`) — the OCR reading is where terms is usually already known, the
   moment a filed reading becomes a draft record. But `NewInvoice`'s manual
   dialog (the landlord, the plumber) asks for no terms at all — there is
   nothing to compute FROM at that moment — so the same calculation rides as
   an `alsoUpdate` on the detail screen's **Invoice date** and **Terms**
   cells instead, each firing the other way (Terms's `alsoUpdate` reads
   `invoice.invoice_date`, Invoice date's reads `invoice.terms`), which is
   what makes typing Terms into a manual bill AFTER filing it — the normal
   order for a rent bill — the moment the due date actually appears.
   **BOTH SITES ARE GATED ON `invoice.due_date === null`**, never on whether
   the FIELD being edited changed — editing Terms on an invoice that already
   carries a real due date (typed by hand, or computed once already) must
   never silently move it. Verified live end to end on a real throwaway open
   invoice (Amazon, `TEST-DISCOUNT-091`, deleted after): typing `Net 30` into
   Terms with Invoice date `09/03/2026` wrote `due_date = 2026-10-03` and the
   header line picked it up as "DUE IN 30 DAYS" in the same paint.
   **6 new fixtures**, each terms spelling plus the two-sided header-fallback
   case (a stated due date wins over what terms would imply; with neither, the
   field stays null).

   **(b) DISCOUNTS IS ITS OWN FIELD, POSITIVE, AND SUBTRACTED — the opposite
   sign convention from `Other`.** Mark: "can we add one more amount field to
   the detail page: discounts. Currently only Amoretti has a discount but
   there may be others in the future." The real case (Amoretti 15-700541 /
   15-700341, from the 2026-09-03 on-page-total-check fix above) had that
   $15.31 credit typed into `Other` as a NEGATIVE number, because `Other` was
   the only free slot at the foot of the invoice that could hold it — which
   works arithmetically and reads badly: an "Other" line carrying a negative
   figure says nothing about WHAT it is. **Migration 091** adds
   `vendor_invoices.discount numeric(12,2)`, nullable, meaning none was
   printed (true of nearly every bill); `computedAmounts` and
   `amountReconciliation` both widen to `... - Number(charges.discount ?? 0)`
   — SUBTRACTED, where `other_charges` stays signed-as-printed because it's a
   catch-all with no fixed direction and Discounts earns a dedicated sign by
   having a dedicated column name. **NOT BACKFILLED, deliberately** — Amoretti's
   existing $-15.31 stays exactly where it was typed, in `Other`; moving it is
   a data edit Mark can make himself from the screen now that the field
   exists, not a migration's business to decide for him.
   **IT LOCKS WITH THE REST** — migration 091 widens 090's own
   `enforce_vendor_invoice_financials_lock()` trigger function (`create or
   replace`, safe per 090's own reasoning: the signature doesn't change, only
   the body) to add `new.discount is distinct from old.discount` to
   `v_changed`, joining tax/freight/other/subtotal/total/terms. A discount
   moves what's owed, so it's part of what an approval signs off on — and
   without this, withdrawing approval to fix a mis-typed Other charge and
   re-typing it as a Discount instead would be a hole in 089's lock the size
   of one column.
   On the detail screen it's a fifth `Cell`/`InlineValue` between Other and
   Total in the Amounts block, and `alsoUpdate` on the tax/freight/other
   trio widened to include `discount` — one closure, one extra branch,
   `computedAmounts(lines, {...invoice, discount: next})` recomputing
   subtotal/total in the same statement as the write.
   **Verified live and against migration 091 directly.** Mark applied 091
   himself (per the standing rule — he runs migrations in the SQL editor);
   confirmed after: `discount` selects on `vendor_invoices` (0 rows non-null,
   matching "not backfilled"), and a direct `service_role` update of
   `discount` on a real APPROVED invoice was refused by the trigger — *"This
   invoice is approved — withdraw approval before editing its figures"* —
   the same sentence `terms` gets, proving the widened function is live and
   not just the column. The manual test invoice showed the Discounts cell
   accepting `$15.31` and writing it; Subtotal/Total stayed independently
   typed on that LINELESS bill, which is `computedAmounts`'s existing
   `lines.length === 0` rule (it returns `{subtotal: null, total: null}` on
   purpose there) — not a gap this change opened, the same thing already
   true of editing Tax on a rent bill with no lines.
   **2 new fixtures** for the sign convention and the null case, plus
   `discount: null` added to the fixture builder's default row (forced by
   `VendorInvoice` widening, caught by `tsc`).

   **(c) THE STATUS LADDER GAINED A FOURTH COLOUR.** Mark: "the status colors
   should change: open = yellow, approved = green, submitted = orange, paid =
   white." `BILL_STAGE_CLASS` had shipped Submitted as `closed`'s inherited
   white-on-ink and Paid as green-300 — "further along the same axis" as
   Approved's green-200. Mark's reading is the opposite: **Paid is the
   QUIETEST colour, because it's the one rung with nothing left outstanding**,
   where Open/Approved/Submitted all still owe an eye in one way or another
   and keep the warmer marks. `submitted` swaps to a new
   **`--rf-orange-200: #fed7aa`** (the app's yellow, green and red palette had
   no orange at all — one shade added, nothing else in the app reaches for it
   yet) and `paid` swaps to plain `bg-white`, both still `border border-ink`.
   Verified live via `getComputedStyle` on the real invoice list (not a
   screenshot): Submitted chips read `rgb(254, 215, 170)`, Paid chips read
   `rgb(255, 255, 255)` — Open (unchanged) still `rgb(255, 233, 138)`,
   yellow-200, on a freshly created test invoice. No fixture change — the
   class strings aren't exercised by the suite, and the four hex values are
   the whole of the change.

   **1584 fixtures pass**, 8 new (2 discount, 5 `dueDateFromTerms`, 1 header
   fallback), every new rule checked against the real database rather than
   only the fixture harness — the test invoice was filed through the app's
   own `NewInvoice` dialog and deleted through its own Delete confirm,
   leaving 26 invoices at DF02 exactly as found.
4e. ✅ **EMPLOYEE EVENTS — migration 035, APPLIED and LOADED 2026-08-06.**
   FMP's two HR child tables merged into ONE (Mark: "In retrospect, these should
   really be all in one table: Events. What were 'ratings' are really just shift
   events… Events already had different types, what's one more."). `Events`
   (2,398 rows, ~200/yr, narrative) and `Ratings` (44,251 rows, ~5,000/yr, one
   per person per shift, **written daily and still in use**) are now
   `employee_events`, 46,553 rows, 2014-06-11 → 2026-08-06.
   **THE BATCH SHIFT-LOG SCREEN IS DEFERRED TO THE PRODUCTION MODULE**, and that
   is the load-bearing scoping decision (Mark, 2026-08-06). Supervisors write
   ratings 2–3 at a time at end of shift, alongside sales, tips and donut
   production counts — `Operations/ShiftReports.mer` carries all of it. A
   ratings-only batch screen would be built twice. So the write surface is the
   employee's own record and RLS is owner/admin on all four verbs, verified in
   the harness as a real authenticated **supervisor: 0 rows visible, insert
   refused by RLS** — the assertion that proves the deferral is real and not
   merely unwired in the UI.
   **`ShiftReports.mer` is READ but never loaded**, and it is what made the
   migration good: `_log_id` is a real unique id (13,059 of 13,059) and
   `Ratings.log_id` joins it at **100.0%**, supplying the four things Ratings has
   no column for — the LOCATION (DF01 25,592 · DF02 15,578 · DF03 2,946 · EVENT
   134), the SUPERVISOR (44,237 rows, all 46 ids resolving to real employees),
   the SHIFT as a label (`Off-site` 481, which the 1/2/3 sort field cannot
   express), and a DATE for the 329 ratings whose own is blank. An earlier plan
   recovered location by joining to the TIMESHEET, which works from 2020 and not
   at all before; that inference is gone, along with any need to read the 85 MB
   Timesheets.mer. The `log_id` rides in `source_payload` for the day Production
   builds a real `shift_logs` table — a column now would reference nothing.
   **The five category scores collapse to ONE and we keep a BETTER figure than
   FMP had.** 89% of 40,793 scored ratings are a 5, so the categories never
   discriminated; the note is the payload. FMP stored `round(mean)`, which agrees
   with the true mean on only 33,545 rows, so the transform computes the mean to
   2dp — `[4,5,5,4,5]` was filed as "5" and is now 4.60. The five survive in
   `source_payload`, so the collapse is reversible without a re-export.
   Two measurements decided the schema and both would be easy to get backwards:
   **`n/a` is EXCLUDED from the mean** (the mean over the rest matches FMP's
   total on 15,427 rows, differs on 1) and **`0` is INCLUDED, because a zero is a
   supervisor writing the shift off** — of 132 rows carrying one the total says
   counted on 107, excluded on 10, and the 65 all-zero rows read "NO CALL/NO
   SHOW". Hence `check (score between 0 and 5)`; at 1–5 it would refuse 72 rows
   of real history mid-batch.
   Eleven kinds, folding FMP's three drifted merge pairs. `document_note` is
   HISTORICAL ONLY — **field-map.md was wrong** to say the 81 `Document` rows go
   to `employee_documents`: 021 declares `storage_path not null` and these are
   metadata with no files, and a metadata-only row would let `missingPaperwork()`
   report a W-4 as filed that nobody can produce, which is the exact failure 021
   exists to prevent. 253 ratings whose POSITION read some spelling of "call out"
   became `call_out` events (a narrow `/^call out$/` would have missed "CALLED
   OUT", "DF- CALL OUT" and "Call out/cover").
   **NO `timesheet_id`, NO `log_id` column, NO period gate** — each argued in the
   migration header. The period gate especially: `period_editable_on` returns
   TRUE for a day outside the 178-period calendar, so half of Events would be
   freely editable while 2020 was frozen.
   **THE UI'S CAP WAS A BUG UNTIL REAL DATA FOUND IT.** The block opens on a
   "Notes & warnings" tier because a long-serving person's warnings would
   otherwise be buried under a thousand shift ratings. The first cut capped ONE
   query at 500 and let the client filter — measured on Ruby Mares (1,590 events,
   84 narrative), that would have hidden **69 of her 84**, including 4 written
   and 6 verbal warnings, while the tab's own count said everything was fine. So
   it is TWO queries: narrative kinds fetched WHOLE (rare — 2,635 across all 445
   people), only shifts capped, and the "showing N of M" line names shift ratings
   specifically and never appears on the tier that is complete.
   Kind renders as plain text, never a coloured chip — colour means record STATE
   and a warning is a record TYPE. `deleteWarnings` gained an event count, since
   035 cascades and 023 lets an owner delete a record carrying a decade of
   write-ups.
   **`backfill-break-premiums.mjs` closed the phase-5 data gap** (see the
   correction under 4d): 10,453 `not_owed` decisions written from the break
   reasons FMP kept in its Ratings table, resolving **3,138** of the excess
   findings. **`hours: 0` explicitly** — 029 defaults it to 1.00 and
   `timesheets/page.tsx` sums EVERY premium's hours for the worksheet regardless
   of decision, so the default would have put ten thousand phantom premium hours
   on screen; verified after the write, total premium hours = 1, identical to the
   owed total. It **skips the 451 findings our rule argues with** rather than
   recording decisions nobody made: the dominant code among them is `short_meal`
   (208), and a waiver covers SKIPPING a meal on a short shift, not taking a
   ten-minute one — several read "no break needed" at 5.1h, the same 5h-vs-6h
   misreading recorded above, and three are junk ("test" twice, "fgdfg").
   `--include-contested` overrides it. Never upserts: one human decision already
   on file was left untouched, and a second `--apply` wrote 0.
   **Shipped 2026-08-26 — `/events`, THE WHOLE TEAM ON ONE SCREEN, and the
   retirement of the Team Ratings stub.** 035 merged the two tables in August
   and then built ONE surface for them: the employee record, every query scoped
   `.eq("employee_id", id)`. So "every warning in the last 90 days", "who called
   out this month" and "what happened at DF01 last week" each meant opening
   twenty-six records one after another — and 035's own
   `employee_events_org_date_idx (org_id, occurred_on desc)`, created for
   exactly this screen, **had never had a reader**.
   **THE `team-ratings` STUB WENT WITH IT LANDING**, which is the merge finally
   reaching the menu: a rating IS `kind = 'shift'`, so that was a filter on this
   screen pretending to be a screen of its own, and whichever of the two you
   pressed you would have got the same list. The surviving entry keeps the slug
   `team-events` (the `rf.nav` cookie stores it) and is LABELLED just **Events**,
   since the band above it already says HR. `roles: ["owner","admin"]`, which is
   035's RLS exactly, and `/events` joins `InactiveLocationGate`'s exempt list
   for `/sales`' reason — the shop is a filter DIMENSION here, not a scope.
   **TWO POPULATIONS FETCHED UNDER DIFFERENT RULES, and the tier picker exists
   to say so.** Notes and warnings are fetched WHOLE, all the way back to 2014
   (2,635 rows, three pages); shift ratings are bounded by a **date window** —
   7 / 30 / 90 days / This year, default 90. Bounding the narrative half is the
   failure the record screen already documents: cap it and the recent ratings
   crowd out every older warning while the count says everything is fine.
   Measured live: 520 shifts in 90 days, 66 in 30, **0 in 7** (FileMaker's own
   writing stops at the 2026-08-06 load), and **1,749 this year** — note that
   is NOT the 2,996 a 365-day window gives, which is a different question.
   **THE WINDOW IS THE ONE CONTROL THAT REFETCHES** — a `router.push` where every
   filter beside it is `history.replaceState`, because only the window changes
   what the server loaded. `/sales`' split. It is also why `windowKey` is a PROP
   and never state: a local copy would survive the push and start lying.
   **`withRatingWindow` is not a convenience, it is the trap.** `filterQuery`
   rebuilds a list's query string FROM SCRATCH out of the search term, the
   declared dimensions and the sort — so a bare `filterHref` DROPS `?window=30`,
   and every keystroke would reset the address bar to 90 while the rows stayed
   on 30. Invisible until somebody presses Back. Every href on the screen goes
   through it, the default key DELETES the param so the plain list keeps one
   canonical address, and 12 fixtures pin it (checked by breaking both halves:
   5 go red).
   **THE TIER IS A DIMENSION THAT IS NOT A MENU.** It rides in `dimensions` so it
   lands in the URL, is parsed back and narrows the rows like everything else —
   and it is DRAWN as a `TabPicker`, so `FilterMenus` is handed a `menuDimensions`
   subset AND rows already narrowed by the tier, which is what keeps its option
   counts conditioned on it. Its Clear knows only its own four, so the caller
   puts the tier back, or "Clear 2 filters" would also throw you from Shift
   ratings to Notes & warnings while counting itself as two.
   **THE TWO PICKERS SHARE ONE ROW, ON EVERY TIER, AND NEITHER IS CAPTIONED**
   (Mark, 2026-08-26, in three passes — one line, no caption, always visible).
   **THE WINDOW WAS HIDDEN UNDER Notes & warnings AND THAT WAS WRONG ON A FACT,
   not on a judgement.** It was hidden on the grounds that a control which does
   nothing is one people stop trusting — but the window is NOT inert there: the
   **"Shift ratings 520" count in the tab beside it is a function of it**, so
   hiding it left that number governed by a setting you could not see. Measured
   live: from the Notes & warnings tier, moving the window to 30 days takes that
   tab 520 → 66 and All 3,155 → 2,701. It also broke the rule `NewTimesheet`
   already settled (Mark, 2026-08-05) — a control that VANISHES cannot be told
   from a feature that does not exist, which is why that button is disabled
   rather than hidden. **Check that rule before hiding any control.**
   The window's sentence went with it and is now on every tier too, counted from
   `tierCounts` rather than a second `filter`, so the sentence and the tab cannot
   disagree about one number — under Notes & warnings it is what explains why
   the tab beside says 520 and this one says 2,635.
   Tier still LEADS, which is now just reading order (which population, then how
   much of it) rather than a fix for anything. Dropping the captions was the
   other half: captioning the window alone made the row 23px taller on two tiers
   of three, so the tier picker and the whole table under it moved by the height
   of a label. Measured after all three passes: tier, window and the table head
   hold **identical positions on all three tiers** — nothing in the control area
   moves at all. The `ariaLabel`s stay, since "7 days" read aloud names nothing.
   **Kind's options are the ten NARRATIVE kinds only**, plus a derived
   `disciplinary` (warnings + incidents, 633 live) that gives `isDisciplinary`
   its first list-level reader. The tier says which population, Kind says which
   of the ten inside it, and no label appears in both.
   **There is deliberately NO "Who" menu**: 445 people is a directory, and
   `filterCounts` is O(rows x options), so that one dimension would be ~1.4M
   predicate calls per keystroke — more than the other four combined. The SEARCH
   BOX matches the employee name, which is how `/special-orders` finds a
   customer. **Score IS a menu** (Under 4 / 4 or better / Not scored) because 89%
   of scored ratings are a 5 and the other 11% is the entire information content
   of forty-four thousand rows.
   **Shop and Score are shifts-tier menus in practice and are kept anyway**:
   2,382 of the 2,635 narrative rows carry NO shop (035 recovers it from the
   shift report, and only ratings have one) and ZERO carry a score. The
   conditioned counts state that rather than hiding it.
   **READ-ONLY, and the Who column is the whole navigation** (Mark, 2026-08-26).
   No inline edits, no delete, no create: the row links to
   `employeeTabHref(id, "events")` under `withFrom`, so the record's breadcrumb
   comes back to the FILTERED view. One write path — a second editor would be two
   places to correct one row. Known cost, accepted: the fastest route to fixing a
   misfiled rating is find it here, click through, find it again. If that becomes
   a common job the answer is `openRowKey`/`lib/shiftFocus` on the record, not an
   editor here.
   `EVENT_SELECT` moved to `lib/employeeEvents` and both screens read it — a
   column present in one select and missing from the other is a cell that reads
   an em dash on one screen and a value on the other. It must stay **ONE STRING
   LITERAL**: supabase-js parses it at the type level, and `"a" + "b"` widens to
   `string`, which collapses every selected column to `GenericStringError`
   (caught by tsc, 15 errors, when it was first written as a concatenation).
   Widths were MEASURED rather than chosen, twice: the expand chevron rides in
   the Date cell and takes 34px of it, so at 130 a date clipped to "2026-08-0";
   and Shift carries the position after it, so at 100 a real roster read
   "Opening Sr..." mid-word. Final 1230 = Date 155 - Who 190 (pinned) - Kind 140
   - Shop 70 - Shift 130 - Score 80 - Note 325 - By 140, `compactBelow` 1280.
   Verified against the live database at 1440 and 900: tier counts
   **2,635 / 520 / 3,155** to the row; This year 1,749; 7 days 0 with its own
   empty sentence; the window stripping `?window=` when it returns to 90; Back
   from an employee restoring `?kind=disciplinary&sort=who&dir=asc` intact; kind
   bands summing to 2,635 (Attendance 867 - Call out 435 - Incident 339 -
   Negative 409 - Verbal 194 - Positive 158 - Written 100 - Document note 81 -
   Note 38 - Check-in 14); shop bands DF01 77 - DF02 140 - **DF03 36** - No shop
   2,382, that DF03 being the proof the code map came from `session.locations`
   and not `activeLocations`; and the compact set shedding to five columns with
   nothing clipped. **1,223 fixtures pass.**
   **Harness note:** the browser pane goes HIDDEN on its own, and while it is
   every `getBoundingClientRect` reads 0, React never hydrates, and a sticky
   header composites a few pixels out of place — which reads exactly like a
   layout bug. A `screenshot` restores it. Measure again before believing any
   geometry, and check `innerWidth !== 0` first.
4f. 🚧 **Production** — specced 2026-08-07; **ALL FIVE PHASES NOW BUILT**
   (036–044; **044 NEEDS APPLYING**, everything before it is applied).
   *Probe, don't read this line* — it has been wrong in both directions for four
   different migrations. Read **`docs/production-brief.md`** before
   designing or touching anything here — the whole design was settled in
   conversation with Mark and the brief carries the decisions, the migration
   traps, and what the exports actually say.
   **Mark's six open questions are ANSWERED** and recorded in the brief: batch
   numbering seeds at **30,000**; the batch-size rule is his (a regular donut is
   **1/340** of a batch, mini ⅓ of a regular, giant 2×) which DISAGREES with the
   stale `_yields.mer` export and so ships as **editable data, never a
   constant**; a generated schedule line DOES snapshot its cost; wholesale stays
   informational; the WHOLESALE pseudo-location's pars are skipped with a
   report; and **the shift-report surface is deferred ENTIRELY** — phase 5's
   item actuals go on the schedule's own screen and element actuals on a
   standalone batch-log screen, so Production no longer waits on 4e either.
   **The tray tally box rule is answered too, and it grew a feature** (Mark,
   2026-08-07: "It's always 6, but that is something that would make it better —
   to have the ability to set the chunk size for each item"). So 037 gives
   `production_items` a **`tally_box_size` (not null, default 6)** — per ITEM,
   not per size, because that is what he asked for and the data has exactly one
   value today; a cascade nobody needs would be 016's `nextDeliveryDate` trap in
   miniature. The rest of the strip was settled by MEASURING the real 8/7 DF02
   packet rather than asking: it is a **fixed 24 boxes independent of par** (888
   boxes over 37 rows; par 15 and par 18 both get 24), so it is a counting grid
   you tick off rather than a tally sized to the order. **The baker and fryer
   guides are NOT this control** — their `1 2 3 … 25` strip is a ruler of tray
   numbers with the day's total printed beneath, and reproducing one from the
   other's rule would be wrong.
   **NOTHING IS NOW BLOCKED**: every question that gated phases 2–5 is answered.
   **Shipped, phase 1 — `/elements` + `/recipes`, both with detail screens, and
   the recipe sheet as a client-rendered PDF.** Migration 036 is six tables
   (elements · element-locations · recipes · versions · lines · steps) with
   **no cost column anywhere in them** — decision 11, and the cure for FMP's
   `Recipe_Items` still carrying its 1/30/2022 prices in 2026. RLS is
   membership READ (production is operational, not HR-sensitive: anyone rostered
   to make a thing needs its recipe) and purchaser+ writes; verified on the
   harness as a real authenticated user, where staff read but an update changes
   0 rows, a delete removes 0, and an insert is refused outright.
   **THE SCALE COLUMNS ARE COMPUTED, AND THAT WAS A MEASUREMENT, NOT A TASTE.**
   It is the decision a rewrite is most likely to flip. FileMaker STORED an
   amount per variation column — four hand-maintained numbers per line — and it
   looks like four independent quantities. It isn't: **96.4% of testable
   ingredient lines are within 2% of a strict multiple of the base column**,
   once two things are accounted for that make a naive check report 65%
   failure — **the unit changes as the number grows** (170 g → 510 g → 850 g →
   **1.7 kg** is ×1/×3/×5/×10 exactly) and **a blank multiplier in slot 0 means
   ×1** (all 493 versions put the base there). So a line stores ONE amount plus
   the version's (label, multiplier) strip, and the rest is rendered. Verified
   AFTER building, over all 493 versions: **98.64% of computed cells match what
   FMP stored** (7,619 of 7,724).
   Reaching that figure is what found the four kinds of line that are NOT
   ingredients — `Expected Labor` (159 lines, a constant per batch like mixer
   size, and already duplicated by the version's `prep_time`), `Total Liquid`
   and `Total Base` (283 computed subtotals), and 41 temperatures carrying unit
   `C`. **None is lifted automatically**: three are already covered by a real
   column and the fourth is derivable, so more name-matching would be guessing
   where the brief says report. They load as labelled lines with no element,
   cost nothing, and are visible to delete.
   The 105 cells still disagreeing are **29 versions whose columns are
   FORMULATION VARIANTS rather than scales** (Vanilla Cake Donut labels its
   "A"/"B"/"C", Chocolate Chip Cookie v6–v16 likewise). No multiplier can
   express those — **the one place this model loses something FileMaker had** —
   and the raw strip survives in each line's `source_payload`. Ask Mark; a
   variant probably wants to be its own VERSION, which is what the family is for.
   **Costing is `lib/productionCost`, and AN UNKNOWN COST IS NEVER ZERO.**
   155 of the 470 migrated elements resolve to nothing (FMP never mapped them;
   24 are cleaning duties with no cost at all), so a resolver treating those as
   free would report a confident, always-too-low figure for every recipe
   containing one with nothing on screen saying so. A cost is therefore the
   money we could account for PLUS the elements we could not, rendered `≥ $4.12`
   with the gaps named. There is a **cycle guard** too, since 036 lets a line
   point at any element and nothing stops Glaze A being made from Glaze B and
   back; FileMaker needed none because its costs were snapshots, so a cycle just
   froze. The graph loads in **FOUR queries however deep the BOM goes** — ~470
   elements and ~4,000 lines are small enough to hold whole, so it is fetched
   flat and walked in memory rather than recursed over the network.
   The element list's **Uncosted tier is the catalog cleanup made into a place
   you can go**, rather than a footnote under each recipe.
   **Two bugs the PRINTED SHEET found**, neither visible in code review: the
   lower-bound `≥` printed as a stray "e", because @react-pdf's built-in
   Helvetica is WinAnsi and lacks the glyph — so a total read "e$12.10", not
   merely losing the claim but replacing it with a typo (the PDF says
   **AT LEAST** in words now; the screen keeps the symbol, where browser fonts
   have it); and scaled amounts printed "30.625 g", which no kitchen scale can
   show. Precision now falls as the quantity grows.
   Nav's Production section drops FMP's vocabulary for this module's own —
   **Recipe Items is gone entirely** (decision 2 merged it away, so a menu item
   would name a table that no longer exists) and "Item Schedules" becomes Plans.
   **576 fixtures pass**, 35 new, each rule checked by breaking it: zeroing an
   unresolved line fails 2 cases, ignoring the location override fails 2, and
   removing the cycle guard produces the literal stack overflow it prevents.
   **Migration/transform traps, all found by replaying the REAL 8,175-row export
   through the REAL schema on the harness rather than by reading:**
   **Six rows in FMP's ingredient CATALOG are not ingredients** — "Mixer Size",
   "Expected Yield", "Prep Time", "Total Liquid" and two separators, every one
   typed "Vendor Item" with no vendor key. They must not become elements, and
   they cannot merely be dropped either, because 827 recipe lines carry their
   name ONLY through that link. They lend the line its label instead.
   **Merging duplicate elements CREATES a par collision that is not in the
   source**: FMP's two "Candied Peanuts" rows each carry a DF01 par, and once
   the elements are one so are their pars — the insert failed on row 471 of 530.
   **34 recipe families have no element at all** (the 13 "Knotted – …" creams,
   several "(old)" glazes), so `element_id` NOT NULL means the transform CREATES
   one for each, inactive and named in the report.
   Everything else joins clean: 8,175/8,175 lines, 5,200/5,200 item keys,
   97/97 name links. `cost_basis_t` needed reading rather than guessing —
   **"Internal" means made in-house** (45 of 68 name a recipe), not manual.
   **Shipped, phase 2 — migrations 037 + 038, both APPLIED and LOADED
   2026-08-07.** 307 items · 324 BOM edges · 325 item-locations · 40 price cells
   + 5 overrides · 21 yield rules, plus `/production-items`.
   **038 EXISTS BECAUSE 037 WAS WRONG, and the data said so in a minute.** 037
   put `unique (org_id, name)` on `production_items`, copying 036's rule for
   elements, and the first load collapsed **307 items to 173**. An item's name
   is a LABEL: **"Angry Samoa" is four different donuts** — Regular Cake
   Vanilla, Mini Raised Promise Ring, Regular Raised Letter, Giant Raised
   Promise Ring — with four price classes. 038 **DROPS** the constraint rather
   than widening it: `(name, size, type, subtype)` is exactly unique over all
   307 rows and a composite index is therefore available and TEMPTING, but those
   are four separate `InlineValue` cells and changing a Regular to a Mini when
   that Mini exists would fail on the first edit with no order that works —
   024's mistake exactly. Duplicates get `findPossibleRehires`' treatment
   instead: warn, and let the person through.
   **THE BOM IS TWO FACTS THAT OVERLAP.** FMP states what an item is made of in
   `_idBase_t` (the dough) AND `_dependencies` (everything else), and they
   overlap on 84 of 216 items — load both and the dough counts twice, load only
   dependencies and 132 items lose it. So the base is a COLUMN, dependencies are
   EDGES, and an edge naming the item's own base is dropped with a report. That
   also explains why 176 edges carry no quantity: **the dough's amount is
   DERIVED**, never stored.
   **`production_batch_yields` is Mark's rule as editable DATA** — dough cost =
   `batch cost × portion_of_batch × size_factor`. Seeded over FMP's structure
   with every change named: 11 raised portions 1/350 → **1/340**, mini 0.4 →
   **1/3**, giant 4 → **2**. He named only the RAISED cuts, so the export's cake
   portions (Vanilla 1/40, Chocolate 1/35, Banana 1/30) load as they stand
   rather than being invented.
   **The dough must read its element's BATCH cost, not its per-unit cost** —
   `elementCost` already divides a made element by its yield, so doing that AND
   multiplying by `portion_of_batch` applies the yield TWICE, giving $0.01 where
   $1.00 is right. A hundredfold error that still looks like a plausible
   ingredient cost. Four fixtures exist for it and reproduce exactly 0.01 when
   the guard is removed.
   **Decision 10 confirmed by measurement**: 125 price rows are 40 (class, tier)
   cells copied across four shops, DF01/DF02/DF03 agree on **all 40**, and only
   EVENT differs — on exactly its five Regular-class cells. `lib/productionPrice`
   resolves item-location override → location grid override → org grid. An item
   missing a class or tier has NO price rather than a default one (19 of 307),
   and **margin is a fraction of PRICE, not cost** ($1 at $4 is a 75% margin and
   a 300% markup).
   **WHAT PHASE 2 DOES NOT PROVE.** The plan was to validate item costs against
   FileMaker's own frozen `costEach`, kept in `source_payload` for exactly that.
   **The diff cannot run**: of the 61 items FMP costed, ZERO have a complete cost
   of ours, because every one carries 4–11 unpriced components. The arithmetic is
   fixture-verified; the DATA cannot corroborate it until the element catalog is
   mapped — even Raised Donut's batch resolves to $6.22 with one of its four
   lines unpriced. That is the 209-element backlog the Uncosted tier exists for,
   and it is Mark's data work, not a code fix. **Re-run that diff after the
   catalog is filled in** — it is the real validation and it is still owed.
   Two traps this phase added to the pagination lesson: `fetchAll` must take its
   ORDER COLUMN as a parameter, because `production_price_grid_locations`
   deliberately has no `id` (the pair is the key, `vendor_item_location_prices`'
   idiom) and a hardcoded `.order("id")` took the whole menu screen down; and
   `_yields.mer` has a genuine duplicate `(Raised, Letter, Regular)` row, merged
   with a report, which the harness caught and reading had not.
   **Also shipped: `/production-items/[id]` and `/price-grid`.**
   **The price grid is a MATRIX, not a `DataTable`** — the table component is
   for a list of RECORDS, and this is one record with two axes. Reading it as 40
   rows of (class, tier, price) would lose the point: a tier is a COLUMN, and
   changing one cell reprices every item on it. A shop picker switches between
   the org prices and any one shop's, where an overridden cell is a live value
   and an inherited one is the org price in GREY with a "set" button — and that
   button INSERTS the override row, because **a cell with no override has no row
   to write to and so cannot be an `InlineValue` at all**. Verified against
   EVENT: five live Regular-class values, 35 grey inherited ones.
   **The item record shows WHY a cost is what it is** — FMP stored one frozen
   `costEach`, so a wrong-looking figure told you nothing. Every contributor is
   a row, the dough included, rendered as **"1/340 of a batch"** because that is
   how a baker says it, and anything unpriced says so on its own line rather
   than being dropped from the total.
   **Per-location pars are READ-ONLY, and since 043 they are a DEFAULT rather
   than the par** — the number a new plan slot is seeded with, nothing more.
   This line used to say the reason was that `InlineValue` writes a whole COLUMN
   while a par cell must write one SLOT of an array, and that **"is the obvious
   next thing to build"**. Both halves are wrong now: 041 shipped
   `arrayColumn`/`arrayIndex`/`arrayStrip`/`arrayWidth` for the recipe sheet, and
   043 made the editor beside the point. **Do NOT build it.** After 043 an edit
   there changes nothing that exists — no plan, no schedule, no day, only what
   some future slot starts at — and a live-looking editor whose effect is
   invisible until an unrelated act on an unrelated screen lies about its own
   reach. The par is edited on the PLAN.
   Nav: Operations > Prices was an existing named stub and now points at the
   grid; if staff look for it under Production instead, it is one line.
   **Shipped, phase 3 — migration 039, APPLIED 2026-08-07.** `/plans` and
   `/plans/[id]`, the tray × weekday matrix. **No transform and no loader**: the
   fresh-start decision means FMP's 150 plans and 29,083 tray-day slots stay on
   disk, so the screen is the ONLY write path — which is why it was exercised
   end to end rather than probed (design rule 1's "a create that a loader also
   performs is a create nobody has tested", with no loader at all here).
   **THE KITCHEN LIVES ON THE PLAN** (decision 9) — the thing FileMaker could
   not express, because it put where-a-thing-is-MADE on `locations` and a column
   there has room for one answer while DF01 makes DF02's raised donuts and DF02
   makes its own cake. A plan is (selling location, kitchen, date range, trays),
   several may be active at once, and their UNION is that shop's menu.
   **OVERLAP IS DELIBERATELY NOT A CONSTRAINT.** 027 taught the btree_gist
   exclusion idiom and this is exactly where NOT to reach for it: overlapping
   ranges are the feature, and even "the same item on two of one shop's plans"
   is legitimate. What it means is that pars SUM, so it is a yellow line on the
   list and a sentence on the record — the under-minimum-vendor pattern.
   **The matrix is not a `DataTable`**: the columns are DAYS rather than fields,
   every cell is a SET of items rather than a value, and there is nothing to
   sort by. It writes immediately, one item at a time, because there is no draft
   of a menu to save.
   **ISO 1 = MONDAY, and off by one silently shifts a whole shop's menu by a
   day** — `lib/productionPlans` is fixture-tested on exactly that (breaking the
   index turns 3 red), and dates compare as STRINGS rather than through `Date`,
   since `new Date("2026-08-07")` is UTC midnight and would move a plan's first
   day for everyone west of Greenwich.
   Verified on the live database by building a real plan through the UI — DF02
   selling, DF01 kitchen, tray 01, Bananaversary on Saturday, stored as
   `weekday=6` and rendered in the Saturday column — then DELETED, leaving 0
   plans, 0 trays, 0 slots.
   **`locations.kitchen_by_weekday` / `shops_for` are now VESTIGIAL** and should
   be retired from the Location record; that is not done yet.
   **Shipped, phase 4 — migration 040, APPLIED** (this line said NEEDS APPLYING
   until 2026-08-08; probed that day — the tables select and `production_day`
   executes. *Probe, don't read this file.*) `/schedules` +
   `/schedules/[id]` + `/production-day`, the generation function, and the
   printed packet. A PLAN is a proposal; a SCHEDULE is the committed day.
   **THE DERIVED DAY IS A FUNCTION, and that is the decision a rewrite is most
   likely to get wrong in either direction.** Not a table (design rule 4), and
   not a plain view either: `v_order_guide` fabricates a weekday axis with
   `cross join generate_series(1,7)` because its par lives in a seven-slot
   ARRAY with no weekday row to join to, while `production_plan_tray_items`
   already IS a row per weekday — copying the idiom past the point its reason
   applies would manufacture an axis only to filter it back down. And a
   schedule is bound to a DATE: plan membership is a RANGE predicate no
   subscript can fake, and a date axis has no natural bound, so a caller who
   forgets the `where` gets a silent cartesian. Hence
   **`production_day(location, date)`** — exposed to PostgREST for the screen
   AND called internally by the generator. 013's precedent: one implementation,
   two callers, so a stale tab can't post last week's arithmetic into a
   committed document.
   **SQL WRITES THE PARS; TYPESCRIPT WRITES THE MONEY.** `productionCost`
   already resolves the whole graph with `lib/units`' conversion, a cycle
   guard and an `unresolved[]` list, and `matchYield` already ranks
   `production_batch_yields`. A SQL twin would be decision 2's disease in a new
   form, so generation leaves the four cost columns NULL and the caller patches
   them from the graph it is already holding (the **Recost** command does it
   again later). A null `costed_at` is a legible state; a zero is a wrong
   number that looks right. Element demand is TypeScript for a DIFFERENT
   reason, and the asymmetry is principled: pars are RECORDS, so the generator
   must own them; element demand is a RENDERING (decision 5), so nothing writes
   it and there is no second writer to drift from.
   **`generate_production_schedules` NEVER SILENTLY REPLACES** (decision 6), in
   three levels each costing an explicit act: default SKIPS an existing day and
   reports it, so a 14-day run overlapping three still writes the other eleven;
   `p_replace` replaces lines IN PLACE keeping the id and `printed_at`;
   `p_allow_actuals` is required on top when any line carries made/leftover, or
   it RAISES. Replacement is an UPSERT on `(schedule_id, item_id)`, not a
   delete-and-insert, which is what carries a supervisor's typing forward for
   free — and a line a human ADDED (`par_source = 'manual'`) survives too.
   **A schedule is a WORKING DOCUMENT** (Mark, 2026-08-07, applying the
   2026-07-28 PO call): par, note, added and struck lines are editable in
   place, and an edited par writes `par_source = 'manual'` in the SAME update,
   so the schedule and the plan may disagree but never silently. That does NOT
   make overrides redundant — an override is intent BEFORE generation, editing
   is correction AFTER.
   **`production_par_overrides.par` is NOT NULL and ZERO MEANS "don't make it"**
   — the ROW is the touch, so a nullable par would be a second way to say
   nothing, and to a kitchen the two sentences are the same. A suppressed item
   still SHOWS on the derived day (a printed sheet with a zero row invites
   someone to make it anyway). Bump vs ADDITION is one record type: the derived
   day's `full outer join` answers it, so there is no `is_addition` flag.
   **THE PACKET IS SEVEN DOCUMENTS FROM ONE DATASET.** Only the premade
   schedule is a record; the three tray guides are ONE renderer at three grains
   (subtype = cut, +finish = prep, +item = decorate) and the element sheets are
   derivation. They sum every schedule live in that KITCHEN that night, which
   is what makes "including special orders" true by construction rather than by
   a flag. **`TALLY_BOXES` is a fixed 24 and fills by FLOOR** — measured, 888
   boxes over 37 rows, and par 15 shades two not three — while the guides' `1…25`
   strip is a ruler of TRAY numbers. Reproducing one from the other's rule
   would be wrong (answered question 3 says so outright).
   **TRAY CAPACITY IS A COLUMN, and only rendering the real packet found it.**
   Every filled cell holds 24 — vanilla 54 reads 24 · 24 · 6 — EXCEPT fritters,
   which FileMaker trays 16 · 4 rather than as a single 20. A constant would
   have printed a tray the kitchen never fills, while looking plausible. 040
   adds `production_items.tray_capacity` default 24, snapshotted on the line
   beside `tally_box_size`; a run takes the SMALLEST among its lines.
   **`_production.mer` IS THE ONE CONFIG EXPORT NO TRANSFORM HAD EVER READ** —
   1,201 rows, and the AB/Weekly sheets have nothing to print without it. Two
   things a reading of its column list gets wrong: **a row is one BATCH**
   (Raised Dough at DF01 on a Monday morning is four rows), and
   **`batchOrder_n` is NOT a number** — its values include "Blueberry",
   "Caramel", "x2", so an integer column takes the numeric ones and drops the
   rest without a word. It has **no primary key at all**, so identity is the
   natural tuple plus an `occurrence` ordinal (028's `source_row_key` lesson):
   element 1126 has six unlabelled Tuesday batches at DF01 carrying amounts 8,
   4 and 2, and merging on the tuple alone discards five real batches.
   `WeeklyPar` is constant per (element, kitchen) — 197 groups, zero varying —
   so it lands on `production_element_locations`' stock columns, which 036
   created and left empty. 1,105 of 1,201 load; 30 have no kitchen and 66 no
   weekday, each reported.
   Verified: all 40 migrations apply on the Docker harness; the real 1,105 rows
   replay through the real constraints with the flavour batches intact;
   generation, the skip guard, the actuals refusal, actuals carried forward,
   ahead-of-time, overlap summing, additions, suppression and the kitchen-split
   override all exercised as a real authenticated owner, with staff reading and
   every write changing **0 rows and returning NO error**, and `anon` refused
   both functions. **637 fixtures pass**, each rule checked by breaking it. And
   the real 2026-08-07 DF02 night was rendered through the real components and
   compared page for page against FileMaker's own packet: every type total,
   every subtype subtotal, every tally strip and every tray ruler matches.
   **Expected discrepancy, NOT a bug:** the printed BATCH SIZE figures don't all
   reproduce. Cake reconciles exactly (Banana 15 × 1/30 = 0.50, Old Fashioned
   33 × 1/60 = 0.55, Fritter 20 × 1/16 = 1.25) but raised does not — 300 raised
   prints 0.60 in FMP where Mark's own 1/340 gives 0.88. The export is stale by
   his account and his rule is what phase 2 seeded, editable, precisely so this
   is a data edit. Show him the first real packet.
   **Reworked 2026-08-08 from Mark's first pass over the recipe screen, with
   FileMaker's RECIPES > RECIPE tab beside it (migration 041, APPLIED and
   BACKFILLED 2026-08-08).**
   The sheet phase 1 shipped was READ-ONLY, showed one scale column at a time,
   and had dropped four things the old layout had. Every field on a version, a
   line and a step is now inline-editable, rows can be added and deleted, and
   the grid is FMP's: sort · base amount · AUTO · every other batch size · item ·
   note · cost · hide.
   **THE AUTO SWITCH IS THE ONE THAT MATTERS, and it is decision 3 gaining an
   escape hatch rather than losing an argument.** Phase 1 computed every scale
   column from one stored amount, on the measurement that 96.4% of FMP's stored
   columns are a strict multiple of the base — that is still the default and
   still right. What it could not express was the other 3.6%, and phase 1's own
   note names the cost: "29 versions whose columns are FORMULATION VARIANTS
   rather than scales … the one place this model loses something FileMaker had".
   **FileMaker had an answer and no transform had ever read it**:
   `_recipelements.mer` carries **`AutoUpdate_bool`**, one flag per line, set on
   3,350 of the 5,260 ingredient rows and clear on 1,910 — a mixer size does not
   scale, and a variant is not a multiple of anything. So 041 gives the line
   `scale_auto` plus a typed `scale_amounts` / `scale_units` strip, ON with the
   multipliers is the default, and OFF is stored. **Turning it off FREEZES what
   is on screen in the same statement** — the computed values live nowhere but
   the render, so a bare `scale_auto = false` would blank four cells the instant
   you claimed them, which reads as having destroyed the row.
   **SLOT 0 OF THE STRIP IS NEVER READ.** The base column is `qty`/`unit` and
   041 keeps no second copy of it: costing, the percentage and every computed
   column read that one, and two answers to one question is how they drift.
   **`ScaleColumn` carries the SLOT it came from, not its position on screen.**
   `scaleColumns` drops an unlabelled slot, so a version with a gap renders its
   third column second — and every write (the multiplier, the label, each
   amount) has to use `column.index` or it silently stores column 3's amount in
   column 2's slot, on exactly the versions with a gap.
   Also new: `sort` is a column on both lists again; the batch NAMES and the
   MULTIPLIER row above them are editable (036 loaded that strip and no screen
   could touch it), with a narrow trailing slot to add one; a portion size is
   two fields, a number and a unit `PickList` (`allowNew`, since a recipe counts
   in hr and C and %); FMP's HIDE box, which keeps a working note in the record
   and off the binder page — and the PDF now honours it, computing the
   percentages BEFORE the hidden rows come off; and a picture on a procedure
   step, one per step, in the new private `recipe-images` bucket. **No drop zone
   on the step picture**, deliberately: `ui/FileDropZone` arms off WINDOW drag
   events and suppresses the page's own drop handling, so one per step would
   light fifteen overlays at once.
   **THE `%` COLUMN WAS MEASURABLY WRONG AND IS NOW BAKER'S PERCENTAGE.** 036
   read FMP's stored `%` as each line's share of the batch TOTAL and said so in
   the schema notes. Measured over 2,478 export lines carrying both a weighable
   amount and a stored %: share-of-the-first-ingredient matches on **1,758**,
   share-of-total on **178**. Mark's own Raised Donut v11 settles it by
   inspection — mix 5 lbs at 100%, water 2.8 lbs at 56%, and 2.8/5 is 56 where
   2.8/8.875 is 32. `percentOfBatch` is now `bakersPercent`; the fixtures
   reproduce all four of that version's printed percentages.
   Verified: all 41 migrations apply on the Docker harness, the shape constraint
   refuses a mismatched or over-wide strip, and as real authenticated roles a
   staffer reads the lines while an update changes **0 rows and returns NO
   error**, a purchaser's changes 1, a purchaser may write an object under their
   own org's folder and not another's, a junk path is refused by the POLICY
   rather than raising a cast error, and `anon` is refused outright. 647
   fixtures pass, and the six new rules were each checked by breaking them.
   **041 IS APPLIED and `backfill-recipe-scales.mjs` HAS RUN** (2026-08-08):
   746 lines marked typed, 579 of them carrying a strip, 202 hidden from print
   (that last one by the migration itself, since the transform had already
   carried `shouldHide_bool` into `source_payload`). A second run wrote 0.
   **Probe, don't read this line** — the counts are
   `select count(*) from production_recipe_lines where not scale_auto` (746),
   `… where scale_auto and scale_amounts is not null` (0 — an auto row must
   never carry a strip), and `… where hide_on_print` (202). The 746 is smaller
   than the export's 1,910 because the 036 load keeps 3,765 of 5,260 ingredient
   rows; the rest are separators and the three magic rows.
   **Exercised through the real UI against the live database and left as
   found**: the AUTO switch on Raisied Donut v11's Seed Dough line froze its
   strip to exactly the computed values (`[null,5,7.5,10,20]` /
   `[null,lbs,lbs,lbs,%]`, the `%` slot taking the derived 20.0), the x3/4 cell
   then edited 7.5 → 8.25 writing ONE slot with `scale_units` rewritten beside
   it in the same statement, and both rows were restored afterwards.
   The screen reproduces FileMaker's printed sheet for that version line for
   line — 5 lbs → 25 / 37.5 / 50, and 100.0 / 56.0 / 1.5 / 20.0 per cent.
   **Two disagreements in FMP's OWN data, surfaced rather than introduced:**
   v11's version record says yield 30 ea and prep time 3.5 hours while the
   sheet's own metadata rows say 34 (340 at ×1) and 2.75 hr. 036 lifted those
   rows into columns and preferred the recipe record's fields where both
   existed. Worth Mark's eye; not a code fix.
   **The PRINTED SHEET was rebuilt 2026-08-08 to FileMaker's own**, which Mark
   supplied as a reference (Banana Cake Donut v10). Its brief is one sentence —
   *it has to be easy to follow by kitchen staff* — and three things come off it
   on his instruction: **no money** (no unit cost, no line cost, no batch total),
   **no notes**, and **no percentages** (FMP's sheet has no % column; the screen
   keeps it). Black banner, FileMaker's bordered header block, ingredients LEFT
   and the batch columns right (Mark's preference over FMP, which reverses them),
   each amount split into a number and its unit.
   **MIXER SIZE, EXPECTED YIELD AND PREP TIME ARE ROWS AGAIN**, one figure per
   batch column, and that is the correction that mattered (Mark: "the recipe
   contains multiple batches and the mixer and prep time are included with the
   batch size"). 036 lifted them into columns on the version and DROPPED the
   rows, which is half right: they are metadata AND they are per column.
   Measured over the export, the columns differ on **196 of 198** mixer sizes,
   **349 of 376** yields and **57 of 94** prep times — Banana Cake Donut v10
   mixes in 4 / 10 / 10 / 20 QT, which is proportional to nothing, so no scaling
   recovers it from one number. `migration/backfill-recipe-metadata-rows.mjs`
   restored **668 lines** (idempotent — they carry their FMP key as `legacy_id`
   and the table is unique on `(org_id, legacy_id)`), and the transform now
   keeps them instead of `continue`-ing past. **`counts.magic` became a SUBSET of
   `counts.ingredient` when it did**, so it must not be added to the accounting
   total again or every run reports 668 phantom rows.
   The version COLUMNS stay: they come from the recipe record's own `Yield` /
   `PrepTime_text`, which FileMaker also keeps and also prints in the header.
   **`yield_amount` is NOT what costing divides by — since 2026-08-12 the
   Expected Yield ROW is, always** (see "THE YIELD IS THE RECIPE'S OWN ROW"
   below). The column is now display-only.
   **THE ELEMENT'S NAME LEADS; `label` is only a fallback**, on the sheet and in
   the PDF. FMP's `columnName_t` is an override that goes STALE when a version
   is copied: Banana Cake Donut v10 still carries "Coffee" and "Amoretti
   Espresso Artisan Flavor" over its bananas, left by the coffee donut it was
   cloned from — and FileMaker prints "Bananas, Mashed", because it reads the
   item. The transform still PREFERS the override when filling `label`, so the
   stale text is in the data; only the readers changed.
   **Ingredient groups are the HOLES in the sort numbers.** FMP grouped with
   separator rows (827 of them, presentation stored as data, dropped at the 036
   load) and what it could not drop is the gap they left: v10 runs 1, 2, (3), 4,
   5, 6, 7, (98, 99), 100, 101, 102. `opensGroup` opens a blank line wherever two
   consecutive PRINTED rows jump — computed after the hidden rows come off, so
   Total Liquid at 99 leaves its gap behind rather than absorbing one.
   **CREATED is FileMaker's date and MODIFIED is not printed at all.**
   `created_at` defaulted to `now()`, so after the load every recipe claimed to
   have been written the day the migration ran — harmless in a database and a
   lie on a page that states it. `migration/backfill-recipe-created.mjs` dated
   all **493 versions** from `_CreationTimestamp` (span 2022-01-25 → 2026-07-21)
   and parked `_ModificationTimestamp` in `source_payload.fmp_modified_at`.
   MODIFIED stays off the sheet because `updated_at` is trigger-maintained and
   says when the ROW changed — the load, for everything migrated — while FMP's
   says when the RECIPE changed. Two different facts, one label, no column yet.
   Verified by rendering the real v10 through the real component in Node over
   live rows (the `PoPdf` idiom) and comparing against Mark's own printout: every
   amount, every unit, every group break and all three metadata rows match.
   **The recipe record became TWO TABS 2026-08-08 (migration 042, APPLIED)**, with FileMaker's RECIPES > INFO tab beside it. `ui/SectionNav` —
   Info · Recipe — the employee record's pattern reused rather than re-derived,
   which is what Mark asked for when that shipped. Ingredients and procedure
   moved to Recipe; Info carries the version's fields, the VERSIONS list and the
   COSTS matrix, neither of which existed here at all.
   **BOTH THE TAB AND THE VERSION LIVE IN THE URL** (`?tab=recipe&v=11`), and
   the version had to move there with it: it was client state, which a soft
   navigation between tabs discards, so reading v24 and switching tabs would
   have dropped you silently back to the master. `lib/recipes.ts` holds the
   three pure helpers (`parseRecipeTab`, `parseRecipeVersion`, `recipeHref`),
   fixture-tested; the defaults write NO parameter, so the record keeps one
   canonical address. The version LABEL and not the id — `?v=11` is a URL a
   person can check, and a label matching nothing falls through to the master.
   **The COSTS matrix is a matrix, not a `DataTable`** (`/price-grid`'s call): a
   row is a kind of figure and a column is a batch size. **INGREDIENTS SCALE AND
   LABOUR DOES NOT**, which is the whole reason FileMaker prints five columns
   instead of one figure — labour is the prep-time ROW (041's typed strip)
   times the WORKING SHOP's `locations.labor_rate`, so cost per unit falls
   sharply as the batch grows. Verified against FMP's own block on Raisied Donut
   v11: labour **$96.25 / $105.00 / $113.75 / $122.50** and yield
   **34 / 170 / 255 / 340** match to the cent, and our ingredient figures are
   lower by exactly the one element the catalog cannot price (Seed Dough) —
   which is the 209-element backlog showing through, not an arithmetic error.
   **042's `cost_column` is a SLOT NUMBER, not a label**, for the same reason
   `ScaleColumn` carries its slot: labels are editable content, and renaming a
   batch would otherwise move which one the recipe is costed at. Null means the
   base column. It drives the block only — **it deliberately does NOT change
   what `lib/productionCost` charges for an element**, because cost per unit is
   (batch ÷ yield) and both scale together, so the answer differs only where the
   yield row is one AUTO was turned off for. Wiring the two together is a real
   follow-up and a costing change; make it deliberately, with fixtures.
   Also new on Info: **Make master**, which is TWO STATEMENTS and the order is
   load-bearing — 036 enforces one master per family with a PARTIAL UNIQUE
   INDEX, so the old flag must be cleared BEFORE the new one is set or the write
   trips the index. Both `.select()` their own result.
   Labour rate is fetched in the page's own `Promise.all` rather than folded
   into `getAppSession`: one column read by one screen, against a session every
   screen pays for.
   **BOTH RECIPE TABS ARE ONE SCREEN OF PANES** (Mark, 2026-08-08). Info: the
   fields, then NOTES down the left with VERSIONS over COSTS down the right
   (Mark's second pass the same day — "move the versions section across from
   Notes and above Costs"; it had been Notes across the top with Versions beside
   Costs). Recipe: Ingredients over Procedure, each scrolling its own rows.
   **Both areas split HALF AND HALF** so the boundary runs straight down the page
   — the fields as two `dl`s rather than one four-track grid, because a single
   grid ties both sides to the same row heights and a long description would push
   Storage's value down to meet it.
   **THE VERSION NOTE IS ITS OWN ELEMENT, OUTSIDE THE SCROLLER** (Mark, same
   pass). It shared one `overflow-y-auto` box with the testing notes and they are
   not the same kind of writing: the version note is one line naming what this
   version IS ("v09 scaled to 2000g"), the first thing you read and always worth
   having on screen, where testing notes accumulate over years — Chocolate Glaze
   v50 carries 844px of them — and are what the scrolling is for. Sharing a box
   let the note be scrolled out of sight by prose about a version it names.
   **VERSIONS SHRINKS AND NEVER GROWS** (`flex-initial`, not `flex-1`). Given a
   share of the column it stretched to the frame's full height for a recipe with
   ONE version and left Costs stranded 600px below — which is not "above Costs".
   Sized to its content it sits directly on the matrix, and `min-h-0` is what
   lets a 38-version family give the room back and scroll instead. Its inner
   scroller is `flex-initial` for the mirror reason: `flex-1` is `flex: 1 1 0%`,
   and a basis of 0 inside a section now sized by its CONTENT means the section
   has no content, so the list collapses to its heading.
   **THE ROW IS SIZED BY THE RIGHT COLUMN, NOT BY THE WINDOW** (Mark, third pass
   the same day: "versions doesn't need to be so tall. It could probably be the
   same height as Costs, and then Notes can be tall enough so its bottom is
   aligned with the bottom of costs"). Filling the viewport meant SOMETHING had
   to absorb the leftover, and the only block that could give was the versions
   list — so a 38-version family got a 505px pane of 44px rows and the two
   columns ended level with the foot of the SCREEN rather than with the last line
   of the matrix. Two measurements do it, and **both arrows point one way, which
   is what stops it becoming another fixed point**: Versions is capped to the
   MEASURED height of Costs, and Notes is given the MEASURED height of the right
   column. Costs never reads the list above it and the right column never reads
   Notes. **`xl:items-start` is load-bearing** — without it the grid stretches
   the right column to the row, making its height depend on the very thing
   derived from it.
   The cap is measured rather than written down because the matrix's heading
   WRAPS when a recipe has unpriced elements to name: 324px on Chocolate Glaze,
   340 on Banana Cake Donut. It is also bounded by the window, so the tab still
   opens as one screen where it can — at 1100px the pair would want 672 in 552 of
   room, and the list gives up the 120 rather than the page scrolling (floor 132,
   three rows, past which the page scrolls instead). Verified: 1500px window →
   both blocks 324 and Notes 680, bottoms level to 1px; 1100px → versions 197,
   page exactly one viewport; one-version recipe → versions 112, Notes 484,
   bottoms level to 0px. Below `xl` both overrides are CLEARED and the page
   scrolls.
   **`useExactViewportHeight` — the DEFINITE-height sibling of
   `useFillViewportHeight`, and TWO things separate them, both paid for by a
   blank screen.** First: a `max-height` alone leaves the box content-sized, and
   a child with `basis-0 grow` has no content height to fall back on, so a column
   of proportional panes collapses to NOTHING. Second, and subtler: **it must
   never probe with `height: auto`.** The cap can measure that way safely,
   because on a box shorter than its cap `max-height: none` changes no layout and
   the ResizeObserver settles. A definite height cannot — setting it to `auto`
   genuinely resizes the page, which fires the observer, which probes again, and
   the element spends as much time at `auto` as at its target. With `basis-0
   grow` children, `auto` means zero, so what you see is whichever frame the
   browser painted. Nothing needs the probe: `rect.top` is decided by what sits
   ABOVE the element, and what sits BELOW is stable once the height is applied,
   so the second pass computes the same target and the >1px guard ends it.
   Reach for the cap when a pane should be as tall as its rows and no taller;
   reach for the exact one when several panes SHARE a height.
   **BUT REFUSING THE PROBE MEANT REFUSING THE CAP'S OWN CURE, and that shipped
   a frame stuck at its floor** (Mark, 2026-08-08: "why is there so little height
   on the Ingredient and procedure section?"). Both hooks asked
   `body.bottom - rect.bottom` for what sits below, and `body` is `min-h-full`,
   so on a page shorter than the window its bottom edge is the foot of the
   VIEWPORT and every pixel of slack counts as content. `below` absorbs the
   slack, `innerHeight - top - below` returns EXACTLY the height the element
   already has, and the measurement is a FIXED POINT at whatever it started
   at — which for a column of `basis-0 grow` panes is ZERO, because they have no
   content height before a definite one is written, so the floor is where it
   stops. The cap escapes by dropping `max-height` first, which makes the page
   overflow again so the body tells the truth; the exact hook cannot, and had no
   defence at all. Measured: the Recipe tab's frame sat at its 360px floor in a
   720px window with 71px of white underneath, showing three sticky header rows
   and not one ingredient.
   So `spaceBelow` in `lib/tableHead` walks the ancestors instead and adds up
   what really follows — at each level the gap from our bottom to the bottom-most
   later sibling, plus that level's own bottom padding and border, skipping
   out-of-flow siblings. Every one of those distances is INDEPENDENT of our
   height, which is what keeps the answer stable. Verified: 1000px window →
   679.5px frame (1000 − 288.5 top − 32 layout padding), two 320px halves, page
   exactly one viewport; 1400px window → 1079.5 and two 520s. **The cap still
   asks the body**, masked by its probe — a latent version of the same bug, worth
   remembering if a `useFillViewportHeight` pane is ever mysteriously short.
   **The viewport measurement IS gated on width — at `xl`, where the two columns
   exist.** Below it the blocks stack in ONE column and a height there either
   clips them or hands an iPad three ~250px panes inside a scrolling page.
   Stacked, the page scrolls, and the stretch classes go with it
   (`flex-initial xl:flex-1`, or a basis of 0 in an auto-height column collapses
   the block). This is NOT the gate removed earlier the same day for leaving
   height unused (Mark: "so much height unused") — that symptom was the fixed
   point above, which left the frame at its floor at EVERY width; ungating it
   only made a narrow window wrong a second way. The RECIPE tab stays ungated
   and keeps `useExactViewportHeight`: it is two lists sharing a column at any
   width, and there the even split IS the answer. Short windows are handled by a
   FLOOR — 360 on the Recipe frame, 132 on the Info tab's versions cap — past
   which the page scrolls, which is the honest failure.
   Other traps paid for here: **`min-w-0` on both columns and NOT behind a
   breakpoint**, or the costs matrix's own `minWidth` stops its track shrinking
   and pushes the PAGE sideways; the ingredient grid's **one scroller for both
   axes**, since `position: sticky` resolves against the nearest scroll
   container and a separate horizontal wrapper pins the labels to a box that
   never scrolls vertically; and its **three header rows stack their sticky
   offsets** (0 / 26 / 62px, measured).
   **THE INFO TAB IS ONE SCREEN** (Mark, 2026-08-08: "ideally everything should
   display on a single screen. Notes and versions should scroll"). The fields sit
   at their natural height; below them a row takes whatever is left, holding
   NOTES down the left and VERSIONS over COSTS down the right — see the
   arrangement note above, which supersedes the `basis-0 grow` / `grow-[1.5]`
   left column this line originally described. Height is MEASURED
   (`useExactViewportHeight`) and only above `xl`; stacked, the page scrolls.
   **`min-w-0` ON BOTH COLUMNS, not behind a breakpoint** — a flex item's
   min-width defaults to min-content, so the matrix's own `minWidth` made its
   column refuse to shrink and pushed the whole PAGE sideways. And the costs pane
   is sized to the matrix (`xl:w-[32rem]`) rather than to a share of the row:
   given a fraction it came out 394px for a 508px matrix, so the one block whose
   point is the comparison across it had to be scrolled to be read.
   **The Batch cost fact at the top is GONE** (Mark, 2026-08-12: "batch cost in
   this screenshot isn't useful information (it's also wrong as it doesn't
   include labor …). You can get rid of it"). It quoted the matrix's INGREDIENTS
   row, so on Raisied Donut v11 it read $57.08 three inches above the block's
   own subtotal of $179.58 at the same column — one figure short of the labour.
   The chosen column's state stays in `RecipeInfo`: it is the block's own
   selection, lifting it costs nothing, and pushing it down would mean the
   matrix computed in two places. **Item is the ingredient grid's SECOND column**, after Sort, the
   multiplier row is a single `×` centred over the AUTO column it governs, and
   **AUTO is a CHECKBOX** — Mark, 2026-08-08: "we have both toggle switches and
   check boxes in the ingredient list. Pick one." Two shapes for one kind of
   answer on one row is just something else to read; the box matches FileMaker,
   matches HIDE beside it, and costs a third of a switch's width. `ui/Switch`
   stays what it is, a control for a RECORD's state.
   **MODIFIED is FileMaker's stamp where we have one** (`fmp_modified_at`, parked
   in `source_payload` by `backfill-recipe-created.mjs`), and `updated_at` where
   we don't. That order is right today — for every migrated recipe `updated_at`
   is the moment the migration ran — and it has a known cost: editing a migrated
   version here will NOT move the date, because nothing clears the stored stamp.
   Giving `_ModificationTimestamp` its own column is the fix and it is a
   migration.
   **MIXER, YIELD AND PREP TIME ARE GONE FROM THE INFO BLOCK** (Mark,
   2026-08-08) — and from the printed sheet's header, which is the same
   instruction applied twice. All three are per BATCH SIZE and are rows on the
   Recipe tab; a single value beside them was the same fact stated twice and, on
   Raisied Donut v11, stated differently (30 ea against a row reading 34 → 340).
   `mixer_size` and `prep_time` now have NO reader in `web/src` at all — the
   columns keep FileMaker's single value and the transform still fills them.
   **The costed yield moved to the COSTS block rather than going with them**,
   which is the one part of this that isn't a deletion. At the time `yield_amount`
   was what `lib/productionCost` divided by, so deleting its only editor would
   have left the number behind every figure the app quotes invisible and
   unfixable. **That follow-up has since been taken — see "THE YIELD IS THE
   RECIPE'S OWN ROW" below** — so the column no longer costs anything, and the
   editor in the Costs block is now a display of FileMaker's single value.
   Whether it earns its place there at all is worth a look.

   **THE YIELD IS THE RECIPE'S OWN "EXPECTED YIELD" ROW, AT THE COLUMN THE
   RECIPE IS COSTED AT** (Mark, 2026-08-12: "we should not use
   production_recipe_versions.yield_amount to determine costs. we should use the
   recipe yield number, always and forever" — then, seeing the block: "use the
   yield in the column that is chosen for costing").
   `elementCost` divides a made element's batch by
   `metadataLine(version.lines, "yield")` at 042's `cost_column`, and
   `CostVersion` no longer CARRIES
   `yield_amount` / `yield_unit` — which is the guarantee rather than a tidy-up:
   a caller cannot supply the column, so the resolver cannot read it. The graph
   loader stopped selecting it too.
   Why the row wins: it is what the kitchen reads, it is on the printed sheet,
   it is per batch size, and it is maintained by whoever maintains the recipe.
   The column is FileMaker's single `Yield` field, lifted once at migration and
   edited by almost nobody since. Two answers to one question, and they
   disagree — measured over the 128 masters, **84 agree, 19 differ, 25 have
   neither**, and where they differ the gap is not small.
   Measured through the real resolver over the live catalog, both ways: **20
   made elements moved, 0 lost a cost, 0 gained one.** Lemon Curd $0.0928 →
   $1.3535 (the column said 35 where the row says 2.4), the cake donuts double
   (30 against 15), Vanilla Cake Donut halves, Raised Donut $0.2074 → $0.1830.
   Units were checked before the switch and agree on all 103 masters carrying
   both; the 3 exceptions are null on both sides, so `unit` comes from the row
   too with nothing to lose.
   Two guards moved with it, each fixture-tested by breaking it. A **zero**
   yield is refused rather than dividing by it. And **"no ingredients" now asks
   whether any line carries an `element_id`**, not whether `lines` is empty —
   the yield row IS a line, so the old test would have let a version of nothing
   but metadata rows come back as an unexplained null, which is the one outcome
   that module exists to prevent. `elementCost` also reports the BATCH's own
   reasons before "no yield": an empty recipe has neither, and "no ingredients"
   is the more useful thing to say first.
   **INGREDIENTS AND YIELD MOVE TOGETHER OR THE ANSWER IS OUT BY THE
   MULTIPLIER.** `versionBatchCost` sums each line's `qty`, which is the BASE
   column, so costing at x1 means scaling that by the column's multiplier as
   well as taking that column's yield. Raisied Donut v11 is the worked example:
   $5.71 over 34, or $57.08 over 340 at x1 — take one without the other and it
   is a tenth or ten times the truth. Which is also why choosing a column
   USUALLY changes nothing: both sides scale by the same multiplier and cancel.
   Measured over the live catalog, base versus chosen: **100 made elements the
   same, 0 different** — only one version carries a `cost_column` at all and its
   yield strip is proportional. It matters exactly where the yield row is one
   somebody turned AUTO off for and typed (30 of the 493 versions), and there
   the chosen column is the only honest answer. The `%` column can never be the
   costed one, and a `cost_column` pointing at a slot the strip no longer has
   falls back to the base — `recipeCosts` falls back the same way, so the block
   and the element always quote the same column.
   **The "Costed yield" field is GONE from the Costs block** (Mark, 2026-08-12:
   "redundant and unnecessary because the user can already choose the batch size
   for costing purposes"). `yield_amount` now has NO editor anywhere in the app
   and exactly one reader — the recipes LIST's Yield column, which is still
   FileMaker's single value and may disagree with the row.
   **THERE IS ONE COST CALCULATION AND IT IS `recipeCostMatrix`** (Mark,
   2026-08-12: "why are you reinventing the wheel? The cost per each is already
   a calculated value … Just do one calculation (that includes labor) and use it
   everywhere" — then "use the value in the cost matrix"). It lives in
   `lib/productionCost`, NOT in `lib/recipeCosts`, which is now a re-export shim
   for the components: what an element costs and what the block prints are the
   same call at the same column, so the arithmetic belongs in the costing module
   and the block is a view of it.
   The drift it removes was real and shipped: the block said **$0.53** a donut
   while `elementCost` said **$0.17**, and the whole of the difference was
   $122.50 of prep time nobody was charging for. `elementCost` now reads
   `defaultColumn(matrix).costPer`, so a made element's cost INCLUDES ITS
   LABOUR — the prep-time row times the hourly rate, over the yield like
   everything else. Measured at DF01's $35/hr: **69 made elements unchanged, 31
   gained labour, 0 newly costed**, and Raised Donut reads $0.5282 where the
   block reads $0.53. Some of the 31 move enormously (Candied Walnut Topping
   ×52, Hot Fudge ×25) — that is a signal about small or wrong Expected Yield
   rows, not about the rule, and it is worth walking.
   **`CostContext` replaced the bare `locationId`** on `elementCost`,
   `versionBatchCost`, `lineCost` and `itemCost`. Both halves are per-shop
   (Mark, 2026-08-12, after trying the opposite for ten minutes: "each location
   has its own vendor item and labor costs") — design rule 6's price override,
   and `locations.labor_rate`. So the same recipe at DF01 and DF02 legitimately
   costs different amounts to make. `costContext(session.activeLocation)` is the
   one line a caller needs, and `locations.labor_rate` now rides on the session
   rather than being fetched per screen: it went from one column read by one
   screen to one read by every screen that quotes a cost.
   **A version with NO scale strip gets an implicit base column.** 11 of the 493
   carry no labels, and an empty column list would have made them cost nothing
   and render an empty block. The synthesised column is unnamed on purpose —
   inventing "Base" would put a word on the sheet FileMaker never had.
   `METADATA_LABELS` / `metadataLine` moved from `lib/recipeCosts` to
   `lib/production` when both cost modules needed them — `lib/production`
   imports nothing, which is what keeps the two from becoming a cycle.
   **Still open, and it is DATA rather than code:** Raised Donut's row says 34
   where Mark's own packet arithmetic says a batch makes 340, so its per-donut
   cost is an order of magnitude light. The rule now makes that fixable in one
   visible place — the row on the Ingredients tab — instead of in a column
   nobody reads.
   Exercised against the live database and left as found: the radio wrote
   `cost_column = 2`, the mark moved, the headline re-quoted at x3/4, and it was
   set back to null (0 versions carry one).
   **THE PAR MOVED ONTO THE PLAN SLOT 2026-08-08 (migration 043, NEEDS
   APPLYING).** Mark: "production pars should probably live here in the plan
   rather than off the production item… each tray would have two fields instead
   of one: [production_item] [par]." A slot is already keyed (tray, weekday,
   item) and a plan carries the selling location, so the par lands on exactly
   the axes it needs — and the old home stated the weekday axis TWICE. Measured
   before the change: **184 of 311 par arrays vary by weekday**
   (`DF01 [18,18,18,18,24,36,36]`, the weekend ramp), so that second axis
   carried real information and duplicated the plan's own. Done at the cheapest
   possible moment — 1 plan, 2 trays, 1 slot, 0 overrides, 0 schedules, so
   nothing to data-migrate.
   **THREE STATES, AND THEY ARE THE ORDER GUIDE'S THREE.** A number makes it; a
   deliberate **0** means "on the menu, making none" and reads as SUPPRESSED,
   keeping its tray position (taking it off the tray is how you say it is off
   the menu); **null** is silence, a yellow "—", and the day says "no par set".
   Zero and null being different sentences is the whole point, and
   `slotParLabel` exists so the classic `par || "—"` can't quietly merge them.
   **`production_item_locations.par_by_weekday` is now a SEED, not a source**
   (013's shape — a PO line snapshots its price and then owns it). Adding an
   item to a Saturday cell at DF01 prefills from that item's Saturday default;
   nothing reads the array again. **A default of ZERO seeds NULL**
   (`nullif`, both in the backfill and in `defaultParFor`): an old-array zero
   meant "we don't make it that day", which is silence, and seeding it through
   would manufacture a decision nobody made. The invariant: **a suppressed line
   always traces back to a human act on the plan.** Measured — only 3 zero slots
   exist in the whole dataset, none at DF01 or DF02, so that rule is chosen for
   the invariant rather than the data. **No `par_source` on the slot**: nothing
   rewrites a plan slot, so a seeded number is just the number you accepted.
   The column is dropped LATER, once real plans carry the numbers.
   Two SQL hunks beyond the column, each guarding a specific failure:
   **the reason pick in `production_day`'s `planned` CTE** now yields a reason
   only when nothing in the group can be made — with the par on the slot two
   plans genuinely disagree, and the old arbitrary pick would print "making none
   today" beside a par of twelve (under 040 every row in a group read the SAME
   array cell, so the pick was harmless); and **`is_suppressed` is
   `coalesce`d** — `sum()` over all-null pars is NULL, `not NULL` is not false,
   and that expression is filtered on in FOUR places in
   `generate_production_schedules`. `generate_production_schedules` itself is
   UNCHANGED.
   Known consequence, accepted: the receipt's `not_made` warning now fires for
   every deliberately-zeroed slot, every night. If that gets noisy the fix is a
   distinct warning kind, not silence.
   **FOUND, NOT FIXED — an item switched off at a shop STILL GETS MADE.**
   `is_makeable` is not one of `production_day`'s return columns and never has
   been, and the fold has never consulted it; generation filters on
   `par > 0 and not is_suppressed`. So `il.is_active` produces the sentence
   "item inactive at this shop" and gates nothing — under 040 exactly as now.
   Latent today (**0 of 307 items and 0 of 325 item-locations are inactive**),
   which is why it was left alone rather than folded into a migration about
   where the par lives. **Ask Mark before changing it**; the honest options are
   to let a structurally-unavailable item read as suppressed, or to gate
   generation on `is_makeable`.
   Verified: all 43 migrations apply on the Docker harness, `security_invoker`
   and the `authenticated` grant both survive the view's drop-and-recreate,
   every row of the suppression table asserts (including the two behaviour
   changes — an item with NO item-location row now makes, and a zero on one
   plan is not a veto over another plan's twelve), no `is_suppressed` is ever
   null, generation writes 5 lines totalling 72 with each refusal named in its
   own words, a regeneration deletes the newly-zeroed line while keeping a
   `manual` line and carrying actuals forward, the actuals refusal raises, and
   as real authenticated roles **staff read 15 slots and update 0 with NO
   error** while a purchaser updates 15 and `anon` gets 0 rows from the view
   and is refused `production_day` outright. **671 fixtures pass**, and each of
   the five new rules was checked by breaking it.
   Until 043 is applied the plan record SAYS SO — "column
   production_plan_tray_items.par does not exist — migration 043 has not been
   applied yet" (verified in the browser), rather than rendering an empty
   matrix, which would be a false claim about the menu.
   **043 IS APPLIED** (Mark, 2026-08-08). The backfill seeded the existing slot
   and the app seeded the rest: DF01's Angry Samoa came through as
   **18·18·18·18·24·36·36**, the weekend ramp, which is the ISO subscript proved
   on real data rather than only in a fixture.
   **THE MATRIX GREW FMP'S PAR CONTROLS the same day** (Mark, after using it).
   Five changes, all his.
   **The table is `table-fixed`** — it never was, so widths were suggestions the
   content could override and a long item name stretched its own column. Tray is
   60px (half what it was) and the seven days split what's left evenly.
   **Two STACKED STEPPERS beside every par**, up and down, and a second pair
   that moves the whole row — the latter at the END of the row, left of the ⋯
   (Mark, 2026-08-08), so the two controls that act on the TRAY sit together
   rather than one at each margin. The tray column gave up exactly what the
   controls column took (60/40 → 40/60), so the seven days are unchanged, and
   the 16+4+36 cluster fits its column exactly.
   That row stepper carries **`mt-[5px]`**, which is the chip's 1px border plus
   its 4px top padding — the two things between a day cell's top and the stepper
   inside it — so it sits on the same line as every per-day stepper in its row
   rather than 5px above them (Mark: "a little high"). Measured, not guessed; if
   the chip's padding moves, this moves with it.
   The tray column's header is **"#"** (Mark), the word being wider than the
   40px column it labelled, with an `sr-only` "Tray" beside it because a screen
   reader saying "number sign" names nothing. **They step by the item's
   own `tally_box_size`** (037, default 6, per item) rather than a hardcoded 6 —
   Mark's "always 6" and the tally strip's 6 are the same fact, a box of donuts,
   so an item later set to tray in twelves plans in twelves for free.
   **ZERO IS THE FLOOR** and **NULL COUNTS AS ZERO**: up from silence is one
   box, down from it is a deliberate none. That does not violate the
   suppressed-lines-trace-to-a-human rule — pressing a stepper IS the human act.
   The row stepper GROUPS BY RESULTING VALUE, so a tray's seven days are two or
   three updates rather than a dozen; each item brings its own box size.
   **Drag an item to another slot** (`lib/planSlotDrag`, `useColumnDrag`'s shape
   and its reasons: pointer events, never HTML5 DnD; state changes twice per
   drag; every cell measured ONCE at pointer-down).
   **THE DESTINATION OFFERS TWO DROP ZONES — Move left, Copy right** (Mark's
   idea, 2026-08-08). Both outcomes are on screen and labelled, so there is no
   invisible rule to know, and — the reason it earns its complexity — **copy
   becomes reachable on TOUCH**, which a modifier key never was. Option still
   forces a copy for the muscle memory, and while it is held BOTH zones relabel
   to "Copy", so the screen never says one thing and does another.
   That was chosen over splitting the zones by PAR (keep vs default), which was
   the first proposal. The par question is answered one tap later and is
   reversible; copy-on-touch is a capability that otherwise does not exist. Two
   zones also stay two — splitting by par as well would have meant four targets
   in a 153px cell, geometry that collapses to one zone whenever the default
   agrees, and a mis-hit that produces a silently wrong number instead of a
   visible extra chip.
   **THE PAR ALWAYS TRAVELS**, move or copy: it is the number you typed, a
   reposition must not rewrite it, and re-reading the default would undo what
   043 made a seed. Where the destination's default DISAGREES it is offered
   afterwards — `→ use default 24` on that slot, the receiving screen's idiom,
   held in `landed` state rather than derived (plenty of slots legitimately
   differ; this is about the ones you just moved).
   **IT STAYS UNTIL DISMISSED** (Mark, 2026-08-08). It first cleared on your next
   action, on the reasoning that an offer nobody answers should not linger — but
   that made moving three items and then touching anything lose the question
   before you had answered it, and the whole point of offering rather than
   applying is that you decide in your own time. So `landed` is a RECORD keyed by
   row: a run of drags leaves a run of offers, each with its own ✕, and taking
   one settles it. Two things keep it honest without a sweeper: the offer only
   renders while it still DISAGREES with the slot's par, so any other route to
   that number retires it silently; and a key for a slot that no longer exists
   simply never renders. It sits on its OWN line, which does not breach
   the one-line rule: that rule is about the chip at REST, and squeezed onto the
   main line the offer broke "Angry Samoa" into "Angr/y/Sam/oa".
   **Only the item NAME is a handle**, since the chip now also holds two
   steppers, the par's own `InlineValue` and the ✕. The chip relabels itself
   "Copy …" while Option is down, and it listens for keydown/keyup as well as
   pointermove — pressing Option without moving fires no pointer event at all.
   **Duplicate a tray**, and — because that was a one-way door — **delete one**,
   both in a **`ui/RowMenu`** in a 40px column at the END of the row (Mark,
   2026-08-08, replacing a pair of Copy/Del links that appeared on hover beside
   the tray number: "more discoverable", and worth the horizontal space). It is
   the app's own ⋯ idiom, so it costs nothing to learn, anchors right, and
   escapes the table the way `PickList` does.
   `nextTrayNumber` counts a numeric label UP keeping its width and skips the
   ones in use ("01" duplicated past a taken "02" becomes "03"); anything else
   ("7A") takes a suffix, because incrementing a non-number is guesswork. The
   tray is written BEFORE its slots — a tray with nothing on it is visible and
   one gesture from fixed, where slots with no tray cannot exist. Delete is
   `window.confirm` naming what goes ("…and the 7 items on it?"), the PO
   batch-delete pattern; 039's slots cascade from the tray.
   **THE CHIP IS ONE LINE OF TWO GROUPS** (Mark, 2026-08-08):
   `[item ✕] [par ▲▼]`. The ✕ belongs with the thing it removes and the steppers
   with the number they move, so each pair reads as a pair — which the original
   `name · steppers · par · ✕` did not, having interleaved the two. **Written as
   two stacked lines first and corrected**: Mark's brackets were GROUPS, not
   rows. The ✕ occupies its 10px whether or not it is showing, so revealing it on
   hover shifts nothing. Known cost of one line, and his call: at ≤1280px the
   name gets ~63px of a 139px chip and wraps to two lines; by 1680 it has 120px
   and does not.
   **The steppers lost their borders** so the arrows could grow (7px → 11px). A
   box around a 7px glyph spends most of its width on the box, and two stacked
   read as something to decipher; bare arrows are the affordance, darkening on
   hover like every other quiet control here.
   **"+ add" OPENS THE LIST** (Mark, 2026-08-08: "right now it's a two click
   process"). `ui/PickList` gained **`defaultOpen`** — the panel is up as soon as
   it renders, because pressing the button already said you want to choose
   something — and **`onClose`**, which fires only on the DISMISS path (Escape,
   click away, or pressing the trigger again) and NOT on a pick, so the matrix
   can put "+ add" back rather than leaving an empty field where the command
   was. Since 307 items make the list searchable, the cursor lands in the find
   box ready to type. Only ever pass `defaultOpen` to a picker a deliberate act
   summoned; a list that opens itself on load is a popup.
   The Trays block's explanatory paragraph is GONE (Mark).
   **The plan's TITLE and both its SHOPS are inline-editable** (Mark,
   2026-08-08) — the title where you read it, in the `h1`, and Sells at / Made
   at as `kind="pick"` cells over the ACTIVE locations (design rule 3: a closed
   shop is not one you can plan a menu for, while `session.locations` still
   resolves the CODE of one, so an existing plan at a closed shop still renders
   its name). `location_id` is NOT NULL; `kitchen_location_id` is nullable and
   "not set" stays a real state, because 039 left the kitchen open for a plan
   written before anyone decided, and decision 9's fallback then reads it as the
   selling shop. Two things the title needed: **`InlineValue` now forwards
   `ariaLabel` to the `PickList` on its `kind="pick"` branch** (it only reached
   the text/number button before), and the title cell carries `uppercase`
   EXPLICITLY — the browser reset sets `button { text-transform: none }`, so an
   `h1`'s own `uppercase` does not reach a button inside it. Note
   `emptyClassName` is a text/number-branch prop and does nothing on a pick.
   **A tray's `band` IS ITS CATEGORY** (Mark, 2026-08-08: "more intuitive").
   Label only — the column is still `band`, which is what 039 called it and what
   `v_production_plan_days`, the schedule snapshot and the printed packet all
   select. Same split as `admin` displaying as "Manager": rename the word, leave
   the schema alone. It is editable from the ⋯ menu's **Edit category**, a dialog
   with the same `allowNew` `PickList` the create form uses (the vocabulary is
   the org's own and legitimately grows) plus a **Clear**, because having no
   category is a real answer — such a tray groups under "No category" rather
   than vanishing.
   **Group by Tray, Category or Item type** — a `ui/TabPicker` above the table,
   since a control that changes what a list SHOWS goes with the list.
   **Item type is FileMaker's own banding**, from Mark's DONUTS screen: it bands
   the donut TYPE (the black CAKE / MOCHI / OLD FASHIONED rules) and orders
   WITHIN it by cut then finish. The band key and the sort key are deliberately
   different things — banding on type+cut+finish would put a rule above almost
   every tray, which names nothing. **Only the FIRST item on a tray's MONDAY
   speaks for that tray** (Mark's instruction): a tray usually carries one kind
   of donut all week, so one representative is enough, and naming a day makes
   the answer stable instead of depending on which cell you looked at. A tray
   with no Monday item sinks under "No type". Measured on the real 24-tray plan:
   Cake 4 · Old Fashioned 1 · Raised 17 · Scrap 2, summing to 24.
   **The CUT is a SECOND band under it** (Mark, 2026-08-08) — FMP's BANANA /
   VANILLA headings — and deliberately a lighter one: black on white with a gap
   after the run's last tray, not a second filled rule, because a second black
   band would read as another break of the same weight where this is a heading
   INSIDE one. Its run is keyed by the **(type, cut) PAIR**: two types can both
   have a "Plain" cut, and keyed on the cut alone the second Plain run loses its
   heading and reads as a continuation of the first. `endsSubGroup` marks the
   LAST row of each run, which is what carries the gap — pinned by a fixture
   that asserts the exact `[tray, cut, endsSubGroup]` triples, so marking the
   run's start instead goes red.
   Grouping is a
   VIEW: `production_plan_trays.sort` is untouched either way, so the packet and
   `production_day` keep reading the plan's real order however you are looking at
   it, and `buildMatrix` sorts a COPY (checked by breaking it — an in-place
   `trays.sort` turns one fixture red, and only after that fixture was rewritten
   to use its own array, because the shared one had already been reordered by an
   earlier test and the assertion passed while the bug was live).
   `groupLabel` is set on the FIRST row of each run and null elsewhere —
   `DataTable`'s rule that a grouping can only band what the ORDER already
   groups, which is why the label comes from the same function that sorts —
   and **`groupCount` rides with it**, the trays in THAT run, computed in the
   same function for the same reason: it is the one that knows where the run
   ends. Rendered `text-white/55` beside the label, `DataTable`'s own band
   treatment. The band is black with white text, the same mark every other
   grouped list uses, and uncategorised trays SINK (`lib/tableSort`'s empty-last
   rule) under a "No category" band rather than a blank one. Local state, not
   the URL: it changes nothing about what the plan is, and a plan is read in one
   sitting.
   **The grand total sits in the sticky footer** beside Add tray — it repeats
   the section heading's own count deliberately, because once the footer is
   pinned the heading has scrolled away. A fixture asserts the band counts SUM
   to the tray count, so the two figures cannot drift into disagreeing.
   **The PLAN LIST has a ⋯ too — Duplicate plan and Delete plan** (Mark,
   2026-08-08), the same `ui/RowMenu` in an unlabelled last column, which keeps
   it out of the Columns menu because it is a control rather than a field.
   **THE DUPLICATE ARRIVES INACTIVE, and that is the one deviation from "an
   exact copy".** Decision 9 makes a shop's menu the UNION of its active plans
   and their pars SUM, so an active duplicate over the same dates would silently
   DOUBLE that shop's production the next time anyone generated. The list's own
   Active toggle is one tap away, which makes turning it on a deliberate act
   rather than a consequence. Written parent-first (plan → trays → slots), and
   the new trays are matched to the old by TRAY NUMBER rather than by insert
   order, which is not a thing to rely on. `duplicateTitle` names it "… copy",
   "… copy 2" — no unique constraint exists on the title, so this is for the
   READER picking a plan out of a list.
   **CHECKING THE PARS AGAINST A SHOP'S DEFAULTS IS ONE MODE WITH THREE DOORS**
   (Mark, 2026-08-08, having moved a copied plan from DF01 to DF02 and wanted
   its pars re-based). He offered three designs — always flag, an always-visible
   reset, or a dialog on the location change — and they are the same question
   asked at three moments, so they are one feature: a DUPLICATE arrives in
   review mode, MOVING the plan to another shop turns it on by itself (state
   adjusted during render when the `locationId` prop changes, React's own
   documented pattern), and a **Check pars** control turns it on whenever.
   **"Always flag" is the one option NOT taken**, and deliberately: a plan is
   SUPPOSED to diverge from the defaults — that is what a seasonal menu is — so
   a permanent mark would sit on exactly the slots somebody had thought hardest
   about and teach the reader to stop seeing it.
   The control states the count BEFORE you turn it on ("175 pars differ from
   DF02's defaults"), because a number you can only see once you have already
   entered the mode is no use for deciding whether to. That is why `defaultGap`
   (the FACT) is split from `suggestionFor` (what the screen is offering).
   Inside the mode, **Use <shop> defaults** takes every offer at once, grouped by
   resulting value like the tray stepper, `window.confirm` naming the count and
   saying the current numbers are replaced.
   All three of that band's controls are the app's ONE button weight, outlined
   and white (Mark, 2026-08-08: "make it look like a real button"), and the two
   that write NAME THE SHOP — "Use DF02 defaults", "Update DF02 defaults" — so
   neither can be read as being about the plan in the abstract, which is the
   whole confusion that started this. The count that used to ride in the label
   ("Use all 175") came out of it: the sentence beside them already says 175,
   and a number inside a button reads as part of the command.
   The **Trays** section heading is GONE with them (Mark) — the pinned footer
   already says "24 trays on this plan", and a heading that only restated a
   count was pushing the band that matters down the page.
   **That whole band lives IN THE FOOTER, just after the tray count** (Mark,
   2026-08-08), which is where this screen's persistent commands already were.
   It costs nothing to put there: `StickyFooter` measures its own height into
   its spacer, so the band appearing — or wrapping on a narrow window — keeps
   the last tray row clear by itself. Measured at 1280: the footer holds
   everything on one 60px line, and scrolled to the bottom the last row ends
   exactly at the footer's top edge. When nothing differs and review is off the
   band is absent entirely, so the quiet state is the footer as it was.
   **EVERY "use the default" HAS ITS REVERSE** (Mark, 2026-08-08) — the
   receiving screen's two-stage price button in a plan's terms: take the app's
   figure, or tell the app yours. Per slot, `↑ set default n` sits on its own
   line under `→ use default n`, quieter, and in bulk **Set defaults from plan**
   sits beside **Use all n** as text rather than a bordered cell. The asymmetry
   is deliberate and is the whole point: taking a default changes THIS PLAN,
   where setting one changes the SHOP'S CATALOG that every future plan seeds
   from — so it is a separate act, worded to say so, and its confirm spells out
   the blast radius.
   Two things the write has to get right. It **UPSERTS** on
   `(item_id, location_id)`, because most pairs have no row at all
   (/price-grid's "set" problem) and an update would change nothing and report
   success; only `par_by_weekday` is written, so `is_active` and
   `price_override` survive — verified. And **`arrayWidth` is 7, not the strip's
   own length**, since 037 checks `array_length = 7` and a null or short strip
   would otherwise be refused on the first write. The bulk version groups by
   ITEM, not slot: one item appears on several weekdays and they share one
   seven-slot array, so writing them separately would have each overwrite the
   last.
   Round-tripped on the live DF02 catalog: `↑ set default 24` moved Angry
   Samoa's Friday from 18 to 24 and touched no other slot, then the plan par was
   stepped down, `↑ set default 18` put it back, and the par stepped up — the
   array is `[18,18,18,18,18,18,18]` again.
   Verified on Mark's real DF02 plan — 175 of 225 slots still carried DF01's
   numbers, and the per-slot offers appeared on exactly those. The bulk write
   was proved on a THROWAWAY duplicate rather than his live plan (175 → 0,
   banner flipping to "Every par matches DF02's defaults"), then deleted.
   **A duplicate opens OFFERING the shop's defaults** — `?defaults=review`, which
   turns the drag-copy's `→ use default n` on for EVERY slot whose par disagrees
   with its default rather than just the ones a drag landed on. `suggestionFor`
   is the one function both routes go through, which is why `dismissed` had to
   become its own set: a DERIVED offer cannot be cleared by forgetting it the
   way an explicit one can. A parameter rather than stored state — the offer is
   a question about a copy you just made, not a fact about the plan.
   Verified end to end on the real 24-tray plan: the copy came out 24 trays, 225
   slots, par total 4908 identical and inactive; **all 225 pars already matched
   their DF01 defaults so it correctly showed ZERO offers**, and stepping one
   par made exactly one appear. Delete named "…and its 24 trays carrying 225
   items", cascaded, and left no orphans.
   **Add tray is PINNED to the foot of the window** (`ui/StickyFooter`, Mark) —
   a plan runs to a dozen trays and more, so a command under the table was a
   scroll away from the rows you were building. Measured: the button holds y=668
   at both scroll extremes, and the spacer keeps the last row clear of the bar.
   Exercised against the live database and **left exactly as found**: the single
   stepper 18→24, the row stepper moving all seven, a real pointer drag moving
   Sunday between trays with its par, an Option-drag copying it, Copy creating
   tray 03 with all seven slots, Del removing it, then the pars stepped back to
   18·18·18·18·24·36·36 and tray 02 emptied. **677 fixtures pass**, 6 new.
   **Harness note for anyone verifying a drag:** the browser pane's
   `left_click_drag` DOES dispatch real pointerdown/move/up, but its coordinates
   are **1.6× the CSS viewport**, and its `modifiers: "alt"` does **not** set
   `altKey` on the dispatched events (measured: `alt=false` on every one, no
   keydown at all). So Option-drag cannot be driven through the pane — dispatch
   the `pointerup` yourself with `altKey: true`. `window.confirm` is inert there
   too; override it.
   **Shipped 2026-08-09, phase 5 — ACTUALS (migration 044, NEEDS APPLYING).**
   The other half of every document phase 4 produces: what actually happened.
   Three pieces, all Mark's calls this session.
   **(a) `made` / `leftover` on a schedule's lines**, which 040 created and
   nothing had ever written — all 64 lines of the two real 2026-08-09 schedules
   were null, so the list's Counted column read an em dash on every row and the
   `sold` the view already computes had never had a non-null input.
   **`sold` STAYS DERIVED and its one definition is SQL**:
   `v_production_schedule_lines` computes it, had no reader in `web/src` until
   now, and PO detail and the item history both select the view — so there is no
   TypeScript twin to drift and one place for the POS seam to land.
   **SUPERVISORS MAY COUNT, THROUGH A COLUMN-SCOPED DEFINER**
   (`set_schedule_actual`), which is 029's `report_pooled_tips` shape and what
   040's own RLS block said this phase needed. RLS filters ROWS; "a supervisor
   may set these two and nothing else" is a COLUMN rule, and a widened UPDATE
   policy would also hand them `par`, `par_source`, `planned_par` and the whole
   cost snapshot. The whitelist is a `case when` inside the UPDATE, never
   dynamic SQL.
   **That forced `InlineValue`'s one new prop, `onWrite`** — the cell's write is
   the only thing that changes, so the arithmetic evaluator, Escape-reverts and
   reopen-on-failure all survive. **Without it the failure is SILENT**: a direct
   update by a supervisor matches zero rows and PostgREST returns NO error, so
   the component reports success, `router.refresh()` hands back the old value,
   and the number vanishes. Verified on the harness — the RPC writes 1 row while
   the direct write changes 0 and errors not at all.
   **The function takes a COLUMN NAME rather than both values**: a pair-writing
   one would need the sibling cell's rendered value, so editing `made` could
   resurrect a `leftover` just cleared. `counted_by`/`counted_at` clear only
   when the write empties the LAST of the two, in one statement against the
   row's own values — a read-then-write would lose a number when two people
   count one line at once.
   **A SUPERVISOR MAY ALSO PRINT** (`mark_schedule_printed`, Mark's call): the
   packet stamp was purchaser+, which is the same silent zero-row write one
   table up, and printing is the same closing routine the counts are entered in.
   `stampPrinted` loops the definer instead of one `.in()` update, and the
   author now comes from `auth.uid()` inside it rather than a `getUser()` round
   trip.
   **(b) The batch log — `production_batches`**, the module's last unbuilt
   table, with `/batch-logs` + a record, a photo in a new private
   `batch-photos` bucket (018's template, its own bucket on 041's test —
   a supervisor may photograph a batch and may not upload a recipe image), and
   `next_batch_number` seeded at **30000** (006's idiom; FMP's own maximum is
   19,541, so the seed is provably clear rather than merely chosen).
   **A BATCH IS A SUPERVISOR'S OWN RECORD, so it is a POLICY, not a function** —
   the first write policy in this schema to name `supervisor`, which 020
   predicted in those words. That asymmetry with (a) is the thing to understand
   before editing either: a schedule line is a purchaser's document with two
   supervisor-writable cells (a COLUMN rule → a function), a batch is theirs
   entirely (a ROW rule → a policy). Delete stays purchaser+: correcting a batch
   is editing it; erasing the record that one happened is a different act.
   **A batch names TWO people** — `created_by` stamps the app user for audit,
   `operator_employee_id` names who actually made it, because the overnight
   baker has an HR record and no login. That needed
   **`production_operators()`**, a definer returning employee **id and name
   only**: 020 gates `employees` READ to owner/admin, so a supervisor logging a
   batch cannot read the one table that knows the name. CLAUDE.md 4c predicted
   this function in as many words. Verified: as a supervisor
   `select * from employees` returns **0 rows** while the function returns the
   roster.
   **`generate_production_batches` reads `schedule_class = 'WEEKLY'` ONLY**
   (159 of 470 elements) and covers **one kitchen, one week**, Monday-start,
   normalising whatever day you pick. AB (49) and DONUT (18) are never
   generated and reach the log by hand — the thing most likely to look like a
   bug when a donut element never appears. It follows 040's guards in 040's
   order so there is one rule to learn: skip and name, `p_replace` to touch,
   and a batch carrying a YIELD raises unless allowed. **It never deletes**,
   unlike 040 — a schedule must equal what the plans say, where a batch log is
   a checklist somebody is working.
   **FILEMAKER'S 4,437 `TO DO` ROWS ARE NOT A DISEASE**, and a first reading of
   them as pre-generate-and-protect was wrong (Mark, 2026-08-09): an employee
   GENERATES the week and works the list down, so `to_do` is the default status
   of a generated checklist. Decision 6 is about a document defended against
   overwriting; nothing here is defended. Hence all five FMP statuses stay,
   `status` defaults to `to_do` on a generated row, and the freehand New batch
   dialog writes `complete` — you are recording something you just made.
   **ONE ROW OF `production_element_days` IS ONE BATCH**, not one element-day:
   Raised Dough on a Monday morning is four rows. Verified on the harness —
   generation wrote exactly 4 for that morning plus 1 elsewhere, ordered
   1 · 2 · 3 · Caramel (`sort` nulls last, 040's flavour-batch rule).
   **There is deliberately no `expandWeek()` in TypeScript.** Mirroring the SQL
   rule so a dialog could preview the week is 016's `nextDeliveryDate` trap, and
   here the rule decides what a kitchen is told to make. The receipt reports
   what happened instead.
   **(c) The two-week history** on the item record — a matrix, not a
   `DataTable` (one record's fourteen days, `/price-grid`'s call). It is
   **DENSE**: a day with no schedule and a scheduled day nobody counted are
   different sentences, and a list built from the rows that exist can say
   neither, because both are absences. **Two shops on one night are ONE day and
   their pars SUM** — proved on the real 2026-08-09 pair, which folds DF01's 36
   and DF02's 18 into a single row reading 54. The average **divides by nights
   COUNTED and says so**: over the window instead would turn five counted
   nights into a figure two-thirds too low that looks entirely plausible.
   Verified: all 44 migrations replay on the Docker harness, and every rule was
   checked by BREAKING it. As a real authenticated supervisor the RPC writes
   while a direct update changes **0 rows with NO error**, `par` is unreachable
   both ways, the whitelist RAISES, clearing both actuals clears the author,
   `next_batch_number` returns 30000 then 30001, an insert writes 1 row and a
   **delete changes 0 with no error**; staff get a raise from all four
   functions; `anon` gets "permission denied for function" from all five; a
   junk storage path is refused by the POLICY rather than a cast error; and
   040's own suite still carries actuals forward and still RAISES without
   `p_allow_actuals` — now over actuals a FUNCTION wrote. **769 fixtures pass**,
   38 new. `production_batches` did not exist and nothing referenced it, so
   nothing here changed under an existing reader.
   **044 APPLIED and the whole flow WALKED against the real DF01/DF02 data
   2026-08-09, then left exactly as found** — 0 counted lines, 0 author stamps,
   0 batches, 2 schedules, 64 lines, 0 storage objects. What that proved beyond
   the harness: the count went through **`rpc/set_schedule_actual`, confirmed in
   the browser's own network timeline with no PATCH on the table** (the one
   thing a screenshot cannot tell you); Sold went to **−4 unclamped**, yellow,
   with the carryover tooltip; regeneration kept the count AND `counted_by` /
   `counted_at`; the item history folded DF01's 36 and DF02's 18 into ONE night
   reading par 54; a week at DF01 generated **exactly 26 batches numbered from
   30000** — matching a count derived independently from `production_element_days`
   — with **zero of the 160 DONUT and 217 AB rows**; costing reported
   "at least $10.85" with 4 ingredients unpriced; and a re-run added 0 and named
   all 26.
   **THREE BUGS ONLY RENDERING COULD CATCH**, all fixed the same day:
   **(1) A grouped list sorted its bands by the LABEL string**, so a week read
   Mon 8/3 → Thu 8/6 → Tue 8/4. Bands now sort by the ISO date underneath and
   print the friendly form. `SchedulesList` had the same bug LATENT — invisible
   only because one night exists today — and moved with it. The fixture asserts
   the WRONG order too, so a "simplification" back to the label goes red.
   **(2) `BatchLogDetail` is a SERVER component and passed `alsoUpdate` — a
   function — to `InlineValue`**, which took the whole record down with
   "Functions cannot be passed directly to Client Components". TypeScript and
   lint both pass on it. The recipe-version cell is its own client component
   now (`BatchVersionCell`); the rest of `src/` was swept for the same shape and
   is clean. **Any `InlineValue` needing `alsoUpdate`, `onWrite`, `format` or
   `scale` must be rendered from a client component.**
   **(3) `ariaLabel` never reached a DATE cell** — forwarded to the `pick`
   branch on 2026-08-08 and the date branch was missed, so every date cell
   announced its raw column name ("batch_date") however carefully it was named.
   Residue, and it is honest rather than removable: DF02's 2026-08-09 schedule
   carries **`regeneration_count` 1** from the carry-forward test. That
   regeneration really happened; resetting it would make the record lie.
   Note the brief's numbering is off by THREE now — 038 was spent on the name
   constraint, 041 on the recipe sheet and 042 on the recipe cost column.
   **A HEAD COUNT PROBE CANNOT TELL "EMPTY" FROM "MISSING"** — probing 039 with
   `.select("*", { count: "exact", head: true })` returned `null` and NO error
   for a table that did not exist. A HEAD response has no body to carry the
   message, which is the same trap `load-events.mjs` already warns about for
   emptiness checks. Probe a table's existence with `.select("col").limit(1)`.
   The one-paragraph version: Recipe_Items merges into Production_Elements
   (made | purchased | manual, one component vocabulary for both BOM layers);
   Recipes stay separate and VERSIONED, element→recipe a real FK, never a
   name; a PLAN is a proposal (selling location + KITCHEN + date range,
   several concurrently active, union = the shop's menu) while a SCHEDULE is
   the committed day — records at ITEM grain only, generated by an explicit
   human act (ahead-of-time allowed), with the baker/fryer/decorator guides
   and element sheets as pure RENDERINGS; date-scoped par overrides replace
   FMP's pre-generate-and-protect dance; item actuals (made/leftover) land on
   schedule lines via the shift-report surface (joint with 4e's deferred batch
   screen), element actuals in batch logs; costs derive LIVE through
   purchasing (no stored recipe/item costs); prices are an org-level
   class×tier grid with sparse location overrides (measured: DF01/02/03
   byte-identical, only EVENT differs). **NO HISTORY MIGRATES** (Mark,
   2026-08-07: fresh plans and schedules) — the migration is catalog + config
   only, and **its inputs are COMPLETE**: the 7 config exports landed the
   same day (underscore-prefixed in `FMP Export/Production/`) and all nine FK
   joins against the 5 catalog exports resolve with zero orphans. Batch
   numbering seeds at 30,000 (FMP's sequence was at 19,541). The 376k
   rows of schedule-line actuals, the 29k tray day slots, and the
   plans/schedules/batch-log exports deliberately never load. The DDR in
   `DF Operations FMP Database Design/` is how to enumerate any FMP file's
   real tables (its census caught all of this). Ships vestigial:
   `locations.kitchen_by_weekday` / `shops_for` retire when kitchen-on-plan
   lands.
4g. 🚧 **Special Orders** — specced 2026-08-16; **phases 1–3, 4a AND THE
   PRODUCTION HALF OF 5 DONE; 4b, 4c and recurrence not built. Migrations
   051–058 AND 067–069 are applied and all three edge functions are
   deployed.** *Probe, don't read this line.*
   The module records, quotes, invoices, prints, emails as specialorders@, takes
   a customer's approval on a public page, takes inquiries on a public form,
   proposes the next step as things happen, and **puts the order's donuts on a
   real production schedule**. What remains is the inquiry form's
   own build-your-box picker (4b), the organic-email parser (4c) and the
   standing-order materializer (the rest of 5).

   **Shipped 2026-08-27 — DECISION 9, SCHEDULING PRODUCTION (migrations 067 +
   068, BOTH NEED APPLYING).** 040 shipped the entire seam and left it unused
   for three weeks: `production_schedules.source` already accepted
   `'special_order'` with `source_ref` and `title` beside it,
   `production_schedule_items.par_source` accepted it too, its `tray_number`
   comment named "every special-order line", 051 gave
   `special_orders.production_schedule_id` an FK **that nothing had ever read**,
   `unschedulableLines()` was written and exported with **zero callers**, and
   the generate dialog said in user-visible copy *"Nothing generates special
   orders yet."*
   **067 EXISTS BECAUSE `unique (schedule_id, item_id)` CANNOT HOLD, and that is
   a MEASUREMENT.** `production_items` has **ONE generic `Letter` subtype** — 56
   rows, one per FLAVOUR — and no per-character item, because the character is a
   property of the ORDER. So every letter of a customer's name resolves to the
   same production item: order **#7769** spells HAPPY BIRTHDAY VINNY in 18 lines
   that ALL point at `Rites of Sprinkles - Choc`, which under 040's key is one
   line reading "18 × Rites of Sprinkles - Letter" and a decorator who does not
   know which letters to cut. Not an edge case — **943 of the 3,133 orders
   carrying linked lines (30.1%)** have two lines sharing a production item, and
   **roughly three in four of those collisions are different letters** rather
   than duplicates. So the key is
   `(schedule_id, item_id, coalesce(subtype, ''))`, an EXPRESSION index because
   two NULLs are never equal in a plain unique index. Cheap when it landed: 17
   schedules, 546 lines, all `source = 'plan'`.
   **PLAN SCHEDULES ARE UNAFFECTED AND THAT IS PROVABLE**: `production_day`
   groups by `(kitchen, item_id)` and returns one row per item, each with one
   subtype, so there is never a second row to split from.
   **THE DELETE-STALE PREDICATE HAD TO MOVE WITH THE CONFLICT TARGET, and
   forgetting it is a silently DOUBLED PAR.** 040's replacement pass deletes a
   line only when the day no longer carries its `item_id`; with the key widened
   but that predicate left alone, renaming an item's subtype in the catalog and
   regenerating leaves the old line standing AND inserts a new one. **Measured
   by breaking it on the harness: 2 lines, 48 donuts where 24 is right.** Both
   `not exists` blocks — the delete and the `v_lost` actuals count above it —
   gain `coalesce(d.subtype,'') = coalesce(li.subtype,'')`, and they must keep
   saying the same thing or the guard and the delete disagree about what is
   about to be lost. The function is REPRODUCED IN FULL (055's rule); the
   reproduction was diffed against 040:821-1109 and is byte-identical but for
   those three lines.
   **068 IS THE `freeze_pay_period` SHAPE: TypeScript computes, SQL validates
   and commits.** Grouping means normalising the CUT, and the live data holds
   **93 letter-ish spellings** of forty-odd characters (`Letter - "A"` 1,170,
   `Letter "A"` 17, `Letter. "A"`, lowercase, a stray `Letter - U"`, one
   escape-mangled `Letter - ""Y""`). That logic already exists, fixture-tested,
   in `lib/specialOrderLines`; a PL/pgSQL twin is 016's `nextDeliveryDate` trap
   on a document a kitchen bakes from. `lib/specialOrderSchedule` groups on
   `(production_item_id, canonicalCut)` and SUMS — repeated letters within a
   word are one line ("HAPPY" is 2 for P) — which is exactly what Mark asked
   for. A **bare `Letter`** is its own group and is never folded into a
   character (935 real rows: letters ordered, the word not settled), and a
   non-letter cut is trimmed and otherwise untouched, because two spellings of
   `Promise Ring` are both somebody's deliberate typing.
   **THE PAYLOAD IS NOT TRUSTED.** Every item must be a production item in this
   org AND appear as the `production_item_id` of a line on THIS order — without
   the second half, a caller holding one order's id could schedule any item in
   the catalog against it. Plus `(item_id, subtype)` unique within the payload
   (checked before it can raise as a `unique_violation` naming an index) and
   every par positive.
   **BOTH FUNCTIONS ARE `security invoker`, WHICH IS 013's PRECEDENT VERBATIM.**
   `production_schedules` is purchaser+ on insert and delete (040) while this
   module is supervisor+ (051), so a definer would silently widen "who commits a
   kitchen's night" as a side effect of wanting atomicity. Verified on the
   harness as real roles: **a supervisor's schedule is refused by RLS by name, a
   supervisor's unschedule DELETES ZERO ROWS AND RETURNS NO ERROR** — which is
   why `unschedule_special_order` checks the row count and says so — and `anon`
   is refused both outright. Atomicity holds anyway: a function body is one
   transaction, so an order can never rest half-scheduled.
   **`order_scheduled_at` TAKES TODAY, NOT THE PRODUCTION DATE**, and `p_today`
   is a PARAMETER — `current_date` is UTC, so after 4pm Pacific it dates an act
   to a day that has not happened. Every stage date beside it records the day
   the ACT happened; the day production was scheduled FOR is on the schedule.
   Only when empty (SendDocument's rule).
   **BOTH SHOP COERCIONS ARE NAMED IN THE DIALOG** (040's "names every coercion
   in its receipt"): the schedule's two location columns are NOT NULL where the
   order's are both nullable (kitchen filled on 83%, pickup shop only on recent
   rows), so kitchen ?? pickup and pickup ?? kitchen, with a yellow mark saying
   which stood in. Verified on the real #7769, which has no pickup shop.
   **054's TRIGGER WATCHES NEITHER `production_schedule_id` NOR THE STAGE
   DATES**, so the biggest act in the module would have left no trace in its own
   history. Both functions write a `special_order_events` row — the
   `Duplicated from order N` case, a fact with no watched column behind it.
   Unscheduling says it discarded a document and NOT that it undid anybody's
   decision: a to-do or status the workflow offer moved stays where a human put
   it.
   **SCHEDULED IS A LOCK, NOT A SYNC** (Mark's call). The Items tab, the event
   date and the kitchen — the three things the schedule was BUILT from — go
   read-only until somebody unschedules, which deletes the schedule outright.
   Everything else stays editable, because none of it changes what gets made.
   Keeping a live schedule in step with a changing order is a standing
   obligation; delete-and-rebuild is a rule you can state in a sentence. It is a
   UI lock and does not pretend otherwise — the guard that matters is in the
   function.
   **UNSCHEDULE REFUSES ONCE PRINTED OR COUNTED**, which is the one place this
   module is stricter than `closeReadiness`'s name-it-and-let-you-through rule,
   and deliberately: both facts are about the WORLD rather than the record —
   paper is in a kitchen, or somebody stood at a bench and counted. The escape
   hatch is real and is not a hole: a purchaser deletes the schedule from
   `/schedules/[id]`, which clears the link through the FK, and that confirm is
   now source-aware because "generating the day again would rebuild it from the
   plans" is FALSE here.
   **DELETING THE ORDER IS REFUSED WHILE IT IS SCHEDULED**, because `source_ref`
   deliberately carries no FK (040: the table did not exist yet), so the delete
   would leave a kitchen holding a schedule with a dead backlink. Cancelling is
   allowed and NAMES the schedule — cancelling does not unschedule, so those
   donuts still get made.
   **DECISION 11: SELECTING A NIGHT'S PLAN SCHEDULE PULLS IN ITS SPECIAL
   ORDERS** (`companionScheduleIds`). The packet summed the schedules you had
   TICKED, so "the tray guides include special orders by construction" was only
   true if somebody remembered — and forgetting produced a guide that looked
   complete and was short by a wedding. ONE DIRECTION only: ticking a special
   order alone does not drag the plan in, because printing one order's sheet is
   a real thing to want. Two consequences that are easy to get backwards: the
   print stamp goes on the EXPANDED set (an unstamped special-order schedule
   would slip past the printed guard while the kitchen holds the paper), and the
   FILENAME comes from the SELECTION (one chosen night is still one night).
   PostgREST has no tuple `IN`, so it is two `.in()`s narrowed to exact pairs in
   JS.
   `DATE_IMPLIES.order_scheduled_at` is order-aware now — the sixth rung is
   compound (printed AND scheduled) and since scheduling became a command the
   order can arrive from either side, so it offers **Print Order** when the
   order has not been printed and Send Receipt when it has.
   Verified: all 69 migrations replay on the Docker harness and every rule was
   checked by BREAKING it. (The 12-line roll-up this originally shipped is gone
   — see the 069 block below; #7769 now transcribes to 20 lines.) The same order
   rendered through the real dialog against the LIVE database gives the same 12
   lines and 118 to make, and the commit refuses legibly ("migration 068 has not
   been applied") while writing nothing.
   **GENERATING A NIGHT OFFERS ITS SPECIAL ORDERS — decision 12's pull, built
   at last** (Mark, 2026-08-27: "initially we thought we would pull special
   orders into a production schedule from this end, instead of pushing them
   from the special order page? Is that still a possibility?" — he was right
   about the history). Production brief decision 12 says special orders "inject
   production the same way FMP's do" and "the generate dialog's 'ignore special
   orders' toggle survives" — that toggle exists because FileMaker's generation
   PULLED them in. Nine days later the special-orders brief's decision 9
   specified push-from-the-order, nobody reconciled the two, and the toggle sat
   **inert for three weeks**: `p_ignore_special_orders` was written to
   `ignored_special_orders` and read by nothing.
   **THE PULL RUNS IN THE CLIENT, AND THAT IS THE DESIGN RATHER THAN A
   SHORTCUT.** Folding it into `generate_production_schedules` needs a PL/pgSQL
   twin of `scheduleDraft` — the cut canonicalisation over 93 spellings, the
   note copy, the Misc filter — which is 016's `nextDeliveryDate` trap and the
   thing 069 argued against. So the dialog calls `schedule_special_order` once
   per ticked order: **push stays the only writer and this is a second DOOR onto
   it**, same function, same guards, same transcript. No migration, no
   duplicated rule. Each call is its own transaction, so one refusal leaves the
   rest done and is NAMED in the receipt (the commonest being somebody having
   scheduled it while the dialog was open).
   **"READY FOR PRODUCTION" IS `status = 'order'`, AND THAT IS A MEASUREMENT**
   (Mark: "only special orders that are 'ready for production' (whatever that
   ends up meaning) should be offered"). Of the eleven upcoming orders that day,
   the two he had scheduled BY HAND were both `order` and both paid; of the
   eight he had not, **six were still quotes** — four without even a returned
   quote — one was an unpaid invoice, and exactly one was a committed order. So
   the rung the module already calls "paid — printing and scheduling remain" is
   the rung he schedules at, and offering a quote asks a kitchen to make donuts
   nobody has agreed to buy. It is also `suggestedTodo`'s own sequencing.
   Worth noting because the first reading of that data was ALARMIST and wrong:
   "eight upcoming orders unscheduled" sounds like a hole and is mostly correct
   behaviour.
   **A FLAGGED order is offered UNTICKED with its flag as the reason** — 013's
   under-minimum vendor, "unchecked-but-checkable". Everything else is withheld
   and **COUNTED in a sentence** ("1 more not ready — still a Quote"), never
   silently absent: an order that simply does not appear is indistinguishable
   from one the query missed.
   **The match is on the KITCHEN, not the pickup shop** — the dialog picks shops
   that SELL, while the schedule is made at the kitchen, so generating DF01
   brings along the wedding DF01 bakes for DF02.
   **`loadCandidates` carries a SEQUENCE GUARD**, because changing the date and
   then the day count puts two queries in flight and whichever answers last
   wins regardless of which was asked last. It also refuses to swallow a query
   failure into an empty list — "none ready for production" is a CLAIM, and a
   failed query must not make it.
   The toggle now means what it always said: tick it and the plans generate
   alone. Verified live end to end and **left exactly as found** — #9618
   offered and ticked while its quote-stage neighbour was withheld, generated
   alongside two plan schedules, `order_scheduled_at` stamped **2026-08-27**
   (the org's day, where UTC was already the 28th), `todo` untouched, five lines
   each carrying its own note; then all of it deleted back to 19 events, 21
   schedules, 622 lines.

   **THE GENERATE RECEIPT'S "DONE" WAS A NO-OP** (Mark, 2026-08-27), and the
   cause is worth knowing because it can only ever happen this way round: it was
   a `<Link href="/schedules">` in a dialog that ONLY EVER RENDERS ON
   `/schedules`, so it pointed at the page it was already on — which Next
   correctly treats as nothing to do, leaving the panel up and the button
   reading as dead. There was never anything to navigate to: `run` refreshes the
   list the moment the receipt arrives, so finishing means putting the receipt
   away, and it is a button that closes.

   **THE FROM COLUMN NAMES THE PLAN** (Mark, 2026-08-27: "instead of 'Plan' can
   the from column say the name of the plan instead?"). "Plan" was true of every
   plan schedule and so distinguished none of them, where "SUMMER 2026 (DF01)"
   is the thing you would go and look at — and the record's own sentence now
   names it too, as a LINK to `/plans/[id]`.
   **IT IS DERIVED, NOT SNAPSHOTTED, and that is the thing to know before
   trusting it.** Nothing records which plans fed a generation, so
   `plansInForce` answers "which plans are in force for this shop, KITCHEN and
   day" — which is the claim the record screen has always made in words ("From
   the plans active that day"), now with the names in it. The cost: activating
   or retiring a plan changes what an OLD schedule says it came from.
   Snapshotting `plan_ids` at generation is the fix and it is a migration.
   **The kitchen is in the match, not just the shop**: a shop running two plans
   into two kitchens produces two schedules, each fed by one of them, and
   without that test the wrong plan's name lands on the row. A plan with a null
   kitchen falls back to its selling shop (039's nullable column, decision 9's
   reading). Dates compare as STRINGS — `new Date` is UTC midnight and moves a
   plan's first day west of Greenwich.
   **Several plans can be in force**, since decision 9 makes a shop's menu their
   union and their pars SUM, so the label holds two names and counts past that
   ("EVERYDAY + 2 more", the full list in the row's `title`). Measured
   2026-08-27: all 17 real plan schedules resolve to exactly one.
   `scheduleSourceLabel` is ONE function called by the column that renders it
   AND the search that has to find it; sorting moved onto the LABEL, since
   sorting by the raw `source` would group every plan schedule under an order
   the reader cannot see. Date gave up 30px to pay for From's 210.

   **THE RECORD'S COMMANDS MOVED UP INTO THE IDENTITY BLOCK** (Mark,
   2026-08-27, "like we do in the other detail views"), **Add item… with them**
   — so the row is Add item · Print · Recost · Regenerate · Delete, which reads
   build → produce → maintain → destroy. Add LEADS because it is the only one
   that changes what the kitchen MAKES; the rest act on the document as a whole.
   It rides in ScheduleActions as an `add` SLOT, `print`'s own idiom, which
   keeps the panel's query and state out of that component while letting the row
   decide the order. The Items heading is now a heading and nothing else.
   **That move exposed FOUR hand-typed near-copies of one button class** —
   `ScheduleActions`' local `COMMAND`, `AddScheduleItems`, `PrintPacket` and
   `ui/buttons`' own `BUTTON_CLASS` — which had already drifted (one had lost
   its `disabled:` state). Harmless while they sat on different rows; they now
   stand in ONE row where any drift is visible at a glance, so all three copies
   read `${BUTTON_CLASS} shrink-0`. Measured after: all five buttons 36px tall,
   1px border, 12px, 16px padding, tops on the same pixel as the h1. Print / Recost /
   Regenerate / Delete sat under the field grid, so on a long night they were a
   scroll away from the thing they act on. `items-start`, so they line up with
   the TOP of the title rather than centring against a block whose height
   changes with the source line and the special-order backlink; right-aligned
   beside it and left-aligned once they wrap under it. Measured: the h1's top
   and Print's top are the same pixel, and Delete, Add item and the table all
   end on 1217 — the page's own content edge. `ScheduleActions` lost the
   `ml-auto` on Delete, which in a content-sized cluster could only ever have
   been a no-op.

   **THE ALLERGEN CHIP ONLY SHOWS WHEN IT SAYS SOMETHING**, which the same
   session's backlink introduced and this fixes. Measured over the 835 real
   orders carrying `allergen_info`: **446 of them (53%) say some spelling of
   "no"** — "no" 242, "none" 132, "n/a" 44. A yellow mark reading "none" on
   half the orders is how the one reading PEANUTS stops being read.
   `meansNoAllergy` is a WHOLE-STRING match against a closed list and **fails
   safe**: "no nuts" contains "no" and means the opposite of it, so anything
   unrecognised is SHOWN. A new way of writing nothing costs one redundant
   chip; a new way of writing an allergy costs a great deal more.

   **THE SCHEDULE'S LINE TABLE LOST TWO COLUMNS AND GAINED TWO** (Mark,
   2026-08-27): Type - Size - Cut - Finish - Name - Par - Made - Left over -
   Sold - Note. **Tray** went because a special-order line never has one and a
   plan line's is already the band you can group by; **Planned** went with it —
   it was `planned_par`, what the plans said before an override or a hand edit,
   and its job was to let a row explain its own number. The header's "n lines
   differ from the plan" badge still counts them, so what is lost is the
   per-row figure, and restoring the column is a dozen lines. `sourceTitle`
   went too, being its only caller.
   **Cut is the column that had to exist**: with one generic `Letter`
   production item per flavour, twelve letter lines are twelve identical-looking
   rows without it — so it is wide (150) and is the one descriptor never dropped
   when the table goes compact. The Name cell stopped repeating
   `subtype · finish` underneath itself, both being columns now. Widths key
   bumped to `.v2`, or a stored order from before would outrank the new one.
   **Boxes went as well and was NOT in the removals Mark named** — his column
   list simply did not include it, and it is `filled × tally_box_size`, the
   printed tally strip restated on screen. One line to restore if that was an
   oversight.
   Measured at 1280: nothing clipped, no page overflow, and every letter cut
   fits the Cut column with room (`Letter - "<3"` is the widest at 87px in
   107px of space; only the inactive `Bullseye "<3" Center` would ellipsis). At
   1100 the compact tier sheds Size, Finish and Left over.

   **WALKED END TO END ON THE REAL #7769, 2026-08-27, AND LEFT AS FOUND**
   (17 schedules / 546 lines before and after, 27 events, the order byte-identical).
   Scheduled onto 2026-08-28 — a night DF01 already had a plan schedule for, so
   decision 11 could be tested — and what that proved beyond the harness:
   **`order_scheduled_at` STAYED 2023-07-14.** The real order already carried
   one, and the coalesce refused to move a date its 2023 paperwork was dated
   with. That is also the fact that makes the RESTORE step non-optional if
   anybody walks this again: **unscheduling CLEARS that column**, so on an order
   that had a real date, a test unschedule destroys it. Capture it first.
   **Both stamps landed on the right rows**: printing the DF01 plan schedule
   alone stamped `printed_at` on it AND on the special order, while the
   unselected DF02 plan schedule stayed null — which is the expanded-set
   stamping, and exactly what stops a printed special order slipping past the
   unschedule guard.
   **Both refusals fired by name** — first "was printed on 2026-08-28", then,
   after a real count entered through 044's definer on the schedule screen,
   "has counted quantities on 1 of 12 lines". Deleting the ORDER while scheduled
   was refused without even opening its confirm.
   The lock was checked for what it does NOT touch as well: no Add item, no row
   drag, no line remove — while the six column-RESIZE grips and "Remove this
   payment" stayed live, which is the rule (view controls and money are not
   what the schedule was built from).
   **One layout bug only the live walk found**: the refusal sentences are whole
   sentences, and as ordinary flex items in `OrderActions`' row one of them
   pushed Duplicate / Flag / Cancel / Delete off the side of the screen.
   `basis-full` puts it on its own line.
   **THE ROLL-UP IS GONE — MIGRATION 069, NEEDS APPLYING** (Mark, 2026-08-27,
   the same day, after seeing the first real one: "don't consolidate lines, even
   if they result in the same donut. Keep each line intact, and be sure to copy
   the notes column"). **ONE ORDER LINE IS ONE SCHEDULE LINE.**
   **The case that settled it was on #7769 all along**, and the walk surfaced it
   an hour after shipping the opposite: its two Mini lines are 50 with a note
   reading "chocolate glaze" and 50 reading "vanilla glaze" — same menu item,
   same cut, same size, and NOT the same thing to make. Rolled up they printed
   as one line of 100 and the decorator was never told half were chocolate.
   **No key over the taxonomy could have fixed that**, because the
   distinguishing fact is free text, which is the whole argument for
   transcribing rather than summarising: the order already says what to make, at
   the grain somebody typed it, and any grain imposed on top can only lose
   something.
   **069 MAKES THE KEY PARTIAL AND TAKES 067's COLUMN BACK OUT OF IT** —
   `unique (schedule_id, item_id) where par_source <> 'special_order'`. HAPPY
   has two P's, so a repeated (item, cut) is now the NORMAL case and no
   uniqueness can apply to these rows at all. 040's rule was always about
   REGENERATION (two rows of one item double the day's par and nothing notices),
   which is a fact about the generator and never about a special order — whose
   lines are written once from a validated payload and which the generator
   refuses to read. With special-order lines exempt, **subtype was doing nothing
   in the key**: `production_day` returns one row per item, so there was never a
   second row for it to separate.
   That also RETIRES 067's own hazard rather than patching it. With subtype in
   the key, renaming an item's subtype made the upsert miss its own row and a
   regeneration left the old line standing beside the new one — measured at 2
   lines and 48 donuts where 24 was right. 069's generator is **040's body byte
   for byte** but for the conflict target gaining
   `where par_source <> 'special_order'` (Postgres will not infer a PARTIAL
   index from a bare `on conflict`, and fails loudly rather than misbehaving if
   you forget). Verified on the harness: the rename case now gives 1 line and 24
   donuts with no special predicate at all.
   **The three line kinds separate cleanly, which is what makes the predicate
   safe**: the generator writes `plan`/`override`, `AddScheduleItems` writes
   `manual`, and only `schedule_special_order` writes `special_order`. Proved at
   the boundary — a second `manual` line of one item is still refused by the
   index, while a second `special_order` line is allowed.
   **`note` now travels** from `special_order_items.notes` onto
   `production_schedule_items.note`, where the schedule's own Note column
   already renders and edits it.
   **AND THE LINES KEEP THE ORDER'S OWN SEQUENCE, WHICH ON A LETTER ORDER IS THE
   WORD.** Sorting by name would turn HAPPY BIRTHDAY VINNY into
   A B D H H I I N N P P R T V Y Y Y — an anagram of the right donuts and
   useless to whoever lays them out. Fixture-pinned by asserting the letters
   join to `HAPPYBIRTHDAYVINNY`, and checked by breaking it (2 red).
   One consequence worth knowing: a credit line no longer cancels its sibling.
   Under the roll-up, +80 and −80 on one (item, cut) summed to zero and the
   whole thing vanished off the sheet; now the credit is dropped on its own and
   the 80 still get made.
   `canonicalCut` survives and its JOB CHANGED: it no longer decides what
   merges, only what the sheet SAYS, so three spellings of A are three lines
   spelled one way. Reverting to the raw cut is one line if that is ever wanted.
   Harness: 20 lines from #7769's 21, in order, the two Minis apart by their
   notes. **1,276 fixtures pass.**
   **Read `docs/special-orders-brief.md` before designing or touching anything
   here, and START AT ITS "Where a next session picks up" SECTION** — that is
   the handoff, and it carries the probes for everything this line claims, what
   4b and 4c each still need, and what test data is on the live database. Its
   CORRECTIONS block comes first: five measurements in the body are wrong,
   because the brief was designed from a `parseInt` reading of `OrderID`.
   **Shipped 2026-08-20/21, phase 4a — THE FRONT DOOR (migrations 057 + 058
   APPLIED, `submit-inquiry` DEPLOYED). *Probe, don't read this line.*** Decision 18: a public
   `/inquiry` form that creates a lead directly, replacing the Square web form
   whose entries a human retyped. Scoped to the form ALONE on Mark's call — the
   build-your-box picker (4b) and the paste-and-parse fallback (4c) are
   separate, because the Square form has no picker either and 4a already
   retires it.
   **THE RPC IS THE GATE AND THE FUNCTION IS THE DOOR**, which is
   `approve_quote_by_token` + `approve-quote` a second time and for the same
   reasons: the page posts once to `submit-inquiry`, which calls
   `create_inquiry` THROUGH THE ANON KEY — so the gate is the same SQL a direct
   caller hits, and the function can create nothing the page could not — and
   only then escalates to `service_role` to read the org's mail config and
   send. `create_inquiry` and `inquiry_shops` are the **third and fourth
   deliberate `anon` grants**, inverting 002's revoke rule in exactly the places
   the brief named.
   **IT NEVER RAISES, AND THAT IS A SECURITY PROPERTY.** 052's lesson: a
   function that errors on some inputs and answers quietly on others is a probe.
   Every refusal is a returned jsonb state. **And the answer is the SAME whether
   the email was already a customer, was new, or was throttled** — decision 18's
   central rule — which `inquiryStateMessage` carries into the UI by wording
   `received` and `created` identically. Broken on purpose in both places: in
   SQL the two answers diverge visibly, in TS a fixture goes red.
   **`create_inquiry` CANNOT CALL `next_special_order_number`** — 051 revokes it
   from `anon` by name and its body demands supervisor+, so it advances the
   sequence itself. Migration 014's footgun in a new costume, and the single
   easiest thing here to get wrong.
   **`lib/createSpecialOrder` COULD NOT BE THE THIRD DOOR**, which the brief's
   handoff had hoped: it takes the CALLER's client so RLS applies, and `anon`
   has no policy on the three tables. The lead's defaults are restated once in
   SQL and the duplication is argued in 057's header. 4c's staff-facing paste
   dialog still goes through it — that is the door the note meant.
   **`sendMail` RETURNS A PROVIDER ID, NOT AN RFC `Message-ID`** (`gmail 19f9…`
   is the message *resource* id), so storing it as decision 12's thread root
   produces something nothing will ever match **and the failure is silent**.
   `Mail` gained an optional **`messageId`** the caller generates, emits and
   stores; `newMessageId` takes the domain from the resolved sender. Rendered in
   Node against both providers: the header carries exactly our string, and with
   the field omitted **no header is emitted at all** — which is why redeploying
   the other three functions is hygiene rather than a requirement, even though
   `_shared` is compiled in at deploy.
   **AN ADDRESS IS NOT EVIDENCE OF DELIVERY** — measured over the three real
   Square submissions, two are PICKUPS carrying an address anyway and the third
   omits the field. Writing it to `delivery_address` unconditionally puts a
   customer's home address on a kitchen document for an order they collect
   themselves; checked by breaking it. All three samples are pickups, so **there
   is no delivery sample** for 4c's parser.
   Also: `customers.source` had no `'inquiry'` value where `special_orders.source`
   did (051 wrote the two checks differently), widened in 057;
   `locations.public_name` is nullable and falls back to `name`, because ours are
   internal ("Donut Friend 01 Highland Park") where Square's form said "Highland
   Park"; abuse is a honeypot decided IN THE GATE plus per-email and global
   hourly caps **counted off `special_orders` itself** (one partial index, no new
   table, no sweeper — the IP is recorded in `source_payload` as evidence, never
   as a key). The org comes from **`NEXT_PUBLIC_ORG_ID`**, a per-deployment
   constant exactly as `NEXT_PUBLIC_APP_URL` is, read on the SERVER so a missing
   value is a sentence rather than a form that fails on submit.
   **The page follows `/q/{token}`, NOT the parts table** — raw inputs, `h-12`,
   `text-[16px]` (the threshold below which iOS Safari zooms on focus). Its two
   `<select>`s are deliberate and noted in the file: that convention is about the
   DESK, and on a phone the platform's wheel picker beats a portalled panel. The
   DATE and TIME go the other way, to `ui/DateField` / `ui/TimeField` with a new
   **`variant="field"`** (`PickList`'s own prop name for the same dense-cell-vs-
   form-box problem), because those carry the fix for Safari painting TODAY into
   an empty date input — on a form whose date starts empty that means somebody
   submitting no date while believing they asked for today. **The rule is not
   "always ours" or "always native": a control carrying a hard-won bug fix is
   never re-implemented.**
   **WALKED END TO END 2026-08-21 against the live database**, through the real
   form. The lead is **#10013**: tax 0.09750 snapshotted from DF01,
   `date_initiated` the org's own day, `created_by` null, and
   **`delivery_address` null on a pickup that supplied an address** — the
   measured rule holding on real data. **The customer MATCHED rather than
   duplicating** (`trombino@mac.com` was already a FileMaker customer), and the
   answer was byte-identical to a create, which is the privacy rule proved on
   real rows. The confirmation sent and **`inbound_message_id` holds the exact
   Message-ID we generated**; a quote emailed afterwards stamped
   `quote_sent_at`, filed its PDF, minted a token, and **left
   `inbound_message_id` unchanged**, so it went out `In-Reply-To` the
   confirmation. The one leg no probe can settle is what the mailbox does with
   it.
   **Four tweaks the same day, all Mark's, after using it:**
   **(a) A NEW INQUIRY ARRIVES FLAGGED** (migration **058**, APPLIED) —
   `flag_reason = 'New Inquiry'`, because a lead that joins 8,330 others as an
   ordinary row is not "easily noticed" and `flag_reason` is what this module
   already has for "look at this one". **The to-do deliberately stays "Respond
   to Email/Call"** rather than the flag path's "Resolve Issue": the flag says
   LOOK AT THIS, the to-do says WHAT TO DO, and "Resolve Issue" describes
   nothing on a lead nobody has read. Known consequence and the intended arc —
   resolving clears both, and `suggestedTodo` then returns "Send Quote", which
   is the actual next step. **It is a separate migration rather than an edit to
   057** (055's rule: 057 is applied, and a file that no longer describes what
   was run is how the harness and production stop being the same database), so
   the function is reproduced in full and changed in exactly two places. The
   argument list is COPIED, not retyped — a changed one would create an
   OVERLOAD and leave 057's version live beside it, which is 033's
   `freeze_pay_period` lesson; the harness asserts `pg_proc` holds ONE row and
   that the grants survived `create or replace`.
   **(b) "Resolve the issue" IS BLACK WHILE FLAGGED** —
   **`PRIMARY_BUTTON_CLASS`**, a shared class rather than an inlined string
   (that file's own history: the red exception was shared while the rule it
   excepts was retyped, and three commands came out three heights). It is
   `DIALOG_COMMIT_CLASS`'s argument applied outside a dialog rather than a
   breach of the black-fill rule: a flagged record is in an abnormal state with
   exactly ONE way out, so this is a commit standing beside no peers. **Only
   ever right CONDITIONALLY** — unflagged, the same slot holds "Flag an issue",
   an ordinary command, and it stays white.
   **(c) THE NOTE FIELDS WEAR BOUNDING BOXES** — `InlineValue`'s new `boxed`,
   which swaps the dotted underline for a border and a `min-h`. The underline
   is the quietest possible "editable" and that is right for a value in a dense
   `dl`, where the LABEL beside it already bounds the field; a column of five
   multiline notes has no such structure, an empty one is a single blank line,
   and a dotted rule under a wrapped paragraph marks only its LAST line — so
   five notes read as five headings with loose text under them. **The SIZER
   wears it too**, or the field jumps the moment you click in, which is the
   same reason the underline was on the sizer in the first place; and the
   read-only branch keeps the box, or the tab looks broken for anyone below
   purchaser+.
   **(d) The interest vocabulary lost "Donut Cake" and "Vegan / Gluten-free".**
   **Shipped 2026-08-21 — THE SETTINGS ARE REACHABLE AT LAST** (Mark: "the
   display names for the shops should be editable on the locations detail page.
   Same with all the email stuff for special orders like what the confirmation
   email says. The user needs a way to set these things"). Design rule 2 had
   always said the business's own words live in `orgs.settings` and never in
   code, and every key did — but the only way to change one was a hand-written
   UPDATE in the SQL editor. **A settings key nobody can reach is a literal with
   extra steps**, which is the rule being honoured rather than merely stated.
   **`/settings` is a real screen now**, replacing the placeholder that had said
   since the skeleton "this is the slot for the screen that will edit them
   properly". It edits `orgs.settings` through `InlineValue`'s `jsonColumn` /
   `jsonPath` — the `locations.address` idiom — in five blocks: the six email
   templates, what the inquiry form says, what the documents say (terms,
   invoice footer, `document_phone`), the timing numbers (rush terms, attention
   thresholds, horizon, inquiry caps), and a READ-ONLY statement of the mailbox.
   **EMPTY MEANS "USE THE DEFAULT", which is why each box's PLACEHOLDER IS the
   default** — `setJsonPath` DELETES the key when a cell is cleared, so clearing
   a template restores the built-in wording rather than sending an empty subject
   line, and the placeholder is also how somebody reads what a message currently
   says before deciding to replace it.
   **THE MAILBOX IS STATED, NEVER OFFERED.** `email_provider` is plumbing: its
   `secret_ref` names an edge secret holding an OAuth refresh token, and its
   `from` must be an address that credential may send as. **Gmail does not
   refuse a `From` it is not authorised for — it silently REWRITES it** — so an
   editable field here would not fail on a typo, it would quietly start signing
   the shop's quotes as somebody else. The block says what is in force and
   points at `docs/po-email-setup.md`.
   **Owner/admin only**, because 001's `org_update` names that pair; below it
   the screen renders READ-ONLY rather than offering a write RLS would accept,
   change zero rows and return no error. Every value is still SHOWN — knowing
   what the shop's quote says is not manager-only, changing it is.
   **THE CONFIRMATION TEMPLATE MOVED TO `special_orders.email.inquiry`**, beside
   the other five, from a key of its own (`inquiry_email`). One editor should
   cover every message the module sends, and a special case is a message
   somebody has to be told about separately. Its default is now MIRRORED in
   `DEFAULT_TEMPLATES` so the screen can show it — the Deno function still holds
   the copy that is actually sent, the same `web/`-boundary duplication
   `send-special-order-email` makes for `STAGE_COLUMN`, flagged at both ends.
   **`submit-inquiry` was REDEPLOYED for the new key** (v2, 2026-08-21) — v1
   looked for the old one, which nobody ever set, so both paths fell back to the
   same built-in text and nothing broke in between.
   **`locations.public_name` is editable on the location record**, in the
   identity `dl` between Code and Kind, with the location's own `name` as the
   PLACEHOLDER — so the cell always says what a customer would see right now,
   whether or not anybody has set it. Mark filled DF01 and DF02 the same day
   ("Highland Park", "DTLA"), and the inquiry form's shop list reads them.
   Verified against the live database and **left byte-identical**: a template
   written through the screen landed at exactly
   `special_orders.email.inquiry.subject`, creating both intermediate objects,
   with **zero drift** in payroll, po_email, billing, timezone or
   email_provider — which is the thing to check whenever a cell writes a whole
   jsonb document, since `setJsonPath` is a read-modify-write over all of it.
   **All 57 migrations replay on the Docker harness and every rule was checked
   by BREAKING it** (see 057's own tail block): as a real `anon`, nine different
   malformed submissions all return states and none raises; the real Victoria Fay
   submission lands as a lead with the tax snapshotted and two log rows; a known
   and an unknown email answer identically; the caps stop the fourth submission;
   three punctuations of one phone number are one customer; an inactive, virtual
   or foreign shop is dropped rather than refused; and with 14 orders really
   present `anon` sees 0, a direct insert is refused by RLS, and
   `next_special_order_number` is permission-denied. **1068 fixtures pass**, 28
   new.
   **Migration 052 is APPLIED and all three edge functions are DEPLOYED**
   (Mark applied 052, 2026-08-17; the deploy was verified the same day).
   *Probe, don't read this line.* For 052:
   `select column_name from information_schema.columns where table_name =
   'special_order_quote_tokens' and column_name = 'document_snapshot'` (1 row),
   and `select public.quote_by_token('nope-nope-nope-nope1')`, which must
   answer `{"state": "unknown"}` rather than raising.
   For the functions, POST an EMPTY body with the anon key — each refuses by
   name from its first statement, which proves the code ran AND that the
   `_shared/email.ts` import resolved:
   `send-special-order-email` → 400 "missing order_id, kind, to, subject,
   pdf_base64 or filename"; `approve-quote` → 400 "missing token or name";
   `send-po-email` → 400 "missing po_id, …".
   Verified deeper the same day: `approve-quote` with a bogus token returns
   **`{"state":"unknown"}`** and with an empty name **`{"state":"name_required"}`**
   — so the gate really is the SQL, reached through the anon key, live; and
   `send-special-order-email` answers **401 "not signed in"** to an anon
   caller and names an unknown document kind at 400.
   **THE specialorders@ CREDENTIAL IS SET UP** (Mark, 2026-08-19, Path A of
   `docs/po-email-setup.md` — its own OAuth refresh token, secret
   `EMAIL_CREDS_SPECIALORDERS`, `orgs.settings.special_orders.email_provider`
   pointing at it). Probe with
   `select settings->'special_orders'->'email_provider' from orgs` — expect
   `kind: gmail`, `secret_ref: SPECIALORDERS`, and a `from` naming
   specialorders@.
   **`special_orders.reply_to` and `document_phone` are deliberately UNSET.**
   The masthead falls back to `email_provider.reply_to` for the address (so a
   configured mailbox names itself — see the 2026-08-18 fix), and to
   `billing.phone` for the number. That means the documents print
   `(213) 908-2743` where FileMaker's print `213 995 6191`. Setting
   `document_phone` is a one-line SQL in the setup doc and Mark has not asked
   for it; do not "fix" it unprompted.
   **`NEXT_PUBLIC_APP_URL` is what the approval link is built on**
   (`https://restaurantfriend.vercel.app`, in `web/.env.local` and in Vercel).
   Without it a quote composed on a dev server carries a `localhost` link that
   works for nobody — the compose card refuses to open rather than let that
   happen, and the send re-checks the link's origin against the `APP_URL`
   secret. **Next inlines it at BUILD time, so a new value needs a dev-server
   restart and a redeploy**, not just a page reload.
   **Migration 051 is APPLIED and LOADED (Mark, 2026-08-17)** — 5,874
   customers · 8,330 orders · 47,827 lines · 6,457 payments · 106,471 log
   entries. *Probe, don't read this line.* Sanity: `select count(*) from
   special_orders` (8,330), `… where standing_order_id is not null` (**0** —
   the migration materializes nothing, decision 13), and `select
   settings->'special_orders'->>'horizon_days' from orgs` (14).
   **VERIFIED IN THE BROWSER against the real data the same day**, which is
   where four bugs were found that typecheck, lint and 943 fixtures all
   passed: see (g). The headline result is that **order 9885 derives
   $147.40 / $14.37 / $161.77 — matching FileMaker's own sent quote PDF to the
   cent**, with no stored total anywhere. That is decision 6 proved against a
   document a customer received.
   It was also HARNESS-VERIFIED before it was applied: all 51 migrations apply on the Docker stub; as real
   authenticated roles a supervisor reads 8,330 orders / 47,827 lines / 6,457
   payments / 5,874 customers while **a staffer reads 0 of each and an UPDATE
   changes 0 rows with NO error**; `anon` cannot execute
   `next_special_order_number` and a staffer is refused by name from inside it;
   the storage policies pass 018's own three tests. Every constraint was checked
   by breaking it, including that **a CANCELLED wholesale day still blocks
   re-creation**. **The whole real export was then replayed through the real
   constraints, and that is what found the one real bug** — see (f) below.
   Also shipped: the
   transform/load pair, `lib/specialOrders.ts` + 56 fixtures, `/special-orders`
   + its record, and `/customers` + its record. See the brief's build-phase list
   for exactly what each contains.
   **THE FIVE THINGS TO KNOW BEFORE TOUCHING ANY OF IT:**
   **(a) `special_orders.number` IS TEXT.** `2899-01`, `3932 cont.`, `5689a`,
   `5542b`, `7220a` are real FileMaker order numbers a human suffixed to split a
   job; an integer column rounds every one into a collision with its unsuffixed
   sibling. Over the raw strings exactly ONE number repeats — `6002`, twice, and
   they are DIFFERENT ORDERS — so both migrate and `legacy_seq` records the
   collision (028's `source_row_key` lesson, on the one row that needs it).
   **(b) THE MONEY HAS NO COLUMN AND MUST NEVER GET ONE.** There is no subtotal,
   tax, total or balance on `special_orders`; `orderTotals` derives all of them
   from the lines, the payments and six stored INPUTS on every read. FileMaker
   stored them TWICE, by era (`Order_Subtotal` and `Order_Subtotal2`), which is
   how they drifted — and yet **only 50 of its 8,330 orders now fail to
   reproduce their own stored subtotal from their own lines**, which is the
   measurement that says the model is right. Two arithmetic decisions inside it
   a rewrite could plausibly flip, both fixture-pinned: **the discount comes off
   BEFORE tax, proportionally across the taxable and non-taxable parts** (taxing
   the undiscounted amount charges sales tax on money nobody paid), and
   **delivery and rush are NOT taxed** (the real 9885 invoice computes tax on
   the item subtotal alone). The immutable copy of a quote is the PDF that was
   sent, filed as an attachment — decision 17's whole mechanism.
   **(c) `status` IS NULL EXACTLY WHEN `kind` IS NOT `order`** — the brief's
   open question 2, answered as a BICONDITIONAL check rather than a default. So
   "does this record have a status" and "is this record an order" are the SAME
   question and the app cannot get two answers. A template with status `lead`
   would be a claim about a workflow it is not in, and every list filter would
   have to know to ignore it. Consequence: the record screen shows the status
   picker only for `kind = 'order'` — offering it otherwise offers a write a
   CHECK refuses, which is the one refusal `InlineValue` cannot explain.
   **(d) A `Misc*` LINE IS MONEY, NOT PRODUCTION, and an UNTYPED line is
   PRODUCTION.** `isProductionLine` is prefix-insensitive (the data holds `Misc`
   495 times and `Misc- Cupcake liners` once) and the fallback direction is
   load-bearing: 569 real lines carry no type, they are ordinary donuts, and
   treating an unclassified line as money would silently drop it off the kitchen
   sheet. `unschedulableLines` names decision 9's blockers — a production line
   with no `production_item_id` — because `production_schedule_items.item_id` is
   NOT NULL and must stay so.
   **(e) `menuItemKey_n` IS A PRODUCTION ITEM ID, checked rather than assumed.**
   The brief expected FMP's retired MenuItems catalog; instead 20,518 of 20,561
   keyed lines resolve, and over those the line's donut name agrees with the
   item's on 19,482 while the SIZE agrees on 19,497 of 19,520. The 1,015
   name disagreements are the feature working — "DIY", "Custom", and a product
   renamed from "(x9)" to "(x12)" — which is decision 5's customized copy. So
   **twelve years of history carries `production_item_id` and is schedulable**,
   which decision 9 assumed only new lines would be.
   Two smaller things worth not rediscovering: **`Notes_Invoice` is boilerplate**
   ("We appreciate your business!" on 8,052 of 8,060 rows) and lives in
   `orgs.settings.special_orders.invoice_footer`, not on eight thousand orders;
   and **`todo` is empty on 8,233 of 8,334 rows** and its real values include
   "OH HOLD" and "No need to print *page 2*", so decision 4's `allowNew` is
   load-bearing and this column must never become a check constraint.
   **(f) THERE IS NO `check (qty >= 0)` ON A LINE, and putting one back breaks
   the load.** It was there, and replaying the real export on the harness failed
   partway through 47,827 inserts: three lines carry a NEGATIVE quantity and
   they name themselves — `short s'morrisseys` (-80), `short (dropped bin)`
   (-30), `short donuts (quality issues)` (-26). That is how this shop credits a
   customer for what it failed to deliver, and two of the three are recent. It
   was also incoherent with the column beside it, since `unit_price` has no
   check and six real lines use a negative one ("Tasting Discount",
   "Wedding Sampler Discount", -$248.50) — the same idea expressible one way and
   refused the other. 024's lesson, found the same way: a statement true about
   finished data is still wrong as a constraint.
   **(g) FOUR BUGS THAT ONLY RENDERING FOUND**, all fixed, and each one a
   class worth knowing:
   · **A controlled `DataTable` IGNORES `defaultSort`** (`sort = controlled ?
   controlledSort ?? null : …`), and a null controlled sort renders rows as
   given — so the work queue opened on the server's `event_date DESC` with
   December at the top and TODAY at the bottom. A list that owns its sort needs
   a `NATURAL_SORT` it passes down; the `sort` STATE stays null so the URL
   keeps one canonical address.
   · **A `FilterMenus` dimension with a `defaultValue` needs a real token for
   "no filter"** — `lib/filterMenus` says so and `/recipes` writes `?tier=all`.
   Without it "All orders" wrote no parameter, so a round trip silently put you
   back on Upcoming. Known cost: the menu now shows two entries reading "All
   orders", the bar's own and the real token.
   · **A `time` column reads back as `10:00:00`**, and the list formatted it
   while the record didn't. `format` is a FUNCTION, so a server component
   cannot pass it — hence `specialOrders/TimeCell`, a client cell.
   · **The customer record counted STANDING ORDERS as unpaid.** A recurrence
   carries lines and no payments, so it always derives a balance: the record
   claimed Cafe Knotted owed $1,738.50 while the list, which does check
   `kind`, said nothing was owed. Two screens disagreeing about one customer's
   money is the tell.
   And a measuring trap: **check the label SPAN, not the button around it** —
   a button sizes to its own content and can never report an overflow, which is
   how two clipped column headers survived a check that said everything fit.
   **PHASE 3 IS DONE — the documents, the email and the public approval page,
   LIVE AND WALKED END TO END** (2026-08-19/20). 052 applied, all three
   functions deployed, the specialorders@ credential set up, and the whole loop
   exercised against real customers by Mark. Nothing here is outstanding.
   Five documents from three renderers
   (`components/specialOrders/pdf/SpecialOrderPdfs.tsx`): quote · invoice ·
   receipt are ONE layout at three moments, the kitchen order is its own
   (no money at all, grouped by SIZE CLASS, the customized name over the full
   taxonomy), and the statement is decision 21's. `SignedQuotePdf` is an
   ADAPTER over the first, not a fourth renderer — the artifact a customer
   signed has to BE the paper they read.
   **VERIFIED BY RENDERING against FileMaker's own four PDFs for order 9885**,
   in Node over the live rows (the recipe-sheet pattern, which the brief made
   this phase's acceptance test). The money reproduces to the cent — $147.40 /
   $14.37 / $161.77 — and the render found FOUR bugs a code review would not
   have:
   the transform was **eating the letter-cake notes** (`text()` stripped a
   wrapping pair of quotes, written for `"DeliverLA"`; the note on a letter
   order IS `"W"`) — fixed, and `migration/backfill-special-order-notes.mjs`
   HAS RUN, restoring **4,617 line notes and 384 orders**, idempotent;
   the masthead **printed the date twice**, because Mark's titles routinely end
   with it, which is why FileMaker prints the title alone there;
   **@react-pdf hyphenates by default**, breaking a customer's address into
   `alexlan-dayan@gmail.com` (a no-op callback is registered at module scope —
   it is GLOBAL to the renderer, so per-document would be a second place to
   forget); and a **`fixed` table header repeats onto a page holding only the
   totals**, so the financial documents' header is not fixed while the kitchen
   sheet's is.
   Two departures from the reference, both deliberate: the quote's terms and
   signature print AFTER the totals rather than at the foot of page one
   (nobody signs a figure they have not reached), and the reference invoice's
   **TOTAL DUE $0.00 on an unpaid $161.77 quote is wrong** — that is the
   stored-total drift decision 6 exists to end, and ours derives $161.77.
   **THE PROVIDER LAYER MOVED TO `supabase/functions/_shared/email.ts`**, which
   is the change most likely to bite: `_shared` is compiled into each function
   at DEPLOY time, so **`send-po-email` must be redeployed too** or it keeps
   running the old copy (harmless, but it never gets the threading headers).
   `send-special-order-email` sends **as specialorders@** — decision 12, and
   the reason it needs its own credential is that **Gmail does not refuse a
   `From` it is not authorized for, it silently REWRITES it**, so the send
   looks like it worked and the reply goes to info@. Resolution is
   org-module → org → app default with **no location tier**: a PO belongs to a
   shop, a customer's quote is the org's letter.
   The send does FOUR bookkeeping writes after the mail is out — stage date,
   log entry, a filed copy of what was sent, and binding decision 17's token —
   and **none of them may turn a sent email into a failure**; they come back as
   warnings on a 200, or somebody sends the quote twice.
   **DECISION 17'S TOKEN IS MINTED WHEN THE COMPOSE CARD OPENS, WITHOUT A
   SNAPSHOT**, so the link in the draft body is a real URL the human can read
   and edit — and a compose that is CANCELLED leaves a token that shows
   nothing, because `quote_by_token` reads a snapshot-less row as `unknown`.
   The snapshot is written BEFORE the send, not after: a live link nobody has
   been given is harmless, where a link the customer HAS that says the quote
   does not exist is not.
   **Migration 052 adds `document_snapshot` and the two anon RPCs.** The
   snapshot is a COLUMN because money is derived live, so the order can change
   after a quote goes out — and because a definer function cannot mint a
   signed URL for the PDF in the private bucket. What makes the public route
   sound is not the entropy, it is what the token can REACH: `quote_by_token`
   reads ONE row of ONE table and touches neither `special_orders` nor
   `customers`; `approve_quote_by_token` writes the approval, one date and one
   log row. Both are granted to `anon` DELIBERATELY, inverting 002's revoke
   rule in exactly two places. Neither ever RAISES on a bad token — an error
   where an empty answer belongs is how you let somebody probe which tokens
   exist.
   `/q/{token}` is exempt in `proxy.ts` (verified signed out: 200, where
   `/special-orders` 307s to /login). **Reading is safe and APPROVING is the
   act** — the opposite of `/welcome`, whose token is spent by verification and
   must therefore never be touched on load. The signed PDF is rendered in the
   CUSTOMER's browser and posted to `approve-quote`, which is the only place it
   can be: @react-pdf needs a DOM and the customer cannot write to a private
   bucket. A render failure does NOT block the approval.
   `approve-quote` is the one function here with no signed-in caller. Its gate
   is the RPC, called with the ANON key so the check lives in SQL and it can
   approve nothing the page could not; only then does it use `service_role`,
   and every write is scoped to an `order_id` that came back FROM the check
   rather than from the request body.
   The compose card is a PICKER PLUS TWO VERBS (Document ▾ · Preview ·
   Download · Email…), not FileMaker's nine cells — the question is "which
   document", then "look at it" or "send it".
   Also shipped: the **attachments card** (decision 14 — pics and documents
   merged, `signed_quote`/`picture`/`document` pickable while
   `quote_document`/`invoice_document` are only ever produced by the app, so
   nobody can file a document as having been sent when it wasn't), which
   OFFERS the `quote_returned` stamp rather than forcing it; and the
   **statement** (decision 21) on the customer record, defaulting to LAST WEEK
   Monday–Sunday — "last week", not "the last seven days", because two
   consecutive statements must neither overlap nor leave a day out.
   **967 fixtures pass**, 24 new, each rule checked by breaking it — and the
   break-check earned its keep: `usDate` written through `new Date()` really
   does print **8/15** for 8/16 west of Greenwich, which on a quote is
   somebody's wedding on the wrong day.

   **(j) THE CREATE PATH HAD THREE HOLES, and the one that surfaced was the
   one a second COLLEAGUE opened** (Mark, 2026-08-18). `NewSpecialOrder`
   resolved the org with `from("org_members").select("org_id").maybeSingle()`
   and NO filter — but 001's `members_read` policy shows you every member of
   your org, so that returns one row per member. Correct with one member,
   "JSON object requested, multiple (or no) rows returned" with three. **A
   create that only ever ran while the org had one person is a create nobody
   has tested**, which is design rule 1's lesson in a second costume. Swept:
   this was the only unfiltered `.maybeSingle()` on that table; every other
   caller either filters by `user_id` or wants the whole list.
   Fixing it surfaced two more, both invisible until then because the crash
   came first:
   **the pickup shop was never asked for** — the form offered only the KITCHEN,
   so decision 8's other half was null and the quote printed no LOCATION while
   the Items tab priced at the org grid rather than the selling shop;
   and **`tax_rate` was never written by anything**. 051 calls it "snapshotted
   from the pickup shop, editable" and every reference in `web/src` was a
   SELECT, so an order created in the app derived ZERO TAX on a document a
   customer pays from. Measured before fixing: **0 app-created orders exist**,
   so nothing was corrupted — the crash had been preventing the very rows that
   would have carried the bug.
   All three are fixed in ONE place, `lib/createSpecialOrder.ts`, because there
   are TWO doors — the list's New special order and the customer record's New
   order for them — and each had a different subset of the truth, which is how
   this survived. **Pickup defaults to the shop you are standing in and the
   kitchen deliberately does not**: an order taken at DF01 is usually collected
   there, while which kitchen bakes it is decided later. The tax rate comes
   from the PICKUP shop because sales tax is charged where the goods change
   hands, and a null rate stays NULL rather than being defaulted to a number
   invented in code — the record's own Tax rate cell is right there.

   **WALKED ON REAL DATA, 2026-08-19/20, and the residue is the proof.** Order
   **#9877** carries three quote tokens and the whole of decision 17's design
   showing through:
   · **two sends succeeded** and the log names both by provider id
     ("Quote emailed to trombino@mac.com · gmail 1a01…"), each filing its own
     `quote_document`;
   · **the earlier tokens are SUPERSEDED** and only the newest was approvable —
     which is the rule that stops a customer signing a price you have revised;
   · **the approval came through the public page**: `approved_name`
     "mark trombino", `quote_returned_at` stamped by the RPC, and a
     `signed_quote` PDF filed — rendered in the CUSTOMER's browser and uploaded
     by `approve-quote`, which is the one path that cannot be tested any other
     way.
   · **And the FIRST token has a snapshot but no PDF and no log entry** — that
     is the failed send from the credential bug, behaving exactly as designed:
     the snapshot is written BEFORE the send, so a send that throws leaves a
     live link NOBODY HAS BEEN GIVEN (no email went out), and the next send
     superseded it. If that ordering is ever "tidied up" to write the snapshot
     after the send, the same failure instead leaves a link the customer HOLDS
     saying the quote does not exist.
   **Deliberately left in place**: those 4 tokens, 3 attachments and order
   #9877's stage dates are Mark's real test and the evidence above. The only
   app-created order is **#10000** ("test order"). Everything Claude created
   while verifying was deleted.

   **(n) THE ORDER STARTS KNOWING FOUR THINGS IT USED TO HAVE TO BE TOLD, and
   the ITEM stopped being read-only** (Mark, 2026-08-19, four notes in one).
   **A CUSTOMER'S DETAILS BECOME THE ORDER'S DAY-OF CONTACT.** They are two
   different facts — `customers` is who the order BELONGS TO, `contact_*` is
   who to ring on the day, which on a corporate order is whoever is running the
   party and is why (m) stopped asking for it — and they are the same fact nine
   times out of ten. Seeded once in `createSpecialOrder`, per FIELD ("if it
   exists"), never slaved: editing the customer next month must not rewrite who
   to call about an order already quoted. Both doors get it because the read
   lives in the shared creator, which is what that module exists for — the
   customer record has the row on screen and the list's picker has only a
   label. `contactNameFor` leads with the PERSON where `customerLabel` leads
   with the company: "Cafe Knotted (Jane Doe)" is not somebody you ask for on
   the phone. **`date_initiated` IS WRITTEN AT LAST** — the date the quote's
   signature band prints and the head of the completion dates, and nothing had
   ever set it, so every app-made order carried a blank where all 8,330
   migrated ones carry FileMaker's `Date_Created`. It takes the ORG's calendar
   day (`lib/today`, passed in — both callers already held it), and the live
   test proves why: a real create at 04:16 UTC wrote **2026-08-19** while
   `created_at` says 2026-08-20, so a browser clock or a UTC host would have
   dated it tomorrow.
   **THE ADD-ITEM PANEL'S `Done` IS BLACK** ("a real black button") — the
   panel-commit exception rather than a breach of it, the receiving screen's
   `Complete` argument: the chooser produces ONE outcome and Done is the only
   way out of it, so it is a commit standing beside no peers. It had been an
   underlined phrase, which gave the control that closes the thing less weight
   than the Add button on every row.
   **THE FIVE TAXONOMY FIELDS ARE EDITABLE** ("We need to be able to edit the
   fields of an item after it has been added"). Donut · type · cut · finish ·
   size were plain text, so the fields that decide what the KITCHEN DOCUMENT
   says were the only ones on the row nobody could correct — and they are the
   likeliest to need it, arriving as a snapshot of a menu item that is only
   approximately the thing being ordered. Same line, same `·` separators, each
   a `PickList` over the live menu's own distinct values with `allowNew`.
   **THE LETTER IS THE CUT** ("If the item is a letter donut, the app should
   allow the user to select the cut that represents the actual letter"), and
   that is a measurement: FileMaker put the character IN the cut, so of the
   9,926 migrated letter lines 8,991 read `Letter - "A"` — the canonical
   spelling `letterCut` writes, against `Letter "A"` and `Letter. "A"`, which
   `cutLetter` reads but never writes. So an option's VALUE is the composed cut
   and choosing the letter IS choosing the cut; nothing is composed at write
   time. The character set is the real one — all 26 letters, all 10 digits, and
   `<3` (277 lines), `!` (160), `+`, `&`, `?`, `-`; rarer ones (`OP`, `AB`, one
   line each) are why `allowNew` stays. **The letter group appears ONLY on a
   letter line**, where it LEADS (it is what you opened the list for) and the
   letter-family subtypes come out of the cuts beneath it, or the same donut is
   offered twice under two spellings. A BARE `Letter` IS A REAL STATE, never
   inferred — 935 lines are an order for letters whose word nobody has settled
   — so it stays pickable and the row says "(no letter yet)" in the mark
   colour. A chosen letter renders as the character alone under a static
   "Letter", because `Letter - "D"` in a row of five values is four words of
   packaging around the one that matters. `lib/specialOrderLines`, 21 fixtures,
   each rule checked by breaking it. Verified against real order **#7769**,
   which spells HAPPY BIRTHDAY VINNY: 21 lines, every character ticked in its
   own picker, and the order left as found.
   **(p) TWO LABELS AND A DEFAULT** (Mark, 2026-08-19). "What it is" is
   **Order name** and "How it leaves" is **Pickup / delivery** — both were
   descriptions of a field rather than names for one, which reads fine once and
   badly every day after. And **`taken_by` seeds from whoever creates the
   order** ("the name of the employee who started/initiated the order"), through
   `createSpecialOrder` so both doors agree. It is a SNAPSHOT OF A NAME and not
   a link to a user, which is the column this schema already has: FileMaker's
   holds "Traci", and 8,330 migrated orders name people who mostly no longer
   work here. It stays free text and editable — the order taken over the phone
   by somebody who then hands it to you is a real thing. Verified live: a real
   create wrote `taken_by: "Mark"` where the order made an hour earlier carries
   null.

   **(q) THE ORDER'S HISTORY WRITES ITSELF, AND "TAKEN BY" IS A LINK
   (migrations 053 + 054, BOTH NEED APPLYING).** Mark, 2026-08-19: "no edits I
   make to my test order are getting logged as events in the history section. Is
   that still to come?" — and it was never built. `special_order_events` had
   four writers and all four were ACTS on a screen (a document emailed,
   paperwork filed, an order flagged, a note); nothing watched the RECORD, so
   changing an event date, a price or a quantity left no trace.
   **FILEMAKER LOGGED FIELD EDITS AND WE DID NOT** — measured over its own
   106,465 entries, more than half the top shapes are column changes: "Order
   Type set to Quote" 8,045 · "Order To Do cleared" 4,792 · "Order Taken By
   changed to Traci" 3,457 · "Changed Event Date to …" 1,434 · "Delivery Charge
   changed to …" 1,262. So this is a missing half rather than a new idea. What
   IS new is **the lines and the payments**, which FMP never logged and Mark
   asked for ("adding/editing/removing items was absent from FMP and would be
   nice to have").
   **IT IS A TRIGGER**, which is design rule 6's own words for the catalog
   ("logged automatically by DB triggers — don't log in app code") and is here
   because there are already four ways an order changes — inline cells, two edge
   functions, `approve_quote_by_token` — so app-side logging has to be
   remembered in each, and the day it is forgotten looks exactly like the bug
   reported.
   Four decisions inside it, each of which the obvious version gets wrong.
   **ONE ENTRY PER STATEMENT, not per column**, so a three-column edit is one
   sentence — which also settles double-entry by construction. **`sort` IS NOT
   WATCHED**, and that is the omission that would flood the log: one drag
   renumbers the WHOLE list, 21 rows on a real order. **NOR ARE THE STAGE
   DATES**, which are set by acts that already write their own entry, so
   watching them would print each send twice. And **A UUID IS RESOLVED** —
   locations to their code, the customer and the employee to a name.
   **IT IS `security definer`, WHICH IS 001's ANSWER TOO** (`log_price_change`
   and its three siblings). Written plain first, and the harness said no twice:
   the writer calls `auth.uid()`, and the renderer reads `employees`, which 020
   gates to owner/admin — so a SUPERVISOR's edit would have logged "a record
   that no longer exists" where the taker's name belongs. What a definer opens
   is a DIRECT call, so **execute is revoked from `authenticated` rather than
   granted**; a trigger's permission is checked when it is created, not when it
   fires. Verified: `anon` AND `authenticated` are both refused the writer.
   Consequence that landed in the same commit: `OrderActions` stopped writing
   "Order cancelled", "Flagged: …" and "Issue resolved", each of which the
   trigger now says with more in it. Its `log()` helper is gone entirely — the
   one entry left is `Duplicated from order N`, a fact with no column anywhere.
   **AND `taken_by` IS A LINK (053).** `taken_by_employee_id` references
   `employees`, `on delete set null` (023 lets an owner delete a typo, and an
   order must not go with them). The roster comes from
   **`special_order_takers`**, a definer returning id and name only — 044's
   `production_operators` applied a second time, and a SECOND narrow function
   rather than a general one because 044 says why in as many words. It differs
   in being scoped by ORG, not location: whoever answered the phone is not a
   fact about a shop.
   **HISTORY IS DELIBERATELY NOT BACKFILLED, and the check is why.** A first
   pass said 98.7% of the 7,944 legacy names "resolve to an employee"; that was
   first-match-wins over 445 people. Checked properly, **2,386 (30%) match MORE
   THAN ONE** — mark → two, adam → three, amanda → five, sarah → four. A
   backfill would have attributed 558 orders to whichever Adam sorted first and
   said nothing about it. So the text column stays, the link is null on every
   migrated row, and the cell renders whichever it has — a link where we know,
   plain text where we only roughly do.
   **053 AND 054 ARE APPLIED** (Mark, 2026-08-20). *Probe, don't read this
   line*: `select taken_by_employee_id from special_orders limit 1` (present),
   and `select public.special_order_takers('00000000-0000-0000-0000-000000000000')`,
   which answers **"Not your organisation"** to a service_role script — that is
   migration 014's footgun and is what proves the function exists AND that its
   guard runs. The triggers only show themselves by FIRING, so look for an entry
   no app code writes: any message beginning "Order started" or containing
   "changed from".
   **055 IS APPLIED** (Mark, 2026-08-20) and the whole chain was walked live the
   same day: a real create through "New order for them" logged **"Order started
   as a lead"**, picking from the roster set the link, cleared the text and
   logged it as one entry, and the Notes tab's History rendered both with author
   and date. The order was then deleted, leaving 8,330.
   **055 adds the entry for the order EXISTING.** 054 watched
   UPDATE only, so a brand-new order had an empty history until somebody edited
   it — which reads as the logging not working rather than as nothing having
   happened yet. FMP wrote one ("Order started by tracit", 3,482 times).
   **It is a separate migration rather than an edit to 054, and that is the rule
   worth keeping**: 054 is applied, and once a migration has run it is history —
   a file that no longer describes what was run is how the harness and
   production quietly stop being the same database. 054 IS rerunnable, so
   re-pasting it would have worked; the ledger is the reason not to.
   The trigger has to be RECREATED, not just the function: `create or replace`
   on a function does not widen the events its trigger fires on.
   **056 IS APPLIED** (Mark, 2026-08-20) and the whole log was walked live
   afterwards on a throwaway order, one path at a time: create → "Order started
   as a lead"; pick from the roster → **"Taken by set to Mark Trombino"**, one
   line, which is 056 working; a title edit → "Order name changed from … to …";
   add a line → "Added 12 × Angry Samoa"; edit its quantity → "Angry Samoa —
   quantity changed from 12.00 to 24.00"; remove it → "Removed 24 × Angry
   Samoa". Order deleted afterwards, leaving 8,330 and 47,819 lines.
   Known cosmetic residue, NOT fixed: a numeric column renders through
   `to_jsonb`, so a quantity reads **"12.00"** rather than "12". Trimming
   trailing zeros generally would turn money into "5.1", which is worse, so the
   fix is per-column in `special_order_value_label` and is a migration nobody
   needs today.
   **056 makes "Taken by" report as ONE field.** Found by using
   it minutes after 055 went in: picking somebody from the roster writes both
   halves in one statement — the link set, the superseded text cleared — and
   both carry the label "Taken by", so the entry came out **"Taken by cleared
   (was Mark); Taken by set to Mark Trombino"**. Every word true, and it reads
   like a glitch on the commonest edit this field will ever see. The text half
   is suppressed WHEN THE LINK MOVED IN THE SAME STATEMENT and only then —
   editing the legacy text on one of the 7,944 orders that has no link still
   logs "Taken by changed from Traci to Levi", which is the case where that text
   IS the answer. Both pinned on the harness. Nothing but the function changes;
   055's trigger already fires on insert and update.
   Known gap: **the CREATE still seeds only the text.** Resolving the signed-in
   member to their employee row needs `employees.user_id`, which a supervisor
   cannot read — a third definer, not built. Pick the person on the record.
   **057 AND 058 ARE APPLIED** (Mark, 2026-08-21) — the inquiry form and its
   auto-flag. *Probe, don't read this line*, and there are two that matter.
   `select public.create_inquiry(null, 'A Name')` must return
   `{"ok": false, "state": "unknown_org"}` — an ANSWER, not an error, which is
   the property the whole public surface rests on; and
   `select count(*) from pg_proc where proname = 'create_inquiry'` must return
   **ONE**, because two would mean 058's argument list drifted from 057's and
   both versions are live (033's `freeze_pay_period` trap). Also
   `select public.inquiry_shops(null)` → `[]`, and `locations.public_name`
   selects, with DF01/DF02 reading "Highland Park" / "DTLA".
   **`submit-inquiry` is DEPLOYED at v2** — v1 read the confirmation template
   from `special_orders.inquiry_email`, v2 from `special_orders.email.inquiry`
   beside the other five, which is what `/settings` edits. `send-po-email`,
   `send-special-order-email` and `approve-quote` still run the pre-`messageId`
   `_shared/email.ts` (last deployed 2026-08-19) and that is FINE, verified
   rather than assumed: the field is optional and none of them passes it, so no
   `Message-ID` header is emitted and Resend's `headers` object stays
   `undefined`, exactly as before.

   **059 IS APPLIED** (Mark, 2026-08-21 — purchase requests). *Probe, don't read
   this line; it has been wrong in both directions for four different
   migrations.* Three probes, because it does three distinguishable things:
   `select column_name from information_schema.columns where table_name =
   'purchase_requests' and column_name in ('priority','resolution_note',
   'inventory_item_id','resolved_at','dismiss_reason')` — expect the first four
   and NOT `dismiss_reason`; `select polname from pg_policy where polrelid =
   'public.purchase_requests'::regclass` — **four** rows, the new one being
   `preq_author_update`; and `select conname from pg_constraint where conrelid =
   'public.purchase_requests'::regclass and contype = 'c'` — includes
   `purchase_requests_reason_when_dismissed`.
   It had to be applied BEFORE deploying, which is the opposite of 012's order:
   the new screen SELECTS these columns, so a deploy in front of the migration
   400s the whole select and the list renders its "migration 059 has not been
   applied yet" sentence rather than a queue. It is NOT rerunnable — the rename fails a
   second time, which is the signal it already ran — and all-or-nothing, since
   a partial run dies on that rename before it reaches the constraint, the
   policy or the index.

   **067 AND 068 ARE APPLIED** (Mark, 2026-08-27 — scheduling a special order's
   production), and the whole loop was WALKED on the real #7769 the same day and
   left exactly as found. *Probe, don't read this line; it has been wrong in both
   directions for four different migrations.* For 067, three probes because it
   does three things:
   `select conname from pg_constraint where conrelid =
   'public.production_schedule_items'::regclass and contype = 'u'` — must NOT
   include `production_schedule_items_schedule_id_item_id_key`;
   `select indexname from pg_indexes where tablename =
   'production_schedule_items'` — must include `production_schedule_items_line`;
   and `select count(*) from pg_proc where proname =
   'generate_production_schedules'` — must be **ONE**, because two means the
   argument list drifted and 040's version is live beside it (033's
   `freeze_pay_period` trap).
   For 068: `select public.schedule_special_order(null, null, null, null, null)`
   must raise **"no order given"** from its first statement, and
   `select public.unschedule_special_order(null)` the same, which proves the
   code ran; and `select count(*) from production_schedules where source =
   'special_order'` — 0 until somebody schedules one.
   067 must go FIRST: 068's insert relies on the widened key. Neither is
   rerunnable — 067's `drop constraint` fails a second time, which is the signal
   it already ran.

   **069 IS APPLIED** (Mark, 2026-08-27 — a special order's lines stop being
   rolled up), and it was VINDICATED on his own data within the hour: he
   scheduled two real orders, and **#9886 is two rows differing only by their
   note — 18 "Vanilla glaze with gold dust sprinkles" and 18 "Maple glaze with
   gold dust sprinkles", same item, same cut, same size.** Under the roll-up
   that was one line of 36 Custom Mini and the kitchen made whichever it
   guessed. *Probe, don't read this line.* The one that matters is the key's
   shape, because everything else here follows from it:
   `select indexname, indexdef from pg_indexes where tablename =
   'production_schedule_items' and indexname like '%line%'` — expect ONE row,
   `production_schedule_items_generated_line`, whose definition ends
   `WHERE (par_source <> 'special_order'::text)`, and NO
   `production_schedule_items_line`. Then
   `select proname, count(*) from pg_proc where proname in
   ('generate_production_schedules','schedule_special_order') group by 1` —
   **1 each**, or an argument list drifted and an overload is live beside it.
   NOT rerunnable: `drop index production_schedule_items_line` fails a second
   time, which is the signal it already ran.

   **075, 076, 077 AND 078 ARE ALL APPLIED** (Mark, 2026-08-29/30 — facility
   checks). *Probe, don't read this line; it has been wrong in both directions
   for four different migrations.* Four probes, because they do four things:
   `select count(*) from equipment` and `… from location_tasks` (075's tables);
   `select polname, polcmd from pg_policy where polrelid =
   'public.location_tasks'::regclass` → **THREE** rows and NO delete, or
   somebody added an eraser that bypasses the reason;
   `select id, public from storage.buckets where id = 'facility-photos'` → one
   row, public **FALSE**, since a public bucket here is a data leak; and 078's
   `select column_name, is_nullable from information_schema.columns where
   column_name in ('guidance','position') and table_name in
   ('checklist_template_items','checklist_run_items')` → **FOUR** rows, every
   one YES.
   The one that would be SILENT if it broke is 076's empty-array refusal, which
   is what was wrong first:
   `insert into checklist_templates (org_id, location_id, kind, name, weekdays)
   select id, (select id from locations limit 1), 'checklist', 'x',
   '{}'::smallint[] from orgs limit 1;` must **ERROR**. If it inserts, the check
   is using `array_length` again — which returns NULL for an empty array, and a
   CHECK passes on NULL.
   Order is load-bearing: **075 → 076 → 077 → 078**. 076's
   `checklist_run_items.task_id` references a table 075 creates, 077's photos
   reference both, and 078 alters 076's tables. None is rerunnable.

   **060 IS APPLIED** (Mark, 2026-08-22 — the request's details box).
   *Probe, don't read this line.* `select column_name, is_nullable from
   information_schema.columns where table_name = 'purchase_requests' and
   column_name = 'details'` — expect one row, `YES`. One nullable column, no
   policy and no constraint, so nothing else moves. Same order as 059: it had to be applied
   BEFORE deploying, since the list selects the column; until it was, the
   screen said so in the same sentence. A SEPARATE FILE rather than an edit to
   059 because 059 is applied — 055's rule, that a migration which has run is
   history and a file no longer describing what was run is how the harness and
   production stop being the same database.

   **061 AND 062 ARE APPLIED** (Mark, 2026-08-22 — the per-employee workday
   start, and the paycheck that stopped following it). *Probe, don't read this
   line.* For 061, three things, because it does three:
   `select column_name, data_type, is_nullable from information_schema.columns
   where table_name = 'employees' and column_name = 'workday_starts_at'` (one
   row, `time without time zone`, `YES`);
   `select conname from pg_constraint where conrelid = 'public.employees'::regclass
   and contype = 'c'` (includes `employees_workday_start_is_afternoon`); and
   `select count(*) from employees where workday_starts_at is not null` — **11**
   today, the back-of-house crew, all `14:00:00`. The constraint bites through
   PostgREST as well as in SQL, so an app write of `03:00` or `14:00:30` is
   refused by name rather than rounded.
   For 062 the trigger only shows itself by FIRING, so probe the invariant it
   maintains rather than the function:
   `select count(*) from timesheets t join pay_periods p on p.id = t.pay_period_id
   where t.business_date not between p.start_date and p.end_date` (**0**);
   `select count(*) from timesheets where pay_period_id is null` (**0**); and
   `select count(*) from timesheets where workday <> business_date` (**24** —
   the kitchen's evening shifts in the 08-03→08-16 pay period, the first rows in
   seven years where the two columns differ at all).
   Note 062 is RERUNNABLE where 061 is not, and its backfill is a no-op once the
   invariant holds — verified by running it twice on the Docker harness.

   **070, 071, 072, 073 AND 074 ARE ALL APPLIED** (Mark, 2026-08-28/29 — the
   shift report, its break time, its reopen, the per-shop access grid, and the
   password-reset log). *Probe, don't read this line; it has been wrong in both
   directions for four different migrations.*
   For **070**: `select count(*) from shift_reports` (the tables exist), and
   `select public.submit_shift_report(null)`, which must RAISE "No such shift
   report" from its first statement — that proves the body runs AND its guards
   do. For **071**: `select data_type, is_nullable from
   information_schema.columns where table_name = 'shift_report_ratings' and
   column_name = 'break_started_at'` → `time without time zone`, YES.
   For **072**: `select public.reopen_shift_report(null)` raises the same way,
   and `select count(*) from pg_proc where proname = 'reopen_shift_report'` must
   be **1** — two would mean an argument list drifted and an overload is live
   beside it (033's `freeze_pay_period` trap).
   For **073**, the one that matters is the EMPTY-TABLE rule rather than the
   table: `select public.may_work_at(o.id, m.user_id, l.id) from orgs o,
   org_members m, locations l limit 1` must be **true** while
   `select count(*) from location_members` is **0**. If that ever answers false
   on an empty table, every member has just been locked out of every shop.
   For **074**: `select count(*) from pg_policy where polrelid =
   'public.password_reset_requests'::regclass` → **1**, SELECT only; a second
   policy would mean somebody added a write path the service_role function is
   supposed to be the only holder of.
   Deploy order for the functions: `send-shift-report` and
   `request-password-reset` are new, and **`sync-square-sales` must be
   REDEPLOYED** for its `preview` mode or the shift report's Sales page can only
   ever say "Square has not reported this day yet". `_shared/email.ts` gained an
   optional `html`, and since it is compiled in AT DEPLOY TIME the other
   consumers pick it up only when redeployed — hygiene, not a requirement, since
   none of them passes the field.

   **(r) THE ROW IS A PROGRESS BAR** (Mark, 2026-08-20, after a mockup pass).
   A wash fills each row of `/special-orders` to the fraction of stages done,
   yellow at the first rung and green at the last, under a 3px rule on the row's
   bottom edge — plus a six-tick **Progress** strip saying WHICH.
   **THE SIX STAGES ARE MARK'S AND THEY ARE A LADDER WHERE THE SEVEN ARE NOT.**
   Measured over the 8,321 real orders, the seven stage columns are prefix-clean
   on **32%** — 68% carry a later stamp before an earlier one. Two of the seven
   cause nearly all of it: `delivery_scheduled_at` is filled on 11% because 82%
   of orders are pickups (of 6,846 pickups, NINE ever booked a delivery), and
   `order_scheduled_at` on 23%. Mark's six — Lead · Quote sent · Quote returned
   · Invoice sent · Invoice paid · Printed & scheduled — drops the booking and
   folds scheduling into printing, and is **88.6% prefix-clean**. That is what
   makes a bar honest here.
   **Two things offered and DECLINED, recorded because they will read as
   oversights.** Stage 6 is printed **AND** scheduled, not OR: printed is 64%,
   scheduled 23%, both 22.7%, so 41% of printed orders sit at 5 of 6 for good —
   deliberate, because scheduling is the real last step. And there is **no
   Receipt rung** though `receipt_sent_at` is filled on 58.4%; the ladder ends
   where the kitchen's work does.
   **STAGE ONE IS ALWAYS DONE, AND IT DRAWS NO BAR** (Mark, 2026-08-21: "Stage 1
   (leads) should have no visible progress bar. Stage 2 (quotes sent) should
   have the first visible display of a progress bar."). This REVERSES the first
   cut, which drew a 1/6 sliver so the bar was never an empty track — zero was
   thought to read as "broken" where a sliver reads as "started". Using it
   settled it the other way and the argument is better: **being a lead is the
   starting line, not progress.** Every order has reached it, so a mark every
   row carries distinguishes nothing, and on a list whose leads run to 39 rows
   it is a column of identical slivers.
   So the BAR measures the five rungs BEYOND the lead — nothing at rung 1, the
   first visible length at rung 2, full at rung 6 — while the STRIP still shows
   all six, because "which rungs are done" and "how far along" are different
   questions and the tick answers the first. **`OrderProgress.fraction` IS THE
   BAR'S OWN LENGTH**, `(done - 1) / (total - 1)` rather than `done / total`:
   both the width and the colour ramp read it, which is what keeps the first
   VISIBLE bar yellow and the last green, and a field that said 1/6 while the
   bar drew nothing would be a trap. `snapStops` is asked for FIVE stops, not
   six, indexed `done - 2`.
   **A FLAGGED LEAD STILL DRAWS, and since 058 that is the common case rather
   than an edge** — every inquiry from the public form arrives flagged and most
   arrive as nothing but a lead. Flagged is full-width red whatever the stages
   say, so the "no bar at rung 1" test runs AFTER it; the other order makes
   every new inquiry invisible, which is the exact opposite of what flagging it
   is for. Fixture-pinned in both directions.
   **The off-by-one in the snapped index was NOT caught by the suite** and was
   found by breaking it: nothing pinned WHICH stop a given rung draws to, so
   `snapped[done - 1]` passed all 1072 cases while drawing every bar one column
   too long and reading `undefined` — "NaN%" — on the last rung. There is a
   fixture for it now.
   **THE STATUS SETS A FLOOR AND THE DATES ONLY PUSH IT FURTHER** (Mark,
   2026-08-20: "once an order is set to 'order', then it should jump to stage
   5"). That is not a new rule — it is `STATUS_HINT` believed by the bar:
   lead→1, quote→2 ("sent, awaiting approval"), invoice→4 ("sent, awaiting
   payment"), order→5 ("**paid** — printing and scheduling remain"). The status
   is the record's claim about where it got to; the dates are how. When they
   disagree the status wins, because plenty of real orders reach a rung without
   stamping it — **925 orders at status `order` have no quote date and 770 no
   payment date** (wholesale and standing orders, billed weekly, which never
   pass through a quote). Measured, the floor moves **1,501 of 6,664 committed
   orders (23%)** off a bar that made finished work look unfinished.
   **The floor fills the TICKS, not just the count** — raising the number alone
   would leave the strip showing gaps while the wash said five, which is two
   readings of one fact disagreeing.
   **WHOSE MOVE IT IS BEATS HOW CLOSE THE EVENT IS** (Mark, 2026-08-20, with two
   real orders). `stageState`'s two waiting rungs — `quote_returned` and
   `invoice_paid` — were `close || past ? "overdue" : "waiting"`, and `close` is
   `printWithinDays`, TWO days. So order 9882 (quoted the 12th for the 22nd) and
   9863 (invoiced the 6th for the 22nd) both painted RED when we are plainly
   waiting on somebody else. They are `past ? "overdue" : "waiting"` now: while
   the event is ahead of you, waiting on them IS waiting; once it is behind you,
   "waiting" is a euphemism. Known cost, accepted: no warning in the last two
   days from the strip, which the row's event date and the attention queue both
   still carry. **Only the two THEIR-move rungs changed** — the four we act on
   are still `close || past`.
   **AND `suggestedTodo` NOW ASKS WHETHER ITS OWN DOCUMENT HAS GONE OUT.** It
   only ever looked at the NEXT stage's date, so it could not tell "not sent
   yet" from "sent and unanswered": 9863 was told to "Send Invoice" sixteen days
   after the invoice went out, and 9882 to "Respond to Email/Call", which is
   what you do for a LEAD that has written in. **When the ball is in their court
   the suggestion is NOTHING** until the event has passed, at which point an
   unpaid invoice gets FileMaker's own "Invoice Overdue!". A to-do suggested on
   every waiting row is the noise that teaches people to ignore the column, and
   the strip already says "waiting on them" in yellow. It takes `today` now —
   optional, and without it the chase simply never fires.
   **ONLY THE FIRST BLOCKED RUNG IS COLOURED** (Mark, 2026-08-20: "once we hit
   either a red or yellow one, the ones after it should just be 'not yet'").
   `stageState` judges each rung alone, so a near or past event calls EVERY
   undone rung overdue — an order with nothing stamped came out
   `done · OVERDUE · — · OVERDUE · — · OVERDUE`, which reads as three separate
   things being late when the quote is the blocker and the rest have not come
   up. A strip painting them all says nothing about WHERE the order is stuck,
   which is the one thing it exists to say. **A `done` rung is never demoted**:
   it is a fact rather than a prediction, and `done` is COUNTED from these
   ticks, so greying one would also shorten the bar. The tooltip inherits it and
   now carries at most one reason.
   **Cancelled gets NO bar** (the style is `undefined`, not a zero width) and the
   row greys out; **flagged is full-width red** whatever the stages say. Cancelled
   BEATS flagged — 705 orders are cancelled and a flag is cleared as soon as it
   is dealt with, so an order called off is not an open problem.
   **THE BAR SNAPS TO A COLUMN RULE** (Mark, 2026-08-20: "it looks a bit off
   when a column is partially colored"). The eye takes a vertical rule as the
   edge of a thing, so a wash stopping just short of one reads as having failed
   to reach it rather than as a measurement. `snapStops` takes the NEAREST rule
   and forces the run STRICTLY INCREASING — the second half is what makes it
   safe, because nearest alone sends two adjacent rungs to the same rule
   whenever a column is wide, and then 2 of 6 and 3 of 6 draw identically, which
   is worse than landing mid-cell. With fewer rules than rungs (a reader who has
   hidden the table down to five columns) it returns null and the raw fraction
   is used: snapping badly is worse than not snapping. **Only the LENGTH
   snaps** — the colour still runs off the true fraction, so the ramp stays even
   however the columns are dragged.
   That is what `rowStyle`'s second argument is for: only `DataTable` knows
   where the rules fall (weights, the reader's dragged widths, whatever is
   hidden), so it hands them over rather than the caller guessing.
   **The wash is 20% alpha and the fraction is inline**, which is why
   `DataTable` gained **`rowStyle`**: a computed width is not something a set of
   utilities can cover. It goes on the `<tr>` so the background spans the row —
   anchoring it to a cell makes it as wide as that column, which is exactly how
   the first mockup came out wrong — and the hover wash is a background COLOUR
   on the same element, so both survive.
   **`SHOW_ROW_PROGRESS_WASH` is the seam** for Mark's "make it a preference
   later… it might be too loud for some": one constant, not a stored preference,
   because a preference nobody can reach is dead machinery. Turning it into one
   is a `useSyncExternalStore` over localStorage plus a switch in the filter row.
   **It governs the WASH only** — the strip is a column, so the Columns menu
   already hides it, which is why the two are separate.
   The legend is pinned in a `ui/StickyFooter` and draws its OWN top rule (that
   component contributes position and a white backdrop and nothing else).
   **The strip's tooltip is a CHECKLIST** (Mark, 2026-08-20, who drew it) —
   `☑ Lead / ☐ Quote returned — waiting on them` rather than `Lead: done /
   Quote returned: waiting`. A column of boxes is scanned rather than read, and
   the eye lands on the first empty one, which is the next thing to do and the
   only reason to open it. The box is TWO-state and the strip is four, so
   overdue and waiting are said in words after the label while a rung merely not
   due yet says nothing — otherwise most rows carry four "not yet"s, which is
   the noise this replaced. **Both glyphs carry U+FE0E**: `☑` has an emoji
   presentation and `☐` does not, so without it Apple renders a colour box
   beside a plain outline one — the order guide's ♥/★ pair carries the same
   selector for the same reason. It is a native `title` like every tooltip here
   and inherits that there is NO HOVER ON AN IPAD; acceptable because the
   strip's colours already say done, overdue and waiting without it.
   **ALL SEVEN STAGE COLUMNS ARE GONE** (Mark, same day, in two steps — the six,
   then "the print column can go too"), and the strip moved to the END where
   they used to be. 868px of dates replaced by 92px of ticks: they were the
   third grain of one fact — how far, which, WHEN — and the day is on the
   record, which is where you go when you want it. The list went 16 columns to
   9. `STAGES` is NOT trimmed: `stageState` and `orderProgress` read the whole
   ladder and the record still prints every stamp.
   Final order: **Number · Kitchen · Status · Date · Customer · Event · Total ·
   Progress · To-do**. To-do led the list until this pass, which put a
   mostly-empty column — set on 101 of 8,330 orders — at the margin the eye
   starts from; last, it reads as what it is, a note left on an order.
   No `storageKey` bump for any of it — a stored key whose column is gone drops
   out, and a column added since the last drag appears at its declared position;
   both are already `columnOrder` fixtures.

   Not done, and worth asking about: **`LinkCustomer` does not seed the
   contact.** Linking a customer to an EXISTING order is the same idea, and
   overwriting a day-of contact somebody has already typed is not.

   **(o) THE RECORD LOST ITS PINNED BAR, THE DOCUMENT PICKER, AND THE COLUMN
   UNDER THE MONEY** (Mark, 2026-08-19, three layout notes in one).
   **THE COMMANDS ARE LEVEL WITH THE TITLE** — right-aligned in the identity
   block's own row, and the "Commands" heading is gone with the move. They went
   there in two steps the same day: first out of `ui/StickyFooter` and into the
   Info tab's top-right quadrant ("move the buttons pinned to the bottom to
   above the customer quadrant"), then up one more level ("remove the title
   'commands' and move the buttons up a level so they're even with the title
   area"). Only the final arrangement is in the code; the intermediate one is
   recorded because its cost is what the second step bought back.
   Three things this settles.
   `ui/StickyFooter` is gone from this screen, and with it the spacer every tab
   was paying for whether or not you were going to press anything.
   **The heading went because a row of seven buttons is self-evidently a row of
   buttons** — `OrderActions` made that argument when it lost its own — and a
   caption over it spends exactly the vertical space the move was meant to give
   back.
   **And they are on EVERY TAB again**, because the identity block sits above
   the tab switch. The quadrant version was Info-only, which meant emailing a
   quote from Items took a click on Info first; that consequence is retired.
   The row is `items-start`, so the buttons line up with the TOP of the title
   rather than centring against a block whose height changes with the attention
   sentence — measured, the Preview button's top and the `h1`'s top are the same
   pixel. The two button rows **right-align beside the title and left-align once
   they wrap under it** (`items-start xl:items-end`): right is what makes a
   cluster read as one block when both rows end on the page margin, and wrong
   under the heading, where it indents the shorter row from the heading's own
   margin for no reason. The wrap happens between 1024 and 1280, which is where
   the breakpoint is. Measured: 1440 and 1280 level and unwrapped with both rows
   ending on the margin; 1024 wrapped with both rows starting on it; no
   horizontal overflow at any of the three.
   **THE DOCUMENT PICKER IS GONE AND EACH VERB IS A MENU OF THE FOUR
   DOCUMENTS** ("Delete the document selection picklist, then make Preview,
   Download, and Email… picklist buttons… Same functionality, one less
   button"). The picker held STATE, which is the thing this fixes rather than
   the button count: you chose Invoice, pressed Preview, came back a minute
   later and the bar still said Invoice, so the next Email went to whatever you
   had been looking at. Folded into the verb it is one gesture and leaves
   nothing selected — press Preview, pick Quote, and that is the sentence. It is
   **`ui/MenuButton`, NOT a `PickList`**, and the distinction is what the choice
   MEANS: a PickList chooses a value that stays chosen and shows which one is
   current; these are verbs. That control is `ui/RowMenu` lifted out rather than
   a second anchored panel — the two-pass placement, the flip near the window's
   foot, the close-on-scroll and the `z-[70]` are not worth learning twice.
   `kind` survives as state only because the compose DIALOG needs to know what
   it is sending; it is set by the act that opens it. **The popup gotcha still
   holds and still works**: `MenuButton` closes synchronously inside the click,
   so `openWindowNow()` is still inside the gesture.
   **Each of the three wears the caret** (Mark: "the new document picklist
   buttons should have the arrow glyph to indicate it's a picklist"), and the
   glyph itself moved to `lib/anchoredPanel` as `MENU_CARET` so `PickList` and
   `MenuButton` cannot draw the same affordance two ways. Its SIZE and COLOUR
   deliberately stay at each call site: a PickList trigger hovers to a pale wash
   where `text-muted` reads fine, and a command button fills BLACK, where a
   fixed grey would go dark-on-dark — so this one is `currentColor` at 60%.
   It is **opt-in, and `RowMenu` does not take it**: `⋯` already means "there is
   more here", and a caret beside it is the same claim twice inside a 36px
   square.
   **PAYMENTS LEFT, MONEY RIGHT ON THE ITEMS TAB.** Stacked, the payments table
   sat a screen below the balance it settles. They shipped Money-left first and
   were swapped the same day ("move the 'money' section… all the way to the
   right of the page, and the payment… all the way to the left"), which is
   better than it was: the lines table above ENDS in a money column against the
   right margin, and Money's own figures are a column of amounts against a right
   margin too, so on that side they continue the page's one vertical rule of
   numbers instead of starting a second one 400px to its left.
   **Money is sized to its CONTENT and Payments takes the rest**, rather than an
   even split — the recipe record's Costs-pane call and its reason: Money is
   label/value pairs set `justify-between`, so half of a 1150px column becomes
   500px of white space between "Delivery charge" and "$49.50", where a table
   with a free-text Note uses every pixel. Payments being the FLEXIBLE one is
   also what holds Money on the right margin when that table stops at its own
   `max-w`.
   **MONEY IS TWO COLUMNS INSIDE ITS OWN BLOCK** — tax rate through ignore-the-
   balance on the left, Items through Balance on the right, which is the two
   `dl`s exactly as they were written: what you SET beside what it COMES TO. It
   was briefly stacked, on the day the block became half a row and the pair
   would not fit; a `max-w-[32rem]` is what buys it back, and the block still
   sizes ITSELF rather than taking a share of the row, which is what keeps its
   right edge on the page margin. `max-w` and not a fixed `w`, because below
   `xl` it is stacked at the full width of the page where two 400px tracks would
   reintroduce the white space this is avoiding. Measured with real figures: two
   201px tracks, no label wrapping.
   **THE SWITCH HAS NO SENTENCE BESIDE IT.** "Wholesale days are billed weekly,
   not per order" was one REASON somebody might reach for Ignore the balance,
   not what it does — so on every other order it was a sentence about somebody
   else's order. Its accessible name still says what it does.
   **ONE DOM ORDER AT EVERY WIDTH, no `order-*` classes**: below `xl` you read
   Payments then Money, which is the price of keeping the visual order and the
   tab order the same thing. Measured at 1440: Payments starts at 240 and Money
   ends at 1392, which are exactly the lines table's own two edges; at 1024,
   stacked, Payments first; no horizontal overflow at either.
   **THE LINES TABLE'S COLUMNS DRAG TO RESIZE, AND IT IS STILL NOT A
   `DataTable`.** Worth stating, because the convention says every list is one.
   Two things this table does that the component cannot: a line is DRAGGED TO
   REORDER (`useRowDrag`, the ⠿ grip — a special order's line order is
   meaningful, and FileMaker's slots are where it comes from), and the last row
   is a SUBTOTAL spanning most of the width. Teaching `DataTable` row-drag would
   touch fifteen screens to serve one, which is the same reasoning that leaves
   `/order-guide` and `/cleanup` hand-rolled.
   What it does NOT hand-roll is the resizing: `useResizableColumns` and
   `catalog/ColumnHeader` are the shared primitives UNDERNEATH `DataTable`, so
   the grip, its Safari fixes, the persistence and the "Reset column widths"
   footer behave here exactly as on every list. Widths are WEIGHTS turned into
   percentages of the visible total (the fluid-column rule), the table is
   `table-fixed` — without which a `<col>` width is a suggestion the browser
   ignores — and **no column sorts**, because the ORDER IS THE DOCUMENT and a
   click that reordered it would fight the drag handle beside it.
   That last part surfaced a bug in the shared header: **`ColumnHeader` drew its
   resting `↕` on every column, sortable or not.** The marker is a promise, and
   on a column with no `onSort` it is one nothing keeps — equally wrong on every
   CONTROL column, which has never had an `onSort` either. It is now conditional.
   **AND THE LINES TABLE'S NOTE IS ITS SECOND COLUMN**, where it used to sit
   between Tax and Total. It belongs beside the thing it is about — `"H".
   Chocolate glaze with rainbow sprinkles` is a sentence about the item on its
   left — and moving it out of the middle lets Qty · Price · Tax · Total run as
   one unbroken band of figures against the right margin. Item and Note are both
   unsized, so they share whatever the four fixed columns leave.

   **(m) THE CREATE DIALOG ASKS WHO IS ORDERING, not who to call** (Mark,
   2026-08-18: "we should be able to set the customer when creating a special
   order. Remove the contact, phone and email and add the ability to link or
   create a new contact"). Those three boxes wrote `contact_*` — the DAY-OF
   contact, which on a corporate order is whoever is running the party and is
   genuinely a later detail. WHO IS ORDERING is what you know when the phone
   rings, and it was the one thing the form could not record. All three survive
   on the record.
   **`CustomerPicker` WRITES NOTHING.** A create dialog that has already made a
   customer by the time you press Cancel is a dialog that lies about what Cancel
   means, so a new customer is held as a DRAFT and `createSpecialOrder` writes
   it in the same act as the order — which also makes it impossible for an order
   to end up pointing at a customer that failed to save. Verified: typing a name
   into the form leaves `customers` at 5,874, and only Create moves it.
   The QUERY lives in `lib/customerSearch` because two screens ask it — this and
   the record's `LinkCustomer` — and it is the half with a rule in it. The UI
   differs legitimately; the search must not.
   **(k) AN ORDER COULD NOT BE GIVEN A CUSTOMER** (Mark, 2026-08-18: "how am I
   supposed to link a customer to the order?"). The only writer of
   `customer_id` in the whole app was "New order for them" on the customer
   record, which sets it at CREATION — so the link existed in one direction
   only, and an order that began as a lead (every phone order, and everything
   decision 18's inquiry form will create) said "None linked" forever with
   nothing to press. `LinkCustomer` is `InventoryItemPicker`'s shape, built for
   the same reason that one was.
   A SEARCH BOX, not a `PickList`: there are 5,874 customers and a picker loads
   its options up front. It searches five columns in one `or()` — and **the
   phone is matched on its DIGIT RUNS rather than as text**, which is not
   fussiness: stored `(323) 337-7966`, pasted `(323) 337`, and a plain `ilike`
   finds NOTHING, because the parentheses have to be stripped to keep them out
   of PostgREST's `or` list and stripping them leaves spaces the record does not
   have. `*323*337*` is indifferent to punctuation, which the real data needs —
   it holds `3233833742`, `310.721.5994` and `323) 485-2621`.
   It also offers **New customer from this order's contact**, because the common
   case is somebody ringing who turns out to be new and whose name and number
   are already typed into the order; sending them to `/customers` to type it a
   second time is the transcription the customer record exists to avoid.
   **(l) WHEN IT IS WANTED IS REQUIRED ON A REAL ORDER** (Mark, 2026-08-18).
   The create form asked for a title and nothing else, on the reasoning that a
   lead acquires the rest as the conversation happens. True of the customer, the
   lines and the money; false of WHEN — the kitchen sheet prints the pickup time
   as its most prominent field, the attention queue measures every threshold in
   days before the event, and an order nobody can date cannot be scheduled or
   chased. **The date is required with it**, which is forced rather than chosen:
   a time with no date says nothing. **Both are asked only of `kind = order`** —
   a template is a shape with no event and a standing order recurs by weekday,
   so demanding a date would make those two kinds uncreatable. The form had no
   time field at all before this; `ui/TimeField` is new and in the parts table.

   **(i) "ALSO THAT DAY" IS SCOPED TO THE KITCHEN** (Mark, 2026-08-17: "I
   assume you're only displaying orders for the same kitchen" — it wasn't).
   The block exists to stop a supervisor double-booking a KITCHEN, so another
   shop's night is not context, it is noise that inflates the count. Measured
   on 2026-08-16: order 9885 is DF01 and two of the four it listed were DF02,
   so half the block was somebody else's work.
   **Unassigned orders come too, and are marked**: 1,403 of the 8,329 real
   orders carry no kitchen, and they are load that will land somewhere —
   hiding 17% of the history would understate the day while looking complete,
   which is the failure this block exists to prevent. An order with no kitchen
   of its own has nothing to scope by, so it sees every kitchen and says so.
   Each row also carries its STATUS, in WEIGHT rather than colour — a
   committed `order` in full ink, a lead or quote muted. Colour is reserved
   for a state that is wrong or wants an eye and a lead is neither; dimming the
   whole ROW is refused for the Locations list's reason, that greying text you
   can still click reads as disabled and lies.
   **(h) THE INFO TAB IS FOUR QUADRANTS, ONE SECTION EACH** (Mark, 2026-08-17:
   the stacked column "just looks like a wall of text"), with FileMaker's own
   EVENT INFO tab as the reference:
   **Details · Customer** on top, **Also that day · Completion dates** beneath —
   the two panes that GROW at the bottom, where they can run as long as they
   like. Mark set that arrangement; the first cut stacked Customer over
   Completion dates and put the log bottom-right, which made the right column
   494px of a 588px frame and left the log FIFTY-FOUR PIXELS.
   **The log moved to the Notes tab**, which is what freed a quadrant — and is
   the right home for it: notes want WIDTH (they are paragraphs), the log wants
   HEIGHT (two hundred entries), so `OrderSplitLayout` puts them side by side
   and neither is under the other. Info stops paying for 200 log rows too.
   **DELIVERY IS NOT A TAB FOR A PICKUP ORDER** (Mark: "Delivery being on its
   own is weird but not sure where it fits"). It was weird because **6,842 of
   the 8,330 real orders are pickups**, and for those the tab held a two-cell
   toggle and one sentence — four times out of five, a tab leading nowhere. The
   CHOICE moved into the Details quadrant beside Pickup shop, where it is a
   fact about the order rather than a delivery detail, and `tabsFor` shows the
   tab only when that cell says delivery. Switching the cell makes it appear, so
   nothing hides behind a state you cannot reach.
   `components/specialOrders/OrderInfoLayout` measures the frame with
   `useExactViewportHeight` (the recipe record's hook, `xl`-gated, 420px floor)
   and each column's LAST pane takes the slack and scrolls its own rows.
   TWO COLUMNS OF STACKED PANES rather than a literal 2x2 grid, which is
   `RecipeInfo`'s shape and reason: a grid ties both bottom cells to one row
   height, so a long log would stretch the empty pane beside it.
   Three things this cost, each found by measuring rather than reading:
   **`overflow-y-auto` on the growing pane is load-bearing** — without it
   `xl:flex-1` gives the pane a box, the log simply overflows it, and the page
   runs to 1402px inside a 588px frame, which is the arrangement the layout
   exists to replace. **The top blocks decide whether the bottom ones exist**:
   Customer + Completion dates came to 494px of a 588px frame and left History
   FIFTY-FOUR PIXELS, a heading and nothing else — which is why the dates moved
   to the bottom-LEFT quadrant. And **inline labels were tried everywhere and
   kept only for the dates**: at ~272px per sub-column a 128px label track
   leaves too little for a name or a phone, so those wrap; the dates are short
   values and stay inline, which is what makes that block compact.
   **NOTES IS ITS OWN TAB** (FileMaker has one) — five multiline document notes
   are a screenful and they pushed the log below the fold. **The commands moved
   to a `ui/StickyFooter`**, FMP's bottom row: on the Info tab they sat under
   the log, so Delete was two hundred entries down the page.
   Known residue: at 1440x900 the page still scrolls ~32px. Nothing is hidden
   and every pane fits; it has not been chased down.
   Also: `ui/FilterMenus` gained a **`trailing`** slot (right-aligned; on its
   own line ABOVE the menus since 2026-08-21, in the row until then) for a
   list's create command — `EmployeesList` had the
   same slot before the control existed. And `/special-orders` and `/customers`
   join `/employees` in `InactiveLocationGate`'s exempt list, because decision 8
   makes them deliberately ORG-WIDE.
   The rest of this entry is the design as specced; it was settled in
   conversation with Mark against the fresh exports
   (`FMP Export/Special Orders/`, re-exported the same day after the first
   export proved to be an 18-month-stale copy — check `max(OrderID)` ≈ 9887+
   before trusting any future re-export), fifteen screenshots, four real
   generated PDFs for order 9885, and three real inquiry emails.
   The decisions in one line each: full migration (two ERAS — items in
   ␝-separated 20-slot repeating fields before Aug 2021, real OrderItems rows
   after; payments as rows only since Mar 2022, `Spent_c` synthesized into one
   legacy payment where no rows exist); FMP's one `Order_Type` field splits
   into **`kind`** (order | template | standing_order) × **`status`**
   (lead → quote → invoice → order, + cancelled); money DERIVED from lines +
   stored inputs, never stored totals; Square invoicing stays MANUAL in v1
   with `external_ref` seams for Square/QBO later (Mark, 2026-08-16); to-do is
   a manual field the app may hint at but never writes; items are editable
   COPIES of production items and **`Misc*` lines never reach the kitchen**;
   scheduling production inserts a real `production_schedules` row through
   040's `source='special_order'` seam (schedule line `item_id` stays NOT
   NULL — a schedulable line must link a production item, the custom name
   riding the snapshot columns); RLS is **supervisor+ on every verb including
   SELECT, customers too** (PII, 020's reasoning); inquiry emails (Square web
   form → specialorders@donutfriend.com) parse via a `parse-inquiry` Claude
   edge function as a PROPOSAL; outbound mail sends as specialorders@ through
   a second org-level provider config and threads by
   `In-Reply-To`/`References` (the stored `Email_Token` was the inbound
   SUBJECT — a threading kludge, retired); **standing orders (= wholesale,
   e.g. Cafe Knotted 370 M–Th / 700 F–Su, billed weekly in arrears)
   MATERIALIZE THEMSELVES on a 14-day rolling horizon** — no cron and no
   manual Instantiate (Mark forgot it in FMP): a definer
   `ensure_standing_orders_materialized` is called from the list AND from
   production generation, idempotent on `unique (standing_order_id,
   event_date)` where a CANCELLED day still blocks re-creation (cancel,
   never delete, or the donuts get ordered again), and the migration
   materializes NOTHING; pics + documents merge into one attachments
   card on a new `special-order-attachments` bucket; **the customer approves
   a quote on a public tokenized page** (`/q/{token}`, proxy-exempt like
   `/welcome`; typed-name clickwrap; the token is minted at SEND time bound
   to the exact PDF sent, spent by approval, superseded by a re-send; two
   definer RPCs deliberately granted `anon` and nothing else reachable —
   print/sign/scan survives as the manual lane); **the front door is OUR OWN
   public `/inquiry` form** (Mark, 2026-08-16 — the Square web form and its
   email layer retire; submission creates a Lead directly via a third
   deliberate anon-granted definer that never reveals whether an email is a
   known customer, and the confirmation email from specialorders@ becomes
   the thread root), with an optional **build-your-box picker** over
   production items curated by a new `show_on_inquiry_form` flag (default
   FALSE — opt-in, the catalog holds Scrap), picked lines landing as real
   order lines on the lead, totals labelled ESTIMATE, the free-text
   description always beside it, email paste-and-parse kept as the fallback
   lane; the list carries a DERIVED **needs-attention tier** (each order
   names its reason in words; the manual todo overrides on display; nothing
   stored); weekly **wholesale statements** are a one-tap rendering command
   on the customer record (Cafe Knotted is billed weekly in arrears today,
   by hand); the **rush fee suggests itself** inside the two-business-day
   cutoff (receiving's `→` idiom, never auto-written — only 795 of 5,198 v1
   orders ever carried one); **approve-and-pay via the Square API is the
   named first post-v1 feature** and nothing in v1 may make it harder;
   numbering seeds at
   10000 (FMP max 9887; `legacy_id` is NOT unique — 5 duplicated OrderIDs);
   customers migrate WITHOUT the plain-text CC fields, ever.
4h. ✅ **THE SUPERVISOR SHIFT REPORT — migrations 070, 071, 072, all APPLIED,
   and WALKED against the real database 2026-08-28/29.** Mark: "It's time.
   Everything we need is in place (except for checklists)."
   The last daily routine still running in FileMaker. A supervisor opens a
   full-screen, tablet-first report at the end of a shift, walks the pages that
   shift is asked for, generates and prints tomorrow's kitchen paper on the way,
   and sends: **management gets the version WITH staff ratings, supervisors the
   one without.** 035 predicted this screen in as many words — it deferred the
   ratings writer to "the PRODUCTION module's screen", and this is it. Of the
   43,918 `kind='shift'` rows, not one had been written by this app.
   **THE TWO ANSWERS THAT SHAPE EVERYTHING: write-through, and nothing reaches
   the owning tables until Send.** No permanent second copy of any fact —
   ratings become `employee_events`, counts become `production_schedule_items`
   actuals, yields become `production_batches`, sales are READ and never
   stored. But the report is revisable until submitted, so the three child
   tables (`shift_report_ratings` / `_counts` / `_batches`) are the DRAFT and
   `submit_shift_report` is the one act that flushes them. **The draft is
   PERSISTED**, not held in a browser: pause-and-resume is one of the three
   commands Mark specified and a dropped iPad at 9pm must not cost a shift.
   After the flush each draft row keeps a pointer to the row it created, which
   makes it a transcript rather than a duplicate.
   **PAGES ARE DERIVED FROM THE SHIFT**, and the two production pages are
   MIRRORS that never both appear (Mark, 2026-08-28, correcting his own earlier
   note): the OPENING supervisor records what the overnight bake produced
   (Elements made), the CLOSER records what was left of it (Premades) plus
   sales and tomorrow's paper. Seven pages closing, five opening, **four for mid
   and off-site** — an off-site shift has no kitchen for a batch log to be
   about, which is 317 of FMP's 13,059 reports and a known accepted cost.
   `pagesForShift` returns the list and the runner numbers what it is given, so
   an opening report reads "PAGE 3 OF 5" rather than skipping.
   **THE SHIFT REPORT NEVER WRITES A SALES NUMBER ANYWHERE.** (This paragraph
   used to open "SALES ARE NOT INCOMPLETE AT 9PM — THEY ARE ABSENT, and that is
   better", because `SyncFromSquare` stopped at yesterday so there was no
   `daily_sales` row for today at all. **Mark reversed that on 2026-08-31** —
   see "PARTIAL DAYS ARE LOADED AND MARKED" below — so today's row now usually
   exists. Nothing here changes: the report still reads rather than writes, and
   still says which figure it is showing.) Square's reporting day runs 1:00 AM
   to 12:59 AM PT. `sync-square-sales` gained a **`preview: true` mode**
   that returns the window's rows without calling `record_daily_sales`, and its
   role check is now mode-dependent — owner/admin to WRITE, supervisor+ to
   PREVIEW, because reading a figure off the register in front of you is not the
   act that feeds `tip_pools`. Verified live: $1,364.08 returned and **zero rows
   written to `daily_sales` or `tip_pools`**. The email carries the provisional
   figure marked provisional and keeps what it quoted in `email_receipt`; the
   record screen renders the SETTLED figure once the sync catches up and says
   which it is showing (`foodHandlerExpiry`'s rule). Consequence:
   `Task_SalesData_isComplete_b` has NO counterpart — Square types it now, so
   there is no act to complete.
   **SPECIAL ORDERS AND PRODUCTION SCHEDULES ARE ONE PAGE.** They stopped being
   two tasks on 2026-08-27 when `GenerateSchedules` grew the special-order pull;
   `fetchPacketData` calls `companionScheduleIds` itself, so printing a plan
   schedule already expands to include that night's special-order schedules.
   FileMaker split them because FileMaker's generation did not pull. TWO task
   flags survive, not one: a per-order kitchen document and the tray-guide
   packet are different paper and the submit page must say which is missing.
   **SENT AND EMAILED ARE TWO FACTS** (`sent_at` vs `emailed_at`), and keeping
   them one column was a real hole caught in review: the flush could succeed,
   the mail fail, and the report read "sent" with nobody told — while
   `submit_shift_report` refuses to run twice, so there was no way back. A row
   with one and not the other shows on the list as "Sent, but not emailed" with
   a Resend.
   **THE EMAIL'S PRIVACY BOUNDARY IS STRUCTURAL, NOT TESTED.**
   `managementBody = supervisorBody + ratingsSection`, so ratings can reach the
   supervisor version only if somebody deliberately MOVES that section, never by
   forgetting — `gustoExport`'s discipline. The fixture (asserted against the
   produced STRING) is a second line of defence. **Both bodies are composed in
   the BROWSER and posted** to `send-shift-report`: `_shared` cannot import from
   `web/`, so composing in Deno would be a second implementation of the one rule
   that must never drift. `_shared/email.ts` gained an optional **`html`** field
   (multipart/alternative, text part FIRST so a client picks the last it can
   render) — optional and unset by every existing caller, the shape `messageId`
   was added in. Verified by building the MIME in Node: both parts round-trip
   byte-for-byte and the subject survives RFC 2047 chunking.
   **`shift_report_ratings` HAS ITS OWN SELECT POLICY** — owner/admin OR the
   report's author, never plain supervisor+. The two emails encode that boundary
   and a table readable by every supervisor would undo it in one click.
   **Migration 072 — REOPEN**, asked for within an hour of the first real send.
   It is NOT a status flip: `submit_shift_report` INSERTS `employee_events`
   (there is no natural key — a person can be rated twice in a day by two
   shifts), so flipping `status` and letting somebody Send again produces a
   SECOND rating for the same person on the same day, silently. Reopening undoes
   the flush and leaves the DRAFT alone. **It refuses to destroy two things**,
   both named in its receipt: a count somebody has recorded SINCE (the revert is
   conditional on the line still holding what the flush put there — proved on
   the harness with a line recounted to 30/1), and a premium inside a CLOSED pay
   period. Owner/admin only; the three `task_*` flags stay, because paper that
   came out of a printer did not go back in.
   **Migration 071 — the break TIME.** FMP asked when, and that is the more
   useful half: California's rule is about TIMING, so "they got a break" and "at
   4:45pm off a 10am start" are different facts and only the second shows a late
   meal. A `time`, nullable even when the box is ticked. **Deliberately NOT
   wired into the premium** — whether a late meal owes one is `lib/breakRules`'
   judgement over the punches, and the punches are not imported until the pay
   period ends.
   **THE ROSTER IS TYPED, and that is forced.** `timesheets` would be the
   natural source and is unusable: punches are not imported until after the pay
   period ends, so at 9pm tonight's own shift is not in the table (Mark,
   2026-08-28). Names come from **`special_order_takers`** (053) and positions
   from a distinct sweep of `employees.position` — `employees` READ is
   owner/admin (020), so a supervisor cannot learn a colleague's name any other
   way. That trap bit twice in test SCRIPTS during the walk: a seed joining
   `employees` inside an impersonated block inserted ZERO rows and reported
   success.
   Screens: `/shift-reports` (list, attention tier, create dialog),
   `/shift-reports/[id]` (the READ-ONLY record — the archive, and the reason
   declining the migration is safe: without it the only way to read last Tuesday
   is to find the email), and `/shift-reports/[id]/run` in a new
   **`(fullscreen)` route group** — the app's FIRST chrome-less route that is
   also signed in, its layout calling `getAppSession()` itself and keeping only
   `ConfirmProvider` and `CalcPad`. No `proxy.ts` change: anything not
   explicitly exempted there is already auth-gated.
   **The attention tier is what makes it a routine rather than a form** —
   `locations.open_days` (017, first reader ever) says which nights a shop was
   open, so "nobody reported Tuesday" is a FACT. Found 7 real unreported nights
   at DF01 on the first load.
   **NO HISTORY MIGRATES** (Mark's call). FMP's `Operations/ShiftReports.mer` —
   13,059 rows, 2017–2026, 7,334 closing / 5,403 opening / 309 off-site, median
   557 characters of narrative, only 43 empty — stays on disk. It was still READ:
   the six `Task_*_isComplete_b` flags and the shift vocabulary come from it.
   **Only three task flags survive**: `narrative` being non-empty answers
   `Task_Log`, Square answers `Task_SalesData`, and `task_checklist_done` is NOT
   created — a column for an unbuilt feature is a claim nothing can satisfy.
   **CHECKLISTS ARE STILL OUT**, deliberately and by Mark's scoping.
   **What the live walk found that nothing else could** (all fixed): pressing
   "Start the report" DID NOT NAVIGATE, because `router.refresh()` raced
   `router.push()` across a route-group boundary — `NewPlan` does the same and
   gets away with it inside `(app)`; the break checkbox had NO VISIBLE LABEL,
   because `ui/Checkbox`'s `label` is the ACCESSIBLE NAME and `children` is the
   visible one (four call sites); missing React keys on the page bodies, which
   cross the server/client boundary in a collection; and the Premades header
   rendering **"LEFTNOTE"**, because a `w-28` on a `th` is a suggestion an
   auto-layout table ignores — both counting tables are `table-fixed` with a
   colgroup now.
   **Mark's own first send exercised the skip path on real data**: he marked
   himself as having missed a break with no reason, and the flush skipped the
   premium, NAMED it in the receipt, and sent anyway rather than blocking the
   report over one incomplete row.
   **A `→` ON THE PREMADES PAGE TAKES THE PAR** (receiving's idiom, and its
   reason: the usual answer is "we made what we were asked to"). An arrow rather
   than a prefilled box — a box that filled itself would make merely OPENING the
   page look like somebody had counted. It hides once they agree.
   **The rows are in the PRINTED SHEET's order**, not the schedule's `sort`:
   whoever is counting is holding that sheet and reading down it.
   `compareForPremadeSheet` is exported from `lib/productionSchedule` and
   `rollUp` shares it rather than keeping a second copy.
   **The generate dialog lost its shop list and all its commentary** (Mark,
   2026-08-28: "we should be able to schedule anything that will be made at the
   current working location. We don't care where it's sold"). `selected` still
   carries every eligible shop to the RPC — `p_location_ids` is how the function
   is addressed — it is just no longer a thing anybody is asked about.
   "Print packet…" is **"Print All Documents"**; the packet parts lost their
   hints and three were renamed to the kitchen's words rather than the schema's:
   **Production Items Sheet, AB Items, Weekly Production**. Whichever button is
   next is BLACK and never both — generate when the night has no schedule, print
   once it has one.
   **A SPECIAL ORDER'S PREMADE SHEET IS TITLED BY THE ORDER**:
   `SPECIAL ORDER #9761` over `Wedding 8/29/2026`. `premadeSheetTitle` splits
   the stored title with `splitScheduleTitle`, the INVERSE of `scheduleTitle`
   and living beside it — a fixture runs a title through the composer and back,
   so the paper and the screen cannot spell one document two ways. The FILENAME
   follows the heading. Verified by capturing the blob, inflating the content
   stream and decoding the hex text runs.
   **`(fullscreen)` and `ui/PickList size="lg"`**: the runner is tablet-first —
   44px targets, `text-[16px]` (below which iOS Safari zooms on focus), which
   needed a real `size` prop rather than a `className` override, because
   Tailwind resolves competing utilities by STYLESHEET order.
   **1355 fixtures pass**, each rule checked by breaking it.
   **Still owed:** nobody holds `purchaser` or `supervisor` as an APP ROLE yet,
   so the no-ratings version currently reaches NOBODY. Inviting the 8 real
   supervisors is what fills it. And what the email LOOKS LIKE when it lands is
   the one leg no probe can settle.

4i. ✅ **WHICH SHOPS A MEMBER MAY WORK AT — migration 073, APPLIED and
   verified live 2026-08-29.** Mark: "in my FMP version of the app, I could give
   users I granted access to the app to a permission setting, a default
   location, and set which locations they had access to in the app."
   001 predicted `location_members` BY NAME and this file carried it as an open
   thread from 2026-08-01, with a note to settle one question first. That
   question is now answered.
   **IT IS "MAY WORK AT", NOT "MAY SEE"** (Mark's choice). It restricts which
   shops you can SWITCH to — the masthead picker and the Locations list's Work
   here — and therefore which shop's guide, POs, receiving and shift reports you
   meet, because all of those follow the working location. It is **NOT a data
   boundary**: DF02's rows stay readable to a DF01 member who goes looking, and
   `/special-orders`, `/customers`, `/employees`, `/events` and `/sales` are all
   deliberately ORG-WIDE. Making it a security rule means every location-scoped
   policy in the schema AND rethinking those screens — a different and much
   larger decision, and this table is what it would read.
   **NO ROWS MEANS EVERY LOCATION.** The single most important rule here: an
   empty table is what exists the moment the migration runs, so reading it as
   "no shops" would log the company out of everywhere at once. It is per-MEMBER,
   not table-wide — proved live, where restricting one account left the other
   two unrestricted. `ui/PickSet` happens to have exactly those semantics, so
   the control says "All shops" without being taught to.
   **NO DEFAULT LOCATION COLUMN** (Mark: "it's redundant — we can get that from
   the location already assigned to them"). `employees.main_location_id` is that
   assignment and `last_active_location_id` carries every session after it; a
   third column would be a second answer to a question that has one.
   **`set_my_member_profile` NOW REFUSES a shop you may not work at.** Without
   it the grid would be advisory — the picker hiding a shop while a hand-rolled
   POST still switched to it. 002's body is reproduced whole (055's rule) and
   gains one check.
   **THE HARNESS FOUND A REAL BUG.** `may_work_at(p_org, p_user, p_location)`
   took `p_user` but the owner/admin exemption used `user_has_role`, which is
   hardcoded to `auth.uid()` — so asking "may Karina work at DF02?" answered
   with the CALLER's role, and the shift report's recipient query asks exactly
   that about every member on the list. It asks about `p_user` now, and returns
   the same answer as superuser and from inside a session.
   **A THIRD SESSION LIST, and picking the wrong one is a silent bug:**
   `locations` to LOOK UP a code, `activeLocations` to ENUMERATE shops (**never**
   narrowed by the grid — an item's per-location rows must not vanish for a
   restricted member), `workableLocations` to offer a SWITCH.
   Screens: the grid is on the employee record's **Admin tab as "Works at"**,
   beside Role, because the two together are what app access means. Owner/admin
   show as unrestricted rather than being offered a choice the database would
   ignore. `WorkingHere` shows NOTHING on a shop you may not work at — the same
   nothing a closed shop shows, since in both the answer is no.
   **The shift report's supervisor email follows the grid** (Mark's answer to
   the shop-scoping question). **Management never is**: a manager sees every
   shop, and Mark's own employee record has no main location, so a scoped rule
   would silently drop the OWNER off DF01's report.

4j. ✅ **A WAY BACK INTO THE APP — migration 074 + `request-password-reset`,
   APPLIED, DEPLOYED and tested 2026-08-29.** `/login` never had a forgot-
   password link. Fine while every account belonged to Mark or Traci; not fine
   the moment eight supervisors have logins, when the first to forget is stuck
   until somebody runs the admin API by hand.
   **`supabase.auth.resetPasswordForEmail` WOULD HAVE BEEN ONE LINE AND IS THE
   WRONG LINE.** It sends through Supabase's own mailer, from a supabase.co
   address, on a handful-per-hour quota — where every other message this app
   sends goes out as the org through `_shared/email.ts`. A password reset is the
   LAST message you want arriving from an address the recipient does not
   recognise.
   **THE ANSWER IS ALWAYS THE SAME** — 052 and 057's rule, and the whole
   security property. Not in the body, not in the status, and **not in the
   timing either**, which is why 074 records attempts against addresses that do
   NOT exist: throttling only the real ones would turn the endpoint into an
   account enumerator, because the unthrottled replies would be the fakes.
   Verified live — known and unknown addresses returned byte-identical
   responses, and the throttle bit on an unknown address on the fourth try.
   **A BANNED ACCOUNT GETS NOTHING**, silently: revoking access bans the auth
   user (4c) rather than deleting it, and access removed is not a password to
   reset.
   074 exists because the endpoint is PUBLIC and spends the org's Gmail quota,
   **which is shared with purchase orders** — the first symptom of abuse would be
   a PO that silently failed to send. Three per address per hour, thirty
   overall. SELECT is owner/admin ("did it actually go out?" is a real support
   question); there are **NO write policies at all**, so the service_role
   function is the only writer (033's `timesheet_benefits` shape). Verified on
   the harness: the owner reads it, a supervisor sees zero rows, and both
   authenticated and anon inserts are refused.
   **`/welcome` takes a THIRD link type.** All three — `invite`, `magiclink`,
   `recovery` — end the same way, but the copy no longer calls a password reset
   an "invitation". Its "nothing is verified on load" property is what let the
   page be checked with a real token without spending it.
   The link reuses the login form's OWN email field rather than opening a dialog
   with a second one, sits BELOW the commit (the way out of a dead end, not a
   second thing to choose between), and is `type="button"` or it would submit
   the form it lives in.
   **Known and not chased:** the reset mail goes out as `info@donutfriend.com`,
   the same mailbox POs use. A `shift_report`-style provider key would move it.

4k. 🚧 **FACILITY CHECKS — checklists, walkthroughs, tasks, maintenance,
   inspections and equipment (migrations 075, 076, 077, 078 — ALL FOUR APPLIED
   2026-08-29/30). *Probe, don't read this line.*** Mark, 2026-08-29: "we kind of need to think of
   checklists, tasks, and maintenance requests as one, interconnected and
   interdependent module."
   **Read `docs/checklists-brief.md` before designing or touching any of it** —
   it carries the decisions, the traps and the probes — and
   **`docs/checklists-handoff.md` for what is still OUTSTANDING**.
   **BOTH OF THOSE ARE FIXED 2026-08-30, and NO MIGRATION WAS NEEDED** —
   everything below was already permitted by 076's and 077's policies.
   **THE EMAIL CARRIES THE CHECKLIST.** `checklistSection` in
   `lib/shiftReports`, called from `supervisorBody`, so management gets it
   through `managementBody`'s identity and can get it no other way — the
   existing composition fixture is what enforces that placement, and needed no
   edit. **A CLEAN NIGHT SAYS SO** rather than going quiet: silence is reserved
   for the one case where no list is linked AND none was asked for, so an
   un-adopted shop's email is byte-identical to before. If the section vanished
   on a clean night nobody could tell CLEAN from NOBODY WALKED from THE FEATURE
   BROKE, and once absence is routine the loud not-started case stops being
   loud. **`position` (078) IS DELIBERATELY NOT CARRIED** into `EmailReport`:
   it draws on the same vocabulary as `shift_report_ratings.position`
   ("Sr. DF"), so it would trip the privacy sweep for a reason that has nothing
   to do with a person.
   **"REOPEN" NO LONGER LIES**: the link reads **View** once submitted and an
   owner/admin **Reopen** stands beside it (Mark's call over the rename). A
   PLAIN UPDATE, not an RPC — 072's `reopen_shift_report` is a definer *because
   submitting flushed rows into other tables*, and a checklist run flushes
   nothing. Do not "fix" it into an RPC.
   **THREE BUGS THE HANDOFF DID NOT KNOW ABOUT, all found by pressing the
   buttons, all fixed.** The first is the one that mattered:
   **A WALK WITH AN UNSECTIONED ITEM SNAPSHOTTED NO ITEMS AT ALL.**
   `checklist_run_items.sort` is `numeric(8, 2)` — 999999.99 — and both snapshot
   callers inlined `(sectionOrder.get(id) ?? 9999) * 1000 + sort`, which is
   9,999,010. The insert failed, the RUN had already been created, and you got
   an empty checklist with an error in a dialog. Invisible on DF01's real lists,
   where every item has a section; certain on the first template anybody types
   in a hurry. Now ONE clamped `runItemSort` in `lib/checklists` used by both,
   pinned by a fixture that goes red the moment the sentinel is put back.
   Then: **`loadChecklistRun` fetched `facility_photos` ORG-WIDE and
   unpaginated**, so on the day the org filed its thousandth photo a walk's own
   pictures would have started disappearing with no error (PostgREST's silent
   1,000-row cap); and **`/inspection-logs`' `already_run_today` compared a RUN
   id to a TEMPLATE id**, so it was always false. Both list screens also swept
   every run item in the org on each page load; all three are scoped now.
   **ALSO SHIPPED**: task photos (`facility_photos.task_id` had no writer, and
   its DELETE is the first caller `WRITE_ORDER_NOTE`'s row-then-object order has
   ever had anywhere in the app); the **checklist PDF**; `choice` FINISHED — the
   type picker routes to a dialog writing `response_type` and `choices` in ONE
   statement, since 076 refuses a choice with no options, and the editor is in
   the ROW MENU as well as the Expected cell because that column is
   `hideWhenCompact` at 1440 and so is absent on a 1280 laptop; the three
   transcribed typos corrected in the live rows AND the loader; and "walk"
   removed from the visible strings it had survived in.
   **"WALK" IS GONE AS A NOUN, EVERYWHERE** (Mark, 2026-08-30, after asking for
   a sweep): a full pass over the module — checklists, TASKS, equipment and the
   shift report's checklist page, two independent passes so an apostrophe
   swallowing a line in one could not hide it from both — found FIFTEEN
   user-facing uses, and **four of them were on the Tasks screens**, which the
   first sweep never opened. The twelve NOUNS are now "checklist"; the three
   VERBS stay, because "what a supervisor walks at the end of a shift" is
   ordinary English rather than a coined record type. `ChecklistWalk` gained a
   `noun` prop for the two it needed, threaded from `WalkRunner`, which already
   derives it from the run's snapshotted kind — so an inspection log does not
   call itself a checklist. Component names, `canWalkChecklists` and the
   `?view=walks` key are untouched and invisible; "Walkthrough" is the kind's
   own label and "walk-in" is a fridge.
   **THE CREATE COMMAND SITS IN THE LIST'S OWN CONTROL ROW, RIGHT-ALIGNED**
   (Mark, 2026-09-03), which REVERSES his 2026-08-30 call that it belonged
   beside the title — that one was against a `justify-end` row of its own ABOVE
   the filters, where a create command really did read as one more filter, and
   this is a different placement: the LAST cell of the row the search box and
   the tabs are already in, pushed to the page's right edge (measured, 1232 at
   a 1280 window, the same edge as the columns eye below it). All five —
   Start a walk, New template, New task, New maintenance request, New
   inspection log, New equipment — and the title rows are now a bare `h1`.
   **`action?: ReactNode` IS THE SLOT**, on `ChecklistsList`,
   `ChecklistTemplatesList`, `EquipmentList` and `TasksScreen`: a NODE rather
   than a flag, because only the page knows which command a list is for and
   what to hand it, and the button is a client component the server page can
   pass down as an element.
   **The search box had to stop growing for it to work.** Three of those rows
   put the search in a `min-w-[16rem] flex-1` wrapper, which eats every spare
   pixel — so `ml-auto` on the command gets nothing and it lands next to the
   tabs rather than at the edge. `w-72` on the input, the app's usual search
   width, which is also what left-aligned the tab pickers Mark asked about
   separately the same day.
   **`/production-items` AND `/recipes` GAINED A CREATE COMMAND** (Mark,
   2026-09-03) — `NewProductionItem` and `NewRecipe`, `NewElement`'s template.
   Two things worth knowing.
   **The item's duplicate check WARNS and never blocks**, which is 038's own
   reasoning: it dropped `unique (org, name)` because "Angry Samoa" is four
   different donuts, and DECLINED to replace it with a composite index on
   (name, size, type, subtype) because those are four separate `InlineValue`
   cells — changing a Regular to a Mini when that Mini exists would fail on the
   first edit with no order that works. So the create says so and lets you
   through, `findPossibleRehires`' treatment.
   **A RECIPE IS TWO ROWS, and the second is not optional**: every reader here
   goes through the MASTER version — costing, the printed sheet, the Costs
   matrix, the record's default tab — so the create writes v01 and marks it
   master in the same act. 036's partial unique index is what makes that safe.
   If the version write fails the recipe still EXISTS, so it says what happened
   and lands on it rather than reporting a failure over a real record.
   **`version_label` IS STORED BARE — "01", never "v01".** Every reader
   prefixes it (`v{version_label}` in `RecipeVersions`, `RecipeInfo`,
   `RecipesList` and `BatchRecipe`), so a stored "v01" renders "vv01". Caught by
   creating one and looking at it, not by reading.
   **PRODUCTION KEEPS ITS COMMANDS BESIDE THE TITLE and BOTTOM-ALIGNS them**
   (Mark, 2026-09-03, having asked for the same move and then undone it: "just
   bottom right align the existing buttons"). `items-end` on the title row, so
   the button sits level with the LAST line of the title block rather than the
   first — which is what looked wrong once each of those titles gained a
   description under it. It is the cheaper answer to the same complaint, and it
   leaves the Facilities pattern as the exception rather than the rule.
   **FLAGGING AN ISSUE BY HAND WAS IMPOSSIBLE** (Mark, 2026-08-30, walking a
   real list: "I get a message 'Say what is wrong before flagging it' but I see
   no way to add a note"). A deadlock, and on the module's central act:
   `needsNote` gated the note box on `row.status` ALREADY being `issue` or
   `na`, while `setStatus` refused to SET either without a note — so on any row
   that did not already carry one there was nothing to type in. The only issues
   that could exist were the ones an out-of-range reading raises for itself,
   which write their own note; **which is exactly why the verification walk
   sailed past it** — it flagged by typing 46 °F, the one path that works.
   **THE BUTTON NOW ARMS THE ROW AND THE NOTE COMMITS IT.** Pressing Issue or
   N/A opens the box focused (`autoFocus` fires because the box MOUNTS at that
   moment, and `arming` is null on page load so a row carrying an old note never
   steals focus), shows the button as pressed — it was, and looking inert is what
   the refusal already felt like — and writes status and note in ONE statement on
   blur or ⌘↵. Both columns together is the constraint that started this: 076
   refuses either state with no note, and a raw 23514 is the one refusal an
   inline control cannot explain. **Blurring with an EMPTY box cancels silently**,
   because nothing was written and changing your mind is not an error; clearing
   the note on a row that IS flagged still refuses and reverts, which is the
   other case and a real one. N/A asks "Why not?" where Issue asks "What is
   wrong?".

   **THE TIER PICKER IS All - Done - Remaining - Issues** (Mark's order,
   2026-08-30) — the whole list, what is behind you, what is in front of you,
   then what needs somebody, widest to narrowest, with the two you move between
   while walking side by side. **`Done` MEANS ANSWERED, not the `done` STATUS**:
   that is `progressLabel`'s own definition and its count sits on the SAME ROW
   ("13 of 70 done"), so two numbers a hand's breadth apart cannot disagree
   about one word. It also makes the tiers reconcile — Done + Remaining is
   exactly All, Issues a subset of Done — where the strict reading would strand
   every `na` item in no tier but All.
   **A FLAGGED ISSUE IS NOT OUTSTANDING** (Mark, 2026-08-30: "if everything is
   either marked done or flagged, then there aren't any outstanding issues. The
   box says items flagged are outstanding issues and I disagree"). He is right,
   and it goes to the module's posture: a checklist's job is to FIND what is
   wrong, not to fix it, so an item looked at, found broken and written up is as
   answered as an item gets — and telling its author they have not finished
   tells somebody who did the job properly that they didn't. `checklistReadiness`
   no longer counts them; the confirm states them as INFORMATION beside the
   caveats ("1 issue is flagged, and it goes in the report"), which is
   `salesNote`'s rule in this same codebase. **A flagged item still wants its
   PHOTO** if one was asked for — that is a separate obligation, evidence
   somebody asked for and did not get, and only the issue stopped being a caveat.
   **FINISH IS BLACK ONLY ONCE NOTHING IS OUTSTANDING, AND IS NEVER GATED ON IT.**
   Mark asked whether it should only work at Remaining 0 and was talked out of
   it: `checklistReadiness` is built on `closeReadiness`'s posture and says why
   in its own words — gate finishing on a complete set and the night the walk-in
   floods is a report that never gets sent. Gating would also tax every
   legitimately unanswerable item with an N/A *and a note* before anybody could
   submit, and leave a supervisor at 68 of 70 unable to record the two issues
   they did find. So the WEIGHT carries the message instead: ordinary while
   anything is unlooked-at, filled once it is the obvious last act —
   `PRIMARY_BUTTON_CLASS`'s own "only ever right CONDITIONALLY" rule, the same
   shape as /timesheets filling Import while the pay period is empty.

   **THE WALK OPENS ON `All`** (Mark, 2026-08-30), not on Remaining. A list that
   hides the items you have already answered reads as a shorter list than the
   one you are holding, and on a 70-item closing routine the rows moving out
   from under you as you tick is what loses your place. The other three tiers
   are for looking something up; the walk itself is the whole list in the shop's
   own order.
   **YOU COULD NOT FINISH A CHECKLIST FROM INSIDE THE SHIFT REPORT** (Mark,
   2026-08-30). `WalkRunner`'s footer owned the button and `ChecklistPage`
   mounts only `ChecklistWalk`, the body — so from the report you could answer
   every item and the run stayed `open`, the submit page went on saying "the
   checklist is answered but has not been finished", and the only way out was an
   "Open it full screen" link, finishing there, and coming back to a report you
   had left. **The act is `components/checklists/FinishChecklist` now** and both
   surfaces call it — extracted rather than copied, because it carries a
   confirm, a readiness list, a findings sentence and a row-count check, two of
   which have been got wrong once each already. **What it does NOT own is where
   you go afterwards**: the full-screen runner LEAVES on success (finishing is
   the end of that task) while the embedded one must not navigate at all, hence
   `onFinished`. **"Open it full screen" is GONE** (Mark, same day) — with
   Finish here it was the one control on the page that threw away where you
   were. The embedded button is ORDINARY, not filled: this report's single
   outcome is Send on its submit page, and finishing the checklist is a step on
   the way.
   Page 7 of the shift report is **"Tomorrow's production"** (was "Tomorrow's
   paper"), and both of its empty states are just **"None."** — a heading that
   already names the shop and the date does not need a sentence repeating them.

   **THE RUNNER'S FOOTER IS WHITE AND ITS COMMIT IS BLACK** (Mark, 2026-08-30).
   It was a black bar with the colours inverted — a white Finish on black —
   which said the right thing backwards and made this the one screen in the app
   where the important button is the pale one. It now matches the RECEIVING
   SCREEN, which is its closest sibling: `Close` beside a black commit, an
   escape beside a commit rather than a row of peers, which is the panel-commit
   exception applied to a screen that behaves like a panel because a run
   produces ONE outcome.
   **THE TOP RULE IS NOT OPTIONAL** — Mark asked whether it needed one, and the
   app had already answered twice: `SpecialOrdersList`'s pinned legend draws a
   `border-t border-hairline` for the stated reason that "without a top rule the
   rows scroll up into an unmarked white band", and `ui/StickyFooter` deliberately
   contributes position and a white backdrop and NOTHING ELSE, leaving the frame
   to the caller. On a black bar the band separated itself; on a white one
   nothing does.
   Both buttons are ONE BOX — same border, same 56px height, only the fill
   differs (`WorkingHere`'s rule) — and the sizing is the runner's own rather
   than `BUTTON_CLASS`/`PRIMARY_BUTTON_CLASS`, whose colours and hover
   inversions they borrow: those are `h-9` at 12px, the DESK metrics, and this
   screen is tablet-first where 36px is under the 44px a thumb wants.

   **AND THE TASKS DIALOGS' TEXTAREAS WERE GREY** where every field beside them
   was black (Mark, 2026-08-30: "most fields have black borders, details is
   grey"). `NewTask` and `ResolveTask` were the only two form textareas in the
   app dressed in `border-hairline` — `NewPurchaseRequest`, `RequestActions`,
   `ProcessPo`, `SendDocument` and `InquiryForm` all use `border-ink`, which is
   also what `TextInput` and `PickList variant="field"` sit at. A grey box next
   to a black one reads as a disabled field. (The runner's and the shift
   report's inputs keep `border-hairline hover:border-ink` — that is the
   tablet-first dense dress, a different surface.)
   **PICKING A PIECE OF EQUIPMENT FILLS IN WHERE IT STANDS** (Mark, same day).
   `NewTask` takes `shop_section_id` on its equipment options now and fills the
   Where field from it — but only when that field is EMPTY or holds a value the
   dialog itself put there, tracked by `sectionWasFilled`. A section somebody
   chose is never overwritten, while changing equipment does move one that was
   autofilled; clearing the equipment leaves the section alone, since "where" is
   still true of the job once it stops being about a particular machine.
   `createSpecialOrder`'s seed-once-never-slave shape. Verified against Mark's
   own equipment: Coffee Grinder → FOH, changing to 20 QT Mixer → Kitchen, then
   Office chosen by hand → survives a change to Espresso Machine.
   **@react-pdf's BUNDLED HELVETICA IS WinAnsi AND EMITS NOTHING FOR A CHARACTER
   IT CANNOT PLACE** — no box, no question mark. `expected 34–40 °F` printed as
   **"expected 3440 °F"**, which does not lose the range, it replaces it with a
   different number, on the page you hand a health inspector. The same trap cost
   the recipe sheet its `≥` once already. `ChecklistPdf` has a `pdfText()`
   sanitizer while `readingLabel` keeps its en dash for the screen and the email.
   **Verify a PDF by inflating its content stream, never by looking at it.**
   **1,436 fixtures pass**, and the whole module was WALKED against the live
   database 2026-08-30 and left as found (0 runs, 0 tasks, 0 photos): a
   walkthrough scored, an out-of-range reading raising its own issue, a task
   raised from it and appearing in the carried-over band of that night's
   CLOSING checklist, a photo attached and removed, the PDF's text runs decoded,
   Reopen clearing `submitted_at` with every answer intact, and the real email
   rendered over live rows in Node — HTML and `toText` both.
   **DF01 Manager Walkthrough IS LEFT ON THE LIVE DATABASE and its three items
   are PLACEHOLDERS** invented for that test. It is never offered automatically
   (`weekdays` null), so it is harmless — replace the items before treating it
   as a real list.
   FMP's closing routine had a piece the app didn't: a list the supervisor
   walks at the end of a shift, grouped by shop section, ticked off,
   photographed, with anything wrong flagged into the emailed report. It was
   scoped out of the shift report on 2026-08-28 and four nav stubs were waiting
   for it.
   **THEY ARE ONE MACHINE — observation → finding → work → verification.** A
   checklist run, a manager's WALKTHROUGH and an INSPECTION LOG are all
   observations (one template/run family, told apart by `kind`); a TASK and a
   MAINTENANCE REQUEST are the same work at two levels of escalation (one
   table, one `kind`). 035's merge precedent in Mark's own words — "Events
   already had different types, what's one more" — and 051's `kind` column. Six
   nav entries over two spines.
   **CHECKLISTS MOVED FROM OPERATIONS TO THE LOCATION SECTION** (Mark: "I sort
   of feel I misplaced the location of checklists in the menu"). The nav is
   organised by THE WORK and every one of these is about the BUILDING — the
   same argument that put purchase requests under Purchasing. The Operations
   stubs "Check Lists" and "Master Check Lists" are gone; the Location section
   is Locations · Shop Sections · Checklists · Tasks · Maintenance · Inspection
   Logs · Equipment, and all of it sits INSIDE `InactiveLocationGate` (unlike
   `/employees` and `/sales`, these really are location-scoped: you do not walk
   a closing list at a shop that is shut).
   **THE WALKS AND THE MASTER LISTS SHARE ONE SCREEN** (Mark, 2026-08-30:
   "instead of having a checklist and master checklist menu options, what about
   just having a Checklist screen with tab picker … Basically combine the two
   screens into one"). They shipped as two adjacent nav entries the day before,
   which made you decide which one you wanted before you could look at either —
   and they are the same subject at two moments. `/events` is the precedent for
   the mechanism: a `TabPicker` over two populations fetched under different
   rules and rendered with different columns. **Only the LISTS merge** — both
   records keep their own address, `/checklist-templates` (the list) is a
   redirect shim (`/location`'s pattern, since that address is in the record's
   own breadcrumb), and the nav entry carries **`also: ["/checklist-templates"]`**
   so the shim AND the still-live record route both light the tab
   (`/timesheets`' idiom for `/pay-periods`). The view is a REAL NAVIGATION
   rather than `history.replaceState`, because the two halves are different
   QUERIES and the server has to run the other one — `/events`' own split — and
   the default writes no parameter so `/checklists` stays canonical.
   **A RUN SNAPSHOTS ITS TEMPLATE** — 013's rule, and the most important thing
   here. Without it, rewording an item in September silently rewrites what
   August's supervisor is recorded as having been asked to check. The SECTION
   NAME is snapshotted as text beside the id, so a shelf renamed or deleted next
   month cannot rewrite or blank last month's walk.
   **A CHECK IS FOUR STATES** — pending / done / issue / n/a, the order guide's
   three-state lesson widened by one. Pressing the state an item is already in
   returns it to pending, which is the only undo.
   **AN ITEM CAN ASK FOR A NUMBER, AND AN OUT-OF-RANGE READING RAISES THE ISSUE
   BY ITSELF** (Mark: "having the supervisors enter fridge temperatures would be
   pretty awesome"). That is the one place this module lets the app decide
   anything, and the line is worth keeping: **the app must never decide what
   counts as dirty, and it can absolutely decide what counts as above 40°F.** It
   writes a note naming the value, because 076 refuses an issue with no note and
   the constraint should be met by a true sentence rather than an empty string.
   **EQUIPMENT IS THE MISSING NOUN.** Without it a task says "the fryer" as a
   STRING and nothing can aggregate — no repair history, no per-unit trend, no
   cost per asset. With it, a reading belongs to THAT walk-in and "this one has
   crept 36 → 39 over six weeks" is a failing compressor visible before it
   fails. `warranty_ends_on` reuses 034's expiry vocabulary whole, null meaning
   "does not lapse". `vendor_invoice_id` is the money seam and has no reader.
   **THE SHIFT-REPORT LINK IS AN FK, NEVER A (location, date, shift) TUPLE.**
   070 declined a unique constraint on that tuple because a HANDOVER
   legitimately produces two closing reports for one night — so the tuple does
   not identify a report and a join on it would attach a walk to the wrong one.
   **THE BUSINESS DATE IS THE MODULE'S HIGHEST-RISK BUG.** A closing walk
   finished at 1:15am belongs to YESTERDAY, and `current_date` is UTC, so after
   4pm Pacific it is already tomorrow. `businessDateFor` in `lib/checklists` is
   the one rule, derived in the org's timezone and passed in; nothing in
   075–077 calls `current_date`. Closing only, 5am cutoff, editable.
   **THE CARRY-FORWARD HAD TO GET LOUDER.** Mark's best idea here — a manager
   flags the dirty fryer on a walkthrough and it appears on every subsequent
   supervisor's checklist until it is done — has one failure mode, and
   `lib/facilityTasks` is aimed at it: a task appearing IDENTICALLY for thirty
   nights is one people learn to scroll past, which trains them to skim the
   section that also holds tonight's real work. So a task is its OWN RECORD with
   one identity and one close (never a row copied onto thirty nights), it AGES
   visibly, somebody other than tonight's supervisor can close it or promote it
   to maintenance so it LEAVES the nightly list, and after a week
   `staleTaskBanner` surfaces it where a manager reads.
   **CANCELLING NEEDS A REASON AND FINISHING DOES NOT** — 032's shape, the
   requirement riding the DECISION. There is NO delete policy on
   `location_tasks`: cancelling is the eraser (059's rule), so a `delete` from
   the app removes 0 rows and returns NO error and the screen must never offer
   one.
   **SCORING IS PER ITEM** (Mark's call over per-section) with three mitigations
   against the measured all-fives hazard — 89% of FMP's 40,793 shift ratings are
   a 5: the score is optional with "not scored" resting, pressing it again
   clears it, and the section roll-up is DERIVED from whatever was scored. A
   section with nothing scored is NULL, never zero — zero is a real score in
   035's range and defaulting to it reports the worst possible verdict on a
   section nobody looked at.
   **`cardinality`, NEVER `array_length(x, 1)`** — caught on the harness by
   asserting a refusal rather than assuming it. `array_length('{}', 1)` returns
   NULL rather than 0, so the predicate is NULL, and **a CHECK CONSTRAINT PASSES
   ON NULL**: the empty array sailed straight through. Written that way first.
   **DEPARTURE, DELIBERATE: there is no `task_checklist_done` column**, although
   this file predicted one. 070's own comment says its three `task_*` flags
   exist because each is "an act NOTHING ELSE CAN OBSERVE" — and with checklists
   as rows, whether the checklist was done IS observable (a linked run,
   submitted). A boolean beside it would be a second answer to a question that
   has one, which is 016's trap. The submit page says "3 of 27 checklist items
   have not been looked at" instead. `submit_shift_report` and
   `reopen_shift_report` are UNTOUCHED: two acts, not one.
   Screens: **`/checklists` IS ONE SCREEN OF TWO VIEWS** — Checklists |
   Templates, a `TabPicker` over two populations fetched under different rules
   and rendered with different columns (`/events`' precedent). They shipped as
   two adjacent nav entries on 2026-08-29 and merged the next day (Mark: "what
   about just having a Checklist screen with tab picker … combine the two
   screens into one"), because deciding which of two menu items you wanted came
   before you could look at either. **Only the LISTS merged**: both records keep
   their own address, `/checklist-templates` (the list) is a redirect shim
   (`/location`'s pattern, since that address is in the record's own
   breadcrumb), and the nav entry carries **`also: ["/checklist-templates"]`** so
   the shim AND the still-live record route both light the tab. The view is a
   REAL NAVIGATION rather than `history.replaceState` — the two halves are
   different QUERIES — and the default writes no parameter so `/checklists`
   stays canonical.
   Plus `/checklists/[id]` (read-only archive) + the runner at
   `/checklists/[id]/run` in the `(fullscreen)` group (the order guide's posture
   — one scrolling document, black shop-section bands in the shop's own walk
   order, 44px targets, `text-[16px]`, every tap writing immediately);
   `/checklist-templates/[id]` (duplicate-to-another-shop maps sections BY
   DISPLAY NAME, names what didn't map, and arrives INACTIVE — `PlanDetail`'s
   duplicate with the one thing that build didn't need); `/tasks` +
   `/maintenance-requests` (one table, two doors); `/equipment` + record with
   its reading history; `/inspection-logs`.
   **"WALK" WAS A WORD THIS MODULE INVENTED** and is gone from every visible
   string (Mark, 2026-08-30). The tab is **Checklists**, the command **New
   checklist**, the second view **Templates** — which is what the route and the
   `?view=` parameter always said, so only the words were out of step. The tab
   echoing the screen's own name was the deliberate trade: a supervisor says
   they are doing the checklist, and a tab nobody recognises costs more. The KEY
   stays `walks` and is invisible (it is the default view, so only
   `?view=templates` reaches an address bar). **The command's noun is a PROP**,
   because `/inspection-logs` renders the same control and "New checklist" there
   would name the wrong record; and **the runner names its KIND** off the run's
   snapshotted `kind`, since one hardcoded noun would be wrong on two of three.
   `ChecklistWalk` is ONE COMPONENT WITH TWO DOORS — standalone and as a page of
   the shift-report runner, which gained `checklist` in `pagesForShift` for every
   shift (closing 8 pages, opening 6, mid and off-site 5).
   **078 — A CHECKLIST ITEM SAYS FOUR THINGS AND 076 MODELLED TWO**, which two
   real DF01 documents settled and no amount of design would have. The paper has
   a checkbox, the instruction, a WHO (Baker, Fryer, Assistant Baker,
   Supervisor) and a NOTE ("water emptied", "replace filter on Tue/Fri/Sun"). So
   `guidance` and `position`, both nullable on the template item and both
   SNAPSHOTTED onto the run item. Of 105 real items 23 name a position and 16
   carry a note — most have neither, which is why neither has a default.
   **`position` is the ROSTER vocabulary** (`employees.position`), NOT
   `org_members.role`: the two overlap on "Supervisor" and mean different things
   by it. A hint, never a gate.
   **THE SECTION VOCABULARIES DO NOT MATCH, and the brief was wrong to claim a
   walk follows the order guide's route.** DF01's 72 shop sections are SHELVES
   for counting stock — "Walk In R1 S3", "FOH Cab 2" — where the checklists walk
   ROOMS. Only OFFICE matched. Mark's call: use the area-level sections that
   already exist, add seven FOH sub-areas at **60.1–60.7** inside FOH's own
   60–69 band, plus one new "Outside" at 0; mop room → Kitchen Dish Pit
   ("basically in the dish pit"). They add nothing to the order guide — a
   section with no inventory renders no band there.
   **DF01's REAL OPENING AND CLOSING LISTS ARE LOADED** (2026-08-30) —
   `migration/load-df01-checklists.mjs`, 8 new shop sections, 2 templates, 105
   items, transcribed with `pdftotext -layout` rather than retyped by eye.
   Three of Mark's own typos are VERBATIM ("fillout out complely", "santized",
   "toilet bush"): correcting somebody's document while copying it is not a
   thing to do quietly. The loader is dry-run by default and idempotent —
   re-running REPLACES a template's items rather than doubling them, which is
   safe because a run snapshots its own copy.
   **KNOWN AND UNANSWERED: the walk order does not match the paper.**
   Between-section order comes from `shop_sections.sort_order`, which is the
   ORDER GUIDE's route — Kitchen(10), Bathroom(50), FOH(60), Office(90), i.e.
   back-to-front, because that is how you count stock — where the closing list
   goes front-to-back. Fixing it means moving existing sections (which moves the
   order guide) or giving a template its own section ordering. Ask before either.
   **STILL NOT BUILT, named so nobody thinks it was forgotten:** a cadence
   engine (PM wants three shapes and a general scheduler is where this
   metastasizes), PHOTOGRAPHS IN THE PDF (@react-pdf fetching signed URLs is a
   real risk and the document is useful without them — a second pass),
   cost-per-asset (`location_tasks.vendor_invoice_id` is the seam and has NO
   reader), an editor on the run record (read-only on purpose — one write path,
   and the runner is it), equipment DELETE, and everything an inspection log
   wants beyond a filtered list — the inspector's document, findings with
   deadlines, permit expiry. The checklist PDF is NOT attached to the
   shift-report email; the email carries the findings as text instead.
   Verified: **every migration replays on the Docker harness**, every constraint
   refuses what it should (checked by asserting the refusal, which is what found
   the `cardinality` bug), and as REAL AUTHENTICATED ROLES a supervisor reads a
   colleague's run and **updates 0 rows with NO error**, a staffer sees 0 runs
   and 0 tasks while reading the templates, a purchaser edits a master where a
   supervisor's update changes 0, an author's write to a SUBMITTED run changes 0
   and a delete removes 0 — all silently — an owner always writes, `anon` sees
   nothing, and a junk storage path is refused by the POLICY rather than raising
   a cast error. **1,436 fixtures pass** (1,416 at first ship), each rule checked by BREAKING
   it (the ISO weekday, the after-midnight rollover, the out-of-range issue, the
   unscored-section null, the carry-forward order, cancelled-counted-as-open and
   the silent age label all go red). All **78 migrations** replay clean.
   **WALKED END TO END against the real DF01 data 2026-08-30 and left as found.**
   What that proved beyond the harness: the UI wrote `weekdays [6,7]` and
   `shifts ['closing']`, so the ISO mapping holds through a real picker; Sunday
   matched and the "asked for today — not started" band appeared; the snapshot
   took 4 of 5 items, leaving off the Monday-only one; **44°F against 34–40
   raised the issue BY ITSELF and wrote its own note**; raising a task linked it
   so the item reads "Reported"; the carried-over band appeared at the top of
   the next walk immediately; the readiness confirm named what was outstanding
   and let me through; and Finish left for the archive.
   **THE MISSING-NIGHTS NOTE IS ONE STATEMENT IN WHICHEVER PLACE CAN BE SEEN**
   (Mark, 2026-08-31: "in place of the empty table, why not put the text above
   there instead?"). `/shift-reports`' Needs-attention count is flagged reports
   PLUS nights the shop was open and nobody reported — and those nights have no
   ROW, they are a band above the table. So with nothing flagged, the tab read
   5 over a table reading "Nothing needs attention", which is the screen
   contradicting itself; the first fix put a second sentence in the empty slot
   pointing AT the band, which is one fact stated twice an inch apart. Now
   `gapsNote` renders in the table's own empty slot when there are no rows, and
   ABOVE the table when there are — never both, because when rows exist the
   empty slot does not. Verified both ways at 1440, the second by temporarily
   flagging every report (tab 7, note above, two rows beneath).
   **PAGE 8 SAYS NOTHING IT CANNOT ACT ON** (Mark, 2026-09-03, four sentences
   over three passes). Gone: the blockers box's "These can only be answered
   tonight"; the outstanding box's "You can send it anyway — this is a list, not
   a gate"; and BOTH of `salesNote`'s lines, so **that function is deleted**
   rather than left returning null.
   The sales pair is the instructive one. "Square has not reported this day yet
   — the figures will arrive on tomorrow's sync" was the NORMAL case, so page 8
   opened by describing a wait nobody is waiting on and that no act of a
   supervisor's can end; "Sales are in." then went with it, because a page
   listing what is UNRESOLVED has nothing to say about a thing that resolved
   itself. The figure is on page 3 and in the email. Two comments elsewhere
   cited `salesNote` for the "INFORMATION, never a caveat" rule; the rule
   survives, the citations now state it rather than pointing at a dead function.
   The two prose lines under the boxes were each explaining the box above them,
   which the box's own heading already does.
   **AND THEN THE TWO BOXES BECAME ONE, ALL RED** (Mark, same day: "we have two
   distinct boxes when I think one would do", then "make all the text the same
   — red"). The gate-versus-list distinction cost a heading, a border and 32px
   of air to state something the SEND BUTTON already enforces — it is disabled,
   and its tooltip names the blockers — so what is left on the page is one list
   of things somebody should deal with. Blockers lead, because you cannot leave
   without them; the heading follows the box's JOB rather than its contents
   ("Before this can be sent" while one is present, "Still outstanding"
   otherwise); and the only thing still telling the two kinds apart is the
   BORDER, red and 2px when blocked. **The box is FILLED yellow** (Mark's third
   pass), which is the mark colour doing what this file says it is for — a
   fill, never an ink — over the whole thing rather than per line. Red on
   yellow-200 measures **4.62:1**, which passes AA; worth re-measuring if
   either token moves. **The heading sits OUTSIDE the box and centred** (his
   fourth), so it titles the thing rather than being its first line. The arrays
   stay separate in the props and in `submitReadiness`/`submitBlockers` — this
   is a rendering decision, and the email still reports only `outstanding`.
   **THE REPORT IS THE LAST PAGE BEFORE SUBMIT, ON EVERY SHIFT** (Mark, same
   day). It was already true of opening, mid and off-site and false of CLOSING,
   where Tomorrow's production sat between the two — so the one shift with
   something to write was asked to write it, sent off to a printer, and then
   shown a submit page. Everything above the report is a thing you look at or
   count; the report is what you make of it, so it reads last and the next tap
   sends it. Nothing depends on the order (`submitReadiness` and
   `submitBlockers` both ask `pages.includes`, and the runner numbers what it is
   given), which is exactly why a fixture pins it — a reorder would otherwise
   break the rule in silence.
   **THE RUNNER HAS ONE TYPE SCALE, AND `main` SETS THE BODY SIZE** (Mark,
   2026-09-03: "the font changes between pages 4 and 5"). It did — and between
   most other pairs too: eight pages had grown 12 · 13 · 14 · 15 · 16 · 18 with
   no rule, so a row was 15px on Premades, 16px on the checklist and 14px on
   the report. The scale now: **18px** the black banner only, **16px** body —
   every row, value, list item and input — and in-page headings at 16px bold
   uppercase (`ui/SectionHeading`'s own size), **14px** secondary (muted notes,
   hints, errors), **12px** uppercase small-caps labels and table column heads.
   16px is not a taste: it is the threshold below which iOS Safari zooms a
   focused input, so the fields were already there and the text beside them
   should match.
   **`text-[16px]` ON `main` IS WHAT MAKES IT HOLD.** The app's base is 15px (a
   DESK size, `--rf-text-base`), so anything this surface does not size
   explicitly inherits it — a `ui/Checkbox` label sat at 15 beside 16px rows.
   Setting it once on main covers every unstyled element, now and later.
   Deliberately NOT touched: `ui/SectionHeading`'s 13px count badge and
   `lib/anchoredPanel`'s 9px caret, both shared with every other screen in the
   app — this pass was the shift report, and those are a wider decision.
   **AN EMPTY STATE THAT IS THE WHOLE PAGE IS CENTRED HORIZONTALLY AND NOT
   VERTICALLY** (Mark, 2026-09-03) — a bare `text-center` paragraph at the top,
   uncapped so it stays on one line. Two of them: the checklist page's "No
   checklist is set up for this shift at this shop" and the premades page's "No
   production schedule was generated for this shop today".
   **The vertical version was built first and is instructive.** It needed
   `main` to be a flex column so the page could claim the height — `h-full`
   does not work, main being a `flex-1` block whose height is not a definite
   value for percentage resolution, measured at 24px inside a 595px parent —
   and THAT quietly narrowed all eight pages, because every page root is
   `mx-auto max-w-*` and AUTO MARGINS ON A FLEX ITEM MAKE IT SHRINK-TO-FIT
   (measured, 365px where 672 was right, which looks like a deliberate layout
   rather than a fault). `main` is a plain block again and both hazards go with
   it; widths verified afterwards at 672 / 768 / 896 as declared.
   **IT MOVED UNDER THE TAB PICKER 2026-09-03** (Mark), which retires the
   two-places arrangement above: the nights are half of the Needs-attention
   COUNT, so the sentence explaining that count belongs beneath the tab carrying
   it — over the tabs it read as a banner about the whole screen. One place now,
   in `leading` below the picker, so it sits directly over the table whether or
   not the table has rows, and the empty slot no longer stands in for it. The
   contradiction that started all this is still closed, by wording rather than
   by placement: with gaps present the empty slot says **"No reports need
   attention"**, which is about REPORTS and does not argue with a line naming
   nights that produced none. **The other three tabs carry counts too** — they
   had none, so the one tier with a count read as the only one that was
   measured.
   **THREE BUGS ONLY RENDERING COULD CATCH**, none of which typechecks, lints or
   fixture-fails — see `docs/checklists-brief.md` for each:
   an HTML ENTITY IN JSX TEXT EATING THE SPACE after an interpolated value (a
   whole-app trap, now a convention below); a shared class string carrying
   `text-white` that the commit appended `text-ink` to, rendering the runner's
   **Finish button WHITE ON WHITE** — invisible, on the module's primary screen,
   found with `getComputedStyle` because by eye the footer just looks like it
   has one button; and the walk row OVERLAPPING ITSELF at 375px, because
   `flex-wrap` only helps when a child can claim the next line and a `flex-1`
   sibling has a 0 basis. That last had been true since the runner shipped and
   was invisible because it was only ever checked at desktop width.

   **A TASK CAN BE SOMEBODY'S — migration 079, APPLIED 2026-08-31.** *Probe,
   don't read this line; it has been wrong in both directions for four different
   migrations.* Mark, 2026-08-31: "Tasks should be assignable to someone. Not
   mandatory, but when assigned they only appear on that person's checklist."
   **IT POINTS AT AN APP USER, NOT AN EMPLOYEE**, and that is the decision to
   understand before touching any of it. The effect asked for is about WHOSE
   CHECKLIST a job appears on, and a checklist is walked by somebody signed in
   (`checklist_runs.started_by` is an auth user). Assigning to an `employees`
   row would let a shop hand work to the overnight baker, who has an HR record
   and no login (044's distinction) — and the job would then appear on NOBODY's
   checklist while looking assigned. The roster is `org_members`, which 001's
   `members_read` already shows to every member, so this needs **no definer
   function** — unlike 044's `production_operators` and 053's
   `special_order_takers`, which exist only because `employees` READ is
   owner/admin.
   **THE ORPHAN RULE IS THE ONE TO KEEP IF THIS IS EVER REWRITTEN.** 079 has no
   `on delete` clause, matching `created_by` beside it, because revoking access
   BANS an auth user rather than deleting it (4c) — so an assignment outlives
   the login. `taskIsFor` therefore shows a task whose assignee is no longer a
   member to EVERYBODY: without it, the day somebody leaves, every job assigned
   to them drops off every checklist in the shop, silently, which is the exact
   failure the carry-forward exists to prevent. `openTasksForRun` takes a
   `TaskViewer` (viewer id + the current membership) and it is **required with
   no default** — a default of "nobody" would hide every assigned task from a
   caller that merely forgot to pass one.
   **The viewer, never the run's `started_by`**: the band is derived live rather
   than snapshotted, and nothing downstream depends on it — the emailed report's
   checklist section is built from `checklist_run_items`, so what one reader
   sees cannot change what anybody is sent.
   No policy change: 075 is supervisor+ on every verb because a task is a
   supervisor's own record end to end (a ROW rule, therefore a policy), and this
   is one more column on that row. Anybody who can edit a task can assign it,
   including to somebody else, which is what "hand this to Karina" means.
   UI: an **Assigned** column on `/tasks` and `/maintenance-requests` (inline
   `kind="pick"`, "Anybody" resting, sorted by the NAME and not the uuid; widths
   key bumped to **v2**), an **Assigned to** field on the create dialog that says
   in words what assigning DOES ("It will appear on their checklist only"), and
   a quiet label on the walk's carried-over row — named only when it is somebody
   ELSE's, since a row on your own checklist saying "assigned to you" is the
   screen telling you where you are standing. Until 079 is applied both screens
   SAY SO by name (`/tasks` names 079 rather than 075, and the walk carries a
   `taskWarning` rather than an empty band, which would assert that nothing is
   outstanding). Probes: `select column_name, is_nullable from
   information_schema.columns where table_name = 'location_tasks' and
   column_name = 'assigned_to'` (one row, YES), and `select count(*) from
   pg_policy where polrelid = 'public.location_tasks'::regclass` — still
   **THREE**, none of them a delete, or somebody has added an eraser that
   bypasses the reason.
   Verified: all **79 migrations** replay on the Docker harness, and as real
   authenticated roles a supervisor assigns a task to a COLLEAGUE and hands it
   back while a staffer sees 0, updates 0 and **deletes 0 with NO error**, and
   `anon` sees 0. **1454 fixtures pass**, 15 new, each rule checked by breaking
   it — dropping the orphan clause turns 2 red and dropping the assignment
   filter turns 1.
   **WALKED AGAINST THE LIVE DATABASE THE SAME DAY AND LEFT AS FOUND** (both
   real DF01 tasks back to `assigned_to` null). What that proved beyond the
   harness, on Mark's own session: the picker offered Anybody · Mark · Test ·
   Traci — the three members, sorted by name, all supervisor+ — and writing
   through it landed; with the chemicals task assigned to **Test**, its uuid AND
   its title were both ABSENT from Mark's own run at
   `/checklists/[id]/run` while the unassigned one stayed; reassigned to
   **Mark**, it came back reading `Carried over — 2` with a quiet **yours**
   beside it and nothing beside the unassigned one. Note the archive record at
   `/checklists/[id]` renders no carried band at all — the band is the RUNNER's,
   which is where to look when verifying this.

   **PARTIAL DAYS ARE LOADED AND MARKED** (Mark, 2026-08-31: "at one point I
   made the decision to not load partial sales data in Sales. I take that back.
   Let's go back to loading all sales data and making a note when a day's data
   is incomplete."). `SyncFromSquare` stopped at YESTERDAY from 2026-08-28, on
   the reasoning that a part-day "lands in the table looking exactly as
   authoritative as the fourteen complete days beside it". That was right about
   the RISK and wrong about the remedy — today's takings are the figure a
   manager most wants at 4pm, and the answer to a number needing a caveat is the
   caveat rather than the absence. The pull now runs through TODAY.
   **THE CAVEAT IS ANSWERED FROM `synced_at`, NEVER FROM THE CALENDAR**, and
   that is the whole of the care. `isDayComplete` in `lib/sales` asks whether the
   pull happened after the end of the reporting day it covers (Square's runs
   01:00 – 00:59 PT, hence `REPORTING_DAY_ROLLOVER_HOUR`). "Is this date today?"
   goes stale by itself: a row pulled at 4pm Tuesday and never pulled again is a
   part-day forever, and a date test would quietly call it settled by Thursday.
   A **manual** row (065's `source`) is always complete — somebody typed it
   deliberately — and a row with no `synced_at` is treated as complete rather
   than smeared with a warning nothing can clear.
   Two surfaces: a **part day** chip in the day table's Pulled column, which is
   the column that already reports a figure's PROVENANCE and where the `edited`
   mark lives; and a sentence under the summary beside the gap line, kept
   separate from it because a day nobody pulled and a day still being taken are
   different problems and only one is fixed by pressing Sync. **`missingDays`
   still stops at YESTERDAY** — a missing today is not a hole in the history, it
   is a day nobody has synced yet, and reporting it every morning is what
   teaches people to stop reading that line.
   Measured through the real rule over the live table (read-only, paginated on a
   UNIQUE order — ordering by `business_date` alone gave 8,432 rows holding
   8,429 distinct ids, which is the audit trap this file already documents):
   **8,432 rows, 0 incomplete**, so nothing in eleven years of history is
   retroactively marked. The rendering was proved by temporarily moving the
   rollover hour to 23, which correctly painted 2 chips and the sentence naming
   both shop-days. 8 fixtures, checked by breaking it — a calendar-date test
   fails the 00:00–00:59 sliver, and hardcoding UTC fails that and the
   org-timezone case.

4l. ✅ **QUICKBOOKS ONLINE — migrations 081–086, ALL APPLIED, and LIVE ON THE
   REAL BOOKS since 2026-09-02.** Mark: "Research how to link with quickbooks
   online so we can send invoices we generate in the app to my QBO account for
   payment."
   Approved vendor bills go to QuickBooks as **Bills**, with their coding and
   their scanned invoice attached; special orders go as **Invoices** with the
   customer's own sheet attached. **Nothing is collected or emailed by
   QuickBooks** — no Payments merchant account, no Intuit-sent documents; the
   app keeps sending its own. Setup and the switch procedure:
   **`docs/quickbooks-setup.md`**.
   Mark's settled decisions: both directions, A/P first; QBO **records only**;
   **one summary line per document** (two for A/R, see the tax split); status
   **pulled by a button**, no webhooks and no cron; **one company file for both
   shops**; **every QBO setting on the vendor's per-location row, the QBO vendor
   included**; and **QuickBooks computes the sales tax and we warn on a
   mismatch** — his first choice was to send ours, and three probes proved QBO
   drops it, then overrides it.
   **THE A/R HALF IS PROVISIONAL AND COMES OUT IF SQUARE INVOICING LANDS**
   (Mark, 2026-09-02). Special-order collection is expected to move to Square
   invoicing, which syncs to QBO on its own — at which point pushing an Invoice
   from here would book the same revenue twice. It is NOT double-counted today,
   which is Mark's own reading of his books: another app records and categorises
   Square SALES in QBO nightly, and special orders are not invoiced through
   Square yet. **Removing it is about an hour** and touches nothing shared — the
   `push_invoice` mode, `PushOrderToQuickBooks`, `CustomerAccounting`, the
   customers/items/tax-code lookups, two settings pickers and five pure
   functions. Everything expensive is A/P's and stays. Leave the migrations:
   nullable columns nobody writes cost nothing (082's precedent).
   **THE CREDENTIAL STORY IS THE THING TO GET RIGHT, because Intuit refused the
   production-key questionnaire over it** (2026-09-02): *"Any Intuit credentials
   including customer IDs, app client ID and client secret must be stored
   securely and not be exposed within your app."* Two of the three were true of
   this app and both are fixed:
   **CUSTOMER ID IS INTUIT'S NAME FOR THE REALM ID.**
   `accounting_connection_status()` returned it to every org member, so it rode
   the RPC response on every settings load and was RENDERED whenever the company
   name had not arrived — which is every fresh open ("COMPANY
   9341457832962518"). **086 drops it from the function** and returns `connected`
   instead; the screen shows the NAME, which `meta` already fetches.
   **THE CLIENT ID WAS IN A RESPONSE WE SERVE.** `authorize_url` built the whole
   Intuit consent URL and handed it back as JSON. It now returns the handshake
   token alone and **`qbo-oauth?start=<state>` builds the URL where the secret
   lives and 302s**, so the client id appears only in the address bar during the
   hop to Intuit — the protocol itself, and never in anything this app serves.
   That start path **spends no state**: it is the callback's to consume, in the
   same UPDATE that verifies it.
   The third was already true: the client id and secret have only ever been the
   edge secret **`QBO_CREDS`**, the tokens live in a table with RLS and **ZERO
   policies** (081, deliberately — the row holds a live bearer credential), no
   credential has ever been committed, and failures log a status, Intuit's
   `intuit_tid`, a query-stripped path and Intuit's own fault text.
   **On the questionnaire this is Security Q3, and the answer is YES.** Q2
   (security team) and Q4 (MFA) are honestly No and must stay No — Intuit
   rejected on one item, and a false answer to a question they did not ask is a
   worse position than an honest No.
   **THE SEVEN MEASURED TRAPS**, every one found by pushing rather than reading,
   and three of them the SAME mistake — reassembling a ref and dropping a field,
   each only visible on a SECOND push:
   **(a) A REFUSED ATTACHMENT RETURNS HTTP 200**, with the fault inside
   `AttachableResponse[0].Fault` — `extract-invoice`'s `stop_reason: "refusal"`
   shape. Read the ITEM, never the status: believed once, a refusal stores
   nothing, reports success, and the next push attaches a second copy.
   **(b) A SECOND UPLOAD MAKES A SECOND COPY.** There is no upsert. What has
   gone up is recorded on the document's own `external_ref`, keyed by OUR row id
   and never by a filename somebody can rename inside QuickBooks. A bill's scan
   never changes and is left alone; the customer sheet is re-rendered from live
   figures, so its previous copy is DELETED first.
   **(c) ATTACHING A FILE BUMPS THE PARENT'S OWN SyncToken**, and so does
   deleting one. The push response carries the token from BEFORE that, so
   recording it leaves the row one behind and the NEXT push fails 5010 —
   measured on Bill 145, stored 9 against a live 10. Both modes re-read the
   token after attachment work, and only then.
   **(d) `push_invoice` RETURNED NO `sync_token` AT ALL**, which the attachment
   record exposed rather than caused. **A ref with no token is not a failed
   update, it is a CREATE** — a second invoice in a customer's books, from
   pressing Update. So neither caller rebuilds a ref: both push modes RETURN the
   ref they recorded and the caller adds to it. Fixture-pinned through `qboRef`
   and `pushMode`.
   **(e) A PUSH MUST NOT FORGET WHAT IT ALREADY ATTACHED.** 081's merge is
   `external_ref || p_ref` at the TOP level, so it replaces the whole `qbo`
   branch — a ref built from the push response alone ERASES the attachment
   record, and the next push duplicates the file. Both modes carry it forward.
   **(f) A STALE DOCUMENT RE-READS AND PUSHES AGAIN, ONCE** (`postDocument`).
   Anything touching the document in QuickBooks moves its token — a bookkeeper
   editing the bill, or an attachment — and before this the refusal was
   UNRECOVERABLE FROM THE APP. Once, and only on an UPDATE: a create names no Id
   and cannot be stale, and retrying one that failed for another reason writes
   it twice. Matched on the CODE (5010), never the message, which names a
   colleague ("You and Craig Carlson were working on this at the same time").
   It SAYS SO afterwards — a silent retry hides that your update landed on top
   of a change you have not seen.
   **(g) QUICKBOOKS WILL NOT TAKE WEBP** (fault 6041) though `ATTACHMENT_ACCEPT`
   offers it, so it gets its own sentence — the one refusal somebody can walk
   into having done nothing wrong. Latent: every filed document is a PDF.
   Also measured: **the SyncToken is IGNORED on an Attachable delete** (a
   deliberately wrong "9" deleted it anyway), so replacing the sheet needs no
   extra round trip; a 4.57 MB scan uploads in 4.1s; and **QBO wants `VendorRef`
   and `Line` even on a sparse update** or it faults 2020 and never reaches the
   token check — which is why the first stale-object probe proved nothing.
   **THE TAX SPLIT IS TWO LINES AND THE SPLIT IS THE POINT.** `orderTotals` does
   not tax delivery or rush, and a US line's `TaxCodeRef` may only be TAX or NON
   (measured), so an invoice goes as a taxable line and a `— not taxed` line.
   `invoiceSplit` derives the non-taxable half **by SUBTRACTION** so the two
   always sum to total − tax. An EMPTY `TxnTaxDetail` computes NOTHING — it must
   NAME a code, and 0 of 5 sandbox customers carried a `DefaultTaxCodeRef` to
   fall back on, which is what **084** exists for.
   **`taxDisagreement` LIVES IN `lib/quickbooks` AND THE FUNCTION DOES NOT
   DECIDE.** It shipped as an inline twin in `qbo-sync` while the fixture-tested
   one had NO CALLER — 016's `nextDeliveryDate` trap, where the tested
   implementation is not the one in force. Deno cannot import from `web/`, so
   the cure is not a shared module: it is to stop deciding there. `push_invoice`
   returns the figure QuickBooks decided and the caller words the sentence. Only
   compose a warning in the function for something the CLIENT cannot see — the
   coding QuickBooks accepted and then silently dropped, which is what
   `push_bill`'s own warnings are.
   **A CLASS RIDES THE LINE AND A LOCATION RIDES THE HEADER.** A Bill takes its
   `ClassRef` per expense line — a header one is accepted and ignored — and its
   `DepartmentRef` on the header. QuickBooks accepts either and **SILENTLY
   DISCARDS it when the matching preference is off**, with a 200 and no fault,
   so both pushes compare what QuickBooks KEPT against what was sent and warn.
   Found on Mark's own first bill, where the class stuck and the location
   vanished. A **create** honours `TrackDepartments` where a sparse **update**
   skips the check, which is why an early probe wrongly cleared the preference.
   **A REALM CHANGE FORGETS EVERY REALM-SCOPED ID, and only on a CHANGE** —
   reconnecting the same company keeps mappings that are still correct. It
   clears `vendor_locations` (the account, QBO Location, Class and the QBO
   vendor), `customers`, and — the half with money in it — the QuickBooks id,
   token and attachment ids on every pushed bill and invoice, with `synced_at`.
   **The document ids are the serious one**: left in place, `pushMode` reads the
   id and answers "update", so pressing Send after a switch would overwrite
   whatever document happens to carry that id in the REAL books and the bill
   would never be created. **Every clear is checked and a partial one is named
   on the settings banner** — nothing can retry once the realm has moved.
   It was clearing `vendors`, which **083 made unread**; measured before fixing,
   it cleared 2 rows nobody reads and left 20 live ids pointing at the old
   company.
   **THE ENVIRONMENT PICKER IS SHOWN WHILE CONNECTED**, which is the whole point
   of it: it used to render only when disconnected, so the one moment anybody
   needs it — moving a working sandbox connection to the real books — it was
   absent and Reconnect silently reused "sandbox". The OAuth endpoints are
   SHARED, so that fails in the worst way available: signing in SUCCEEDS and
   then every call goes to the sandbox host with a production realm.
   **Two edge functions, and `_shared` is compiled in AT DEPLOY TIME, so they go
   together.** `qbo-oauth` is the callback and the consent hop and **must be
   deployed `--no-verify-jwt`** — Intuit's callback is a top-level browser
   navigation with no header to attach, so with verification on it is 401'd
   before a line runs and the symptom is "authorize works, the app never
   connects". `qbo-sync` is everything a signed-in person asks for, on the
   CALLER's JWT, with the service_role escalation **bounded to the token row**.
   **THE MIGRATION LEDGER.** *Probe, don't read this line; it has been wrong in
   both directions for four different migrations.*
   **081** the connection table (RLS, **zero policies**), its three definer
   functions, `vendors`/`customers.external_ref`, `special_orders.synced_at` ·
   **082** `vendors.expense_account_ref` — **superseded by 083 and now read by
   nobody**, kept because it ran · **083** the six QBO columns on
   `vendor_locations`, which is where every mapping actually lives · **084**
   `accounting_connections.tax_code_ref` · **085** widens
   `accounting_connection_status()` to RETURN 084's columns · **086** drops
   `realm_id` from it and returns `connected` · **088**
   `vendor_invoices.qbo_balance` + `qbo_checked_at`, the A/P payment cache.
   Probe 088 with `select column_name from information_schema.columns where
   table_name = 'vendor_invoices' and column_name in ('qbo_balance',
   'qbo_checked_at')` — two rows.
   **084 WITHOUT 085 IS THE WORST STATE and it shipped that way**: the write
   goes through `qbo-sync`, which sees the column, so Settings saves the tax
   code and reports success — while every reader goes through the status
   function, which 084 did not widen. The picker reads "Choose a tax code" and
   the first TAXABLE order refuses by naming the screen you just used. A
   ZERO-TAX order does not show it, which is why phase 4 was walked clean
   against wholesale bagels. **`create or replace` cannot change a
   `returns table` column list** — 085 and 086 both drop and recreate, and a
   dropped function takes its privileges, so both revokes and the grant are
   restated each time.
   Probes: `select pg_get_function_result(oid) from pg_proc where proname =
   'accounting_connection_status'` names `connected` and NO realm or token;
   `select count(*) from pg_proc where proname = 'accounting_connection_status'`
   is **1** (two means an overload is live — 033's `freeze_pay_period` trap);
   `select count(*) from pg_policy where polrelid =
   'public.accounting_connections'::regclass` is **0**, and must stay 0.
   **A FUNCTION'S OUT PARAMETERS ARE NOT IN `information_schema.columns`**, so
   the obvious "does it leak a token column" probe returns ZERO ROWS for a
   healthy function and passes vacuously. Use `pg_get_function_result`.
   **LIVE ON THE REAL BOOKS 2026-09-02** — realm `123145755476194`, Donut
   Friend, Inc. The switch was verified afterwards rather than trusted: vendors,
   customers and pushed orders all cleared to zero, the two surviving vendor
   mappings were provably production values (account `601 Food COGs` against the
   sandbox's `80`), and Mark's first real bill read back from QuickBooks with
   **all five fields intact** — vendor, account, class, location and a 3.70 MB
   scan attached, `IncludeOnSend false`.
   **NOT BUILT, deliberately:** any A/R status pull. `special_order_payments`
   already answers whether a customer paid, and two sources for one customer's
   money is the shape this codebase treats as a bug. **A/P is the opposite and
   is the right place to pull** — the app has no vendor payments table by
   design, so QuickBooks is the only place that fact exists. `refresh_status`
   already returns `Balance`. **BUILT 2026-09-02 — see the status ladder
   below**; the decision it was waiting on was whether to store the figure WITH
   its `checked_at`, and the answer is yes: the rule against storing was written
   for a bare figure rendered as current, which is a different thing.
   **SHIPPED 2026-09-02 — THE STATUS LADDER, Open · Approved · Submitted ·
   Paid** (Mark: "when we push a bill to QBO, the status should be 'Submitted'
   as in Submitted for payment. When it's paid, the status should be 'Paid'").
   **THE TOP TWO RUNGS ARE DERIVED AND THERE IS NO NEW STATUS COLUMN**
   (`billStage` in `lib/invoices`): `status` still holds only what WE decided —
   open, approved, void — and the ladder is that plus what QuickBooks last said.
   A status column repeating `synced_at` would be two answers to one question.
   **`void` IS TESTED FIRST**, because it is an exit from the ladder rather than
   a position on it, and a voided bill that still carries a link would otherwise
   read as Submitted. **PAID IS A NUMERIC ZERO AND NOTHING ELSE** — null is
   "nobody asked" or "QuickBooks no longer has it", neither of which is paid,
   which is the whole of 088's tri-state.
   **088 STORES THE BALANCE, WHICH INVERTS DECISION 7, AND `qbo_checked_at` IS
   WHY.** That decision refused to store a QBO figure because it would be "stale
   the moment it lands and rendered as if current" — true of a bare number, and
   the fix is the timestamp rather than the absence: `billPaymentNote` returns
   NOTHING without one, so no claim about payment can ever appear without the
   day it was true. It is a CACHE OF THEIR FACT, never ours — this app still
   records no vendor payment, which is what keeps QuickBooks the single source.
   A bill can be PART paid, so "Submitted · $412 still owed" is a sentence
   rather than a fifth rung.
   **"Submitted" can only ever mean ON THE BOOKS, never sent for payment** —
   QuickBooks Bill Pay is a QBO interface feature and the Accounting API can
   RECORD a `BillPayment` but not initiate one.
   **QuickBooks Payments was considered and declined** (2026-09-02): it would
   mean a second merchant account beside Square, it fights the document flow
   this app deliberately owns (its own quote PDF, the `/q/{token}` approval, the
   signed artifact), and it would make QuickBooks a second writer of a fact
   `special_order_payments` already owns. The live question there is **ACH on
   wholesale** — Cafe Knotted's ~$1,700 weekly balance costs ~$50 a week in card
   fees — and that belongs with Square, not Intuit.


4m. ✅ **PAGE PERMISSIONS — the spreadsheet is code (2026-09-04; migration 092
   NEEDS APPLYING, `sync-square-sales` NEEDS REDEPLOYING).** Mark, inviting the
   first employees: "I put together a spreadsheet with each page listed and how
   I imagine each security level should be able to access them … I LOVE the
   idea of having the spreadsheet be code that I can adjust." The sheet is
   `docs/Page Permissions.xlsx`; the code is **`web/src/lib/pageAccess.ts`**,
   one `row("-","R","W","W","W")` per screen in the sheet's own column order
   (staff · supervisor · purchaser · manager · owner), fixture-pinned cell by
   cell.
   **THREE READERS, ONE TABLE.** `sectionsForRole` (the menu) hides what the
   table hides; `components/PageAccessGate` in the (app) layout says so in a
   sentence for a typed URL ("This screen is open to managers and the owner.
   You're signed in as Staff."); and each page takes its `editable` /
   `canWrite` from `canEditPage(role, "/plans")`. `NavSub.roles` is GONE — it
   was a second copy of the same fact, and a second copy is how the menu and
   the screen came to disagree. `/` lands on `homeHref(role)`: the Locations
   list where the sheet allows it, else the first screen the menu offers.
   **HIDDEN VERSUS UNREACHABLE, and which is which is Mark's call**: "other
   than sensitive info for employees, everything else can be just hidden … I'd
   rather avoid the migration step as much as possible." So outside HR the
   table is the whole gate — a purchaser on /plans is "R" at the screen while
   039's policy still admits them at the table — and tightening is an edit here
   and a deploy. The one thing an edit here can NEVER do is loosen: a screen
   offering a write the policy refuses changes zero rows and reports success.
   **`LOOSENED_BY_092`** lists the six cells that asked for more than the
   policies gave, and the fixture pins them, so the next such cell goes red and
   is recognised as a migration.
   **092** widens: `preq_resolve` → supervisor+; `production_schedules` /
   `_items` / `_par_overrides` writes and `generate_production_schedules` →
   supervisor+ (this is also the bug where a supervisor's closing shift report
   could not generate tomorrow's paper); the 051 select policies on special
   orders and customers → every member (quote tokens stay supervisor+);
   `production_batches` / `_batch_logs` insert+update, the batch-photos bucket,
   `next_batch_number` and `production_operators` → every member (delete stays
   purchaser+, `generate_production_batches` stays supervisor+); and the three
   sales definers → purchaser+. One tightening: `payroll_benefits` select →
   owner/admin, the sheet's Unreachable. Each function is reproduced whole with
   its argument list unchanged (033's overload trap); RERUNNABLE, proved by
   applying it twice on the harness; every widening and every surviving refusal
   verified there as real authenticated roles (staff read an order and update 0;
   staff log a batch and delete 0; a supervisor resolves a request and the
   author cannot mark their own ordered; a supervisor generates and staff are
   refused by name; a purchaser corrects a day and a supervisor is refused;
   anon sees nothing; each reproduced function exists exactly once).
   Predicates that moved in `lib/roles`: `canResolveRequests` (supervisor+),
   `canSyncSales` (purchaser+), `canLogBatch` (every member), plus the new
   `canScheduleProduction` (supervisor+ — `schedule_special_order` is INVOKER
   and now answers to the widened policy, which is what 068's header asked
   for). The Square function's WRITE check is purchaser+ to match.
   Two cross-screen consequences, both deliberate: a purchaser is Read Only on
   Invoices, so "File as bill", the ticked box on Close and "File as invoice"
   all take a `canFileBills` from the INVOICES cell rather than from the PO's
   own gate; and staff are Read Only on Requests, so the New request command is
   withheld from them even though `preq_insert` would take the row.
   **Rows the sheet did not carry keep their old rule and say so in the file**:
   Inspection Logs (supervisor+), Equipment (staff hidden to match the rest of
   Facilities — the one assumption, one letter to reverse), Timesheets
   (unreachable below manager), Cleanup (purchaser+). Reviews, Documents,
   Policies and Tags are stubs and their /soon/ routes carry rows too.
   **THE FIRST HOLE, found by Mark on a staff account within the hour: the
   vendor record's fields were editable.** `VendorFields`, `ItemFields`,
   `VendorItemFields`, `VendorLocationsTable`, `ItemLocationRows` and
   `VendorItemLocations` had never taken an editable flag — they left writes
   to RLS, which for staff means a cell that opens, accepts typing and matches
   zero rows. A "Read Only" cell in the table reached nothing on those screens.
   Fixed by giving **`InlineValue`, `ActiveToggle` and `WeekdayPicker` a
   `readOnly` prop** (a value with `READ_ONLY_VALUE`'s padding and no box; a
   word instead of a switch; the seven boxes as a statement) and threading
   `editable` from the three records — `/vendors`, `/items`, `/vendor-items` —
   into every block. One switch on the control rather than a conditional at
   thirty call sites. **A field block that renders `InlineValue` must take
   `editable`**; grep for the ones that don't before trusting a Read Only cell.
   **Second hole, same hour: the vendors LIST still toggled Active.** It used
   `VendorActiveToggle`, a hand-rolled copy that predated `catalog/ActiveToggle`
   and so never learned `readOnly` — deleted, the list uses the shared part.
   `VendorItemsTable` and `PayrollBenefitsList` rendered the shared toggle
   without the flag; both pass it now. **Every `<ActiveToggle` either sits
   inside an `editable ?` or carries `readOnly={!editable}`** — the sweep that
   found these is `grep -rn -A4 "<ActiveToggle"`.
   **Third hole, on a supervisor: the LISTS' bulk bars and row menus.**
   `ItemsList` and `PurchaseOrderList` offered the selection column, the
   batch bar and a row's Delete to everyone ("RLS is the gate"), so a
   supervisor — Read Only on both — could tick, press, and be told zero rows
   moved. Both take the cell now; `SchedulesList` gates its print selection
   on `stampable` and `InvoiceList` on `canEdit || canApprove`. Swept with
   `grep -rln '<RowMenu\|key: "select"\|checked.size > 0'`; every other list
   already wrapped its commands in `editable`. **A selection column exists for
   its bar; if the bar has nothing a role may press, drop the column too.**
   **Nobody has ever held purchaser or supervisor**, so the first invites are
   the first real exercise of any of this. Expect small holes; each is a cell.
   **1601 fixtures pass**, 17 new.


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
Migration 014 makes `v_item_last_ordered` security DEFINER with an explicit
`il.org_id in (select user_org_ids())` guard. 004 had made it
`security_invoker`, which evaluates four tables' RLS inside an aggregate over
104,669 `purchase_order_items` rows — measured 2026-07-26 at 4,336ms in-app vs
160–250ms for the identical query under `service_role`. **APPLIED and verified
2026-07-26**: `/items` 6.5s → ~0.8s, `/cleanup` → ~2.6s, and the data is
unchanged (452 dated + 338 null = 790 items at DF01).
**Footgun it introduces:** `service_role` now reads this view as EMPTY, because
`user_org_ids()` has no `auth.uid()` to resolve. A local audit script will
conclude "nothing was ever ordered" and be wrong — query
`purchase_order_items` directly from those scripts, or set the guard aside
deliberately. Any future definer view carrying a `user_org_ids()` guard has the
same property.

Migration 015 gives `purchase_order_items` its own `notes` column — the
ordering note §4.9 prints on each line, which until now was read LIVE from
`vendor_items.notes` at render time and was the one field on a PO line that
wasn't a snapshot (so editing the catalog rewrote orders sent months ago, and
deleting a vendor item erased the note from its own history). 015 adds the
column, BACKFILLS DRAFTS ONLY (history is left alone — a sent PO's document is
whatever was sent), and recreates 013's function to snapshot `vi.notes`
alongside the description. The note is editable per line on PO detail, which is
the point: strike it off this order without touching the catalog entry every
future order inherits (Mark, 2026-07-28). Fixture-tested in the Docker harness —
snapshot on generation, catalog edit doesn't touch the order, line edit doesn't
touch the catalog, backfill skips non-drafts.

Migration 016 makes a generated PO know when it arrives: `next_delivery_date`
(immutable, `((day - isodow + 6) % 7) + 1`, so the answer is STRICTLY after the
order date — a Tuesday order to a Tuesday-delivering vendor arrives the
following Tuesday) and a recreated generation function that fills
`purchase_orders.delivery_date` from `vendor_locations.delivery_days`. Null when
the vendor has no delivery days (13 of DF01's 56 vendor-locations), which is
what the Process card's date input is still for. Drafts are backfilled, history
isn't. Same arithmetic as the suggestion chip it replaces
(`lib/poProcessing.ts` `nextDeliveryDate`) — if one changes, change both.

Migration 017 makes the location a real record — the FMP fields that were
dropped or left as raw text get TYPED COLUMNS on `locations`: `tax_rate`
(a FRACTION, 0.0975, shown as a percentage), `labor_rate`, `register_count`,
`open_days` (the same ISO smallint[] `WeekdayPicker` writes), the seven-slot
`open_time_by_weekday` / `close_time_by_weekday`, and the production mapping
`kitchen_by_weekday` (seven slots) / `shops_for`. Every per-weekday array
copies 009's `par_by_weekday` — slot n = weekday n, with the same
`is null or array_length = 7` guard — so weekday indexing reads the same
everywhere in the schema. Not more `settings` jsonb: these are structured facts
of the same class as `vendor_locations.order_days`, and a column is what the
existing inline controls know how to write. **After the backfill,
`locations.settings` holds `email_provider` and nothing else** (today, nothing
at all — DF's override is at the ORG level). 017 also adds
`unique (location_id, display_name)` on `shop_sections`: that name is the
identity the guide groups by and the key `load.mjs` dedupes on, and the new
shop-sections screen is a second writer.
The VALUES come from the raw export, not the migration — run
`migration/backfill-locations.mjs` (dry run by default, `--apply` to write),
which parses `Location.mer` and also STRIPS the retired FMP keys from
`settings`. Addresses stay jsonb: `lib/poProcessing.ts` reads
`address.shipping` straight through as a PO's Ship-to, and that contract
shouldn't move for a form — `InlineValue` grew a json path instead.

**Migrations 001–016 are ALL APPLIED to the hosted DB** (013 verified
2026-07-23 by the bogus-argument RPC probe; 015 and 016 verified 2026-07-28 —
the note backfill hit drafts only, and `select next_delivery_date('2026-07-28',
'{5}')` returns 2026-07-31 over RPC). **018 is APPLIED and verified 2026-07-31**
— columns present, bucket present and private, and an upload through the app
landed at `{org_id}/{po_id}/{uuid}.png` with the signed URL rendering; an
unauthenticated fetch and an `anon` signed-URL request were both refused.
**017 and 019 are APPLIED** — verified 2026-07-31 by probe (`tax_rate` selects
on `locations`; `extraction` / `extracted_at` / `extraction_model` select on
`purchase_order_attachments` and hold a real Chefs' Warehouse reading). This
line said "NOT applied yet" for a while after they were; **probe, don't read
this file** — that's what the memory note says and it was right.
**020, 021 and 022 are APPLIED** (Mark, 2026-08-01/02) and the employee data is
LOADED: 445 rows, 26 active / 2 new hire / 417 inactive, matching the transform
report, with Mark's row linked to his auth account. 022 verified 2026-08-02 by
inserting an `orientation` document and removing it again — the constraint
accepts the value, so the widened check is live.
**032 is APPLIED** (Mark, 2026-08-05) — `break_premiums.reason` is nullable and
the requirement now rides the decision, so a waiver or a not-owed may be
recorded bare while an owed hour still has to argue its case. Probe with
`select is_nullable from information_schema.columns where table_name =
'break_premiums' and column_name = 'reason'` (YES) and
`select conname from pg_constraint where conrelid = 'public.break_premiums'::regclass`
(expect `break_premiums_reason_when_owed`, and NO `break_premiums_reason_check`).
**033 is APPLIED** (Mark, 2026-08-05) and the backfill has run: 19 entitlement
rows over 13 people, `starts_on` 2022-06-27, every amount left NULL so they
inherit the benefit's $12. Verified the same day — the three tables select, the
commuter benefit is seeded, and the OLD three-argument `freeze_pay_period` is
GONE (a call to it returns PostgREST's `PGRST202`) while the four-argument one
raises "No such pay period" from inside its own body. That pair of probes is the
one that matters: two live overloads would let a stale tab freeze a pay period
with no benefits in it and no error. A second `--apply` wrote 0 new and updated
19, so the select-then-update idempotency holds without an `on conflict` target.
Then the whole stack was run against the LIVE database — 159 shifts, 19
entitlements, 36 accruals — and the produced CSV matches Mark's real Gusto file
person for person, **$432.00 against $432.00**, with the sick-hours header
assertion and the 18-cell width both holding on the real file.
**035 is APPLIED and LOADED** (Mark, 2026-08-06) — 46,553 employee events,
verified the same day by probe: `select count(*) from employee_events` (46,553),
`… where source='filemaker' and legacy_id is null` (0), `… where score < 0 or
score > 5` (0), `… where kind='shift' and location_id is null` (1), and
`select kind, count(*) … group by 1` (shift 43,918 · attendance 867 · call_out
435 · negative 409 · incident 339 · verbal_warning 194 · positive 158 ·
written_warning 100 · document_note 81 · note 38 · check_in 14). Mean shift score
4.825 against FMP's own stored 4.854 — lower on purpose, because we keep the true
mean where FileMaker rounded up. 33 rows skipped and named (employee ids `387B`
and `001` match nobody). All 35 migrations apply on the Docker harness, and the
whole 46,553-row file was replayed through the real constraints there before it
went near production. See build step 4e.
**044 is APPLIED** (Mark, 2026-08-09) — production phase 5's actuals — and the
whole flow was walked live the same day and left as found (see build step 4f).
*Probe, don't trust this line.* `select count(*) from production_batches` (0 —
the walk's 26 were deleted); `select last_value, is_called from
production_batch_number_seq` (**30025, true** — the walk consumed 30000–30025,
so the next `next_batch_number` returns **30026** and the first REAL batch will
not be 30000. Gaps are normal; FMP's own run has thousands. Note this probe is
SQL-EDITOR only: `next_batch_number` is definer and re-checks `user_org_ids()`,
which a service_role script cannot satisfy — it answers "Not your organisation",
which is migration 014's footgun and not a fault); `select column_name from
information_schema.columns where
table_name = 'production_schedule_items' and column_name in
('counted_by','counted_at')` (2 rows); `select id, public from storage.buckets
where id='batch-photos'` (1 row, false). For the five functions, call one via
RPC with a bogus uuid — each raises from its FIRST statement ("No such schedule
line", "unknown location") without doing any work, which is how their existence
was confirmed.
**036 is APPLIED and LOADED** (Mark, 2026-08-07) — 470 elements · 59
element-locations · 128 recipes · 493 versions · 3,765 lines · 2,914 steps, with
**128 masters for 128 families**, verified by the loader's own sanity counts and
then by using the screens against live data. 154 of the 159 vendor keys resolved
to an inventory item. **Probe, don't read this line** — it has been wrong in
both directions for four different migrations: `select count(*) from
production_elements` (470), and confirm exactly one master per family with
`select count(*) from production_recipes r where (select count(*) from
production_recipe_versions v where v.recipe_id = r.id and v.is_master) <> 1`
(0). To reload: `node transform-production.mjs --write` then
`node --env-file=.env load-production.mjs --wipe`.
**034 is APPLIED** (Mark, 2026-08-06) — verified the same day: both screens'
selects return rows, and **0 of the 42 existing documents carry an expiry**,
which is the migration working (null means never, so nothing changed under
anyone). Probe with `select count(*) from employee_documents where expires_on
is not null` and check `employee_documents_expires_idx` exists.
Then the real components were rendered in Node over the LIVE rows (the
`PoPdf` idiom — esbuild-less tsc slice, service_role read, `renderToStaticMarkup`,
inspected in the browser with the dev server's own stylesheet). What that
measured is the argument for the whole feature: **15 of the 16 current staff
with a food handler date are already LAPSED** — Campos 2021-07-27, Altamirano
2022-12-28, five in 2023 — and only Kimberly Ramirez (2026-10-18) is in date.
Every one of them read as "onboarding paperwork complete" the day before,
because completeness asked whether a document existed and never whether it was
still good. All 15 now show a red date over "Food handler card" on the roster.
Note none is `filed: true` yet — they are all the legacy column speaking,
exactly as designed until the cards are photographed.
Pre-apply behaviour, verified before it was applied and worth keeping because
the next schema change will meet it: the roster's document query is deliberately
NOT folded into the page's own error — a missing column must not blank a
readable roster — but it isn't swallowed either, because an empty Expires column
asserts that nothing is lapsing, which is the one claim that screen exists to
make. It reads "unreadable" instead, and the employee RECORD replaces its
Paperwork card with the Postgres error, 018's pattern.
**031 IS APPLIED** — measured 2026-08-06 by service_role probe, after this line
had said "NOT applied yet" for two days: `timesheets.wage_type`, `tip_hours` and
`tip_allocation` and `employees.primary_wage_type` and `gusto_id` all select, and
**44,516 timesheets carry a wage_type**. That mattered, not as bookkeeping — the
timesheets screen's ONE select now carries those columns, so had they been
missing the whole screen would have gone down rather than just the export panel.
**Probe, don't read this file**; it has now been wrong in both directions for
four different migrations. `select count(*) from timesheets where wage_type is
not null` (~44,500) and `select count(*) from employees where primary_wage_type
is not null` (198), and confirm `select count(*) from timesheets where wage_type
like '%(Primary)%'` is ZERO — the suffix must never be stored.
**027, 028, 029 and 030 are ALL APPLIED** (Mark, 2026-08-04) and both loads
have run — 178 pay periods and 44,721 timesheets. For 029/030 probe
`select count(*) from break_premiums`, `from tip_pools`, `from
timesheet_imports`, and check the `timesheet-imports` bucket exists and is
PRIVATE. Note `report_pooled_tips` answers "Not your organisation" to a
service_role probe — that is migration 014's footgun, not a fault: the function
resolves `user_org_ids()` from `auth.uid()`, which service_role has none of.
Test it from a signed-in session.
**027 and 028** were applied earlier the same day. Probe with `select count(*) from
pay_periods` (178) and `select count(*) from timesheets` (44,721); for 028's
period gate, `select public.timesheet_period_editable(id), status from
pay_periods order by start_date desc limit 3` — false on every closed one.
**025 and 026 are APPLIED** (Mark, 2026-08-04) and `extract-invoice` is
redeployed. Verified the same day by probe and then end to end against the live
database: both tables and `purchase_order_attachments.invoice_id` /
`vendor_locations.external_ref` select; the approval RPC is refused for `anon`
with "permission denied for function" (so both revokes and the `authenticated`
grant landed) and returns 1 row with `approved_by` stamped from `auth.uid()`
for the owner; the edge function answers a bogus attachment id with a 404
rather than doing model work. **Probe, don't trust this line** — it has been
wrong in both directions before: `select count(*) from vendor_invoices` for
025, and `select is_nullable from information_schema.columns where table_name =
'purchase_order_attachments' and column_name = 'po_id'` for 026.
**The whole loop was walked on real data and left as found**: the stored
Chefs' Warehouse reading on `132-181132-02` filed as an invoice, **15 of 15
lines joined by SKU** to that order, the receiving screen then reading the
FILED invoice ("15 of 15 lines matched", `INVOICED 1 CS` beside `ORDERED 1 CS`,
billed $472.13 against received $460.73), approved, and deleted — leaving 0
invoices, 0 lines, and the PDF still on the order with `invoice_id` back to
null and its extraction intact.
Two things that verification settled. **A reading stored before the redeploy
has no due date, tax, freight or PO number** — those cells render as em dashes,
which is the both-sides contract working, and "Read again" is what fills them.
And **"Read again" on a document with no `invoice_id` also FILES it**, because
auto-file lives in `read()`; on an already-filed document it only refreshes the
raw reading, which is the intended asymmetry. **NO LONGER TRUE since
2026-09-01** — `read()` reads and does nothing else, on any document. Filing is
an act of closing; see below.
**023 is APPLIED** (Mark, 2026-08-02) — `employees_delete` for owner/admin,
reversing 020's deliberate absence. See build step 4c for the argument and for
the `.select()`-your-own-delete rule it taught. Probe with
`select polname, polcmd from pg_policy where polrelid = 'public.employees'::regclass`
— four rows, not three.
**024 is APPLIED** (Mark, 2026-08-03; verified by probe the same day — a
count-with-no-size update was accepted on a throwaway inactive row, which the
constraint would have refused, and the row was restored) — it drops
`vendor_items_pack_shape`, 010's `check (pack_count is null or pack_size is not
null)`. That statement is true about finished data and wrong as a constraint,
because the pack is edited ONE COLUMN AT A TIME: the vendor-item screen writes
`pack_count` / `pack_size` / `pack_unit` as three separate `InlineValue` cells
laid out the way a pack is written — count × size unit — so on an item with no
pack yet, **the first cell you reach reading left to right is the one column
this constraint forbids on its own**. Mark hit it on Restaurant Depot's Non
Stick Spray and got the raw Postgres text in the cell. (Before it was applied
the workaround was to enter the SIZE first — not a rule anyone could guess from
a row reading "1 × size EA".) Dropping it costs nothing because **no reader
has ever looked at `pack_count` without `pack_size`** — `packLabel` and 013's
generation function both gate on the size and fall back to `package_content` /
`package_desc` — so a count on its own is invisible rather than wrong and can
never put "6 ×" on a purchase order. Pinned by
`scripts/fixtures/packLabel.fixtures.ts`, which was checked by breaking the
guard: it prints `"6 × 0 EA"`, which is exactly the garbage the constraint was
imagined to be preventing and which the reader prevents by itself. Probe with
`select conname from pg_constraint where conrelid = 'public.vendor_items'::regclass`.

**Migration 048 gives the guide's item header a last purchase (NEEDS
APPLYING).** `v_item_last_purchase` — one row per item-location, the most
recent non-void order AT THIS LOCATION, carrying the date AND the vendor item
it was bought as. 004's `v_item_last_ordered` answers half of it and CANNOT
answer the other half: it is `max(po.order_date)` grouped by item-location, so
the aggregate discards the row the date came from. Additive rather than a
widening, because three screens read 004's shape and `lib/lastOrdered` buckets
it. Security is 014's pattern exactly — `security_invoker = false` plus ONE
top-level `user_org_ids()` guard — which means it inherits 014's FOOTGUN:
**service_role reads it EMPTY**, so an audit script will report that nothing was
ever bought. Verified on the Docker harness as a real `authenticated` member
(`current_user` asserted): it picks the later of two purchases, composes from an
undescribed vendor item, agrees with 004 on the date, returns exactly one row
per item-location, and `anon` is refused outright. The `po.status <> 'void'`
guard is load-bearing and was proved so — without it the fixture's header names
a voided order dated five days later. **Until it is applied the guide says so**
in one muted line under the title and suppresses the per-item label entirely,
because an absent line and "never ordered here" look identical and the header
would otherwise assert something false about every item.

Migration 019 gives the attachment somewhere to put what the invoice SAYS —
`extraction` jsonb, `extracted_at`, `extraction_model`. On the attachment rather
than a table of its own: the reading is 1:1 with the file, re-reading replaces
rather than accumulates, and deleting the attachment should take it along
(which a column does for free). If a screen ever loses these columns again it
says so out loud — the Paperwork card and the document pane are replaced by the
Postgres error naming the missing column, same as 018's pre-apply behaviour.

**The `extract-invoice` edge function needs one secret:**
`supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` then
`supabase functions deploy extract-invoice`.

Migration 018 gives receiving the invoice — the last unbuilt piece of spec §2
step 5. It adds `file_name` / `content_type` / `byte_size` to
`purchase_order_attachments` (which had existed since 001 with no writer at all),
creates the **private** `po-attachments` Storage bucket, and puts four
org-scoped policies on `storage.objects`. The object key is
`{org_id}/{po_id}/{uuid}.{ext}` so the policies authorise off the first folder
segment with no join, the same way every table policy reads `org_id`; the cast
is wrapped in `public.storage_folder_org()` which returns **null instead of
raising** on a non-uuid segment, because Postgres gives no guarantee it
evaluates the `bucket_id` test first. That helper is revoked from `public` AND
`anon` (per 002) and then **granted explicitly to `authenticated`** — a policy
runs with the querying role's privileges, so without the grant every read of the
bucket fails with "permission denied for function" rather than returning no
rows. 018 also indexes `purchase_reminders (location_id, show_on_date) where
dismissed_at is null`, which the order guide now queries on every load.
Verified in the Docker harness (all 18 migrations apply on a storage stub; a
member sees only their own org's objects, an insert into another org's folder is
rejected, a junk path yields null rather than an error).
**Until 018 is applied**, PO detail says so out loud — the Paperwork card is
replaced by the Postgres error — rather than showing an empty card that reads as
"no invoice yet".

The 16 POs Mark sent on 2026-07-27 have NO delivery date and that is deliberate
(his call, 2026-07-28): 016's backfill skipped them because they were already
sent, and filling them in afterwards would make the record disagree with the
document the vendor received. Don't "fix" them.
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

- **A CREATE DIALOG ASKS FOR THE FIELDS THE REST OF THE APP READS, AND STOPS**
  — `NewEmployee`'s template, now followed by `NewVendor`, `NewInventoryItem`,
  `NewLocation`, `NewProductionItem` and `NewRecipe` (all 2026-09-03). Command
  in the filter row → `ui/Dialog` → one insert carrying `org_id` EXPLICITLY
  (design rule 1) → land on the new record. Everything else is an `InlineValue`
  on that record, because a create form that also set it would be a second
  editor to keep in step.
  **Which fields make the cut is not taste — it is what BREAKS without them.**
  A vendor is asked for **Order via** because it decides what the PO screen
  offers, so one defaulted to `email_po` produces a Process card that cannot
  work. An inventory item is asked for its **base unit** because design rule 5
  rests on it: created in the wrong one, its suggested order quantity is wrong
  by the conversion factor. A location is asked for its **code** because the
  masthead, every count line and `unique (org_id, code)` all read it.
  **A DUPLICATE WARNS UNLESS THE DATABASE WOULD REFUSE IT**, which is the line
  between `findPossibleRehires` and `NewLocation`. Vendors, items and production
  items have no unique index and two entries for one supplier is a real thing a
  shop does, so those say so and let you through; a location code has one, so
  the commit is DISABLED and says why — a button that can only fail is worse
  than a warning.
  **A CODE UPPERCASES AS YOU TYPE**, visibly rather than on the way to the
  database: every existing code is upper case, that unique index is
  case-SENSITIVE, and "df01" beside "DF01" is two shops that read as one.
  **AND THE DIALOG CLOSES ON COMMIT.** `AddShopSection`'s stay-open ending is
  the exception, not the rule — the row landing on the list behind you is the
  better confirmation, and `AddTemplateItem` was corrected to match (Mark,
  2026-09-03). Anything counting how many you added goes with it: with the panel
  closing it can never read anything but zero.
- **A FIXED px WIDTH INSIDE A `DataTable` CELL WILL BE CLIPPED, AND SILENTLY**
  (found 2026-09-03 on the checklist template's Expected column, reported by
  Mark as "I am unable to set the second value, just the two numeric ones").
  Column widths are WEIGHTS resolved against the table's visible total, so a
  column declared 200 out of 1880 is ~131px at a 1280 window — while the three
  `w-14`/`w-14`/`w-12` boxes in it wanted 180. The third was simply outside the
  cell: not narrow, ABSENT, with no scrollbar and no ellipsis to say so.
  Anything laid out inside a cell must be FLEXIBLE (`min-w-0 flex-1`), or it is
  sized against a width the column may never have.
- **`InlineValue`'s `className` REACHES ITS RESTING BUTTON ONLY, so a width
  passed to it does not survive the click** (Mark, 2026-09-03, on the same
  cell after the first fix: "when editing the numeric field, it expands and
  covers the unit field"). Its editing branch returns a bare `flex w-full`
  wrapper around a `whitespace-pre` Sizer, so in a FLEX ROW it grows to the
  text's own width and lies over whatever is beside it — while in a `dl` track
  or a `table-fixed` cell, which is every other caller, `w-full` resolves and
  nothing moves. **Several `InlineValue`s side by side therefore need a PEN
  EACH** — `min-w-0 flex-1 overflow-hidden` on a wrapper the component cannot
  escape, with `w-full` passed down — rather than a width class on the
  component. Verified by measuring: editing the low box leaves the input at
  47px and the two beside it exactly where they were.
- **EVERY LIST SCREEN'S HEADER IS `ui/PageHeading`. THIS IS THE DEFAULT — a new
  page uses it without being asked** (Mark, 2026-09-03: "I like this the best
  and think we should copy it to the other sections of the app", then "make a
  note in CLAUDE.md that this is the default way to code a header so future
  pages follow it"). The title, then ONE small-caps 12px `text-subtle` line
  under it reading **shop first**: `DF02 · 29 of 80 vendors`. It began as
  `PurchaseOrderList`'s header, which he named as the model.
  **THE LINE REPLACES ANY DESCRIPTION** — his words, and it is the part most
  likely to be undone by accident. Every prose sentence that stood under a
  title is gone, including the seven he had written himself hours earlier; a
  header is a title and a count, and nothing else.
  **THE COUNT IS THE FILTERED ONE** — what is on screen now, out of everything
  the screen could show — which is why the header usually lives in the LIST
  COMPONENT rather than the page: that is where the filters are. Where a screen
  genuinely cannot reach it (`/checklists`, whose filters sit below the view
  tabs; `/benefits`, `/prices`, `/timesheets`, `/sales`, which do not filter at
  that level), `visible` is omitted and the line states the total alone.
  **THE HEADER CARRIES NO COMMAND. THE CREATE BUTTON GOES IN THE FILTER ROW,
  RIGHT-ALIGNED** (Mark, 2026-09-03: they "are all over the place. Sometimes in
  the header area, sometimes lined up with the filter tabpicker objects,
  sometimes next to the eye button above a datatable… I think they should be in
  line with the search field and filter tabpickers"). `ml-auto` on the last cell
  of the row that holds the search box and the tab pickers, which lands it on
  the page's right edge — the same pixel as the columns eye (measured, 1232 at
  1280) — and bottom-aligns it with the controls beside it.
  **THE ROW IS THE ONE WITH THE SEARCH BOX IN IT, not a tab picker on a line
  below** (Mark, 2026-09-03, on `/employees`). Where a list has no search and no
  tabs at all (`/payroll-benefits`) the command's own strip above the table IS
  that row — outside `DataTable`'s `leading`, which would leave it 48px short of
  the edge. And the SEARCH BOX COMES FIRST in that row, before the tiers, which
  is the order every list uses (`/shift-reports` had it after and was corrected).
  On a `ui/FilterMenus` bar the slot is **`rowAction`** — the last cell of the
  MENU row — where `trailing` puts it on its own line above; a caller passes one
  or the other. On a bar wide enough to wrap, `ml-auto` lands it at the end of
  whatever line it falls on, which is still right-aligned and still in the
  filter block (`/elements` and `/batch-logs` both do).
  **THE FILTER ROW LIVES OUTSIDE `DataTable`, NOT IN ITS `leading` SLOT**, and
  this is the one that looks like nothing and is not (Mark, 2026-09-03, twice:
  Plans "looks different, almost like the filter row and datatable are merged",
  and then on Items "the new item button isn't aligned all the way to the
  right"). `leading` is a `min-w-0 flex-1` cell with the columns eye beside it,
  so a row in there is 48px narrower than the page and `ml-auto` cannot reach
  the edge — measured, 1169 against 1217. Out here it is the full content width
  and the eye keeps its own strip. Eight lists were lifted.
  **AND `FilterMenus` STOPS STATING THE COUNT WHERE THE HEADER DOES** —
  `showCount={false}`, because that bar's "N of M noun" is now the same fact
  three inches under `PageHeading`'s. All five callers pass it.
  `PageHeading` still takes an `action` and a few screens still use it;
  everything Mark has named is converted.
  A list that owns the heading has to RENDER EVEN WHEN EMPTY either way, or an
  empty shop gets no title and no way to make its first record (`/plans` and
  `/schedules` both had that hole).
  The org-wide screens pass no `code` — Employees, Events, Timesheets,
  Benefits, Locations, Sales and the production catalog are not scoped to a
  shop, and naming one would be a claim the screen does not make.
  The one surviving `note` is `/batch-logs`' two empty-window sentences; the
  plans list's "1 more plan is made at another kitchen" was kept for one commit
  and then deleted (Mark), and its prop went with it.
  Applied 2026-09-03 to all 24 list screens. `/purchase-orders` and `/invoices`
  keep their own header markup because they carry a Window total beside it.
- **A NAV LABEL AND A PAGE TITLE NEED NOT MATCH** (Mark, 2026-09-03, asking
  outright). Nothing couples them — `lib/nav.ts` holds one, the screen holds the
  other — and the two have different jobs: a nav tier is a narrow strip where a
  short label earns its place, a title is where the full name reads. Hence
  **Maintenance** in the band over **Maintenance Requests** on the page. The
  SLUG is a third thing again and must not move: `rf.nav` stores it.
- **THE SCREEN EXPLAINS ITSELF. STOP WRITING HINTS** (Mark, 2026-09-03: "stop
  adding extra comments and hints, or make them super terse at the very least.
  Most of them have been unnecessary"). Said after a run of removals that were
  all the same mistake: a sentence under a control describing what the control
  plainly is. Page 8 alone carried three — one under the blockers box saying the
  blockers were urgent, one under the outstanding box saying it was not a gate,
  one saying Square had not reported yet. The heading, the colour and the border
  had already said all of it.
  Ship a line ONLY if it states a fact the reader cannot see. Not what a button
  does, not why a rule exists, not where else in the app something lives, and
  never a reassurance. Where a line does earn its place, write it as short as it
  can be and stop.
  The reasoning belongs in a code comment, where it is free.
  **IT SITS UNDER THE TITLE, IN THE TITLE'S OWN `space-y-1` BLOCK** — 4px, not
  the page's `space-y-6` (Mark, 2026-09-03: the production ones "appear lower
  than they do for the facilities module"). `/plans` and `/schedules` had theirs
  as a SIBLING of the title ROW, so it inherited 24px and read as a line about
  the list rather than about the heading. With a create command still beside the
  title the row becomes `items-start` over a `space-y-1` block holding both.
  Audited across the app afterwards: those two were the only real cases — the
  other candidates are role-refusal blocks, which are already tight.
  **A ONE-LINE STATEMENT OF WHAT A SCREEN IS *DOES* EARN ITS PLACE** (Mark,
  2026-09-03, putting them back the same day: "a leaner version"). Every
  Facilities list carries one under its title again — *"The physical layout of
  your shop."*, *"Items to be completed by the team."*, *"Health and physical
  inspection reports."* — and that is not the rule bending. What went was the
  PARAGRAPH explaining how a screen works, where findings go, which of two
  screens a thing belongs on, what a blank field means; what came back is a
  sentence naming the subject, which a title alone cannot always do
  ("Equipment" of what? "Tasks" for whom?). **The words are Mark's own, verbatim
  bar one lowercase**, and they are the length to copy: one sentence, no
  clauses, no second sentence about mechanics.
- **IT IS A PAY PERIOD, NEVER A "FORTNIGHT"** (Mark, 2026-08-23: "stop
  referring to pay periods as 'fortnights'. It's a pay period. say 'pay period'
  please"). This was already the rule for VISIBLE STRINGS when `/timesheets`
  shipped; it now covers comments, commit messages, the headers of NEW
  migrations, and how you talk about it — but NOT a migration that has already
  been applied, which is history under 055's rule and stays exactly as it was
  run. (063 and 064 each carry the old word; 064's is inside a `comment on
  function` string literal, so rewording it would have changed executed SQL for
  a word nobody reads.) `pay_periods` is what the table is called, "pay period" is
  what payroll software says, and it is the phrase the business uses — where
  "fortnight" is a synonym that happens to be true of a 14-day cadence and
  would quietly become false the day one changes.
  The word is still correct for a plain TWO-WEEK WINDOW that is not a pay
  period — the production item's two-week history, for instance — but prefer
  "two weeks" there too, so nobody has to judge which sense is meant.

- **USE THE PARTS THAT EXIST — don't hand-roll a second one.** This app has no
  component library by design (Next ships none, Tailwind ships none), so every
  shared control is one we wrote and every one of them encodes a decision that
  was expensive to reach. Reaching for a raw `<input>`, `<select>`, `<table>`,
  a floating panel or a bespoke button is nearly always a mistake — and one
  that shows, because the second version never behaves quite like the first.
  The inventory, with the rule each embodies (details in the bullets below):

  | Reach for | Instead of | For |
  | --- | --- | --- |
  | `ui/PickList` | `<select>`, free text | choosing from a known vocabulary — a VALUE or a filter's VIEW; `variant="inline"` in a cell, `variant="field"` as a standalone box, `variant="masthead"` on the black bar (yellow type, no box — the working-location picker, whose dress it is; build step 4b has the reasons). Opens below the field, portals so panes can't clip it; `panelMinWidth` raises the panel's floor where the trigger is much narrower than the rows it opens. **`size="lg"`** is the 48px/16px dress for a TABLET-FIRST surface (the shift report) — a PROP, not a `className` override, because Tailwind resolves competing utilities by STYLESHEET order so a caller's `h-12` cannot be relied on to beat the component's `h-9` |
  | `ui/Dialog` | a hand-rolled overlay | every floating dialog; pins its title bar and footer, scrolls only the middle, and neutralises the properties it inherits from its trigger. `DIALOG_CANCEL/COMMIT/DANGER_CLASS` for the footer buttons; `onSubmit` makes Enter commit (opt-in — see the Enter bullet below) |
  | `confirmDialog()` from `lib/confirm` | `window.confirm` | EVERY confirm (Mark, 2026-08-10: the browser's dialog "takes me out of the app experience"). A promise — `if (!(await confirmDialog({ title, body, tone: "danger" }))) return;` — so the handler becomes async; `splitConfirmMessage(msg)` spreads a one-string message into title + body. `ui/ConfirmDialog` is the panel and only the (app) layout touches it. Enter does NOT commit a `danger` confirm (it focuses Cancel), which is `ui/Dialog`'s rule applied |
  | `ui/MenuButton` | a button you wire to your own popup | a button that opens a short list of COMMANDS — the anchored menu with the trigger left to the caller. A menu, not a `PickList`: every row is a verb that happens once and leaves nothing selected, so the trigger's label never changes. `ui/RowMenu` is the `⋯` dress over it; a command bar passes words and `BUTTON_CLASS` |
  | `ui/RowMenu` | a `⋯` you wire yourself | a table row's own commands — `ui/MenuButton` wearing `⋯`, so it escapes scroll panes and flips near the window's foot exactly like `PickList` |
  | `catalog/InlineValue` | a hand-wired edit-in-place, or a bare `<input type="date">` / `<input type="time">` | any editable cell — `kind` text / number / date / **time** / **pick** (`time` delegates to `ui/TimeField` and, like `date`, does NOT click-to-edit — the native control is already a box you can type into and a picker on an iPad); `multiline` for prose (textarea, ⌘↵ saves); `jsonColumn` + `jsonPath` + `jsonDocument` to edit a key INSIDE a jsonb column; `arrayColumn` + `arrayIndex` + `arrayStrip` + `arrayWidth` to edit ONE SLOT of a Postgres array (the `par_by_weekday` idiom, which had no editor until the recipe sheet). An array column CONSTRAINED against a sibling array must write both in one statement — that is what `alsoUpdate` is for. `emptyClassName` styles the cell when it holds NOTHING (faint by default; the plan matrix wants a yellow "—", and a caller CAN'T do this through `className`, because Tailwind resolves competing utilities by stylesheet order); `ariaLabel` names the cell where no `<dt>` does — a grid of identical cells otherwise all announce as "—, click to edit". **`onWrite` replaces the UPDATE and nothing else** — for a column whose rule is COLUMN-scoped and so lives behind a definer function (044's `made`/`leftover`); without it the cell issues a plain update that matches zero rows, returns NO error, and silently loses what was typed |
  | `useCalcField()` spread on the input (`ui/CalcPad` is already mounted) | `inputMode="decimal"` plus your own operator affordance | letting a numeric field take a `lib/calc` expression ON A TOUCH DEVICE. iOS renders `inputMode="decimal"` as the number pad, which has no operators, and on iPadOS `*`/`+`/`×`/`÷` are two keyboard layers deep — so on touch the field asks for NO system keyboard (`inputMode="none"`) and CalcPad supplies one that has them, with a live readout of what the expression comes to. The spread is the whole wiring; it writes through the native value setter, so a controlled React input needs no code. **Half a keyboard bolted to Apple's was tried first and Mark's verdict on hardware was "clumsy and awkward"** — don't reach back for it. Spread it ONLY on fields `evaluateNumeric` reads: several others carry `inputMode="decimal"` and parse with a plain `Number()`, where an inserted `×` is a value that can't save |
  | `ui/PageHeading` | a hand-styled `<h1>`, or a title plus a description | EVERY list screen's header — the title over one small-caps line reading shop first, `DF02 · 29 of 80 vendors`. The count is the FILTERED one, so it usually lives in the LIST component; `visible` is omitted where a screen cannot reach it. `code` is dropped on an org-wide screen. It takes no create command any more — that goes in the filter row |
  | `ui/SectionHeading` | a hand-styled `<h2>` | the heading over a block on a detail screen (16px bold black, optional `count`) |
  | `ui/TabPicker` | underline tabs, loose chip rows, hand-rolled segmented bars | every one-of-N choice — filters, scopes, view modes; the order guide's segmented style. Selected cell is ALWAYS black; `count` and `href` are the only options |
  | **`ui/FilterMenus`** + `lib/filterMenus` | several `TabPicker`s stacked, or a row of hand-wired `PickList`s | a list filtering on THREE OR MORE dimensions AT ONCE — a row of labelled popup menus that AND together ("FilterMenus" is the name to call it by; NOT `catalog/ListFilters`, which is the older fixed search+category+active row). A dimension declares `matches`, never a pre-filtered list, which is what makes the option counts CONDITIONED ON THE OTHER MENUS (and never on their own, or every option but the chosen one reads 0). "All" is supplied, not declared; the bar owns the result count and a Clear, because four collapsed menus can hide a list while the screen looks unfiltered. Values live in the URL via `parseFilterValues`/`filterHref` + `history.replaceState`, and a value no option offers is DROPPED rather than obeyed. ONE dimension stays a `TabPicker` — this is not a replacement for it | The **`trailing`** slot holds a list's create command and renders RIGHT-ALIGNED ON ITS OWN LINE ABOVE the menus — it rode at the END of the filter row until 2026-08-21, which reads well only while the row fits, and `/special-orders`' search box plus six menus want ~1439px against the 1376 a 1440 window gives, so on an ordinary laptop the one control you came to press had already wrapped BELOW the filters. Its own line always, rather than a breakpoint: the wrap depends on how many menus a caller declares, so any threshold is tuned to one list and wrong for the next |
  | `ui/TextInput` | `<input type="text">` | wide free-text fields; carries the ✕ clear. Its wrapper **SHRINK-WRAPS** so a search box's `w-72` on the input decides the width — which is why **`w-full` alone does nothing**: it resolves against a span that is itself sized by the input, and the pair settles at the input's intrinsic ~20-character width. **`fullWidth`** is how to fill a form's track, and it has to say it twice (wrapper AND input) because an input in a flex row does not stretch on its own |
  | `ui/PickSet` | a row of checkboxes | choosing SEVERAL from a known vocabulary — the shops a member may work at, a filter over locations. **EMPTY MEANS ALL**, which is 073's own rule and why that grid needed no teaching. `boxed` is `PickList`'s prop doing PickList's job: a detail FIELD wants the hairline that blackens on hover, a filter row wants the standing black rule |
  | `ui/DateField` | `<input type="date">` | EVERY date box, the PUBLIC pages included. Carries the Safari empty-date apparatus (see the date bullet); `InlineValue kind="date"` wraps it, a create form uses it directly, and **`variant="field"`** (`PickList`'s prop name, same dense-cell-vs-form-box distinction) is the bordered `h-12`/16px dress the inquiry form wears |
  | `ui/TimeField` | `<input type="time">`, or a `TextInput` you parse | a time of day in a CREATE form, where the box starts empty and the value is required — `type="time"` yields `HH:MM` or nothing, so a half-typed value can never reach a `time` column as a cast error. It carries NO empty-state apparatus, deliberately: DateField needs one because WebKit paints TODAY into an empty date, and an empty time renders as placeholder segments. An edit-in-place cell on a value already set stays `TimeCell`, which takes free text and lets Postgres parse it. It mirrors DateField's **`variant`** for that component's own stated reason — the two sit side by side, so a bordered time beside a borderless date reads as one of them being broken |
  | `ui/Checkbox` | `<input type="checkbox">` | every checkbox, no exceptions |
  | `ui/Switch` | a rounded div you style yourself | every switch. Black on, and off is the EXACT inverse; `size="sm"` for a dense grid row. Presentational only — the write, the optimism and the error state belong to the caller, because `ActiveToggle` and the recipe sheet's AUTO switch disagree about all three |
  | `catalog/DataTable` + `ColumnHeader` | `<table>` | every list: sort, resizable columns, sticky head, 56px rows, pane scroll memory. `group.summary` puts a SUBTOTAL under each run and **`totals` puts a GRAND TOTAL under the whole table** — both return a map KEYED BY COLUMN, never a ReactNode, so the figures stay under the headings they sum when a column is hidden or dragged (Mark, 2026-08-05: "the values should align with their columns"). `totals` is handed the rows the table is SHOWING, so it agrees with a search rather than reporting the whole set. **`openRowKey` opens one row from OUTSIDE** — a nudge, not control: the table keeps owning which rows are open and this only ever ADDS, applied by adjusting state DURING RENDER so the row is already open on the frame that paints. Every `<tr>` carries `data-row-key`, so a caller can find it to scroll to |
  | `catalog/ActiveToggle` | a bespoke switch | the Active column, which leads every catalog table |
  | `catalog/WeekdayPicker` | seven buttons | any day-set; its column must be `WEEKDAY_PICKER_WIDTH` |
  | `catalog/ListFilters` | a filter row | search + category + active + last-ordered, together |
  | `catalog/BaseUnitEditor` | writing `base_unit` | changing a unit — it recomputes package contents and warns about pars |
  | `catalog/InventoryItemPicker` | a search box | finding and linking an inventory item |
  | `catalog/InventoryItemChooser` | a second search box | finding an inventory item WITHOUT writing one — a create dialog has no row to update yet, and one that wrote before you pressed Cancel lies about what Cancel means (`CustomerPicker`'s rule). Value + onPick; `InventoryItemPicker` is the writing sibling |
  | `ui/ActionBar` + `ActionBarButton` | a button row | screen-level COMMANDS only (not view controls) |
  | `ui/PageLoading` | a spinner | the body of every `loading.tsx` |
  | `ui/ProgressBand` | a word in a button's label | something slow on a screen that's ALREADY painted (an invoice read is 30s+); same indeterminate bar, never a Dialog — the work behind it must stay usable |
  | `ui/Pane` + `PaneHeader` | a bordered div with a header band you style yourself | a framed column standing beside another (receiving's document + lines): one FIXED-height band so the two rules line up, and `overflow-hidden` so nothing paints over the frame |
  | `ui/DocumentChip` | a bordered div with a thumbnail strip | a filed document in a list — PO attachments, employee paperwork. Full-bleed preview (image, or PDF via `<object>`) with the text semi-opaque over it; the plugin is `pointer-events-none` and a transparent anchor takes the click |
  | `ui/StickyFooter` | a hand-placed `fixed bottom-0` div plus a guessed spacer | a band pinned to the foot of the window — PO paperwork, employee paperwork. MEASURES its own height into a spacer so the page's last block doesn't slide under it, minus what already follows (the layout's `py-8`), and fires a `resize` so `useFillViewportHeight` reclaims space when it SHRINKS |
  | `ui/RevealPanel` | a section that is always fully open, or a hand-rolled hover-expand | a block whose body costs more screen than it earns — both paperwork areas. Header always visible (title, count, Add as, Attach, progress, errors); the body opens on hover, on focus, or from a pinning toggle, and is ABSOLUTELY POSITIONED so it never reflows the page. **`alwaysOpen`** drops the toggle and puts the body IN FLOW, for when the panel gets a screen of its own and the crowding it was hiding from is gone |
  | `ui/fieldMetrics` `FORM_TEXTAREA` (or `FORM_FIELD_DRESS`) | a hand-typed `border border-ink bg-white …` | a multiline field in a dialog. `FORM_TEXTAREA` is the whole dress at the app's 14px form size, filling its track; `FORM_FIELD_DRESS` is the same border/ground/focus/padding WITHOUT a width or a font size, for a field in a label/field grid that supplies its own (the PO and special-order compose bodies, which inherit 16px on purpose — a big writing surface for a message about to be sent). **The padding cannot be overridden** — Tailwind resolves by stylesheet order — so a field wanting different padding writes its own dress, which is what the public pages do at `px-3`/`text-[16px]` (below 16px iOS Safari zooms on focus). Extracted after seven hand-typed copies had drifted into two |
  | `ui/buttons` `PRIMARY_BUTTON_CLASS` | a black class string you type yourself | the ONE case where a command button on a SCREEN is filled black — a record in an abnormal state with exactly one way out (a flagged order's "Resolve the issue"), or a screen whose ONE obvious next act depends on its state — the timesheets screen fills **Import timesheets** while the pay period is empty and **Close pay period…** once it has shifts, and never both (Mark, 2026-08-22). `DIALOG_COMMIT_CLASS`'s argument outside a dialog; only ever right CONDITIONALLY, never as a screen's standing "primary" |
  | `ui/buttons` `DANGER_BUTTON_CLASS` | re-typing the red class string | any destructive command out on a screen — Delete, Void, "Deactivate everywhere". Red EVEN THOUGH most only open a confirm: a reader can't tell "opens a confirm" from "destroys" by looking. Bordered, never filled. NOT the same as `DIALOG_DANGER_CLASS` (`px-5`, a dialog footer's commit) — don't merge them. Positional classes stay at the call site |
  | `ui/FileDropZone` | `onDrop` on a div | dropping files onto a region. Its OVERLAY takes the drop (a PDF `<object>` is a plugin and swallows drag events — confirmed working over a live PDF, Mark 2026-08-04), it arms off WINDOW drag events so it's up before the pointer arrives, it vets types itself (`accept` governs only the picker), and it stops a stray drop navigating the page away |
  | `ui/SectionNav` | a second sidebar, underline tabs, or a `TabPicker` turned sideways | **the sections of one detail record** — the employee screen's Info · Employment · Events · Documents · Admin. Plain text links, no box: active bold black, inactive `text-muted`. `orientation="horizontal"` is the narrow-screen form. See "A detail screen that outgrows one page" below — REUSE THIS, don't re-derive it |
  | `ui/RecordNav` + `lib/recordSet` | going back to the list for the next record | FMP's book on a detail screen: the LIST publishes its found set, the detail walks it |
  | `DataTable columnChooser` | a bespoke checklist, or placing `ColumnsMenu` yourself | show/hide columns on a list — the table puts it above its own last column header; pair it with `DataColumn.pinned` on the column that IS the row |
  | `ui/BackToTop` | — | long lists; already on the guide |
  | `components/Breadcrumbs` | a back link | every detail screen, unconditionally |

  Free for nothing, because the shell already does it: **scroll restoration**
  (`components/ScrollMemory` in the (app) layout — a new screen is covered by
  existing) and the **sticky masthead** (`HeaderShell`, which publishes
  `--rf-header-h`). Vocabularies and conversion live in `lib/units.ts`
  (`UNIT_PICK_OPTIONS`, `PACKAGE_DESC_OPTIONS`); the other shared brains are
  `lib/breadcrumbs`, `lib/columnWidths`, `lib/tableSort`, `lib/calc`,
  `lib/scrollMemory`, `lib/shiftFocus` (one screen asking another to jump to a
  row, when the two are SIBLINGS under a server component and no prop can
  reach — `useSyncExternalStore` over a module value, `lib/navMemoryStore`'s
  shape; it carries a NONCE so asking twice for the same row still notifies).

  If something genuinely new is needed, build it in `components/ui/` as a
  general control, use it in at least the place that prompted it, and add a row
  here — that is how this list came to exist.
- **The look is the `restaurantfriend-design` skill** (a user skill, outside
  this repo — read `handoff/PORT-GUIDE.md` §8 FIRST, then `readme.md`, then the
  relevant `<Name>.prompt.md`). Applied wholesale 2026-07-25: black masthead,
  square corners, no shadows, no blue, colour only ever means record STATE
  — and yellow means it as a FILL and never as text; see the yellow bullet below.
  Tokens live in `web/src/styles/ds/` (copied from the skill) and are exposed to
  Tailwind v4 through `@theme inline` in `globals.css` — use the semantic
  utilities (`text-ink`, `text-muted`, `border-hairline`, `bg-go`, `text-accent`)
  over raw `neutral-*`. **The DS import MUST carry `layer(base)`**: Tailwind v4
  layers its utilities, unlayered CSS outranks layered CSS regardless of
  specificity, and an unlayered `base.css` makes its `a { color: black }` beat
  every `text-white` — the white nav on the black masthead silently renders
  black. House rules the port settled (Mark, 2026-07-25 — the design system's
  own sources are updated to match, so don't "restore" them):
  **switches are black and white**, off = the exact inverse of on (white track,
  black knob), and a switch is never tinted to say what it does — its label
  does that; **table rows carry no dividing rule** (56px rows + hover wash;
  rules that DELIMIT — the head's 2px, a group strip, an expanded row — stay);
  **every checkbox is `components/ui/Checkbox.tsx`**, never a raw
  `<input type="checkbox">`; the **ActionBar carries commands only** — a control that changes what a list
  SHOWS goes with that list's filters — and its cells are **all plain black**
  (Mark, 2026-07-26): `ActionBarButton` still has a `primary` white-fill
  variant, but nothing uses it, because against the bar's own black a white cell
  read as a different kind of object rather than as the important one.
- **A DETAIL SCREEN'S EDITABLE FIELDS WEAR A BOX — read
  `docs/detail-field-styling-brief.md` before restyling one.** Proven on
  `/special-orders/[id]` (2026-08-28) and adopted for every record screen
  (Mark: "the experiment is successful and I want to go through the app and
  update all detail pages in this way").
  A record is a `dl` of grey labels beside black values, and the app's dotted
  underline is the quietest possible "editable" — right in a dense table where
  the heading and the rules already bound each field, and not enough on a
  record, where labels and values are both just text and the underline marks
  only the LAST line of a wrapped value (Mark: "I'm having trouble
  distinguishing editable from non-editable, and fields from labels. The page
  just looks like a lot of text").
  **THE BOX MEANS "YOU CAN CHANGE THIS", so a read-only value never gets one** —
  that is the whole distinction being drawn and the one thing not to blur. The
  underline comes OFF with it (two cues for one fact; the second reads as an
  artefact), an empty field shows NOTHING (no em dash, no example text — inside
  a box a grey hint reads as a value somebody typed), and a multiline field
  keeps its 64px floor because the box says "editable" where the height says
  "put a paragraph here".
  `ui/fieldMetrics` is the one dress AND the app-wide `BOXED_FIELDS` switch
  (Mark, 2026-08-28) — **`min-h-9` and `w-full`**, a MINIMUM because a
  short-text cell still wraps and a definite height spills it past its own
  border. **36px is the app's OWN field height**, which `TextInput` says in its
  own comment and every button already uses, so a field, a command button, a
  filter tab and a form input are now one height everywhere.
  It shipped at 32px first ON A PREDICTION NOBODY MEASURED — that 36 would cost
  the measured four-quadrant record "~68px per column". Measured, the panes that
  scroll absorb it: Completion dates went 160px to 152, EIGHT pixels, and a
  21-line table grew ~5px a row. What 32 cost instead was the thing the boxes
  exist for — 23 fields at 32 under 8 buttons at 36 is a near-miss rather than a
  contrast. `h-8` stays a real member of the scale (`TabPicker size="sm"`, "for
  tight bands"); a record is not a tight band.
  Width is THE TRACK, never a scale — the `dl` already defines the columns, so a
  block's fields share a left and a right edge with no numbers to keep in step —
  **and the block itself takes at most HALF the content column, a quarter where
  the fields are few and short** (Mark, 2026-08-28: a block running the full
  width of a 1280 window is a 1,100px box holding the word "Purchased").
  Written as a ceiling over a floor — `max-w-[min(42rem,max(24rem,50%))]`, and
  `min(28rem,max(17rem,25%))` on `/elements` — because the percentage resolves
  against the CONTENT COLUMN so it really is half the screen, the `min()` stops
  a wide monitor making half absurd, and the `max()` keeps the fraction a
  CEILING rather than also a floor: half of a portrait iPad's content column is
  385px, which a four-track grid divides into ~20px a field.
  **ALL FOUR CONTROLS TAKE `boxed`** — `InlineValue`, and the `PickList`,
  `DateField` and `TimeField` it hands down to — or a page boxes its typed
  fields while its pickers and dates stay underlined, which reads as those not
  being editable. A caller normally touches only `InlineValue`.
  The traps are in the brief and every one of them is invisible in review; the
  two that recur most are that **an `inline-flex` wrapper eats `w-full`** (the
  control comes out the width of its value — a boxed date sat at 144.5px among
  214.3px fields) and that **the Sizer must wear whatever the resting state
  wears**, or clicking a cell moves it. Verify by MEASURING, not by eye: one
  height, one left and one right edge per block, nothing overflowing its box,
  and a click that moves the field 0.00px in all four axes.
  Gaps group: on a record whose blocks are two-track grids the reader sees FOUR
  columns and only the middle gap is a change of subject — **24px inside a
  block, 96px between** (all three at 40 read as four unrelated columns).
  **LISTS ARE A SEPARATE QUESTION and default to NO**: a `DataTable` already has
  headings and rules doing the box's job. The special-order Items table is boxed
  because it is part of a record, and even there it is the busiest result.
  **THE ROLLOUT IS DONE (2026-08-28)** — all fourteen detail screens, 31 files;
  §9 of the brief is the per-screen record of what was converted and what was
  deliberately left. Four things it taught, none of them in the original brief:
  an **editable `h1` title KEEPS ITS DOTTED UNDERLINE** and is the one exception
  to the whole convention — boxed and reverted the same day (Mark, 2026-08-28:
  "box the h1 titles too", then "I changed my mind on the h1 block. go back to
  underlines on those only"). The box is what tells a FIELD from a LABEL, and an
  `h1` is neither: it is the record's name at 28px with nothing beside it to be
  mistaken for, which is the condition the underline was always right in. If it
  is ever tried again, a boxed title HUGS ITS OWN TEXT (`w-full` in the
  shrink-to-fit row it shares with the Active toggle) and comes out ~41px, since
  28px type has a taller line box than `min-h-9`, and `items-baseline` on those
  rows has to become `items-center`; **a converted
  screen's other editable controls come too**, because the inventory was built
  from `InlineValue` call sites and `/locations/[id]` also carries fourteen raw
  `<input type="time">` at 30px and seven unboxed `PickList`s — grep cannot see
  those, so LOOK before calling a screen done; **a block's track is a fact about
  the SCREEN**, so the employee record's Payroll block took the Employment
  block's `max-w-md`/`8rem` rather than keeping its own `max-w-2xl`/`10rem`,
  which underlined was invisible and boxed is two different edges; and **a
  stand-in word is example text and goes** — `fieldPlaceholder` only suppresses
  the em dash, so ~25 `placeholder="none"`/`"unknown"`/`"still here"` came out by
  hand, while real DATA stayed (`locations.public_name` shows the internal name)
  along with the three hints in `VendorItemFields`' Package row, where ONE label
  sits over THREE boxes.
  Known cost, accepted: **`/batch-logs/[id]`'s detail pane shows about three
  fields before it scrolls** — it was already scrolling and is drag-resizable,
  but it is the one place the 36px rule is visibly expensive.

- **USE LITERAL TYPOGRAPHIC CHARACTERS IN JSX TEXT, NEVER HTML ENTITIES**
  (found 2026-08-30). **SWC strips the leading whitespace of a JSXText node that
  contains an entity**, so a `&rsquo;` anywhere in a paragraph silently deletes
  the space after an interpolated value ELSEWHERE in the same run:
  `What a walk at {active.code} asks for` rendered **"at DF01asks for"**, with
  the entity two lines below the missing space. It is invisible in review — the
  source is correct, and the same shape renders fine in a paragraph with no
  entity, which is what makes it hard to believe. Proved by swapping `&rsquo;`
  for `’` and diffing the compiled chunk: `"asks for…"` became `" asks for…"`.
  Write `’ ‘ “ ” — –` directly; `react/no-unescaped-entities` does not object to
  any of them (it only wants `' " > }` escaped).
  **STILL PRESENT IN SIX SHIPPED FILES and not swept**: `ShopSectionsTable`
  (its empty state reads "at DF01yet"), `DerivedDay`, `RecalculateWorkdays`,
  `BaseUnitEditor`, `FixDrawer`, `PlanMatrix`. Fix them as you touch those
  screens. Find candidates with a `{expr} word` on one line whose text run also
  holds an entity.
- **A SHARED CLASS STRING STATES LAYOUT; EACH CALLER STATES ITS OWN COLOURS**
  (2026-08-30). Tailwind resolves competing utilities by STYLESHEET order, which
  this file already says in four places — the new corollary is that a shared
  constant must therefore not CARRY a colour, because appending one at the call
  site does not override it. A `FOOTER_CELL` holding `text-white` with
  `bg-white text-ink` appended shipped a WHITE-ON-WHITE commit button on the
  checklist runner's black footer: invisible, and at a glance the footer simply
  looks like it has one button. Caught by reading `getComputedStyle`, not by
  looking. Measure a colour you composed; do not trust the class string.
- **`flex-wrap` ONLY HELPS WHEN A CHILD CAN CLAIM THE NEXT LINE** (2026-08-30).
  A `flex-1` child has a basis of 0, so a `shrink-0` sibling that wraps
  INTERNALLY keeps its full width and squeezes the flexible one to nothing —
  the two then render on top of each other. The checklist runner's rows did
  this at 375px from the day they shipped, invisible because the screen was only
  ever checked at desktop width. `flex-col sm:flex-row` is the fix, and
  **checking every new row at 375 is the habit**.
- **YELLOW IS A FILL, NEVER AN INK — do not use `text-mark` on a light
  background** (Mark, 2026-08-22: "I find yellow text hard to read… a yellow
  filled square works as an attention signal, but not yellow text"). This is a
  measurement, not a preference. `--color-mark` is yellow-500 on white:
  **1.43:1**, where WCAG AA wants 4.5 for body text. Darkening it does not
  rescue it — yellow-600 is 1.88, yellow-700 is 3.33, and the first value that
  passes is yellow-800 at 6.95, which is a dark olive that no longer reads as
  yellow at all. **There is no readable yellow text on white in this palette**,
  so the answer is the fill: `bg-mark-fill` is yellow-200 with ink on it at
  **15.53:1**.
  So, for anything that wants an eye on a light background:
  a SHORT mark is a chip — `<span className="bg-mark-fill px-1">` — and a
  SENTENCE is plain ink, because a paragraph-sized yellow block is a banner
  rather than a mark. What a mark must never be is yellow words.
  **The one place `text-mark` is right is on BLACK**: the masthead's
  working-location picker is yellow-500 on ink — measured **14.67:1**, against
  7.37 for an inactive tab beside it, so it is the brightest thing up there
  short of white. It is the app's mark for WHICH SHOP YOU ARE AT, and it is
  where that mark lives now: `AppNav`'s location TAB wore it until 2026-08-27,
  when the picker took the code off that tab and the yellow went with it.
  **And check the thing isn't already marked before marking it** (Mark, same
  day: "the yellow text seems redundant — there's also a yellow box on the same
  sheets"). The timesheets row expansion restated three findings the row already
  carried as fills four columns away, which added nothing and buried the marks
  that had nowhere else to appear. A fact gets ONE mark, next to the number it
  is about.
  **The detail screens are swept (2026-08-28)** — `ElementFields`, `PlanDetail`,
  `ScheduleDetail`, `PlanMatrix`, `ScheduleLines`, `ItemComponents`,
  `ProductionItemHistory`, `BatchLogRecord`, `EmployeeDetail` and
  `EmployeeDocuments` (both of those `--rf-yellow-600`, 1.88:1) and
  `CustomerStatement` all carry fills now. **About 20 uses remain and they are
  all on LISTS and on `/production-day`** — `DerivedDay` (5), `SchedulesList`,
  `PlansList`, `RecipesList`, `BatchLogsIndex`, `ProductionItemsList`,
  `SpecialOrdersList`, `EmployeesList`, `GenerateSchedules`,
  `specialOrders/CustomerPicker`. Each needs the same judgement — redundant with
  a fill elsewhere, a short signal, or a sentence — so fix them as you touch
  those screens rather than in one mechanical pass.
  **GREEN HAS THE SAME PROBLEM AND NOW HAS ITS OWN INK TOKEN** (Mark,
  2026-09-03, on the shift report's Sales page: the Change column's green is
  "too light to read"). `--color-go` is `--rf-green-200` — the fill sampled off
  FileMaker's order box — and as text on white it measures **1.35:1**, which is
  the yellow measurement again. So `--color-go-ink` (`--rf-green-600`,
  **5.34:1**) is the counterpart of `accent` (red-500, 5.61:1) on the other side
  of a comparison, and the pair now mirrors the red one: `stop`/`go` are FILLS,
  `accent`/`go-ink` are INKS. `text-go` had exactly ONE caller in the app and it
  was this bug; if a second appears, it is almost certainly the same mistake.

- **A CONTROL YOU PRESS FILLS GREY ON HOVER — `hover:bg-neutral-100`** (Mark,
  2026-09-04, on the checklist template record: Kind "fills grey and the border
  becomes black", where Shifts "become[s] black with no grey fill… I think
  filling grey is the preferred behavior"). The wash is the app's one "you can
  press this" cue, and it is the answer to the pointer, where a BORDER that
  darkens is a resting cue about the field's own kind (`BOXED_FIELD_BORDER`
  says "editable"). A control that only darkens its border is answering half the
  question.
  **WHAT TAKES IT**: every `PickList` trigger (`field` and `inline`), `PickSet`,
  `InlineValue`'s resting button, `DateField` and `TimeField` in their cell
  dress, a `TabPicker`'s unselected cell, a `WeekdayPicker`'s unselected day,
  `DataTable`'s row expander and `RevealPanel`'s toggle (which is that expander
  to the pixel), `RowMenu`'s ⋯ and the columns eye.
  **WHAT DOES NOT, and each for its own reason**: a BUTTON, which fills BLACK
  (`BUTTON_CLASS`) — or `neutral-800` when it is already black
  (`DIALOG_COMMIT_CLASS`), so a black commit still answers; a SWITCH, a CHECKBOX
  and a RADIO, whose affordance is the thing that moves or fills; and a TEXT
  INPUT (`TextInput`, and the order guide's quantity boxes), because you type
  into it rather than press it — and on the guide a wash would fight the
  three-state colour those boxes carry, which is a state and outranks a hover.
  **A SELECTED cell never washes** — it is already filled, and a wash on top
  would say the pointer had changed something.
  `PickSet` also gained `w-full` when `boxed`, the other half of the same report
  ("It is also not as wide as the other fields"): a boxed field fills its track,
  which is what `BOXED_FIELD` says. That made `LocationAccess`'s `fullWidth`
  prop dead, so it is gone rather than left saying something it no longer
  decides.

- **EVERY BUTTON IS WHITE; only a SET FILTER is black** (Mark, 2026-08-02, after
  a sweep). The outlined cell — `border border-ink bg-white`, filling black on
  hover — is the only button weight the app has. There is no "primary": a filled
  cell among outlined ones reads as a different KIND of control rather than as
  the important one, which is the conclusion the ActionBar reached in July and
  the sweep then applied everywhere else (ProcessPo's send buttons, the cleanup
  drawer's three saves, sign-in, /welcome). Black still means SELECTED — a
  TabPicker cell, a WeekdayPicker day, a checked box, a switch knob — and it
  still means a band that DELIMITS (masthead, ActionBar, dialog title bar, group
  band). **The one exception is `DIALOG_COMMIT_CLASS`**, flagged and left black
  on Mark's instruction to flag rather than change: a modal footer is a
  two-weight decision (a text Cancel beside the commit), not a row of peer
  buttons. Retiring the black fill also cost ProcessPo's `processed` state,
  which had promoted "Mark as sent" once you'd generated the document — that
  nudge was carried entirely by the colour.
  **The `DIALOG_COMMIT_CLASS` exception is ENDORSED, not merely tolerated**
  (Mark, 2026-08-02: "I agree with you on panels where there is a commit
  button"). A panel exists to produce ONE outcome, so it genuinely has a
  primary and its footer is a two-weight decision — black commit beside a text
  Cancel — where a screen full of peer buttons is not. That is the whole of the
  exception: a commit inside a panel. It does not license a black button on a
  screen.
  The 2026-08-02 sweep had over-applied itself here: it whitened BOTH of
  ProcessPo's send buttons, and only one of them was on a screen. The PO email
  compose is a `ui/Dialog`, so its **Send** is a panel commit and went back to
  `DIALOG_COMMIT_CLASS` on 2026-08-03 at Mark's request ("the send button should
  be black since it's the primary action") — which is the rule being applied,
  not bent. The tell that a button qualifies is the footer beside it: a text
  Cancel and a secondary escape hatch, not a row of peers.
  **"But which button is primary on a SCREEN, then?" — none, and the question
  dissolves** (re-opened 2026-08-02 and closed the same way). Outside a panel
  footer there is no primary to find, so there is nothing to decide per screen.
  A DETAIL screen makes that plainest: what you came to do is edit the inline
  cells, so every discrete button on it — Delete, Invite to app, Attach — is
  peripheral by construction. Lists are the same; New employee is outlined.
  **Check this rule before reasoning about button weight from first
  principles.** It was re-derived backwards once (black = "the primary action,
  one per screen") from the ActionBar's own July note, which argues the
  opposite and is quoted above — the sweep generalised "a filled cell reads as
  a different KIND of control" outward, it did not carve out an exception. The
  tell that something is wrong is a `bg-ink` fill on anything that isn't a set
  filter, a delimiting band, or `DIALOG_COMMIT_CLASS`.
  Known stragglers the sweep missed, both still `bg-ink` and both wrong:
  `InactiveLocationGate`'s Activate and `AddShopSection`'s Add.
- **The menu is two tiers, from FMP** (Mark, 2026-07-25 — overrides the design
  system, which had killed the sub-nav): sections on top, that section's
  sub-sections under it, both bands black, **both marking active in WHITE**
  (told apart by 12px vs 11px, white/60 vs white/50, and a `white/15` hairline).
  Six sections, **every one of them an ordinary tab** — white when you are on
  it, white/60 otherwise; no TAB carries colour in either band. The masthead's
  one yellow is the working-location picker in the right-hand column.
  **The first is "Facilities"** (Mark, 2026-08-30) — renamed from "Locations",
  which was right while a location record and its shop sections were all the
  section held. Since 075–078 it also carries checklists, tasks, maintenance,
  inspections and the equipment register, every one of them about the BUILDING;
  a tier-1 tab names the work, and the work is looking after the place. **The
  SLUG stays `location`** — that is what the `rf.nav` cookie stores, so renaming
  it would drop everybody's remembered sub-section.
  Its sub-tier's first entry went back to **"Locations"** the same day, undoing
  the 2026-08-27 trim to "All": that trim's argument was that the band above
  already said Locations so the sub only had to say WHICH of them, and it dies
  with the rename — "All" under "Facilities" names nothing.
  **It is no longer special** (Mark, 2026-08-27). It
  wore the ACTIVE LOCATION CODE from 2026-08-01, when the masthead switcher was
  deleted and the tab became the only place the code stayed on screen; it was
  additionally YELLOW from every other section (Mark, 2026-08-06) because it was
  then the only tab that wasn't a place you go — it named the shop every other
  screen is about, so "which shop am I ordering for" had to be answerable
  without hunting. **The picker at the end of row 1 now carries both the code
  and the yellow** (`components/WorkingLocation` — build step 4b), so
  the tab went back to naming the list it leads to, and each colour still means
  exactly one thing: white "you are here", yellow "this is the shop".

  Most of the menu is built now; what is left on `/soon/<section>/<sub>` — one
  shared placeholder — is Location's Tasks / Maintenance / Inspection Logs, HR's
  Team Reviews, and Operations' Documents / Policies / Check Lists / Master
  Check Lists / Tags. **`operations/shift-reports` graduated on 2026-08-28** and stays
  under Operations: the note that used to argue for Production was about where
  the WORK was sequenced, not where the entry belongs, and the screen is
  organised by the shift a supervisor is closing rather than by the tables it
  writes. **The menu is
  `web/src/lib/nav.ts`** — a screen ships by getting a real `href` there and
  nothing else moves. Home and Settings are utility ICONS, not tabs, so they
  light no tab and the second band hides entirely on those routes.
  **`/` LANDS ON `/locations`** (Mark, 2026-08-20). It had been a leftover from
  the skeleton — a heading, the signed-in email, a sentence pointing at
  Locations and a lone "Vendors →" link — and landing on the shop list makes the
  first question the app asks the first question of the day: which shop are you
  working at (design rule 3, and `/locations` is where you answer it).
  A REDIRECT, not a copy of the list — `/location`'s and `/pay-periods`'
  pattern — so `/` stays the canonical landing address that three things point
  at without knowing where home is: the masthead's Home icon, `proxy.ts`
  (signed-in user hitting /login → `/`), and the login form's own
  `router.replace("/")`. No `loading.tsx` beside it: a redirect thrown during
  render never paints. Consequence, and it is fine: Home and the nav's location
  tab now go to the same place, so pressing Home lights that tab where it used
  to light none.
  Per-section memory (first visit → first sub, later → last sub used) lives in
  the session cookie `rf.nav` (`lib/navMemory.ts`), **seeded by the server and
  then owned by the client** (`lib/navMemoryStore.ts`): a server layout does not
  re-render on soft navigation, so a client-written cookie can never be read
  back mid-session and the tab hrefs would freeze. `signOut` deletes it.
  **A tab comes back to the SCREEN, not just the sub-section** (Mark,
  2026-08-06: "if we were looking at a list, we return to that. If it was a
  detail view, we return to that"). So `NavMemory` is two maps —
  `subs` (section → sub, the cookie's whole content) and **`paths`**
  (`navPathKey` → the last url, **in memory only**, the call `scrollMemory` and
  `recordSet` already made: the clicking this exists for is all one page load,
  while a hard load has nothing worth restoring, and being dropped tomorrow onto
  a record somebody read yesterday is the thing to avoid). `sectionHref` and the
  new `subHref` read them; tier 2 reads the memory now, which is what makes
  Employees → Timesheets → Employees return to the employee.
  Three rules a rewrite would break quietly:
  **the tab you are ALREADY on goes to its list** — that's the escape hatch,
  since a tab whose only destination is the record under your feet is a no-op;
  **the key carries the LOCATION** (`${locationId}|${section}/${sub}`), because a
  remembered PO is a location-scoped row — keying rather than clearing, so
  returning to DF01 finds DF01's record, at the accepted cost of forgetting the
  org-level ones (an employee) on a switch; and **the remembered url keeps its
  QUERY**, which on a record is the breadcrumb (`?from=…`), so coming back finds
  the same crumbs and the same record book. On a list the query is filters
  written with `history.replaceState` AFTER arrival, so what's remembered is the
  query you ARRIVED with — none for a tab click, i.e. exactly the old behaviour.
  `rememberIn` is the pure reducer (fixture-tested, 18 cases) and returns the
  SAME OBJECT when nothing moved: `getSnapshot` needs referential stability, and
  each map is preserved individually so the store can tell from identity alone
  whether the cookie needs rewriting — otherwise every record you opened would
  rewrite an identical cookie. Known edge, not fixed: a remembered record that
  gets deleted leaves a tab pointing at a dead id until you visit that area
  again (narrow — every delete flow navigates to the list, which overwrites it).
- **A days-old `next dev` will start reload-looping** (Mark, 2026-07-26 — the
  order guide stuck on its loading bar, restarting, page reloading by itself,
  cured for a few minutes by navigating away and back). Not an app bug: the dev
  server had been up 2.5 days at **4,250 MB RSS against Node's 4,144 MB default
  heap cap** — 102.5% of the ceiling. At the cap V8 major-GCs on every
  allocation, requests stall, the HMR socket drops, and Next's dev client
  full-reloads to reconnect, over and over. The order guide trips it first
  because it's the heaviest route. `npm run dev` now sets
  `--max-old-space-size=8192`, which buys headroom but does not stop Next dev
  from accruing memory — **restart the dev server every day or two**, and
  `npm run clean` if `.next` gets large (it was 1.3 GB). Check with
  `ps -o rss= -p <pid>` before debugging a phantom app bug.
- **A FRESH `next dev` that reload-loops is a different bug: stale clients**
  (Mark, 2026-07-27 — same symptom minutes after `npm run clean && npm run dev`,
  so the memory ceiling above cannot be the cause; restarting again is the wrong
  move and will look like it failed). Tell them apart by the log: this one
  carries **`ChunkLoadError: Failed to load chunk …hmr-client…`** and every
  `GET /order-guide` still returns **200** in normal time (~300–450ms). The
  server is healthy and answering; the CLIENTS can't use the answer.
  `npm run clean` deletes `.next` and regenerates every chunk with a new content
  hash, so any tab still open from before the clean asks for hashes that no
  longer exist, fails, and full-reloads to recover — a browser-side loop that
  looks exactly like a server-side one. **Two or more distinct chunk hashes in
  the log means two or more clients pinned to different builds** — that's the
  tell, since one client would converge on one build. Fix: close every tab
  pointing at the app and open one fresh. Count ALL of them — Safari (which
  already caches dev assets too aggressively, see web/README.md), any iPad on
  the LAN, and **any browser-pane tab Claude left open**, which is what caused
  the 2026-07-27 instance (three tabs parked on `/order-guide`, the heaviest
  route). Confirm a suspect tab with
  `performance.getEntriesByType('navigation')[0].type` — `"reload"` means it
  reloaded itself rather than being navigated. Claude: close your localhost tabs
  when you finish verifying.
- **A reload loop tied to a specific ACTION is neither of the two bugs above**
  (Mark, 2026-07-27 — deleting a PO line loops every time; "I keep being told
  the reloading has something to do with the server running too long or too
  many tabs open… I think this is incorrect." He is right). MEASURE BEFORE
  BLAMING EITHER — both stories were false here:
  - *Memory ceiling?* `ps -o pid,etime,rss= -p <next-server pid>`. Measured
    2026-07-27: up 3h36m at **3,358 MB against the 8,192 MB cap** the `dev`
    script now sets — 41%, not 102%. Rules it out.
  - *Stale chunk?* Take the hash from the ChunkLoadError and check both that it
    exists (`find .next -name '*hmr-client*'`) and that it SERVES
    (`curl -o /dev/null -w '%{http_code}' 'http://localhost:3000/_next/static/chunks/%5Bturbopack%5D_..._<hash>._.js'`).
    Measured: all three hashes present, all **HTTP 200**. A chunk that serves
    fine is not a stale chunk, so the tab story doesn't apply either.
  Also ruled out that day, each with a measurement: `router.refresh()` alone
  (one RSC request, 1,284ms, no reload — the guide's Refresh button is a
  zero-mutation way to test it); a main-thread freeze like `window.confirm`
  (blocked 9s, HMR reconnected, no reload); and the app hard-reloading itself
  (no `location.reload()` anywhere — the only `window.location` writes are the
  mailto and the PDF blob window).
  Note the error says **`unhandledRejection`**, which is a NODE process event —
  it is the dev SERVER reporting, not the browser, and it names an
  `[app-client]` chunk loaded by an **async loader**. PO detail is the only
  screen carrying a heavy dynamic client import (`@react-pdf/renderer`, imported
  at click in `ProcessPo` / `lib/poProcessing.ts`). Unconfirmed, but that's
  where to look first — and reproducing needs a real line deleted, so ASK.
- **The masthead publishes its MEASURED height as `--rf-header-h`** (seeded at
  5.5rem in `globals.css`). Every sticky table head offsets against it
  (`lib/tableHead`) and the order guide's scroll pane subtracts it, so it stays
  measured rather than becoming a constant — the masthead wraps to two or three
  rows at iPad widths and any constant is wrong at some width. Any screen
  sizing itself against the viewport should use the variable. The measuring is
  `usePublishedHeight` in `lib/tableHead` — reach for that rather than a second
  ResizeObserver, and seed the new variable in `globals.css` so the first paint
  is close rather than zero.
  **The order guide's SEARCH AND FILTERS stay on screen for the whole walk**
  (Mark, 2026-08-03: "I would like to still have access to the search and
  filters when scrolling down the order guide"). The rest of the shelf — title,
  day picker, totals bar — is what you set before taking a step, so it still
  scrolls away; these three you reach for mid-walk, down 66,000px of list. The
  band is `sticky top-[var(--rf-header-h)] z-30` (over the labels at 20, under
  the masthead at 50 — the ActionBar and BackToTop share 30 and never meet it,
  being at the bottom of the viewport) and publishes its own height as
  **`--rf-guide-controls-h`**, which the guide's column labels ADD to their
  offset. It has to be measured: the row wraps the moment "Group by" can't share
  it, which at 1440 it already can't — 116px at 1440, 168px at 820, with the
  masthead itself going 64 → 96. The variable is seeded 0 and cleared on
  unmount, so every other list's labels keep offsetting against the masthead
  alone. `scrollToNext` (Next favorite / Next section) sums the same three boxes
  off the DOM, or every jump would land its row underneath the search box —
  verified landing at exactly 222px, the labels' own bottom edge.
  **It used to COLLAPSE to a strip** (Mark, 2026-07-27 — ~88px at the top of
  every screen, "too much space… we would need a shortcut to bring it back"),
  driven by a ▲ in the utilities cluster. **Removed 2026-08-02** ("I don't
  think it's necessary any longer"), and the whole mechanism went with the
  button rather than just the button: the same flag also hid the order guide's
  shelf, so leaving the state behind with nothing to toggle it would have
  stranded anyone who had collapsed it. Gone with it: `lib/chromeStore`, the
  collapsed strip that restated where you were, and the guide's `-mt-8`
  compensation. The stale `rf.chrome.menuCollapsed` key is simply never read
  again — harmless, and cheaper than shipping code to erase it.
- **An overlay INHERITS from wherever its trigger sits, and `position: fixed`
  doesn't save it.** Fixed moves the box, not its place in the DOM, so every
  inherited property cascades straight into the floating panel. Two have bitten,
  both found the same way — the dialog looked broken and the cause was three
  ancestors up:
  `text-white` from the black ActionBar, which rendered the Generate POs vendor
  names white on white (Mark, 2026-07-27 — "the vendor names are unreadable…");
  and `white-space: nowrap` from a `DataTable` cell's `truncate`, which stopped
  every paragraph in the vendor-item delete dialog from wrapping and ran the
  sentences off the panel's right edge (2026-07-31). **Both are now set once on
  `ui/Dialog`'s panel (`text-ink whitespace-normal`)**, which is the fix — patching
  each line only defers it to the next line. A new overlay that ISN'T a `Dialog`
  inherits the problem back.
- **ENTER COMMITS A DIALOG THAT IS A FORM, and it is OPT-IN** (Mark,
  2026-08-08: "why doesn't pressing enter dismiss our dialog panels?"). It never
  did for two reasons: the panel is not a `<form>`, so there is no implicit
  submit, and `footer` is arbitrary JSX, so `Dialog` genuinely cannot tell which
  of a caller's buttons is the commit. It still can't — hence `onSubmit`, passed
  by the caller with **the same guard the commit button's `disabled` uses**, an
  Enter that fires a refused write being worse than one that does nothing.
  Opt-in is the design, not an unfinished sweep: a dialog gets it iff Enter is
  unambiguous AND safe. Create forms do (New tray, plan, element, employee,
  shop section, pay period). **Destructive confirms deliberately do NOT** — a
  stray Enter is exactly the keystroke you cannot take back — and neither do
  panels with several peer commands, where "the commit" isn't one thing.
  Four guards, each for a real collision, all verified in the browser: a
  **TEXTAREA** keeps Enter as a newline; a focused **BUTTON or link** is already
  about to be activated by the browser, so committing as well would fire two
  actions from one keystroke (including "Cancel, then submit anyway"); an open
  **`PickList` or ⋯ menu** owns Enter for choosing, and being portalled to the
  body its own handler cannot stop this window listener seeing the same key; and
  **modifiers/IME** are somebody else's (⌘↵ saves a multiline cell).
- **A dialog pins its title bar and its footer, and scrolls only the middle**
  (`max-h-[85vh] flex flex-col` + `min-h-0 flex-1 overflow-y-auto` on the body).
  The overlay is fixed, so a dialog taller than the window cannot be scrolled by
  the page and its footer is simply unreachable — Generate POs wanted 990px in a
  900px window at 12 vendors, putting "Create N POs" 162px below the fold on the
  first real ordering day. This lives in `ui/Dialog` now (2026-07-31), which was
  extracted from the three hand-rolled copies that had each learned a different
  subset of these lessons; `toolbar` is the pinned band under the title bar for a
  search box that must not scroll away.
  **Use the `footer` PROP, not a last row in the body** — a commit row left in
  the body scrolls away, which is the very thing this bullet exists to prevent.
  The PO email compose had it in the body until 2026-08-03 and nobody had
  noticed, because the panel had never been tall enough to scroll.
  **`height` defaults to the CAP (`max-h-[85vh]`) and a caller may pass a
  DEFINITE height instead** (Mark, 2026-08-03: "make that panel bigger… at least
  1.5x taller"). A cap is right for a confirm — as tall as its content and no
  taller — and wrong for a panel whose point is a big pane to look at: the email
  compose shrink-wrapped to 512px in a 720px window, because the 26rem floor on
  its PDF preview WAS the panel. It passes `h-[88vh]` now (880px at a 1000px
  window, 1.72×). Pass one INSTEAD of the cap, never as well — `max-height`
  beats `height`, so leaving the cap would silently clamp anything over 85vh.
  A stretched pane also needs **`md:grid-rows-1`** on a grid body: an implicit
  row is content-sized, so `h-full` on the pane means nothing and it falls back
  to its own min-height however tall the panel gets.
- **A DataTable column holding a day picker must be `WEEKDAY_PICKER_WIDTH`**
  (300px, exported from `WeekdayPicker.tsx`). The table is `table-fixed` with
  `truncate` cells, so a narrow column silently CLIPS the right-hand end rather
  than wrapping or scrolling — which is how the All/None command went missing
  from the item screen's Order days column at 235px (Mark, 2026-07-27 asked for
  an All toggle there; it had been in the component since the design-system port,
  just cut off). Seven 32px boxes + the command + the cell's px-4 = 288.
  Anything interactive at the right edge of a fixed column deserves the same
  arithmetic.
- **Every slow route needs a `loading.tsx`** (Mark, 2026-07-26 — "enough time
  for me to wonder each time if the app is working"). Without one Next holds the
  PREVIOUS page on screen for the whole server wait with no acknowledgement that
  the click landed; the order guide's TTFB is ~3.5s (five sequential Supabase
  round trips, one of them 877 rows). Each is a one-liner re-exporting
  `components/ui/PageLoading` with a label. Put it on the LEAF segment, not on
  `(app)/` — a group-level one would also fire for other slots, and a LIST's
  loading.tsx also covers its `[id]` child unless that child has one of its
  own, which is why each detail segment now carries one. This is also the one
  place the design system's "no spinners, no skeletons" is relaxed — an
  indeterminate bar, not a skeleton, because a static label during a 3.5s wait
  still reads as stuck. The keyframes live in `globals.css`.
- **POSTGREST RETURNS AT MOST 1,000 ROWS AND SAYS NOTHING ABOUT IT.** Supabase
  caps every REST select at `db-max-rows` (1,000 by default), so a table with
  more rows comes back **silently truncated — no error, no flag, just a short
  array**. `loadProductionGraph` fetched 3,765 recipe lines in one call and got
  1,000, so two-thirds of every recipe's ingredients were invisible to costing
  and 299 elements read as uncosted where the real figure is 209. It did not
  look like a bug; it looked like a catalog with more holes than expected,
  which is why it survived a first read of the screen. Found by counting the
  same thing two ways — a service_role script that DID paginate disagreed with
  the page.
  Any screen that selects a table which could exceed 1,000 rows must paginate
  (`productionQueries.fetchAll` is the idiom), **and the sweep must `.order()`**
  or pages overlap and rows go missing — the timesheets-audit lesson, which
  measured 44,661 rows fetched holding only 27,795 distinct ids. Today's
  candidates over that line: `purchase_order_items` (104k),
  `inventory_item_locations`, `vendor_items` (2,888), `employee_events` (46k),
  `timesheets` (44k), `production_recipe_lines` (3,765) and
  `production_recipe_steps` (2,914). A screen that filters to one parent row is
  usually safe; one that loads a whole table is not.
- **Page speed: round trips and payload, in that order** (measured 2026-07-26,
  dev server, hosted Supabase). `getAppSession` is wrapped in React `cache()` —
  the (app) layout AND the page both call it, which was a duplicate ~220-450ms
  on every full load; it also fetches `org_members` + `locations` in one
  `Promise.all` and **embeds `orgs(settings)`** so no screen needs its own query
  for the timezone (verified read-only that PostgREST returns that embed as an
  OBJECT, not an array — an array would silently fall back to the server's
  timezone). A Supabase query builder is a **lazy thenable**: assigning it to a
  variable sends nothing, so to overlap two queries you must call `.then()` on
  the first. On the guide, columns are the other half — the same 877-row query
  costs 781ms wide and 284ms with a single column, so the SELECT lists only what
  the screen reads. Guide median went 1308→1051ms (nav click) and 1565→1246ms
  (full load). What's left is mostly that payload; cutting it further means
  fewer rows, and caching the view is forbidden by design rule 4.
- **A client component that seeds `useState` from server data must be KEYED by
  that data's identity** (found 2026-07-26). Switching location is a navigation
  to the SAME route, so React keeps the component instance and a
  `useState(() => …props)` initialiser — which runs once per mount — never sees
  the new props. `OrderGuide` had this: after switching DF01 → DF02 the guide
  showed DF01's quantities and on-hand counts against DF02's lines and totalled
  them in the vendor bar. Writes still went to the correct location, so only the
  display lied, which is why it survived unnoticed. Fixed with
  `key={`${locationId}:${guideDate}`}` on the page — cheaper than syncing state
  in an effect, and it can't drift. Check any other screen that copies server
  props into state when the location can change under it.
  **It happened again on `/location`** (Mark, 2026-07-30 — "switching locations
  kinda updates the page but not completely"), which is worth knowing because
  of how it PRESENTS: everything stateless updated — the name, both addresses,
  the tax rate — and only `ActiveToggle`, `OperatingHours` and
  `ProductionMapping` lied, so it reads as a half-finished refresh rather than
  as stale state. The tell is a control disagreeing with the text beside it:
  measured after DF01 → DF03, the switch was still `aria-checked="true"` next
  to a label that already said "Inactive". Both new screens are now keyed
  (`/location` on the page, `/shop-sections` on the table), and **a key on a
  SERVER component does remount its client children** — verified across a soft
  transition, not assumed. Prefer keying the whole body over keying the
  offending children: it costs the same and no future stateful child can
  quietly inherit the last location's data.
- **The Active toggle is the FIRST column** on every catalog table (Mark,
  2026-07-23) — vendors list, vendor/item per-location config, vendor items.
  "Stock here" shares that slot where a row doesn't exist yet.
- **EVERY date field shows a calendar picker** (Mark, 2026-08-02: "always
  include a calendar picker for any date field"). **The box itself is
  `ui/DateField`** — extracted from `InlineValue` on 2026-08-02 when the
  new-employee form needed a date that isn't an edit-in-place cell. Everything
  below is a bug a second implementation would reintroduce, and a CREATE form is
  the worst place to reintroduce it, since its date starts EMPTY. Never write a
  bare `<input type="date">`; `InlineValue kind="date"` wraps `DateField` in its
  write logic, and a form uses `DateField` directly.
  Not a rule to remember at
  each call site — `InlineValue kind="date"` renders the browser's own
  `<input type="date">` permanently, so a date cell is a picker by
  construction. It is the second `kind` that does NOT click-to-edit (the first
  is `pick`): the native control is already a box you can type into AND a
  calendar, so hiding it behind a dotted underline bought nothing and cost the
  one affordance a date has that no other field does. It writes ON CHANGE for
  the same reason `pick` does — a date input emits `""` until the whole date is
  valid, so a change event IS a finished value, and there's no half-typed state
  to protect. Its padding is the resting BUTTON's `px-1 py-0.5`, not a field's
  `px-2`: these sit in a `dl` beside text cells, and a date indented 8px next to
  a note indented 4px is a visibly crooked column. What triggered it was that
  PO detail's Delivery date was a hand-rolled `<input type="date">` (a picker)
  while the Ordered date beside it was an `InlineValue` (not), which is exactly
  the drift the parts table exists to prevent.
  **AN EMPTY DATE INPUT IS NEVER SHOWN, because Safari paints TODAY'S DATE into
  one.** WebKit's internal edit fields render the current date as a ghost
  whenever the value is `""`, so a null column reads as a delivery that already
  happened. The value really is empty — the DB stays null, the DOM value is
  `""`, Chrome renders `mm/dd/yyyy` and looks perfect — so only the paint lies,
  which is what made it expensive: it cost Mark three reports (2026-08-02) and
  three failed fixes. Two were aimed at other things (a React controlled-input
  drift guard, then `autoComplete="off"` against form-state restoration); the
  third tried to style it away with
  `color: transparent` on `::-webkit-datetime-edit` and did nothing, because
  the value is drawn by per-segment SUB-pseudo-elements that don't take the
  colour from their parent. **Don't try to style WebKit's date internals.** What
  works asks nothing of them: when there's no value the input is still in the
  DOM — `showPicker()` throws `InvalidStateError` on an element that isn't
  rendered, and it has to stay focusable — but it's `opacity-0`, absolutely
  positioned over a blank of our own width, so nothing WebKit paints can be
  seen in any version. `globals.css` also hides
  `::-webkit-calendar-picker-indicator` (Safari draws none, Chrome draws one
  inside the field) and `InlineValue` draws its own calendar glyph, which is
  what opens the picker.
    **Verify any date-field change in BOTH engines** — this class of bug is
  invisible in one of them.
  **`collapseWhenEmpty` is for a date in a NARROW box** (added 2026-08-06 for
  the paperwork chip, forwarded through `InlineValue`). By default an empty
  field still reserves its full 112px, which is right in a detail `dl` — the
  rows line up and the glyph doesn't move when a date lands — and wrong in a
  176px chip, where the invisible input renders as a calendar glyph floating
  alone 112px from the label it belongs to, reading as decoration rather than
  as a control. Caught by looking at it, not by review. Collapsed, the input
  is still RENDERED and focusable over its own 16px (`showPicker()` throws on
  an element that isn't rendered — that distinction is the whole of the care),
  so the chip's expiry becomes one wrapping row that the browser lays out:
  "NEVER EXPIRES 📅" on one line, a date and its glyph breaking to a second.
- **A read-only value in a detail `dl` wears the editable one's padding.**
  `InlineValue`'s resting button is `px-1 py-0.5`, so a plain string rendered
  beside it starts 4px to its left and the whole column looks broken — Mark
  caught it on an emailed order's `sent_via` (2026-08-02: "'email' isn't
  aligned with the ordered date and note, probably having something to do with
  it not being editable", which was precisely the cause). PO detail keeps the
  class as `READ_ONLY_VALUE`; anywhere a value is conditionally editable, the
  non-editable branch needs it too.
- **A known vocabulary is CHOSEN, never typed** (`components/ui/PickList.tsx`,
  Mark, 2026-07-30: "the user can enter literally anything… sweep the app").
  One control everywhere: a small list that opens directly BELOW the field —
  Mark's stated preference over a native popup menu — with a Find box once
  there are more than 8 options, group headers, hints beside the values, arrow
  keys, and the current value ticked. Reach for it through
  `InlineValue kind="pick"` (choosing IS the edit — it saves immediately, there
  being no draft and no blur to wait for), or directly where the choice isn't a
  column write.
  Two implementation facts are load-bearing: it **portals to the body and
  positions `fixed`**, because half its homes are cells inside `overflow-auto`
  panes where an absolute panel is clipped (and WebKit won't make a
  border-collapse cell a containing block); and it **closes on scroll**, since
  fixed coordinates go stale the moment the page moves. Note `min-width` beats
  `max-width` in CSS — the panel's cap is clamped INTO the min, or a 528px
  field keeps a 528px panel.
  **Where it went:** vendor item Sold-as (detail + the item screen's table),
  vendor item pack unit, item Category (`allowNew` — that vocabulary grows, and
  typing "Merch" surfaces "Merchandise" before it offers to add), base unit,
  and cleanup's pack-size unit. **Where it deliberately didn't:**
  `purchase_order_items.package_desc`, which looks like the same field and
  isn't — generation snapshots the COMPOSED pack there ("1 × 5 lbs", migration
  013), so a nine-token list couldn't express what belongs in it. Free text
  stays free text for names, brands, product IDs and notes.
  **There are no native `<select>`s left** (Mark, 2026-08-01: our popup menus
  "look different stylistically from our other elements", naming the vendor
  TYPE and inventory CATEGORY dropdowns). Filter dropdowns had been left native
  on the reasoning that they choose a VIEW rather than a value — that split is
  now retired, because the reader doesn't experience "view vs value", they
  experience an OS menu landing in the middle of an app that looks nothing like
  it. Converted: vendor type, inventory category, the vendor-items category
  (`ListFilters`), and PO detail's status. `PickList` grew
  **`variant="field"`** for them — an h-9 bordered box matching `TextInput` and
  `TabPicker`, caret at the right edge — beside the original `inline` dotted
  underline for cells. Same panel either way. Two things fell out of it: a
  filter's "All categories" is a real option whose value is `""`, so the
  trigger only greys out when NO option matches (`empty`), not merely when the
  value is falsy; and past 8 options the find box appears, which is what the
  native menu could never give an iPad.
  **An anchored panel FITS ON SCREEN — it flips above the trigger rather than
  running off the bottom** (Mark, 2026-08-08: near the foot of the window "most
  of it can't be seen"). `useAnchoredPanel` places in TWO passes, and it has to:
  the caller only renders the panel once `box` exists, so the first pass can
  anchor it but cannot place it — a panel that hasn't rendered has no height to
  fit. The second pass measures it and corrects, in a LAYOUT effect so nothing
  is ever painted in the wrong place. **Flip first, clamp second**: below is the
  default and stays it; a panel that would overrun goes ABOVE, still attached to
  the trigger; only if it fits in neither is it clamped into the viewport, which
  it always can be, being capped at 320px and able to scroll its own rows. The
  same shift fixes horizontal overflow, and works for `align="right"` panels
  even though the CALLER applies their `translateX(-100%)`, because moving the
  box moves the transform with it.
  Two rules keep it from oscillating: everything is recomputed from the
  **TRIGGER**, never from the panel's current position, so the answer is the
  same every pass; and a **>1px guard** stops it reacting to its own write —
  the receiving screen's lesson. It observes the PANEL as well as the trigger,
  because the height genuinely changes under you: typing in the find box
  filters 320px down to two rows, and a panel placed above has to follow its
  own bottom edge back down to stay attached.
  Measured over 10 panels at 5 scroll positions, both kinds and both
  alignments: zero off-screen, zero overflow on any edge; row menus flipped
  above at trigger y 638/643/560 and stayed below at 510/398.
  **An anchored panel is at most 320px tall, and it closes on scroll EXCEPT its
  own** (2026-08-02, both from the item screen's section picker offering 77
  shelves). `MENU_PANEL_CLASS` was `max-h-[70vh]`, which grows with the display,
  so on a large monitor a long list ran to the bottom of the screen anchored to
  one table cell; it's `max-h-[min(20rem,60vh)]` now — ~8 rows under the find
  box, and past 8 options that box exists, so a long vocabulary is TYPED at
  rather than scrolled through.
  The scroll rule is the subtler one. The listener is in CAPTURE so a scrolling
  PANE closes the panel, and that also caught the panel's own `overflow-auto` —
  so reaching for a long list dismissed it. What matters is whether the TRIGGER
  moved, not whether pixels did, so a scroll originating inside the panel is
  exempt. **`e.target instanceof Node` before `contains()` is load-bearing, not
  defensive tidying**: a PANE's scroll reports an Element, but the PAGE's
  reports `document`/`window`, and `Node.contains()` THROWS a TypeError on a
  non-Node — the first cut of the exemption killed the handler on every page
  scroll and stopped the panel closing at all, which is the case the listener
  exists for. Test BOTH halves after touching this; each one hides the other's
  failure.
  **An anchored panel is `z-[70]` — above everything, dialogs included.** It
  was `z-50`, chosen to clear the ActionBar, and that held until a `PickList`
  appeared INSIDE a `ui/Dialog` (`z-[60]`): the invite panel's role picker
  opened its list *behind* the dialog it belongs to (Mark, 2026-08-02). The
  rule is now the honest one — a panel is transient and anchored to a control
  the reader just pressed, so nothing should ever cover it while it's open. It
  portals to the body, so DOM order can't establish that; only the z-index can.
  The ladder: 20 sticky table heads · 30 ActionBar and BackToTop · 40 drawer
  scrim · 50 masthead and drawers · 60 dialogs · 70 anchored panels. Fixing it
  in `MENU_PANEL_CLASS` fixed all four menus at once, which is the whole reason
  they share a dress.
  **All four popup menus share one dress** — `MENU_PANEL_CLASS`,
  `MENU_ITEM_CLASS`, `menuItemState`, `MENU_HEADER_CLASS`, `MENU_SEARCH_CLASS`
  in `lib/anchoredPanel`, beside the positioning hook they already shared. They
  had drifted (PickList's rows `px-2 py-1.5` against the other two's
  `px-3 py-2`; only PickList marked the keyboard row) — the `ui/Dialog` story
  again. **`MENU_ITEM_CLASS` deliberately carries NO `display`**: the three
  menus lay rows out differently (option = hint beside the label, command =
  hint under it, checkbox row = centred), and a `display` in the shared string
  can't be overridden at the call site — Tailwind resolves competing utilities
  by STYLESHEET order, not class-string order, so `${MENU_ITEM_CLASS} block`
  stayed `flex` and put the ⋯ menu's hints beside their labels. Caught in the
  browser the same day; each caller states its own `flex`/`block`.
- **The "Sold as" vocabulary is the CONTAINER, never the size** (`lib/units.ts`
  `PACKAGE_DESC_OPTIONS`). GAL and QT were dropped from it on 2026-07-30 as two
  of the sizes FileMaker had been writing into `package_desc`, and restored on
  2026-08-03 (Mark: "we use it all the time"): a gallon or quart jug is a thing
  a vendor hands you, exactly like a case or a tub, where 1.5G / 3G / LBS /
  "1 × 50 lbs" really are a size in the wrong field and stay off. The counts
  agreed — 20 active vendor items each, ahead of SLEEVE (18), FLAT (9) and ROLL
  (6), all of which had made the cut. **The omission wasn't cosmetic**: this
  field was free text until the pick lists landed, and the picker has no
  `allowNew`, so leaving a value out doesn't merely hide it from the menu, it
  makes it UNENTERABLE — while anything already stored keeps rendering, which is
  what hid the gap for four days. Check that asymmetry before trimming any
  `allowNew`-less vocabulary.
  The vendor-item screen's pack row is labelled **"Package"**, not "Contains"
  (Mark, 2026-08-03) — the row IS the pack, and only the base-unit total in
  parentheses answers "contains".
- **The unit menu offers PACKAGES as well as measurements** (`lib/units.ts`,
  Mark, 2026-07-30) — case, bag, tub, box, sleeve, tray, flat, roll, in a
  fourth `<optgroup>` after Count / Weight / Volume. Not invented: the list is
  the catalog's own `package_desc` vocabulary, measured over 2,888 vendor items
  (CS 1248, BAG 201, TUB 117, BOX 54, SLEEVE 18, FLAT 9, ROLL 6, Tray 4); the
  one-offs are left out (SET 2, PR 1, and PKG 4, which as a unit of counting
  says nothing). One item was ALREADY stored as `base_unit = 'CS'` and the
  picker couldn't offer it.
  **A package unit converts only to ITSELF** — never to an each, a bag or a
  weight. There is no ratio to know: a case of cups and a case of flour share
  nothing but the word, and `package_content` is what the guide divides by to
  suggest a quantity, so a confident wrong answer there becomes a wrong order.
  `convert()` enforces it and the factor of 1 on those units is a placeholder
  that is never reached. Consequence for callers: "do these convert?" can no
  longer be asked as "are the families equal" — two package units share a
  family and still refuse (the cleanup drawer's incompatible check had to
  change). Unit lookups are case-insensitive, so the uppercase `CS`/`EA`/`GAL`
  in the data select their own menu entries instead of appearing twice.
- **Wide free-text fields are `components/ui/TextInput.tsx`, and they clear**
  (Mark, 2026-07-30) — a ✕ inside the field at the right, visible only while the
  field HAS FOCUS and holds something, emptying it in one tap. It takes
  `onValueChange` rather than `onChange`, so the button can't be wired up wrong.
  Two details are load-bearing: `onMouseDown` **preventDefault** on the button
  (without it the field blurs on press, the button unmounts, and the click lands
  on nothing), and the right padding is reserved whether or not the ✕ is showing
  so focusing a field doesn't reflow the text you're reading. `tabIndex={-1}` —
  Tab goes to the next filter.
  **Where it goes:** all seven search boxes, and the PO email compose
  header (To/Cc/Subject — prefilled from templates, so replacing one wholesale
  is the normal edit). **Where it deliberately doesn't**, because each would be
  a bug rather than a convenience: numeric boxes (the guide's on-hand/order, the
  cleanup editors, the PO add-item qty) — they're 4–10 characters wide and on
  the guide EMPTY AND ZERO MEAN DIFFERENT THINGS, so a one-tap route to
  "untouched" beside the stepper is a trap; `type="date"` (the browser already
  draws a control at that edge); `InlineValue` cell editors (they save ON BLUR,
  so a clear is one stray tap from writing null, and the cells are column-
  narrow); and the login form.
- **Every list uses `DataTable`** (`web/src/components/catalog/DataTable.tsx`):
  sortable headers, drag-resizable columns, optional scroll pane with a sticky
  header (which remembers its own scroll — see scroll restoration), optional
  expandable rows, 56px rows and no rule between them. Give it columns + rows; don't hand-roll a
  `<table>`. Supporting pieces: `ColumnHeader` (the header cell + resize grip),
  `lib/tableSort.ts` (comparator — empty cells sink last in BOTH directions, and
  **a tiebreak always reads ascending whichever way the primary points**: it
  used to take the primary's sign, so "Ordered newest first, then vendor" gave
  each day's vendors Z→A, which is not what "then vendor" means. The function
  had already agreed with this in one branch — two null primaries returned the
  tiebreak unsigned — and that inconsistency was the tell. Every caller passes a
  name or a code as its tiebreak, so the fix reads the same everywhere: flipping
  a column reverses the order you CHOSE, not the stable fallback used where that
  column can't decide. Pinned in `scripts/fixtures/tableSort.fixtures.ts`),
  `lib/columnWidths.ts` (`useResizableColumns`). **`/vendors` and `/items` were
  converted 2026-07-31** — they predated the component (built at commits 13 and
  24, `DataTable` extracted at 26) and had kept their own `<table>` ever since,
  sharing only the primitives. The tell was cosmetic and tiny — 14px body text
  and grey column labels against everyone else's 15px and black — but the cost
  was real: "sticky labels on every list" landed as four edits instead of one.
  Converting them needed two additions, both now general:
  **`group`** (a `DataGroup<T>`: a full-width band with a label and a count
  before each run of like-labelled rows — Vendors by Type, Inventory by Category
  or Section) and **`header`** on a column (a control in place of the label, for
  Inventory's select-all). Both lists drive `sort` / `onSortChange` because
  their sort lives in the URL, so they order `rows` themselves and `DataTable`
  renders as given. Their column-width keys were deliberately NOT bumped —
  the widths didn't change, so anyone's dragged columns survived.
  **`/cleanup` is the one still hand-rolled**, deliberately: it has no sort and
  no resize, it's driven by selection into a drawer, and it's a work queue
  rather than a catalog list. `/order-guide` is also not a `DataTable` and
  shouldn't become one — it's a walk-order document with nested item and line
  rows, shop-section bands and three-state quantity boxes.
- **A group band is BLACK with white text** (`DataTable`'s `group`, Mark,
  2026-08-02, with a screenshot of FileMaker's employee list beside it). It was
  a grey wash, which against 56px rows read as one more row rather than as a
  break between runs; black is what the app already uses for a band that
  DELIMITS (the masthead, the ActionBar), and it's the mark FMP used for exactly
  this. ONE style for every list that groups — the same argument the TabPicker
  settled — so Vendors (by Type) and Inventory (by Category or Section) changed
  with it. **Bands appear only when the SORT is the grouped column**, which is
  what keeps them from becoming a heading every few rows.
  The test for whether a column earns a band is always the same: **few values,
  many rows each**, so the run it opens is worth naming. `/employees` bands on
  location, status, position or schedule; the PO list on the order date, the
  vendor or the status (a date qualifies there because ordering happens in
  batches, so a day's band is a day's run of POs — and **vendor is that list's
  secondary sort whatever the primary is** (Mark, 2026-08-03), so the run under
  each band arrives in the order you'd read it out; sorting BY vendor needs no
  special case, since equal primaries are then the same vendor and it falls
  through to the PO number, which stays the last word because it is unique per
  row); the vendor's items table and
  a PO's own lines on the inventory **Type** (on PO detail that's also the
  default sort, so an order opens grouped — and it's the same grouping the
  vendor-facing PDF has printed since §4.9, which the screen had only been
  implying through the sort). Sorting by a name, a phone, a PO number or a figure
  bands nothing, deliberately.
  **`DataGroup.sortKey`** is for a table that leaves its sort to `DataTable`
  rather than lifting it into the URL (the vendor's items): the caller can't
  know what the sort currently is, so it names the column and the table decides.
  The URL-sorted lists keep deciding for themselves.
- **A column label WRAPS; it never truncates while there's room** (Mark,
  2026-08-02: titles clip "even when it appears there is plenty of room").
  There WAS room — in the cell, not in the label's share of it. Measured on PO
  detail at 1440: a 113px Product ID header gave its label 57px, and the other
  56 went on the cell's padding (32), the sort button's own padding (8), a gap
  (4) and the sort arrow's reserved width (12) — while the BODY cell below
  spends only its 32. **The header was working with 24px less room than the data
  it labels**, which is why a column can look roomy and still clip its title.
  Four changes in `ColumnHeader`, none of them enough alone: the button's `px-1`
  went (it also started the label 20px in against the values' 16 — a 4px kink in
  every column); the **sort marker moved out of the label's line into the cell's
  padding**, where it costs nothing and still never jumps; cell padding is
  `px-3` at EVERY width, header and body alike (the `xl:px-4` step was air a
  dense table can't afford); and the label wraps — `table-fixed` means a wrapped
  label can't widen its column, it just takes a second line. 57px of label room
  became 89 on the same column. The one honest failure left is a SINGLE word
  wider than its whole column, which is **clipped with an ellipsis, never split**
  — at 834px the PO list's Files column rendered "FILE/S", which reads as a
  rendering fault where "FILE…" reads as "there's more". If you see one, the
  column is too narrow for its name: widen the weight or shorten the label.
- **Column labels STICK, in every list** (Mark, 2026-07-31 — "scrolling in all
  current and future list views shouldn't hide the column titles"). The order
  guide had always done it; nothing else had. `lib/tableHead.ts` holds the two
  class strings (`STICKY_HEAD_ROW` under the masthead, `STICKY_HEAD_ROW_IN_PANE`
  at the top of a scroll pane) and `useOverflowOnlyWhenNeeded`.
  Two things are load-bearing. **The sticky goes on the `th`, never the `thead`
  or the `tr`** — in a `border-collapse` table WebKit doesn't honour it on the
  row, and iPad Safari at the 16.4 floor is what these are read on; the guide
  put it on the th for the same reason.
  And **a sticky header and a horizontal-scroll wrapper are MUTUALLY
  EXCLUSIVE**: an `overflow-x: auto` element is a scroll container (the spec
  computes `overflow-y` to `auto` beside it), so a sticky cell inside pins to
  THAT box, which never scrolls vertically, and just leaves with the page.
  Measured on the vendor list at scrollTop 600: −337px with the wrapper as it
  was, +64px with it visible; `overflow-y: clip` doesn't rescue it either. So
  `useOverflowOnlyWhenNeeded` measures and only makes the wrapper a scroll
  container when the table genuinely doesn't fit — the class stays
  `overflow-x-auto` as the safe pre-JS default and the hook relaxes it.
  **Columns are FLUID, not fixed pixels** (Mark, 2026-07-31 — "I've asked for
  responsive design but none of this feels responsive. It feels old school
  html"). A `DataColumn.width` is now a WEIGHT: `DataTable` renders each `<col>`
  as a percentage of the visible columns' total, so the table is exactly as wide
  as its container. A wide screen gets wider columns instead of dead space
  (measured at 1920: zero dead space, Name 253 → 375px); a narrow one squeezes
  instead of growing a horizontal scrollbar. Because the table can never exceed
  its box, **the sticky labels always work** — which is what finally fixed
  Vendors and the PO list, and got both sticking on a PORTRAIT iPad.
  Type scales too: body `text-[13px] xl:text-[15px]`, labels `11px`/`12px`,
  cell padding `px-3 xl:px-4`.
  **NEVER mix a percentage and a px length in a `<col>` width.** A width of
  `calc((100% - 95px) * 0.22)` is silently DISCARDED — measured 2026-07-31, the
  eight vendor columns all collapsed to an equal 163px share, while the same
  shares as `calc(100% * 0.22)` resolved correctly. That's why a column can't be
  pinned to exact pixels while its neighbours flex: everything scales, so a
  control column just needs a weight generous enough to stay usable at the
  narrowest width it will meet.
  This also retired the previous approach — per-table `compactBelow` thresholds
  derived from column sums — which had shipped a laptop-shaped hole (thresholds
  of 1280 left Vendors and the PO list overflowing until 1386 and 1434) and a
  6px margin on the PO list that a visible scrollbar was enough to eat.
  `compactBelow` survives but now means only "too many columns to READ here" —
  and since 2026-08-01 it is a DEFAULT the Columns menu can override, not a law —
  so it's the app's ordinary `xl` everywhere.
  The `useOverflowOnlyWhenNeeded` guard stays as a safety net for a table that
  somehow still overflows, and it must also toggle the sticky POSITION off, not
  just the effect: `position: sticky` with a top offset inside a scroll
  container that never scrolls vertically pins the cell at that offset, pushing
  it BELOW the rows it labels (measured on the PO list at 1330 — labels at
  y=321, first row at y=299, with fragments of that row peeking over the top).
  Hence `data-rf-hscroll` on the wrapper and an unlayered `position: static`
  rule in `globals.css`.

  | list | weights | compact set drops |
  | --- | --- | --- |
  | Inventory | 1040 | Section, Last ordered |
  | Shop sections | 1060 | Area, Sub area |
  | Locations | 995 | City |
  | Vendors | 1290 | Order via, Account |
  | PO list | 1338 | Sent via, Lines |

  Known rough edge: the PO list's compact set is still EIGHT columns, which at
  736px truncates dates to "2026-0…" and amounts to "$1,119.…". It fits and
  sticks, which it never did before, but a portrait iPad wants a second, deeper
  tier — not built.
- **A detail screen walks the found set** (`lib/recordSet` + `ui/RecordNav`,
  Mark, 2026-07-31 — FMP's first/previous/next/last book: "especially helpful in
  detail views to go to the next record in the list rather than back to the list
  and then to the next record"). The buttons sit in the `Breadcrumbs` row's new
  `trailing` slot, which is the one row every detail body has, and wear
  **Material Symbols Outlined `first_page` / `chevron_left` / `chevron_right` /
  `last_page` at wght 300** — the same source and weight as the Columns eye
  (Mark, 2026-07-31, on spotting that these had shipped as typed characters
  `|‹ ‹ › ›|` while the eye was real artwork). Their boxes are `1.5px`, heavier
  than a hairline and carried by the DEAD state too: a border that changed
  width between live and dead would shift the other three buttons a pixel as
  you reach an end, which is the one thing a cluster you press repeatedly must
  never do.
  **The LIST publishes what it is showing** — the rows in the order they're on
  screen, carrying the very hrefs its own links use — and the detail screen
  looks that set up by the path of the crumb that led it there (`crumbPath`).
  That's the whole design: filters, search, sort and grouping are all accounted
  for without this ever knowing they exist, and a list that filters in the
  browser (Inventory, 790 rows) needs the same three lines as one that filters
  in Postgres. Measured: `2 of 6` inside a search for "flour", `1 of 8` under
  the PO list's Sent chip.
  **In memory, like `scrollMemory`, and for the same reason** — the (app) layout
  survives soft navigation, so list → detail → next → next is one page load. A
  hard load has no found set and the book simply doesn't appear; storing it
  would mean opening a pasted URL on Monday and being told you're "4 of 61" of
  Friday's search. Publishers today: `/items`, `/vendors`, `/purchase-orders`.
  Vendor-item detail is wired and stays blank until something publishes for it —
  its only inbound link is the order guide, whose "set" would be that day's
  walk lines rather than a list of records.
- **Every multi-column table can hide columns** (`catalog/ColumnsMenu` +
  `lib/columnVisibility`, Mark, 2026-07-31) — the four list screens, the
  locations list, AND the tables embedded in detail screens (Mark, 2026-08-01:
  "even the ones that appear on detail sheets"). That last part was one word per
  table, because those were already `DataTable`s: an item's per-location config,
  a vendor's config and its items, a vendor item's per-location prices, a PO's
  lines. Each carries its own `storageKey`, so hiding Notes on a vendor's items
  says nothing about the config table three inches above it.
  `DataTable` renders it itself, `columnChooser`-gated,
  **directly above the LAST column header at the table's right edge** (Mark's
  placement — it acts on these columns, and each list putting it somewhere
  slightly different is how you end up hunting for it). It opens the same
  `lib/anchoredPanel` panel as `PickList` and `RowMenu`.
  **It is an ICON**, which is the one deliberate exception to the design
  system's word-not-picture rule (Mark, 2026-07-31: "I know it goes against the
  design, but would it kill us to use an icon here?"). It wouldn't: at that spot
  a word reads as a column label, and the ⋯ of `RowMenu` already made the same
  argument. The glyph is **Material Symbols Outlined `visibility`** — just an
  eye — inlined as one `currentColor` path rather than adding an icon dependency
  for a single icon. It went three-columns → `table_eye` → eye (Mark,
  2026-07-31): the first two were saying "columns" as well as "show", which the
  control's own position already says, since it sits directly above the table's
  last column header. What's left for the glyph is the verb. State is the
  button's ink (muted at rest, black when something is hidden), not a count
  beside it — that would be a second thing to read. **24px at wght 300** in a
  32px button: a Material weight is a DIFFERENT PATH, not a `stroke-width`, so
  changing it means fetching the `wght300` artwork — and the button tracks the
  glyph, or the hover wash sits on the artwork instead of around it.
  The chooser is the ONLY thing on that strip. A select-all briefly sat opposite
  it; it belongs in the selection column's `header` cell, which is where
  Inventory's had always been and where every list's goes (Mark, 2026-07-31:
  "make it like Inventory. that's how they all should be"). No visible label —
  a checkbox at the head of a column of checkboxes has already said what it is.
  `DataTable` reads the sets off its own
  `storageKey`, so a table gets this by having a key rather than by opting in.
  **Visibility is a TRI-STATE and the explicit choice beats the width tier in
  both directions** (Mark's iPad report, 2026-08-01): explicitly hidden,
  explicitly shown, or untouched — only the untouched fall to `compactBelow`'s
  default. It used to be one hidden-set composed with an unconditional compact
  drop, and the combination lied in a very specific way: Mark hid Order via and
  Account on his desktop, and on the iPad the WIDTH TIER had dropped those same
  two — so the columns were missing, the menu showed every box checked, and
  un/rechecking did nothing, which reads exactly like per-device settings
  having synced through the account. Nothing syncs; all of this is
  localStorage, and Mark chose to keep it per-device (2026-08-01, after
  weighing account-based: a desk and an iPad want different columns, which is
  the whole reason the compact tier exists). The menu's checkboxes now show
  EFFECTIVE visibility, a width-dropped column reads "off to fit this screen"
  beside its unchecked box, checking it genuinely brings it back, "Show all"
  means all, and the eye goes black whenever the table shows fewer columns
  than it offers — by any hand. Stored as the HIDDEN keys plus the SHOWN keys
  (`.hidden` / `.shown`), never an allowlist — a column added next month then
  shows up for everyone instead of being silently missing for anyone who ever
  opened the menu. `pinned` keeps the
  column that IS the row (Item, Name, Display name, PO number) out of the menu;
  control columns have no label to offer.
- **Every multi-column table can also REORDER columns** (`lib/columnOrder`,
  Mark, 2026-08-01: "allow the user to drag columns to whatever position they
  want them in") — drag a header sideways; a drop line shows where it lands and
  a chip names what's in hand. Movable = exactly the set the Columns menu
  offers (labelled, not `pinned`): pinned and control columns hold their
  DECLARED slots, so Active stays first, the ⋯ stays at the right edge, and the
  name column stays put. Stored under `${storageKey}.order` beside widths and
  visibility, as the FULL movable key order — a removed column drops out, and a
  column added later surfaces at its declared position instead of being shoved
  to the end for anyone who ever dragged (fixture-tested, the reconciliation
  cases especially). Three gestures share a header cell: the grip is excluded
  by `data-resize-grip`, a press travelling <6px horizontally is still the sort
  click (a capture-phase squelch eats the post-drag click), and the header is
  `touch-pan-y` so a vertical touch stays a scroll — pointer events throughout,
  never HTML5 DnD, because iPad Safari is the ordering stopgap. React state
  changes twice per drag (activation, release); the per-move chip and drop-line
  positions are written straight to the portalled overlay nodes through refs,
  because a per-move setState would re-render Inventory's 790 rows. Geometry is
  measured ONCE at pointer-down — nothing reorders live mid-drag. "Reset column
  order" joins the widths reset under the table. Verified live on /vendors:
  drag before/after, persistence across reload, sort click intact, store shape
  `["active","order_days","type",…]`. Touch untested on real hardware yet.
- **Every one-of-N choice is a `ui/TabPicker`** (Mark, 2026-08-01: the order
  guide's filter tabs "should be replicated stylistically throughout the app…
  the default moving forward") — the guide's segmented bar: one box, cells
  divided by rules, the chosen cell filled black. This RETIRED two whole
  dialects in one sweep: the underline-marker tabs (Vendors/Inventory active
  state, PO status + window, cleanup's scope — and their "underline means
  filter, fill means command" rationale, which this decision supersedes) and
  the loose bordered chips (the three last-ordered rows, cleanup's problem
  filter). Consumers: the guide's day strip (href/Link cells), tier filter
  (counts) and grouping; ListFilters; both big lists; the PO list; cleanup ×3;
  receiving's layout control (`size="sm"` for its fixed-height band).
  **The selected cell is ALWAYS black — there is no per-caller colour.** The
  first cut kept an `accent` option that filled a selected last-ordered AGE
  bucket yellow, carried over from the chip dialect on the argument that a
  stale filter left on hides everything fresh. Mark caught it within the hour
  (2026-08-01, on Inventory: "highlighted yellow instead of black like
  everywhere else") and it's gone, option and all: one control has one selected
  state or it isn't one control, and the design system reserves colour for
  record STATE — a filter is VIEW state, and how much it's hiding is already
  said by the "401 of 790" count in the header. `count` and `href` are the only
  options left. The root is `flex w-fit`, never
  `inline-flex` (the descender-space trap in block parents). If a new screen
  needs a choose-one control, this is it — a `<select>` is still fine for a
  long vocabulary, and `PickList` for choosing a VALUE.
- **A detail screen's section headings are `ui/SectionHeading`** (Mark,
  2026-08-01: make "per location config" and "vendor items" larger and bold).
  They were 12px semibold grey — the same size, weight and colour as a table's
  own column labels — so a heading that owns a whole block read as one more
  caption inside it. Now 16px bold black at 0.08em (the 0.12em small-caps
  tracking is there to open up text that's nearly too small to read; at 16px it
  only looks loose), which puts a clear step below the screen's 28px h1 and a
  clear step above the 11–12px labels underneath. Applied to all SEVEN headings
  that own a block — vendor, item, vendor-item and location detail — not just
  the two named, or the change would have been the drift it was fixing.
  Deliberately NOT applied to the three that look similar but are LABELS INSIDE
  A ROW: the Paperwork and Invoice card bands, and receiving's "n lines", which
  sits in a pane header that is fixed-height by design and would break if its
  type grew.
- **A filter's label sits ABOVE its TabPicker, not beside it** (Mark,
  2026-08-01, for "Last ordered" on the Inventory list). A five-cell bar with a
  label to its left starts 130px in, so it no longer lines up with the search
  box and the other filters above it; stacked, every filter row begins at the
  same left margin. The label is a `block` in a `space-y-1.5` wrapper.
  **On vendor detail (`ListFilters`) the label is gone entirely** (Mark, same
  day) — every cell already names an age ("Never ordered", "2+ years", "Within
  a year"), so the caption repeated what the bar spells out; it survives as the
  group's `ariaLabel`. That block is now TWO rows and which control sits on
  which is deliberate: the typing controls (search, category) on one, **both
  TabPickers on the other** ("the same line as the active/inactive tab
  picker"), because they are the same kind of control answering the same
  question. Pairing them explicitly rather than letting one `flex-wrap` row
  sort it out is load-bearing — measured at 1440 the four wanted 1441px against
  1329 available, so the age bar broke away from Active on its own.
  `TabPicker`'s `stretch` is left over from the one-row-each arrangement this
  replaced and nothing uses it today; `whitespace-nowrap` came from the same
  episode and stays, because a wrapped tab label is wrong everywhere.
- **The strip above a table carries that table's heading or filters**
  (`DataTable`'s `leading`, Mark, 2026-08-01: the filters should "feel more a
  part of the datatable… since that's what they work on", and a heading "could
  come closer to the table"). Before this the strip held only the columns eye,
  so it was an EMPTY 32px band: measured on vendor detail, 44px between a
  heading and its table and 48px between the filters and theirs, of which 32
  was the band in both cases — no margin tuning could have closed them. With
  the heading (locations table) and the filter block (`VendorItemsTable`) moved
  into it, both gaps are 8px and the eye keeps its place above the last column
  header. Three details are load-bearing:
  **the eye gets its own `shrink-0` cell and the strip row does NOT wrap**
  (Mark: "so when the screen gets smaller the other elements wrap but the eye
  stays in place") — the leading content wraps inside its own `min-w-0 flex-1`
  box, so the eye can never break onto a line of its own, which it did at 1440
  before the fix and looked like a stray button; **`items-end`**, because the
  eye belongs to the column labels directly beneath it, so it sits beside the
  LAST row of a wrapping filter block rather than floating at the top; and
  `DataTable`'s root spacing went `space-y-1` → `space-y-2`, since 4px off the
  column labels read as crowding them once the strip held real content.
  **This is now THE convention for a heading over a table, not a vendor-detail
  quirk** — item detail followed on 2026-08-02 when Mark reported the same three
  symptoms unprompted ("too much space between 'per location config' and the
  datatable below it… not enough space between 'vendor items' and the datatable
  above it"), which is what a repeated mistake feels like from the outside. So:
  **a section heading over a `DataTable` goes in that table's `leading`, never
  in a `<section>` above it**, and the page that holds them is `space-y-16`.
  Measured on item detail after: 8px heading-to-table, 64px between the blocks,
  against ~48 and 24 before. A caption belongs in the `leading` too, under the
  heading (`VendorItemsTable` grew a `heading` prop that renders above its
  filters; `ItemLocationRows` just forwards `leading`).
  `space-y-16` applies to the WHOLE page including the breadcrumb row — vendor
  detail has always done that and it reads fine; don't special-case the top.
  The LIST screens (Inventory, Vendors, PO list) still put their filters above
  the table with the eye's band between, and are the obvious next place for this.
  **The eye's cell carries `-mb-1`** (2026-08-02): `items-end` aligns BOXES, and
  the eye is a 32px button centring a 24px glyph, so its artwork stops 4px short
  of its own bottom edge and against a ~20px heading it read as floating above
  the line. The nudge moves the BUTTON rather than the glyph inside it, which
  keeps the hover wash centred on the artwork — the thing the button's size
  exists to do.
- **A scrolling table pane ends where the WINDOW does, and the height is
  measured** (`useFillViewportHeight` in `lib/tableHead`, Mark, 2026-08-01: it
  "should only take up the remainder of the page"). It was
  `max-h-[calc(100vh-36rem)]`, a constant tuned by hand around the filter bar of
  the day; the moment this page's spacing changed it was 101px too tall and the
  whole page scrolled. Anything above a pane can move its top, so the only
  honest answer is to ask the DOM — the same lesson, and nearly the same code,
  as the receiving screen's split columns. What sits BELOW is measured too (the
  reset-widths footer comes and goes, and the layout's `py-8` is under that),
  the height is written straight to the node so a resize doesn't re-render the
  rows, and a >1px guard stops the ResizeObserver reacting to its own write —
  which loops, because shrinking the pane removes the page's scrollbar, which
  moves everything. Verified at 1200 (490.5px, page exactly one viewport) and
  1000 (290.5px, re-measured on resize), both with 32px below.
  **`min-h-64` went with it**: a minimum HEIGHT gave a one-item vendor a 256px
  box around a 110px table. The floor belongs on the max-height — the hook
  won't compute below 256 — so a short table is now as tall as its rows and a
  long one stops at the window.
- **A pane is `overflow-x-hidden`, never `overflow-auto`** (Mark, 2026-08-01: "a
  bottom scroll bar when there shouldn't be"). Columns are fluid, so a table is
  a percentage of its pane and can never exceed it — there is nothing to scroll
  sideways to. What it scrolled to was 6px of nothing: a `ColumnHeader`'s resize
  grip is `w-3` shifted `translate-x-1/2` so it straddles the column boundary,
  which on the LAST column means it hangs 6px past the table's right edge
  (measured: table 1314px in a 1314px pane, scrollWidth 1320). The unpaned path
  is unaffected — `useOverflowOnlyWhenNeeded` compares the TABLE's width, not
  scrollWidth, so the grip never fooled it.
- **Vendor detail has an editable field block** (`catalog/VendorFields.tsx`,
  Mark, 2026-08-01: type, description, order type, url and notes "are not
  reachable/visible… and should be"). `description` and `notes` weren't even
  QUERIED before this — fully invisible, not just read-only — and `vendor_type`
  / `order_type` / `url` were a single line of plain text with no way to change
  them without leaving the page. Every other detail screen (item, vendor item,
  location) has had an inline-editable `dl` since it shipped; vendor detail was
  the outlier. Matches `ItemFields` exactly: **Type** is `kind="pick" allowNew`
  sourced from every `vendor_type` already in the org (one extra `Promise.all`
  query, same move as the item category picker); **Order via** is
  `kind="pick"` with NO `allowNew` — `order_type` is a closed set, the DB's own
  check constraint, not a growing vocabulary — labelled via the new
  `ORDER_TYPE_LABEL`/`ORDER_TYPE_OPTIONS` in `lib/catalog.ts` (hardcoding these
  four values is fine per design rule 2: they're schema, not org config, the
  same reasoning `PO_STATUS_LABEL` already relies on); **Website** pairs the
  `InlineValue` text field with an "Open ↗" link that only renders when a URL
  is stored, wrapped `min-w-0 flex-1` since InlineValue's own trigger is
  `w-full` of ITS parent, not of the row. No role gate, matching
  `ItemFields`/`VendorItemFields`: the write is tried and RLS answers below
  purchaser+, with the error shown beside the field rather than the control
  vanishing. Verified against Amoretti's real (pre-existing, previously
  invisible) `description` — "Flavorings & Extracts" — surfacing correctly, and
  round-tripped a write on Chefs Warehouse's four fields, reverted via a
  one-off local service_role script afterward (never committed) rather than
  left as test data on a live record.
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
  **The search box rides in that cookie too** (Mark, 2026-08-03: filters AND
  searching should survive the trip to an item and back). It had been left out
  on the argument that coming back to a list silently narrowed by a forgotten
  term is its own trap; the sticky controls band retires that, since the term is
  now on screen for as long as it's in force rather than scrolled away above the
  walk. Server-seeded like the rest, so the first paint is already narrowed
  instead of showing 717 items and snapping to 5. It also closes a mismatch
  scroll memory could never see: the position was recorded against six search
  hits and restored into seven hundred rows. Capped at 80 characters — a browser
  drops an oversized cookie WHOLE, so a pasted paragraph would take the day and
  the filters down with it.
  A list that persists sort in the URL must pass `sort`/`onSortChange` to
  `DataTable`, or the header arrow and the URL disagree.
  **A LIST SEEDS ITS STATE FROM THE ADDRESS BAR, NOT FROM ITS PROPS**
  (`urlFilterParams` in `lib/filterMenus`, 2026-08-14). `history.replaceState`
  moves the URL and tells Next its new canonical address, but it does NOT
  rewrite the RSC payload CACHED AGAINST THAT HISTORY ENTRY — that tree was
  rendered for the URL the entry was created with. Back and forward restore the
  cached tree, so a list seeded from `initialFilters` came back with the filters
  it had when you FIRST arrived while the address bar read the ones you set
  (Mark, 2026-08-14, on `/production-items`). Reproduced and then fixed on the
  real screen: arrive at a bare `/production-items`, pick Type = Raised, type
  "samoa", open an item, press Back — URL `?q=samoa&type=Raised`, screen
  "307 items", every menu on All. **All six URL-filtered lists had it** —
  measured on `/items` too by reverting the fix (`?q=flour` restoring as
  "401 of 790") — so the cure is one shared helper, not six patches.
  **THE PATH GUARD IS THE WHOLE OF THE CARE.** Next applies a Link navigation's
  `pushState` in an effect AFTER the incoming tree renders, so during a
  BREADCRUMB's first render `window.location` is still the detail screen's URL;
  reading it there would parse `?from=…&fromLabel=…`, find no filter keys, and
  clear the very filters the breadcrumb exists to restore — breaking the one
  path that already worked. A restore is the opposite: the browser updates the
  URL before it fires `popstate`, so the address bar is already right. Matching
  the pathname is what tells the two apart, and falling back to the prop is
  always safe. Pinned by fixtures (breaking the guard turns the breadcrumb case
  red).
  `router.replace` would keep the router's cache honest by itself and is still
  refused for the reason it always was: it re-runs the server component — both
  cost graphs on `/production-items` — on every keystroke.
  **THE SORT IS PART OF THE VIEW, AND A LIST THAT PUBLISHES A FOUND SET MUST OWN
  IT** (Mark, 2026-08-14, two reports in one: "the chosen column to sort by also
  isn't restored", and — sorting `/production-items` by Item — "angry samoa is
  the first record… it becomes the 67th record"). One cause: four lists left
  sorting to `DataTable`'s own local state. So it was forgotten on every return
  trip, AND `usePublishRecordSet` was handed the FILTERED rows in the order the
  server sent them, which is not the order on screen — `lib/recordSet`'s
  contract says "in the order it is showing it" and they could not honour it.
  The fix is the same both ways: the list holds the sort and orders its own rows
  through **`sortRows`** (`lib/tableSort`, the one implementation — `DataTable`
  calls it too, so a controlled and an uncontrolled table cannot disagree), then
  passes `sort`/`onSortChange` down and publishes the SORTED array.
  It rides in the URL with the filters — `parseListSort` + `filterQuery`'s 4th
  argument, `?sort=type&dir=desc`, absent when there is no sort so the plain
  list keeps one canonical address, and restored by `urlFilterParams` like
  everything else.
  **`/recipes` AND `/plans` JOINED THE CONVENTION** (Mark, 2026-08-14: "do the
  same for recipes and plans"). They had kept search and tier in local state,
  which is why their sort started there too; all three are in the query now, and
  their rows carry `withFrom` so the breadcrumb returns to the view rather than
  to a bare list. **They keep their `TabPicker`** — one dimension, which is what
  that control is for; what they borrow from `lib/filterMenus` is the URL
  CONTRACT, not `ui/FilterMenus`. A dimension is just a declared filter, so
  reusing it beat a fifth bespoke `lib/*Filters` module.
  That needed **`FilterDimension.defaultValue`** — the RESTING value, what the
  dimension says when the URL says nothing and therefore the value that writes
  no parameter. Both lists open on ACTIVE, so without it a plain `/recipes`
  would have started showing all 128. Three consequences, each fixture-pinned:
  `clearedFilters` means back to REST rather than back to everything;
  `activeFilterCount` counts a dimension only once it has MOVED off rest, so a
  list doesn't open reading "Clear 1 filter"; and **a dimension with a default
  needs a real token for "no filter"** (`?tier=all`), because an empty value
  can't be written to a query string, so `FILTER_ALL` and "absent" would be one
  URL and the default would win. Every menu rests at `FILTER_ALL`, so nothing
  else moved.
  Their tab counts now describe the SEARCHED set, `FilterMenus`' rule reaching
  a TabPicker: searching "glaze" reads Active 23 / All 30, where the counts used
  to claim 116 of a list showing 23.
  A `SORT_KEYS` constant per list names the sortable columns for the URL parser,
  because the URL has to be read before `columns` can be built (a cell links to
  this view, so the columns depend on the state seeded from it). **Keep it in
  step with `columns`**: a key missing from it sorts fine and is silently
  forgotten, which is the original complaint again.
- **Scroll restoration is UNIVERSAL and nothing opts in** (`lib/scrollMemory.ts`
  + `components/ScrollMemory.tsx`, Mark, 2026-07-30: "any list view now and in
  the future"). This is what pays for detail views going back to full screen.
  A new screen gets it by existing — do not add a hook call when you build one.
  Two scrollers are covered, because those are the only two a list can have:
  - **The window**, by `<ScrollMemory>` in the (app) layout, keyed by
    **active location + pathname**. In the layout because the layout survives
    navigation: one hook, re-keyed on every move, flushes the page you're
    leaving and restores the one you're arriving at. Location is in the key
    because every list is location-scoped and switching location is a
    navigation to the SAME url. The query string is deliberately out of it —
    filters and sort live there and change per keystroke, and you always return
    to the url you left because that's what the breadcrumb stamps.
  - **A DataTable pane** (`scroll` mode — currently only the vendor's items
    table), keyed by pathname + the table's own `storageKey`. The rows move
    inside the pane and the window never moves, so the page-level memory can't
    see it. Automatic for any future paned table.
  A screen whose identity ISN'T its url publishes its own key with
  `useScrollMemoryKey`. Exactly one does: the **order guide**, because
  `guideDate` is *today* and the picker doesn't move it (so location+path would
  restore Monday's position into Thursday's shorter list), and because the same
  list arrives at both `/order-guide` and `/order-guide?day=4` — a key carrying
  the query would miss on exactly the round trip this exists for.
  Three things it took to make the mechanism reliable, each a trap on its own:
  (a) **Restoring is a negotiation, not one `scrollTo`.** At mount the list
  hasn't reached full height, so a single call clamps to whatever the document
  is at that instant and leaves you short. It re-asserts for up to 12 frames,
  and surrenders the moment the reader wheels/touches/types — deliberately NOT
  on the `scroll` event, which our own scrollTo fires.
  (b) **Writes are throttled by the clock, never deferred to
  `requestAnimationFrame`.** rAF doesn't run in a hidden tab, so a
  frame-deferred write can simply never happen — measured 2026-07-30, the
  position was still unrecorded after a 6,000px scroll.
  (c) **It flushes on re-key and on unmount**, because the throttle can swallow
  the last move and leaving is the moment that matters. There is no `pagehide`
  flush any more — see below.
  (d) **Recording STOPS when you leave the screen, and React says so far too
  late** (Mark, 2026-08-03 — the guide "no longer" restored after opening an
  item). Next scrolls the window to 0 in a layout effect of the INCOMING page,
  and the browser dispatches a scroll event for that within a frame — into a
  listener still armed for the screen you're leaving. `onScroll` recorded it,
  so 20,000px down the walk was overwritten with 0 and the return trip
  restored to the top, which reads as the feature simply being off. `flush()`
  had been protected against exactly this (it writes the cached `latest`
  rather than reading the scroller — "the router may already have scrolled the
  page somewhere else"); the guard just never reached the thing that WRITES
  `latest`. It compares `location.pathname` against the pathname the effect
  started with — **pathname, not href**, because filters and sort ride the
  query string via `history.replaceState`, so a keystroke in a search box
  changes `href` while you are still on the screen being measured.
  It bit EVERY list (measured: Inventory lost 4,000px the same way), but the
  order guide worst, because it is the only screen that names its own key:
  clearing that override notifies a store from inside a passive effect, so the
  shell re-keys a whole render cycle later than a plain path change does —
  measured 216–516ms of exposure against a scroll event every frame.
  **Note the reproduction, because the pane can't do it by itself**: a hidden
  browser pane never dispatches a scroll event for a programmatic `scrollTo`,
  so the round trip looks healthy there. Deliver the event yourself from a
  `MutationObserver` callback — those are microtasks, which the pane does NOT
  throttle, so it lands inside the navigation commit, exactly where the real
  one does.
  **It RESETS on launch and on changing location** (Mark, 2026-07-31). The store
  is a module-level `Map`, not sessionStorage: sessionStorage survives a reload
  and a sign-out in the same tab, so opening the app could drop you two thousand
  pixels into a list you last saw yesterday. In memory, a hard load — launch,
  reload, sign-in — has nothing to restore, while the thing this exists for
  still works, because the (app) layout survives soft navigation and a
  list → detail → back trip is all one page load. That's also why the `pagehide`
  flush went: it existed to survive a reload, which is now exactly the moment
  the position SHOULD be forgotten.
  Changing location additionally calls `clearScrollMemory()` and scrolls to the
  top (`useResetScrollOnLocationChange`, declared BEFORE `useScrollMemory` in
  the shell so the clear lands between the outgoing key's flush and the incoming
  key's lookup). It has to be explicit: switching is a navigation to the SAME
  url, so nothing moves the window by itself and you'd stay parked deep in a
  list that now holds different rows. The location stays in the key as well —
  belt and braces, since the failure it prevents is silent.
- **Breadcrumbs follow the route taken**, not a fixed hierarchy (`lib/breadcrumbs.ts`):
  links stamp `from`, the trail nests, recorded hrefs are trimmed so the URL
  can't grow unbounded. An item reached from a vendor leads back to that vendor.
- **Detail views are FULL-SCREEN PAGES** (Mark, 2026-07-30 — reversing his
  2026-07-23 call). `/items/[id]`, `/vendors/[id]`, `/vendor-items/[id]` and
  `/purchase-orders/[id]` are ordinary routes reached the ordinary way; there
  is no `@panel` parallel slot, no `(.)` intercept, no `DetailPanel.tsx`, and
  no `inPanel` prop — all deleted 2026-07-30. **Breadcrumbs** are how you get
  back and the only cue to which kind of record you're on, so every detail body
  renders them unconditionally (they were suppressed in the panel, which had a
  black type strip instead). Bodies stay split out from their page shells
  (`ItemDetail.tsx` / `VendorDetail.tsx` / `VendorItemDetail.tsx` /
  `PurchaseOrderDetailView.tsx`) — edit those, not the one-line pages. Each
  `[id]` segment carries its OWN `loading.tsx`; without one the list's
  loading.tsx a segment up covers the wait and announces the wrong thing
  ("Loading the vendor list…" while a vendor opens). What the panel bought and
  a page can't: the list underneath stayed mounted, so scroll survived a round
  trip. Filters and sort still survive (URL / the guide's session cookie), and
  scroll is bought back for every screen — see scroll restoration below. New
  detail screens are just pages.
- **A detail screen that outgrows one page becomes TABS, and the employee record
  is the pattern** (Mark, 2026-08-06: "the employee detail page is getting a
  little unwieldy", with Gusto's employee sidebar as the reference; then, having
  seen it, "if we need tabs in any detail view in the future, this is the way to
  do it, and we should reuse the code here so it doesn't drift" — **specifically
  `ui/SectionNav`**). Copy the shape; do not re-derive it.
  **The nav is `ui/SectionNav`, NOT a `ui/TabPicker`.** The convention says every
  one-of-N choice is a TabPicker with a black selected cell, and that rule is
  about CHOOSING — a filter, a scope, a view mode, things that change what a
  screen shows you. Sections NAVIGATE: each is a real address, back walks them,
  they open in a new tab. `AppNav`'s two tiers are navigation too and mark active
  with weight and colour rather than a filled cell, so this reads like those. A
  bordered box beside a bordered table beside a bordered filter row was three
  boxes deep before anybody had read a word. TabPicker was tried vertically first
  and reverted to byte-identical.
  **The tab lives in the URL** — view state, the same rule as filters and sort —
  through three pure helpers in the record's own lib module, fixture-tested:
  `EmployeeTab` + `EMPLOYEE_TABS` + `EMPLOYEE_TAB_LABEL`, `parseEmployeeTab`
  (anything unrecognised falls back to the first tab: a stale bookmark should
  show you the record, not an error), and `employeeTabHref`, which carries the
  CURRENT params through — `from`/`fromLabel` above all, or moving between tabs
  strips the breadcrumb trail and the record book loses its found set. **The
  default tab writes no parameter at all**, so the record keeps one canonical
  address and every link already stored still points at it.
  **The real win is that each tab fetches only itself.** Measured on the employee
  record: Info runs **1 query where the whole page ran 13**, and only the
  Documents tab signs a Storage URL. A `SKIP = { data: null, error: null, count:
  null }` stands in for an unwanted query so the `Promise.all` destructuring
  keeps its shape.
  **The identity block sits ABOVE the split and is INDENTED to the content
  column** — `lg:ml-48` is exactly the sidebar's `lg:w-40` plus the row's
  `lg:gap-8`. THOSE THREE VALUES ARE COUPLED; change one and the heading drifts
  off the content it belongs to. The name stays put while the sections change
  under it, with a `status · position · shop` line beneath it carrying the facts
  you'd otherwise change tabs to check.
  **Below `lg` it stacks**, `orientation="horizontal"` above the content: five
  vertical cells cost 180px before anything is read, which an iPad can't spare.
  The two orientations are **wrapped in their own visibility divs** rather than
  switched with a responsive `display` utility on the control — Tailwind resolves
  competing utilities by STYLESHEET order, not class-string order, so a `hidden`
  passed in `className` would not reliably beat the component's own `flex` (the
  trap that put the ⋯ menu's hints beside their labels).
  **A table's command shares the SECTION HEADING's line, in a full-width row
  above the strip** — `flex items-center justify-between`, heading left, command
  right. Four placements were tried on New event and the three failures are the
  whole argument:
  · *under the table* — past the fold on any record with more than a screen of rows;
  · *stacked above the columns eye* (a `DataTable action` prop, since REVERTED —
    the table is byte-identical to before) — the right-hand cell became 76px
    against the filters' 36px, and `items-end` bottom-aligned the tiers to the
    eye, leaving ~40px of nothing under the heading (Mark: "a large gap between
    the section header and the filter buttons");
  · *on the heading's line but INSIDE `leading`* — `leading` is a `min-w-0
    flex-1` box with the eye's cell beside it, so anything right-aligned in there
    stops ~48px short of the table's edge (the gap plus the eye).
  This is the one case where a heading does NOT go in `leading`, and the reason
  the usual rule doesn't bite: that rule exists because an otherwise EMPTY 32px
  band opened a 44px hole under the heading, and a strip carrying filters has no
  empty band to close. `items-center`, not `items-end` — a 16px heading and a
  36px button share a centre line, not a baseline.
  One more thing the move earned: a block that was hiding from crowding can stop
  (`RevealPanel alwaysOpen` — paperwork got its own tab, so the reveal had
  nothing left to avoid).
  Known gaps, neither fixed: `RecordNav` doesn't carry the tab, so walking to the
  next record lands on the first one; and `ScrollMemory` keys on pathname without
  the query, so all five tabs share one scroll position — `useScrollMemoryKey` is
  how the order guide solves exactly that.
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
  2026-07-31). 66 cases over the pure modules — `lib/invoiceMatch` (the SKU
  join, its two relaxations, the description fallback, and the real Guittard
  pair that killed Jaccard) and `lib/receiving` (the two-stage price button, the
  never-overwrite fill rule, pack labels). Before this the repo had no runnable
  tests at all and the invoice brief told you to "re-run the 23 fixtures", which
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

- **`InlineValue`'s OPEN EDITOR CARRIES NO `aria-label`, where its resting
  button does** (found 2026-09-03 while testing the checklist template's unit
  cell). A screen reader names the field until you click it and then loses the
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
reports, standalone inventory-count UI. Deferred to v2+: order suggestions,
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
Square. Also killed: any **A/R status pull** from QuickBooks, for the same
second-source reason — where the A/P pull is right, because nothing here stores
a vendor payment. See build step 4l.
**QBO A/R INVOICING IS PROVISIONAL** — it comes out if special-order collection
moves to Square invoicing, which syncs to QBO itself, at which point pushing an
Invoice here would double-count the revenue. It does NOT double-count today
(Mark's reading of his own books, 2026-09-02): another app records and
categorises Square SALES nightly, and special orders are not invoiced through
Square yet. Removal is about an hour and touches nothing A/P uses.
When in doubt whether a feature belongs, check the spec's kill list or ask Mark.
