<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4q. ✅ **THE DESK START PAGE (2026-09-17, no migration).** Mark: "Let's make
   one for the desktop too, and navigate to it when logging in instead of the
   locations page", then: whole org, sales across the top with a chart of this
   year against last, "needs attention" cards beneath, starting with six, and a
   Home glyph in the masthead's row 1 — FIRST, left of the org settings icon
   (it shipped last, after the location picker, and moved within the hour).
   **The title reads "Welcome to <org name>!"**, over the shop code and the
   day; the route, the menu and the tablet page are still Start.
   **ONE ROUTE, TWO SHELLS.** `/start` renders `components/start/DeskStart`
   under the desk shell and the tablet's action tiles under the tablet shell;
   `/` redirects there for both, and its all-R Page Permissions row means no
   role lands on a refusal.
   **SCOPED TO THE WORKING SHOP** (Mark, the same day — it shipped whole-org for
   an hour, which made a card count records the list it links to does not show,
   because the PO, invoice and shift report lists follow the working shop).
   Sales, invoices, POs and shift reports filter on `location_id`; special
   orders count the shop as EITHER the pickup shop or the kitchen (sold here or
   made here); paperwork counts staff whose `main_location_id` it is, so the
   one current employee with no main shop is on neither card. With no working
   shop the page says so under the title. Because it is scoped, it is NOT exempt
   from `InactiveLocationGate`.
   **EVERY RULE IS BORROWED** (`lib/startPage`, fixture-tested): invoices read
   `billStage`/`agingBucket`/`balanceOwed`, special orders `needsAttention`,
   shift reports `missingNights` (closing only, 7 days ending yesterday, the
   list's own rule), paperwork `soonestExpiry` over non-inactive staff. A card
   a role may not open is not fetched (`canReachPage`; paperwork also needs
   `canReadHr`), and a failed probe costs its card a sentence, not the page.
   **THE SALES BAND** is `SalesSummary` over the last 30 days (both
   comparisons, the gap and part-day notes) plus `components/start/SalesTrend`:
   every shop folded into one line per day against the same WEEKDAYS 364 days
   back, never the calendar date. **No hue** — ink against a grey DASHED line,
   the dash being the second encoding; the dataviz validator passes the pair on
   separation and contrast and flags it only for being grey, which is the
   design system's rule. A day nobody pulled is a gap in its line, never zero.
   Drawn at its MEASURED width (a scaled viewBox made the 12px labels 17px at
   1440). Hover or arrow keys give a crosshair and both values.
   **THE ORDER GUIDE'S TWO BANDS SIT UNDER THE TITLE** (Mark, the same day:
   "add the order guide's reminders and purchase requests to it") — the guide's
   own `Reminders` and `GuideRequests`, due reminders on the left and open
   requests on the right, so dismissing, "Add reminder" and the request ⋯ menu
   behave exactly as on the guide. Reminders are "due" against TODAY (the guide
   uses the walked date); a request's item links to the item record, there
   being no walk to jump down. Gated by the `/order-guide` and
   `/purchase-requests` cells. **The queries live once, in `lib/guideBands`**
   (`fetchDueReminders`, `fetchOpenRequests`), and the guide page calls them
   too — they were inline there before.
   **A card names each record over its detail, never beside it** — at three
   cards a row, "Event has passed — send the receipt" was being cut off.
   **What the live data said on the first (whole-org) probe (2026-09-17)**,
   which is the page doing its job rather than a bug: 21 sent POs past their
   delivery day, 40 special orders needing attention (most "Event has passed —
   send the receipt"), 14 closing nights with no shift report across DF01/DF02
   in a week, 16 current staff with a lapsed document, 0 invoice problems.
   **Verified** by running every query read-only against the hosted DB and by
   rendering the real `StartCard`/`SalesTrend`/`SalesSummary` in a standalone
   page with the dev stylesheet at 1440 — the pane is behind the shared-device
   PIN lock, so the signed-in page itself has NOT been seen yet.

