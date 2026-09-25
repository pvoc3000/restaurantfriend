<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4p. ✅ **THE TABLET SHELL — one bar and a landing page of actions over the same
   routes (2026-09-09).** Mark: "The interface we've designed so far is great on
   the desktop. Next, I want to design a simple, touch focused interface for
   tablet use … Instead of menus, maybe there are buttons that say 'Start a
   Shift Report' or 'Print Tags' … The menu system we developed would be gone …
   We would just need a back button … a home button … If we're in a detail view
   the nav buttons to go to next/last would be helpful."
   **ONE ROUTE TREE, TWO SHELLS.** `lib/shell.ts`: the `rf.shell` cookie
   (`desk` | `tablet`) decides which chrome the `(app)` layout mounts —
   `AppHeader` or `components/tablet/TabletBar` — and every page underneath is
   the same page. Absent, a REGISTERED SHARED DEVICE (097's `rf.device`) is a
   tablet and anything else a desk, so the iPad was right the day it was
   registered; the explicit cookie is the switch on /account ("Tablet layout",
   ungated by `pinSession` — not a credential) and is set server-side for a
   year. **It is NOT in `clearSessionCookies`**: a device property, like
   `rf.device`, and a lock or sign-out must leave the iPad a tablet. `/` lands
   on **`/start`** under the tablet shell and on `homeHref` under the desk.
   A second route tree was refused: forty thin re-exports, and a deep link
   from an email would land in the desk shell on the iPad.
   **THE BAR PUBLISHES `--rf-header-h`, NOT `--rf-runner-h`.** Every list's
   sticky column labels offset against the masthead's variable, so a bar that
   stands where the masthead stood and publishes the same name makes every
   existing table stick correctly with no per-screen change — measured, labels
   at exactly 64px under a 600px scroll on /vendors. 64px tall, which is also
   the variable's seed, so the first paint is already right.
   Back · Home · [record book] · title · shop · Switch user, every cell a 64px
   box with a Material Symbols wght-700 icon over its word (`tablet/BarLabel`,
   the shift report footer's idiom lifted out; `barCell.ts` states LAYOUT ONLY
   and each caller its colour, that footer's own lesson).
   **BACK IS DETERMINISTIC, NEVER `history.back()`** — a shared iPad's history
   is whatever the last person left. `tabletBackHref` (`lib/tablet/landing`):
   the breadcrumb trail's last crumb when `?from=` is present, else a detail
   route's own list via `resolveRoute`, else home; dead in place on `/start`
   rather than absent, so the cells never move. The title is the menu's own
   sub-section label, which is a record's list name too.
   **THE RECORD BOOK MOVES INTO THE BAR.** `ui/RecordNav` reads
   `useShell()` (`components/ShellProvider`, provided by the layout): under the
   tablet shell it PUBLISHES its props to `lib/recordNavSlot` in an effect and
   renders nothing, and `tablet/BarRecordNav` walks the same set through the
   same `useRecordPosition` and `carryQuery` at 64px. Under the desk shell
   nothing changed. Verified: "1 of 30" → Next → "2 of 30", ends dead in place.
   **A SCREEN CAN SEAT ITS OWN COMMANDS IN THE BAR TOO** (`lib/tabletBarActions`
   + `tablet/BarActions`, 2026-09-10) — the same slot shape. A command's `side`
   seats it right after Home (`leading`) or at the right end (`trailing`, the
   default); the guide's Refresh is leading, under Material Symbols `refresh`
   (Mark, the same day), and on the desk stays a link above the title. First
   caller: the
   order guide's Next favorite and Next section, which on a tablet leave the
   bottom ActionBar for the top bar's right end as **Favorite** and **Section**
   under a ">>" (`ICON_DOUBLE_CHEVRON_RIGHT`, two copies of the bar's own
   chevron path, not a typed character). Mark: "should move to the upper nav bar
   on tablets" — they are pressed mid-walk, and the top bar is always on screen.
   The page publishes on EVERY render (its handlers are fresh closures); the slot
   re-renders the bar only when a word, a disabled state or a tooltip changes,
   and refreshes the handlers in place otherwise. A second effect gives the seat
   back on unmount, or leaving the guide would leave its buttons in the bar —
   verified by opening Inventory after the guide. A disabled command dims in
   place rather than vanishing, so the bar never changes width.
   **THE LANDING PAGE (`/start`, `components/tablet/Landing`) IS MARK'S LIST IN
   HIS GROUPS AND HIS WORDS**, thirteen tiles over five groups
   (`LANDING_GROUPS`), each ≥96px, filtered by `canReachPage` on its href
   (`tilesForRole`) so it is the Page Permissions sheet applied to doors — and
   `/start` itself has an all-R row. "Generate Batch Logs" STAYS (Mark: "a must
   have for tablets" — what was retired on 2026-09-09 was the shift report's
   batch PAGE, not batch logs).
   **EVERY TILE SAYS WHAT IS OUTSTANDING** (`lib/tablet/landingState`, pure and
   fixture-tested; the queries are in the page). Nine probes in one wave, each
   through the helper its own screen reads so tile and screen cannot disagree:
   `templatesForShift`, `openTasksForRun` with the session user as viewer,
   `isCurrentPlan`, `onPlanItemIds`, `ordersForKitchen`, `isBatchOutstanding`.
   **ONE draft shift report or ONE open checklist run makes the tile a door
   straight into its runner** ("Resume today's closing report"); none or
   several go to the list. A failed probe drops its LINE, never the page.
   **The PO probe is `status in (draft, sent)` — still to ARRIVE — not
   `isPoOpen`'s "not closed"**: the first cut said "5751 open", which is the
   FileMaker history of received-and-never-closed orders, where "21 awaiting
   delivery" is the answer a supervisor at the door wants.
   **A TILE CAN BE A COMMAND, NOT A DOOR** (Mark, 2026-09-24: "a button on
   the tablet homescreen, under purchasing, that enables the supervisors to
   create/submit a purchase request"). **Submit a Purchase Request** opens the
   queue's own `NewPurchaseRequest` dialog ON the landing page
   (`tablet/RequestTile`, via a new `trigger` render prop), so filing is one tap
   and a sentence; the panel closes, the page refreshes, and the tile's line
   ("2 open requests", nothing at zero — `purchaseRequestState`) is the
   confirmation. **Its gate is WRITE, not reach** (`Tile.needs: "write"`, read
   by `tilesForRole`): `/purchase-requests` is `R` for staff, who read the
   queue and are not offered New request on it, so the tile follows the
   command. Supervisor+ see it. With no working shop it falls back to a link to
   the queue. `TILE_CLASS` moved to `tablet/tileClass.ts` so the server
   `Landing` and the client tile share one box without an import cycle.
   **AN UNREGISTERED TABLET HAS SIGN OUT IN ITS BAR** (Mark, 2026-09-24).
   He opened a shared tablet signed in as a supervisor and could only get out
   through Account ▸ Sign out; the PIN picker had never appeared. Not Safari:
   `registered_devices` held ONE row, "Claude test pane" — neither real tablet
   had been registered, so no device cookie, no idle lock, no picker and no
   Switch user. The fix for that is registering each tablet (`/settings ›
   Shared devices`, owner/manager, on a PASSWORD session, on the tablet). The
   code change is the fallback: beside Account on the home screen, an
   unregistered tablet now gets **Sign out** (`signOut`, a full sign-out to
   /login, `ICON_LOGOUT`); a registered one keeps Switch user alone.
   **THE LOOKUP TILES REUSE THE DESK LISTS AS THEY ARE** (Mark's choice). What
   a role may edit is already the sheet's cell; `compactBelow` (1280) already
   fires at iPad widths. Touch-shaped lists come later where these prove
   awkward.
   **PRINTING NEEDED NOTHING**: every react-pdf document already goes
   `openWindowNow()` → `showBlob()`, which on iPad is a new Safari tab whose
   share sheet → Print is AirPrint (Mark's chosen route). Filed documents'
   Open is the same route; their in-page Print (hidden iframe) prints page 1
   only on iOS and is left as is.
   **`PickList variant="masthead"` gained `size="lg"`** (64px, 16px) and
   `WorkingLocation`/`SwitchUser` take `size` — stated in the component, not
   overridden from a caller, for the reason `field` states its own.
   Verified live in the pane (a registered device, so it took the tablet shell
   with no cookie set) at 1024×768 and 820×1180: bar and every cell 64px, no
   horizontal overflow, tiles three-up and two-up, the toggle on /account
   round-tripping to the masthead and back. **1786 fixtures pass**, 23 new.
   **ON THE DESK, THE BATCH LOG'S COMMANDS ARE ONE ACTIONS MENU IN THE TITLE
   ROW** (Mark, 2026-09-12): Add Batch… · Mark Complete (or Reopen Log) ·
   Delete Log… (red), `components/production/BatchLogCommandMenu`, with
   `NewBatch` and `BatchLogActions` handing out rows through a `children`
   render prop. Delete batch stays in the pane (it acts on the SELECTED
   batch). The same day the log's **Note moved into the table's filter row
   after Group by** (`BatchItemsTable`'s `filterExtra`, desk only) and the
   strip under the title **lost its two rules**. The tablet's black footer is
   unchanged.
   **THE TABLET'S BLACK FOOTER IS GONE TOO** (Mark, 2026-09-12): Add Batch… and
   Delete Batch… are an Actions menu in the crumb row (the tablet has no title
   row). Delete Batch acts on the batch the pane shows, which `BatchLogItems`
   publishes through `lib/selectedBatch` (the `lib/shiftFocus` shape);
   `BatchActions` gained a `children` render prop. **And the same day the two
   shells got ONE menu** (Mark: "make them match, one menu on both"): Add
   Batch… · Delete Batch… · Mark Complete (or Reopen Log) · Delete Log…, in the
   title row on the desk and the crumb row on the tablet. **Duplicate Batch**
   joined it the same day (`BatchActions`): same element, label, recipe
   version, scale and planned amounts, a new number from `next_batch_number`,
   status To Do and `is_generated` false (045 allows one generated batch per
   element per log), with no operator, on-hand, yield, photo, notes or cost
   copied. The desk pane's
   Delete batch button and the 2026-09-09 desk-only rule for the log commands
   are gone. What follows about the footer is history.
   **THE BATCH LOG RECORD WAS THE FIRST SCREEN REWORKED FOR IT** (Mark,
   2026-09-09, with FileMaker's own tablet layout as the reference: "a total
   mess on a tablet"). Measured at 1024×768 before: the pinned frame had ~500px,
   the fields column scrolled inside a 74px box and the history showed one row.
   **SHELL DECIDES POSTURE, VIEWPORT DECIDES DENSITY** is the rule it settled.
   Under the tablet shell (`session.shell`, read by the server component) the
   record loses its heading, its "0 of 2 done" and its status/generated-by/
   not-printed strip, and its commands go to a `ui/StickyFooter` dressed as the
   shift report's black bar (`variant="bar"` on `NewBatch`, `BatchActions` and
   `BatchLogActions`); `BatchItemsTable`'s
   `touch` drops the Group-by picker and the columns eye and forces the compact
   set (Element · Par · On hand · Made · Status), which is also the set a narrow
   desk window gets. Nothing about the desk changed but the tabs.
   **THE SPLIT IS ALWAYS ON, AND THE PANE IS FOUR TABS.** It stacked below
   1024 because the three-column detail (fields · photo+notes · history) plus
   the two-column recipe could not fit a portrait iPad; Mark: "The sliding
   content view is mandatory". So `BatchLogItems` is Info · Ingredients ·
   Instructions · History — "Previously made" left `BatchFields`' third column
   for a tab (the grid is two tracks when `history` is absent), and
   `BatchRecipe` takes `show` to render either half alone — and the `wide`
   gate is a constant. Verified at 1024×768 and 820×1180: split and grip live in
   both, five columns, no sideways overflow, page exactly one viewport.
   **`StickyFooter` INSIDE A `space-y-*` COLUMN NEEDS A WRAPPER DIV.** It
   renders two siblings, the spacer and the FIXED bar; with the bar as last
   child the spacer inherits the column's bottom margin, which
   `useExactViewportHeight` (measuring to the spacer's EDGE) never counts —
   exactly 16px of page scroll in both orientations. The paperwork screens
   dodge it with a negative margin on the spacer; a wrapper is the general cure.
   **SIX MORE FROM MARK'S FIRST LOOK, the same evening.** Bar cells are a
   FIXED `w-28` (112px; 128 wrapped "Mark complete", 144 read as too wide, and
   the word is now just **Complete**); Back and Home sit LEFT and the record
   book RIGHT, with the landing page's shop picker and Switch user taking the
   right end there; Order is back in
   the tablet's column set; **sorting by Status bands by status**
   (`effective` grouping in `BatchItemsTable`, used by the comparator AND the
   bands, or the bands would not match the order they band); the search box
   shared the breadcrumb row until **2026-09-10, when it went back to the
   table's own filter row on both shells** (Mark) — search · **Status** (a
   captioned `PickList` of all five statuses plus "All statuses", counts
   conditioned on the search, remembered as `batch-items.status`) · Group by
   (a `PickList` too, on the tablet as well as the desk, offering **Type · Status
   · Prepared by · None** — Mark's list, the same day, None going for one
   commit and coming back, and "Element type" shortened to "Type";
   a sort by the grouped column now turns its bands over), with the crumbs
   standing alone again; the pane's tabs are `SectionNav size="lg"` in a
   scrolling column, and the tablet's default split is half; and
   **`DataTable resetFooter={false}`** hides the reset-widths line on the iPad.

   **AND A SECOND ROUND THE SAME EVENING, once he had it on the iPad.** Each
   is small; together they are what the screen actually needed.
   **THE INFO TAB SCROLLS AS ONE** (Mark: "why are photo, notes and delete
   stuck in the pane when adjusting its size?"). It was THREE scrollers — each
   column filling the pane and scrolling itself — which existed so the HISTORY
   could fill its column (2026-08-09). With the history on its own tab there is
   nothing left to fill, and per-column scrolling meant dragging the divider
   moved the fields while the photo, the notes and Delete sat where they were.
   One scroller, and `fill` comes off `BatchFields` on that tab.
   **NO FRAME ON THE TABLET** ("it's eating space"): the black bar already says
   where the pane begins, so the border and its 16px of inner padding — ~34px of
   a 768px screen — go. The desk keeps its frame.
   **`StickyFooter` GAINED `flush`**, for a bar that is its own backdrop: no
   white card, no padding, no `FOOTER_GAP`. With the wrapper at `-mt-4` the pane
   ends exactly where the bar begins; it was 56px of nothing before.
   **THE INFO TAB IS TWO BY TWO WITH LABELS ABOVE THE FIELDS** (Mark, in two
   asks): identity (Status · Order · Prepared by · Recipe version | Scale) on
   the left, the four AMOUNTS on the right, Notes and Photo beneath. Two `dl`s
   rather than one four-track grid, so a long value in one column cannot push
   the other's rows out of step, and `sm:` not `lg:` — a portrait iPad has the
   width for two columns. Stacking the label over its field gives the value the
   whole column where a 7.5rem label track left it ~200px, at 14px a row. **The
   Batch field is GONE** — the pane's own black bar names the number.
   **THE SCALE IS A FIELD, AND ONE FIELD IN TWO PLACES.** `scale_label` has
   been on `production_batches` since 044 with NO writer anywhere; it now sits
   beside Recipe version (a `kind="pick"` over that version's own scale column
   labels, `allowNew`, the `%` column filtered out because a baker's percentage
   is not a batch size) — AND the size picker above the Ingredients tab writes
   the same column (Mark: "make them the same field/ui element"). `BatchRecipe`
   takes `batchId` and `scaleLabel`: with a batch it writes and DERIVES the
   shown column from the row, holding a `pendingLabel` so the picker does not
   snap back during the write; without one it keeps its own local pick. So the
   amounts a batch shows are the ones that were weighed.
   **THE RECIPE TABS READ AT ARM'S LENGTH**: 16px ingredients and steps on the
   tablet (`BatchRecipe size="lg"`), 12px on the desk, with the tabs themselves
   back to 12px — they went to 14 and Mark asked for them down again, so the
   size prop is the PADDING and the column is `w-28` at both sizes.
   **AN AMOUNT IS SET AS A FIGURE AND A UNIT, NOT A STRING**: figure
   right-aligned, gap, unit left-aligned in a fixed slot, so down the list the
   numbers line up on their ones column and the units on their first letter.
   Two spans, never `formatCell`'s one string, which is why it is passed
   `{ qty, unit: null }` for the left half.
   **THE FOOTER IS `Batch` · `Batch`** — Add and Delete, the glyph carrying the
   verb (Mark: "the glyph says add or delete"). Complete/Reopen and Delete log
   are DESK commands and stay on the strip; **the footer moved INTO
   `BatchLogItems`**, because Delete batch acts on the SELECTED batch and only
   that component knows which. The record passes Add batch down as
   `footerLeading`. Both deletes now say what they delete — the confirms always
   did, the buttons did not.

   **THE RESTING `↕` IS GONE FROM EVERY LIST** (Mark: "Why? Those can go
   away"). `ColumnHeader` draws the arrow on the SORTED column only; the
   promise "you could sort by this" was true of nearly every header and so said
   nothing.

   **NOT BUILT, deliberately, and worth asking before building:** the
   standalone web-app manifest (`app/manifest.ts`, `viewport`, icons — `web/
   public` is empty). It is gated on a real-iPad test that a `showBlob` tab
   still reaches the share sheet from standalone mode; if it does not, the app
   runs from a Safari tab and the shell works either way. Also no touch-shaped
   task or document lists, and the runners' footers carry no
   `env(safe-area-inset-bottom)` yet.


**SETTINGS ON THE HOME BAR (Mark, 2026-09-25).** A supervisor sets their PIN on
`/account`, and a REGISTERED iPad gave no route there — its home screen had only
the shop picker and Switch user. A gear cell, **Settings**, now sits between the
two (`ICON_SETTINGS`, Material Symbols `settings` filled). It also replaced the
unregistered tablet's person-icon **Account** cell, so both kinds of tablet say it
the same way. Note that `/account` still refuses a PIN change in a PIN-minted
session (097), so on the shared iPad the PIN is set while signed in with a password.

**THE HOME-SCREEN WEB APP IS BUILT (Mark, 2026-09-25)** — the manifest the
"NOT BUILT" note above deferred. `app/manifest.ts` (`display: standalone`,
served signed out: `proxy.ts`'s matcher skips `manifest.webmanifest`), the
Donut Friend artwork Mark supplied (512×512, scaled by `sips` to
`public/apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`), and
`appleWebApp` + `themeColor` in the root layout with status bar `black` — not
translucent, so nothing needs safe-area padding. **The PDF → share sheet
question is STILL UNTESTED**; Mark tests it on the iPad. If a PDF strands the
user, change `display` to `"browser"` and the icon stays.
The icon is NOT `app/apple-icon.png` (Next's file convention): adding it there
500'd every page in the running dev server with `require is not defined`.
The artwork is a static file, not `orgs.settings` — the manifest is fetched
with no session, so it has no org to read. A second org would need this moved.
