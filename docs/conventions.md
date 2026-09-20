<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

- **A CREATE DIALOG ASKS FOR THE FIELDS THE REST OF THE APP READS, AND STOPS**
  — `NewEmployee`'s template, now followed by `NewVendor`, `NewInventoryItem`,
  `NewLocation`, `NewProductionItem` and `NewRecipe` (all 2026-09-03), and
  `NewVendorItem` (2026-09-07, where there had never been one at all). Command
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
  **SUPERSEDED 2026-09-10 FOR TEN SCREENS (Mark): "move the action buttons in
  the filter row … to the identity row."** Shift reports, tags, documents,
  checklists, tasks (and maintenance), plans, schedules, recipes, batch logs and
  vendors now pass their create command as `PageHeading`'s `action`, TOP- and
  right-aligned with the title (Mark, the same day: "not only right aligned,
  but TOP aligned as well" — `items-start`; it had been bottom-aligned with the
  count line), and their filter rows hold filters only (the
  tags and batch-log command strips are gone too). **Six more followed the same
  day:** Inventory (whose Active tabs became a captioned Show picklist, every
  filter captioned), inspection logs, equipment, shop sections, employees,
  benefits, purchase requests, special orders, customers and locations — and
  `/bills`, whose Check QuickBooks and New Bill left their own strip for
  the far right of its title row, after the three totals. The paragraph below still describes every other list; a NEW list
  follows the title-row form.
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
  Applied 2026-09-03 to all 24 list screens. `/purchase-orders` and `/bills`
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
  **there are no switches** (Mark, 2026-09-11 — every on/off control became
  `ui/Checkbox size="lg"`; they were black-and-white switches until then) —
  **except `/vendors`' Active column, which took one back the same day**, and
  for a reason the sweep created: see `ui/Switch` in the parts table;
  **table rows carry no dividing rule** (56px rows + hover wash;
  rules that DELIMIT — the head's 2px, a group strip, an expanded row — stay);
  **every checkbox is `components/ui/Checkbox.tsx`**, never a raw
  `<input type="checkbox">`; the **ActionBar carries commands only** — a control that changes what a list
  SHOWS goes with that list's filters — and its cells are **all plain black**
  (Mark, 2026-07-26): `ActionBarButton` still has a `primary` white-fill
  variant, but nothing uses it, because against the bar's own black a white cell
  read as a different kind of object rather than as the important one.
- **THE CLASSIC MAC LOOK IS APP-WIDE** (Mark, 2026-09-10: "apply the mac look
  across the entire app", after an afternoon parked on `/bills`). It breaks
  two design-system rules on purpose, **no shadows** and **no textures**.
  **Where it lives:** `web/src/styles/mac-look.css`, imported UNLAYERED in
  `globals.css` right after the design-system import — unlayered is what lets
  its rules outrank the controls' own `hover:bg-ink`, `hover:bg-neutral-100`
  and `focus:border-2` with no `!important`. Two classes, carried by the
  SHARED PARTS so a control gets the look by being built from them:
  `mac-control` is in `BUTTON_CLASS`, `PRIMARY_BUTTON_CLASS`,
  `DANGER_BUTTON_CLASS`, `DIALOG_COMMIT_CLASS`, `DIALOG_DANGER_CLASS`, a
  `PickList variant="field"` trigger (filter rows AND dialog forms), and the
  unboxed filter-row dress of `PickSet` and `RangePicker`; `mac-field` is on
  every `TextInput search`. The ~43 hand-rolled copies of the plain command
  button were swept to carry `mac-control` too, and so do the tablet landing
  page's tiles (`tablet/Landing`, Mark: "those are buttons afterall") — the bar
  above them does not. **A NEW BUTTON uses
  `BUTTON_CLASS`, or it will not look like its neighbours.**
  **`ui/CalcPad` wears it too** (Mark, 2026-09-10: "retrofy it while keeping
  the layout the same", with the 1984 Mac Calculator as the reference). It had
  been a dark, rounded, orange-keyed copy of macOS Calculator; now every key is
  a white `mac-control` square (with `mac-own-hover`, because the pad is
  touch-only and a tapped key would keep a stuck grey hover — the press drops
  it and fills it grey instead), the readout is a `mac-field` well, and the
  window is a 2px black frame with a 4px hard shadow, a black title bar and a
  `mac-stipple` body (a 25% dot tile, in `mac-look.css`). The title bar's
  close box is REAL: it does what a tap outside does. The ⌫ nudge moves the
  glyph, never the key, or that square would sit 3px out of the grid. Same 4×5
  grid, same keys, same focus handling.
  **A RECORD SCREEN CAN OPT IN WHOLE: `.mac-page`** (Mark, 2026-09-10: "let's
  try making the location detail page mac styled") — so far ONLY
  `/locations/[id]`, as an experiment. The shared field parts carry two MARKER
  classes — which did nothing outside such a screen until 2026-09-11, and now
  apply everywhere (see FIELDS NEVER FILL GREY below): **`rf-typed`** (a box you
  type into — `InlineValue` text/number/notes, a boxed `DateField` or
  `TimePicker`, `TextInput`, the form textareas) gets a SOLID BLACK 1px border
  on all four sides, white, and 2px on HOVER (Mark, same day — drawn as an inset
  1px shadow inside the border, so the box does not grow and the text does not
  move; no grey fill) — it was sunken like the search box first,
  and Mark asked for the plain border within the hour ("for text fields I want
  to see a solid black 1px border on all sides"); **`rf-press`** (a
  boxed `PickList`, `PickSet` or `RangePicker`, and `WorkingHere`'s button)
  RISES and PRESSES, named beside `.mac-control` for the shadow and the drop —
  but on HOVER it takes the text field's 2px edge, never the buttons' grey fill
  (Mark, same day: "instead of filling in with solid grey, just increase the
  outline of the border to 2px like text fields"), and keeps it while held.
  While typing, `InlineValue`'s editor keeps the same 1px border
  (`.rf-typed ~ .rf-typed-editing`, the invisible Sizer being the sibling), so a
  click moves nothing; the unboxed title keeps its own editor.
  **ITS CHECKBOXES WERE `ui/MacCheckbox`, NOW `ui/Checkbox` EVERYWHERE** (merged
  2026-09-11; first drawn the same day as below, with system.css's
  `field-row` markup as the reference): a native `<input type="checkbox">`
  beside a native `<label>`, the box drawn in `.mac-checkbox` — a 1px black
  square (2px/3px was tried and reverted — Mark: "1px + 2px was better"), a
  light GREY (#b0b0b0, after #808080) X corner to corner when checked, a 2px edge on hover
  and while held (Mark, same day: "make the X inside gray and make the box 2px
  on hover"), a dotted ring on keyboard focus. **The hover is on the ROW, not
  the label**: the transparent input covers the box, so `label:hover` fired
  only on the box's edge (Mark: "the on hover only applies to being over the
  border"), where `.mac-checkbox:hover` covers the box and the words alike. The input stays transparent OVER the box rather than
  `display: none`, which would drop it from the tab order. On the hours block
  the DAY is the label, so the Day and Open columns became one ("Open on").
  Undo is taking the class off the page; every record Mac is moving it up to the
  layout. **The record book (`ui/RecordNav`)
  joined on 2026-09-10** ("mac style the nav buttons in the upper right hand
  corner"): markers `rf-book` / `rf-book-dead` / `rf-book-row` make the live
  four raised Mac buttons, a dead one the same box at 35%, both at a 1px border so paging to an end moves nothing, and the row's
  gap 8px so the shadows do not crowd. **On every record screen since
  2026-09-11** (Mark: "make all the record nav buttons match what we did in the
  location detail page") — the selectors lost their `.mac-page`. The tablet
  bar's record book (`tablet/BarRecordNav`) is its own 64px cells and is not
  these. **On a `.mac-page` NOTHING FILLS GREY ON
  HOVER** (Mark, same day: "instead of filling with grey on hover just increase
  the border to 2px like everything else. Keep the fill on press"): buttons
  (`mac-control`, the record book) take the fields' 2px edge on hover and fill
  #c0c0c0 only while held, with the drop. `mac-own-hover` buttons keep their
  own hover, and every other screen keeps the grey hover.
  **`mac-own-hover`** keeps a control's OWN hover while it takes the shadow
  and the press. Since 2026-09-11 that means the red ones (`DANGER_*`, which
  also cast a red shadow via `mac-danger`) and the RangePicker's current
  preset; the primary and dialog commits carry `mac-primary` instead (light
  grey fill, 2px edge on hover). **Superseded the same day: white buttons no
  longer fill grey on hover either — see FIELDS NEVER FILL GREY below.**
  **DELIBERATELY WITHOUT IT:** `TabPicker`, the masthead and tablet bars, row
  ⋯ menus and the columns eye, text-only buttons (dialog Cancel), and ~31
  denser hand-rolled buttons with their own sizes (small Clear/Link buttons,
  table-row buttons, the public login, welcome and inquiry pages). Checkboxes
  are the Mac `ui/Checkbox`, there are no switches, the boxed field dresses
  and `TextInput` wear `rf-press`/`rf-typed`, and the row expander wears
  `mac-disclosure` — all since 2026-09-11.
  - **`mac-control`** — at rest a hard 3px black shadow down and right; on hover a SOLID light
    grey, `#c0c0c0` (Mark, 2026-09-10 — it replaced the classic 50%
    checkerboard of single black and white pixels, and a solid `#808080` was
    tried first and read too dark); on press the control drops 3px into its
    shadow and keeps the grey. Instant state changes, no transitions.
  - **`mac-field`** — the search box. Sunken: a 1px border plus a hard 2px
    black shadow inside along the top and left (the mirror of the raised
    controls), 39px tall growing DOWNWARD so its top meets theirs and its
    bottom meets their shadows, no hover, no press. The hint text is gone: a
    magnifier sits in the clear button's slot while the box is empty
    (`TextInput`'s new opt-in `icon` prop), and the hint's words moved to
    `aria-label`, the field's only name.
  **FIELDS NEVER FILL GREY ON HOVER, ON ANY SCREEN (Mark, 2026-09-11,
  reviewing /interface).** The two field markers left `.mac-page` and apply
  everywhere: **`rf-press`** (every picklist-like box — `PickList` field and
  boxed, `PickSet` and `RangePicker` in both dresses, `DateField
  variant="title"`) is a solid black border with the raised shadow, a 2px edge
  on hover and the drop when pressed; **`rf-typed`** (`TextInput`, the boxed
  and field date and time fields, `InlineValue` boxed, `FORM_FIELD_DRESS`) is a
  solid black border with a 2px edge on hover. The search box keeps its sunken
  top and left and gains the same 2px edge. The 2px is always an inset 1px
  shadow inside the 1px border, so nothing grows. **`DANGER_BUTTON_CLASS` and
  `DIALOG_DANGER_CLASS` cast a RED shadow** (`mac-danger`; the dialog one had
  no Mac look at all until now) and keep their red fill on hover.
  **`PRIMARY_BUTTON_CLASS` and `DIALOG_COMMIT_CLASS` are filled LIGHT GREY
  (`#c0c0c0`) with black type and a black border, not black** (`mac-primary`;
  dark grey for an hour first): a 2px edge on hover, and held they drop and
  stay grey. **The plain white buttons (`BUTTON_CLASS` and every other
  `mac-control` without `mac-own-hover`) take the same 2px edge on hover and
  fill `#c0c0c0` only while held**, on every screen — the location record's
  rule, made app-wide the same day.
  **THE DISCLOSURE BOX** — `DataTable`'s row expander and `RevealPanel`'s
  toggle, the small bordered ▶ — wears `mac-disclosure` (Mark, 2026-09-11): a
  1px black border with the raised shadow, a 2px edge on hover, dropped and grey
  while held, and **open and closed differ ONLY in the arrow** (it was filled
  black when open).
  **Tried and rejected, so nobody reinvents them:** a 5px shadow (3px), the
  classic 50% checkerboard hover in both 2×2 and 1px dots (a solid light grey
  replaced it), a solid `#808080` hover (too dark), a solid-black flip on press
  (just dropping into the shadow was better), a 2px border on the search box,
  a dotted hover on the search box, and **setting the controls in Chicago**
  (ChicagoFLF, Robin Casady's public-domain revival, self-hosted — Mark,
  2026-09-10: "that was fun, but it's too much"). It was reverted whole; the
  Mac look keeps the app's own font.
  **Traps the tuning hit, handled in the CSS and worth knowing before rolling it
  out:**
  - **(Retired with the checkerboard.)** A one-pixel checkerboard smears to flat
    grey whenever its box starts at a fractional pixel; `background-attachment:
    fixed` pinned it to the screen's grid, and iOS Safari ignores that. A solid
    fill has neither problem — worth remembering if dots ever come back.
  - **Where the border sits on a WRAPPER around a button** (the date window),
    the class goes on the wrapper, and the inner button needs help: its own
    hover paints `neutral-100` over the wrapper's grey, so descendants of a
    hovered control go transparent.
  - **Growing a control downward in a bottom-aligned row** takes a -3px bottom
    margin, and on the search box it has to go on `TextInput`'s wrapper (via
    `span:has(> input.mac-field)`) so the clear button and the magnifier centre
    on the full height.
  - **The search box's focus no longer thickens its border** — the unlayered
    `border-width` outranks `focus:border-2`, so the caret is the only focus
    cue. Accepted for now; revisit before it spreads.
  **To remove it:** delete `mac-look.css`, its import in `globals.css`, and the
  `mac-control` / `mac-field` classes, `triggerClassName` and the search box's
  `icon` in `BillList.tsx`, then put its `placeholder` back. The two new
  props are opt-in and harmless to leave.
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
  `DateField` and `TimePicker` it hands down to — or a page boxes its typed
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
  but it is the one place the 36px rule is visibly expensive. (Measured against
  that pane's ONE column with side labels; 2026-09-09 made it two columns with
  the label over each field, which costs a 14px line per row and gives the
  value the whole column back. Re-measure before quoting the figure.)

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

- **SUPERSEDED 2026-09-11 FOR ANYTHING WITH A BORDER** (Mark: "All fields with
  a border should not fill with a solid color on hover, but the border should be
  2px on hover", then the same for white buttons). Bordered fields, white
  buttons, the primary and dialog commits, and the row expander now take a 2px
  edge on hover and never a fill — see the Mac look's FIELDS NEVER FILL GREY.
  The wash below still holds for UNBORDERED controls: a `TabPicker`'s unselected
  cell, a `WeekdayPicker` day, an unboxed `PickList` or date, `RowMenu`'s ⋯ and
  the columns eye.
- **A CONTROL YOU PRESS FILLS GREY ON HOVER — `hover:bg-neutral-100`** (Mark,
  2026-09-04, on the checklist template record: Kind "fills grey and the border
  becomes black", where Shifts "become[s] black with no grey fill… I think
  filling grey is the preferred behavior"). The wash is the app's one "you can
  press this" cue, and it is the answer to the pointer, where a BORDER that
  darkens is a resting cue about the field's own kind (`BOXED_FIELD_BORDER`
  says "editable"). A control that only darkens its border is answering half the
  question.
  **WHAT TAKES IT**: every `PickList` trigger (`field` and `inline`), `PickSet`,
  `InlineValue`'s resting button, `DateField` and `TimePicker` in their cell
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
  TabPicker cell — **though not a WEEKDAY PICKER's day, which is `#c0c0c0` with
  BLACK type since 2026-09-18** (Mark: "the lighter grey we use on our other
  controls… If the text needs to be black to be readable that's fine"). It was
  #757575 from 2026-09-12 ("dark grey instead of black", then "can we go
  lighter"), the lightest grey that keeps WHITE type at AA — 4.61:1 — and that
  note said the next step flips the type and lands on the Mac look's own fill,
  which is where it landed once the days became small raised buttons and a
  third grey read as a third kind of control. Seven boxes are a SET whose SHAPE
  you read, where a TabPicker's cells are one segmented bar in which the fill IS
  the answer. Black
  still means a band that DELIMITS (masthead, ActionBar, dialog title bar, group
  band). **The one exception is `DIALOG_COMMIT_CLASS`** (and `PRIMARY_BUTTON_CLASS`
  after it) — a FILLED commit, LIGHT GREY with black type since 2026-09-11,
  where it was black; the exception is the fill, not the colour. It was flagged and left black
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
  shared placeholder — is HR's Team Reviews and Operations' Policies (Tags
  graduated 2026-09-06, build step 4n). **`operations/shift-reports` graduated on 2026-08-28** and stays
  under Operations: the note that used to argue for Production was about where
  the WORK was sequenced, not where the entry belongs, and the screen is
  organised by the shift a supervisor is closing rather than by the tables it
  writes. **The menu is
  `web/src/lib/nav.ts`** — a screen ships by getting a real `href` there and
  nothing else moves. Home and Settings are utility ICONS, not tabs, so they
  light no tab and the second band hides entirely on those routes.
  **SUPERSEDED 2026-09-17: `/` LANDS ON `/start` UNDER BOTH SHELLS** (build
  step 4q), and the masthead has a Home icon again, last in row 1, pointing
  there. `homeHref` is deleted. The paragraph below is history.
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
  **`--rf-controls-h`** (named `--rf-guide-controls-h` until 2026-09-07, when
  the plan matrix became the second screen to pin a band and a second variable
  saying the same thing would have been how two screens' offsets drift), which
  the guide's column labels ADD to their
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
- **ESCAPE CLOSES ONLY THE TOPMOST THING** (Mark, 2026-09-11). A picker's panel
  open inside a dialog closes first and the dialog stays; the next Escape closes
  the dialog. Three mechanisms, all in shared parts, so no caller does anything:
  `useAnchoredPanel` counts open panels and `ui/Dialog` asks
  `anyAnchoredPanelOpen()` before acting; a field reverting its own edit
  (`InlineValue`, `DateField`'s typed box) calls `preventDefault()` and the
  dialog skips a `defaultPrevented` Escape; and dialogs keep a stack, so a
  confirm over a dialog takes Escape AND Enter alone. Before this, every one of
  those closed the whole dialog, because the dialog's window listener was added
  first and so ran first.
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
- **RESIZING A COLUMN MOVES THAT COLUMN AND ONE OTHER, NEVER THE ROW** (Mark,
  2026-09-05: "when I resize a column, every other column resizes as well,
  making it difficult to get right … I don't like it"). Widths are still
  WEIGHTS and the table is still exactly as wide as its pane — that is what
  keeps the labels sticking and tablets free of sideways scroll — but the drag
  rule changed: `resizeWeights` in `lib/columnWidths` keeps the SUM constant,
  so the column you drag moves by the pixels you moved (the hook measures the
  `<table>` to convert pixels to weights at the rendered rate) and the
  RIGHTMOST visible column pays, walking leftwards when it hits its floor
  (`NSTableView`'s default; Finder's list view). Dragging the last column
  borrows from its left neighbour. A shrink hands all the slack to the last
  column; a grow is capped at what the payers can give. Double-click reset
  goes through the same rule, so it too moves two columns, and a value back at
  its default is DROPPED from the store so the reset footer does not appear on
  a table exactly as declared. Every `DataTable` and `OrderLines` (the one
  hand-rolled table still resizing) go through it; nothing else calls
  `startResize`. Chosen over fixed pixels with horizontal scroll, and over a
  pixels-that-fit-until-they-don't hybrid, because it fixes the feel without
  giving up a layout guarantee; if the fixed total still feels confining the
  hybrid is the next step and this is on the way to it.
  **`DataColumn.minWidth` IS THE FLOOR A PAYER CANNOT BE PUSHED UNDER.** The
  first live test paid a Name drag out of a weekday picker column, which needs
  300 for its All/None — so every `WEEKDAY_PICKER_WIDTH` column declares
  `minWidth: WEEKDAY_PICKER_WIDTH`, and any column holding a control with a
  real minimum should do the same. Default 48. Verified live: a 600px drag on
  the item record cascaded through three payers and held Order days at 302px
  with All/None visible. 9 fixtures pin every clause.
  **ON A TABLET THE GRIP IS FINGER-SIZED AND COLUMNS DO NOT REORDER** (Mark,
  2026-09-10: "how can we make it easier to resize columns on a tablet? I
  struggle to get it"). The desk grip is a 12px strip on a 1px line; under the
  tablet SHELL (`ColumnHeader` reads `useShell()`) it is 40px, capped at half
  the cell so a narrow column keeps its heading for sorting — and the LINE
  STAYS 1px (Mark, the same day: a visible 6px handle on each boundary was
  tried, "works well, but aesthetically don't like the thicker dividers"). The
  hover thickening is desk-only too, since a tap can leave a hover stuck. Drag-to-reorder is OFF there, because a near-miss on the
  grip was landing on the header and moving the column instead. And **Reset
  column widths is in the Columns (eye) menu** whenever a width has changed —
  the footer line is off on some screens and a double-click is no touch gesture,
  so on an iPad there was no way back from a bad drag. Desk behaviour is
  unchanged; `OrderLines` and PO detail get the grip too, being built on
  `ColumnHeader`.
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
  **SINCE 2026-09-10 THE CALENDAR IS OURS, NOT THE BROWSER'S** (Mark: "roll our
  own date picker to match the rangepicker", after the iPad's calendar icon
  opened nothing). The box is a typed text field (`lib/dateInput`) and the icon
  opens `ui/CalendarGrid` in a `useAnchoredPanel` panel: one tap picks and
  closes, Today and Clear sit under the grid (Clear only when the field may be
  empty and is not), `max` greys out later days, arrow keys walk from the chosen
  date, Escape returns focus to the icon. Today is the DEVICE's day, read when
  the panel opens. **There is no native date input anywhere in the component
  now**, so everything below about WebKit painting today into an empty input,
  `showPicker()` and the hidden input is HISTORY — kept because it is why the
  native control was retired, and why it must not come back.
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
  **AND SINCE 2026-09-10 THE SCROLL RULE REALLY MEASURES MOVEMENT** (Mark:
  picklists "are finicky on tablets… out of 10 taps, 8 times the keyboard won't
  display"). Testing the event TARGET is a proxy — right about a pane, wrong
  about iOS, where **`window.scrollY` tracks the VISUAL viewport**, so pinching,
  or Safari zooming to a focused field, or the keyboard sliding up to reveal it,
  all fire a page scroll while nothing in the layout has moved an inch. The
  panel closed on its own keyboard, taking the field being focused with it. It
  re-reads the trigger now and closes only if that has really moved:
  `getBoundingClientRect` is in LAYOUT viewport coordinates and so is
  indifferent to zoom, which is exactly the discrimination needed. Deliberate
  consequence — **a `position: fixed` trigger's panel no longer closes on a page
  scroll**, because the trigger genuinely has not moved (the masthead's picker,
  verified still glued at its 2px offset). `resize` is deliberately NOT given
  the same test: a window that changes SHAPE moves the edges the fitting pass
  measured against, and that pass observes only the panel, so closing is the
  honest answer — safe on iPad, where a Safari tab's keyboard resizes the visual
  viewport and fires no window resize at all. Revisit if this app is ever added
  to the Home Screen, where a standalone window IS resized by the keyboard.
  **THE FIND BOX IS 16px, AND THAT IS THE THRESHOLD RATHER THAN A SIZE.** Below
  it iOS Safari zooms the whole page when a field takes focus — the rule this
  file states for the inquiry form, the shift report and the checklist runner,
  and the one input that had missed it, because it is the only field the app
  CREATES rather than lays out and because **`PickList`'s `size="lg"` dresses
  the TRIGGER and never reaches the panel**. 16 everywhere rather than only on
  `lg`: the tablet shell reuses the desk lists as they are, so a `md` picklist
  on `/vendors` is read on the iPad as often as anything built for it.
  **AND THE PANEL OPENS INSIDE THE TAP — `flushSync`, in both `PickList` and
  `PickSet`.** WebKit raises the software keyboard for a programmatic `focus()`
  only while it is PROCESSING A USER GESTURE, and that flag lives on the
  event-dispatch call stack — where **React 18/19 flush discrete updates in a
  MICROTASK**, after the handler has returned. So `autoFocus` gave the find box
  focus and a caret and no keyboard. It is worse here than for an ordinary field
  because the panel mounts on a SECOND render: `useAnchoredPanel` has to measure
  the trigger before the caller may draw anything. `flushSync` puts the render,
  the commit, the measuring layout effect and the re-render it schedules all
  inside the handler's own stack; the explicit `focus()` after it is insurance,
  not the mechanism.
  **The probe is one line and it is decisive: `t.click()` then read
  `document.activeElement` SYNCHRONOUSLY.** After the change it is the find box;
  with the old open path it is `BODY`. Nothing else in the app needs this —
  every other `autoFocus` opens a dialog or an inline editor the reader then
  taps into — but reach for it for any control that must raise a keyboard from a
  tap.
  **Harness note:** the pane lands on the shared-device PIN lock (097), so all
  of this was measured on a standalone page mounting the REAL components,
  bundled with `npx esbuild` against `tsconfig.json` (entry inside `web/`, or
  node_modules will not resolve) and linked to the dev server's own compiled
  stylesheet — without it every Tailwind class is inert and a 14px find box
  measures a passing 16.
  **An anchored panel is `z-[70]` — above everything, dialogs included.** It
  was `z-50`, chosen to clear the ActionBar, and that held until a `PickList`
  appeared INSIDE a `ui/Dialog` (`z-[60]`): the invite panel's role picker
  opened its list *behind* the dialog it belongs to (Mark, 2026-08-02). The
  rule is now the honest one — a panel is transient and anchored to a control
  the reader just pressed, so nothing should ever cover it while it's open. It
  portals to the body, so DOM order can't establish that; only the z-index can.
  The ladder: 20 sticky table heads · 30 ActionBar, BackToTop and an open
  `RevealPanel` body (it must clear the table heads below it) · 40 drawer
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
  Vendor-item detail is wired and stays blank until something publishes for it.
  That is no longer for want of a WAY IN — since 2026-09-07 both vendor-item
  grids reach it from a row's ⋯ — it is that neither of them publishes a found
  set for `/vendor-items`, and the order guide's "set" would be that day's walk
  lines rather than a list of records. Publishing one from those two grids is a
  three-line follow-up nobody has asked for.
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
  filter). Consumers: the guide's day strip (href/Link cells); ListFilters;
  both big lists; the PO list; cleanup ×3; receiving's layout control
  (`size="sm"` for its fixed-height band).
  **A ONE-OF-N GOES TO A `PickList` WHEN THE ROW CANNOT AFFORD IT**, which is
  the only reason so far and has now been taken four times: `/bills`' Due
  tabs (2026-09-08), then **the order guide's tier and grouping**, **the PO
  list's status** and **`/bills`' status** (all 2026-09-10, Mark). There
  are no `TabPicker`s left in any of those three filter rows.
  A TabPicker spends its width whether or not you are looking at it — the
  guide's four tiers wanted 460px and its three groupings 373 — and that band
  is sticky for a 66,000px walk, so it wrapped at EVERY width including 1440
  and every wrapped line covered a line of walk. As picklists: 176 and 245, the
  band 112px → 60 at 1440 and 1280, one line down to 1200. Below ~1150 it wraps
  again, so a portrait iPad gains room rather than height.
  **The counts ride as `hint`s**, which is where the tabs carried them; the
  cost is the count of the tier you are ON at rest, and the gain is that all of
  them are still one tap away. **No find box comes with it** — `PickList` grows
  one past eight options or with `allowNew`, so a closed vocabulary of three or
  four never has one. **IT IS NOW THE DEFAULT FOR A LIST'S FILTER ROW** (Mark,
  2026-09-10, converting one list after another the same afternoon — shift
  reports, tags, documents, checklists and their templates, tasks, plans,
  schedules, recipes, vendors, employees, and the batch log's own table): a
  filter row's one-of-N is a captioned `PickList` with its counts as hints and
  `fit`, and a new list's should be one too. `TabPicker` stays right where the
  choice is not a list filter — `SectionNav`-adjacent controls, a runner's
  tier, a dialog.
  **AND A COLLAPSED PICKER NEEDS ITS CAPTION — every one of them** (Mark,
  2026-09-10, the day after: "put labels above the picklists", then "caption
  the filter row elements like we did the order guide" for both purchasing
  lists). The guide shipped with a caption on Group by alone, on the argument
  that a picker's own face names what it is set to and only that one's did not.
  Right about Group by, wrong to stop there: at rest the guide's three read
  "Favorites", "All vendors" and "Shop section", and the PO row's read "All
  time", "All vendors", "All" — three VALUES of three different dimensions with
  nothing saying which is which, where a TabPicker had at least shown its whole
  vocabulary. **The caption is what a collapsed control gives up, so it is what
  a collapsed control has to state.** Above rather than beside — `/items`'
  Last-ordered rule — and VISUAL only, each control keeping its own longer
  `ariaLabel` so nothing is announced twice.
  **A PICKER IN A FILTER ROW PASSES `fit`** (Mark, 2026-09-10: "they're
  taking more room than they need to"), which sizes its trigger to its WIDEST
  OPTION — never to the current value, which would resize the control on every
  pick and shove the row along. It renders every option hidden in one grid cell
  so CSS finds the max width in the real font; no JS measurement, so tracking
  cannot fool it. Opt-in: a cell already has a width. Measured: Status 160 →
  100 and holding at 100 on "Received". A filter-row search is
  `flex-1 min-w-[13rem] max-w-[18rem]` — it flexes on a narrow window and
  stops at the app's ordinary search width on a wide one. **Since 2026-09-10
  that is EVERY search box in the app** (`TextInput search`, `SEARCH_PEN`),
  dialogs and panels included; no fixed-width search remains.
  **`ui/ControlField` IS THE PART**, lifted out of the guide when the PO and
  bill lists became the second and third callers. Reach for it; a caption
  typed four times is a caption that drifts. A row holding one wants
  `items-end`, so an UNCAPTIONED control — a search box, a command — sits on
  the line of the fields rather than floating against their captions. A
  `TabPicker` in such a row gets one too, though it does not need it:
  three captioned fields and a bare fourth reads as an oversight, and
  `/items` has captioned a TabPicker since 2026-08-01.
  **A `RangePicker`'S FACE CARRIES A TWO-DIGIT YEAR** (Mark, 2026-09-10) —
  `formatRange`'s own private `usDate`, one slice, and **NOT
  `lib/specialOrderDocs`' `usDate`**, which a quote and an invoice PRINT and
  which keeps four digits. Safe on a filter, read beside a list whose date
  column carries the full year and never transcribed. Its cell went 256px →
  **`w-52`**, measured: 192 clipped "09/01/26 – 09/10/26" by 11px, because the
  trigger gives 16px back to the clear button and the face `truncate`s in
  silence.
  **THE FLEXIBLE CONTROL IS WHAT MAKES A SINGLE ROW A RULE** rather than a
  hope. A band's pickers are as wide as their vocabularies and its switches as
  wide as their words; the SEARCH BOX is the only thing in it with no natural
  width, so giving it the leftover (`flex-1` in a pen with a floor) is the one
  arrangement that fits every window with no breakpoint. **`fullWidth` on
  `TextInput` is load-bearing** — its wrapper shrink-wraps, so `w-full` on the
  input alone resolves against a span the input itself sized and the pair
  settles at ~20 characters. `items-end` levels the boxes, so an uncaptioned
  search sits on the line of captioned fields.
  Measured on the guide: one row at 1440 / 1280 / 1024 / 820 / 768 with the
  search giving up 885 → 725 → 469 → 265 → 213px, all bottoms on one pixel, no
  overflow. **A 13rem floor rather than 15 is what buys 768.** **And EVERY
  flexing search now has an 18rem CEILING** (Mark, 2026-09-10: "there should be
  a maximum width … what's reasonable?"). The guide's was the last without one,
  which is where those 885 and 725px came from; 288px is the width every fixed
  search box in the app already uses, so no search box anywhere is wider than
  that. On the PO list,
  one row at 1440 / 1280 / 1024 / **820, the portrait iPad**, 853 → 233px; it
  wraps at 768 and a lower floor does not rescue it (524px of fields and gaps
  in a 705px row once the scrollbar is counted).
  **THE ONE THING THAT DEFEATS IT IS AN `ml-auto` SIBLING**: an auto margin
  absorbs a flex line's free space BEFORE any flex-grow does, so a `flex-1`
  search and a right-pinned command cluster cannot both work. **The cure is
  `justify-end` on the ROW instead of `ml-auto` on the item** — it right-aligns
  a line that has free space and does nothing to a line the search has filled,
  which is both cases at once. Where the row simply fits, neither is needed:
  the last item's right edge is already the row's.
  **A ROW THAT CARRIES COMMANDS GIVES THEM A STRIP OF THEIR OWN, ABOVE IT AND
  RIGHT-ALIGNED** (Mark, 2026-09-10, on `/bills`: "make the filter row two
  rows, with the action buttons in the first row aligned to the right and the
  filter buttons on the second row aligned left"). The filter row is then
  left-aligned by construction rather than by a rule — nothing in it is pushed
  right, and the flexible search fills what the fields leave.
  **`flex-wrap-reverse` was tried first and is worth knowing about**: it
  reverses the CROSS axis so lines stack upward, which makes the LAST items
  rise only when the row actually wraps — the one pure-CSS answer to "when it
  wraps", since CSS cannot ask. It works (`items-start` is then the BOTTOM
  alignment, which reads like a typo and is not), and a strip beat it on two
  counts: the same arrangement at every width rather than a change at a
  threshold nobody sees coming, and no mismatch between focus order and
  reading order.
  **THE TRAP THE STRIP SPRINGS: a cluster that was a flex ITEM becomes a
  full-width BLOCK.** `NewBill`'s trigger carries an `ml-auto` baked in,
  harmless while the cluster was content-sized with no free space to give
  away — as a row of its own it ate the whole line and put the two commands at
  opposite ends of the screen. Keep the buttons in an INNER content-sized
  group and put `justify-end` on the outer row. Caught by looking at it, not
  by review.
  Measured on `/bills`: 1440 commands grouped at the right edge, filter row
  one line from the left margin with a 661px search; 1024 the same at 245; 820
  commands still right-aligned, filters on two lines — five controls cannot
  share 757px, which is why the PO list's four can and this one's cannot.
  **THE PO LIST'S STATUS went 697px → 160**, and its row's content 1365 → 828
  at 1440 — where 1365 was one pixel inside the 1376 a 1440 window gives, so
  the row fitted on the widest screen in the building and nowhere else.
  **IT ALSO SURFACED A RULE WORTH COPYING: keep the CHOSEN value in the
  vocabulary even when its count is 0.** That list drops an empty raw status
  on purpose, and the one you are FILTERED TO is the exception, because the
  control has to be able to say what the list is showing. Without it
  `PickList` correctly falls back to the raw column value — and a trigger
  reading a lowercase `received` under a "Current" heading is the tell. Any
  control whose options are derived from COUNTS has this hazard whether or not
  it was ever a TabPicker: `/bills`' Due had been a `PickList` since
  2026-09-08 and carried it latent until the same pass fixed both.
  **`/bills`' STATUS went 478px → 160**, which took that row from two lines
  to one at 1440. It is still two at 1280, because six controls is more than
  four — its fields alone are 1041px of a 1216px row — so its command cluster
  keeps the `ml-auto` and its search stays fixed, where the PO list's four fit
  down to 820 and its search flexes.
  **A MODE GOES ON ITS OWN ROW.** "Ignore ordering days" is neither a field nor
  a value — no vocabulary to collapse and a sentence for a label — so on the
  fields' line it was the thing that wrapped. Beneath them it costs a short
  line and gives the four above it a row they always fit. **On a tablet it is
  not there at all** — see build step 4 — so the band is one row and 80px
  against the desk's 116.
  **THE DAY PICKER IS ON THE TITLE'S OWN LINE, INSIDE THE TITLE BLOCK**
  (Mark, 2026-09-10, in three passes: the sub-line's baseline, then the
  title's, then "can the page title and datepicker sit next to each other —
  there's an awkward gap between them"). There was, and **it was not the gap
  it looked like: an `h1` is a BLOCK, so its box stretches to the width of the
  shrink-to-fit title block, which is set by whichever of its two lines is
  WIDER — and that is the COUNT.** Measured at 1440: "Order Guide" is 179.4px
  of ink inside a 225px box, so a `gap-x-6` began 24px after the count ended
  and the title's last letter sat **69.6px** from the day. A longer count
  opens it further; no gap value could have fixed it. Beside the title as a
  flex item the `h1` shrink-wraps to its text: 69.6px → **12.0px**, box and
  ink both 203.4. **Reach for this whenever a heading looks oddly far from
  what is next to it** — measure the h1's TEXT with a Range, not its box.
  `items-baseline` on that inner line holds the day on the title's baseline.
  **The quarter pixel survives every arrangement and flips sign with it**: the
  day is itself a flex CONTAINER, so as a flex ITEM its baseline is its own
  first item's (the weekday chip) while the number the eye reads is the
  input's, 0.25px below it. Two earlier arrangements are worth knowing for
  what they teach — `items-end` LEVELS BOXES NOT TEXT (a 36px input holding
  20px text centres it, baseline 25.75px below its own top, against 28px for
  a 28px title in a 35px line box), and `self-start` beat a pure `relative`
  offset (−16.75px, shipped for an hour) because the offset is a number about
  the distance down to a block that can grow a line. Measured 0.00 at 1440
  and 820, both with the weekday chip and the Today link on the row.
  **An `<input>` takes no children, so the zero-sized probe goes in an
  OFF-SCREEN REPLICA** — a clone and the probe in one inline formatting context
  — which is the only way to read a form control's text baseline. Worth
  knowing: it generalises to every boxed field in the app.
  **The height, stated because it is the price:** the guide's band is 116px
  captioned and two-rowed, against 60 uncaptioned on one row and 112 for the
  original tabs. Over a 66,000px sticky walk that is real; the cheapest 20px
  back is the captions on the two pickers whose values are least ambiguous.
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
- **THE WEEKDAY PAR HAS AN EDITOR AT LAST** (Mark, 2026-09-05: "one thing we
  lost from FMP that we should maybe bring back — different pars for each day
  of the week"). IT WAS NEVER LOST FROM THE DATA: 009 restored FMP's seven-slot
  `Par__array` as `inventory_item_locations.par_by_weekday` and the guide's
  view has read `coalesce(par_by_weekday[weekday], default_par)` ever since —
  34 rows carried a weekday override, 6 varying across the week (the weekend
  ramp: 500 → 600 Fri/Sat), and nothing on any screen could set one. The
  item record's per-location rows now carry a **Weekday par** strip beside
  **Default par** — seven `InlineValue`s through `arrayColumn`, the production
  item record's idiom, each in its own `min-w-0 flex-1` pen. **A blank slot is
  the default**, which the label says ("– = default") because it is the one
  fact the strip cannot show about itself. `par_fixed_by_weekday` still has no
  editor; nothing in the UI reads `par_mode` beyond the view.
  **THAT TABLE'S WEIGHTS WERE REBALANCED, and the sidebar is why.** When the
  item record grew tabs the content column beside the 192px `SectionNav` came
  out at 977px at 1280, and at the old weights Order days resolved to 197px
  against the 300 its All/None command needs — the `WEEKDAY_PICKER_WIDTH`
  warning, met on a screen that had shipped clean. Two weekday strips cannot
  give, so Section and Note are the compact set (`compactBelow={1440}`),
  Location is labelled **Shop** (the longer word clipped to "LOCA…"), and the
  strip is 370 because a four-digit par is 37px of ink plus the cell's 8px in
  a 45px pen. Measured: 1280 → five columns, Order days 347, strip 347, zero
  pen overflow; 1440 → seven columns, 309 and 347, zero overflow. **Any table
  placed beside a record's tab sidebar loses ~190px and must be re-measured.**
  Verified end to end on Flour, All Purpose at DF02 and left as found: a 7
  typed into Friday landed as `[null,null,null,null,7,null,null]` with
  `default_par` untouched, the guide view resolved Friday to 7 on all 13 of
  the item's lines and 100 every other day, and clearing the cell put the
  slot back to null.
- **THE INVENTORY ITEM RECORD HAS THREE TABS — Info · Vendor Items · Purchase
  History** (Mark, 2026-09-05). `lib/inventoryItems` mirrors `lib/vendors`;
  `ItemTitle` (the editable name, alone) sits above the split and **the Active
  switch is the FIRST ROW of Info's `dl`** (Mark, same day: "move the active
  button … out of the identity block … onto the info tab"). Purchase History is
  `catalog/ItemPurchaseHistory`: every `purchase_order_items` row of the item
  with `qty_received > 0` on a non-void order, reached through
  `vendor_item_id → vendor_items.inventory_item_id` (every source, retired
  vendors included — history is history), **SCOPED TO THE WORKING SHOP** (Mark,
  same day — the OPPOSITE call from the vendor tabs, and right: a vendor is one
  account across shops, what DF01 paid for its flour is DF01's fact), the shop
  named in the heading. `purchase_orders!inner` makes the location test a
  filter rather than a null embed. Fetched whole on `.order("id")` pages, then
  sorted newest-first and capped at 500 in memory, because PostgREST cannot
  order a top-level select by an embedded column. Quantities are in PACKAGES of
  whatever vendor item each line was, so only the MONEY is totalled.
  `compactBelow={1440}`, not 1280 — beside the 192px sidebar the table has
  ~190px less than a list, measured at 977px, and PO number resolved to 115px
  for a 13-character value. Verified live on Flour, All Purpose: 103 received
  lines org-wide → 45 at DF02, 0 with a zero received qty, 6 columns at 1280
  and 9 unclipped at 1440.
  **A CONSTANT A SERVER COMPONENT COMPUTES WITH MUST NOT BE EXPORTED FROM A
  `"use client"` FILE.** Next turns EVERY export of a client module into a
  client reference on the server, so `ITEM_PURCHASE_CAP` imported from the
  table component was an OBJECT there: `.slice(0, cap)` returned `[]` and the
  tab read "0" over 103 real rows with no error anywhere. The vendor tabs had
  the same bug latent — `.limit(cap)` was silently no limit and `capped` could
  never be true. All three caps live in `lib/` now. **Passing such a constant
  THROUGH JSX is fine** — eight server components hand `READ_ONLY_VALUE` down
  as a `className`, and React resolves the reference on the client to the real
  string — so the rule is about the server DOING ARITHMETIC OR LOGIC with it,
  which is exactly the case that fails without a symptom.
- **THE VENDOR RECORD HAS FOUR TABS — Info · Items · Purchase Orders · Bills**
  (the fourth was called Invoices until migration 110 renamed the module;
  Mark's quote below is as he wrote it)
  (Mark, 2026-09-05: "add a 'Purchase Orders' and 'Invoices' tabs to the
  Vendor detail page", clarified: "I don't want to see the scanned invoices…
  a simplified version of the purchase order screen… a simplified version of
  the invoices screen"). `catalog/VendorPurchaseOrders` and
  `catalog/VendorBills` are `DataTable`s with the WORKING taken off the two
  lists they are read from — no date window, no filters, no selection bar, no
  row menu, no commands — each row a link into the record, with the list's own
  status chips (`PO_STATUS_CLASS`, the `billStage` ladder) so a bill reads Paid
  here exactly as it does there, and a closing `totals` row.
  Newest first, capped at the lists' own 500 with a sentence when the cap
  bites. Fetched only on their own tab (the `SKIP` idiom), and the PO link on
  a bill is DERIVED from its lines as `/bills` derives it.
  **BOTH ARE SCOPED TO THE WORKING SHOP SINCE 2026-09-11** (Mark), which
  REVERSES how they shipped six days earlier. They were ORG-WIDE WITH A SHOP
  COLUMN, on the argument that a vendor is an org-level record whose Info tab
  already lists every shop's account side by side — so "what have we bought
  from these people" should be answered the same way. That reasoning is about
  the VENDOR, and these two tabs are not about the vendor: they are about
  MONEY, and money is a shop's. An order is placed by a shop, a bill is
  addressed to one and paid out of its account, so a `totals` row summing
  DF01's and DF02's was a figure nobody is responsible for.
  **Which makes `ItemPurchaseHistory` the precedent rather than the
  exception** — it was already scoped, and its own note ("a vendor is one
  account across shops, where what DF01 paid for its flour is DF01's fact")
  was drawing the line in the right place and putting these two on the wrong
  side of it. The Info tab is still every shop's, because an account number
  really is.
  **The Shop column is GONE from both and the HEADING names the shop**
  ("Purchase orders at DF01"), that component's way of stating a scope once
  rather than repeating it down every row — and with no working shop neither
  is FETCHED at all, each saying so in its own words rather than rendering an
  empty table that reads as "we have never ordered from them". The caps are
  now per shop, so they bite later.
  Measured on the live database and verified in the browser at 1440: Chefs
  Warehouse has 21 orders (DF01:11 · DF02:10) and 13 bills (DF01:6 · DF02:7),
  and the two shops' rows INTERLEAVE week by week — which is what the org-wide
  reading actually looked like — where the tabs now read 11 and 6, totals
  $9,775.37 / $8,458.03 and $5,043.24. Worth knowing for scale: Dawn Foods has
  1,554 orders org-wide, so the 500 cap had been showing an interleaved half
  of a mixed history.
  **Bills carries a BALANCE column with its own total** (Mark, same day).
  `balanceOwed` in `lib/bills`: void → 0; linked and QuickBooks answered →
  what it said; anything else → the whole bill, because this app records no
  vendor payment (4l), so "owed in full" is exactly what the row says. A
  credit is NEGATIVE both ways so the column nets out; QuickBooks reports a
  VendorCredit's remaining Balance positive, and the sign is put back here.
- **THE VENDOR RECORD CAN ACTIVATE AND DEACTIVATE AT LAST** (Mark, 2026-09-11:
  "we need to add a control … Put it above the Type field"), which closes a
  gap found while weighing whether the list's Active column could simply be
  DELETED: `VendorsList` was **the only writer of `vendors.is_active` in the
  app**, and this record merely PRINTED "Inactive" beside the title — so
  dropping that column would have taken the capability with it. A record's own
  state belongs on the record. It is the SWITCH, matching the two tables on
  this same screen: the org-wide flag, the per-shop one and the per-vendor-item
  one are three scopes of one idea and must not be three shapes.
  The word beside the TITLE stays and is not redundant — the field block is the
  Info tab's, so on Items, Purchase Orders and Bills that word is the only
  thing saying the vendor is inactive. One is the editor, the other the state.
  **The per-location table's first cell is the switch ALONE** (same day): its
  chevron and rep summary moved to the LOCATION column — the row IS the
  location, and that column's own width note had said since it was written that
  it was sized "for the code, the here badge and the rep summary". So the
  "Active" header sits over the switch (measured, both at 252 at 1440) and the
  column's border falls just past it. **The summary then went entirely** ("we
  don't need to see the email address in the location column when it's not
  expanded") — it showed the rep's name falling back to their EMAIL, which is
  how an address came to sit beside a shop code, and the rep is what the row
  opens to show. **And the open panel lines up with Location**, content edge to
  content edge at 334.8.
- **THE INVENTORY ITEM'S RECORD FOLLOWED IT (2026-09-12)** — Mark: "apply some
  of the changes we made to the vendor detail page to other detail pages,
  starting with the inventory detail page … replace the active checkbox with
  our new switch. Move the expand button in the per location table into the
  shop column. Replace the active checkbox with a switch. Move the vendor item
  details to the right so they are aligned with the shop column."
  **THE THIRD SENTENCE NEEDED NO CODE OF ITS OWN**: `expand.columnKey` moves
  the chevron AND starts the open panel at that column's boundary, so naming
  `"location"` puts the favorites grid under the shop it is about. The `ALONE`
  half of the vendor's arrangement came free too — with the chevron gone the
  Active cell holds the switch and nothing else, so its header sits over the
  thing it labels (measured, both at 252 at 1440, the vendor record's own
  figure to the pixel; chevron and Shop header both at 355.5).
  **THE SUMMARY IS KEPT HERE WHERE THE VENDOR'S WENT.** That one restated what
  its expansion showed; this one says why a row has NO chevron — and it now
  reads beside the SHOP rather than beside the "Stock here" button, where
  "Stock here … not stocked here" was one fact stated twice in one cell.
  **THE WORD BESIDE THE FIELD WENT WITH THE CHECKBOX**, which is where this
  record differs from the vendor's: there the word survives beside the TITLE,
  because the field block is the Info tab's and the other tabs would otherwise
  say nothing. This record never had one, so the Info field is the only
  statement either way and a switch makes it on its own.
  **EVERY WEIGHT BUT ONE MOVED, AND THE TOTAL STAYED 1230** — the PO list's
  rule, and here it is what holds Weekday par at exactly the 342px it had, the
  column with no slack at all (seven 42px pens round a four-digit par, 0px of
  clipping measured either side). Active 90 → 112, Shop 90 → 152, and Section
  150 → 108, Order days 330 → 325, Default par 90 → 94, Note 110 → 69 pay for
  it.
  **THE REBALANCE FIXED THREE CLIPS THAT PREDATE THE ASK**, measured at 1440
  with all seven columns and again at 1280 compact: "Stock here" was cut by
  42px, "DF01 HERE" by 23 — the here badge, on the working shop's own row — and
  Default par's header printed "DEFAU…", the single-word-too-wide fault this
  file names. All three are whole now, and nothing else clips at either width.
  **WHAT IT COSTS is Section and Note**, the two `hideWhenCompact` columns and
  so already the pair judged least essential — and both TRUNCATE A VALUE rather
  than clipping a control, which is the distinction worth keeping: a shelf name
  goes from 7px of overflow to 46 and a note from 73 to 111, in pickers you
  open to read in full. 94 and 69 are FLOORS, not choices — below them Default
  par's and Note's own one-word headers start to ellipsise.
  **`MEASURE A TITLE AS RENDERED` COST A PASS HERE TOO.** A header label WRAPS,
  so `scrollWidth − clientWidth` on it reports 0 however badly a single word is
  ellipsised — each line truncates inside a box that never overflows. Measure
  the widest WORD with a probe appended INSIDE the header button, where it
  inherits the 12px and the `tracking-[0.12em]`; a clone parked on `body`
  reported "Default" at 49.3px against a real 62.5 and said everything fitted.
  Widths key bumped to **v3**, or a stored width would keep a 90px Shop column
  with a 34px chevron in it.
  **Verified on a standalone replica of this table**, not on the screen: the
  browser pane is signed out behind the shared-device lock (097), so the real
  `/items/[id]` is out of reach from here. The replica serves the DEV SERVER's
  own compiled stylesheet to a static page carrying `DataTable`'s exact markup
  and `colWidth`'s exact percentages, which is what makes `.mac-switch` measure
  40px and the content column land on 1137 at 1440 and 977 at 1280 — the two
  numbers this table's own notes already record. **Walk it on the real screen
  when the pane can sign in.**
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
- **A VENDOR'S NAME IS EDITABLE, AND SO IS ITS CONFIG AT A SHOP IT HAS NONE
  AT** (Mark, 2026-09-08, both while adding a trash-collection vendor "so I can
  record an invoice and send it to quickbooks"). Two holes on one screen, and
  the second is the one that blocked him.
  **`VendorTitle`** is `ItemTitle`'s shape — the `h1` as an `InlineValue`,
  keeping the DOTTED UNDERLINE where every other editable field wears a box,
  which is that convention's one exception and not an oversight. The name had
  been plain text since the screen shipped, so `NewVendor` could file a typo
  nothing could correct. Both titles now pass an `ariaLabel`; without one they
  announce the raw column ("name"), the record's heading being the one cell with
  no `<dt>` beside it.
  **`VendorLocationsTable` LISTS EVERY SHOP, NOT EVERY ROW** — the Active cell
  holds the toggle where the vendor is set up and **Use here** where it is not,
  which is `ItemLocationRows`' rule and its wording. It had rendered only the
  rows that EXISTED, so a vendor created in the app read "Not configured at any
  location yet" with nothing to press — and since 083 every QuickBooks mapping a
  bill needs lives on that row, so such a vendor can be invoiced and never
  pushed. **Nothing was missing but the door**: 001 has had the insert policy all
  along, and all 56 rows at DF01 came out of the FileMaker load — design rule 1's
  lesson again, "a create that a loader also performs is a create nobody has
  tested".
  It enumerates the ACTIVE shops PLUS any shop that already HAS a row: you do
  not start using a vendor at a shop that is shut, but a row that exists at a
  closed one is real config and listing only the active shops would hide it.
  **That is a latent fault in `ItemLocationRows`**, which maps over the active
  list alone. The expansion — the rep and the three QuickBooks pickers — says
  the shop is not set up yet rather than rendering an empty form somebody would
  type into, since every one of those is a column on a row that does not exist.
  Removing a shop is the Active toggle, deliberately: "Use here" is one-way,
  exactly like "Stock here".
  **Don't name the handler `useHere`** — any `use` prefix reads as a hook to
  `react-hooks/rules-of-hooks`, which then refuses it inside the click handler.
  Walked live on Action Sales and left byte-identical: the name round-tripped
  through the `h1`, ONLINE went from "Use here" to a real row whose account
  number then wrote, and both were confirmed in the database before the row was
  removed with a one-off service_role script (never committed).
- **THE THREE PURCHASING LISTS FILTER BY VENDOR, AND SEVERAL AT ONCE**
  (`lib/vendorFilter`, Mark, 2026-09-08: "a picklist of vendors to the order
  guide, purchase order, and invoice list… selecting multiple options should be
  allowed"). A `ui/PickSet` in each filter row; empty means every vendor.
  **IT FILTERS BY NAME, NOT BY ID**, which is `/sales` picking its shops by CODE
  and for that decision's two reasons. A name IS its own label, so a vendor you
  have chosen can still be NAMED — and unticked — on a day the window holds none
  of its rows; an id would leave the trigger reading a uuid, or force the
  selection to be dropped, which silently widens the view at the moment you
  narrow the window. And it keeps the URL legible and the three session cookies
  small, where uuids cost 37 bytes each against a 4KB budget the guide already
  shares with its search term. Known cost, and both halves fail by showing MORE
  rather than fewer rows: two vendors sharing a name filter as one (038's
  reasoning — there is deliberately no unique index on `vendors.name`), and a
  rename drops out of a selection made before it.
  **REPEATED PARAMS, NOT A COMMA-SEPARATED VALUE** (`?vendor=A&vendor=B`), so a
  name holding the separator needs no escaping scheme — "Smith, Jones & Co" is a
  name somebody will eventually type. That cost `urlFilterParams` one change:
  **a repeated key now becomes an ARRAY**, which is what `RawSearchParams` has
  always been typed for and what Next's own searchParams do. It kept only the
  FIRST until now, and a fixture pinned that as "matching Next's own arrays",
  which it was not — every other reader collapses through its own `one()`, so
  the change reached none of them, and without it a Back press came home
  narrowed to one vendor.
  **A CHOSEN VENDOR IS ALWAYS IN THE PICKER, at 0**, even when the view holds
  none of its rows. Dropping it takes the control off the screen while it is
  still narrowing the list — an empty table, and nothing to untick.
  **THE COUNTS ARE CONDITIONED ON THE OTHER CONTROLS AND NEVER ON THEMSELVES**,
  which is `lib/filterMenus`' rule: each list computes a `beforeVendor` set
  (status/tier, aging, search) that the options are counted over, or every
  vendor but the chosen one would read 0. The guide runs it the other way too —
  **the tier counts DO narrow with the vendor filter**, where they deliberately
  ignore the search box, because a vendor selection is a standing scope with a
  control on screen naming it: while you walk one supplier's shelf, "230
  favorites" is a count of a walk you are not doing.
  **ON THE GUIDE IT NARROWS THE LIST AND NOTHING ELSE.** `totals` is
  `vendorTotals(rows, entries)` over the UNFILTERED prop, so the vendor totals
  bar and Generate POs are untouched — a filtered walk can never quietly produce
  a partial order or read as under a minimum it has met.
  Verified live at 1440 on all three: the PO list's picker offered 19 vendors
  with counts and a find box, ticking BakeMark and Chefs Warehouse gave 23 of
  148 orders (13 + 10) with the other vendors' counts unmoved, and **Back from a
  PO came home with BOTH still selected** — which is the `urlFilterParams` fix
  and would have restored one before it. The bill list's seven vendors
  correctly get NO find box; the guide's ten do, and BakeMark took the walk from
  514 lines to 21 with every line reading BakeMark and the shop's own section
  bands intact.
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
  **THE BOOK KEEPS THE TAB, AND IT IS THE DEFAULT** (Mark, 2026-09-05: "is it
  possible to stay on the current tab when using the navigation buttons…
  currently the page resets to the first tab", then "make this standard
  behavior for any page with tabs on current and future pages"). `RecordNav`
  carries `?tab=` unless told otherwise (`RECORD_NAV_CARRY`), so a tabbed record
  gets this BY EXISTING and no caller passes anything — which is what makes it a
  standard rather than a checklist item. **The contract it rests on: every
  tabbed record names its tab `tab`** (`parseVendorTab`, `parseEmployeeTab`,
  `parseRecipeTab`, `parseOrderTab` all read that key). Keep doing that; a
  record whose view also lives under another key passes `carry` with both.
  `carryQuery` in `lib/recordSet` overlays the named keys from the URL you are
  standing on onto the four published hrefs and NOTHING else: `from`/`fromLabel` stay the list's, so paging never rewrites
  where Back goes; and a key absent from the current URL is REMOVED, since the
  default tab writes none. Fixture-pinned. Verified live: Amoretti → Bills →
  Next landed on BakeMark's Bills at "4 of 29", crumb still Vendors.
  Known gap, not fixed: `ScrollMemory` keys on pathname without the query, so
  all five tabs share one scroll position — `useScrollMemoryKey` is how the
  order guide solves exactly that.
