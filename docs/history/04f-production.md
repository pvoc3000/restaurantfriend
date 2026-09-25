<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4f. 🚧 **Production** — specced 2026-08-07; **ALL FIVE PHASES NOW BUILT**
   (036–044; **044 NEEDS APPLYING**, everything before it is applied).
   *Probe, don't read this line* — it has been wrong in both directions for four
   different migrations. Read **`docs/production-brief.md`** before
   designing or touching anything here — the whole design was settled in
   conversation with Mark and the brief carries the decisions, the migration
   traps, and what the exports actually say.
   **Mark's six open questions are ANSWERED** and recorded in the brief: batch
   numbering seeds at **30,000**; the batch-size rule is his (a regular donut is
   **1/340** of a batch, mini ⅓ of a regular, giant 2×) which DISAGREES with the
   stale `_yields.mer` export and so ships as **editable data, never a
   constant**; a generated schedule line DOES snapshot its cost; wholesale stays
   informational; the WHOLESALE pseudo-location's pars are skipped with a
   report; and **the shift-report surface is deferred ENTIRELY** — phase 5's
   item actuals go on the schedule's own screen and element actuals on a
   standalone batch-log screen, so Production no longer waits on 4e either.
   **The tray tally box rule is answered too, and it grew a feature** (Mark,
   2026-08-07: "It's always 6, but that is something that would make it better —
   to have the ability to set the chunk size for each item"). So 037 gives
   `production_items` a **`tally_box_size` (not null, default 6)** — per ITEM,
   not per size, because that is what he asked for and the data has exactly one
   value today; a cascade nobody needs would be 016's `nextDeliveryDate` trap in
   miniature. The rest of the strip was settled by MEASURING the real 8/7 DF02
   packet rather than asking: it is a **fixed 24 boxes independent of par** (888
   boxes over 37 rows; par 15 and par 18 both get 24), so it is a counting grid
   you tick off rather than a tally sized to the order. **The baker and fryer
   guides are NOT this control** — their `1 2 3 … 25` strip is a ruler of tray
   numbers with the day's total printed beneath, and reproducing one from the
   other's rule would be wrong.
   **NOTHING IS NOW BLOCKED**: every question that gated phases 2–5 is answered.
   **Shipped, phase 1 — `/elements` + `/recipes`, both with detail screens, and
   the recipe sheet as a client-rendered PDF.** Migration 036 is six tables
   (elements · element-locations · recipes · versions · lines · steps) with
   **no cost column anywhere in them** — decision 11, and the cure for FMP's
   `Recipe_Items` still carrying its 1/30/2022 prices in 2026. RLS is
   membership READ (production is operational, not HR-sensitive: anyone rostered
   to make a thing needs its recipe) and purchaser+ writes; verified on the
   harness as a real authenticated user, where staff read but an update changes
   0 rows, a delete removes 0, and an insert is refused outright.
   **THE SCALE COLUMNS ARE COMPUTED, AND THAT WAS A MEASUREMENT, NOT A TASTE.**
   It is the decision a rewrite is most likely to flip. FileMaker STORED an
   amount per variation column — four hand-maintained numbers per line — and it
   looks like four independent quantities. It isn't: **96.4% of testable
   ingredient lines are within 2% of a strict multiple of the base column**,
   once two things are accounted for that make a naive check report 65%
   failure — **the unit changes as the number grows** (170 g → 510 g → 850 g →
   **1.7 kg** is ×1/×3/×5/×10 exactly) and **a blank multiplier in slot 0 means
   ×1** (all 493 versions put the base there). So a line stores ONE amount plus
   the version's (label, multiplier) strip, and the rest is rendered. Verified
   AFTER building, over all 493 versions: **98.64% of computed cells match what
   FMP stored** (7,619 of 7,724).
   Reaching that figure is what found the four kinds of line that are NOT
   ingredients — `Expected Labor` (159 lines, a constant per batch like mixer
   size, and already duplicated by the version's `prep_time`), `Total Liquid`
   and `Total Base` (283 computed subtotals), and 41 temperatures carrying unit
   `C`. **None is lifted automatically**: three are already covered by a real
   column and the fourth is derivable, so more name-matching would be guessing
   where the brief says report. They load as labelled lines with no element,
   cost nothing, and are visible to delete.
   The 105 cells still disagreeing are **29 versions whose columns are
   FORMULATION VARIANTS rather than scales** (Vanilla Cake Donut labels its
   "A"/"B"/"C", Chocolate Chip Cookie v6–v16 likewise). No multiplier can
   express those — **the one place this model loses something FileMaker had** —
   and the raw strip survives in each line's `source_payload`. Ask Mark; a
   variant probably wants to be its own VERSION, which is what the family is for.
   **Costing is `lib/productionCost`, and AN UNKNOWN COST IS NEVER ZERO.**
   155 of the 470 migrated elements resolve to nothing (FMP never mapped them;
   24 are cleaning duties with no cost at all), so a resolver treating those as
   free would report a confident, always-too-low figure for every recipe
   containing one with nothing on screen saying so. A cost is therefore the
   money we could account for PLUS the elements we could not, rendered `≥ $4.12`
   with the gaps named. There is a **cycle guard** too, since 036 lets a line
   point at any element and nothing stops Glaze A being made from Glaze B and
   back; FileMaker needed none because its costs were snapshots, so a cycle just
   froze. The graph loads in **FOUR queries however deep the BOM goes** — ~470
   elements and ~4,000 lines are small enough to hold whole, so it is fetched
   flat and walked in memory rather than recursed over the network.
   The element list's **Uncosted tier is the catalog cleanup made into a place
   you can go**, rather than a footnote under each recipe.
   **Two bugs the PRINTED SHEET found**, neither visible in code review: the
   lower-bound `≥` printed as a stray "e", because @react-pdf's built-in
   Helvetica is WinAnsi and lacks the glyph — so a total read "e$12.10", not
   merely losing the claim but replacing it with a typo (the PDF says
   **AT LEAST** in words now; the screen keeps the symbol, where browser fonts
   have it); and scaled amounts printed "30.625 g", which no kitchen scale can
   show. Precision now falls as the quantity grows.
   **`/elements` TOOK THE SAME THREE (2026-09-12)** — the switch in its Active
   column, the sunken search, and New Element beside the title — an hour after
   `/production-items`, and it was the last list still wiring its create
   command to `FilterMenus`' `rowAction`, which now has no caller outside
   `/interface`. **No rebalance was needed here and the reason is the TOTAL**:
   1220 against that table's 1340, so the same weight of 80 buys 87.1px at
   1440 and 76.6 at 1280 — 63.1 and 52.6 of content, room for the 40px switch
   and a 50.7px "ACTIVE" either way, where over there 80 gave 45.8 and clipped.
   Measured in the same pass and NOT fixed, since nothing in the ask touches
   it: this table's ⋯ column is 60, which at 1280 is 33.5px of content for a
   36px button and clips by 2 — the hazard `/production-items` records when it
   took its own ⋯ to 74. Five weight off Costs from, which has 249px for a 48px
   label, would settle it.
   **THE SWITCH THEN TOOK THE REST OF THE MODULE, one screen at a time**
   (Mark, 2026-09-12): the ELEMENT RECORD's per-location table — the vendor
   record's own arrangement, a shop and a row of that shop's config, its Active
   column already 130 because it doubles as the "Make here" slot — and
   `/recipes`, whose total of 1150 gives 80 a comfortable 68.4px of content at
   1440 and 57.3 at 1280. **`/plans` followed the same day** (total 1040, so 80 is 93.5px at 1280).
   Measured and not fixed on the element record, since nothing in the ask
   touches it: "Make here" is 76.7px of ink in 71px of content at 1280, so it
   clips by ~6 on the rows that have no config yet.
   Nav's Production section drops FMP's vocabulary for this module's own —
   **Recipe Items is gone entirely** (decision 2 merged it away, so a menu item
   would name a table that no longer exists) and "Item Schedules" becomes Plans.
   **576 fixtures pass**, 35 new, each rule checked by breaking it: zeroing an
   unresolved line fails 2 cases, ignoring the location override fails 2, and
   removing the cycle guard produces the literal stack overflow it prevents.
   **Migration/transform traps, all found by replaying the REAL 8,175-row export
   through the REAL schema on the harness rather than by reading:**
   **Six rows in FMP's ingredient CATALOG are not ingredients** — "Mixer Size",
   "Expected Yield", "Prep Time", "Total Liquid" and two separators, every one
   typed "Vendor Item" with no vendor key. They must not become elements, and
   they cannot merely be dropped either, because 827 recipe lines carry their
   name ONLY through that link. They lend the line its label instead.
   **Merging duplicate elements CREATES a par collision that is not in the
   source**: FMP's two "Candied Peanuts" rows each carry a DF01 par, and once
   the elements are one so are their pars — the insert failed on row 471 of 530.
   **34 recipe families have no element at all** (the 13 "Knotted – …" creams,
   several "(old)" glazes), so `element_id` NOT NULL means the transform CREATES
   one for each, inactive and named in the report.
   Everything else joins clean: 8,175/8,175 lines, 5,200/5,200 item keys,
   97/97 name links. `cost_basis_t` needed reading rather than guessing —
   **"Internal" means made in-house** (45 of 68 name a recipe), not manual.
   **Shipped, phase 2 — migrations 037 + 038, both APPLIED and LOADED
   2026-08-07.** 307 items · 324 BOM edges · 325 item-locations · 40 price cells
   + 5 overrides · 21 yield rules, plus `/production-items`.
   **038 EXISTS BECAUSE 037 WAS WRONG, and the data said so in a minute.** 037
   put `unique (org_id, name)` on `production_items`, copying 036's rule for
   elements, and the first load collapsed **307 items to 173**. An item's name
   is a LABEL: **"Angry Samoa" is four different donuts** — Regular Cake
   Vanilla, Mini Raised Promise Ring, Regular Raised Letter, Giant Raised
   Promise Ring — with four price classes. 038 **DROPS** the constraint rather
   than widening it: `(name, size, type, subtype)` is exactly unique over all
   307 rows and a composite index is therefore available and TEMPTING, but those
   are four separate `InlineValue` cells and changing a Regular to a Mini when
   that Mini exists would fail on the first edit with no order that works —
   024's mistake exactly. Duplicates get `findPossibleRehires`' treatment
   instead: warn, and let the person through.
   **THE BOM IS TWO FACTS THAT OVERLAP.** FMP states what an item is made of in
   `_idBase_t` (the dough) AND `_dependencies` (everything else), and they
   overlap on 84 of 216 items — load both and the dough counts twice, load only
   dependencies and 132 items lose it. So the base is a COLUMN, dependencies are
   EDGES, and an edge naming the item's own base is dropped with a report. That
   also explains why 176 edges carry no quantity: **the dough's amount is
   DERIVED**, never stored.
   **`production_batch_yields` is Mark's rule as editable DATA** — dough cost =
   `batch cost × portion_of_batch × size_factor`. Seeded over FMP's structure
   with every change named: 11 raised portions 1/350 → **1/340**, mini 0.4 →
   **1/3**, giant 4 → **2**. He named only the RAISED cuts, so the export's cake
   portions (Vanilla 1/40, Chocolate 1/35, Banana 1/30) load as they stand
   rather than being invented.
   **The dough must read its element's BATCH cost, not its per-unit cost** —
   `elementCost` already divides a made element by its yield, so doing that AND
   multiplying by `portion_of_batch` applies the yield TWICE, giving $0.01 where
   $1.00 is right. A hundredfold error that still looks like a plausible
   ingredient cost. Four fixtures exist for it and reproduce exactly 0.01 when
   the guard is removed.
   **Decision 10 confirmed by measurement**: 125 price rows are 40 (class, tier)
   cells copied across four shops, DF01/DF02/DF03 agree on **all 40**, and only
   EVENT differs — on exactly its five Regular-class cells. `lib/productionPrice`
   resolves item-location override → location grid override → org grid. An item
   missing a class or tier has NO price rather than a default one (19 of 307),
   and **margin is a fraction of PRICE, not cost** ($1 at $4 is a 75% margin and
   a 300% markup).
   **WHAT PHASE 2 DOES NOT PROVE.** The plan was to validate item costs against
   FileMaker's own frozen `costEach`, kept in `source_payload` for exactly that.
   **The diff cannot run**: of the 61 items FMP costed, ZERO have a complete cost
   of ours, because every one carries 4–11 unpriced components. The arithmetic is
   fixture-verified; the DATA cannot corroborate it until the element catalog is
   mapped — even Raised Donut's batch resolves to $6.22 with one of its four
   lines unpriced. That is the 209-element backlog the Uncosted tier exists for,
   and it is Mark's data work, not a code fix. **Re-run that diff after the
   catalog is filled in** — it is the real validation and it is still owed.
   Two traps this phase added to the pagination lesson: `fetchAll` must take its
   ORDER COLUMN as a parameter, because `production_price_grid_locations`
   deliberately has no `id` (the pair is the key, `vendor_item_location_prices`'
   idiom) and a hardcoded `.order("id")` took the whole menu screen down; and
   `_yields.mer` has a genuine duplicate `(Raised, Letter, Regular)` row, merged
   with a report, which the harness caught and reading had not.
   **Also shipped: `/production-items/[id]` and `/price-grid`.**
   **The price grid is a MATRIX, not a `DataTable`** — the table component is
   for a list of RECORDS, and this is one record with two axes. Reading it as 40
   rows of (class, tier, price) would lose the point: a tier is a COLUMN, and
   changing one cell reprices every item on it. A shop picker switches between
   the org prices and any one shop's, where an overridden cell is a live value
   and an inherited one is the org price in GREY with a "set" button — and that
   button INSERTS the override row, because **a cell with no override has no row
   to write to and so cannot be an `InlineValue` at all**. Verified against
   EVENT: five live Regular-class values, 35 grey inherited ones.
   **The item record shows WHY a cost is what it is** — FMP stored one frozen
   `costEach`, so a wrong-looking figure told you nothing. Every contributor is
   a row, the dough included, rendered as **"1/340 of a batch"** because that is
   how a baker says it, and anything unpriced says so on its own line rather
   than being dropped from the total.
   **THE RECORD IS THREE TABS SINCE 2026-09-12** (Mark: "let's make three tabs
   on the items detail page. Info — upper two columns and default pars area.
   Costs — includes the costs area. History — includes the 'last two weeks'
   area"), `ui/SectionNav` and `lib/productionItems`, the inventory item
   record's pattern a fourth time — title and taxonomy above the split and
   indented `lg:ml-48`, the tab in the URL under `tab`, `info` writing no
   parameter so every stored link stays canonical, and `RecordNav` carrying
   the tab when you page.
   **"THE UPPER TWO COLUMNS" IS THE FIELDS BLOCK** — its `dl` is four tracks at
   `sm` (label · value · label · value), which is two columns of pairs — and
   Default pars joins it because both say what the item IS, where the other two
   tabs say what it COSTS and what it DID.
   **WHICH RETIRES THE TWO-COLUMN GRID BELOW**, described next and kept for its
   reasoning: that arrangement existed because three short blocks were stacked
   down a 1,300px page, and with one block per tab there is nothing left to
   stack — each now has the whole content column, which roughly doubles the
   pars strip's room (at 1280 it had 561px of a split row and now has 977 less
   the 192px sidebar). Nothing else was at risk: History wraps its
   `min-w-[520px]` table in `overflow-x-auto` and What it costs caps itself at
   `70ch`.
   **THE GRAPH LOADS STAY UNCONDITIONAL, deliberately.** Info drops the Add
   picker's vocabulary and the fortnight, Costs drops the pars, History drops
   both — but `loadItemGraph` resolves the taxonomy line under the title, which
   sits ABOVE the tabs and so is on every one, and `loadProductionGraph`
   answers both Info's cost figure and the whole of Costs. Gating it would buy
   one tab of three a saving in exchange for making `cost` nullable everywhere
   it is read.
   (The arrangement it replaced, 2026-09-08 — Mark: "move the 'default
   pars' section into a second column next to the 'what it costs' section, and
   make the 'last two weeks' section fit into a single column instead of
   spanning the entire screen".) What it costs and Default pars are both narrow
   tables that were each running the full width of the screen, so the record was
   three short blocks stacked down 1,300px. `xl:grid-cols-[minmax(0,1fr)_minmax
   (0,1fr)]` — `minmax(0,…)` and not a bare `1fr`, because a grid item's
   min-width is min-content and the history's `min-w-[520px]` would otherwise
   push its own track past half and the page sideways — with `items-start` so a
   tall left column does not stretch the right into white space. The history
   takes column ONE of the second row by ordinary auto placement, which is the
   third part of the ask with no code of its own. Measured at 1440 (columns
   48–689 / 737–1377, tops level, no overflow), 1280 (48–609 / 657–1217, the
   pars strip's seven pens 35px each, the history's table still inside its
   641px box with no horizontal scroll) and 1024, where it stacks.
   Known cost, accepted: in half a column the pars table's Location cell
   truncates the shop's NAME. The CODE is what identifies it and stays whole.
   **THE LIST TOOK THE SWITCH, THE SUNKEN SEARCH AND THE TITLE-ROW COMMAND
   (2026-09-12)** — Mark, naming it by its own heading, which is "Items". All
   three were stragglers: a checkbox where `/vendors` took the switch, the
   TYPED border where every other search box is sunken, and its create command
   still in the filter row after the 2026-09-10 sweep moved every other list's
   into the title row — `action`'s own doc had said "beside the title" since it
   was written while the wiring said `rowAction`.
   **THE SWITCH MATTERS MOST HERE BECAUSE THIS LIST HAS A SELECTION COLUMN
   TOO**, which is the exact ambiguity `ui/Switch` exists to end.
   **`TextInput` HAD `search` AND `fullWidth` FIGHTING OVER THE WIDTH.**
   `search` asks for the sunken `mac-field` dress AND forced `SEARCH_PEN`, so a
   CAPTIONED search — where the caption block wears the pen and the field fills
   it — could not have the dress without nesting one pen inside another.
   `fullWidth` wins the width now and `search` decides the dress; no caller
   passed both, so nothing else moved. **Three captioned searches still wear
   the typed border for that reason and are one prop each from correct**:
   `/special-orders`, `/customers` and the special order's Add-line panel.
   **Active went 80 → 90 and Item pays the 10, total still 1340** so every
   other column keeps its exact pixels. At 1280, where all eleven columns still
   show, 80 gave that cell 45.8px against a 50.7px "ACTIVE" and it printed
   "ACTI…" — a fault that predates the switch and that the switch makes worse,
   wanting 40px of the cell where a checkbox wanted 24. Item pays because Item
   WRAPS, so it loses a wrap point rather than any text (the argument that
   already paid for the ⋯ column); measured it still holds 224px against a 92px
   name. **`minWidth: 64` instead of a widths-key bump** — a bump would throw
   away everybody's dragged widths, order and hidden columns to deliver a nudge
   to a default, where the floor stops a drag making the column too narrow for
   its own control.
   **THE LIST HAS A ⋯ — Duplicate and Delete** (`ProductionItemActions`, Mark,
   2026-09-08), `InventoryItemActions`' template, purchaser+ per the Page
   Permissions sheet.
   **DUPLICATE COPIES WHAT THE ITEM IS, NOT WHERE IT HAS BEEN** — the master
   row, its components and its per-shop rows (default pars and price
   overrides), which is everything the record screen shows. Deliberately NOT a
   plan slot, a schedule line or a par override: those are facts about menus and
   days somebody wrote, and a copy landing on a plan would quietly double a
   shop's production, which is why a duplicated PLAN arrives inactive. The copy
   IS `is_active` like its original, which is safe for the mirror reason — an
   item is made because it is on a tray, and this one is on none — while
   **`show_on_inquiry_form` is NOT copied**, because that flag is PUBLIC and a
   row named "… copy" must not appear on the customer inquiry form the moment it
   exists.
   **THE COLUMN LIST WAS WRITTEN FROM 037 AND 037 IS NOT THE CURRENT TABLE.**
   The first real duplicate failed with `column production_items.base_element_id
   does not exist` — **049 dropped it** ("an item is a list of components, and
   none of them is special"). Probe the columns; do not read the migration that
   created them. That is the same rule 096's header states for a FUNCTION, and
   it is worth as much for a table.
   **DELETE CAN BE REFUSED BY THE DATABASE, which is the one place this differs
   from the inventory item's menu.** `production_plan_tray_items` (039) and
   `production_schedule_items` (040) are `on delete restrict`, so an item on a
   plan or on any schedule ever generated CANNOT be deleted whatever a confirm
   says. So the count is taken first and the button is DISABLED with the reason
   on screen — a control that can only fail is worse than a sentence
   (`NewLocation`'s rule), and this is not `closeReadiness`' name-it-and-let-you-
   through case, because there is no through. Everything else is stated the way
   that menu states it: components, per-shop rows and par overrides CASCADE,
   while special-order lines and display tags go `set null` and survive
   unlinked.
   **THE ⋯ COST 74 WEIGHTS AND EVERY ONE WAS MEASURED.** The total stays at
   1340, so every column not named keeps its exact pixels (checked: Active 79,
   Item, Type 119, Cut 129, Finish 149, On it 89 unmoved at 1440). Cost and
   Price were 129px cells holding 64px figures, Size 99px holding "Regular",
   Margin sat 6px above its own label — and Item gave up 6 because it WRAPS, so
   what it loses is a wrap point rather than any text. **68, the app's usual ⋯
   width, was not enough here**: eleven columns at a 1280 window resolve at
   0.87px per weight, which made it a 59px cell holding 35px of room for a 36px
   button. Widths key bumped to **v4** — a stored width outranks the declared
   one, so without it anyone who had dragged this table would keep the old
   numbers against a total that no longer adds up.
   Walked live and left as found (309 items): Fudgegazi duplicated with its 5
   components and 4 per-shop rows — including one at a shop the record does not
   list, which is right, that row is real config — and deleted again; the
   original's own confirm correctly read "cannot be deleted: it is on 14 plan
   slots and 24 schedule lines" over a disabled button, with 25 special-order
   lines and 1 display tag named as left behind.
   **Harness note:** the pane's screenshots go blank or stale on this screen
   while the DOM is perfectly fine, and a freshly loaded page often has not
   hydrated, so a `.click()` on a menu trigger leaves `aria-expanded="false"`.
   Reload, wait, and verify what opened by reading the DOM rather than by
   looking. `compactBelow` is the other one: `matchMedia` only re-evaluates on a
   `change` event, so after `resize_window` the wide column set survives even a
   reload — nudge the width by a pixel to make the tier fire.
   **Per-location pars are EDITABLE AGAIN since 2026-09-04 (Mark: "we should
   be able to edit the default pars"), and the block is titled "Default pars"**
   — seven `InlineValue`s per shop through `arrayColumn`, each in its own
   `min-w-0 flex-1` pen, with a **Set Default Pars** button that INSERTS the row for a
   shop that has none (/price-grid's "set"). What the 043-era paragraph below
   missed is the NEW item: it has no plan slot yet, so the default is the only
   number anyone can write before it reaches a tray. Kept for the reasoning:
   Per-location pars WERE read-only, and since 043 they are a DEFAULT rather
   than the par — the number a new plan slot is seeded with, nothing more.
   This line used to say the reason was that `InlineValue` writes a whole COLUMN
   while a par cell must write one SLOT of an array, and that **"is the obvious
   next thing to build"**. Both halves are wrong now: 041 shipped
   `arrayColumn`/`arrayIndex`/`arrayStrip`/`arrayWidth` for the recipe sheet, and
   043 made the editor beside the point. (It IS built now — see above.) The
   argument against it was that after 043 an edit there changes nothing that exists — no plan, no schedule, no day, only what
   some future slot starts at — and a live-looking editor whose effect is
   invisible until an unrelated act on an unrelated screen lies about its own
   reach. The par is edited on the PLAN.
   Nav: Operations > Prices was an existing named stub and now points at the
   grid; if staff look for it under Production instead, it is one line.
   **Shipped, phase 3 — migration 039, APPLIED 2026-08-07.** `/plans` and
   `/plans/[id]`, the tray × weekday matrix. **No transform and no loader**: the
   fresh-start decision means FMP's 150 plans and 29,083 tray-day slots stay on
   disk, so the screen is the ONLY write path — which is why it was exercised
   end to end rather than probed (design rule 1's "a create that a loader also
   performs is a create nobody has tested", with no loader at all here).
   **THE KITCHEN LIVES ON THE PLAN** (decision 9) — the thing FileMaker could
   not express, because it put where-a-thing-is-MADE on `locations` and a column
   there has room for one answer while DF01 makes DF02's raised donuts and DF02
   makes its own cake. A plan is (selling location, kitchen, date range, trays),
   several may be active at once, and their UNION is that shop's menu.
   **AND SINCE 2026-09-09 THAT KITCHEN IS PER WEEKDAY — migration 101, APPLIED
   2026-09-09 and IN REAL USE THE SAME HOUR.** It had to go in BEFORE the deploy
   (059's order, not 012's: five screens select the column, and while the
   generate dialog and the shift report's Tomorrow page find no plans a closing
   supervisor cannot make the night's paper. The plans screens name the
   migration; the schedules ones degrade honestly, losing only the plan's name
   in their From column).
   *Probe, don't read this line.* Probes:
   `select column_name from information_schema.columns where table_name =
   'production_plans' and column_name in ('kitchen_by_weekday',
   'kitchen_location_id')` — ONE row, the first; and
   `select count(*) from production_plans where cardinality(kitchen_by_weekday)
   <> 7` — 0. Mark: "the only way to have donuts
   made for DF2 at DF1 M-W and DF2 Th-Su is to have two separate plans … any
   change to the schedule requires the user to change 2 schedules instead of
   just one. A better solution … is to place a kitchen field above each day's
   column."
   **THE TWO-PLAN WORKAROUND MADE A TRAY LOOK LIKE IT CHANGED ON THURSDAY.** A
   tray is a physical case position at the SELLING shop and it does not change;
   what varies by day is who bakes it. So DF02 had two tray 01s that are the
   same shelf, and every edit had to be made to both. `kitchen_by_weekday` is
   seven ISO slots on the plan (`par_by_weekday`'s idiom) and
   **`kitchen_location_id` IS DROPPED, not kept as a default** (Mark: "we would
   retire the plan's 'made at' field as it would conflict"): a plan-level field
   applying only where a day says nothing is exactly 016's
   `nextDeliveryDate` shape. Decision 9's fallback is UNCHANGED in meaning — a
   null slot says the selling shop makes its own — it is just said per day.
   **NOTHING BELOW THE VIEW CHANGED, which is why this was cheap.**
   `production_day` filters `v.weekday = wd.weekday` and THEN groups by
   `v.kitchen_location_id`, so every row it sees already shares one weekday;
   `production_schedules` is already unique on (location, date, kitchen) so one
   seller may have two schedules a day; and `generate_production_schedules`
   reads `distinct d.kitchen_location_id` and loops, 040's "the kitchen is NOT
   a parameter: the DAY tells you which kitchens are involved" being what makes
   it indifferent. The substance is ONE expression inside
   `v_production_plan_days`. Neither function is reproduced in 101 (055's rule).
   **AN ARRAY CANNOT CARRY A FOREIGN KEY**, where the column had
   `on delete set null` — so a deleted location leaves a dangling uuid. It
   fails LOUDLY (`production_schedules.kitchen_location_id` is
   `not null references locations`), and shops are deactivated rather than
   deleted here, so it is a live edge and not a live risk.
   **AND THE ARRAY SUBSCRIPT COMES BACK.** 049's view celebrated that 043 had
   left "no array subscript anywhere in this file"; one returns, on a different
   axis, and 040's warning applies word for word — off by one shifts a whole
   shop's WHOLE WEEK of kitchens by a day. What makes it safe is that the
   subscript is `s.weekday`, the slot's own column. The app-side twin is
   `planKitchenFor`, ONE-BASED on the ISO weekday and zero-based in the array,
   with a fixture on exactly that.
   **`cardinality`, NEVER `array_length(x, 1)`** — 076's lesson, and the
   harness proved it again: an empty array makes `array_length` NULL and A
   CHECK PASSES ON NULL. (017's own check on `locations.kitchen_by_weekday` has
   that hole; 101 does not fix it.)
   **A NEW PLAN IS WRITTEN WITH SEVEN EXPLICIT COPIES OF THE SELLING SHOP**
   (`defaultKitchenStrip`), never left null. It costs nothing and it keeps
   `kitchen_assumed` meaning "nobody said" rather than firing on every ordinary
   day — measured on the harness, a null strip puts that warning on the
   generation receipt PER ITEM PER DAY for the half of the week a shop bakes
   for itself, which is the noise that teaches people to stop reading receipts.
   **THIS DOES NOT REPLACE OVERLAPPING PLANS.** Two kitchens on ONE day split
   by ITEM — decision 9's own DF01-raised / DF02-cake example — is still two
   plans, which is why `production_day` groups by (kitchen, item) and why
   `kitchen_split` exists on overrides. 101 is the DIFFERENT-DAYS case only.
   **THE PLANS LIST IS SCOPED TO THE SELLING SHOP ALONE** (Mark: "A plan is for
   a location"), which retires both the 2026-08-28 kitchen scoping and the
   either-shop rule that stood for four hours on 2026-09-09: a plan no longer
   HAS one kitchen to scope by. `planIsAtLocation` and `planKitchen` are gone;
   the Made at COLUMN stays and now lists every kitchen the week uses
   (`planKitchens`), muted where it is the shop's own.
   **`sellingShopsForKitchen` ASKS PER DATE NOW**, which fixes a weekday
   blindness it shipped with and could not have fixed — the answer did not
   exist. A plan baked at DF01 on Mon–Wed no longer offers its shop for a
   Thursday run. `plansInForce` likewise reads the SCHEDULE'S OWN WEEKDAY, or a
   split plan would name itself on half the week and lose itself on the other.
   The matrix's day header is now day · Clear over a kitchen `PickList`;
   `NewPlan` no longer asks where it is made, there being nothing it could ask
   once and be right about.
   **Verified on the harness**: all 101 migrations replay; the backfill turns a
   plan naming DF01 into seven copies and leaves a null-kitchen plan null; the
   view resolves Mon–Wed DF01 / Thu–Sun DF02; `production_day` agrees per DATE
   with no change to the function; the check refuses a short array AND an empty
   one; and **generation produced exactly Mark's case from ONE plan** — DF02
   selling, 2026-09-07..09 at DF01 and 09-10..13 at DF02, one line each. As
   real roles a purchaser writes a day's kitchen (1 row) and a staffer changes
   **0 rows with NO error**. **1743 fixtures pass**, and the three new rules
   were each checked by BREAKING them: the off-by-one turns 3 red, a
   plan-level `sellingShopsForKitchen` 2, a plan-level `plansInForce` 1.
   **AND MARK MERGED HIS TWO PLANS WITH IT INSIDE TWO MINUTES**, which is the
   real acceptance test and better than any walk: he renamed
   "Fall 2026 (Th-Su) DF02" to **Fall 2026 - DF02**, carried the M-W items onto
   it, set its Mon/Tue/Wed headers to DF01 with the new picker, and DELETED
   "Fall 2026 (M-W) DF02". Measured after, through the real `production_day`
   over a full week at DF02: **Mon–Wed 35 items at DF01, Thu–Sun 35 items at
   DF02**, ONE kitchen per day and never two, with the weekend par ramp intact
   (377 / 377 / 377 / 377 / 425 / 473 / 467) and **zero `kitchen_assumed`** —
   the backfill's explicit strips doing exactly what they are for. The catalog
   is unchanged in total: 5 plans → 4, 120 trays → 96, and **940 slots before
   and 940 after**, the deleted plan's 105 Mon–Wed slots having moved onto the
   survivor.
   Worth knowing if a probe here ever looks wrong: a reading taken WHILE
   somebody is editing is a reading of a half-finished plan. Mid-merge this one
   reported Monday at DF02 with the M-W plan contributing nothing, which looked
   like the feature failing and was the deletion having landed a minute before
   the kitchen edit.
   **AND THE LOCATION'S OWN MAPPING IS RETIRED — migration 102, APPLIED
   2026-09-09** (Mark, same day: "remove the location kitchen mapping and
   shops_for"). *Probe, don't read this line* — every other "NEEDS APPLYING" in
   this file has been wrong at some point. Probe:
   `select count(*) from information_schema.columns where table_name =
   'locations' and column_name in ('kitchen_by_weekday','shops_for')` → **0**,
   with `locations` still selectable and `production_plans.kitchen_by_weekday`
   untouched (all three confirmed against the hosted DB after Mark applied it).
   017 put `kitchen_by_weekday` and `shops_for` on `locations`;
   039 said they would be vestigial "the day kitchen-on-plan lands" and 101 made
   that true twice over by giving the PLAN a column of the same name and shape,
   one level down and on the axis that owns the question. 102 drops both, the
   Production block and `ProductionMapping` come off the location record, and
   `backfill-locations.mjs` stops reading FMP's `KitchenLocation` /
   `ShopForLocations_t` (its `toId`, `codeById` and unknown-code report went
   with them — nothing it writes names another location now).
   **WHAT IT DESTROYS, measured before dropping**: DF01 all-DF01 with
   `shops_for` DF01/DF02/DF03, EVENT a stray Monday, four shops empty — and
   **DF02's row, which is Mark's split week EXACTLY as the merged plan states
   it**, Mon–Wed DF01 / Thu–Sun DF02. That is the corroboration worth keeping:
   017 had the real arrangement right and the record wrong, and the plan now
   says the same thing where a date range, a tray and a par can be said with it.
   No view, function or constraint read either column. `if exists` is
   deliberately NOT used — a silent no-op would make a re-run look like a
   success — so the second run fails by name, verified on the harness along with
   all 102 replaying and the 017 check constraint going with its column.
   **OVERLAP IS DELIBERATELY NOT A CONSTRAINT.** 027 taught the btree_gist
   exclusion idiom and this is exactly where NOT to reach for it: overlapping
   ranges are the feature, and even "the same item on two of one shop's plans"
   is legitimate. What it means is that pars SUM, so it is a yellow line on the
   list and a sentence on the record — the under-minimum-vendor pattern.
   **The matrix is not a `DataTable`**: the columns are DAYS rather than fields,
   every cell is a SET of items rather than a value, and there is nothing to
   sort by. It writes immediately, one item at a time, because there is no draft
   of a menu to save.
   **ISO 1 = MONDAY, and off by one silently shifts a whole shop's menu by a
   day** — `lib/productionPlans` is fixture-tested on exactly that (breaking the
   index turns 3 red), and dates compare as STRINGS rather than through `Date`,
   since `new Date("2026-08-07")` is UTC midnight and would move a plan's first
   day for everyone west of Greenwich.
   Verified on the live database by building a real plan through the UI — DF02
   selling, DF01 kitchen, tray 01, Bananaversary on Saturday, stored as
   `weekday=6` and rendered in the Saturday column — then DELETED, leaving 0
   plans, 0 trays, 0 slots.
   **Shipped, phase 4 — migration 040, APPLIED** (this line said NEEDS APPLYING
   until 2026-08-08; probed that day — the tables select and `production_day`
   executes. *Probe, don't read this file.*) `/schedules` +
   `/schedules/[id]` + `/production-day`, the generation function, and the
   printed packet. A PLAN is a proposal; a SCHEDULE is the committed day.
   **THE DERIVED DAY IS A FUNCTION, and that is the decision a rewrite is most
   likely to get wrong in either direction.** Not a table (design rule 4), and
   not a plain view either: `v_order_guide` fabricates a weekday axis with
   `cross join generate_series(1,7)` because its par lives in a seven-slot
   ARRAY with no weekday row to join to, while `production_plan_tray_items`
   already IS a row per weekday — copying the idiom past the point its reason
   applies would manufacture an axis only to filter it back down. And a
   schedule is bound to a DATE: plan membership is a RANGE predicate no
   subscript can fake, and a date axis has no natural bound, so a caller who
   forgets the `where` gets a silent cartesian. Hence
   **`production_day(location, date)`** — exposed to PostgREST for the screen
   AND called internally by the generator. 013's precedent: one implementation,
   two callers, so a stale tab can't post last week's arithmetic into a
   committed document.
   **SQL WRITES THE PARS; TYPESCRIPT WRITES THE MONEY.** `productionCost`
   already resolves the whole graph with `lib/units`' conversion, a cycle
   guard and an `unresolved[]` list, and `matchYield` already ranks
   `production_batch_yields`. A SQL twin would be decision 2's disease in a new
   form, so generation leaves the four cost columns NULL and the caller patches
   them from the graph it is already holding (the **Recost** command does it
   again later). A null `costed_at` is a legible state; a zero is a wrong
   number that looks right. Element demand is TypeScript for a DIFFERENT
   reason, and the asymmetry is principled: pars are RECORDS, so the generator
   must own them; element demand is a RENDERING (decision 5), so nothing writes
   it and there is no second writer to drift from.
   **`generate_production_schedules` NEVER SILENTLY REPLACES** (decision 6), in
   three levels each costing an explicit act: default SKIPS an existing day and
   reports it, so a 14-day run overlapping three still writes the other eleven;
   `p_replace` replaces lines IN PLACE keeping the id and `printed_at`;
   `p_allow_actuals` is required on top when any line carries made/leftover, or
   it RAISES. Replacement is an UPSERT on `(schedule_id, item_id)`, not a
   delete-and-insert, which is what carries a supervisor's typing forward for
   free — and a line a human ADDED (`par_source = 'manual'`) survives too.
   **A schedule is a WORKING DOCUMENT** (Mark, 2026-08-07, applying the
   2026-07-28 PO call): par, note, added and struck lines are editable in
   place, and an edited par writes `par_source = 'manual'` in the SAME update,
   so the schedule and the plan may disagree but never silently. That does NOT
   make overrides redundant — an override is intent BEFORE generation, editing
   is correction AFTER.
   **`production_par_overrides.par` is NOT NULL and ZERO MEANS "don't make it"**
   — the ROW is the touch, so a nullable par would be a second way to say
   nothing, and to a kitchen the two sentences are the same. A suppressed item
   still SHOWS on the derived day (a printed sheet with a zero row invites
   someone to make it anyway). Bump vs ADDITION is one record type: the derived
   day's `full outer join` answers it, so there is no `is_addition` flag.
   **THE PACKET IS SEVEN DOCUMENTS FROM ONE DATASET.** Only the premade
   schedule is a record; the three tray guides are ONE renderer at three grains
   (subtype = cut, +finish = prep, +item = decorate) and the element sheets are
   derivation. They sum every schedule live in that KITCHEN that night, which
   is what makes "including special orders" true by construction rather than by
   a flag. **`TALLY_BOXES` is a fixed 24 and fills by FLOOR** — measured, 888
   boxes over 37 rows, and par 15 shades two not three — while the guides' `1…25`
   strip is a ruler of TRAY numbers. Reproducing one from the other's rule
   would be wrong (answered question 3 says so outright).
   **TRAY CAPACITY IS A COLUMN, and only rendering the real packet found it.**
   Every filled cell holds 24 — vanilla 54 reads 24 · 24 · 6 — EXCEPT fritters,
   which FileMaker trays 16 · 4 rather than as a single 20. A constant would
   have printed a tray the kitchen never fills, while looking plausible. 040
   adds `production_items.tray_capacity` default 24, snapshotted on the line
   beside `tally_box_size`; a run takes the SMALLEST among its lines.
   **`_production.mer` IS THE ONE CONFIG EXPORT NO TRANSFORM HAD EVER READ** —
   1,201 rows, and the AB/Weekly sheets have nothing to print without it. Two
   things a reading of its column list gets wrong: **a row is one BATCH**
   (Raised Dough at DF01 on a Monday morning is four rows), and
   **`batchOrder_n` is NOT a number** — its values include "Blueberry",
   "Caramel", "x2", so an integer column takes the numeric ones and drops the
   rest without a word. It has **no primary key at all**, so identity is the
   natural tuple plus an `occurrence` ordinal (028's `source_row_key` lesson):
   element 1126 has six unlabelled Tuesday batches at DF01 carrying amounts 8,
   4 and 2, and merging on the tuple alone discards five real batches.
   `WeeklyPar` is constant per (element, kitchen) — 197 groups, zero varying —
   so it lands on `production_element_locations`' stock columns, which 036
   created and left empty. 1,105 of 1,201 load; 30 have no kitchen and 66 no
   weekday, each reported.
   Verified: all 40 migrations apply on the Docker harness; the real 1,105 rows
   replay through the real constraints with the flavour batches intact;
   generation, the skip guard, the actuals refusal, actuals carried forward,
   ahead-of-time, overlap summing, additions, suppression and the kitchen-split
   override all exercised as a real authenticated owner, with staff reading and
   every write changing **0 rows and returning NO error**, and `anon` refused
   both functions. **637 fixtures pass**, each rule checked by breaking it. And
   the real 2026-08-07 DF02 night was rendered through the real components and
   compared page for page against FileMaker's own packet: every type total,
   every subtype subtotal, every tally strip and every tray ruler matches.
   **Expected discrepancy, NOT a bug:** the printed BATCH SIZE figures don't all
   reproduce. Cake reconciles exactly (Banana 15 × 1/30 = 0.50, Old Fashioned
   33 × 1/60 = 0.55, Fritter 20 × 1/16 = 1.25) but raised does not — 300 raised
   prints 0.60 in FMP where Mark's own 1/340 gives 0.88. The export is stale by
   his account and his rule is what phase 2 seeded, editable, precisely so this
   is a data edit. Show him the first real packet.
   **Reworked 2026-08-08 from Mark's first pass over the recipe screen, with
   FileMaker's RECIPES > RECIPE tab beside it (migration 041, APPLIED and
   BACKFILLED 2026-08-08).**
   The sheet phase 1 shipped was READ-ONLY, showed one scale column at a time,
   and had dropped four things the old layout had. Every field on a version, a
   line and a step is now inline-editable, rows can be added and deleted, and
   the grid is FMP's: sort · base amount · AUTO · every other batch size · item ·
   note · cost · hide.
   **THE AUTO SWITCH IS THE ONE THAT MATTERS, and it is decision 3 gaining an
   escape hatch rather than losing an argument.** Phase 1 computed every scale
   column from one stored amount, on the measurement that 96.4% of FMP's stored
   columns are a strict multiple of the base — that is still the default and
   still right. What it could not express was the other 3.6%, and phase 1's own
   note names the cost: "29 versions whose columns are FORMULATION VARIANTS
   rather than scales … the one place this model loses something FileMaker had".
   **FileMaker had an answer and no transform had ever read it**:
   `_recipelements.mer` carries **`AutoUpdate_bool`**, one flag per line, set on
   3,350 of the 5,260 ingredient rows and clear on 1,910 — a mixer size does not
   scale, and a variant is not a multiple of anything. So 041 gives the line
   `scale_auto` plus a typed `scale_amounts` / `scale_units` strip, ON with the
   multipliers is the default, and OFF is stored. **Turning it off FREEZES what
   is on screen in the same statement** — the computed values live nowhere but
   the render, so a bare `scale_auto = false` would blank four cells the instant
   you claimed them, which reads as having destroyed the row.
   **SLOT 0 OF THE STRIP IS NEVER READ.** The base column is `qty`/`unit` and
   041 keeps no second copy of it: costing, the percentage and every computed
   column read that one, and two answers to one question is how they drift.
   **`ScaleColumn` carries the SLOT it came from, not its position on screen.**
   `scaleColumns` drops an unlabelled slot, so a version with a gap renders its
   third column second — and every write (the multiplier, the label, each
   amount) has to use `column.index` or it silently stores column 3's amount in
   column 2's slot, on exactly the versions with a gap.
   Also new: `sort` is a column on both lists again; the batch NAMES and the
   MULTIPLIER row above them are editable (036 loaded that strip and no screen
   could touch it), with a narrow trailing slot to add one; a portion size is
   two fields, a number and a unit `PickList` (`allowNew`, since a recipe counts
   in hr and C and %); FMP's HIDE box, which keeps a working note in the record
   and off the binder page — and the PDF now honours it, computing the
   percentages BEFORE the hidden rows come off; and a picture on a procedure
   step, one per step, in the new private `recipe-images` bucket. **No drop zone
   on the step picture**, deliberately: `ui/FileDropZone` arms off WINDOW drag
   events and suppresses the page's own drop handling, so one per step would
   light fifteen overlays at once.
   **THE `%` COLUMN WAS MEASURABLY WRONG AND IS NOW BAKER'S PERCENTAGE.** 036
   read FMP's stored `%` as each line's share of the batch TOTAL and said so in
   the schema notes. Measured over 2,478 export lines carrying both a weighable
   amount and a stored %: share-of-the-first-ingredient matches on **1,758**,
   share-of-total on **178**. Mark's own Raised Donut v11 settles it by
   inspection — mix 5 lbs at 100%, water 2.8 lbs at 56%, and 2.8/5 is 56 where
   2.8/8.875 is 32. `percentOfBatch` is now `bakersPercent`; the fixtures
   reproduce all four of that version's printed percentages.
   Verified: all 41 migrations apply on the Docker harness, the shape constraint
   refuses a mismatched or over-wide strip, and as real authenticated roles a
   staffer reads the lines while an update changes **0 rows and returns NO
   error**, a purchaser's changes 1, a purchaser may write an object under their
   own org's folder and not another's, a junk path is refused by the POLICY
   rather than raising a cast error, and `anon` is refused outright. 647
   fixtures pass, and the six new rules were each checked by breaking them.
   **041 IS APPLIED and `backfill-recipe-scales.mjs` HAS RUN** (2026-08-08):
   746 lines marked typed, 579 of them carrying a strip, 202 hidden from print
   (that last one by the migration itself, since the transform had already
   carried `shouldHide_bool` into `source_payload`). A second run wrote 0.
   **Probe, don't read this line** — the counts are
   `select count(*) from production_recipe_lines where not scale_auto` (746),
   `… where scale_auto and scale_amounts is not null` (0 — an auto row must
   never carry a strip), and `… where hide_on_print` (202). The 746 is smaller
   than the export's 1,910 because the 036 load keeps 3,765 of 5,260 ingredient
   rows; the rest are separators and the three magic rows.
   **Exercised through the real UI against the live database and left as
   found**: the AUTO switch on Raisied Donut v11's Seed Dough line froze its
   strip to exactly the computed values (`[null,5,7.5,10,20]` /
   `[null,lbs,lbs,lbs,%]`, the `%` slot taking the derived 20.0), the x3/4 cell
   then edited 7.5 → 8.25 writing ONE slot with `scale_units` rewritten beside
   it in the same statement, and both rows were restored afterwards.
   The screen reproduces FileMaker's printed sheet for that version line for
   line — 5 lbs → 25 / 37.5 / 50, and 100.0 / 56.0 / 1.5 / 20.0 per cent.
   **Two disagreements in FMP's OWN data, surfaced rather than introduced:**
   v11's version record says yield 30 ea and prep time 3.5 hours while the
   sheet's own metadata rows say 34 (340 at ×1) and 2.75 hr. 036 lifted those
   rows into columns and preferred the recipe record's fields where both
   existed. Worth Mark's eye; not a code fix.
   **The PRINTED SHEET was rebuilt 2026-08-08 to FileMaker's own**, which Mark
   supplied as a reference (Banana Cake Donut v10). Its brief is one sentence —
   *it has to be easy to follow by kitchen staff* — and three things come off it
   on his instruction: **no money** (no unit cost, no line cost, no batch total),
   **no notes**, and **no percentages** (FMP's sheet has no % column; the screen
   keeps it). Black banner, FileMaker's bordered header block, ingredients LEFT
   and the batch columns right (Mark's preference over FMP, which reverses them),
   each amount split into a number and its unit.
   **MIXER SIZE, EXPECTED YIELD AND PREP TIME ARE ROWS AGAIN**, one figure per
   batch column, and that is the correction that mattered (Mark: "the recipe
   contains multiple batches and the mixer and prep time are included with the
   batch size"). 036 lifted them into columns on the version and DROPPED the
   rows, which is half right: they are metadata AND they are per column.
   Measured over the export, the columns differ on **196 of 198** mixer sizes,
   **349 of 376** yields and **57 of 94** prep times — Banana Cake Donut v10
   mixes in 4 / 10 / 10 / 20 QT, which is proportional to nothing, so no scaling
   recovers it from one number. `migration/backfill-recipe-metadata-rows.mjs`
   restored **668 lines** (idempotent — they carry their FMP key as `legacy_id`
   and the table is unique on `(org_id, legacy_id)`), and the transform now
   keeps them instead of `continue`-ing past. **`counts.magic` became a SUBSET of
   `counts.ingredient` when it did**, so it must not be added to the accounting
   total again or every run reports 668 phantom rows.
   The version COLUMNS stay: they come from the recipe record's own `Yield` /
   `PrepTime_text`, which FileMaker also keeps and also prints in the header.
   **`yield_amount` is NOT what costing divides by — since 2026-08-12 the
   Expected Yield ROW is, always** (see "THE YIELD IS THE RECIPE'S OWN ROW"
   below). The column is now display-only.
   **THE ELEMENT'S NAME LEADS; `label` is only a fallback**, on the sheet and in
   the PDF. FMP's `columnName_t` is an override that goes STALE when a version
   is copied: Banana Cake Donut v10 still carries "Coffee" and "Amoretti
   Espresso Artisan Flavor" over its bananas, left by the coffee donut it was
   cloned from — and FileMaker prints "Bananas, Mashed", because it reads the
   item. The transform still PREFERS the override when filling `label`, so the
   stale text is in the data; only the readers changed.
   **Ingredient groups are the HOLES in the sort numbers.** FMP grouped with
   separator rows (827 of them, presentation stored as data, dropped at the 036
   load) and what it could not drop is the gap they left: v10 runs 1, 2, (3), 4,
   5, 6, 7, (98, 99), 100, 101, 102. `opensGroup` opens a blank line wherever two
   consecutive PRINTED rows jump — computed after the hidden rows come off, so
   Total Liquid at 99 leaves its gap behind rather than absorbing one.
   **CREATED is FileMaker's date and MODIFIED is not printed at all.**
   `created_at` defaulted to `now()`, so after the load every recipe claimed to
   have been written the day the migration ran — harmless in a database and a
   lie on a page that states it. `migration/backfill-recipe-created.mjs` dated
   all **493 versions** from `_CreationTimestamp` (span 2022-01-25 → 2026-07-21)
   and parked `_ModificationTimestamp` in `source_payload.fmp_modified_at`.
   MODIFIED stays off the sheet because `updated_at` is trigger-maintained and
   says when the ROW changed — the load, for everything migrated — while FMP's
   says when the RECIPE changed. Two different facts, one label, no column yet.
   Verified by rendering the real v10 through the real component in Node over
   live rows (the `PoPdf` idiom) and comparing against Mark's own printout: every
   amount, every unit, every group break and all three metadata rows match.
   **The recipe record became TWO TABS 2026-08-08 (migration 042, APPLIED)**, with FileMaker's RECIPES > INFO tab beside it. `ui/SectionNav` —
   Info · Recipe — the employee record's pattern reused rather than re-derived,
   which is what Mark asked for when that shipped. Ingredients and procedure
   moved to Recipe; Info carries the version's fields, the VERSIONS list and the
   COSTS matrix, neither of which existed here at all.
   **BOTH THE TAB AND THE VERSION LIVE IN THE URL** (`?tab=recipe&v=11`), and
   the version had to move there with it: it was client state, which a soft
   navigation between tabs discards, so reading v24 and switching tabs would
   have dropped you silently back to the master. `lib/recipes.ts` holds the
   three pure helpers (`parseRecipeTab`, `parseRecipeVersion`, `recipeHref`),
   fixture-tested; the defaults write NO parameter, so the record keeps one
   canonical address. The version LABEL and not the id — `?v=11` is a URL a
   person can check, and a label matching nothing falls through to the master.
   **The COSTS matrix is a matrix, not a `DataTable`** (`/price-grid`'s call): a
   row is a kind of figure and a column is a batch size. **INGREDIENTS SCALE AND
   LABOUR DOES NOT**, which is the whole reason FileMaker prints five columns
   instead of one figure — labour is the prep-time ROW (041's typed strip)
   times the WORKING SHOP's `locations.labor_rate`, so cost per unit falls
   sharply as the batch grows. Verified against FMP's own block on Raisied Donut
   v11: labour **$96.25 / $105.00 / $113.75 / $122.50** and yield
   **34 / 170 / 255 / 340** match to the cent, and our ingredient figures are
   lower by exactly the one element the catalog cannot price (Seed Dough) —
   which is the 209-element backlog showing through, not an arithmetic error.
   **042's `cost_column` is a SLOT NUMBER, not a label**, for the same reason
   `ScaleColumn` carries its slot: labels are editable content, and renaming a
   batch would otherwise move which one the recipe is costed at. Null means the
   base column. It drives the block only — **it deliberately does NOT change
   what `lib/productionCost` charges for an element**, because cost per unit is
   (batch ÷ yield) and both scale together, so the answer differs only where the
   yield row is one AUTO was turned off for. Wiring the two together is a real
   follow-up and a costing change; make it deliberately, with fixtures.
   Also new on Info: **Make master**, which is TWO STATEMENTS and the order is
   load-bearing — 036 enforces one master per family with a PARTIAL UNIQUE
   INDEX, so the old flag must be cleared BEFORE the new one is set or the write
   trips the index. Both `.select()` their own result.
   Labour rate is fetched in the page's own `Promise.all` rather than folded
   into `getAppSession`: one column read by one screen, against a session every
   screen pays for.
   **BOTH RECIPE TABS ARE ONE SCREEN OF PANES** (Mark, 2026-08-08). Info: the
   fields, then NOTES down the left with VERSIONS over COSTS down the right
   (Mark's second pass the same day — "move the versions section across from
   Notes and above Costs"; it had been Notes across the top with Versions beside
   Costs). Recipe: Ingredients over Procedure, each scrolling its own rows.
   **Both areas split HALF AND HALF** so the boundary runs straight down the page
   — the fields as two `dl`s rather than one four-track grid, because a single
   grid ties both sides to the same row heights and a long description would push
   Storage's value down to meet it.
   **THE VERSION NOTE IS ITS OWN ELEMENT, OUTSIDE THE SCROLLER** (Mark, same
   pass). It shared one `overflow-y-auto` box with the testing notes and they are
   not the same kind of writing: the version note is one line naming what this
   version IS ("v09 scaled to 2000g"), the first thing you read and always worth
   having on screen, where testing notes accumulate over years — Chocolate Glaze
   v50 carries 844px of them — and are what the scrolling is for. Sharing a box
   let the note be scrolled out of sight by prose about a version it names.
   **VERSIONS SHRINKS AND NEVER GROWS** (`flex-initial`, not `flex-1`). Given a
   share of the column it stretched to the frame's full height for a recipe with
   ONE version and left Costs stranded 600px below — which is not "above Costs".
   Sized to its content it sits directly on the matrix, and `min-h-0` is what
   lets a 38-version family give the room back and scroll instead. Its inner
   scroller is `flex-initial` for the mirror reason: `flex-1` is `flex: 1 1 0%`,
   and a basis of 0 inside a section now sized by its CONTENT means the section
   has no content, so the list collapses to its heading.
   **THE ROW IS SIZED BY THE RIGHT COLUMN, NOT BY THE WINDOW** (Mark, third pass
   the same day: "versions doesn't need to be so tall. It could probably be the
   same height as Costs, and then Notes can be tall enough so its bottom is
   aligned with the bottom of costs"). Filling the viewport meant SOMETHING had
   to absorb the leftover, and the only block that could give was the versions
   list — so a 38-version family got a 505px pane of 44px rows and the two
   columns ended level with the foot of the SCREEN rather than with the last line
   of the matrix. Two measurements do it, and **both arrows point one way, which
   is what stops it becoming another fixed point**: Versions is capped to the
   MEASURED height of Costs, and Notes is given the MEASURED height of the right
   column. Costs never reads the list above it and the right column never reads
   Notes. **`xl:items-start` is load-bearing** — without it the grid stretches
   the right column to the row, making its height depend on the very thing
   derived from it.
   The cap is measured rather than written down because the matrix's heading
   WRAPS when a recipe has unpriced elements to name: 324px on Chocolate Glaze,
   340 on Banana Cake Donut. It is also bounded by the window, so the tab still
   opens as one screen where it can — at 1100px the pair would want 672 in 552 of
   room, and the list gives up the 120 rather than the page scrolling (floor 132,
   three rows, past which the page scrolls instead). Verified: 1500px window →
   both blocks 324 and Notes 680, bottoms level to 1px; 1100px → versions 197,
   page exactly one viewport; one-version recipe → versions 112, Notes 484,
   bottoms level to 0px. Below `xl` both overrides are CLEARED and the page
   scrolls.
   **`useExactViewportHeight` — the DEFINITE-height sibling of
   `useFillViewportHeight`, and TWO things separate them, both paid for by a
   blank screen.** First: a `max-height` alone leaves the box content-sized, and
   a child with `basis-0 grow` has no content height to fall back on, so a column
   of proportional panes collapses to NOTHING. Second, and subtler: **it must
   never probe with `height: auto`.** The cap can measure that way safely,
   because on a box shorter than its cap `max-height: none` changes no layout and
   the ResizeObserver settles. A definite height cannot — setting it to `auto`
   genuinely resizes the page, which fires the observer, which probes again, and
   the element spends as much time at `auto` as at its target. With `basis-0
   grow` children, `auto` means zero, so what you see is whichever frame the
   browser painted. Nothing needs the probe: `rect.top` is decided by what sits
   ABOVE the element, and what sits BELOW is stable once the height is applied,
   so the second pass computes the same target and the >1px guard ends it.
   Reach for the cap when a pane should be as tall as its rows and no taller;
   reach for the exact one when several panes SHARE a height.
   **BUT REFUSING THE PROBE MEANT REFUSING THE CAP'S OWN CURE, and that shipped
   a frame stuck at its floor** (Mark, 2026-08-08: "why is there so little height
   on the Ingredient and procedure section?"). Both hooks asked
   `body.bottom - rect.bottom` for what sits below, and `body` is `min-h-full`,
   so on a page shorter than the window its bottom edge is the foot of the
   VIEWPORT and every pixel of slack counts as content. `below` absorbs the
   slack, `innerHeight - top - below` returns EXACTLY the height the element
   already has, and the measurement is a FIXED POINT at whatever it started
   at — which for a column of `basis-0 grow` panes is ZERO, because they have no
   content height before a definite one is written, so the floor is where it
   stops. The cap escapes by dropping `max-height` first, which makes the page
   overflow again so the body tells the truth; the exact hook cannot, and had no
   defence at all. Measured: the Recipe tab's frame sat at its 360px floor in a
   720px window with 71px of white underneath, showing three sticky header rows
   and not one ingredient.
   So `spaceBelow` in `lib/tableHead` walks the ancestors instead and adds up
   what really follows — at each level the gap from our bottom to the bottom-most
   later sibling, plus that level's own bottom padding and border, skipping
   out-of-flow siblings. Every one of those distances is INDEPENDENT of our
   height, which is what keeps the answer stable. Verified: 1000px window →
   679.5px frame (1000 − 288.5 top − 32 layout padding), two 320px halves, page
   exactly one viewport; 1400px window → 1079.5 and two 520s. **The cap still
   asks the body**, masked by its probe — a latent version of the same bug, worth
   remembering if a `useFillViewportHeight` pane is ever mysteriously short.
   **The viewport measurement IS gated on width — at `xl`, where the two columns
   exist.** Below it the blocks stack in ONE column and a height there either
   clips them or hands an iPad three ~250px panes inside a scrolling page.
   Stacked, the page scrolls, and the stretch classes go with it
   (`flex-initial xl:flex-1`, or a basis of 0 in an auto-height column collapses
   the block). This is NOT the gate removed earlier the same day for leaving
   height unused (Mark: "so much height unused") — that symptom was the fixed
   point above, which left the frame at its floor at EVERY width; ungating it
   only made a narrow window wrong a second way. The RECIPE tab stays ungated
   and keeps `useExactViewportHeight`: it is two lists sharing a column at any
   width, and there the even split IS the answer. Short windows are handled by a
   FLOOR — 360 on the Recipe frame, 132 on the Info tab's versions cap — past
   which the page scrolls, which is the honest failure.
   Other traps paid for here: **`min-w-0` on both columns and NOT behind a
   breakpoint**, or the costs matrix's own `minWidth` stops its track shrinking
   and pushes the PAGE sideways; the ingredient grid's **one scroller for both
   axes**, since `position: sticky` resolves against the nearest scroll
   container and a separate horizontal wrapper pins the labels to a box that
   never scrolls vertically; and its **three header rows stack their sticky
   offsets** (0 / 26 / 62px, measured).
   **THE INFO TAB IS ONE SCREEN** (Mark, 2026-08-08: "ideally everything should
   display on a single screen. Notes and versions should scroll"). The fields sit
   at their natural height; below them a row takes whatever is left, holding
   NOTES down the left and VERSIONS over COSTS down the right — see the
   arrangement note above, which supersedes the `basis-0 grow` / `grow-[1.5]`
   left column this line originally described. Height is MEASURED
   (`useExactViewportHeight`) and only above `xl`; stacked, the page scrolls.
   **`min-w-0` ON BOTH COLUMNS, not behind a breakpoint** — a flex item's
   min-width defaults to min-content, so the matrix's own `minWidth` made its
   column refuse to shrink and pushed the whole PAGE sideways. And the costs pane
   is sized to the matrix (`xl:w-[32rem]`) rather than to a share of the row:
   given a fraction it came out 394px for a 508px matrix, so the one block whose
   point is the comparison across it had to be scrolled to be read.
   **THE RECORD'S COMMANDS ARE ONE ACTIONS MENU IN THE TITLE ROW** (Mark,
   2026-09-12): New Recipe… · Duplicate Recipe · Add Ingredient… · Add
   Procedure… · Print Sheet · Delete Recipe… (red), `RecipeCommandMenu`.
   `NewRecipe` and `PrintRecipe` hand out rows through a `children` render
   prop. **Duplicate** (`recipeWrites`) copies the family whole — every
   version, line and step, each step picture as its OWN storage object — by
   `select("*")` minus id, timestamps, `legacy_id` and `source_payload`, and
   KEEPS the original's Active flag: costing takes an element's first family BY
   NAME, and "… copy" sorts after. **Delete** counts versions, lines, steps and
   the batch-log entries that lose their version link (044's `set null`), then
   deletes row first, pictures second. **The pinned add rows under the two
   lists are gone** ("free up some space"), and **both adds are DIALOGS**
   (Mark, the same day): Add Ingredient… asks for the element (a typed name
   the catalog lacks still writes `label`, via `ingredientChoice`) with an
   optional amount and unit, Add Procedure… for the step's text (⌘↵ adds).
   Both write against the version on screen, sort last-plus-ten, and take you
   to their tab once the row is in. `AddRecipeRow` is deleted.
   **The Batch cost fact at the top is GONE** (Mark, 2026-08-12: "batch cost in
   this screenshot isn't useful information (it's also wrong as it doesn't
   include labor …). You can get rid of it"). It quoted the matrix's INGREDIENTS
   row, so on Raisied Donut v11 it read $57.08 three inches above the block's
   own subtotal of $179.58 at the same column — one figure short of the labour.
   The chosen column's state stays in `RecipeInfo`: it is the block's own
   selection, lifting it costs nothing, and pushing it down would mean the
   matrix computed in two places. **Item is the ingredient grid's SECOND column**, after Sort, the
   multiplier row is a single `×` centred over the AUTO column it governs, and
   **AUTO is a CHECKBOX** — Mark, 2026-08-08: "we have both toggle switches and
   check boxes in the ingredient list. Pick one." Two shapes for one kind of
   answer on one row is just something else to read; the box matches FileMaker,
   matches HIDE beside it, and costs a third of a switch's width. (Since
   2026-09-11 there are no switches at all — every one became `ui/Checkbox
   size="lg"`.)
   **MODIFIED is FileMaker's stamp where we have one** (`fmp_modified_at`, parked
   in `source_payload` by `backfill-recipe-created.mjs`), and `updated_at` where
   we don't. That order is right today — for every migrated recipe `updated_at`
   is the moment the migration ran — and it has a known cost: editing a migrated
   version here will NOT move the date, because nothing clears the stored stamp.
   Giving `_ModificationTimestamp` its own column is the fix and it is a
   migration.
   **MIXER, YIELD AND PREP TIME ARE GONE FROM THE INFO BLOCK** (Mark,
   2026-08-08) — and from the printed sheet's header, which is the same
   instruction applied twice. All three are per BATCH SIZE and are rows on the
   Recipe tab; a single value beside them was the same fact stated twice and, on
   Raisied Donut v11, stated differently (30 ea against a row reading 34 → 340).
   `mixer_size` and `prep_time` now have NO reader in `web/src` at all — the
   columns keep FileMaker's single value and the transform still fills them.
   **The costed yield moved to the COSTS block rather than going with them**,
   which is the one part of this that isn't a deletion. At the time `yield_amount`
   was what `lib/productionCost` divided by, so deleting its only editor would
   have left the number behind every figure the app quotes invisible and
   unfixable. **That follow-up has since been taken — see "THE YIELD IS THE
   RECIPE'S OWN ROW" below** — so the column no longer costs anything, and the
   editor in the Costs block is now a display of FileMaker's single value.
   Whether it earns its place there at all is worth a look.

   **THE YIELD IS THE RECIPE'S OWN "EXPECTED YIELD" ROW, AT THE COLUMN THE
   RECIPE IS COSTED AT** (Mark, 2026-08-12: "we should not use
   production_recipe_versions.yield_amount to determine costs. we should use the
   recipe yield number, always and forever" — then, seeing the block: "use the
   yield in the column that is chosen for costing").
   `elementCost` divides a made element's batch by
   `metadataLine(version.lines, "yield")` at 042's `cost_column`, and
   `CostVersion` no longer CARRIES
   `yield_amount` / `yield_unit` — which is the guarantee rather than a tidy-up:
   a caller cannot supply the column, so the resolver cannot read it. The graph
   loader stopped selecting it too.
   Why the row wins: it is what the kitchen reads, it is on the printed sheet,
   it is per batch size, and it is maintained by whoever maintains the recipe.
   The column is FileMaker's single `Yield` field, lifted once at migration and
   edited by almost nobody since. Two answers to one question, and they
   disagree — measured over the 128 masters, **84 agree, 19 differ, 25 have
   neither**, and where they differ the gap is not small.
   Measured through the real resolver over the live catalog, both ways: **20
   made elements moved, 0 lost a cost, 0 gained one.** Lemon Curd $0.0928 →
   $1.3535 (the column said 35 where the row says 2.4), the cake donuts double
   (30 against 15), Vanilla Cake Donut halves, Raised Donut $0.2074 → $0.1830.
   Units were checked before the switch and agree on all 103 masters carrying
   both; the 3 exceptions are null on both sides, so `unit` comes from the row
   too with nothing to lose.
   Two guards moved with it, each fixture-tested by breaking it. A **zero**
   yield is refused rather than dividing by it. And **"no ingredients" now asks
   whether any line carries an `element_id`**, not whether `lines` is empty —
   the yield row IS a line, so the old test would have let a version of nothing
   but metadata rows come back as an unexplained null, which is the one outcome
   that module exists to prevent. `elementCost` also reports the BATCH's own
   reasons before "no yield": an empty recipe has neither, and "no ingredients"
   is the more useful thing to say first.
   **INGREDIENTS AND YIELD MOVE TOGETHER OR THE ANSWER IS OUT BY THE
   MULTIPLIER.** `versionBatchCost` sums each line's `qty`, which is the BASE
   column, so costing at x1 means scaling that by the column's multiplier as
   well as taking that column's yield. Raisied Donut v11 is the worked example:
   $5.71 over 34, or $57.08 over 340 at x1 — take one without the other and it
   is a tenth or ten times the truth. Which is also why choosing a column
   USUALLY changes nothing: both sides scale by the same multiplier and cancel.
   Measured over the live catalog, base versus chosen: **100 made elements the
   same, 0 different** — only one version carries a `cost_column` at all and its
   yield strip is proportional. It matters exactly where the yield row is one
   somebody turned AUTO off for and typed (30 of the 493 versions), and there
   the chosen column is the only honest answer. The `%` column can never be the
   costed one, and a `cost_column` pointing at a slot the strip no longer has
   falls back to the base — `recipeCosts` falls back the same way, so the block
   and the element always quote the same column.
   **The "Costed yield" field is GONE from the Costs block** (Mark, 2026-08-12:
   "redundant and unnecessary because the user can already choose the batch size
   for costing purposes"). `yield_amount` now has NO editor anywhere in the app
   and exactly one reader — the recipes LIST's Yield column, which is still
   FileMaker's single value and may disagree with the row.
   **THERE IS ONE COST CALCULATION AND IT IS `recipeCostMatrix`** (Mark,
   2026-08-12: "why are you reinventing the wheel? The cost per each is already
   a calculated value … Just do one calculation (that includes labor) and use it
   everywhere" — then "use the value in the cost matrix"). It lives in
   `lib/productionCost`, NOT in `lib/recipeCosts`, which is now a re-export shim
   for the components: what an element costs and what the block prints are the
   same call at the same column, so the arithmetic belongs in the costing module
   and the block is a view of it.
   The drift it removes was real and shipped: the block said **$0.53** a donut
   while `elementCost` said **$0.17**, and the whole of the difference was
   $122.50 of prep time nobody was charging for. `elementCost` now reads
   `defaultColumn(matrix).costPer`, so a made element's cost INCLUDES ITS
   LABOUR — the prep-time row times the hourly rate, over the yield like
   everything else. Measured at DF01's $35/hr: **69 made elements unchanged, 31
   gained labour, 0 newly costed**, and Raised Donut reads $0.5282 where the
   block reads $0.53. Some of the 31 move enormously (Candied Walnut Topping
   ×52, Hot Fudge ×25) — that is a signal about small or wrong Expected Yield
   rows, not about the rule, and it is worth walking.
   **`CostContext` replaced the bare `locationId`** on `elementCost`,
   `versionBatchCost`, `lineCost` and `itemCost`. Both halves are per-shop
   (Mark, 2026-08-12, after trying the opposite for ten minutes: "each location
   has its own vendor item and labor costs") — design rule 6's price override,
   and `locations.labor_rate`. So the same recipe at DF01 and DF02 legitimately
   costs different amounts to make. `costContext(session.activeLocation)` is the
   one line a caller needs, and `locations.labor_rate` now rides on the session
   rather than being fetched per screen: it went from one column read by one
   screen to one read by every screen that quotes a cost.
   **A version with NO scale strip gets an implicit base column.** 11 of the 493
   carry no labels, and an empty column list would have made them cost nothing
   and render an empty block. The synthesised column is unnamed on purpose —
   inventing "Base" would put a word on the sheet FileMaker never had.
   `METADATA_LABELS` / `metadataLine` moved from `lib/recipeCosts` to
   `lib/production` when both cost modules needed them — `lib/production`
   imports nothing, which is what keeps the two from becoming a cycle.
   **Still open, and it is DATA rather than code:** Raised Donut's row says 34
   where Mark's own packet arithmetic says a batch makes 340, so its per-donut
   cost is an order of magnitude light. The rule now makes that fixable in one
   visible place — the row on the Ingredients tab — instead of in a column
   nobody reads.
   Exercised against the live database and left as found: the radio wrote
   `cost_column = 2`, the mark moved, the headline re-quoted at x3/4, and it was
   set back to null (0 versions carry one).
   **THE PAR MOVED ONTO THE PLAN SLOT 2026-08-08 (migration 043, NEEDS
   APPLYING).** Mark: "production pars should probably live here in the plan
   rather than off the production item… each tray would have two fields instead
   of one: [production_item] [par]." A slot is already keyed (tray, weekday,
   item) and a plan carries the selling location, so the par lands on exactly
   the axes it needs — and the old home stated the weekday axis TWICE. Measured
   before the change: **184 of 311 par arrays vary by weekday**
   (`DF01 [18,18,18,18,24,36,36]`, the weekend ramp), so that second axis
   carried real information and duplicated the plan's own. Done at the cheapest
   possible moment — 1 plan, 2 trays, 1 slot, 0 overrides, 0 schedules, so
   nothing to data-migrate.
   **THREE STATES, AND THEY ARE THE ORDER GUIDE'S THREE.** A number makes it; a
   deliberate **0** means "on the menu, making none" and reads as SUPPRESSED,
   keeping its tray position (taking it off the tray is how you say it is off
   the menu); **null** is silence, a yellow "—", and the day says "no par set".
   Zero and null being different sentences is the whole point, and
   `slotParLabel` exists so the classic `par || "—"` can't quietly merge them.
   **`production_item_locations.par_by_weekday` is now a SEED, not a source**
   (013's shape — a PO line snapshots its price and then owns it). Adding an
   item to a Saturday cell at DF01 prefills from that item's Saturday default;
   nothing reads the array again. **A default of ZERO seeds NULL**
   (`nullif`, both in the backfill and in `defaultParFor`): an old-array zero
   meant "we don't make it that day", which is silence, and seeding it through
   would manufacture a decision nobody made. The invariant: **a suppressed line
   always traces back to a human act on the plan.** Measured — only 3 zero slots
   exist in the whole dataset, none at DF01 or DF02, so that rule is chosen for
   the invariant rather than the data. **No `par_source` on the slot**: nothing
   rewrites a plan slot, so a seeded number is just the number you accepted.
   The column is dropped LATER, once real plans carry the numbers.
   Two SQL hunks beyond the column, each guarding a specific failure:
   **the reason pick in `production_day`'s `planned` CTE** now yields a reason
   only when nothing in the group can be made — with the par on the slot two
   plans genuinely disagree, and the old arbitrary pick would print "making none
   today" beside a par of twelve (under 040 every row in a group read the SAME
   array cell, so the pick was harmless); and **`is_suppressed` is
   `coalesce`d** — `sum()` over all-null pars is NULL, `not NULL` is not false,
   and that expression is filtered on in FOUR places in
   `generate_production_schedules`. `generate_production_schedules` itself is
   UNCHANGED.
   Known consequence, accepted: the receipt's `not_made` warning now fires for
   every deliberately-zeroed slot, every night. If that gets noisy the fix is a
   distinct warning kind, not silence.
   **FOUND, NOT FIXED — an item switched off at a shop STILL GETS MADE.**
   `is_makeable` is not one of `production_day`'s return columns and never has
   been, and the fold has never consulted it; generation filters on
   `par > 0 and not is_suppressed`. So `il.is_active` produces the sentence
   "item inactive at this shop" and gates nothing — under 040 exactly as now.
   Latent today (**0 of 307 items and 0 of 325 item-locations are inactive**),
   which is why it was left alone rather than folded into a migration about
   where the par lives. **Ask Mark before changing it**; the honest options are
   to let a structurally-unavailable item read as suppressed, or to gate
   generation on `is_makeable`.
   Verified: all 43 migrations apply on the Docker harness, `security_invoker`
   and the `authenticated` grant both survive the view's drop-and-recreate,
   every row of the suppression table asserts (including the two behaviour
   changes — an item with NO item-location row now makes, and a zero on one
   plan is not a veto over another plan's twelve), no `is_suppressed` is ever
   null, generation writes 5 lines totalling 72 with each refusal named in its
   own words, a regeneration deletes the newly-zeroed line while keeping a
   `manual` line and carrying actuals forward, the actuals refusal raises, and
   as real authenticated roles **staff read 15 slots and update 0 with NO
   error** while a purchaser updates 15 and `anon` gets 0 rows from the view
   and is refused `production_day` outright. **671 fixtures pass**, and each of
   the five new rules was checked by breaking it.
   Until 043 is applied the plan record SAYS SO — "column
   production_plan_tray_items.par does not exist — migration 043 has not been
   applied yet" (verified in the browser), rather than rendering an empty
   matrix, which would be a false claim about the menu.
   **043 IS APPLIED** (Mark, 2026-08-08). The backfill seeded the existing slot
   and the app seeded the rest: DF01's Angry Samoa came through as
   **18·18·18·18·24·36·36**, the weekend ramp, which is the ISO subscript proved
   on real data rather than only in a fixture.
   **THE MATRIX GREW FMP'S PAR CONTROLS the same day** (Mark, after using it).
   Five changes, all his.
   **The table is `table-fixed`** — it never was, so widths were suggestions the
   content could override and a long item name stretched its own column. Tray is
   60px (half what it was) and the seven days split what's left evenly.
   **Two STACKED STEPPERS beside every par**, up and down, and a second pair
   that moves the whole row — the latter at the END of the row, left of the ⋯
   (Mark, 2026-08-08), so the two controls that act on the TRAY sit together
   rather than one at each margin. The tray column gave up exactly what the
   controls column took (60/40 → 40/60), so the seven days are unchanged, and
   the 16+4+36 cluster fits its column exactly.
   That row stepper carries **`mt-[5px]`**, which is the chip's 1px border plus
   its 4px top padding — the two things between a day cell's top and the stepper
   inside it — so it sits on the same line as every per-day stepper in its row
   rather than 5px above them (Mark: "a little high"). Measured, not guessed; if
   the chip's padding moves, this moves with it.
   The tray column's header is **"#"** (Mark), the word being wider than the
   40px column it labelled, with an `sr-only` "Tray" beside it because a screen
   reader saying "number sign" names nothing. **They step by the item's
   own `tally_box_size`** (037, default 6, per item) rather than a hardcoded 6 —
   Mark's "always 6" and the tally strip's 6 are the same fact, a box of donuts,
   so an item later set to tray in twelves plans in twelves for free.
   **ZERO IS THE FLOOR** and **NULL COUNTS AS ZERO**: up from silence is one
   box, down from it is a deliberate none. That does not violate the
   suppressed-lines-trace-to-a-human rule — pressing a stepper IS the human act.
   The row stepper GROUPS BY RESULTING VALUE, so a tray's seven days are two or
   three updates rather than a dozen; each item brings its own box size.
   **Drag an item to another slot** (`lib/planSlotDrag`, `useColumnDrag`'s shape
   and its reasons: pointer events, never HTML5 DnD; state changes twice per
   drag; every cell measured ONCE at pointer-down).
   **THE DESTINATION OFFERS TWO DROP ZONES — Move left, Copy right** (Mark's
   idea, 2026-08-08). Both outcomes are on screen and labelled, so there is no
   invisible rule to know, and — the reason it earns its complexity — **copy
   becomes reachable on TOUCH**, which a modifier key never was. Option still
   forces a copy for the muscle memory, and while it is held BOTH zones relabel
   to "Copy", so the screen never says one thing and does another.
   That was chosen over splitting the zones by PAR (keep vs default), which was
   the first proposal. The par question is answered one tap later and is
   reversible; copy-on-touch is a capability that otherwise does not exist. Two
   zones also stay two — splitting by par as well would have meant four targets
   in a 153px cell, geometry that collapses to one zone whenever the default
   agrees, and a mis-hit that produces a silently wrong number instead of a
   visible extra chip.
   **THE PAR ALWAYS TRAVELS**, move or copy: it is the number you typed, a
   reposition must not rewrite it, and re-reading the default would undo what
   043 made a seed. Where the destination's default DISAGREES it is offered
   afterwards — `→ use default 24` on that slot, the receiving screen's idiom,
   held in `landed` state rather than derived (plenty of slots legitimately
   differ; this is about the ones you just moved).
   **IT STAYS UNTIL DISMISSED** (Mark, 2026-08-08). It first cleared on your next
   action, on the reasoning that an offer nobody answers should not linger — but
   that made moving three items and then touching anything lose the question
   before you had answered it, and the whole point of offering rather than
   applying is that you decide in your own time. So `landed` is a RECORD keyed by
   row: a run of drags leaves a run of offers, each with its own ✕, and taking
   one settles it. Two things keep it honest without a sweeper: the offer only
   renders while it still DISAGREES with the slot's par, so any other route to
   that number retires it silently; and a key for a slot that no longer exists
   simply never renders. It sits on its OWN line, which does not breach
   the one-line rule: that rule is about the chip at REST, and squeezed onto the
   main line the offer broke "Angry Samoa" into "Angr/y/Sam/oa".
   **Only the item NAME is a handle**, since the chip now also holds two
   steppers, the par's own `InlineValue` and the ✕. The chip relabels itself
   "Copy …" while Option is down, and it listens for keydown/keyup as well as
   pointermove — pressing Option without moving fires no pointer event at all.
   **Duplicate a tray**, and — because that was a one-way door — **delete one**,
   both in a **`ui/RowMenu`** in a 40px column at the END of the row (Mark,
   2026-08-08, replacing a pair of Copy/Del links that appeared on hover beside
   the tray number: "more discoverable", and worth the horizontal space). It is
   the app's own ⋯ idiom, so it costs nothing to learn, anchors right, and
   escapes the table the way `PickList` does.
   `nextTrayNumber` counts a numeric label UP keeping its width and skips the
   ones in use ("01" duplicated past a taken "02" becomes "03"); anything else
   ("7A") takes a suffix, because incrementing a non-number is guesswork. The
   tray is written BEFORE its slots — a tray with nothing on it is visible and
   one gesture from fixed, where slots with no tray cannot exist. Delete is
   `window.confirm` naming what goes ("…and the 7 items on it?"), the PO
   batch-delete pattern; 039's slots cascade from the tray.
   **THE CHIP IS ONE LINE OF TWO GROUPS** (Mark, 2026-08-08):
   `[item ✕] [par ▲▼]`. The ✕ belongs with the thing it removes and the steppers
   with the number they move, so each pair reads as a pair — which the original
   `name · steppers · par · ✕` did not, having interleaved the two. **Written as
   two stacked lines first and corrected**: Mark's brackets were GROUPS, not
   rows. The ✕ occupies its 10px whether or not it is showing, so revealing it on
   hover shifts nothing. Known cost of one line, and his call: at ≤1280px the
   name gets ~63px of a 139px chip and wraps to two lines; by 1680 it has 120px
   and does not.
   **The steppers lost their borders** so the arrows could grow (7px → 11px). A
   box around a 7px glyph spends most of its width on the box, and two stacked
   read as something to decipher; bare arrows are the affordance, darkening on
   hover like every other quiet control here.
   **"+ add" OPENS THE LIST** (Mark, 2026-08-08: "right now it's a two click
   process"). `ui/PickList` gained **`defaultOpen`** — the panel is up as soon as
   it renders, because pressing the button already said you want to choose
   something — and **`onClose`**, which fires only on the DISMISS path (Escape,
   click away, or pressing the trigger again) and NOT on a pick, so the matrix
   can put "+ add" back rather than leaving an empty field where the command
   was. Since 307 items make the list searchable, the cursor lands in the find
   box ready to type. Only ever pass `defaultOpen` to a picker a deliberate act
   summoned; a list that opens itself on load is a popup.
   The Trays block's explanatory paragraph is GONE (Mark).
   **THE RECORD'S BLOCK IS Sells at | Made at · Starts | Ends · Notes** (Mark,
   2026-09-09, in two passes). The first swapped the three fields around and
   moved the date range beside the TITLE, in parentheses and unlabelled — a plan
   is identified by what it is called AND when it runs, and "Fall 2026 - DF02"
   alone does not say which autumn. It stays a rendering of
   `starts_on`/`ends_on`, which are edited two rows below; a second editor up
   there would be two answers to one question.
   **`Made at` IS A SIGNPOST, NOT A FIELD** — it reads "Set below, per day." and
   is read-only. 101 moved the kitchen onto the seven day columns and took this
   row out of the block with it, which left the record silent about where
   anything is MADE: a reader met `MON DF01 ⌄` in the header with nothing having
   told them DF01 was a kitchen (Mark: "it's unclear what the kitchen picker is
   doing"). The row says where the answer lives and that there are seven of
   them. An EDITOR here would be exactly the single "Made at" 101 deliberately
   dropped — one field claiming to answer a question that now has seven answers,
   016's `nextDeliveryDate` trap — so it must stay text. `READ_ONLY_VALUE` gives
   it the editable cells' padding, or the column kinks.
   **NOTES RUNS THE WHOLE ROW** (Mark, 2026-09-09) — `Row`'s new `wide`, which
   is `sm:col-span-3` on the VALUE and never on the label, the label column
   being what makes every row in the block line up. At `sm` this `dl` is four
   tracks (label · value · label · value), so a row alone on its line otherwise
   stops halfway and leaves the right half blank; the span takes it across the
   remaining three. Breakpoint-scoped because below `sm` there are only two
   tracks and the value is already the last.
   Measured at 1280: two rows of two over one, both label columns aligned
   (left 55.5, right 359.8), the pointer text centred in its row, Notes
   starting on the same left edge as every other value and ending on the grid's
   own right edge — 448.5px against a normal value's 144.3 — and the page not
   overflowing.
   **EACH DAY COLUMN'S HEADER IS `MON DF01 ⌄` CENTRED, WITH `Clear` CENTRED
   BENEATH IT** (Mark, 2026-09-09, in seven passes — the Clear command, centre
   the day, caption the picker, put the label inline, "not liking this, let's
   try a different design", bigger type with Clear unboxed, and finally the pair
   together rather than pushed to opposite edges).
   **EVERYTHING SHARES ONE AXIS DOWN THE MIDDLE OF THE COLUMN.** Day-left /
   kitchen-right put two edges in play and made the pair read as two separate
   facts rather than as "Monday, at DF01" — which is one fact, and the reason
   the picker needs no label.
   **THE PAIR IS 13px, NOT THE 11 EVERY OTHER LIST'S COLUMN LABELS USE.** This
   header is not a row of labels — it is a day and a shop you READ AND PRESS —
   so it matches the table body's own size rather than the caption scale. 14px
   also fits at every width (day 39.1, picker 53.4, header 60px against 58.5) if
   it is ever wanted bigger. `Clear` stays 10px: it is a command beneath the
   pair, not part of it.
   **THE FOUR EARLIER ARRANGEMENTS ALL LOST THE SAME ARGUMENT WITH THE COLUMN'S
   WIDTH**, and the numbers are worth keeping because they are what settles any
   future attempt. A cell is 165px wide at a 1440 window, 142 at 1280, 128 at
   1100 and 117 at 1024. A day (31px), a `Kitchen:` label (47), a picker (45,
   54 on a five-letter code) and a bordered Clear (50) cannot share one line:
   three of them want 150px and clip at 1280. THE FINAL PAIR WANTS 77px, so
   nothing truncates at any width down to a 900px window — day, code and Clear
   all whole, measured at five.
   **THE PICKER CARRIES NO LABEL** because it is the only thing on the row that
   names a shop and the day beside it says what it is about. That is what buys
   the room, and it is why the label went: it was 39px sentence case and 55px in
   the app's small-caps caption dress, which clipped on every column at every
   width including 1440.
   **`w-fit shrink-0` ON THE PICKER'S PEN, AND IT IS TWO BUGS AT ONCE.**
   `PickList`'s inline trigger is `w-full`, so left to flex against the row it
   (a) renders the width of the whole cell for a four-character code — Mark:
   "way wider than it needs to be" — and (b) claims the line as its flex basis
   and starves whatever sits beside it to ZERO PIXELS, which is invisible in
   review and was caught only by measuring. Penned, it is 45.5px at every width.
   **THE EMPHASIS IS COLOUR, NOT WEIGHT** — ink where another shop bakes this
   day, muted where it is the shop's own. It carried `font-semibold` until this
   pass, which inside a `th` (bold by default, measured at 700) was LIGHTER than
   everything around it and so read as an inconsistency rather than as emphasis.
   The plans list's own Made at column still uses weight, having no day beside
   it to match.
   **`Clear` takes every item off that weekday across every tray**, after a
   confirm naming the day and the count — a day is how a plan is read and how it
   is rebuilt, so "start Monday again" was otherwise a ✕ per slot down
   twenty-four trays. Scoped from `slots`, this plan's own rows, rather than
   from `matrix`, which grouping reorders: what is cleared is the DAY, not what
   happens to be on screen. Rendered on every day and DISABLED on an empty one
   rather than hidden (`NewTimesheet`'s rule), the reason being the empty column
   beneath it. It was BORDERED for one arrangement and is not now (both Mark's,
   an hour apart): the box earned its keep while Clear sat INLINE beside a label
   and a value, where an unboxed word reads as more annotation — centred on a
   line of its own under a 13px pair, its position and the space around it say
   it is a control and the border was only weight. It keeps this file's quiet
   dress, `text-subtle hover:text-ink`. Never `BUTTON_CLASS`, which is `h-9` and
   would double the header.
   Verified at 1440 / 1280 / 1100 / 1024: nothing truncated anywhere — the pair
   wants 95px (day 36.5, gap 8, picker 50.8) against 165px of cell at the top
   width and 117 at the bottom — with the pair AND Clear both centred to 0.00px
   in all seven columns, header 58.5px, and the table never overflowing its
   pane. At a 900px window one column's pair overflows by 7px, and only where
   the kitchen is a FIVE-letter code (`EVENT`, picker 62): no real kitchen is,
   and the matrix is not used that narrow.
   **The PLAN LIST has a ⋯ too — Duplicate plan and Delete plan** (Mark,
   2026-08-08), the same `ui/RowMenu` in an unlabelled last column, which keeps
   it out of the Columns menu because it is a control rather than a field.
   **THE LIST SAYS WHICH PLAN IS IN FORCE — a CURRENT chip beside the title and
   a Current tier** (Mark, 2026-09-07). The list said whether a plan was ACTIVE
   and never whether it was the one the shop is running, so next month's season
   and last spring's read exactly like the plan the kitchen is working from.
   **`isCurrentPlan` is BOTH HALVES — active AND covering today — and each is
   silent on its own**: an inactive plan covering today makes nothing
   (generation reads the active ones), and an active plan opening in November is
   not what anybody is baking this morning. It takes the ORG's calendar day, for
   `lib/today`'s reason: a plan's dates are business dates and a UTC "today"
   rolls at 5pm here.
   **ACTIVE STAYS THE DEFAULT TIER.** Current is the sharper question most days
   and it is also the one that HIDES WORK — a season you are building for
   November is not in force, so opening on a tier that omits it would make a
   plan you had just written look as though it had not saved. The three read
   narrowest-first (Current ⊂ Active ⊂ All) so the counts descend.
   **The chip's cell is a flex row, not a title with a chip appended**: the cell
   truncates, so an appended chip is the half that gets cut. Measured — a 414px
   title in a 220px cell truncates to 122px with the chip whole and inside the
   cell, and the row stays 68px.
   The two `text-mark` marks that cell carried became FILLS with it (the overlap
   line and the kitchen's "not set"), which is the standing "fix them as you
   touch those screens" rule; yellow on white is 1.43:1.
   **THE DUPLICATE ARRIVES INACTIVE, and that is the one deviation from "an
   exact copy".** Decision 9 makes a shop's menu the UNION of its active plans
   and their pars SUM, so an active duplicate over the same dates would silently
   DOUBLE that shop's production the next time anyone generated. The list's own
   Active toggle is one tap away, which makes turning it on a deliberate act
   rather than a consequence. Written parent-first (plan → trays → slots), and
   the new trays are matched to the old by TRAY NUMBER rather than by insert
   order, which is not a thing to rely on. `duplicateTitle` names it "… copy",
   "… copy 2" — no unique constraint exists on the title, so this is for the
   READER picking a plan out of a list.
   **CHECKING THE PARS AGAINST A SHOP'S DEFAULTS IS ONE MODE WITH THREE DOORS**
   (Mark, 2026-08-08, having moved a copied plan from DF01 to DF02 and wanted
   its pars re-based). He offered three designs — always flag, an always-visible
   reset, or a dialog on the location change — and they are the same question
   asked at three moments, so they are one feature: a DUPLICATE arrives in
   review mode, MOVING the plan to another shop turns it on by itself (state
   adjusted during render when the `locationId` prop changes, React's own
   documented pattern), and a **Check pars** control turns it on whenever.
   **"Always flag" is the one option NOT taken**, and deliberately: a plan is
   SUPPOSED to diverge from the defaults — that is what a seasonal menu is — so
   a permanent mark would sit on exactly the slots somebody had thought hardest
   about and teach the reader to stop seeing it.
   The control states the count BEFORE you turn it on ("175 pars differ from
   DF02's defaults"), because a number you can only see once you have already
   entered the mode is no use for deciding whether to. That is why `defaultGap`
   (the FACT) is split from `suggestionFor` (what the screen is offering).
   Inside the mode, **Use <shop> defaults** takes every offer at once, grouped by
   resulting value like the tray stepper, `window.confirm` naming the count and
   saying the current numbers are replaced.
   All three of that band's controls are the app's ONE button weight, outlined
   and white (Mark, 2026-08-08: "make it look like a real button"), and the two
   that write NAME THE SHOP — "Use DF02 defaults", "Update DF02 defaults" — so
   neither can be read as being about the plan in the abstract, which is the
   whole confusion that started this. The count that used to ride in the label
   ("Use all 175") came out of it: the sentence beside them already says 175,
   and a number inside a button reads as part of the command.
   The **Trays** section heading is GONE with them (Mark) — the pinned footer
   already says "24 trays on this plan", and a heading that only restated a
   count was pushing the band that matters down the page.
   **That whole band lives IN THE FOOTER, just after the tray count** (Mark,
   2026-08-08), which is where this screen's persistent commands already were.
   It costs nothing to put there: `StickyFooter` measures its own height into
   its spacer, so the band appearing — or wrapping on a narrow window — keeps
   the last tray row clear by itself. Measured at 1280: the footer holds
   everything on one 60px line, and scrolled to the bottom the last row ends
   exactly at the footer's top edge. When nothing differs and review is off the
   band is absent entirely, so the quiet state is the footer as it was.
   **EVERY "use the default" HAS ITS REVERSE** (Mark, 2026-08-08) — the
   receiving screen's two-stage price button in a plan's terms: take the app's
   figure, or tell the app yours. Per slot, `↑ set default n` sits on its own
   line under `→ use default n`, quieter, and in bulk **Set defaults from plan**
   sits beside **Use all n** as text rather than a bordered cell. The asymmetry
   is deliberate and is the whole point: taking a default changes THIS PLAN,
   where setting one changes the SHOP'S CATALOG that every future plan seeds
   from — so it is a separate act, worded to say so, and its confirm spells out
   the blast radius.
   Two things the write has to get right. It **UPSERTS** on
   `(item_id, location_id)`, because most pairs have no row at all
   (/price-grid's "set" problem) and an update would change nothing and report
   success; only `par_by_weekday` is written, so `is_active` and
   `price_override` survive — verified. And **`arrayWidth` is 7, not the strip's
   own length**, since 037 checks `array_length = 7` and a null or short strip
   would otherwise be refused on the first write. The bulk version groups by
   ITEM, not slot: one item appears on several weekdays and they share one
   seven-slot array, so writing them separately would have each overwrite the
   last.
   Round-tripped on the live DF02 catalog: `↑ set default 24` moved Angry
   Samoa's Friday from 18 to 24 and touched no other slot, then the plan par was
   stepped down, `↑ set default 18` put it back, and the par stepped up — the
   array is `[18,18,18,18,18,18,18]` again.
   Verified on Mark's real DF02 plan — 175 of 225 slots still carried DF01's
   numbers, and the per-slot offers appeared on exactly those. The bulk write
   was proved on a THROWAWAY duplicate rather than his live plan (175 → 0,
   banner flipping to "Every par matches DF02's defaults"), then deleted.
   **A duplicate opens OFFERING the shop's defaults** — `?defaults=review`, which
   turns the drag-copy's `→ use default n` on for EVERY slot whose par disagrees
   with its default rather than just the ones a drag landed on. `suggestionFor`
   is the one function both routes go through, which is why `dismissed` had to
   become its own set: a DERIVED offer cannot be cleared by forgetting it the
   way an explicit one can. A parameter rather than stored state — the offer is
   a question about a copy you just made, not a fact about the plan.
   Verified end to end on the real 24-tray plan: the copy came out 24 trays, 225
   slots, par total 4908 identical and inactive; **all 225 pars already matched
   their DF01 defaults so it correctly showed ZERO offers**, and stepping one
   par made exactly one appear. Delete named "…and its 24 trays carrying 225
   items", cascaded, and left no orphans.
   **SUPERSEDED 2026-09-12 — THE PLAN RECORD'S COMMANDS ARE ONE ACTIONS MENU
   IN THE TITLE ROW, WITH GROUP BY UNDER IT** (Mark). Add Tray… · Renumber
   Trays · then Check Pars / Stop Checking Pars · Use DF02 Defaults · Update
   DF02 Defaults, top-right beside the h1; Group by is a captioned `PickList`
   directly beneath the menu. `PlanMatrix` takes the server page's title block
   as a `heading` prop, since the menu and the picker need its state. **The
   sticky controls band is GONE**: it existed to keep those buttons in view,
   so the weekday labels now stick under the masthead alone
   (`STICKY_HEAD_ROW`), and the "175 pars differ" sentence is a plain line
   above the table. The same day (Mark) Group by's caption moved to the LEFT
   of the picker — it stands alone under the menu, with no row of captioned
   fields to line up with — and "24 trays on this plan" sits under it. The
   paragraph below is history.
   **Add tray is PINNED — at the TOP since 2026-09-07** (Mark: move the
   footer's buttons "to the filter row, aligned to the right… then remove the
   footer, and make the header sticky so the filter row is always visible").
   The reason for pinning is unchanged and was `ui/StickyFooter`'s from
   2026-08-08: a plan runs to two dozen trays, so a command under the table is a
   scroll away from the rows you are building. What changed is which end. At the
   top the commands arrive beside the control that changes what the list SHOWS,
   and the weekday labels stick directly beneath them — one block instead of one
   band at each end of the screen.
   **THE ROW ALWAYS RENDERS**, where the Group-by picker used to be the whole
   block and appeared only past one tray: Add tray lives here now, and an empty
   plan is precisely the one that needs it.
   It publishes its measured height as `--rf-controls-h` and the labels offset
   against the SUM (`STICKY_HEAD_ROW_UNDER_CONTROLS`, new in `lib/tableHead`) —
   measured and never a constant, because this row wraps the moment the pars
   band cannot share it. Measured at 1280: masthead 64 → band 64–146.5 → labels
   147–180, and with Check pars on the band wraps to 127px and the labels follow
   to 0.5px. **The `overflow-x-auto` wrapper had to become
   `useOverflowOnlyWhenNeeded`** — a sticky cell inside a scroll container pins
   to THAT box, which is `lib/tableHead`'s own documented trap, and `table-fixed`
   means this table never actually needs to scroll sideways.
   **All five commands are `BUTTON_CLASS` now.** In the footer they were four
   hand-typed near-copies at two heights (h-9 and h-8), which reads as a tier
   divider across two clusters and as a mistake when they stand in one row —
   that file's own history says what happens when they drift. Measured: 36px
   each.
   **Harness note:** `--rf-controls-h` is republished by a ResizeObserver, and
   in a hidden browser pane those callbacks are starved — a reading taken right
   after a resize showed the OLD height and a 43px overlap that does not exist.
   Wait, re-measure, and never use `requestAnimationFrame` in the pane at all
   (it does not fire while hidden, and a script awaiting one times out).
   Exercised against the live database and **left exactly as found**: the single
   stepper 18→24, the row stepper moving all seven, a real pointer drag moving
   Sunday between trays with its par, an Option-drag copying it, Copy creating
   tray 03 with all seven slots, Del removing it, then the pars stepped back to
   18·18·18·18·24·36·36 and tray 02 emptied. **677 fixtures pass**, 6 new.
   **Harness note for anyone verifying a drag:** the browser pane's
   `left_click_drag` DOES dispatch real pointerdown/move/up, but its coordinates
   are **1.6× the CSS viewport**, and its `modifiers: "alt"` does **not** set
   `altKey` on the dispatched events (measured: `alt=false` on every one, no
   keydown at all). So Option-drag cannot be driven through the pane — dispatch
   the `pointerup` yourself with `altKey: true`. `window.confirm` is inert there
   too; override it.
   **Shipped 2026-08-09, phase 5 — ACTUALS (migration 044, NEEDS APPLYING).**
   The other half of every document phase 4 produces: what actually happened.
   Three pieces, all Mark's calls this session.
   **(a) `made` / `leftover` on a schedule's lines**, which 040 created and
   nothing had ever written — all 64 lines of the two real 2026-08-09 schedules
   were null, so the list's Counted column read an em dash on every row and the
   `sold` the view already computes had never had a non-null input.
   **`sold` STAYS DERIVED and its one definition is SQL**:
   `v_production_schedule_lines` computes it, had no reader in `web/src` until
   now, and PO detail and the item history both select the view — so there is no
   TypeScript twin to drift and one place for the POS seam to land.
   **SUPERVISORS MAY COUNT, THROUGH A COLUMN-SCOPED DEFINER**
   (`set_schedule_actual`), which is 029's `report_pooled_tips` shape and what
   040's own RLS block said this phase needed. RLS filters ROWS; "a supervisor
   may set these two and nothing else" is a COLUMN rule, and a widened UPDATE
   policy would also hand them `par`, `par_source`, `planned_par` and the whole
   cost snapshot. The whitelist is a `case when` inside the UPDATE, never
   dynamic SQL.
   **That forced `InlineValue`'s one new prop, `onWrite`** — the cell's write is
   the only thing that changes, so the arithmetic evaluator, Escape-reverts and
   reopen-on-failure all survive. **Without it the failure is SILENT**: a direct
   update by a supervisor matches zero rows and PostgREST returns NO error, so
   the component reports success, `router.refresh()` hands back the old value,
   and the number vanishes. Verified on the harness — the RPC writes 1 row while
   the direct write changes 0 and errors not at all.
   **The function takes a COLUMN NAME rather than both values**: a pair-writing
   one would need the sibling cell's rendered value, so editing `made` could
   resurrect a `leftover` just cleared. `counted_by`/`counted_at` clear only
   when the write empties the LAST of the two, in one statement against the
   row's own values — a read-then-write would lose a number when two people
   count one line at once.
   **A SUPERVISOR MAY ALSO PRINT** (`mark_schedule_printed`, Mark's call): the
   packet stamp was purchaser+, which is the same silent zero-row write one
   table up, and printing is the same closing routine the counts are entered in.
   `stampPrinted` loops the definer instead of one `.in()` update, and the
   author now comes from `auth.uid()` inside it rather than a `getUser()` round
   trip.
   **(b) The batch log — `production_batches`**, the module's last unbuilt
   table, with `/batch-logs` + a record, a photo in a new private
   `batch-photos` bucket (018's template, its own bucket on 041's test —
   a supervisor may photograph a batch and may not upload a recipe image), and
   `next_batch_number` seeded at **30000** (006's idiom; FMP's own maximum is
   19,541, so the seed is provably clear rather than merely chosen).
   **A BATCH IS A SUPERVISOR'S OWN RECORD, so it is a POLICY, not a function** —
   the first write policy in this schema to name `supervisor`, which 020
   predicted in those words. That asymmetry with (a) is the thing to understand
   before editing either: a schedule line is a purchaser's document with two
   supervisor-writable cells (a COLUMN rule → a function), a batch is theirs
   entirely (a ROW rule → a policy). Delete stays purchaser+: correcting a batch
   is editing it; erasing the record that one happened is a different act.
   **A batch names TWO people** — `created_by` stamps the app user for audit,
   `operator_employee_id` names who actually made it, because the overnight
   baker has an HR record and no login. That needed
   **`production_operators()`**, a definer returning employee **id and name
   only**: 020 gates `employees` READ to owner/admin, so a supervisor logging a
   batch cannot read the one table that knows the name. CLAUDE.md 4c predicted
   this function in as many words. Verified: as a supervisor
   `select * from employees` returns **0 rows** while the function returns the
   roster.
   **`generate_production_batches` reads `schedule_class = 'WEEKLY'` ONLY**
   (159 of 470 elements) and covers **one kitchen, one week**, Monday-start,
   normalising whatever day you pick. AB (49) and DONUT (18) are never
   generated and reach the log by hand — the thing most likely to look like a
   bug when a donut element never appears. It follows 040's guards in 040's
   order so there is one rule to learn: skip and name, `p_replace` to touch,
   and a batch carrying a YIELD raises unless allowed. **It never deletes**,
   unlike 040 — a schedule must equal what the plans say, where a batch log is
   a checklist somebody is working.
   **FILEMAKER'S 4,437 `TO DO` ROWS ARE NOT A DISEASE**, and a first reading of
   them as pre-generate-and-protect was wrong (Mark, 2026-08-09): an employee
   GENERATES the week and works the list down, so `to_do` is the default status
   of a generated checklist. Decision 6 is about a document defended against
   overwriting; nothing here is defended. Hence all five FMP statuses stay,
   `status` defaults to `to_do` on a generated row, and the freehand New batch
   dialog writes `complete` — you are recording something you just made.
   **ONE ROW OF `production_element_days` IS ONE BATCH**, not one element-day:
   Raised Dough on a Monday morning is four rows. Verified on the harness —
   generation wrote exactly 4 for that morning plus 1 elsewhere, ordered
   1 · 2 · 3 · Caramel (`sort` nulls last, 040's flavour-batch rule).
   **There is deliberately no `expandWeek()` in TypeScript.** Mirroring the SQL
   rule so a dialog could preview the week is 016's `nextDeliveryDate` trap, and
   here the rule decides what a kitchen is told to make. The receipt reports
   what happened instead.
   **(c) The two-week history** on the item record — a matrix, not a
   `DataTable` (one record's fourteen days, `/price-grid`'s call). It is
   **DENSE**: a day with no schedule and a scheduled day nobody counted are
   different sentences, and a list built from the rows that exist can say
   neither, because both are absences. **Two shops on one night are ONE day and
   their pars SUM** — proved on the real 2026-08-09 pair, which folds DF01's 36
   and DF02's 18 into a single row reading 54. The average **divides by nights
   COUNTED and says so**: over the window instead would turn five counted
   nights into a figure two-thirds too low that looks entirely plausible.
   Verified: all 44 migrations replay on the Docker harness, and every rule was
   checked by BREAKING it. As a real authenticated supervisor the RPC writes
   while a direct update changes **0 rows with NO error**, `par` is unreachable
   both ways, the whitelist RAISES, clearing both actuals clears the author,
   `next_batch_number` returns 30000 then 30001, an insert writes 1 row and a
   **delete changes 0 with no error**; staff get a raise from all four
   functions; `anon` gets "permission denied for function" from all five; a
   junk storage path is refused by the POLICY rather than a cast error; and
   040's own suite still carries actuals forward and still RAISES without
   `p_allow_actuals` — now over actuals a FUNCTION wrote. **769 fixtures pass**,
   38 new. `production_batches` did not exist and nothing referenced it, so
   nothing here changed under an existing reader.
   **044 APPLIED and the whole flow WALKED against the real DF01/DF02 data
   2026-08-09, then left exactly as found** — 0 counted lines, 0 author stamps,
   0 batches, 2 schedules, 64 lines, 0 storage objects. What that proved beyond
   the harness: the count went through **`rpc/set_schedule_actual`, confirmed in
   the browser's own network timeline with no PATCH on the table** (the one
   thing a screenshot cannot tell you); Sold went to **−4 unclamped**, yellow,
   with the carryover tooltip; regeneration kept the count AND `counted_by` /
   `counted_at`; the item history folded DF01's 36 and DF02's 18 into ONE night
   reading par 54; a week at DF01 generated **exactly 26 batches numbered from
   30000** — matching a count derived independently from `production_element_days`
   — with **zero of the 160 DONUT and 217 AB rows**; costing reported
   "at least $10.85" with 4 ingredients unpriced; and a re-run added 0 and named
   all 26.
   **THREE BUGS ONLY RENDERING COULD CATCH**, all fixed the same day:
   **(1) A grouped list sorted its bands by the LABEL string**, so a week read
   Mon 8/3 → Thu 8/6 → Tue 8/4. Bands now sort by the ISO date underneath and
   print the friendly form. `SchedulesList` had the same bug LATENT — invisible
   only because one night exists today — and moved with it. The fixture asserts
   the WRONG order too, so a "simplification" back to the label goes red.
   **(2) `BatchLogDetail` is a SERVER component and passed `alsoUpdate` — a
   function — to `InlineValue`**, which took the whole record down with
   "Functions cannot be passed directly to Client Components". TypeScript and
   lint both pass on it. The recipe-version cell is its own client component
   now (`BatchVersionCell`); the rest of `src/` was swept for the same shape and
   is clean. **Any `InlineValue` needing `alsoUpdate`, `onWrite`, `format` or
   `scale` must be rendered from a client component.**
   **(3) `ariaLabel` never reached a DATE cell** — forwarded to the `pick`
   branch on 2026-08-08 and the date branch was missed, so every date cell
   announced its raw column name ("batch_date") however carefully it was named.
   Residue, and it is honest rather than removable: DF02's 2026-08-09 schedule
   carries **`regeneration_count` 1** from the carry-forward test. That
   regeneration really happened; resetting it would make the record lie.
   Note the brief's numbering is off by THREE now — 038 was spent on the name
   constraint, 041 on the recipe sheet and 042 on the recipe cost column.
   **A HEAD COUNT PROBE CANNOT TELL "EMPTY" FROM "MISSING"** — probing 039 with
   `.select("*", { count: "exact", head: true })` returned `null` and NO error
   for a table that did not exist. A HEAD response has no body to carry the
   message, which is the same trap `load-events.mjs` already warns about for
   emptiness checks. Probe a table's existence with `.select("col").limit(1)`.
   The one-paragraph version: Recipe_Items merges into Production_Elements
   (made | purchased | manual, one component vocabulary for both BOM layers);
   Recipes stay separate and VERSIONED, element→recipe a real FK, never a
   name; a PLAN is a proposal (selling location + KITCHEN + date range,
   several concurrently active, union = the shop's menu) while a SCHEDULE is
   the committed day — records at ITEM grain only, generated by an explicit
   human act (ahead-of-time allowed), with the baker/fryer/decorator guides
   and element sheets as pure RENDERINGS; date-scoped par overrides replace
   FMP's pre-generate-and-protect dance; item actuals (made/leftover) land on
   schedule lines via the shift-report surface (joint with 4e's deferred batch
   screen), element actuals in batch logs; costs derive LIVE through
   purchasing (no stored recipe/item costs); prices are an org-level
   class×tier grid with sparse location overrides (measured: DF01/02/03
   byte-identical, only EVENT differs). **NO HISTORY MIGRATES** (Mark,
   2026-08-07: fresh plans and schedules) — the migration is catalog + config
   only, and **its inputs are COMPLETE**: the 7 config exports landed the
   same day (underscore-prefixed in `FMP Export/Production/`) and all nine FK
   joins against the 5 catalog exports resolve with zero orphans. Batch
   numbering seeds at 30,000 (FMP's sequence was at 19,541). The 376k
   rows of schedule-line actuals, the 29k tray day slots, and the
   plans/schedules/batch-log exports deliberately never load. The DDR in
   `DF Operations FMP Database Design/` is how to enumerate any FMP file's
   real tables (its census caught all of this). Ships vestigial:
   `locations.kitchen_by_weekday` / `shops_for` retire when kitchen-on-plan
   lands.

**2026-09-24 — THE PRICE OVERRIDE, REACHABLE ON A SHOP WITH NO ROW.** Mark,
adding the Misc item "Stumptown Coffee - 96oz": "I have no way of setting a
price. In FMP I had a price override option." The override already existed —
`production_item_locations.price_override`, the item record's Info ▸ Default
pars ▸ "Price here" — but a shop with no row showed "—", and the only way to
make a row was "Set Default Pars", which names the wrong thing for an item with
no par. The empty "Price here" cell is now editable and typing a price INSERTS
the row carrying it (`insertPrice` in `ProductionItemLocations`, org_id
explicit); clearing it on a row-less shop writes nothing. No migration. Not
walked in the browser (the pane was signed out) — the insert is `createRow`'s
plus the one column. Remember the inquiry form prices at the pickup shop (or
the delivery origin), so an override at one shop only leaves the item
"priced in your quote" at the other.

**THE PRODUCTION PACKET IS REDRAWN IN THE APP'S OWN DESIGN LANGUAGE
(2026-09-25).** Mark: "now do the production packet", after the special-order
documents, the PO and the shopping list went the same way that day. Every
page — premade schedule, the three tray guides, and the donut / AB / weekly
element sheets the dialog no longer offers — now builds from the shared
`components/pdf/appDocument` parts: the black masthead band ("Production
packet · Printed …") on every page, the kitchen above the sheet's name as the
page heading, the night's date beside it, type bands black and size bands the
app's light-grey group strip, cut names in bold caps instead of underlined,
`DataTable`'s table head on the element sheets, and "Page n of N" across the
packet in the footer. The tally strip's and tray ruler's filled cells went
from orange and green to that same grey: colour is state in the app, and
those were not states.
**Nothing structural changed** — every count, subtotal, night total, write-in
box, tray cell and the "AT LEAST" wording are as they were. The premade band's
TOTAL / L/O labels still sit exactly over their write-in boxes (the band lost
its right padding to keep that). The special-order pages in the packet were
already the new kitchen order. Previous look at `b727828a`.
