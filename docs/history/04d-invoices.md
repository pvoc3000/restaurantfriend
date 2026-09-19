<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

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
   **THE HEAD IS NOW FOUR BOXES IN TWO NESTED GRIDS, not one row** (Mark,
   2026-09-03, correcting a four-box row that spanned the page on its own
   terms: "I overlooked how the elements would align vertically"). It reuses
   the CONTENT row's own `xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]` template
   rather than a copy of the numbers, which is what makes "the total's right
   edge is the document pane's right edge" true without either grid knowing the
   other's width; each half then splits again — identity | total on the left,
   and on the right **actions | QuickBooks, in that order since 2026-09-08**
   (Mark, asking for the two to be swapped). `items-start` at both levels.
   That order also retired a placement trap worth knowing if they are ever
   swapped back: a `grid-cols-2` whose FIRST child renders NO DOM NODE does not
   leave an empty slot — auto-placement drops the survivor into track 1 — and
   `PushToQuickBooks` returns null outright where the org has no QuickBooks
   connection, so leading with it needed a wrapper `div` to hold the track
   open. `InvoiceFooter` always renders a node, so first is the safe end.
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
   **AND SO ARE THE INVOICE RECORD'S (Mark, 2026-09-12)** —
   `InvoiceCommandMenu`, the fourth surface to take this shape, replacing two
   boxes of buttons side by side: Void · Delete · Approve for payment, and
   Send/Update/Link · Check QuickBooks · Forget the link. Up to six commands in
   three colours across two rows become one trigger.
   **THREE GROUPS, decide · send · destroy**: Approve for Payment / Withdraw
   Approval / Reopen Invoice · **Send to QuickBooks** (or Update, or Link) ·
   Check QuickBooks · Forget the Link · then a rule, then **Void Invoice** and
   **Delete Invoice…**, both red.
   **WHICH IS WHY `InvoiceActions` HANDS BACK TWO NAMED GROUPS** rather than
   one array — QuickBooks sits BETWEEN its halves and the app's rule is that
   the destructive rows come last (`OrderActions`' own `{ edit, destructive }`
   shape). **FLAT, NOT A "QuickBooks ▸" SUBMENU**: at most three of its rows
   are live at once, which is this file's own "two variants do not earn a
   submenu" boundary, and a submenu would cost the ordinary case — one Send —
   a second gesture.
   **`InvoiceFooter` IS NOW `InvoiceActions`**, a name that had been wrong
   since 2026-09-02 when these commands left the foot of the page for the title
   row (015's "Receiving" relabel; 059's `resolution_note`).
   **THE REFUSAL BECAME A DIALOG AND THE ROW STAYS ENABLED** —
   `PushOrderToQuickBooks`' rule, and its reason bites harder here: the refusal
   stood as PERMANENT PROSE under the button, which beneath a single Actions
   trigger is a line on every bill not yet ready to go. It quotes
   `shownRefusal` first, the list with "approve it first" filtered out, since
   in a menu the Approve row is directly above the one you just pressed.
   **PLACED IN THE 3fr CELL, right-aligned and `items-start`** (Mark: "under
   the record nav buttons in the page title row, top aligned. The warning/hint
   texts can appear below it"). Under the record nav comes free from the grid
   rather than from a measurement — that cell ends on the content margin and
   `RecordNav` rides at the right end of the breadcrumb row above. Measured at
   1440 and 1280: the trigger's right edge and the record nav's are the same
   pixel (1377, 1217), its top is the h1's box top (88, with the h1's ink at
   89), and **Total's right edge is still the document pane's** (573.2, 509.2),
   which is the alignment this header was rebuilt around on 2026-09-03.
   **THE PROSE IS CAPPED AT `max-w-sm`.** Left full-width it spans the whole
   3fr column — 788px at 1440 — and a yellow note that wide reads as a banner
   across the header rather than as a line under the command it is about. 384px
   is `PushOrderToQuickBooks`' own cap and is within ten pixels of the width
   this block had as half of a two-box row.
   **NOTHING RENDERS WHERE THERE IS NOTHING TO OFFER**, which here is a real
   state and not a defensive one: the Page Permissions sheet has a purchaser at
   Read Only on Invoices, so they get no approve, no void, no delete and no
   push — and an empty menu is worse than none. The prose still renders, which
   is what a reader came for.
   Retired with the two boxes: the `grid-cols-2` that placed them, and the
   placement hazard its comment recorded (a `grid-cols-2` whose first child
   renders NO DOM NODE drops the survivor into track 1, which is why the
   QuickBooks slot once needed a wrapper).
   **THE INVOICE LIST'S COMMANDS ARE ONE ACTIONS MENU TOO** (Mark, 2026-09-11,
   an hour after the PO list's and to the same shape): **New Invoice** ·
   **Documents** ▸ Preview Invoices · Download Invoices · **Check QuickBooks** ·
   **Approve (n)**, then a rule, then **Delete Selected…** (red) and **Clear
   Selection**. It replaces a Check QuickBooks button, a New invoice button and
   a selection bar carrying two more — and the bar is GONE, its count and total
   having only restated the ticks.
   **`NewInvoice` AND `InvoiceBatchActions` KEEP OWNING THEIR COMMANDS** and
   hand their rows out through a render prop — `OrderCommandMenu`'s arrangement
   and its reason: the duplicate warning, the confirms that name what will be
   skipped, the approval RPC's row count and the document order on the delete
   are each a lesson paid for once and not worth a second copy.
   **PUSH TO QUICKBOOKS (n) JOINED IT 2026-09-16** (Mark) — the ticked
   APPROVED bills, sent one after another through `components/purchasing/
   qboBillPush`, which the record's `PushToQuickBooks` now uses too (one send,
   two doors). Every per-bill guard is a NAMED skip in the report: a linked bill
   not edited since it was sent is left alone; an unlinked bill QuickBooks
   already has under its number is NEVER sent (link it on the record — the
   record's "found means stop"); `billPushRefusals` refusals are listed. ONE
   `find_bills` covers the selection, and unlike the record a FAILED lookup
   sends nothing, or a bad connection would double every Bill.com-synced bill.
   Gated like the record (the Invoices edit cell) and absent until
   `accounting_connection_status` says connected.
   **DOCUMENTS MEANS THE SCANS, and it cannot mean anything else** (Mark chose
   it from three readings). A vendor invoice is a document we RECEIVE, so there
   is no invoice PDF in this app and there must not be one: the real document is
   what the vendor sent, and a generated sheet beside it would be a second
   answer to "what were we billed" with no original behind it. So it is
   `DocumentsList`'s own `mergeToSinglePdf` over the attachments this module
   already files — `mergedFileName` gained an optional prefix so the file lands
   as `invoices-…` rather than `documents-…`. An invoice with nothing filed is
   SKIPPED AND COUNTED ("3 of the 5 had nothing filed"), never silently absent.
   **THE SELECTION COLUMN IS NOW EVERY ROLE'S**, where it needed approve or
   delete before — precisely so a Read Only purchaser was not given boxes with
   nothing to press. Documents is what changed that: opening the selection's
   scans is a READ, the screen is already role-gated, and a reader who may open
   each invoice's paperwork one at a time on its record may certainly open
   several at once.
   **APPROVE IS RENDERED WHENEVER THE ROLE HAS IT AND GREYED AT ZERO**, where
   the button used to vanish — "Approve (0)" says the selection is already
   approved or voided, which is the reason on the row it is about, and a
   vanished control cannot say it.
   **BOTH REPORTS MOVED TO THE BAND SLOT** beside the capped notice, the PO
   list's placement: same frame and fill, red where something went wrong.
   And **the report is now cleared BY TOUCHING THE SELECTION** rather than by a
   render guard that showed it only while nothing was ticked. That guard worked
   while every command cleared the selection on its way out and broke the moment
   Documents reported without clearing — its message could never have appeared.
   Clearing at the source is what that note always asked for in words.
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
   **The invoice record's document pane has File… · Scan… too** (2026-09-18)
   — `DocumentPane` wears `purchasing/AttachMenu`, so a paper bill can be
   photographed straight onto its record as one PDF and read. Full notes, and
   the scan dialog's rotate / tone / preview / four-corner crop, are in
   `04-order-guide-and-pos.md`. An invoice-owned upload has no `po_id`, so it
   never moves an order's status.
   **CREDIT MEMOS CAN BE FILED AND CORRECTED BY HAND** (2026-09-19, Mark:
   "what would we need to do in order to add credit memos to our invoices
   page that we can push to QBO?"). The answer was: almost nothing, because
   the plumbing had been there since 025 and 4l — `is_credit` on the row,
   the reader setting it, `billEntity` posting a credit as a **VendorCredit**
   with positive amounts and no DueDate, `qbo-sync` refusing an entity that
   disagrees with the flag, find/link/balance all VendorCredit-aware. What
   was missing was any way to SET the flag except the reader: `NewInvoice`
   never wrote it, so a hand-typed credit posted as a Bill, and the detail
   screen had no field for it, so a misread one was stuck. Two additions:
   a **Kind** TabPicker (Bill / Credit memo) in the New invoice dialog, whose
   commit reads "File credit memo" and whose total is stored `Math.abs`'d
   either way (025: magnitudes positive, the flag carries the sign); and a
   **Kind** pick in the record's Bill block, a `kind="pick"` InlineValue over
   a boolean column via `onWrite`, gated on `canEditFinancials`.
   **Migration 109 adds `is_credit` to the financials lock** — the same
   one-clause widening as 090 — because the flag decides the QuickBooks
   ENTITY, and a Bill there cannot become a VendorCredit; flipping it after
   the push would need a delete-and-resend that nothing automates. Once the
   field could change, it had to lock with the money it signs. **Credits stay
   UNLINKED to the bill they credit** (Mark: "leave credits unlinked") — the
   application happens in QuickBooks at payment time, which this module
   deliberately does not model.
