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


**CUSTOMIZABLE WIDGETS (2026-10-17 → 20, migration 207).** Mark: "It would be
even cooler if [we could] choose which modules to display and where to display
them … A page edit mode could allow the user to drag/move the widgets around,
add, remove them … 1 column, 2 columns, or 3 columns wide, and the widget could
display more info the bigger it got … a background color … a small button in
the upper right hand corner of each one." Scoped first; his answers:
- **Per person, in the database** (`org_members.start_layout`, written only by
  `set_my_start_layout`), one built-in default, NO per-role defaults. NULL =
  default, and saving the default writes NULL. See conventions, "THE START PAGE
  LAYOUT IS SAVED PER PERSON".
- **Tint from a small palette of pale neutrals** (`START_TINTS`: grey, stone,
  slate, sky, lilac) — never a state color.
- **The corner ⋯ only in edit mode**; the resting page looks as it did.
- **Desk shell only**; the tablet keeps its tiles. Wall-screen mode dropped.
- **Ten widgets.** The six cards and Sales, made width-aware; **Reminders**
  folds in the open purchase requests ("purchase requests can be folded into the
  reminders widget"); **Calendar** is an upcoming list of the calendar's OWN
  entries and subscribed feeds — no orders or deliveries, so nothing is said
  twice; **Today** is the day's deliveries, special-order pickups and
  deliveries, standing-order days, tasks, entries, feeds and production.
- Not in v1, offered and declined: per-widget shop, collapse-when-clear, acting
  inside widgets, number tiles, multiple pages, a pinned note, more modules.

**HOW IT IS BUILT.**
- `lib/startLayout` (pure, fixture-tested): the kinds, `DEFAULT_LAYOUT` (the
  page as it was: Reminders 3, Sales 3, six cards at 1; Today and Calendar
  start in the Add list), a tolerant `readStartLayout` (unknown kinds and
  duplicates dropped, spans clamped, unknown tints forgotten — the column
  outlives the code), the edits, and `tileDropTarget`, the 2-D hit test.
- `DeskStart` is the server half: it reads the layout and fetches ONLY the
  widgets placed and permitted (`widgets/index.ts`, `widgetAccess` from
  `lib/pageAccess`), one server file per widget under `components/start/widgets/`
  (loaders moved verbatim from the 909-line `DeskStart`). A widget a role can no
  longer open is hidden, not deleted, so it comes back with the role.
- `StartGrid` (client) places the bodies; Edit layout is a `ui/Switch` kept as
  `?edit=1`. Every change goes through `useLatestWrite` to the RPC and shows at
  once; only ADDING a widget whose body was never fetched refreshes.
- `useTileDrag` (`lib/tileDrag`) is the drag family's fourth member: pointer
  events, geometry measured once, a vertical drop line. `movedColumnOrder` moved
  to `lib/moveInOrder` as `rowDrag`'s note asked "the day a third caller
  appears"; `columnOrder` keeps the old names as aliases. The corner menu also
  offers Move earlier / Move later.
- **Width is CSS container queries**, not a prop: the frame is `@container` and
  bodies show more at `@xl` (≈ 2 columns) and `@4xl` (≈ 3), so a width change
  needs no server trip and a 3-wide widget on a two-column screen reads its real
  width. Cards: 3 records at 1 column, counts beside 6 at 2, 10 in two columns
  at 3. Sales: Net sales alone at 1 (no chart), Tips and the chart at 2, the
  share at 3 (`SalesSummary fit="container"`; `/sales` unchanged).
- The Calendar's day count (7/14/30) reaches its client list through
  `widgetSettings` context; the server always fetches 30 days.
- Today reuses `/calendar`'s own queries (`fetchLayerItems`, now gated by the
  shared `calendarLayersFor`) and `todayTimeline` (`lib/startPage`): a
  special-order production schedule IS an order already listed, so it is
  dropped; a committed schedule replaces the menu plan's banner. `fetchFeeds`
  was lifted out of the calendar page so both read subscribed calendars one way.
- Calendar chips on a widget wear `WIDGET_CHIP_EDGE`: a Sky Deliveries chip
  vanished on a Sky widget.
- Fixed in passing: `/start`'s loading line read "Loading Loading……".
- **Not as planned:** the plan gave Reminders/GuideRequests a borderless "bare"
  variant; they kept their yellow bands inside the widget instead, which is the
  guide's own look and needed no change to either component.

**VERIFIED (2026-10-20).** 207 dry-run on the hosted DB by raised exception
(own row written; staff cannot update any `org_members` row directly; array and
> 8 KB refused; `anon` cannot execute; NULL resets), then APPLIED by Claude at
Mark's request, and the column, grants and anon refusal re-probed. Fixtures:
`startLayout.fixtures.ts` plus two `todayTimeline` cases (2,413 pass; the
duplicate guard and the hit test's tie-break each broken once to see a case go
red). `/start` and `/start?edit=1` rendered from the running dev server with a
one-off owner session (signed out after): the default layout reproduces the old
page with live data, edit mode draws grips, ⋯, Add widget and Reset, and a
saved layout of Today/Calendar/tints/widths rendered — the owner's own
`start_layout` was set for that and put back to NULL. Static snapshots with the
dev stylesheet were looked at in the pane at 1440 and 1024.
**NOT VERIFIED:** the INTERACTIVE half — drag, the corner menu, the color
panel, Add, Reset and the save queue in a live, hydrated page. The pane is
behind the shared-device PIN lock. Check them in Safari, where Mark reads the
app, including drag on an iPad.
