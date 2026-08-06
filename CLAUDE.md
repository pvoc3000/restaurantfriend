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
   `components/LocationSwitcher.tsx` is deleted. The list leads with the Active
   toggle (purchaser+ only, per 001's policy) and ENDS with the **Working**
   column (Mark, 2026-08-01 — read the row, then act on it, and the control you
   press repeatedly sits against the right edge, like the guide's stepper) —
   `components/location/WorkingHere.tsx`, three states: a YELLOW `WORKING HERE`
   chip on the one you're at (`bg-mark-fill`; it was a BLACK fill until
   2026-08-02, when Mark read it as a button — down a table column the boxes sit
   56px apart, so they aren't read as one segmented control the way a
   TabPicker's abutting cells are, and alone a filled box with a label is a
   button. Yellow is already this app's mark for WHICH ONE YOU ARE AT: `AppNav`
   marks the active section `text-mark`, and no button anywhere is filled
   yellow. The 130×30 optical compensation went with the black — a pale fill is
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
   `/locations/<working id>`; the nav's tier-2 item is now "Locations"
   (`lib/nav.ts` — one line), and the tier-1 tab still wears the working code,
   which is now the only place it's always on screen.
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
   follow**: a command right-aligned in the list's filter row → `ui/Dialog` →
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
   The real Homebase CSVs (DF01 + DF02, the 07/20–08/02 fortnight) have
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
   which fortnight is open); write is owner/admin; no delete policy. The
   fortnight lives in `orgs.settings.payroll` per design rule 2 — 024's lesson
   that a statement true of finished data is still wrong as a constraint.
   Loaded the real calendar: **178 periods, 2019-10-07 → 2026-08-02**, every one
   14 days from a Monday, zero gaps, zero overlaps, re-derived from the file by
   the transform rather than taken from the brief. All land `closed`, so history
   is read-only by construction. The loader deliberately does NOT open the
   current period — that arithmetic lives once, in `nextPeriodAfter`, or it is
   016's `nextDeliveryDate` trap. **So after the load there is no open period
   and `/pay-periods` opens on an empty `Current` filter; that is expected, and
   the empty state says so and routes you to New pay period.**
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
   is an empty current fortnight. **No `/timesheets/[id]` route**: a shift is a
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
   covers, and ZERO waivers are loaded** because FMP keeps them in its Events
   table, which was never migrated. Loading them is the fix; nothing in this
   module pays anybody meanwhile.
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
   shift id and a fortnight is re-exported whenever somebody fixes a punch.
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
   fortnight.
   **THE `(Primary)` SUFFIX IS NEVER STORED.** Both columns hold the bare title
   and the export appends it by comparing them, which makes the file's central
   invariant STRUCTURAL: one `primary_wage_type` per person → exactly one
   primary row → exactly one place for the earnings. Storing it per shift would
   let a fortnight produce two primary rows, or none. The backfill reads FMP's
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
   one full fortnight through both FMP and this module, diffed per employee,
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
   accepts BOTH spellings — which is what makes the fortnight already imported
   work with no backfill and no re-import — and the importer writes the canonical
   snake_case names beside the raw row, so the two sources stop drifting. That
   also fixes the row expansion, which reads the same keys and had shown em
   dashes for every imported shift.
   Measured on the real 07/06–07/19 fortnight: **61 late meals found where the
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
   Also: **importing has exactly ONE door, and it is inside the New timesheet
   dialog** (Mark, 2026-08-05: "It adds a click, but is a clear work flow New
   Timesheet → Import"). It began as a link buried in a paragraph, became a
   button on the timesheets list AND the pay-period list, and ended as a single
   control in that dialog's footer — which is the right place, because "I need a
   timesheet that isn't here" is the question the form and the import both
   answer. It sits at the far LEFT of the `justify-end` footer (`mr-auto`), away
   from the commit: it navigates away rather than completing the form, so it must
   not read as a second commit. White, being no panel's own commit, and a `Link`
   so it stays a soft navigation; the importer OFFERS to open the period a file needs,
   continuing the cadence from `nextPeriodAfter` rather than wrapping the file's
   dates, where it used to state that none covered them and stop; the import screen ends with
   a **black `Done`** at the lower right, OUTSIDE the `plan &&` block so it is
   there both before a file is dropped and after one is committed — committing
   clears the plan, so the screen had been leaving you on a success banner with
   nothing to press. Black is the panel-commit exception rather than a breach of
   it: importing produces ONE outcome and that row is a commit beside no peers,
   which is the argument the receiving screen's Complete rests on, reusing the
   same `DIALOG_COMMIT_CLASS`. The rows-with-no-punches list is one collapsed
   line, because those rows are the NORMAL case
   — Homebase prints one for every scheduled day — and ten warnings in front of
   someone whose file is perfect teaches them to skim the section that also holds
   the real failures; and **"fortnight" is "pay period"** in every visible
   string.
   Known and NOT a bug: 90 meal findings on that fortnight's 163 shifts reads as
   a lot, and 28 of the 31 no-meal days would be covered by a signed waiver. Zero
   waivers are loaded — FMP keeps them in its Events table, never migrated —
   which is the same data gap already recorded under phase 5.
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
   on the 07/20–08/02 fortnight: 6 rows, all Gaspar's, 3.03 hours over-counted.
   **ONE PLACE TO DO THE WORK, AND IT IS THE TIMESHEET ROW** (Mark, 2026-08-05:
   "I'm not sure whether it's in pay periods or in timesheets, but there should
   be one place to do what we need… Timesheets seems more natural to me because
   there's more info there so you can judge errors more clearly. In Pay Periods
   you have to just take the app's word for it"). The meal-premium decision and
   the tip-pool figure moved out of the pay-period worksheet and into the row's
   own expansion (`ShiftDecisions.tsx`), beside the punches, the recorded meal
   and the day's hours. The worksheet KEPT its three totals and lost both
   editors; it is now the view before you export — how many decisions are
   outstanding and what they come to — with a link to the period's timesheets.
   The export stays there regardless: `freeze_pay_period` is period-scoped.
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
   the other two, and a fortnight carries ninety findings, most of them a short
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
   **Shipped 2026-08-05 — PAYROLL BENEFITS (migration 033, NEEDS APPLYING).**
   Flat money somebody earns for working a shift: the commuter allowance, and a
   shape general enough for the overnight differential and reimbursements Mark
   has already named. It fills `custom_earning_commuter_benefit`, which
   `lib/gustoExport` had been emitting as a hardcoded empty string — so the
   export as it stood was **$432 a fortnight short across five people**.
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
   freezing fortnights with no benefits in them and no error. With the drop a
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
   07/20–08/02 fortnight matches Mark's actual Gusto file person for person —
   $432.00 vs $432.00.**
   **Qualification is PUNCH-BASED, not hours-based**, and that is the choice a
   rewrite would most likely flip: a flat allowance pays for showing up, so a
   quarter-hour shift earns it in full and a nine-hour PTO adjustment earns
   nothing. There is **no per-hour or percentage unit and there must never be
   one** — a percentage would be a percentage of wages, which needs a rate, which
   decision 1 forbids storing.
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
   sync** but leave the seams; an **explicit approval, Manager and Owner only**;
   **many-to-many is real**; the tables are **`vendor_invoices` /
   `vendor_invoice_lines`** (a bare `invoices` is a name the unbuilt Quotes &
   Orders module will want — the collision `purchase_orders` already dodged);
   and **attaching + reading an invoice on a PO files it automatically**.
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
   The check constraint widens in one line later. **Duplicate detection warns
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
one that matters: two live overloads would let a stale tab freeze a fortnight
with no benefits in it and no error. A second `--apply` wrote 0 new and updated
19, so the select-then-update idempotency holds without an `on conflict` target.
Then the whole stack was run against the LIVE database — 159 shifts, 19
entitlements, 36 accruals — and the produced CSV matches Mark's real Gusto file
person for person, **$432.00 against $432.00**, with the sick-hours header
assertion and the 18-cell width both holding on the real file.
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
**031 is NOT applied yet** — until it is, the pay-period record replaces its
worksheet and export with "column timesheets.wage_type does not exist", which
is the intended behaviour rather than an empty screen. Probe with
`select count(*) from timesheets where wage_type is not null` (~44,700) and
`select count(*) from employees where primary_wage_type is not null` (198), and
confirm `select count(*) from timesheets where wage_type like '%(Primary)%'` is
ZERO — the suffix must never be stored.
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
raw reading, which is the intended asymmetry.
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
   `/locations` (it was a 2-tap header control until 2026-08-01).
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

- **USE THE PARTS THAT EXIST — don't hand-roll a second one.** This app has no
  component library by design (Next ships none, Tailwind ships none), so every
  shared control is one we wrote and every one of them encodes a decision that
  was expensive to reach. Reaching for a raw `<input>`, `<select>`, `<table>`,
  a floating panel or a bespoke button is nearly always a mistake — and one
  that shows, because the second version never behaves quite like the first.
  The inventory, with the rule each embodies (details in the bullets below):

  | Reach for | Instead of | For |
  | --- | --- | --- |
  | `ui/PickList` | `<select>`, free text | choosing from a known vocabulary — a VALUE or a filter's VIEW; `variant="inline"` in a cell, `variant="field"` as a standalone box. Opens below the field, portals so panes can't clip it |
  | `ui/Dialog` | a hand-rolled overlay | every floating dialog; pins its title bar and footer, scrolls only the middle, and neutralises the properties it inherits from its trigger. `DIALOG_CANCEL/COMMIT/DANGER_CLASS` for the footer buttons |
  | `ui/RowMenu` | a `⋯` you wire yourself | a table row's own commands; shares `lib/anchoredPanel` with PickList, so it escapes scroll panes the same way |
  | `catalog/InlineValue` | a hand-wired edit-in-place, or a bare `<input type="date">` | any editable cell — `kind` text / number / date / **pick**; `jsonColumn` + `jsonPath` + `jsonDocument` to edit a key INSIDE a jsonb column |
  | `ui/SectionHeading` | a hand-styled `<h2>` | the heading over a block on a detail screen (16px bold black, optional `count`) |
  | `ui/TabPicker` | underline tabs, loose chip rows, hand-rolled segmented bars | every one-of-N choice — filters, scopes, view modes; the order guide's segmented style. Selected cell is ALWAYS black; `count` and `href` are the only options |
  | `ui/TextInput` | `<input type="text">` | wide free-text fields; carries the ✕ clear |
  | `ui/DateField` | `<input type="date">` | EVERY date box. Carries the Safari empty-date apparatus (see the date bullet); `InlineValue kind="date"` wraps it, and a create form uses it directly |
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
  | `ui/DocumentChip` | a bordered div with a thumbnail strip | a filed document in a list — PO attachments, employee paperwork. Full-bleed preview (image, or PDF via `<object>`) with the text semi-opaque over it; the plugin is `pointer-events-none` and a transparent anchor takes the click |
  | `ui/StickyFooter` | a hand-placed `fixed bottom-0` div plus a guessed spacer | a band pinned to the foot of the window — PO paperwork, employee paperwork. MEASURES its own height into a spacer so the page's last block doesn't slide under it, minus what already follows (the layout's `py-8`), and fires a `resize` so `useFillViewportHeight` reclaims space when it SHRINKS |
  | `ui/RevealPanel` | a section that is always fully open, or a hand-rolled hover-expand | a block whose body costs more screen than it earns — both paperwork areas. Header always visible (title, count, Add as, Attach, progress, errors); the body opens on hover, on focus, or from a pinning toggle, and is ABSOLUTELY POSITIONED so it never reflows the page |
  | `ui/FileDropZone` | `onDrop` on a div | dropping files onto a region. Its OVERLAY takes the drop (a PDF `<object>` is a plugin and swallows drag events — confirmed working over a live PDF, Mark 2026-08-04), it arms off WINDOW drag events so it's up before the pointer arrives, it vets types itself (`accept` governs only the picker), and it stops a stray drop navigating the page away |
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
  `lib/scrollMemory`.

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
  purchaser+; HR and member management need admin+.
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
- **Per-location app access is deferred, and Mark wants to revisit it**
  (2026-08-01: "defer for now but it is something I definitely want to
  revisit"). FMP's ADMIN tab had a DEFAULT LOCATION and an ACCESS LOCATIONS
  checkbox grid per user; today every member can work at every location and
  only their ROLE limits them. 001 anticipated this — "per-location roles can
  be added later (`location_members`) without disturbing this" — but it now
  touches more than it did: `getAppSession`'s two lists, the `/locations` list
  that grants Work here, and every location-scoped screen. Don't build it
  speculatively; when it comes back, ask whether the rule is "may work at" or
  "may see", because they are different tables.
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
When in doubt whether a feature belongs, check the spec's kill list or ask Mark.
