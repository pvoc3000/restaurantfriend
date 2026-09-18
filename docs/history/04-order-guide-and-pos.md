<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

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
   **IT IS A CHECKBOX CALLED "Ignore Order Days", IN THE FILTER ROW RIGHT OF
   GROUP BY, SINCE 2026-09-11** (Mark), which reverses its own row of the day
   before — and the same edit is what makes the reversal fit: as a 46px switch
   under a sentence-cased "Ignore ordering days" it was the widest thing in that
   band and had to wrap, where a 24px box beside a shorter label is about half
   that. It was also the LAST hand-rolled switch in the app, which the
   "there are no switches" sweep missed because it was a `role="switch"` BUTTON
   rather than a `ui/Switch`.
   Measured: the row is ONE line down to 800px of content (about an 864px
   window) and two below that — where it was always two, so the sticky band is
   ~44px shorter at every real desk width. `pb-0.5` is what puts it on the
   FIELDS' line: `items-end` levels boxes, and a 36px `PickList` in a
   `ControlField` sits on the row's floor while a 24px box centred in its own
   36px row does not.
   **THAT CONTROL IS DESK-ONLY SINCE 2026-09-10** (Mark: "drop the ignore
   ordering days switch on tablets"), and what the tablet drops is the MODE
   rather than the widget. The flag is remembered in `rf.guide.view`, so hiding
   the control alone would let an iPad that had it on yesterday open with the
   gates lifted and nothing on screen to put them back — a mode you cannot
   LEAVE is worse than one you cannot enter. So `useShell()` decides the VALUE
   (`const ignoreDays = tablet ? false : ignoreDaysSetting`) and every reader
   sees false, the cookie write included, which settles a stale flag on first
   open. Verified: a tablet handed `ignore=1` renders exactly what gates-on
   renders and rewrites the cookie to `ignore=0`.
   Shell, not viewport — a narrow desk window keeps the switch. It also
   overrules the standing "a control that VANISHES cannot be told from a
   feature that does not exist" rule, deliberately; what keeps that honest is
   that **nothing left on the tablet NAMES the switch** — the empty state drops
   its own "Turn on Ignore ordering days" instruction, checked by searching the
   guide down to no rows under each shell. If any new copy mentions it, that
   copy needs the same branch.
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
   **THE PO LIST'S COMMANDS ARE ONE ACTIONS MENU TOO** (Mark, 2026-09-11,
   the day after PO detail's) — `ui/ActionMenu`, replacing a Documents
   `MenuButton` and five buttons that between them made the selection bar six
   commands wide and wrapping. It is the same argument that put Documents
   behind a trigger there in the first place, which is why that menu is now a
   SUBMENU rather than a sibling: **Mark** ▸ Sent · Received · Closed ·
   **Documents** ▸ Preview POs · Download POs · Preview Shopping Lists ·
   Download Shopping Lists, then a rule, then **Delete** (red) and **Clear
   Selection**.
   **IT SITS BESIDE THE WINDOW TOTAL, NOT IN A BAR** (Mark's placement) —
   `ml-auto` on the total pushes the pair to the right margin, and the title
   row went `items-end` → **`items-start`** so the h1, the total and the button
   all start on one line, which is `PageHeading`'s own rule reaching the two
   headers that keep their own markup because they carry a total.
   **AND `items-start` LEVELS BOXES, NOT INK** — the top half of the
   2026-08-31 lesson that gave the guide's last-purchase label its
   `relative bottom-[2.75px]`. With every box top at 96 the 12px "Window total"
   label's CAP started at **100.9** while the button's border — a hard line —
   started at 96, and Mark read the total as "a few pixels low". He was right
   to a tenth: measured at **4.9px** across four font fallbacks and confirmed
   from the metrics (18px line-height over 12px = 3px half-leading, baseline
   109.5, cap ~0.72em), so the block rides **5px** up as a RELATIVE offset —
   a margin is layout and would move the row. Re-measure if the label's size or
   line-height moves, or if the button stops being the thing beside it.
   **THE SELECTION BAR IS GONE** (Mark: "delete the selected amount and the box
   around them"). Its count and running total only restated the ticks; the one
   thing in it that did not is `batchError`, which moved up into the BAND SLOT
   beside the capped notice (Mark's placement) — same frame and fill, RED type,
   because a failed write is something WRONG where that one is merely worth
   your eye. Red on yellow-200 is 4.62:1, which passes AA.
   **THE TRIGGER STAYS LIVE WITH NOTHING TICKED and every row goes dead**
   (Mark asked whether an enabled menu over disabled options was alright — it
   is, and it is the better half). `NewTimesheet`'s rule says disable rather
   than hide, and its own escape clause is that a greyed control explains
   itself only on hover, which an iPad has none of. A dead TRIGGER has no words
   available; opened, the menu explains itself completely — **the counts ride
   in the labels** ("Sent (3)"), which is where the buttons carried them, so
   "Sent (0)" is the whole reason on the row it is about. `ActionMenuItem`
   takes no hint, so those buttons' `title` tooltips are gone and the count is
   the half worth keeping. The button greys only while a batch runs, reading
   Saving… / Receiving… / Closing… / Deleting… / Rendering… — one trigger, so
   one place left to say WHICH, and that is worth more than a generic
   "Working…" when a 200ms status write and a thirty-order PDF render answer
   "did my click land" differently.
   Verified live at 1440 and 820: all three tops at exactly 96, the label's ink
   at 95.9–96.3, the Actions button's right edge on the content margin, no page
   overflow at either, the Documents submenu correctly flipping LEFT at the
   right margin, every row dead with nothing ticked and live with two, Clear
   Selection emptying the ticks without the header changing shape — and
   `window.open` confirmed fired SYNCHRONOUSLY inside the click, which is the
   one thing the move could have broken (a popup opened after an await is
   silently blocked).
   **PO DETAIL'S COMMANDS ARE ONE ACTIONS MENU** (Mark, 2026-09-11) — level
   with the title at the top right, grouped add · send · receive: Add Item… ·
   Preview PDF · Download PDF · Email PO… / Open Vendor Site / Shopping List
   PDF (by order type) · Mark as Sent · Reconcile PO… · File as Bill · Close
   Order…. The Process box (`OrderBar`, and its "Process · online" line) is
   GONE. Below the title the body is TWO COLUMNS: the fields (Status first,
   then the dates, Sent via, Notes) and beside them the Paperwork card —
   moved out of the pinned `StickyFooter`, opening and closing ONLY from its
   toggle (`RevealPanel clickOnly` — no hover, no focus) and, since the same
   day, PUSHING what follows down rather than covering it (`push` — closed, the
   body is still out of flow and `invisible`, never unmounted, so its PDF
   plugins do not reload) — with six right-aligned figures ABOVE it in two rows
   of three, ordered over received, boxed in the card's own frame (they sat
   under it until later the same day):
   Products Ordered, Packages Ordered, Ordered Total, Products Received
   (lines with a received quantity above zero), Packages Received, Received
   Total. Stacked below `xl`. Ticking lines no longer raises a band with a
   Delete button: **Delete Selected…** joins the Actions menu, last and red,
   while at least one line is ticked.
   `ProcessPo` and `AddPoLines` keep their dialogs and hand their rows out
   through render props (`OrderCommandMenu`'s shape); `AddPoLines` still draws
   its own button when given none, which is how the receiving screen uses it.
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
   **DONE WARNS WHEN SOMETHING IS TYPED IN AND NOT ADDED** (Mark, 2026-09-08),
   which is the panel staying open coming back around: typing an amount and
   typing an amount THEN pressing Add to PO leave the screen looking almost the
   same, so Done on the first threw the quantity away in silence. `closePanel`
   is the ONE way out — Done, the ✕, Escape and the backdrop all go through it,
   so a draft is as safe from a stray Escape as from the button — and it carries
   a re-entrancy guard, because BOTH dialogs hear the same window keydown and
   Escape over the confirm would otherwise cancel it and immediately ask again.
   `unaddedWarning` NAMES what is loose rather than counting it, resolves the
   arithmetic those fields allow ("2 * 6" reads back as 12), and covers the
   one-off form, where a half-filled form is work with nothing else on screen to
   say so. Null when nothing is outstanding, so the ordinary Done is one tap.
   **THE FILL MOVES TO THE ROW BEING TYPED INTO** (Mark, same day) — the row's
   Add to PO goes `PRIMARY_BUTTON_CLASS` and Done gives the fill up, which is
   `ImportTimesheets`' rule and its reason: the panel-commit exception is about
   the ONE OUTCOME a panel is for, and here that outcome MOVES. Done is black
   when the panel opens and black again the moment an add succeeds, since that
   clears the draft.
   **IT FOLLOWS ANYTHING TYPED, NOT A VALID AMOUNT** (Mark's second pass, same
   day: "as soon as the user enters anything"). A narrower fill was built first
   — black only once the row would really add — on the reasoning that the fill
   promises the button will work. That is the wrong half to optimise: the fill
   and the confirm are two halves of ONE fact, that this panel is holding
   something, and splitting them puts the fill on Done while a row still holds
   typing. So a stray `0` blackens its row, and `isPendingAdd` is the one
   predicate both read. `addableQty` keeps the narrower question it was made
   for — the Add button's own refusal, and whether the confirm quotes the
   amount, so a `0` warns without being printed back as "0 × Flour".
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
   **THE CARD'S HEADER STATES A COUNT AND NOTHING WHEN THERE IS NONE** (Mark,
   2026-09-11: delete "Nothing attached — drop one here"). That empty state was
   the hint rule twice over — the card is visibly empty, and the Attach button
   beside it says what to do about that — so the span renders only where there
   are files ("2 files"). The read-only "Nothing attached" went with it, being
   the same claim to a reader who also has no button to press.
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
   are meant to read as one line across the screen. **SINCE 2026-09-10 A BAND
   HAS NO BORDER, IS YELLOW, AND EXISTS ONLY WHEN IT HOLDS SOMETHING** (Mark:
   "use a yellow fill instead, but only when there is a reminder or request to
   display", then "if there are no reminders or requests, you don't need to say
   it on screen"). That reverses the reminders-yellow / requests-plain split
   AND retires the two `showEmpty` flags described next: an empty list renders
   nothing, and with no reminder due the LEFT column holds just "Add reminder",
   top-left, beside the requests band (Mark, the same day, after trying it in
   the title row and then in a strip above it). **The whole row sits BELOW the
   title row**, above the vendor totals (Mark, the same day), where it had been
   above the shelf since 2026-08-22. Refresh is in the tablet bar next to Home,
   and on the desk a right-aligned link above the title. **REFRESH NOW DOES
   SOMETHING YOU CAN SEE** (Mark: "it feels like it does nothing"): it runs in a
   transition and reads "Refreshing", dimmed, until the fresh data renders; and
   fresh server data RE-SEEDS the guide's counts, which were seeded once and so
   ignored every refresh — a count entered on another device never appeared. A
   box being typed in keeps its own draft (`GuideLine`), and a vendor item with
   a write still in flight keeps its local value (`pendingWrites`). `BandEmpty` is gone. The muted greys
   inside the requests band are `text-ink/70`, since `text-muted` is ~4:1 on the
   yellow. The same day the vendor totals bar lost its rules above and below and
   its "Nothing ordered yet" sentence, WILL ORDER hides at $0 (unless a
   "blocked" under-minimum amount needs naming, so with nothing ordered the bar
   is absent), and the day picker moved to the title
   row's right edge, top-aligned, in the Mac look (`DateField variant="title"`).
   **The two `showEmpty` flags keep it a GRID**: with anything in either
   column, both render and the empty one says so, rather than leaving a hole
   where a column should be; with BOTH empty neither renders and the guide's
   first row is the guide, which is the rule `Reminders` already had.
   `items-start`, so a tall column does not stretch the short one into a box of
   white space. Each request row carries the same `RequestActions` menu the list
   row does — answering one WHILE WALKING is most of the point of it being here.
   **ITS ⋯ HOVERS BY WEIGHT, NOT BY A WASH** (Mark, 2026-09-11), `RowMenu`'s new
   `onFill`. The app's rule is that a control you press fills grey on hover, and
   that rule is written for a control standing on WHITE: over this band's
   `bg-mark-fill` a `neutral-100` wash paints a grey patch on yellow, which
   reads as a smudge rather than a highlight. So here the ⋯ thickens and
   darkens instead — the same "you can press this", said with the only property
   a coloured ground leaves free. The flag is passed by the GUIDE, not baked
   into `RequestActions`, because the same menu renders on `/purchase-requests`'
   white rows and keeps its wash there.
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
   **ATTACH IS A MENU: File… · Scan…** (Mark, 2026-09-18: "scan invoices
   directly into a purchase order or invoice record"). `purchasing/AttachMenu`
   replaced the twin Attach buttons on PO detail's Paperwork card and in
   `DocumentPane` (receiving, and the invoice record), and owns BOTH hidden
   inputs, because `input.click()` only works inside the click that chose the
   menu row. File… is the old button unchanged. **Scan… opens the rear camera
   at once** (`capture="environment"`, which File… deliberately still lacks so
   iOS offers its Library / Take Photo / Choose File sheet); the dialog appears
   once there is a page in it. On a Mac, with no camera, it is the ordinary
   picker and works as "bind these photos into one PDF".
   **A scan lands as ONE PDF** (`lib/scanPages`, pdf-lib imported inside
   `scanToPdf`): each read is an Opus call, so three photos of a three-page
   invoice were three reads and none of them saw the total. Pages are
   downscaled to 2,000px on the kept part's long edge, JPEG 0.82, on Letter
   sheets — four full 12 MP photos would pass `extract-invoice`'s 8 MB ceiling.
   It then goes through the caller's ordinary `upload`, so it is read like any
   invoice. Measured in Chromium: two pages 274 KB, one straightened page 118 KB
   built in ~0.1 s.
   **`ScanDialog` adjusts as well as collects**, the same day, in three rounds:
   per-page **rotate** (↺ ↻); a **tone** for the whole scan — Color · Greyscale
   · Black & White, Brightness (labelled Threshold in B&W, where it is where the
   cut falls) and Contrast, −100…100 — ONE setting because the pages of an
   invoice are shot in one light; **the tone is remembered** (`rf.scan.tone`,
   localStorage via `useSyncExternalStore`, saved on every change including
   Reset — per device, so the iPad and the Mac each keep their own);
   **Preview**, one page as large as the window with the tone controls still
   pinned above it, so that is where you dial the tone in (in preview ✕ /
   Escape / a tap outside go back to the grid rather than discarding the pages);
   and **Crop**, which is FOUR FREE CORNERS plus four edge handles — put one on
   each corner of the paper and the page comes out square (perspective
   correction, Heckbert's square-to-quad map, bilinear resample); corners in
   line take a plain `drawImage` crop instead. The crop is stored as fractions
   of the TURNED page and is renamed and turned with it on rotate.
   **THE PREVIEW IS DRAWN BY THE PDF'S OWN `renderPage`**, never a CSS filter —
   CSS has no threshold, so B&W could only be imitated and the page attached
   would not be the page approved. The shaped (turned + cropped/straightened)
   canvas is cached per photo in a `WeakMap`, so a slider redoes only the tone.
   Not built: automatic edge detection, a loupe under the finger on a corner.
   Verified in the pane on a throwaway `/guides` page (the pane was on the PIN
   screen): corner drags, rotate-keeps-crop, the stored tone surviving a
   reload. **A hidden pane never settles `img.decode()` or `toBlob`** — front
   the tab before testing this. Not yet tried on a real camera or in Safari.
   **MARK PO ▸ ON PO DETAIL'S ACTIONS MENU** (Mark, 2026-09-18) — Draft · Sent
   · Received · Closed… · Void…, the current status greyed. The Status field
   already set the column and still does; these are the verbs. **Received
   fills only uncounted lines** through `lib/poStatus.markPurchaseOrdersReceived`,
   lifted out of the list's batch so the list's Mark ▸ Received and this one
   cannot drift. Closed… IS Close Order… (`closeReadiness` confirm); Void…
   confirms.
   **PAPERWORK MARKS THE ORDER RECEIVED** (Mark, 2026-09-18). Attaching an
   invoice or packing slip to an order (`useAttachmentActions.upload`) runs
   `update status='received' where id = … and status in ('draft','sent')` — the
   guard is IN the statement, so received/closed/void orders are untouched and
   a phone order that never went through Sent still counts. It is written
   before the 30s read starts. **STATUS ONLY, NO QUANTITIES**, unlike Mark ▸
   Received: an invoice says the delivery came, not what was in it, so the
   Received figures stay short until the order is reconciled against the
   reading — the true state. Attaching and writing a PO are both purchaser+
   (018's storage policy, the PO policies), so the update cannot silently hit
   zero rows for someone who could attach. A failed status write is reported
   after the upload loop, because `read` clears the error line when it starts.
   **THE SCANNER FINDS THE PAGE ITSELF, AND STARTS IN GREYSCALE** (Mark,
   2026-09-18). `detectPage` runs on every photo as it arrives and sets its
   crop to the paper's four corners, so a page lands already straightened;
   **Auto** in the crop editor runs it again (after Whole Page, say), and says
   "No page edges found" when it can't. Plain arithmetic on a ~400px copy, no
   library — OpenCV.js would be sturdier and is ~8 MB of WebAssembly on the
   iPad taking the photo: luma → two box blurs (takes the print off the sheet)
   → Otsu threshold → an opening (erode ×2, dilate ×2, cuts thin bright bridges
   to glints) → largest 4-connected region → its outermost point along each
   diagonal is the corner. **REFUSED AS NOT-A-PAGE** — and the photo left whole
   — under 15% of the frame, over 97% (page already fills it, or the background
   is as bright as the paper), or not a convex quad. The known blind spot is a
   white page on a white counter: no bright region to find, so it is refused
   rather than guessed. Measured on synthetic true-perspective scenes at
   1200×1600 in the pane: ~25–30 ms each; a keystoned page on a dark counter,
   one rotated 15° with perspective and noise, and one on wood grain with
   uneven light all found, worst corner 8–10px out (~0.6%, inside the paper —
   the blur rounds the corners); white-on-white and a frame-filling page both
   correctly null. A page turned more than ~40° in the frame would confuse the
   diagonal corners; nobody photographs an invoice that way.
   **GREYSCALE IS THE DEFAULT** (`DEFAULT_TONE`), separate from
   `NEUTRAL_TONE`, which still means "untouched" and is what `applyTone` skips.
   It is what a scan starts at with nothing stored and what Reset returns to;
   a tone somebody has already dialled in is still theirs.
