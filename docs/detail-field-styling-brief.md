# Detail field styling — the boxed-field convention

**Status: proven on `/special-orders/[id]` and ROLLED OUT to every detail
screen in the app (2026-08-28).** Mark: *"The experiment is successful and I
want to go through the app and update all detail pages in this way."* §9 records
what each screen carries, what was deliberately left alone, and what the rollout
itself taught.

Read this before restyling a detail screen. It carries the rules, the mechanism,
and — the part worth the file — the traps, each of which cost a round trip to
find and every one of which is invisible in code review.

---

## 1. The problem it solves

Mark, 2026-08-28, on the special-order record:

> I'm having trouble distinguishing editable from non-editable, and fields from
> labels. The page just looks like a lot of text.

A detail screen is a `dl` of small-caps grey labels beside black values, where
an editable value wears a **dotted underline** and a read-only one wears
nothing. That underline is the quietest possible "editable" and it is right in a
dense table, where the column heading and the rules already say where a field
begins and ends. On a record it is not enough: there is no grid, the labels and
the values are both just text, and the underline marks only the LAST line of a
wrapped value.

## 2. The rules

1. **A box means "you can change this."** Every editable field on a detail
   screen wears a hairline box. A read-only value wears none. That is the whole
   distinction being drawn, so it is the one thing never to blur — if a
   `READ_ONLY_VALUE` grows a border, the screen stops answering the question.
2. **The underline comes off with the box.** Two cues for one fact, and the
   second reads as an artefact.
3. **One height: 36px** (`min-h-9`) — the app's own field height, every
   control, every kind, including the buttons beside them.
4. **One width: the track — and the track has a CEILING.** A field fills its own
   grid column, so a block's fields share a left and a right edge; and the block
   itself takes at most half the content column, a quarter on a record with few
   short fields. See §5.
5. **An empty field is empty.** No em dash, no example text.
6. **A multiline field keeps its 64px floor** (`min-h-16`) — the box says
   "editable", the height says "put a paragraph here", and only notes want the
   second.
7. **Yellow is a fill, never ink.** See §7.

### Why 36px, and the wrong turn on the way

`h-9` is the app's OWN field height — `TextInput` says so in its own comment
("h-9 is the app's field height — `TabPicker`'s cells and `PickList`'s"), and
every button is `h-9` too. So a boxed field, a command button, a filter tab and
a form input are one height everywhere. Mark, given the choice: *"whatever would
make for a consistent look app wide."*

**It shipped at 32px first, on a prediction nobody measured**, and the
correction is worth keeping because the reasoning was plausible: the
special-order Info tab is four quadrants measured to one screen, nine rows a
column, so 36px "would add ~68px per column and push the scrolling panes into
scrolling sooner". Measured, the layout absorbs it almost entirely — the panes
that scroll are exactly what gives way. The Completion dates pane went **160px
to 152px**, and the page's own scroll 100px to 103. On a 21-line order the table
grew ~5px a row.

What 32px cost instead was the thing the boxes exist for: 23 fields at 32px
sitting under 8 command buttons at 36 is a near-miss rather than a contrast —
exactly the class of difference the boxes had just made visible. At 36 the
screen measures ONE height, 190 controls of it.

`h-8` is still a real member of the scale — it is `TabPicker size="sm"`, "for
tight bands like the receiving screen's". A record is not a tight band.

### Why the track and not a width scale

Mark asked whether a predetermined set of widths would keep pages coherent. The
`dl` already defines them: every field fills its own column, so alignment is
free and there are no numbers to keep in step. A scale would be a second system
saying the same thing, and the first field sized `md` in a `lg` track would be
misaligned again with nothing on screen explaining why.

**The exception is a field in a `justify-between` row**, where the container is
shrink-to-fit and there is no track to fill — see the money block, §5.

---

## 3. The mechanism

`components/ui/fieldMetrics.ts` is the single dress:

| export | what it is |
| --- | --- |
| `BOXED_FIELD` | `min-h-9 w-full` — one height, fills its track |
| `BOXED_FIELD_BORDER` | `border border-hairline hover:border-ink` |
| `BOXED_FIELD_TALL` | `min-h-16 w-full` — the multiline floor |
| `EMPTY_FIELD_DASH` / `fieldPlaceholder()` | suppresses the em dash on a boxed field |
| `BOXED_FIELDS` | the app-wide switch |

Four controls understand `boxed`, and **all four must get it** or a page boxes
its typed fields while its pickers and dates stay underlined, which reads as
those not being editable:

- `catalog/InlineValue` — `kind` text · number · pick · date · time, and `multiline`
- `ui/PickList` — `variant="inline"` only
- `ui/DateField` — `variant="cell"` only
- `ui/TimeField` — `variant="cell"` only

`InlineValue` hands `boxed` down to the other three, so **a caller normally only
touches `InlineValue`.**

### The switch

`BOXED_FIELDS` lives in the same module and is **app-wide** (Mark, 2026-08-28).
It began as one constant in `components/specialOrders/fieldLook.ts` while the
look was an experiment on one record; that file is gone. It stays a switch
rather than being inlined for the reason it was one: a look this pervasive
should be judgeable and reversible in a single edit, not two hundred.

A caller inside a LIST passes `boxed={false}` deliberately rather than reading
it — see §9.

---

## 4. Converting a screen — the recipe

1. **Find the read-only gate.** Some screens wrap every cell in a local `Cell`
   component (`SpecialOrderDetail`, `CustomerDetail`, `InvoiceDetail`,
   `OrderTotals`, `OrderDelivery`); most branch inline on `canWrite` with
   `READ_ONLY_VALUE`. **A gate is the cheap seam** — one default boxes the whole
   screen. If a screen has none and has more than a handful of cells, add one
   first; it pays for itself immediately.
2. **Pass `boxed` to every editable cell.** Never to the read-only branch (the
   one exception is a multiline note — see §6).
3. **Make each field's container definite-width.** `w-full` needs something to
   resolve against; see the traps.
4. **Remove em-dash and example placeholders** on boxed fields.
5. **Set the block's gaps**: tight within a block, wide between blocks (§5).
6. **Convert `text-mark` to `bg-mark-fill`** (§7).
7. **Measure** (§8). Do not eyeball this — three of the traps below look
   correct in a screenshot.

---

## 5. Layout rules a boxed screen needs

Boxes make alignment legible, which means they also make MISalignment legible.
Everything here was invisible while the fields were underlined.

**Gaps group. Four columns are two pairs.** A record's blocks are often
two-track grids, so the reader sees four columns separated by three gaps — and
only the middle one is a change of subject. On the special-order Info tab:
**24px inside a block, 96px between blocks.** All three at 40px read as four
unrelated columns.

**A FIELD BLOCK TAKES AT MOST HALF THE SCREEN** (Mark, 2026-08-28: *"there are
two columns that span the entire screen. they should only span 1/2 at most …
`/elements/[id]` should probably only span 1/4"*). Underlined, a field block
running the width of a 1280px window was just text with a lot of air after it;
boxed, it is a 1,100px box holding the word "Purchased". The cap is written as a
**ceiling over a floor** —

```
max-w-[min(42rem,max(24rem,50%))]     /* half   — /items, /vendor-items       */
max-w-[min(46rem,max(32rem,50%))]     /* half   — /plans, a four-track grid   */
max-w-[min(28rem,max(17rem,25%))]     /* quarter— /elements                   */
```

— and both halves are load-bearing. The percentage resolves against the CONTENT
COLUMN, not the viewport, so it is genuinely "half the screen"; the `min()` stops
a very wide monitor turning half into something absurd; and the `max()` keeps the
fraction a CEILING rather than also becoming a floor. Without it, half of a
portrait iPad's content column is 385px, which a four-track grid divides into
~20px a field. Measured after: `/plans` 592px (46%) at 1280 and 512 (61%) at 834,
`/items` 592 (46%), `/elements` 296 (23%) at 1280 and 272 (33%) at 834, nothing
clipped at either width.

**A quarter needs a smaller label track.** `/elements` went `minmax(9rem,auto)`
→ `minmax(7rem,auto)` and `gap-x-6` → `gap-x-4` to buy its fields 166px instead
of 136. Its labels are one word each and measure 114px, so nothing wraps.

**A `justify-between` row has no track**, so `w-full` resolves to the value's
own width and an empty field collapses. Measured in the money block: 44, 49, 57,
and **14px** for an empty rate. Give those a definite width on a WRAPPER
(`block w-24`), never a `w-24` through `className` — `InlineValue`'s own
`w-full` is a competing width utility and Tailwind resolves those by stylesheet
order, not by the order of the class string.

**Let grid tracks size to content where the columns hold different things.**
`grid-cols-2` is `repeat(2, minmax(0, 1fr))`, so both columns take the width of
the wider. `md:grid-cols-[auto_auto]` gave the money block's inputs the room
they needed while the figures gave back what they never used: 505px → 483px.

**Anything hung beside a field breaks the column.** A suggestion, a unit, a
clear button. Put it after the LABEL instead — that side has room to spare and
the field column stays a clean stack.

**Two-line rows: put the whole gap on the lower row's floor.** Every cell in the
top row must keep the same padding-top or the first field sits lower than its
neighbours.

---

## 6. The traps

Each of these shipped, was measured, and was fixed. They will all recur.

**`inline-flex` wrappers eat `w-full`.** A shrink-to-fit parent gives a
percentage width nothing to resolve against, so the control comes out the width
of its VALUE. A boxed date sat at 144.5px in a row of 214.3px fields.
*Symptom: one control is short and nothing in its own classes explains it.*

**A fixed height clips a wrapping value.** `h-9` looks right until a short-text
cell wraps — the second line spilled 6px past its own border (scrollHeight 36,
clientHeight 30). Use `min-h-9`.

**The Sizer must wear whatever the resting state wears.** `InlineValue` holds an
invisible copy of the value behind the input so clicking a cell does not move
it. Change the resting look and you must change the sizer, including
`multiline`. *Verify: clicking a field moves it 0.00px in all four axes.*

**Row height comes from the tallest cell, and the slack falls under a
top-aligned field.** On the item row, a 36px `RowMenu` in a `py-2` cell needed
52px where the name cell needed 44 — so 8 of a 12px gap was slack, not padding,
and trimming padding could not reach half. *Symptom: a gap you cannot shrink by
changing the padding that appears to make it.*

**Suppress the em dash; do not blanket-suppress placeholders.** `TakenBy` puts
FileMaker's own name in the placeholder on 7,944 migrated orders with no
employee link. Blanking that deletes the only record of who took the order.
Compare against the default dash and suppress only that.

**A read-only multiline note keeps its box.** There the box is doing a second
job — without it the tab reads as headings with loose text under them.

**Two `<tr>`s per record row need a `<tbody>` per row**, not two bare rows:
`data-row-id` goes on the tbody so a drag measures both lines. Several tbodies
in one table is ordinary HTML and `useRowDrag` needed no change.

**The browser pane lies.** It goes hidden on its own, and while it is, every
`getBoundingClientRect` reads 0 and React never hydrates. Take a screenshot to
restore it, and check `innerWidth !== 0` before believing any geometry.

---

## 7. Yellow

`--color-mark` on white is **1.43:1** — not a legibility complaint, text you
cannot read. `bg-mark-fill` (yellow-200) with ink on it is **15.53:1**.

- A short mark is a **chip**: `bg-mark-fill px-1`.
- A tappable mark keeps its underline and inverts on hover:
  `bg-mark-fill px-1 text-ink underline underline-offset-2 hover:bg-ink hover:text-white`.
- **Red stays ink** — `text-accent` is 5.61:1 and needs no help.
- Check whether the fact is already marked elsewhere before marking it again.

**37 uses of `text-mark` remain app-wide** (measured 2026-08-28; two of them are
in `SpecialOrderDetail` and are prose in comments, and three in `PickList` are
the masthead dress, which is yellow on BLACK at 14.67:1 and correct). The real
ones cluster in production — `DerivedDay` (5), `PlanMatrix` (3), `SchedulesList`,
`PlansList`, `ProductionItemHistory`, `ScheduleLines` — plus
`specialOrders/CustomerPicker`, `CustomerStatement`, `SpecialOrdersList` and
`purchasing/InvoiceSummary`. Fix them as those screens are converted rather than
in one mechanical pass: each needs the judgement in this section (chip, tappable
chip, or already marked elsewhere).

---

## 8. What to verify, and how

Do not judge this by eye. The measuring script that caught everything above:

```js
// Every boxed field on the screen: are they one height, and does anything spill?
const isBox = e => { const c = getComputedStyle(e);
  return c.borderTopWidth === '1px' && c.borderTopStyle === 'solid'; };
const f = [...document.querySelectorAll('main *')].filter(e => {
  const q = e.getBoundingClientRect();
  return isBox(e) && q.height > 0 && q.height < 200
      && (e.tagName === 'BUTTON' || e.querySelector('input')); });
const heights = {}; for (const e of f) {
  const h = Math.round(e.getBoundingClientRect().height); heights[h] = (heights[h] ?? 0) + 1; }
({ fields: f.length, heights,
   overflowing: f.filter(e => e.scrollHeight > e.clientHeight + 1).length,
   boxedButNotEditable: f.filter(e => !(e.tagName === 'BUTTON' || e.querySelector('input,button'))).length })
```

The checklist:

- [ ] every field one height (36px) — and so is every button beside them —
      with nothing overflowing its box
- [ ] every block's fields share one left and one right edge
- [ ] no read-only value carries a box (except a multiline note)
- [ ] no em dash or example text in an empty boxed field
- [ ] clicking a field moves it **0.00px** in all four axes
- [ ] no page overflow, at 1280 and at a portrait iPad (~834)
- [ ] the screen still fits its measured layout if it has one (compare page
      height with the switch on and off — on the special-order record it was
      820px both ways)
- [ ] screens NOT converted are untouched (spot-check one: it should still have
      its dotted underlines)

---

## 9. The rollout — DONE, 2026-08-28

Every detail screen in the table below is converted. What each one carries is
recorded here so the next person can tell a deliberate omission from a miss.

| screen | converted | left alone, and why |
| --- | --- | --- |
| `/employees/[id]` | `EmployeeDetail` (16), `EmployeePayroll`, `AppAccess` | `EmployeeEvents`, `EmployeeBenefits` — `DataTable`s. `EmployeeDocuments` — its date lives inside a 176px `ui/DocumentChip`, which is a card and already has structure doing the box's job |
| `/invoices/[id]` | `InvoiceDetail`'s Bill + Amounts (8, via the `Cell` gate's siblings) | its line table — a `DataTable` |
| `/purchase-orders/[id]` | `PurchaseOrderDetail` (3), `ReceivingRow` (2), `Receiving` (1) | the PO's line table — a `DataTable` |
| `/vendor-items/[id]` | `VendorItemFields` (10) | — |
| `/vendors/[id]` | `VendorFields` (5) | `VendorItemsTable`, `VendorLocationsTable` — `DataTable`s |
| `/items/[id]` | `ItemFields` (2), `BaseUnitEditor` | `ItemLocationRows` — a `DataTable` |
| `/elements/[id]` | `ElementFields` (6) | `ElementLocationRows` — a `DataTable`. `ElementNameCell` — an `h1` |
| `/recipes/[id]` | `RecipeInfo` (via its `Editable` gate) | `RecipeVersionSheet`, `RecipeScaleCell` — the ingredient GRID, which has headings and rules of its own |
| `/batch-logs/[id]` | `BatchFields` (8), `BatchVersionCell`, `BatchLogRecord` (1) | `BatchItemsTable` — a `DataTable` |
| `/plans/[id]` | `PlanDetail` (5) | `PlanMatrix` — a `DataTable`; its yellow was fixed |
| `/production-items/[id]` | `ProductionItemFields` (3) | `ProductionItemLocations`, `ItemComponents` — `DataTable`s |
| `/locations/[id]` | `LocationDetail` (3), `OperationsFields` (3), `AddressFields` (1), **`OperatingHours`**, **`ProductionMapping`** | — |
| `/customers/[id]` | `CustomerDetail` (via its `Cell` gate) | — |
| `/schedules/[id]` | `ScheduleDetail` (1) | `ScheduleLines` — a `DataTable`; its yellow was fixed |

**The line drawn, and it is the one §9 already drew:** a `dl` of fields gets
boxes, a table does not. Every "left alone" above is a `DataTable` or something
that already has column headings and rules doing the box's work. That rule also
answers the cases the inventory did not name, because the inventory was built
from `InlineValue` call sites and two editable controls on a converted record
are not `InlineValue`s — see the two bonus conversions below.

### The four things the rollout added to this brief

**AN EDITABLE `h1` TITLE WEARS THE BOX** (Mark, 2026-08-28: *"box the h1 titles
too"*). It shipped underlined on the argument that a hairline box round 28px
uppercase reads as a frame rather than as a field — true of the frame, and
beside the point about the reader. The title is editable on FOUR records
(`/items`, `/plans`, `/elements`, `/locations`) and plain text on every other,
so without the box the only thing telling those apart was a dotted rule under a
heading, which is exactly the cue that was not enough anywhere else.

It **hugs its own text** rather than filling a track: `w-full` in the
shrink-to-fit flex row the title shares with its Active toggle resolves to the
content width, which is right here — a title has no column to share. Its box
comes out ~41px rather than 36, because 28px type has a taller line box than
`min-h-9`, and the Sizer wears the same dress so a click still moves it 0.00px.
`items-baseline` on those rows became `items-center`: boxes line up by their
edges, not by the text inside them.

**A CONVERTED SCREEN'S OTHER EDITABLE CONTROLS COME TOO.** `/locations/[id]`
carries two that are not `InlineValue`s and so are not in the inventory:
`OperatingHours`' fourteen `<input type="time">` (which already wore a box, at
30px, so they read as a different KIND of control beside the 36px fields two
blocks down) and `ProductionMapping`'s seven `PickList`s (which wore none at all
and so read as not editable). Both now match. **Check a screen for controls the
`InlineValue` grep cannot see before calling it done.**

**A BLOCK'S TRACK IS A FACT ABOUT THE SCREEN, NOT ABOUT THE BLOCK.** The
employee record's Employment block was `max-w-md` with `8rem` labels and Payroll
directly beneath it was `max-w-2xl` with `10rem` — invisible underlined, and two
different left AND right edges once boxed. Payroll took the block above it. Same
argument retired the Info tab's lone `max-w-2xl` Notes field.

**A STAND-IN WORD IS EXAMPLE TEXT AND GOES.** `fieldPlaceholder` suppresses only
the em dash, so `placeholder="none"` / `"unknown"` / `"still here"` / `"not set"`
had to be removed by hand — about 25 of them. Two kinds were KEPT and the
distinction is the one §6 draws: a placeholder holding real DATA
(`locations.public_name` shows the internal name a customer would otherwise
see), and the three hints in `VendorItemFields`' Package row, where ONE label
sits over THREE boxes and "1 × size unit" is the only thing on screen saying
which is which.

**Lists are a separate question and not covered here.** The convention is about
RECORDS. A `DataTable` already has column headings and rules doing the job the
box does, and boxing every cell of a 790-row list is a different decision — the
special-order Items table was converted because it is part of a record, and even
there it is the busiest result. Decide list-by-list, and prefer leaving them.

### Verified

At 1280 and at 834 (portrait iPad), against the live database:

- Every boxed field on every converted screen measures **36px**, with the two
  legitimate exceptions the rules allow: a multiline note at 64, and a
  short-text cell whose value WRAPS (the employee address, 46px — `min-h-9`
  working as intended, and `scrollHeight === clientHeight`, so nothing spills).
- Each block's fields share one left and one right edge — measured per `dl`
  (vendors 160–688, items 192–720, PO 192–464, employees 384–688 on BOTH
  blocks, invoices 160–401 / 577–818 at 834).
- No read-only value carries a box. The employee's Sent-via/Cost-today/FileMaker-id
  rows and the location's Email-sending block all render bare.
- Clicking a field moves it **0.00px** in all four axes (checked on a text cell
  on `/vendors/[id]` and on `/employees/[id]`).
- **Zero horizontal page overflow** at either width on any converted screen.
- The special-order record — the reference — is unchanged: 31 controls, all 36px,
  page height 900 at 1280×900.
- A list is untouched: `/shop-sections`' cells still report
  `underline/dotted` and a `0px` border.
- 1309 fixtures pass; `tsc` and `eslint` clean.

### Known, and left

- **`/batch-logs/[id]`'s detail pane shows about three fields before it
  scrolls.** That pane was already scrolling before this (content ~230px in
  129px); boxing took the content to 352px. It is drag-resizable and the
  fraction persists, so a taller pane is one drag away — but it is the one place
  the height rule cost something visible.
- **37 → 20 uses of `text-mark` remain app-wide.** The ones on converted detail
  screens are fixed (`ElementFields`, `PlanDetail`, `ScheduleDetail`,
  `PlanMatrix`, `ScheduleLines`, `ItemComponents`, `ProductionItemHistory`,
  `BatchLogRecord`, `EmployeeDetail`'s and `EmployeeDocuments`' yellow-600,
  `CustomerStatement`). What is left is all on LISTS and on `/production-day` —
  `DerivedDay` (5), `SchedulesList`, `PlansList`, `RecipesList`,
  `BatchLogsIndex`, `ProductionItemsList`, `SpecialOrdersList`, `EmployeesList`,
  `GenerateSchedules`, `specialOrders/CustomerPicker`. Same rule, same
  judgement, when those screens are next touched.

## 10. Answered, 2026-08-28

- **One app-wide constant**, in `ui/fieldMetrics` (§3).
- **Lists stay as they are** — "lists are fine as is" (§9).
- **36px, not 32** — the app's own field height, measured rather than argued
  (see §2). This is the one thing already-converted code had to change.

Still open, and neither is about this convention:

- The special-order record scrolls ~103px at 1280x720. Pre-existing — measured
  identical with the boxes on and off — and never chased down.
- The record's command cluster (`OrderActions`) is `shrink-0` at 722px, so the
  page overflows below `md`. Also pre-existing, below the widths the app
  targets.
