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
   browser. The triangle TRAILS the item name (Mark, 2026-07-26 — the name is
   what you scan for down the walk, so nothing sits to its left) and is offered
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
   **masthead collapses** (see Conventions).
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
   (`lib/receivingLayout.ts`, the `chromeStore`/`columnWidths` idiom); the
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
   **One receive control**, in the ActionBar: `Receive n from invoice` when an
   extraction exists, `Receive n as ordered` when not, filling only lines with
   NO quantity. With an invoice it fills MATCHED lines only — filling the rest
   from the ordered quantity would assert that something arrived which nobody
   billed us for. **And it can be undone**: a band offers Undo, which nulls back
   the specific line ids it just set (held in state, not re-derived). Not a
   general undo stack — this is the only action that changes fifteen rows on one
   tap.
   **The bar ends `Finalize` · `Close`** (Mark, 2026-07-31): Finalize is the old
   "Close order" — `closeReadiness`, which names what's unresolved and lets you
   through anyway — and Close is the way back to PO detail. They sit together in
   the TRAILING group, reading as a form's footer, which is the one deliberate
   exception to the bar's act-here / move-there split.
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
4b. 🚧 **The Location module** — the first screen outside Purchasing (Mark,
   2026-07-30). `locations` was the one table with no UI at all: nothing in
   `web/src` wrote to it, and its six rows still carried raw FileMaker text in
   `settings` (`"10am␝10am␝…"` for hours, `LaborRate_n` as a string) while 42
   of FMP's 51 location columns had been dropped at transform time. Shipped:
   **`/location`** — the location you're WORKING AT, singular and id-less;
   there is no list and no `[id]` route, because the section tab already wears
   the active code and the switcher reaches the rest. One page, no tabs: FMP's
   INFO2 was SMTP credentials (replaced by the provider layer, and never to be
   displayed) plus three unbuilt modules, and REQUESTS was three more. Blocks:
   identity, the two addresses, operating hours, tax/labor/registers, the
   production mapping, four counts that link out, and a read-only statement of
   which email tier POs go through. **`/shop-sections`** — the 168 rows that
   order the guide's walk, editable at last, location-scoped, with a guarded
   delete (the FK is `on delete set null`, so deleting a section moves its
   items to "No section" rather than deleting them).
   **The switcher now lists ALL SIX locations**, closed ones under an
   "Inactive" optgroup — an inactive location is a record you maintain, not a
   shop you work in, so `components/InactiveLocationGate.tsx` in the (app)
   layout replaces every screen except `/location` with a sentence and an
   Activate button. Without it those screens don't break, they just render as
   inexplicably empty tables. One component; delete it and the wiring line to
   go back. Schema: migration 017 + `migration/backfill-locations.mjs`.
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
2. **Zero business hardcoding**: business names, billing entity, PO number
   format, email templates, terminology live in `orgs.settings` /
   `locations.settings` jsonb — never in code. (The old system hardcoded
   "The Donut Friend Team" into a script; we don't.)
3. **Location context**: the user is always "working at" one active location
   (persisted per user in `org_members.last_active_location_id`); every
   location-scoped screen filters by it; switching is a 2-tap header control.
   The session carries TWO lists and picking the wrong one is a silent bug
   (2026-07-30): **`session.locations` is every location**, closed ones
   included — use it to LOOK UP a code by id, and a `vendor_locations` row at
   DF03 stops rendering an em dash. **`session.activeLocations` is the subset
   you ENUMERATE** — a row per location, a scope over locations (item detail's
   per-location rows, the vendor item's price rows, cleanup's all-locations
   mode), so three closed shops don't sprout dead rows everywhere. And
   `activeLocation` must resolve over the FULL list: resolving it over the
   active-only one falls through to the `?? …[0]` fallback and snaps a switch
   to DF04 silently back to DF01, which looks exactly like the switcher being
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

- **USE THE PARTS THAT EXIST — don't hand-roll a second one.** This app has no
  component library by design (Next ships none, Tailwind ships none), so every
  shared control is one we wrote and every one of them encodes a decision that
  was expensive to reach. Reaching for a raw `<input>`, `<select>`, `<table>`,
  a floating panel or a bespoke button is nearly always a mistake — and one
  that shows, because the second version never behaves quite like the first.
  The inventory, with the rule each embodies (details in the bullets below):

  | Reach for | Instead of | For |
  | --- | --- | --- |
  | `ui/PickList` | `<select>`, free text | choosing from a known vocabulary; opens below the field, portals so panes can't clip it |
  | `ui/Dialog` | a hand-rolled overlay | every floating dialog; pins its title bar and footer, scrolls only the middle, and neutralises the properties it inherits from its trigger. `DIALOG_CANCEL/COMMIT/DANGER_CLASS` for the footer buttons |
  | `ui/RowMenu` | a `⋯` you wire yourself | a table row's own commands; shares `lib/anchoredPanel` with PickList, so it escapes scroll panes the same way |
  | `catalog/InlineValue` | a hand-wired edit-in-place | any editable cell — `kind` text / number / date / **pick**; `jsonColumn` + `jsonPath` + `jsonDocument` to edit a key INSIDE a jsonb column |
  | `ui/TextInput` | `<input type="text">` | wide free-text fields; carries the ✕ clear |
  | `ui/Checkbox` | `<input type="checkbox">` | every checkbox, no exceptions |
  | `catalog/DataTable` + `ColumnHeader` | `<table>` | every list: sort, resizable columns, sticky head, 56px rows, pane scroll memory |
  | `catalog/ActiveToggle` | a bespoke switch | the Active column, which leads every catalog table |
  | `catalog/WeekdayPicker` | seven buttons | any day-set; its column must be `WEEKDAY_PICKER_WIDTH` |
  | `catalog/ListFilters` | a filter row | search + category + active + last-ordered, together |
  | `catalog/BaseUnitEditor` | writing `base_unit` | changing a unit — it recomputes package contents and warns about pars |
  | `catalog/InventoryItemPicker` | a search box | finding and linking an inventory item |
  | `ui/ActionBar` + `ActionBarButton` | a button row | screen-level COMMANDS only (not view controls) |
  | `ui/PageLoading` | a spinner | the body of every `loading.tsx` |
  | `ui/ProgressBand` | a word in a button's label | something slow on a screen that's ALREADY painted (an invoice read is 30s+); same indeterminate bar, never a Dialog — the work behind it must stay usable |
  | `ui/Pane` + `PaneHeader` | a bordered div with a header band you style yourself | a framed column standing beside another (receiving's document + lines): one FIXED-height band so the two rules line up, and `overflow-hidden` so nothing paints over the frame |
  | `ui/RecordNav` + `lib/recordSet` | going back to the list for the next record | FMP's book on a detail screen: the LIST publishes its found set, the detail walks it |
  | `DataTable columnChooser` | a bespoke checklist, or placing `ColumnsMenu` yourself | show/hide columns on a list — the table puts it above its own last column header; pair it with `DataColumn.pinned` on the column that IS the row |
  | `ui/BackToTop` | — | long lists; already on the guide |
  | `components/Breadcrumbs` | a back link | every detail screen, unconditionally |

  Free for nothing, because the shell already does it: **scroll restoration**
  (`components/ScrollMemory` in the (app) layout — a new screen is covered by
  existing) and the **collapsing masthead** (`HeaderShell`, which publishes
  `--rf-header-h`). Vocabularies and conversion live in `lib/units.ts`
  (`UNIT_PICK_OPTIONS`, `PACKAGE_DESC_OPTIONS`); the other shared brains are
  `lib/breadcrumbs`, `lib/columnWidths`, `lib/tableSort`, `lib/calc`,
  `lib/scrollMemory`, `lib/chromeStore`.

  If something genuinely new is needed, build it in `components/ui/` as a
  general control, use it in at least the place that prompted it, and add a row
  here — that is how this list came to exist.
- **The look is the `restaurantfriend-design` skill** (a user skill, outside
  this repo — read `handoff/PORT-GUIDE.md` §8 FIRST, then `readme.md`, then the
  relevant `<Name>.prompt.md`). Applied wholesale 2026-07-25: black masthead,
  square corners, no shadows, no blue, colour only ever means record STATE.
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
- **The menu is two tiers, from FMP** (Mark, 2026-07-25 — overrides the design
  system, which had killed the sub-nav): sections on top, that section's
  sub-sections under it, both bands black, **both marking active in yellow**
  (told apart by 12px vs 11px, white/60 vs white/50, and a `white/15` hairline).
  Six sections — the first is labelled with the ACTIVE LOCATION CODE, not
  "Location". Only Purchasing is built (Vendors · Inventory · Order Guide ·
  Purchase Orders · Cleanup, Mark's order); everything else lands on
  `/soon/<section>/<sub>`, one shared placeholder. **The menu is
  `web/src/lib/nav.ts`** — a screen ships by getting a real `href` there and
  nothing else moves. Home and Settings are utility ICONS, not tabs, so they
  light no tab and the second band hides entirely on those routes.
  Per-section memory (first visit → first sub, later → last sub used) lives in
  the session cookie `rf.nav` (`lib/navMemory.ts`), **seeded by the server and
  then owned by the client** (`lib/navMemoryStore.ts`): a server layout does not
  re-render on soft navigation, so a client-written cookie can never be read
  back mid-session and the tab hrefs would freeze. `signOut` deletes it.
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
- **The masthead collapses to a strip** (Mark, 2026-07-27 — two black bands plus
  the utilities row cost ~88px at the top of every screen, "too much space…
  should probably scroll away… we would need a shortcut to bring it back").
  Collapsing beats scrolling away, and is what that shortcut wants to be: the
  strip is ALWAYS on screen, so the menu returns with one tap from anywhere in
  an 800-line list instead of a scroll to the top. It also keeps the header
  sticky. `components/HeaderShell.tsx` owns stickiness, the toggle
  (▲ in the utilities cluster, "Menu ▾" in the strip) and the state; the strip
  keeps the two things you'd otherwise lose — which app this is and WHICH
  LOCATION you're ordering for. Remembered per user in localStorage
  (`lib/chromeStore.ts`, `useSyncExternalStore` like columnWidths), because it's
  a display preference. HeaderShell also publishes the header's MEASURED height
  as `--rf-header-h` (seeded at 5.5rem in `globals.css`), and the order guide's
  scroll pane subtracts that variable instead of a constant — so collapsing
  hands those ~56px straight to the list, which is the point. Any other screen
  sizing itself against the viewport should use the variable too.
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
- **A dialog pins its title bar and its footer, and scrolls only the middle**
  (`max-h-[85vh] flex flex-col` + `min-h-0 flex-1 overflow-y-auto` on the body).
  The overlay is fixed, so a dialog taller than the window cannot be scrolled by
  the page and its footer is simply unreachable — Generate POs wanted 990px in a
  900px window at 12 vendors, putting "Create N POs" 162px below the fold on the
  first real ordering day. This lives in `ui/Dialog` now (2026-07-31), which was
  extracted from the three hand-rolled copies that had each learned a different
  subset of these lessons; `toolbar` is the pinned band under the title bar for a
  search box that must not scroll away.
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
  Filter dropdowns are still native `<select>`s: they choose a VIEW, not a
  value, and nothing about them was broken. Convert them if the split ever
  reads as inconsistent.
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
  `lib/tableSort.ts` (comparator — empty cells sink last in BOTH directions),
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
  `compactBelow` survives but now means only "too many columns to READ here",
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
- **Every list can hide columns** (`catalog/ColumnsMenu` + `lib/columnVisibility`,
  Mark, 2026-07-31). `DataTable` renders it itself, `columnChooser`-gated,
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
  `DataTable` reads the hidden set off its own
  `storageKey`, so a table gets this by having a key rather than by opting in,
  and it composes with `compactBelow`: the narrow-screen set still sheds, and
  yours comes out on top of it. Stored as the HIDDEN keys, not the visible ones
  — a column added next month then shows up for everyone instead of being
  silently missing for anyone who ever opened the menu. `pinned` keeps the
  column that IS the row (Item, Name, Display name, PO number) out of the menu;
  control columns have no label to offer.
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
  (sort_order, e.g. "31 Storage - R1 S1" — maintained at `/shop-sections`,
  per location), item headers show par, vendor items
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
  The in_person **shopping list is internal** and keeps its prices, its
  estimated total, and the composed pack.
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
- **`rep_email` looks mis-mapped by the migration** — Restaurant Depot's rows
  carry `info@donutfriend.com` (our address, not the vendor's). Check the other
  79 vendors before trusting the column.
- **"Last ordered" on the vendor screen** means "this item, at this location,
  from any vendor" — the Inventory semantics. A true per-vendor-item last-order
  date needs a small view over `purchase_order_items` (migration 006).

## What NOT to build (deliberately killed or deferred)

Killed: location transfers/packing lists, PO_Type taxonomy, most legacy
reports, standalone inventory-count UI. Deferred to v2+: order suggestions,
minimum helper, spend dashboard, collaborative ordering, offline.
~~Invoice OCR~~ **built 2026-07-31** — it moved out of v2 because attachments
made it a small feature rather than a project: the invoice was already in the
system, the PO line already snapshotted the vendor's SKU to join on, and the
price-reconciliation band was already the place an answer could land. See build
step 4.
When in doubt whether a feature belongs, check the spec's kill list or ask Mark.
