# Detail field styling — the boxed-field convention

**Status: proven on `/special-orders/[id]` (2026-08-28) and adopted. Rolling out
to every other detail screen.** Mark: *"The experiment is successful and I want
to go through the app and update all detail pages in this way."*

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
3. **One height: 32px** (`min-h-8`), every control, every kind.
4. **One width: the track.** A field fills its own grid column, so a block's
   fields share a left AND a right edge.
5. **An empty field is empty.** No em dash, no example text.
6. **A multiline field keeps its 64px floor** (`min-h-16`) — the box says
   "editable", the height says "put a paragraph here", and only notes want the
   second.
7. **Yellow is a fill, never ink.** See §7.

### Why 32px and not the app's `h-9`

`TextInput`, `TabPicker` and `PickList variant="field"` are all 36px, and
matching them is the tidier answer on paper. It costs too much on a record: the
special-order Info tab is four quadrants measured to one screen
(`useExactViewportHeight`), nine rows a column, so 36px adds ~68px per column
and pushes the scrolling panes into scrolling sooner. 32px clears the tallest
natural control (a 30px date) with room for its border. **If a record is not a
measured one-screen layout, `h-9` is worth revisiting** — but prefer consistency
across records over local optimisation.

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
| `BOXED_FIELD` | `min-h-8 w-full` — one height, fills its track |
| `BOXED_FIELD_BORDER` | `border border-hairline hover:border-ink` |
| `BOXED_FIELD_TALL` | `min-h-16 w-full` — the multiline floor |
| `EMPTY_FIELD_DASH` / `fieldPlaceholder()` | suppresses the em dash on a boxed field |

Four controls understand `boxed`, and **all four must get it** or a page boxes
its typed fields while its pickers and dates stay underlined, which reads as
those not being editable:

- `catalog/InlineValue` — `kind` text · number · pick · date · time, and `multiline`
- `ui/PickList` — `variant="inline"` only
- `ui/DateField` — `variant="cell"` only
- `ui/TimeField` — `variant="cell"` only

`InlineValue` hands `boxed` down to the other three, so **a caller normally only
touches `InlineValue`.**

### The per-screen switch

`components/specialOrders/fieldLook.ts` exports `BOXED_FIELDS = true`, imported
by every call site on that record. One constant, so the look can be judged and
then kept, trimmed or reverted in a single edit rather than forty.

**For the rollout, promote this to one app-wide constant** rather than one per
module — the point of the convention is that records look alike. Keep the
indirection: it is what made the experiment cheap to evaluate, and it is how a
future "boxes off on this screen" gets answered.

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

**A fixed height clips a wrapping value.** `h-8` looks right until a short-text
cell wraps — the second line spilled 6px past its own border (scrollHeight 36,
clientHeight 30). Use `min-h-8`.

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

- [ ] every field one height (32px), and nothing overflowing its box
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

## 9. The rollout

~200 `InlineValue` call sites across 55 files. The detail screens, roughly in
descending order of how much they carry:

| screen | where the cells live |
| --- | --- |
| `/employees/[id]` | `EmployeeDetail` (16), `EmployeePayroll`, `EmployeeBenefits`, `EmployeeEvents`, `EmployeeDocuments`, `AppAccess` |
| `/invoices/[id]` | `InvoiceDetail` (14) — **has a `Cell` gate** |
| `/purchase-orders/[id]` | `PurchaseOrderDetail` (12), `ReceivingRow`, `Receiving` |
| `/vendor-items/[id]` | `VendorItemFields` (10) |
| `/vendors/[id]` | `VendorFields`, `VendorItemsTable`, `VendorLocationsTable` |
| `/items/[id]` | `ItemFields`, `ItemLocationRows` |
| `/elements/[id]` | `ElementFields`, `ElementLocationRows`, `ElementNameCell` |
| `/recipes/[id]` | `RecipeVersionSheet` (7), `RecipeScaleCell`, `RecipeInfo` |
| `/batch-logs/[id]` | `BatchFields` (7), `BatchItemsTable`, `BatchVersionCell` |
| `/plans/[id]` | `PlanDetail` (6), `PlanMatrix` |
| `/production-items/[id]` | `ProductionItemFields`, `ProductionItemLocations`, `ItemComponents` |
| `/locations/[id]` | `LocationDetail`, `OperationsFields`, `AddressFields` |
| `/customers/[id]` | `CustomerDetail` — **has a `Cell` gate** |
| `/schedules/[id]` | `ScheduleDetail`, `ScheduleLines` |

**Lists are a separate question and not covered here.** The convention is about
RECORDS. A `DataTable` already has column headings and rules doing the job the
box does, and boxing every cell of a 790-row list is a different decision — the
special-order Items table was converted because it is part of a record, and even
there it is the busiest result. Decide list-by-list, and prefer leaving them.

---

## 10. Open questions for Mark

- **One app-wide constant or one per module?** Recommend app-wide (see §3).
- **Do lists get this at all?** Recommend not, by default (see §9).
- **`h-9` instead of `h-8`** for records that are not measured one-screen
  layouts — consistency probably wins, but it has not been tested on a screen
  with room to spare.
- The special-order record still scrolls ~100px at 1280x720. Pre-existing
  (measured identical with the boxes on and off), never chased down.
