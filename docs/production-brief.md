# Production module — build brief

**Status: SPECCED 2026-08-07, not yet built.** Read `CLAUDE.md` first, then this.
Designed in conversation with Mark against the real FMP exports
(`FMP Export/Production/`), the FMP screenshots, and four real generated PDFs
from the night of 2026-08-06/07. Every measurement cited below was taken from
those files, not from memory.

Production is the heart of the operation: what to make and when, what things
cost to make, quality control and production efficiency. It is also the module
the Employee Events work already points at — the batch shift-log screen was
deferred here (build step 4e), and `ShiftReports.mer` carries the production
counts supervisors enter nightly.

---

## Terminology

Mark renamed the FMP tables for this design, and the two words that matter are
**plan** and **schedule**:

> A plan is what we propose to make at some point in the future, while a
> schedule is what we actually land on for a particular day.

| Term (use these) | FMP screen | What it is |
| --- | --- | --- |
| Production_Recipes | Recipes | Versioned document: how to make an element |
| Recipe_Items | Recipe Items | Ingredient catalog recipe lines reference — **merged away, see decision 2** |
| Production_Elements | Elements | What you *make or buy* — building blocks (Raised Dough, Strawberry Glaze) |
| Production_Items | Donuts | Finished goods you *assemble and sell* (King Puff, Fritter Seems Forever) |
| Production_Plans | Donut Schedules | Date-ranged menu for a location |
| Plan_Items | trays on a plan | One display tray; a slot per weekday pointing at Items |
| Production_Schedules | Prod Schedules | The committed make-list for one day, where actuals land |
| Production_Logs | Batch Logs | One record per making of an element: who, when, recipe + version, scale, yield |

"Items" unqualified always means Production_Items. Inventory items (purchasing's
catalog) are always written out in full.

---

## What the FMP version got right (preserve these)

Thirteen years of daily use: 14,103 batch logs, 17,843 generated schedules, 150
plans back to 2018. The *conceptual chain* — recipe → element → item → plan →
schedule → actuals — is the right model for a bakery. Specifically worth
keeping:

- **Elements as the unit of production.** Raised Dough is made once and feeds a
  dozen SKUs. A proper BOM/sub-assembly model; the module's best idea.
- **Recipe versioning done seriously.** Versions as rows, a master flag, author,
  testing notes, per-version change notes ("v09 scaled to 2000g"). Better than
  most commercial recipe software.
- **Scaling columns and baker's percentages.** TEST / ×½ / ×¾ / ×1 / % across
  every ingredient line, plus a % column, is real bakery workflow.
- **The batch log's data discipline.** It snapshots par and on-hand *at the
  moment of logging* (96%+ filled across 14k rows) — the ask and the answer in
  one record.
- **The tray × weekday matrix.** It models the physical display case the way the
  order guide models the physical walk.
- **The ingredient → vendor item mapping** (160 of 212 Recipe_Items mapped, with
  real vendor item keys). In FMP the cost froze at map time; in this app it goes
  live through purchasing.

## What it got wrong (the diseases, so the cure is legible)

- **Links by name.** Elements point at recipes by *name* — `recipeName_t` filled
  on 39% of elements, an actual key on 4%. Rename a recipe, the chain snaps
  silently.
- **Frozen costs.** Recipe item costs frozen at map date (rows still carrying
  their 1/30/2022 price in 2026); recipe costs, item costs all stored snapshots
  that quietly rot.
- **Four vocabularies for "a thing with a cost"**: Recipe_Items, Elements,
  vendor items, inventory items — plus "Manual" rows as a labor hack.
- **Metadata as rows.** Mixer Size, Expected Yield and Prep Time live as recipe
  *lines* with sort 100–102; `"---"` separators are data.
- **Packed repeating fields.** Element pars as `"12#12#12#15#21#18#"`,
  multipliers as `"13510"`, yields as `"2 QT6 QT10 QT20 QT%"`.
- **Pars in three places** (items, elements as free text, schedule snapshots)
  with no rule about which derives from which.
- **Numbered type prefixes** ("01 Donut", "05 Topping") — sort order living in
  the name; the shop-section prefix problem again. Plus literal duplicate rows
  (Candied Peanuts appears twice in Elements).
- **Materialized documents defended by ceremony.** Nightly generation plus
  exists-checks, overwrite warnings and a mislabeled "locked" flag, because a
  pre-generated document was the only place to store intent about a future day.

---

## Decisions (Mark, 2026-08-07 — do not relitigate)

### 1. A plan is a proposal; a schedule is a committed day

The vocabulary above is load-bearing. FMP called plans "Donut Schedules" and
that ambiguity confused even this design conversation until it was pinned.

### 2. Recipe_Items merges into Production_Elements

One component vocabulary. Each element is one of:

- **made** — has recipes (versioned, decision 3);
- **purchased** — linked to an *inventory item*; cost resolves live through
  purchasing's price resolution (design rule 6). Never linked to a vendor item
  directly: the inventory item is the stable identity, vendor items are sources.
- **manual** — labor and the like; a set cost per unit. The labor *rate* is org
  config (`orgs.settings`), not a wage — timesheets decision 1 (never store
  wage rates) is about payroll, not standard costing.

Both BOM layers — recipe ingredient lines AND an Item's dependency list — then
reference elements and nothing else. FMP's Recipe_Items with type "Recipe"
(sub-recipes) become made elements; type "Vendor Item" become purchased
elements; "Manual" becomes manual. The distinction FMP drew between the two
tables was accidental — two UIs built at different times, each with its own
component list.

### 3. Production_Recipes stay separate from Elements, versioned, linked by FK

Mark floated merging recipes into elements; the design conversation concluded
**no**, and the reason is version history. An element is a *node in the
production graph* (pars, schedule class, BOM edges, batch history); a recipe is
a *versioned document describing how to make it*. Ten versions of Strawberry
Glaze point at one element, and everything referencing the element survives
every reformulation untouched. Merging would thread version history through the
BOM. The actual fix for FMP's disease is cheap: element → recipe is a real FK,
never a name.

Versioning keeps FMP's shape (versions as rows, one marked master/current,
testing notes, author, per-version note) but the *family* gets its own row so
"the recipe" has a stable identity across versions. Yield, mixer size and prep
time become real columns on the version — never magic rows.

### 4. The Item taxonomy is operational, not descriptive

Type / subtype ("cut") / finish / size are **what the position guides group
by**: the Baker guide rolls the night up to type × subtype (what to cut), the
Fryer guide adds finish (what to prep), the Decorator guide goes to the named
Item. These are real vocabularies (pick lists, no numbered prefixes, sort
order stored separately), not free text. Price class and tier ride the Item
(decision 8).

### 5. Schedules are records at ITEM grain only; everything else is a rendering

The night's paperwork, measured against the real 8/7/2026 packet:

- **The Premade Schedule is the record**: per (date, selling location, kitchen),
  one line per Item — par at generation, tray tally, and the actuals columns
  (made / leftover). "Generated 8/6 by Leo, printed 8/7" — generation and
  printing are separate stamped acts, kept.
- **The Baker / Fryer / Decorator tray guides are renderings.** They carry no
  information of their own — the same night's schedule lines re-cut at three
  grains, "including special orders" by construction because they sum across
  every schedule live that night. Computed at print time, never stored.
- **The element sheets (donut / AB / weekly) are renderings too.** Element
  demand is derivation (item totals grouped by type ÷ recipe yield = batch
  size; weekly/AB lists are par-driven), and element *actuals* already have a
  home — the batch log, which snapshots par and on-hand itself. Supervisors
  used to hand-adjust element quantities on generated schedules, but only
  before pre-generation existed; with on-the-fly par overrides (decision 6)
  Mark's call is they'll never need to. If that ever changes, element-grain
  lines become records — that's the one assumption to revisit.

Consequence: FMP's seven per-artifact generator dialogs (the Skip/Continue
gauntlet) collapse into **one generation act** and a "print the night's packet"
that renders N PDFs from one dataset.

### 6. Date-scoped par overrides replace pre-generate-and-protect

FMP solved "bump Saturday's pars for the holiday without touching the plan" by
generating Saturday's schedule days early and defending it: exists-check, warn
on overwrite, and a "locked" flag that silently wins (Mark: "locked isn't the
right word… it's really just a way to say this is important and shouldn't be
overwritten"). The document was doing double duty as a place to store intent
about a future date, and the overwrite risk existed only because of that.

Instead: **a par override is its own small record** — (location, date, item,
par). The derived view folds it in; generation whenever it happens picks it up;
there is nothing to clobber. Generation's guard shrinks to the one honest case:
a schedule for that day/location already exists → warn and offer regenerate,
with a hard warning if it carries actuals, and **no silent replacement, ever**.

### 7. Generation is an explicit human act, including ahead-of-time

No nightly cron. Generation is part of the supervisor's closing routine — and
the generate dialog takes a start date, a number of days, and a location set
(FMP's does exactly this), because generating ahead is a real workflow: closed
days, long weekends, a supervisor who won't be in. Ahead-generation composes
with overrides instead of conflicting with them.

Printing renders client-side PDFs the way PO processing does — the stored
lines and the printed page are the same document, and reprinting is free.

### 8. Actuals: item counts on schedule lines, element batches in the log

- **Item actuals** (made / leftover) are entered at end of night on the
  schedule's lines, *inside the shift report* — the same sitting where
  supervisors enter ratings, sales and tips. This is the other half of the
  batch shift-log screen deferred from build step 4e; they are one build.
  `sold` is derived (made − leftover), never stored.
- **Element actuals** are batch logs, essentially as FMP has them: element,
  location, operator, recipe version, scale, on-hand before, yield, status,
  notes, photo (Storage, the `po-attachments` idiom). The log continues to
  snapshot par and on-hand at the moment of logging.

### 9. Kitchen lives on the PLAN; multiple plans are concurrently active

Mark's brief flagged where-made vs where-sold as a known FMP mistake (it lived
on the Location table). The fix: a plan is
**(selling location, kitchen, date range, trays)**, and — lifting FMP's
one-active-schedule limit — several plans for one shop may be active at once.
Mark's example: DF01 makes DF02's raised donuts while DF02 keeps its own cake
donuts — two DF02 plans, one per kitchen, and the sum is the shop's menu.

- A shop's effective menu on a date = **union of its active plans**.
- Generation groups the union by kitchen: DF02's schedule is everything made
  *for* DF02; DF01's kitchen paperwork aggregates what DF01 makes for every
  shop it serves (the `KITCHEN:` header on the real PDFs, now derived).
- **Overlap is a generation-time warning, not a constraint** — overlapping
  dates are now the point, so "King Puff appears in two active DF02 plans;
  pars will sum" is named and lets you through (the under-minimum-vendor
  pattern).
- The plan editor edits one plan; a read-only **combined view** per shop
  overlays the active plans so the whole display case is visible in one matrix
  (that view is what shows tray 07 empty on Tuesdays).
- `locations.kitchen_by_weekday` / `shops_for` (migration 017) become
  **vestigial for production** once this lands. Do not maintain two answers to
  one question; retire them from the Location record when this module ships.

### 10. Prices: org-level tier grid, sparse location overrides, item override on top

Measured on `Production_Item_Prices.mer` (125 rows = 8 price classes × 5 tiers
× 4 locations): **DF01, DF02 and DF03 are byte-identical on all 40 cells; only
EVENT differs** (its Regular class carries the Event-class prices). FMP's
per-location copies exist only because FMP had no inheritance — three shops
hand-maintaining the same 40 numbers. Mark's motive (a California shop and an
Arkansas shop shouldn't share prices) is exactly what the app's cascade idiom
already handles.

So, mirroring `vendor_items.price` → `vendor_item_location_prices`:

- an **org-level grid**: (price class × tier) → price (~40 rows);
- **sparse per-location overrides** of grid cells (EVENT's handful today; the
  Arkansas shop's set the day it exists);
- **per-item-per-location price overrides** stay (FMP's Price Overrides portal)
  for the one-off exception.

Resolution: item-location override → location's grid override → org grid.
A tier price change reprices the whole menu in one edit — the point of tiers.
Price classes (Regular, Wholesale, Mini, Giant, Letter, Special, Delivery,
Event) and tiers 1–5 are vocabularies, editable, not schema.

### 11. Costing is derived live; snapshots only on documents

Cost flows through the graph at read time: purchased element → inventory item →
effective vendor price (design rule 6, including location overrides); made
element → its master recipe version's lines; item → its BOM. No stored
recipe cost, no stored item cost, nothing to go stale — the 2022-price disease
cannot recur. Snapshots happen exactly where a document needs them: a generated
schedule line may carry the cost of the day (open question 3), a batch log may
stamp the batch's cost. The unit-conversion brains are `lib/units.ts`, already
built and fixture-tested.

### 12. Special orders are a seam, not a feature

Special orders (unbuilt module) inject production the same way FMP's do: they
become additional schedules for the night, and every roll-up sums across
sources by construction. Schedule headers carry a `source`
(plan | special_order | manual) from day one so that module can plug in without
schema surgery. The generate dialog's "ignore special orders" toggle survives.

---

## The data model (sketch — migrations get designed at build time)

Naming per the table-naming convention: junctions by endpoints, workflow tables
by business concept.

- **`production_elements`** — the merged component catalog. `kind`
  (made | purchased | manual), name, type (vocabulary, sort separate), active,
  `inventory_item_id` (purchased only), manual cost fields (manual only),
  stock-up par for weekly/AB-class elements as **count × container size**
  (the batch log's own shape — never free text), schedule class.
- **`production_recipes`** — the family: element FK (NOT NULL), name, type.
  **`production_recipe_versions`** — version rows: number, author, note,
  description, yield (amount + unit), mixer size, prep time, shelf life,
  storage, tools, testing notes, is_master, is_active.
  **`production_recipe_lines`** — version FK, element FK, qty, unit, %,
  sort, note, section. **`production_recipe_steps`** — version FK, sort, text.
  Scale columns are computed at render, not stored.
- **`production_items`** — name, taxonomy (type / subtype / finish / size),
  price class, price tier, active.
  **`production_item_locations`** — per-location config: `par_by_weekday`
  (the 009 seven-slot array idiom), active, price override.
  **`production_item_elements`** — the BOM edge: item FK, element FK, qty, unit.
- **`production_plans`** — org, selling `location_id`, `kitchen_location_id`,
  start/end dates, title, active.
  **`production_plan_trays`** — plan FK, tray number, row/tier label.
  **`production_plan_tray_items`** — tray FK, weekday, item FK (a slot may
  hold several items; usually one).
- **`production_par_overrides`** — org, location, date, item, par. Decision 6.
- **`production_schedules`** — org, date, selling location, kitchen, `source`,
  generated_by/at, printed_at, note.
  **`production_schedule_items`** — schedule FK, item FK + name/taxonomy
  snapshot, par (as generated), made, leftover, note.
- **`production_batches`** — the batch log: org, element FK, location, date,
  batch number, operator (employee FK), recipe version FK, scale, on-hand
  (count × size × unit), yield, status, notes; photo via a Storage bucket
  (018's idiom). FMP's `Batch_Size/Temp/Time/RecipeName` columns are dead
  (0% filled) and do not migrate.
- **Price grid** — org-level (class, tier) → price plus a location-override
  table keyed (class, tier, location) with no surrogate id, per
  `vendor_item_location_prices`.

RLS: org-scoped membership reads throughout (production is operational, not
HR-sensitive); writes purchaser+ or supervisor+ where the shift-report surface
needs it — decide per table at build time, and note the supervisor role
exists precisely for shift-report-class writes (020).

The **derived daily view** (plans ∪ par overrides → per-item pars per
location/kitchen/date; BOM roll-up → element demand and batch sizes) is the
order guide's architecture: a view or server-side computation, never a
materialized table (design rule 4). The schedule record is its committed
snapshot — the guide → PO split exactly.

---

## Migration notes

### Export status (measured 2026-08-07; corrected same day against the DDR)

The eight exports taken so far are **full table exports, verified**: their
column counts match the DDR's field counts exactly, minus container fields,
which .mer cannot carry (TRAYS 25=25, DONUTS 48=48, ELEMENTS 39=39, LOGS
37=37, Recipes 55 vs 54 = the Picture container, BatchLog 40 vs 39 likewise).
An earlier draft of this brief called four of them layout exports — **wrong**;
what's missing is not fields but *entire child tables that were never on the
export list*.

The authoritative census is the Database Design Report at
`DF Operations/DF Operations FMP Database Design/` (its Tables section lists
every base table with field and record counts — the way to be sure no related
table is missed, now and for every future module). Per that census,
**DF-Premade-Production has 23 base tables (8 exported) and DF-Recipes has 3
(2 exported)**. Still needed, with record counts as of the 2026-07-19 DDR:

| Table (file) | Records | What it is |
| --- | --- | --- |
| ITEMS (Premade-Production) | 29,083 | The tray day slots (`Trays_Items_Day1…Day7`) — the plan matrix content |
| DEPENDENCIES (") | 408 | The Item → Element BOM (the Dependencies portal) |
| DONUT_PARS (") | 316 | Item pars |
| ELEMENT_PARS (") | 60 | Element pars |
| PRODUCTION (") | 1,201 | Element schedule rows (the element detail's Schedule tab) |
| LOG_PREMADE_ITEMS (") | 199,258 | Premade schedule lines — **seven years of made/leftover/sold actuals**, and the Item screen's two-week history |
| LOG_DONUTPROD_ITEMS (") | 61,778 | Donut schedule lines |
| LOG_WEEKLYPROD_ITEMS (") | 27,970 | Weekly schedule lines |
| LOG_ABPROD_ITEMS (") | 87,351 | AB schedule lines |
| PRICES (") | 17 | Per-item price overrides (the Price Overrides portal) |
| DONUT_YIELDS (") | 22 | Likely the batch-size denominators — see open question 1 |
| RecipeElements (Recipes) | 8,141 | **The recipe lines** — ingredients AND procedure steps (`Recipes_RecipeIngredients` / `Recipes_RecipeProcedures`) |

Unclassified, ask Mark whether they matter: SALES (32 fields, 198 records) and
DisplaySigns (25 fields, 86 records) in the Premade-Production file.

Export procedure for a table with no layout of its own: New Layout on that
table occurrence (blank, no fields needed) → Records > **Show All Records** (a
stale found set silently truncates the export) → File > Export Records >
Merge → in the field picker switch from "Current Layout" to the table itself →
Move All. Container fields (batch photos) never export via .mer; recovering
them would take a FileMaker script writing container contents to files, and is
probably not worth it.

### Transform traps already identified

- **Element → recipe links are by name** (39% name, 4% key). Resolve by name
  match at transform, report every miss by name; do not guess.
- **Packed fields**: element pars `"12#12#12#15#21#18#"` (slot n = weekday n),
  multipliers `"13510"`, yields `"2 QT6 QT10 QT20 QT%"` — all repeating-field
  concatenations to unpack.
- **Strip numbered type prefixes** ("01 Donut" → "Donut", sort stored
  separately) — and check for collisions BEFORE writing, the
  `strip-section-prefix.mjs` lesson.
- **Duplicates**: Candied Peanuts is two element rows; expect more; merge with
  a report, don't load both.
- **Frozen costs are discarded**, not migrated — live resolution replaces
  them. The Recipe_Items vendor mappings (160 rows with `_VendorItemKey`)
  become purchased elements' inventory-item links by resolving through
  `vendor_items.legacy_id` → its inventory item.
- **Operators**: `__OperatorID` in the batch log joins `employees.legacy_id`
  (the Events migration already proved this join).
- Element pars stored as free text ("6x 1.5 GAL", "10 BAGS") parse to
  count × size × unit; refuse and report what doesn't parse.
- The EVENT location is real in this data (plans, prices) — it exists in
  `locations` as the virtual location; nothing special needed, but don't
  filter it out.

### What this module makes vestigial

`locations.kitchen_by_weekday` and `shops_for` (017) — superseded by
kitchen-on-plan. Retire from the Location record UI when this ships.

---

## Build phases (suggested, in dependency order)

1. **Elements + Recipes** — the merged catalog, recipe families/versions/lines/
   steps, live cost resolution through purchasing, recipe PDF. This is the
   half that works standalone (the kitchen binder, costed).
2. **Items** — taxonomy vocabularies, BOM edges, per-location pars, the price
   grid + resolution. Item screen shows live cost vs price (the cost/profit
   figures FMP computed frozen).
3. **Plans** — the tray × weekday matrix editor, kitchen on the plan,
   concurrent plans, the combined per-shop view.
4. **Schedules** — the derived daily view, par overrides, generation (with
   ahead-of-time), the printed packet (schedule + baker/fryer/decorator
   guides + element sheets as PDFs).
5. **Actuals** — made/leftover entry on schedule lines (the shift-report
   surface, joint with 4e's deferred batch screen), batch logs with photos,
   the two-week history on the Item screen.
6. **History load** — once the re-exports exist: plans, schedule actuals
   history, batch logs. Interleave with phases as exports arrive; nothing in
   phases 1–5 depends on history being loaded first.

Each phase is separately shippable; 1–2 deliver value (costed recipes) before
any scheduling exists.

---

## What NOT to build (settled during design)

- **No nightly cron / automated generation.** Generation is a human act in the
  closing routine (decision 7).
- **No stored recipe/item costs** outside document snapshots (decision 11).
- **No element-grain schedule lines** unless the hand-adjust need returns
  (decision 5's one revisit point).
- **No "locked" flag.** Par overrides + the never-silently-replace guard
  cover both of its jobs (decision 6).
- **No tablet actuals UI in v1** — paper stays; the model is
  tablet-ready (the same lines take input directly) but the kitchen isn't.
- **No Square/sales integration** — `sold` is derived from made − leftover;
  a POS feed is a future refinement, leave the seam.
- **Special Orders is its own future module** — only the `source` seam ships
  now (decision 12).

## Open questions (pinned — ask Mark, don't guess)

1. **Batch-size semantics.** The guides print e.g. "VANILLA TOTAL: 54 /
   BATCH SIZE: 1.05" and "RAISED TOTAL: 300 / BATCH SIZE: 0.60". Confirm the
   exact formula (presumably day's total ÷ yield, rounded how?) and which
   yield it reads — the DDR shows a **DONUT_YIELDS table (22 rows,
   `Logs_PremadeItems_Yields`)**, so the denominators are likely per-type
   yield rows there rather than recipe yields. Export it and check before
   building the roll-up.
2. **Tray tally boxes.** The printed schedule renders pars as runs of 6s/24s
   across numbered boxes (trays of 6 for premade, 24s for the baker guide).
   Confirm the box-size rule (per type? per size?) so the PDFs reproduce
   faithfully.
3. **Does a generated schedule line snapshot its cost?** The FMP premade
   schedule shows a day cost and wholesale total. Cheap to stamp at
   generation; decide whether it's wanted or noise.
4. **Wholesale flow.** Items carry wholesale pricing and the FMP schedule
   totals a wholesale figure. Is anything operational hanging off it today
   (standing wholesale orders?), or is it informational until Special Orders?
5. **Shift-report surface ownership.** Phase 5 here and build step 4e's
   deferred batch screen are one surface. When production counts move into
   this app, do ratings entry and tips entry ride along in v1 of that screen,
   or does it start production-only?
