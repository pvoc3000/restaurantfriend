# Timesheets / payroll prep — build brief

**Status: SPECCED 2026-08-04, not built.** Nothing in `supabase/migrations/` or
`web/src` exists for this yet; the next migration number is 025.

Read `CLAUDE.md` first, then this. `docs/master-plan.md` §4 sequences this
module as step 4, depending on employees — which shipped as 020–023.

---

## Why

Mark runs Donut Friend's payroll like this: export timesheets from **Homebase**,
import them into FileMaker, adjudicate break violations and add premium pay,
pool tips from figures supervisors record at close, reconcile sick hours against
**Gusto**, then generate a file Gusto imports and finish payroll there.

The question he opened with was whether rebuilding that is silly, given Homebase
and Gusto both sell pieces of it. It isn't, and the reason is a boundary worth
stating before any schema:

| system | owns |
| --- | --- |
| Homebase | what happened — punches, schedule |
| **this app** | what we decided — premiums, tip allocation, exclusions, corrections, sign-off |
| Gusto | money and tax |

The middle column is real work neither vendor does. Tip pooling here is driven
by sales and tip figures **a supervisor writes down at close**, in paperwork
that lives in neither system: Homebase can pool tips it knows about and doesn't
know about these; Gusto imports a number and doesn't derive one.

The second reason is the archive, and the data states it flatly:
`ts_ImportSource` holds **ShiftPlanning (14,530), Deputy (995) and blank
(8,148)** — the app that owned each of those is gone and the records are still
here. Homebase will be outlived too.

### Where rebuilding *would* be silly, and isn't being done

**Overtime.** FMP computed its own (`ts_OTHours_OverEight`, `_OverForty`,
`_OverTwelve`). So does Homebase. Owning that number outright means owning CA
daily OT, the seventh-day rule, workweek boundaries and split shifts across two
shops. So it is **imported and verified**, never computed as authority — see
decision 2.

**Dollars.** FMP stored `ts_Rate` on every row and computed `ts_Cost_*`. That
means wage rates in the database, which `docs/hr-access-brief.md` and
`migration/field-map.md` already refused twice. Held — see decision 1.

---

## The twelve decisions

Each is Mark's, from the 2026-08-04 discussion, with the reason it was made.

**1. No wage rates, ever.** The module exports HOURS and TIP DOLLARS. It never
stores a pay rate and never computes a paycheck. Mark: *"leave rates out.
They're already set in two places: Homebase and Gusto."*
Consequence: a meal premium exports as **1.00 hours** on its own earning code,
never a dollar figure. That is not only tidiness — a CA meal premium is owed at
the **regular rate of compensation** (*Ferra v. Loews*, 2021), which folds in
nondiscretionary bonuses, and Donut Friend has nine rate cards including
`Morning Bonus` and `Overnight Bonus`. That arithmetic is exactly what we don't
want to own. **Verify Gusto accepts a premium as hours on an earning code before
phase 6** — if it insists on dollars, this decision and decision 3 collide.

**2. Overtime is imported and VERIFIED, never silently overridden.** Store what
Homebase said, recompute independently, show the disagreement, a human
adjudicates, and the **decision is stored with a reason**. This is the invoice
reader's posture: the machine proposes, nothing writes itself.

**3. Break violations are DERIVED, never stored.** FMP's own `cTimeSheetError`
was an unstored calculation and was right to be — a flag about a punch goes
stale the moment the punch is corrected. What is stored is the **premium
decision** (FMP's `ts_Premium_Pay` was a stored field — also right).
Two consequences:
- **The decision attaches to the WORKDAY, not to a shift row.** California caps
  it at one meal premium and one rest premium per employee per day however many
  shifts they worked, so a per-shift decision would let two shifts each carry
  one. 027 enforces this with `unique (org_id, employee_id, workday, kind)`.
- **A signed meal-break waiver changes the answer**, and we already have them —
  `employee_documents`, 51 of 445 signed. Nice payoff from a module already
  built.
- **Rest premiums are entered by hand and labelled as such.** A rest break is
  paid, so it produces no punch; there is nothing to derive from but shift
  length, which would flag nearly every shift. The screen must not imply it
  checked something it cannot see.

**4. Tip exclusion is two-tier.** A durable `employees.excludes_tips` (this
person can't share — an agent of the employer under Labor Code 351), plus a
**tri-state** on the timesheet: `null` inherit, `true` excluded this shift,
`false` **included despite the default**. Modelled on the order guide's
three-state quantity, and for the same reason: a boolean cannot say the third
thing, and without it you re-tick the same people every fortnight and have no
way to say "the manager actually worked the floor Saturday."
The override earns its keep on its own — `ts_Shift_Title` carries
`EMPLOYEE MEETING` (110), `Office` (123), `Production & Training` (142).
FMP set `excludeTips = 1` on 597 rows.
Note the person-level flag changes on promotion, so re-deriving an old period
from today's flag would recompute history wrongly. Decision 10's freeze is what
saves you.

**5. The tip pooling rule**, per (location, business_date), in Mark's words:
*"add up all tips for that location for that day, divide it by all the
(non-excluded) hours worked at that location for that day, and the result is a
dollar amount for every tip hour worked."*

```
tip_rate   = pooled_tips ÷ Σ non-excluded tip hours
allocation = that person's tip hours × tip_rate
```

- **Tip hours = hours worked** — clock-to-clock minus the unpaid meal.
  Overtime hours count. Sick hours don't (you weren't on the floor).
- **The whole shop, back of house included.** Confirmed explicitly; the overnight
  baker is in the pool.
- **The tip rate goes on screen.** One dollars-per-hour figure per shop per day
  is the entire calculation in one value — what you'd eyeball to catch a bad
  entry, and what makes every allocation beneath it checkable by hand.
- **Rounding needs a stated rule**, because the allocations must sum to the pool
  *exactly* or you pay out more or less than Square collected, every day.
  Round each to the cent, distribute the shortfall one cent at a time to the
  largest fractional remainders, ties broken by larger tip hours then by
  timesheet id ascending — the deterministic tiebreak is not fussiness, it is
  what makes a re-run reproduce the same frozen snapshot. **Show the residual.**
- **Store the reported figure AND the corrected figure, never one.** Mark: the
  supervisors' numbers *"have to be double checked and changed before I
  calculate tips."* Collapsing them loses the fact that a correction happened.
  Same shape as the invoice extraction being a proposal.

**6. Square card tips only, no cash.** So everything is Gusto **paycheck tips** —
one column, no cash/paycheck split, no already-received reporting.
The pooled figure is **gross**, not net of Square's processing fee (CA doesn't
let the fee come out of tips).
This also names what eventually fixes the tedious hand entry, and it isn't a
better form — it's Square. The number being transcribed is one Square already
has. Storing "reported" and "corrected" separately means a Square daily-tips
pull later becomes a third source that agrees or doesn't. Not being built; being
designed around.

**7. Sick hours are a RECONCILIATION column, not a payroll input.** Mark:
*"Employees currently request sick time through gusto. They are automatically
added to payroll, I don't need to do anything, but I add them to my FMP solution
so I can make sure my records and gusto records match."*
So they are recorded, shown on the worksheet, **excluded from tip hours**, and
**deliberately omitted from the export file** — include them and the employee is
paid twice. That omission must carry a comment and a fixture, because it looks
exactly like an oversight to whoever reads the export builder next.

**8. Read-only history is the pay period's status.** A timesheet is editable iff
its period is open. No `locked` column, no archive table, no "is historical"
flag — one rule, the way `closed` came to mean something on purchase orders.
Historical loads land in already-closed periods and are read-only by
construction.

**9. Pay period = two weeks**, ladder `open → review → exported → closed`,
modelled on the PO ladder and on `closeReadiness` in `lib/purchaseOrders.ts`:
the confirm **names what's unresolved and lets you through anyway**. Gate the
export on a complete set and the fortnight with one missing clock-out never
exports, which is how a status stops meaning anything.
Measured over FMP's 283 real pay periods (2015-09-14 → 2026-07-06): every one
starts on a Monday, every one is exactly 14 days, zero gaps, zero overlaps.
That is Donut Friend's calendar, **not the schema's** — it goes in
`orgs.settings.payroll` per design rule 2, and per migration 024's lesson that a
statement true of finished data can still be wrong as a constraint.

**10. Allocations freeze at export.** Derived while the period is open;
snapshotted onto each timesheet when the file is produced. Someone editing a
March punch must not silently re-derive a February allocation that disagrees
with money already paid. Same argument as PO generation snapshotting the catalog.

**11. Corrections after export.** `exported` → **reopen** (owner/admin, confirm,
required reason; the freeze is cleared, because the file it produced is being
discarded). `closed` → **never reopened**; a correction becomes an **adjustment
row** in the current open period, exporting as its own line.
This is what makes the two statuses mean different things: **`exported` = the
file exists, `closed` = payroll ran.** Rewriting hours in a fortnight Gusto has
already paid is decision 10's problem wearing a different hat.

**12. History loads from 2019 onward** (~50k rows) into closed periods.
Mark: *"my timesheet records go back to 2015, but this was a feature developed
over time and the records back then are pretty crude… In 2019 they start looking
like the current timesheets."* 2015–2018 stays in FileMaker, which remains
read-only-available per the cutover plan.

*The California break and overtime rules described here are our reading, not
advice — worth confirming with whoever handles compliance before the arithmetic
is trusted with money.*

---

## The overnight shift — the module's reason to exist

Homebase splits a shift at midnight, so an overnight shift arrives as two rows on
two days. Mark: *"This caused issues with overtime calculation. Homebase would
often be wrong."*

He is right, and the error has a direction: **it systematically UNDER-counts
California daily overtime.** A 6pm–4am shift is ten hours and owes two hours of
daily OT; split into six and four, neither day breaks eight and it pays zero.
There is a second-order version too — a split shift can make Sunday look like a
worked day when the person only worked Saturday night, which perturbs the
seventh-consecutive-day rule in both directions.

**FileMaker already solved this and the fix is to restore what it did.**
Measured in `FMP Export/HR/Timesheets.mer`:

```
shifts whose end time precedes their start time   4,308 of 23,673   (18.2%)
   ...of those, carrying overtime                 1,071
ts_Date_End filled                                    0 rows
```

`ts_Date_End` was declared and used on **zero** of 23,673 records: FMP stored a
crossing shift as ONE row dated by its start day, with an end time allowed to
wrap. It never needed a second date. And it isn't only bakers — the top
positions among crossing shifts are `Overnight Baker` (398), `Runner / Shift
Lead` (224), `Dishes/Cleaning` (213), `FOH 1` (197). It's everyone who closes,
which is why it's a fifth of all overtime.

**The split is older than Homebase.** 116 rows end at, and 97 rows begin at, a
time field containing the literal word `"midnig ht"` — hand-typed, with a stray
space (byte 32, not an encoding artifact), forming 29 matched (employee, date)
pairs. Someone was already recording the two halves by hand.

### The design

- **Reassemble on import.** Narrow stitch: same employee, same location,
  `A.clockOut` and `B.clockIn` are the *same instant*, and that instant is local
  midnight. Working in instants collapses "ends exactly at midnight and the next
  begins exactly at midnight" into one equality, and it is strictly narrower
  than "zero gap" — so a genuine close-then-open double at 3pm can never merge.
  A chain of three segments is a >24h shift, which is a data error: **refuse and
  report it**, don't guess.
- **Keep the raw segments** in `timesheets.source_payload`, so a stitch is
  auditable and reversible and a re-import re-stitches identically.
- **`clock_in` / `clock_out` are `timestamptz`** — real instants, not a date plus
  wrapping wall-clock times. Duration is then DST-correct for free: 10pm→6am is
  **seven** hours on spring-forward and **nine** on fall-back, and any
  arithmetic that subtracts wall-clock times pays the wrong number twice a year,
  silently. Verified with a two-pass `Intl` offset lookup; **no date library is
  needed**.
- **Two derived dates, not one.** `workday` owns the hours for daily OT —
  defaulting to the day the shift BEGAN, which is DLSE-aligned and what FMP did.
  `business_date` says which day's tip pool and report it belongs to. Both
  default to the start day and are separate fields so the overnight production
  crew could later move to the day they finish without a rewrite. A shift
  crossing a pay-period or workweek boundary then needs no special case: it goes
  wherever its workday goes.
- California also permits a workday that starts at a time other than midnight
  (fixed, regularly recurring, never changed to dodge OT). With whole shifts
  attributed to their start day it isn't needed — documented escape hatch, not
  built.

**Consequence for decision 2:** once shifts are reassembled, our OT will
legitimately disagree with Homebase's on exactly this class of shift — a
thousand rows in the file on disk alone. So the comparison needs a *resolution*,
not just a flag: show both, adjudicate, store the decision and its reason. For a
reassembled overnight shift the expected answer is ours.

---

## Schema — migrations 025–028

Split four ways on 018/021's precedent (a Storage problem must not hold the data
hostage), plus one of its own: the tables storing a **human decision** are
separated from the table storing **facts**.

### 025 `pay_periods`
The calendar. `start_date`/`end_date` inclusive, `status`, the four
exported/closed/reopened stamps, `reopen_reason`.
**`exclude using gist (org_id with =, daterange(start_date, end_date, '[]') with &&)`**
— periods may not overlap. That is what makes "which period owns this workday" a
total function, so 026 can fill it by trigger instead of asking three writers to
agree. Needs `create extension if not exists btree_gist`.
RLS: **read is membership-only** — a calendar is two dates and a status, not
personal data, and a supervisor reporting Saturday's tips needs to know which
fortnight is open. Write is owner/admin. **No delete policy**, 020's reasoning.

### 026 `timesheets` (+ three `employees` columns)
`employees` gains `excludes_tips`, `homebase_id`, `gusto_id` — partial unique
indexes, `where … is not null`. There is **no external-id column anywhere in this
schema today**, only FileMaker's `legacy_id`, and an import that matches on a
name pays the wrong Sanchez.

`timesheets` carries, in four groups: identity (`employee_id` **`on delete
restrict`** — 023 lets owner/admin delete an employee, which was right about a
typo and must not become right about a decade of paid hours; `location_id`
nullable, since 55 FMP rows have no shop; `pay_period_id`), time (`clock_in`,
`clock_out`, `workday`, `business_date`, `workweek_start`), **what the source
said** (`source_hours_regular/overtime/double_ot/paid`, `source_break_minutes`)
beside **the decision** (`hours_regular/overtime/double_ot`, `ot_decision` ∈
`source|recomputed|manual`, plus reason/by/at), and the rest —
`unpaid_break_minutes` as an integer (a meal is 30 or 45, never 0.4166 hours),
`sick_hours`, the tri-state `exclude_tips`, the frozen `tip_hours` /
`tip_allocation` / `allocation_frozen_at`, `source`, `source_row_key`,
`source_payload`, `stitched`, `kind` ∈ `shift|adjustment` with
`adjusts_timesheet_id`, and the two notes.

**`workweek_start` is not optional.** CA weekly OT (>40) and the seventh-day rule
are per *workweek*, which is not a pay period. FMP knew — every row carries
`cWeekNum` (`2015_40`) and a separate `ts_OTHours_OverForty` bucket. Filled by
trigger from the org's anchor day; a plain column rather than `generated`,
because the anchor is org configuration and a generated expression must be
immutable.

**RLS is owner/admin on every verb** (020's precedent — compensation data about a
named person is the same class of fact as their home address), and
insert/update/delete **additionally require the period to be open**. That single
clause *is* decision 8.
**Footgun, and the app must cover it both ways:** an update against a closed
period matches zero rows and PostgREST returns no error — the
`order_guide_entries` lesson, alive on a table where the silent no-op is
someone's paycheck. Every write `.select()`s its own result, **and** the cell
renders `READ_ONLY_VALUE` rather than an editable control when the period isn't
open, so the write is never offered in the first place.

### 027 `break_premiums` + `tip_pools`
`break_premiums`: `unique (org_id, employee_id, workday, kind)` — the California
cap enforced by the schema rather than by remembering it. `decision` ∈
`owed|waived|not_owed`, `hours` (never dollars), and
`reason text not null check (length(btrim(reason)) > 0)` — a decision without a
reason is one nobody can review a year later, which is the whole point of the
table.

`tip_pools`: `unique (org_id, location_id, business_date)`, both figures with
their own stamps and a correction reason, plus the frozen `tip_rate` and
`residual_cents`. Read is membership-only (the pool is a shop-floor fact and the
people in it may see it); write is owner/admin, because the *correction* is money.
- **`report_pooled_tips(location, business_date, amount)`** — `security definer`,
  re-checking everything RLS would, so a supervisor can write the reported figure
  and nothing else. RLS filters rows not columns, so a column-scoped write is a
  definer function: 002's `set_my_member_profile` pattern.
- **`freeze_pay_period(period, allocations, pools)`** — `security definer`,
  because the freeze is the one write that must happen as the period leaves the
  state its own policy requires. The client computes (one implementation, in
  `lib/tipPool.ts`, fixture-tested — reimplementing the arithmetic in PL/pgSQL
  would be migration 016's `nextDeliveryDate` trap again); this **validates and
  commits**, refusing a payload that doesn't cover every timesheet in the period,
  then writes the snapshot and flips the status in one transaction.

### 028 `timesheet_imports` + the private `timesheet-imports` bucket
Per-run record: file metadata, the dates **as read from the file**, status
(`parsed|committed|discarded`), five row counts, and a `report jsonb` naming what
was stitched, what was refused and which ids matched nobody. jsonb rather than a
child table — 019's argument for putting the extraction on the attachment.
Key shape `{org_id}/{import_id}/{uuid}.csv`; **reuse `public.storage_folder_org()`
from 018, never redefine it.**

---

## The pure modules

All fixture-testable (`npm run fixtures`), which is the point of writing the
risky half as pure functions over plain data.

| module | owns |
| --- | --- |
| `lib/timeZone.ts` | wall clock ⇄ instant, `isLocalMidnight`, `hoursBetween`. Two `Intl` passes, no dependency. **Must document what it cannot answer**: a nonexistent local time (2:30am on spring-forward) and an ambiguous one (1:30am on fall-back — and the overnight crew punches out in exactly that window) |
| `lib/homebaseImport.ts` | parse, map, **stitch**, derive the two dates |
| `lib/overtime.ts` | daily/weekly/seventh-day recompute and the disagreement report |
| `lib/breakRules.ts` | takes **all shifts on one workday**, returns at most one finding of each kind — the CA cap enforced by the function's shape |
| `lib/tipPool.ts` | tip hours, effective exclusion, the allocator and its residual |
| `lib/gustoExport.ts` | columns, rows, hand-rolled CSV quoting, `exportReadiness` |
| `lib/payPeriods.ts`, `lib/timesheetImport.ts` | the status ladder; the import plan |

The fixtures that matter most, because each pins a bug the code would otherwise
have:
- **6h + 4h on two rows → 0 OT; the stitched 10h → 2 OT.** First case in the
  file — it is the module's reason to exist.
- **Daily and weekly OT do not stack**: five 9h days is 5 OT hours, and the
  weekly-40 test must add zero.
- 22:00→06:00 is **7h** across spring-forward and **9h** across fall-back.
- A zero-gap segment pair at 11pm → **two** shifts (this is what protects the
  close-then-open double).
- 6h00m with a waiver → not owed; **6h01m with a waiver → owed**; two shifts on
  one workday both over 5h → exactly **one** premium.
- $100 over three equal shares → 33.34/33.33/33.33, residual 1¢, named
  recipient; running it twice returns an identical object.
- `effectiveExclusion(false, true) === false` — the tri-state's third state.
- **Assert against the produced CSV header string that sick hours do not
  appear.** Asserting on an object shape lets a rename pass while the column
  comes back.

Check the suite by breaking the code — invert the never-overwrite rule, drop the
OT non-stacking, remove sick hours from the exclusion — and confirm cases go red.
A green suite that can't fail is worse than none on a module that moves money.

---

## Screens

`lib/nav.ts` already carries `stub("hr","pay-periods",…)` and
`stub("hr","timesheets",…)`; shipping each is one line. Both are org-scoped, so
both are exempt from `InactiveLocationGate` for the reason `/employees` is —
payroll belongs to the company, not to a shop.

- **`/pay-periods`** list + record. The record is the payroll worksheet:
  per-employee hours roll-up, the break-premium decisions, the tip pools with
  their rate and residual, and the export.
- **`/timesheets`** — the shift list, grouped by employee or workday, with the
  raw segments, the stitch provenance and the OT disagreement in the row's
  `expand`. **No `/timesheets/[id]` route**: a shift is a row, not a record, and
  a second screen would be a second place to edit a timesheet — the
  receiving-screen mistake in reverse.
- **`/timesheets/import`** — drop → plan → commit, with **nothing written before
  Commit**. Unmatched employees get a picker that writes `homebase_id`, so every
  import matches better than the last.

Everything clones the `/employees` template and reuses the parts table in
CLAUDE.md. The tri-state exclusion is `InlineValue kind="pick"` with three
options, not a checkbox.

`lib/roles.ts` gains `canRunPayroll` — owner/admin today, the same set as
`canReadHr`, named separately for the reason that file already gives.

---

## Phases

Each ships alone and is worth having alone.

1. **025 + the pay-period screens.** The payroll calendar becomes something the
   app knows, and decision 8 gets something to hang off.
2. **026 + the timesheets list and inline editing.** A manager can key a
   correction. Flushes out the silent-no-op footgun **before** an importer exists.
3. **028 + the importer.** **Blocked on a real Homebase CSV** — see below.
4. **`overtime.ts` + the disagreement UI.** Highest arithmetic risk; no
   reference implementation to check against.
5. **027 + break rules + tip pooling.** The money people are waiting for.
6. **The Gusto export + `freeze_pay_period`.** Last, deliberately: irreversible,
   and it must not run until every input is trustworthy.
7. **The historical load, 2019 → , into closed periods.** Last because it lands
   read-only and cannot disturb anything live.

**Between 5 and 6, a parallel run.** `docs/master-plan.md` already requires it —
*"payroll accuracy is the highest-stakes surface… a dedicated parallel-run
validation, not a spot check."* One full fortnight through both FMP and this
module, diffed per employee, before anyone trusts the export.

---

## What's needed before phases 3 and 6

1. **One real Homebase timesheet CSV.** The column map cannot be written from
   guesses, and **whether Homebase emits a stable shift id decides the
   idempotency key** — see below.
2. **A full `Timesheets.mer` re-export** with an explicit field list *including a
   record id*, and a **`PayPeriods.mer` re-export with its key**. Both files on
   disk are inadequate: Timesheets is a partial found set (23,673 rows,
   2015-09-28 → 2019-03-23, no Homebase era at all) and PayPeriods is a layout
   export with ten columns, so `cPayPeriod` on timesheet rows has nothing to join
   to. This is the `hr-export-is-a-layout-export` trap for the second time.
3. **A Gusto import template**, to settle decision 1's open end.

### The idempotency key is the riskiest single decision

`Timesheets.mer` has **117 columns and not one is a record id.** And the natural
key you'd reach for is provably not unique: `(employee, date, start, end)` gives
23,220 distinct values over 23,673 rows, so keying on it **silently drops 64 real
rows**. The duplicates are byte-identical — employee 331 · 5/23/2016 ·
8:58–11:20am · `(91) •Employee Meeting•` · entered twice.

So: prefer the source's own id where it has one; otherwise hash the natural tuple
**plus an occurrence ordinal** within (employee, workday), and put every
synthesised ordinal on screen, because that is the case the importer can get
wrong. The FMP loader is a different animal — one shot, into closed periods, and
it should refuse to run twice.

### Traps in the historical data, measured

- **Three time formats, one per era**: 12-hour am/pm; 24-hour `hh:mm:ss` on 995
  rows (exactly the Deputy row count); hour-only `"12 AM"` on 133. Plus the
  hand-typed `"midnig ht"` literal on 213.
- **389 rows have times that don't parse and 15 are zero-length.** The transform
  names them and exits 1 rather than guessing — the house rule.
- **`ts_Location` has six spellings for two shops** (`DF Highland Park` 16,981 ·
  `DF01` 3,858 · `Donut Friend` 1,467 · `DF02` 895 · `Highland Park` 417 · blank
  55). The alias map is business data: `orgs.settings.timesheet_import`, per
  design rule 2.
- **`ts_Position` has 128 values carrying FileMaker numbering** (`(01) Cashier
  DF1`, `12 FOH 1`). Strip with a documented regex and **report collisions rather
  than silently merging** — `strip-section-prefix.mjs` set the precedent by
  refusing a whole run.
- **`ts_Premium_Pay` is empty on all 23,673 rows** in this found set. So there is
  no historical premium data and **no reference implementation to check
  `breakRules.ts` against**; it will be adjudicating these shifts for the first
  time. Confirm against the full re-export before assuming.
- `excludeTimesheet`, `ts_BreakType` and `ts_Wage_Type` are empty on **every**
  row — eleven years without one being set. No column is being built for them.

---

## Assumed unless Mark says otherwise

- **Supervisors do not see timesheets in v1** (owner/admin only). Loosening later
  is a definer function naming safe columns — 020's own comment anticipates this
  — never a policy change.
- **The reported/corrected pair belongs to the DAY's pool** (per location, per
  business_date), not to a per-shift tip figure. That is how decision 5 reads.
- A >24h stitch chain is refused and reported.

## Deliberately not built

Scheduling, clock-in enforcement and geofencing, labor forecasting, PTO accrual
balances (Gusto owns them), tax, filings, and anything that writes back to
Homebase.

**Two things kept cheap for later**, because Mark named both as possible:
`scheduled_hours` stays an imported figure, so if scheduling comes in-house the
timesheet gains one nullable `shift_id` and FMP's scheduled-vs-actual variance
(`ts_Hours_Scheduled`, `cScheduledActualDiff`) becomes real rather than imported.
And **the export is a described format, not hardcoded Gusto** —
`orgs.settings.payroll_export` holds the format and column mapping, per design
rule 2. FMP hardcoded `gGustoXMLHeader` as a global and still carries a previous
provider's earning codes (`cE02Cost`, `cE07Bonus`) fossilised in its schema.
Running payroll in-house then becomes one more target rather than a rewrite —
and note it does **not** reopen decision 1: everything this module stores is
provider-neutral, and rates, if they ever arrive, should arrive as a properly
designed effective-dated history rather than as the per-row copy FMP kept.
