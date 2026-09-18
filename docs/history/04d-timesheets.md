<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4d. 🚧 **Timesheets / payroll prep** — phases 1 and 2 SHIPPED 2026-08-04
   (migrations **027 + 028**, both APPLIED). Full brief:
   **`docs/timesheets-brief.md`** — read it before touching anything here, but
   read the CORRECTIONS below first: the brief was written against the
   2015–2019 partial export, and Mark's 2026-08-04 re-exports contradict it in
   several places. **The brief numbers its migrations 025–028; Invoices took
   025/026 the same day, so this module is 027–030 — add two.**
   The three things worth knowing without opening it:
   **the module exports HOURS and TIP DOLLARS and nothing else** (Mark: "leave
   rates out. They're already set in two places: Homebase and Gusto"), so no wage
   rate is ever stored and no paycheck is ever computed — a meal premium exports
   as 1.00 *hours* on an earning code, which also dodges *Ferra v. Loews*
   regular-rate arithmetic. **Overtime is imported and VERIFIED, never computed
   as authority** — Homebase's split is stored beside ours, a human adjudicates,
   the decision is stored with a reason. And **a timesheet is editable iff its
   pay period is open**, which is the module's one read-only rule: no `locked`
   flag, no archive concept, and historical loads land in already-closed periods.
   Two boundaries drawn once: Homebase owns punches, this app owns decisions,
   Gusto owns money and tax; and **sick hours are a reconciliation column that is
   DELIBERATELY OMITTED from the export file**, because Gusto already pays them
   and including them double-pays.
   **CORRECTIONS TO THE BRIEF, measured on the 2026-08-04 re-exports.** Every
   one is in our favour, and the first is the big one.
   **The brief's central premise is FALSE for the current data.** It says
   Homebase splits a shift at midnight and so under-counts CA daily overtime.
   The real Homebase CSVs (DF01 + DF02, the 07/20–08/02 pay period) have
   separate `Clock in date` and `Clock out date` columns and keep an overnight
   shift WHOLE — zero adjacent-at-local-midnight pairs across both shops — and
   Homebase's own overtime is correct on them: Gaspar López 6:01pm→8:10am =
   13.15h billed as **8.00 regular + 4.00 OT + 1.15 double** (textbook CA), and
   a 6.03h shift billed 0 regular + 2.88 OT + 3.15 double shows the seventh-day
   rule being applied too. FileMaker likewise fills `ts_Date_End` in this era
   (1,148 of 1,148 crossing rows dated start+1), where the brief measured ZERO
   — that figure came from the 2015–2019 ShiftPlanning/Deputy export. **So the
   stitcher is a safety net, not the centrepiece**, the historical load needed
   no stitching at all, and decision 2 (import and VERIFY) is where the module's
   value actually lives. `isLocalMidnight` is built and fixture-tested anyway;
   nothing depends on it yet.
   Also corrected: `ts_Position` is clean (30 values, no FileMaker numbering) —
   **but the Homebase CSV's `Role` still carries it** ("01 Overnight Baker"), so
   the prefix-strip trap moved rather than vanished. `ts_Location` has six
   spellings but only **6 stray rows** (DF1/DF2/df01), not two shops under six
   names. `ts_BreakType` and the break PUNCHES are populated on ~27,500 rows,
   where the brief thought them empty. **`cTimeSheetError` is populated on
   10,143 rows** with real Late/Missed/Short Break findings — so phase 5's
   `breakRules.ts` HAS a reference implementation to diff against, which the
   brief said didn't exist. It rides in `source_payload` rather than becoming a
   column, since decision 3 says a violation is derived and never stored.
   And the idempotency key is far safer than feared: the natural tuple gives
   44,765 distinct over 44,767 rows (the brief measured 23,220/23,673 on the old
   file). **Still no record id in either source** — not in Timesheets.mer's 117
   columns, not in the Homebase CSV — so `source_row_key` is the natural tuple
   plus an occurrence ordinal, stored READABLE rather than hashed so a duplicate
   explains itself.
   **Shipped, phase 1 — migration 027 `pay_periods` + `/pay-periods`.** The
   ladder `open → review → exported → closed`, the reopen stamps with a required
   reason, and a **btree_gist exclusion constraint so periods cannot overlap**,
   which is what makes "which period owns this workday" a TOTAL function so 028
   can fill `pay_period_id` by trigger. Read is membership-only (a period is two
   dates and a status, and a supervisor reporting Saturday's tips must know
   which pay period is open); write is owner/admin; no delete policy. The
   pay period lives in `orgs.settings.payroll` per design rule 2 — 024's lesson
   that a statement true of finished data is still wrong as a constraint.
   Loaded the real calendar: **178 periods, 2019-10-07 → 2026-08-02**, every one
   14 days from a Monday, zero gaps, zero overlaps, re-derived from the file by
   the transform rather than taken from the brief. All land `closed`, so history
   is read-only by construction. The loader deliberately does NOT open the
   current period — that arithmetic lives once, in `nextPeriodAfter`, or it is
   016's `nextDeliveryDate` trap. **So after the load there is no open period**;
   that is expected, and New pay period is how you open one. (Until 2026-08-06
   this read as `/pay-periods` opening on an empty `Current` filter — that screen
   is gone, and the button now sits on the timesheets screen's period bar.)
   **`isPayPeriodEditable` covers `open` AND `review`** — review is where
   corrections are MADE, and gating it would force a reviewer to step the period
   backwards to fix what they found. 028's write policies name the same pair;
   **they must change together.**
   **Shipped, phase 2 — migration 028 `timesheets` + `/timesheets`.** The punch
   as real INSTANTS, what the SOURCE said beside what we DECIDED, and the two
   derived dates. Plus `employees.homebase_id` / `gusto_id` / `excludes_tips` —
   there was no external-id column anywhere in this schema, and an import that
   matches on a NAME pays the wrong Sanchez.
   RLS is **owner/admin on every verb including SELECT** (020's reasoning: what
   a named person was paid for is the same class of fact as their home address),
   and writes additionally require the period to be open or in review.
   **Verified in the harness as a real authenticated admin, which is the only
   way to test a policy** — and it confirmed the footgun rather than assuming
   it: an update against a CLOSED period **changed zero rows and returned NO
   error**, delete likewise zero, insert refused outright, while the same update
   on an open period changed 1 row. A supervisor sees 0 timesheets and 2 pay
   periods. `anon` is refused `timesheet_period_editable`, `authenticated` is
   granted it (002 and 018's lessons, both live). Hence the app covers it BOTH
   ways: every write `.select()`s its own result, **and** the cell renders
   `READ_ONLY_VALUE` rather than offering an edit the database will silently
   swallow.
   **`lib/timeZone.ts` is the module everything rests on**, and it has one
   non-obvious property. The obvious two-pass offset lookup — look it up at the
   guess, correct, look it up again — **CONVERGES**, so on a fall-back night it
   finds one instant and confidently reports no ambiguity. Two fixtures caught
   that. It probes the offset a DAY EITHER SIDE instead, generating a candidate
   from each, and verifies both by formatting back: two survive = ambiguous, one
   = ordinary, none = the wall time does not exist. It REPORTS which rather than
   guessing, because both cases are an hour of somebody's overtime. 22:00→06:00
   is 7h across spring-forward and 9h across fall-back; a wall-clock subtraction
   says 8 for both.
   **Loaded the history: 44,721 rows** (44,766 transformed, 45 skipped and each
   named — five employee ids match nobody, including a `387B` and two
   phone-number-shaped ones; one row refused for an unparsable `"21"` clock-in).
   **Every row landed in a pay period, and FileMaker's own `cPayPeriod` agrees
   with the trigger's answer from the workday on all 44,721** — two independent
   answers, zero disagreements. 10 rows carry a fall-back AMBIGUOUS punch,
   resolved to the earlier instant and flagged in
   `source_payload.local_time_ambiguity`; **FileMaker took the LATER one**,
   which is where 37 of the 133 hour-level disagreements with FMP come from.
   `transform-timesheets.mjs` **imports the app's COMPILED `timeZone` module**
   out of `web/.fixtures-build` rather than keeping a second copy of the DST
   arithmetic, and refuses to run if `npm run fixtures` hasn't been run. It is a
   field ALLOW-LIST, so the 53 wage rates sitting in the file are never read
   (decision 1). Its first crossing-midnight rule trusted `ts_Date_End` and
   produced a **30.58-hour shift**; the TIMES decide now (`minOut < minIn`) and
   `ts_Date_End` is corroboration only.
   `/timesheets` is scoped to ONE pay period (44,721 rows exist) and opens on
   the most recent period that HAS shifts, not the newest — which after the load
   is an empty current pay period. **No `/timesheets/[id]` route**: a shift is a
   row, not a record, and what a detail screen would show lives in the row's
   expansion. The Worked column is DECIMAL, not a `5:13` clock reading, because
   Regular + OT + Double must visibly sum to it.
   **Still blocked**: phase 6's Gusto export. The template arrived and settles
   decision 1 — Gusto has a native **`missed_break_hours`** column, so a premium
   CAN export as hours — but Donut Friend's current FMP export puts premiums in
   **`custom_earning_premium` as DOLLARS** (values 16–26, matching
   `ts_Premium_Pay`), so which one to write is Mark's call. The template also
   shows the export is **one row per (employee, WAGE TYPE)**, not per employee —
   tips and premiums ride the `(Primary)` row while hours split across rate
   cards — which `gustoExport.ts` has to model. Not built.
   **Shipped 2026-08-04, phases 3, 4 and 5 — migrations 029 + 030, both
   APPLIED.** (Mark ran 030 before 029; they are independent — 029 references
   only 027/028, 030 only 018's storage helper and 028 — and both verified
   afterwards.)
   **Phase 4, `lib/overtime.ts`** — CA daily (>8 at 1.5×, >12 at 2×), weekly
   (>40) and the seventh-consecutive-day rule. **DAILY AND WEEKLY DO NOT
   STACK**, and that is the rule a rewrite is most likely to break silently:
   five 9h days is 45 hours and owes FIVE overtime hours, not ten. The weekly
   pass looks only at hours still REGULAR after the daily pass, which is what
   enforces it. A workday's answer is poured back over its shifts
   chronologically, so a day holding two shifts gets ONE decision and it lands
   on the shift that ran late. Seventh-day counts DAYS WORKED, not calendar days
   with rows.
   **`EPSILON` is 0.015 and that is a MEASUREMENT, not a taste.** Over all
   44,537 real shifts: at a half-cent tolerance 4,388 rows (9.9%) disagree with
   the source; at more than one cent, 267 (0.6%). The 4,121 difference is
   rounding convention — ours is exact from instants, the source's is its own
   rounded decimal — and a 9.9% disagreement rate is the same as flagging
   nothing. 239 of the surviving 267 are a real movement between buckets.
   Totals: overtime ours 5,071.57h vs source 4,911.62h, double-time 264.62 vs
   165.70. **Only 5 seventh-day shifts exist in seven years and FileMaker
   applied the rule to none of them.**
   The adjudication UI is the receiving screen's idiom — nothing prefills, and
   both buttons are a decision: Adopt writes `ot_decision='recomputed'`, Keep
   writes `'manual'` with a REQUIRED reason (leaving it `'source'` would say
   nobody had looked). The "needs review" queue compares against `hours_*`, NOT
   `source_hours_*`, or a row already adjudicated to disagree with its source
   would never leave the queue.
   **Phase 5, migration 029** — `break_premiums` unique
   `(org_id, employee_id, workday, kind)`, which IS the California one-per-day
   cap; `reason` NOT NULL and non-empty; HOURS never dollars. `tip_pools` keeps
   the reported AND corrected figure and works in integer CENTS throughout,
   because the allocations must sum to the pool exactly or the shop pays out
   more or less than Square collected every day. `report_pooled_tips` is a
   definer function so a supervisor can write ONE column (RLS filters rows, not
   columns); `freeze_pay_period` validates a client-computed payload and commits
   it, because reimplementing the allocator in PL/pgSQL would be 016's
   `nextDeliveryDate` trap.
   `lib/breakRules` assesses the WORKDAY and returns at most one meal finding —
   the cap as the function's shape. It NEVER returns a rest finding: a rest
   break is paid, leaves no punch, and anything derived from shift length would
   flag nearly every shift.
   **Diffed against FileMaker's own `cTimeSheetError` over 44,284
   employee-workdays** — the reference the brief said didn't exist: both flag
   10,078 (same KIND on 9,911, 98.3%), neither flags 26,491, only FileMaker 24
   (all on days under 5h that need no meal at all), only us 7,691 — 82.6%
   agreement. **The excess is a DATA GAP, not a rule bug: 6,374 of the 6,562
   excess no-meal days are six hours or less, exactly what a signed waiver
   covers, and ZERO waivers are loaded**.
   **CORRECTED 2026-08-06 — the waivers were never in FMP's Events table.** This
   note said twice that they were, and the fresh Events export has no waiver
   among its thirteen `EventType` values; `migration/field-map.md:146` has
   `MEALBREAK WAIVER` as an onboarding CHECKBOX on the employee record, dropped
   at the 020 load with the other paperwork ticks. Both halves of the gap have
   since closed by other routes: **Mark filed 21 real waiver PDFs on 2026-08-05**
   (`employee_documents`, kind `meal_break_waiver`), which `assessWorkday`
   already reads; and `migration/backfill-break-premiums.mjs` wrote **10,453
   `not_owed` decisions** from the break reasons FileMaker kept in its RATINGS
   table, resolving 3,138 of the excess findings. See build step 4e.
   **Phase 3, migration 030 + `lib/homebaseImport.ts` + `/timesheets/import`.**
   Drop → plan → commit, with NOTHING WRITTEN BEFORE COMMIT, and a commit into a
   closed period BLOCKED rather than left to fail silently. The parser is pinned
   against an ACTUAL SLICE of the DF01 export (`scripts/fixtures/data/`),
   preamble and totals rows and hyphen separators intact — a tidied-up imitation
   passed the first version, which imported the separators as a person called
   "-" with eighteen shifts. Two further classification bugs the real file
   found: a bare `Totals` grand-total row (every block ends `Totals for <name>`,
   the FILE ends `Totals`), and ten rows carrying a date with NO punches — a
   scheduled day nobody clocked in for, which are read perfectly and hold
   nothing, so they are listed apart from the failures. Every row of the real
   file is now accounted for: 102 shifts + 10 empty + 17 repeated headers + 19
   totals + 18 separators + 18 blank = 184, zero refusals.
   **The idempotency key was tested reversibly against the live database** — a
   throwaway open period, one row imported, the same row re-imported with a
   changed figure, one row in the table with the value updated, FileMaker's
   44,721 untouched, then everything deleted leaving 44,721 timesheets and 178
   periods exactly as found. That is the case that matters: Homebase emits no
   shift id and a pay period is re-exported whenever somebody fixes a punch.
   **393 fixtures pass**, and every rule above was checked by BREAKING it. Two
   fixture gaps were found that way rather than by reading: the
   one-premium-per-day case only asserted "at most one finding" (which the
   function's shape guarantees anyway), and the zero-hour-day guard put its
   empty day last, where `splitDay`'s own guard hides the bug. Both rewritten
   and both now fail correctly.
   **What remains is phase 6, the Gusto export.** Its FILE SHAPE is now known
   exactly, measured over the real template (24 people, 34 rows) and corrected
   by Mark 2026-08-04 — it is finickier than "one row per employee":
   - **One row per (employee, WAGE TYPE)**, and hours genuinely split across
     them: 7 of the 34 rows are non-primary and carry hours.
   - **The primary job title is IDENTIFIED BY THE SUFFIX `(Primary)`** on the
     `title` column — it is not a separate flag. Every one of the 24 people has
     exactly one such row. Getting this wrong doesn't mis-sort the file, it
     leaves Gusto unable to tell which job is the primary one.
   - **Every non-hours earning rides the `(Primary)` row and only that row** —
     `paycheck_tips`, `custom_earning_premium`, `custom_earning_commuter_benefit`,
     `bonus`, `reimbursement`. Measured: zero violations across the template.
   - `gusto_employee_id` is in the file (6-char, e.g. `n4smoy`), which is what
     028's `employees.gusto_id` exists to hold.
   **Premiums export as HOURS on `missed_break_hours`** (Mark asked for a
   recommendation, 2026-08-04; he was happy either way). The reasons are
   decision 1 — dollars means somebody computes dollars, and this module stores
   no wage rate — plus the fact that Gusto already knows every rate, so a dollar
   figure would be a second copy of a number we deliberately don't keep, frozen
   wrong the moment a rate changes retroactively.
   The *Ferra v. Loews* worry that made the brief hesitate turns out to be
   **largely theoretical here**: 60 of the 62 premiums FileMaker ever recorded
   equal that row's base `ts_Rate` exactly, ZERO rows carry an
   `hourlyBonusRate`, and none of the 20 rate cards actually used on timesheets
   mentions a bonus. So the regular rate of compensation and the base rate
   coincide for essentially everyone, and handing Gusto hours gives up no
   arithmetic. (The brief's "nine rate cards including Morning Bonus" came from
   the rate-card table, not from what the timesheets use.)
   **Still worth confirming in the parallel run: what rate Gusto actually pays
   `missed_break_hours` at.** If it ever disagrees with the base rate, the
   fallback is `custom_earning_premium` in dollars — and because the export is a
   DESCRIBED format in `orgs.settings.payroll_export` (design rule 2), that
   switch is configuration rather than a rewrite.
   **Shipped 2026-08-04, phase 6 — migration 031 + `lib/gustoExport.ts` + the
   export block on the pay-period record. NEEDS 031 APPLIED.**
   031 adds `timesheets.wage_type` and `employees.primary_wage_type`, and the
   export cannot be right without them. `timesheets.position` is NOT the wage
   type — it holds Homebase's `Role` and FMP's `ts_Position`, while
   `employees.position` holds a THIRD vocabulary of abbreviations ("DF",
   "Sr. DF") matching shift positions on only 8 of 22 people in the last real
   pay period.
   **THE `(Primary)` SUFFIX IS NEVER STORED.** Both columns hold the bare title
   and the export appends it by comparing them, which makes the file's central
   invariant STRUCTURAL: one `primary_wage_type` per person → exactly one
   primary row → exactly one place for the earnings. Storing it per shift would
   let a pay period produce two primary rows, or none. The backfill reads FMP's
   `ts_Wage_Type` out of `source_payload`; 198 employees have one in history,
   134 have exactly one ever and **64 CHANGED** (promotions), so **latest
   wins** — verified with a seeded promotion resolving to Manager, and zero
   suffixes stored on either table.
   **The most important assertion in this repo** is that SICK HOURS DO NOT
   APPEAR IN THE FILE, made against the produced **CSV header string** and not
   an object shape (a rename would slip the column back in). Decision 7 — Gusto
   already pays sick time, so including it pays the person twice. Checked by
   putting the column back exactly as an "improvement" would.
   Download and Finalize are TWO ACTS. Download changes nothing and may be taken
   repeatedly; Finalize calls `freeze_pay_period`, which snapshots every
   allocation and flips the status in ONE transaction. Verified in the harness
   as a real authenticated admin: a partial payload is refused BY NAME
   ("Allocations cover 1 of 4 timesheets"), a complete one freezes and stamps
   `exported_at`/`exported_by`, re-freezing is refused, and the period is then
   read-only to timesheet writes. `exportReadiness` follows `closeReadiness` —
   names what's unresolved, lets you through anyway.
   **`getAppSession` now embeds `orgs(name, settings)`**, not settings alone, so
   the export names its file without a second query. `session.orgName` is new.
   Then phase 7's parallel run, which `docs/master-plan.md` already requires —
   one full pay period through both FMP and this module, diffed per employee,
   before anyone trusts the export. **The one thing still unverified is what
   rate Gusto actually pays `missed_break_hours` at**; if it ever disagrees with
   the base rate, the fallback is `custom_earning_premium` in dollars, and
   because this is a described format that switch is configuration.
   **Reworked 2026-08-05 from Mark's first real test pass** (16 comments). Two
   were bugs; the rest were the module not saying what it already knew.
   **THE BREAK RULES COULD NOT SEE IMPORTED DATA.** `toBreakShift` read the meal
   punches out of `source_payload` as `break_start` / `break_end` / `time_in` —
   FileMaker's spelling, written by `transform-timesheets.mjs` — while the
   Homebase importer spread its own row shape and got `breakStart` / `breakEnd`
   / `clockInTime`. So on every IMPORTED shift the punches read as null, it fell
   through to `unpaid_break_minutes`, and **`late_meal` could never fire at all**
   while a missed meal was inferred from the absence of a deduction (Mark:
   "missed break not flagged by app… what about late breaks?"). The reader now
   accepts BOTH spellings — which is what makes the pay period already imported
   work with no backfill and no re-import — and the importer writes the canonical
   snake_case names beside the raw row, so the two sources stop drifting. That
   also fixes the row expansion, which reads the same keys and had shown em
   dashes for every imported shift.
   Measured on the real 07/06–07/19 pay period: **61 late meals found where the
   rule had been structurally silent**, against FileMaker's own
   `cTimeSheetError` flagging 49 Late Break on the same 163 rows — the extras are
   overnight shifts, where FMP's wall-clock arithmetic goes wrong and ours
   doesn't. 14 fixtures run one shift through both spellings; checked by
   reverting the fix, 8 go red and a late meal degrades to "no meal", which is
   exactly the symptom.
   **A grouping now always bands.** `DataTable` bands a run of like-labelled
   rows, so it can only band what the ORDER already groups; the list passed
   `sortKey`, so picking Day while the sort was Employee produced no band at all
   and grouping looked broken. The group is now the PRIMARY sort with the chosen
   column sorting WITHIN each run — which is what a grouped report is — so every
   grouping bands, Shop included (new). `DataGroup` gained **`summary`** — hour
   subtotals, which first went IN the band on the reasoning that a table of 56px
   rows cannot afford an extra row per group, and were moved the same day to a
   CLOSING ROW under a rule once Mark used them: "subtotals should be trailing
   the data, not leading in the header band, and the values should align with
   their columns." Alignment is the whole argument — a subtotal is a number you
   check against the column above it, and one set as a sentence in the band has
   to be re-read to be placed. So `summary` returns a map KEYED BY COLUMN and the
   table renders one cell per visible column, which keeps each figure under its
   own heading when a column is hidden or dragged. Verified summing exactly to
   the period totals (regular/OT/double to the cent; Worked and Break differ
   ~0.02 from summing the DISPLAYED rows, because the subtotal sums raw and
   rounds once — the more accurate of the two).
   **The cells now say what the app knows.** Columns are Worked · Regular · OT ·
   Double · Break (Mark gave the order twice the same day and the second is what
   shipped: the total leads, the three figures that make it up follow, and Break
   — what was deducted to REACH Worked rather than a part of it — sits last), with a new **Shift** column after
   Shop carrying `position`. A `≠` chip on an hours cell names our recomputed
   figure beside the stored one, because "the app disagrees with 5 rows" had
   lived only behind a tab and a row expansion; the OT cells carry
   `proposeOvertime`'s own `reasons` as a tooltip; the Break cell carries the
   meal finding. All yellow, none red — a disagreement is work for a human, not
   an error. Adding a column cost every other one width, so all twelve were
   rebalanced to 1402 and the labels checked for clipping in the browser; the
   widths key is **v3**, which covers widths,
   visibility AND ORDER — a stored order outranks the declared one, so without
   the bump anyone who already had the table would keep the old arrangement.
   **Break reads in HOURS**, the column staying `unpaid_break_minutes`.
   `InlineValue` gained **`scale`** for it — a stored-vs-shown unit pair
   converting on BOTH read and write, where `format` is display-only and would
   have put 30 in the box the moment you clicked a cell reading 0.50.
   **`NewTimesheet`** is the module's first write that isn't an import: a worked
   shift nobody punched, or paid time that produced none (028's `adjustment`
   kind), which is where a **sick day** finally lands — `sick_hours` had been
   editable only on a shift the person had also worked, which is backwards. It
   writes no overtime split and never touches `source_*`: there was no source,
   and the list's recompute argues with it out loud instead. A reason is
   required, like every other decision in this module.
   Its button is **always rendered and DISABLED on a closed period, never
   hidden** (Mark, 2026-08-05: "instead of hiding the button we should disable it
   then") — a control that vanishes can't be told from a feature that doesn't
   exist, and the filter row shouldn't change width as you page between periods.
   The usual objection, that a greyed control explains itself only on hover and
   the iPad has none, doesn't bite here: the sentence directly beneath already
   reads "This period is closed, so these shifts are read-only", so the reason is
   on screen in words. **Known consequence, accepted:** the Import link lives in
   that dialog, so from a closed period there is no visible route to the import
   screen — switch to the open period, or go to `/timesheets/import` directly,
   which is no loss because a closed period refuses an import anyway.
   Its button was pulled from the list and PUT BACK the same day (Mark,
   2026-08-05) — "remove the add timesheet button on pay period sheet" meant a
   different screen than the one it was on. It reads **New timesheet** now, per
   the app's `New <thing>` create convention, and the component is
   `NewTimesheet.tsx`.
   **"TIMESHEET", ONE WORD, EVERYWHERE** (Mark, 2026-08-05: "I think
   'timesheet' unless that is technically incorrect"). It isn't — both spellings
   are dictionary-valid and one word is what payroll software uses — and it was
   already the majority here: the tables are `timesheets` and
   `timesheet_imports`, the modules `lib/timesheets`, the components
   `TimesheetsList` / `ImportTimesheets`. Only the visible strings and the ROUTE
   said "time sheets", so the route moved `/time-sheets` → `/timesheets` (with
   `/timesheets/import`), and `lib/nav.ts`'s slug and label with it.
   **A TIMESHEET AND A SHIFT ARE NOT THE SAME WORD** and both survive: a
   timesheet is the RECORD, a shift is the period of work it describes. Hence
   "New timesheet" on the button, "Worked shift" in its kind picker, and "163
   shifts" in the list's totals — that last one counts periods worked and is
   right as it stands.
   Also: importing had **exactly ONE door, inside the New timesheet dialog**
   (Mark, 2026-08-05: "It adds a click, but is a clear work flow New
   Timesheet → Import"). It began as a link buried in a paragraph, became a
   button on the timesheets list AND the pay-period list, and ended as a single
   control in that dialog's footer, on the argument that "I need a timesheet
   that isn't here" is the question the form and the import both answer.
   **EVERY COMMAND ON THE SCREEN IS ONE ACTIONS MENU SINCE 2026-09-12** (Mark:
   "move all action buttons on the timesheets page into an actionmenu. place it
   in the title row top-right aligned") — `TimesheetCommandMenu`, replacing
   FIVE controls in two different rows: New pay period, Recalculate… and Close
   pay period… on the period bar, New timesheet and Import timesheets in the
   filter row.
   **TWO GROUPS, AND THE SPLIT IS THE SCREEN'S OWN** — Import Timesheets · New
   Timesheet, then a rule, then New Pay Period · Recalculate Workdays… · Close
   Pay Period…. `PeriodBar` has said since it was hoisted out of the filter row
   that "the controls below act on the SHIFTS … while these act on the PERIOD",
   so that split survives as the menu's two groups rather than as two rows of
   buttons. **Recalculate is in the PERIOD group** because the page already
   classified it there in as many words, though what it rewrites is a column on
   the shifts. **Import LEADS**, which is the 2026-08-22 reversal below still
   holding: importing IS the routine and typing a shift by hand is the
   exception.
   **KNOWN LOSS, and the one to weigh before repeating this**: Import and Close
   each filled BLACK conditionally, so the screen said which of the two was the
   obvious next act — Import on an empty pay period, Close on a full one. A
   menu row has no weight, so that is gone. The app has met this before (the PO
   list's per-row hints, the invoice list's Approve fill) and accepted it; if it
   is missed, the honest fix is a sentence, not a coloured row.
   **What did NOT move**: the no-pay-periods branch still draws `NewPayPeriod`
   as a button, because that state has no title row and no menu and its one way
   out is that button. And New Timesheet is still a DISABLED ROW rather than an
   absent one on a closed period — `NewTimesheet`'s own 2026-08-05 rule — with
   the sentence that explains it still directly under the filters.
   `PeriodBar` lost its `children` slot with the three commands; the row is the
   picker and the chip.
   Measured at 1440: the trigger's right edge is the content margin (1377), its
   top is the h1's (32, ink at 33), and the widest row is 143px of text in the
   216 that `minWidth={240}` leaves.
   **REVERSED 2026-08-22** (Mark: "move the 'import timesheets' button out from
   the new timesheet dialogue and directly onto the timesheet screen"). It is a
   `Link` beside New timesheet in the filter row's right-hand cluster now. The
   2026-08-05 argument reads well and had the frequencies backwards: it costs a
   click on the thing you do EVERY PAY PERIOD to save one on the thing you do
   rarely. Importing is the routine; typing a shift by hand is the exception.
   It is deliberately **NOT disabled on a closed period** where New timesheet
   beside it is — it navigates rather than writing, the import screen states any
   period problem in its own words, and it is also how you reach a DIFFERENT
   pay period's file. The importer OFFERS to open the period a file needs,
   continuing the cadence from `nextPeriodAfter` rather than wrapping the file's
   dates, where it used to state that none covered them and stop; the import screen ends with
   a **`Done`** at the lower right, OUTSIDE the `plan &&` block so it is
   there both before a file is dropped and after one is committed — committing
   clears the plan, so the screen had been leaving you on a success banner with
   nothing to press. **IT IS BLACK ONLY WHILE THERE IS NO PLAN** (Mark,
   2026-08-22: "the 'import x sheets' button should be black and not the 'done'
   button, shouldn't it?"). It should: the panel-commit exception is about the
   ONE OUTCOME A SCREEN IS FOR, and on this screen that outcome MOVES. With a
   file loaded it is `Import n shifts`, so that takes the fill and Done becomes
   the escape beside it; before and after, Done is the only thing to press and
   is the commit. Two black buttons in one row say nothing about which finishes
   the task. Same `DIALOG_COMMIT_CLASS` either way. The rows-with-no-punches list is one collapsed
   line, because those rows are the NORMAL case
   — Homebase prints one for every scheduled day — and ten warnings in front of
   someone whose file is perfect teaches them to skim the section that also holds
   the real failures; and **"fortnight" is "pay period"** in every visible
   string — a rule since widened to EVERYTHING, comments and conversation
   included; see Conventions.
   Known and NOT a bug: 90 meal findings on that pay period's 163 shifts reads as
   a lot, and 28 of the 31 no-meal days would be covered by a signed waiver.
   (This said "zero waivers are loaded — FMP keeps them in its Events table";
   both clauses were wrong by 2026-08-06. 21 waiver PDFs are on file and the
   waivers were never in Events — see the correction under phase 5.)
   **A DAY'S OVERTIME WAS POURED OVER ITS SHIFTS IN UUID ORDER** (found by Mark
   reading one row, 2026-08-05). `pourOverShifts` fills regular hours first and
   then overtime, so the order it walks decides which shift CARRIES the premium
   — and `proposeOvertime` sorted a workday's shifts by `id` while its own
   comment said "chronologically". The day's TOTAL was always right, which is
   why seven years of totals looked fine and nothing caught it; what was wrong
   was the allocation, and it only shows when you read a single shift.
   Eddy Salazar, workday 2026-07-26: 7.20h from 12:18am and 9.50h from 10:10pm.
   The day is 16.70h → 8 regular, 4 OT, 4.70 double. Poured by uuid the LATE
   shift sorted first and took the 8 regular hours, so the app proposed 2.50 OT
   and 4.70 DOUBLE on the seven-hour shift and explained it with "over 8 hours
   in the day; over 12 hours in the day". `ShiftHours` gained **`starts_at`**
   and the pour is chronological, with a shift that has no punch sinking last
   and `id` as the final tiebreak so the answer never depends on row arrival
   order. Measured over all 178 periods: 174 shifts moved, the **needs-review
   queue fell 267 → 135 (132 of it was this bug)**, and the totals did not
   move at all (Δ 0.00), which is the invariant that says only the allocation
   changed. 8 fixtures, checked by reverting: 5 go red and reproduce Mark's
   exact numbers.
   `ShiftProposal` also gained **`day_hours` / `day_shifts`**, and the tooltip
   names them — "That day totals 16.70h across 2 shifts". Overtime belongs to
   the DAY, so a five-hour shift can correctly be told "over 8 hours in the
   day"; on a single row that reads as a contradiction unless the day's own
   total is stated. 126 shifts under 8h still legitimately carry a daily reason.
   **THE MEAL RULE WAS RIGHT AND ITS SENTENCE WAS WRONG.** Mark read "it must
   begin before the end of the fifth hour" as meaning 6h00 and reported breaks
   at 5h32m as wrongly flagged. The threshold is 5h00 — *Brinker* puts the meal
   "no later than the end of the employee's fifth hour of work", and the fifth
   hour RUNS FROM 4h00 TO 5h00 — but the phrasing invites exactly that
   misreading. Settled empirically rather than by argument, over 28,385 real
   shifts carrying both a clock-in and a meal punch: `cTimeSheetError` says
   "Late Break" on **0 of the 18,314** beginning before 5h00 and on **93–95%**
   of those after it, including 3,135 of 3,371 in the 5h00–5h30 band. Thirteen
   years of FileMaker enforce exactly 5h00. Every message now says "within 5
   hours" and never "the fifth hour".
   **A HOMEBASE ROW CARRIES TWO BREAK FIGURES AND WE DEDUCTED THE WRONG ONE**
   (Mark, 2026-08-05, reading Gaspar López's 07-23 shift). The export has
   `Break start` · `Break end` · `Break length` — the ONE recorded meal punch —
   and, twelve columns later, **`Unpaid breaks`**, the TOTAL deducted, in HOURS.
   The importer wrote `Break length` to `unpaid_break_minutes`, which
   `workedHours` subtracts from the clock span. On most shifts the two agree and
   nothing showed; on a long overnight they don't, because a second meal is taken
   and deducted while Homebase's single punch pair still shows only the first.
   Gaspar punched 6:01pm → 8:10am with `Break length` 30 min and `Unpaid breaks`
   1.00, so we came out 0.50h long and the overtime recompute proposed half an
   hour of extra DOUBLE time on it. Measured over both real exports, 159 punched
   rows: **span − `Unpaid breaks` equals Homebase's own `Actual hours` on 159 of
   159**, where `Break length` matches on 153. So `Unpaid breaks` is the
   authority for HOURS WORKED and `breakMinutes` stays the authority for how long
   the recorded MEAL was — which is what the meal rule needs and what the total
   cannot give. The stitcher ADDS the two segments' totals where it merges. 6
   fixtures, one of them Gaspar's verbatim line; reverting turns 3 red and
   reproduces 13.65 against 13.15.
   **Consequence for data already imported:** the fix is in the parser, so rows
   written before it keep the wrong figure until the file is imported again —
   which corrects them in place, the upsert being on `source_row_key`. Measured
   on the 07/20–08/02 pay period: 6 rows, all Gaspar's, 3.03 hours over-counted.
   **ONE PLACE TO DO THE WORK, AND IT IS THE TIMESHEET ROW** (Mark, 2026-08-05:
   "I'm not sure whether it's in pay periods or in timesheets, but there should
   be one place to do what we need… Timesheets seems more natural to me because
   there's more info there so you can judge errors more clearly. In Pay Periods
   you have to just take the app's word for it"). The meal-premium decision and
   the tip-pool figure moved out of the pay-period worksheet and into the row's
   own expansion (`ShiftDecisions.tsx`), beside the punches, the recorded meal
   and the day's hours. The worksheet KEPT its totals and lost both
   editors; it is now the view before you export — how many decisions are
   **ITS VIEWS BECAME FOUR 2026-08-22** (Mark: "can we add an issue filter, to
   make 4 total: Hours, Late Breaks, No Breaks, Tips"). Breaks split because
   they are different problems with different answers — a late meal WAS
   provided and taken at the wrong time, where a missing one was never provided
   — and on the real 08-03 → 08-16 period they run **51 to 4**, so one list of
   55 buried the four that matter under fifty sharing one cause.
   **The other two codes have a home, or the split would silently drop them.**
   `no_second_meal` is a meal that never happened, so it goes with No breaks;
   `short_meal` does too, and that is a LEGAL reading rather than a
   convenience — §512 wants a meal of at least thirty minutes, so one under
   that is not a short meal, it is no meal. The split is TIMING against
   PROVISION and the two counts SUM to every finding, which is the property to
   preserve if a fifth code is ever added.
   outstanding and what they come to.
   **Shipped 2026-08-06: THE PAY-PERIOD SCREENS ARE GONE, and the export is a
   PANEL** (Mark: "since pay periods are now on the timesheet screen, there's no
   need for a pay period menu item"; the record "can be rolled into an 'Export
   Timesheets…' routine that opens the pay periods detail screen like a panel").
   That finished the sentence the 2026-08-05 rework started. Once every DECISION
   had moved onto the shift row, what was left on `/pay-periods/[id]` decided
   nothing — it stated the period, stepped it along the ladder, rolled the shifts
   up and produced the file — and the 178-row LIST beside it existed only to
   choose a pay period, which `/timesheets`' own `PickList` already did.
   So: `components/payroll/ExportTimesheets.tsx` is the old record, opened as a
   `ui/Dialog` at `h-[88vh]` from a command on the new `PeriodBar` (period picker
   · `StatusChip` · New pay period · Export timesheets…) above the shift filters.
   **The screen keeps its name** — "Payroll" was considered and dropped — and the
   routes did not move, so breadcrumbs, `loading.tsx`, scroll keys and nav-memory
   keys were all untouched. `/pay-periods` and `/pay-periods/[id]` are redirect
   shims (`/location`'s pattern, no `loading.tsx` — a redirect thrown during
   render never paints), and the Timesheets sub carries `also: ["/pay-periods"]`
   so a shim lights the right tab on the way through. `PayPeriodsList`,
   `PayPeriodDetail`, `ExportPayroll` and `lib/payPeriodRoutes` are deleted;
   `StatusChip` got its own file, having outlived the list it lived in.
   Three things worth knowing.
   **`Mark exported` is no longer offered on the ladder.** `nextStatuses` still
   returns it — `lib/payPeriods` is untouched and a reopen still clears
   `exported_at` — but `PayPeriodActions` filters it out, because Finalize is the
   only route to that status that also FREEZES. Four rem apart on a long screen
   it was merely redundant; side by side in one panel it is a trap that leaves a
   period reading exported with nothing snapshotted and no file anywhere.
   **Finalize is BLACK here** where it was white on the screen, and that is the
   rule applying rather than bending: a panel produces one outcome, so its footer
   is a two-weight decision (`DIALOG_COMMIT_CLASS` beside a text Close and a
   white Download). It also LEAVES on success by closing the panel rather than
   navigating — the receiving screen's lesson, same gesture in a panel's terms.
   The confirm is a SECOND `Dialog` rendered as a SIBLING, not nested inside the
   first: both are `z-[60]`, so the later portal paints on top and the panel stays
   up behind it.
   **The commit row had to move to the `footer` prop**, which is what forced the
   old `ExportPayroll` to be absorbed rather than composed — its buttons were the
   last row of a body that now scrolls, and a commit that scrolls away is the
   exact thing that bullet exists to prevent.
   Measured win: the two screens ran the same seven queries over the same seven
   tables, so the merge is ONE wave — 8 queries where the pair needed ~15. The
   export panel's inputs are derived on the server beside the table's own rows,
   from the same `sheets`; nothing in the panel renders until it is opened.
   Known cost, accepted: the cross-period view goes — status bands over 178 rows,
   the notes column, the "days ≠ 14" flag, filtering to everything exported. Every
   period is still reachable by range and status in the picker, which grows a find
   box past eight options.
   The export stays with the period regardless: `freeze_pay_period` is
   period-scoped.
   **BOTH CONTROLS ARE COARSER THAN THE ROW THEY SIT IN, and each says so.** A
   row is one SHIFT; a meal premium is per employee-WORKDAY (§226.7 pays one
   hour per workday per CATEGORY — *UPS v. Superior Court* (2011) allows a meal
   hour and a rest hour on one day but never two of either, which is exactly
   029's `unique (org_id, employee_id, workday, kind)`); a tip pool is per
   SHOP-DAY. So on a two-shift day both expansions show the same premium and
   write the same row, and every shift at one shop on one day shows the same
   pool. The premium UPSERTS on the cap's own key, so recording from the second
   shift CHANGES the decision rather than returning a unique-violation to
   somebody standing in a shop — verified: two sends, one row, the same id.
   **Tips have a writer at last.** There was none outside the worksheet, and
   the worksheet could not show you the shift the money was being divided over.
   It goes through `report_pooled_tips`, the definer function 029 added, not a
   direct update — RLS filters rows and not columns, and that function is what
   will let a supervisor report the day's figure without also being able to
   touch the corrected one beside it.
   **Migration 032 — a reason is required only when the premium is OWED.** 029
   made it NOT NULL with a non-empty check on the reasoning that a decision
   nobody can audit is worthless; that is true of the one that PAYS and false of
   the other two, and a pay period carries ninety findings, most of them a short
   shift that needed no meal at all. Demanding a sentence for each is how a
   reviewer learns to stop reviewing (Mark: "don't make it required to enter a
   'why' when waiving or declaring not owed"). The requirement moved onto the
   decision: `check (decision <> 'owed' or reason is non-empty)`.
   **Until 032 is applied a waiver with no reason is refused** with "null value
   in column reason violates not-null constraint" — verified against the live
   database, along with the owed-with-a-reason path and the upsert.
   **Audit scripts must `.order()` before paginating.** A `.range()` sweep with
   no ORDER BY returns rows in whatever order Postgres likes, so pages overlap:
   measured, 44,661 rows fetched held only 27,795 distinct ids. That fabricated
   duplicate shifts, 45-hour workdays and 112,338 double-time hours, and read
   exactly like a catastrophic data-integrity problem. The data is clean —
   44,661 rows, 44,661 distinct `source_row_key`. Check `ids.size === rows.length`
   before believing any whole-table audit.
   **Shipped 2026-08-22 — A BAKER'S DAY IS A NIGHT (migrations 061 + 062, both
   APPLIED).** Mark: "Homebase is simply checking if the shift is on the same
   day, and ignoring if there's enough turnaround time between shifts. It's
   using midnight to delineate between days instead of a 24 hour period that
   could start at 10pm."
   **HOMEBASE IS NOT THE DISAGREEMENT, and that is the first thing to know
   before touching any of this.** `lib/overtime` recomputes Homebase's split
   EXACTLY — 322 shifts over two pay periods, **ZERO disagreements** — because
   our workday was the same midnight-to-midnight default. So neither of the two
   obvious fixes does anything: "recompute it ourselves" writes the same numbers
   back, and "flag where we differ" is silent because there is no difference.
   The only variable is where the workday STARTS.
   Angelica Castellanos, 2026-08-13: 00:13→09:13 then 23:21→07:17, two shifts
   beginning on one calendar date, summed to 15.91h and billed 8 regular / 4 OT
   / 3.91 double with FOURTEEN HOURS of rest in the middle. 28 of these a year,
   all hand-corrected until now — which means the hand-corrections, not the
   overtime, were the non-compliant half. §510 is mechanical about hours over 8
   in a workday; §500(a) is what lets an employer move the workday, and it is
   the mechanism that makes Mark's preferred outcome lawful rather than merely
   cheaper. (Considered and declined, 2026-08-22: a "12 hours of rest between
   shifts" rule instead. There is no rest exception in §510, it has no statutory
   basis, and it pays LESS than the boundary on a short-rest day — most wrong
   exactly where the law is most right.)
   **061: `employees.workday_starts_at`, nullable, null = midnight.**
   PER EMPLOYEE and there is deliberately NO org default: eleven of
   thirty-seven people need it, and an org default of midnight is only the
   absence of a value. Front of house is untouched — their closing shifts start
   19:00 and no single boundary clears both crews.
   **14:00 WAS MEASURED, NOT CHOSEN.** Two error kinds scored at 15-minute
   steps across the whole clock: a *false stack* (two shifts on one workday with
   ≥8h rest) and a *broken double* (two back-to-back shifts split apart). Over
   4,331 shifts in 12 months — midnight 28/8, **14:00 back-of-house 2/8**. The
   kitchen's dead zone (no shift starts at all) runs **09:25 to 16:01**, so
   14:00 has four hours of margin either side. Org-wide 14:00 is 3× WORSE than
   doing nothing; the best org-wide value is 21:00 (15 total), which still
   leaves Erick Mejia's five 18:00 starts. And **every early-morning boundary is
   three to seven times worse than midnight** — 01:00–03:00 drags the
   766-shift-a-year just-after-midnight cluster backwards onto a day already
   full. Don't re-litigate the hour without re-running that sweep.
   **THE CHECK REFUSES ANYTHING UNDER NOON**, and it is load-bearing twice: at
   noon or later at least twelve of the workday's hours fall on the date it is
   named for, and — the real reason — the workday can then only move FORWARD
   from the punch date, so no shift can be pushed into a CLOSED period and no
   backfill is needed. It also refuses `24:00` (midnight by another spelling)
   and seconds (`lib/workday` reads whole minutes, so `14:00:30` would truncate
   silently).
   **`ParsedShift.workday` became `punchDate`**, and `clockInISO`/`clockOutISO`
   became `punchDate`/`clockOutDate`. Two names for one string is how this got
   confusing; the parser now CANNOT state a workday, which is honest, because
   the workday depends on the employee and a CSV parser has none.
   **THE BOUNDARY IS APPLIED IN THE `matched` MEMO, never inside `planImport`.**
   A resolver in the parser fixes the workday at plan time, so linking an
   unmatched person afterwards would import their shifts with the phantom
   overtime day this whole change exists to remove. Deriving it beside the match
   recomputes for free, because `matched` already depends on the manual links.
   **`source_row_key` keys on the PUNCH DATE, never the workday** — it is the
   upsert's conflict target and a workday can move, which would mint a new key
   for a row that already exists and DUPLICATE it. Verified before the change:
   field [1] equals `workday` on 321/321 Homebase and 1000/1000 FileMaker rows,
   so the swap left every existing key byte-identical and needed no backfill.
   **062 EXISTS BECAUSE 061 EXPOSED 028 READING THE WRONG COLUMN** (Mark, on the
   first real import: "Now we have two shifts that the employees have already
   been paid for counting towards the next pay period. I hate it."). 028 derived
   `pay_period_id` from `workday`, harmless while workday was always the punch's
   own date. **WHICH 24 HOURS THE OVERTIME IS COUNTED OVER AND WHICH PAYCHECK
   THE HOURS LAND ON ARE TWO QUESTIONS**, and 028 had already split the columns
   that answer them before reading the wrong one. `pay_period_id` now comes from
   `business_date`; **`workweek_start` STAYS on `workday`**, because the
   workweek exists for the weekly-over-40 and seventh-day rules and those are
   overtime rules. Its trigger had to be RECREATED to fire on `business_date`
   too — `create or replace` on a function does not widen its trigger's events
   (055's lesson). Measured: exactly 2 rows moved, back where they were worked.
   **THE MONEY DOES NOT MOVE ON IMPORT.** The importer writes `hours_*` from
   the SOURCE with `ot_decision: 'source'`; the boundary changes only `workday`,
   and therefore only what `proposeOvertime` PROPOSES. On the real 08-03→08-16
   period that is 80.04h stored (exactly what Gusto paid) against 59.73h
   proposed, flagged on **3 rows, not 24** — most moved shifts were alone on
   their workday either way. Adopting is decision 2 working as designed.
   **Consequence for the parallel run, which will otherwise read as a defect:
   Homebase does not know about the boundary and never will**, so its OT column
   disagrees with ours on the kitchen's evening shifts EVERY pay period, forever.
   That is the feature, not a reconciliation failure. ~3 rows a pay period.
   Screens: the field is on the employee record's Payroll block, and
   **`InlineValue` gained `kind="time"`** (delegating to `ui/TimeField`, which
   already handles Postgres's `HH:MM:SS` → `HH:MM`) — the third kind that does
   not click-to-edit, for the same reason as `date`.
   The import screen gained `uncoveredDays`, which blocks a commit whose punch
   dates no period covers — 028's `timesheet_period_editable(null)` is
   deliberately TRUE, so a periodless row writes with NO error, no trigger ever
   fills the column in, and `/timesheets` fetches BY `pay_period_id`: the shift
   would be invisible and never paid. It first keyed on the WORKDAY and blocked
   Mark's first real import; 062 is why it now keys on the punch.
   **AND THE BUTTON THAT FIXES IT WAS UNREACHABLE** — the "Open <period>" block
   was nested inside `targetPeriods.length === 0`, which was the whole story
   before 061 (either a period covered the file or none did). The case 061
   introduces is neither. A refusal naming something the screen gives you no way
   to settle is how people stop reading refusals — `closeReadiness`'s lesson,
   learned again. `whyCommitIsBlocked` is pure, exported and fixture-pinned so
   the sentence beside the Import button and its `disabled` cannot drift.
   **1122 fixtures pass**, and the suite also passes under UTC+14 and UTC−11,
   which is the real property `workdayFor`'s date arithmetic needs.
   **Shipped the same day: RECALCULATE, on the period bar** (Mark: "Is there a
   way to re-calculate the timesheets without re-importing them?"). There is,
   and it needs no file: the punch is stored as an INSTANT and the boundary is
   on the employee, so `workday` can be re-derived from what is already on the
   row. Before this, applying a boundary to shifts already imported meant
   dropping the same CSV through the importer again — which needs the file, and
   the file is the one thing you do not have three weeks later. It is the
   production module's **Recost** in payroll's terms: read today's inputs,
   restate one derived column.
   **IT WRITES `workday` AND NOTHING ELSE.** 028's trigger then re-derives
   `workweek_start` and 062's re-derives `pay_period_id` from `business_date`,
   which this never touches — so **a row cannot leave the period you are looking
   at**, and the punches, the decided hours, `ot_decision` and every note are
   untouched. The money follows separately and on purpose: moving a workday
   changes what `proposeOvertime` PROPOSES, and adopting stays a per-row
   decision (decision 2).
   **A row with NO PUNCH is skipped.** An `adjustment`'s workday was typed by
   hand and there is nothing to derive it from; recalculating it would move
   somebody's sick day to whatever the epoch renders as.
   It COUNTS BEFORE IT WRITES and names every shift that would move, because
   the answer is usually zero — and it checks the row count afterwards, since a
   closed period matches no policy, changes nothing and returns NO error.
   Verified against the live 08-03 → 08-16 period, all three directions: **0
   moves as things stand** (idempotent, the pay period is already right), **24
   would move back if every boundary were cleared** (the undo path, and exactly
   the 24 that moved), and giving a 6:30am starter a 14:00 boundary moves
   **nothing** — which is the front-of-house-is-untouched property demonstrated
   on a real person rather than argued.

   **The genuinely simplest fix was never a code change and is still open:**
   1,148 of the crew's 1,490 shifts already start 00:00–03:59, and only **101
   evening starts** cause every bit of this. Moving those to 00:0x would delete
   the feature rather than configure it. Ops decision, not ours.

   **Shipped 2026-08-05 — PAYROLL BENEFITS (migration 033, NEEDS APPLYING).**
   Flat money somebody earns for working a shift: the commuter allowance, and a
   shape general enough for the overnight differential and reimbursements Mark
   has already named. It fills `custom_earning_commuter_benefit`, which
   `lib/gustoExport` had been emitting as a hardcoded empty string — so the
   export as it stood was **$432 a pay period short across five people**.
   Three measurements out of the real FileMaker export decided the design, and
   each one killed a piece of the FMP model:
   **(a) `locations` is not touched at all.** FMP had a boolean + amount +
   period on Location AND an amount + unit + repeating location list on the
   employee. The employee's list classifies every stamped shift on its own:
   Angelica Castellanos (configured DF02) 0 of 359 DF01 shifts, 4 of 4 DF02;
   Erick Mejia 0 of 615 DF01, 32 of 34 DF02. DF01's flag is on with **no
   amount**, so the location row isn't even the source of the money — it carries
   one redundant bit, and a second place to state one fact is 016's
   `nextDeliveryDate` trap. The amount cascades entitlement → benefit default,
   design rule 6's shape.
   **(b) Nothing is stamped onto a timesheet.** FMP's script wrote a dollar
   figure at import and **the stamp has holes** — Casildo Herrera worked seven
   consecutive DF02 overnights in July 2024 unstamped, and two configured people
   (one active) were never stamped at all. Nothing surfaced it, because a
   stamped number cannot explain itself: a $0 and a person who was never
   entitled look identical. So an accrual is DERIVED (decision 3's posture) and
   FROZEN at export (decision 10's), which is exactly how tips already work.
   **(c) It paid per SHIFT** — 32 employee-days carry two $12 stamps, 16 of them
   in 2026 — while both FMP unit fields literally read `Day`. Mark's reading is
   per shift and the money agrees with him; seeded `per_shift`, one tap to
   change on the new screen.
   Schema: `payroll_benefits` (the catalog: code, name, `gusto_column`, unit,
   `default_amount`, **`is_active`** — that spelling, because
   `catalog/ActiveToggle` hardcodes `.update({ is_active })`), `employee_benefits`
   (the entitlement, **`location_id` NOT NULL**, one row per shop), and
   `timesheet_benefits` (the frozen snapshot, **SELECT-only policy and no
   insert/update/delete at all** — the sole writer is `freeze_pay_period`, which
   is definer and bypasses RLS, so the snapshot is structurally unwritable from
   the app).
   **The entitlement's constraint is an EXCLUSION, not a unique index** (027's
   btree_gist idiom, second outing): `(org, employee, benefit, location)` plus
   `daterange(starts_on, ends_on, '[]')`. A plain unique index would make the two
   date columns decoration — "$12 through June, $15 from July" would be
   inexpressible — and this makes "which entitlement pays this shift" a TOTAL
   function, which is what lets `lib/payrollBenefits` be deterministic. Its one
   cost is real: no `on conflict` target, so the backfill selects-then-updates
   rather than upserting.
   **Entitlement writes are deliberately NOT gated on period editability**,
   unlike `break_premiums` and `tip_pools`. An entitlement is a standing fact
   about a PERSON (the class of `employees.excludes_tips`, which 028 left
   ungated for the same reason); `period_editable_on` takes ONE day while an
   entitlement carries an unbounded range spanning closed periods; and what
   decision 8 protects is money already PAID, which the freeze protects instead.
   **The snapshot is what earns this table its ungated write** — which is also
   why `mergeFrozen` makes the frozen figure WIN, backwards from `ExportPayroll`
   preferring its tip recompute. That asymmetry is commented at both ends; a
   tidy-up would restate July's dollars from a September correction.
   **`freeze_pay_period` gained a 4th argument and 033 DROPS IT FIRST.**
   `create or replace` cannot change an argument list — it would create an
   OVERLOAD and leave 029's three-arg version live, so a stale tab would keep
   freezing pay periods with no benefits in them and no error. With the drop a
   stale tab gets PostgREST's `PGRST202`, which is loud. The benefit payload is
   **sparse by construction** (most shifts accrue nothing), so it checks that
   every row it was GIVEN landed rather than that every timesheet is covered —
   the opposite of the allocations guard beside it — and it DELETES the period's
   accruals before inserting, or a reopened period keeps an orphan for a shift
   that stopped qualifying.
   `lib/gustoExport` is now **data-driven for non-hours earnings**: a new
   `EARNING_COLUMNS` allow-list, `ExportRow.earnings` (a plain **object, not a
   `Map`** — the fixture harness compares with `JSON.stringify` and two different
   Maps both stringify to `{}`, so every assertion would pass unconditionally;
   verified), an optional 4th argument to `buildExportRows` so no existing caller
   moved, and `toCsv`'s eight positional `""` literals replaced by a lookup.
   **It still walks `GUSTO_COLUMNS` and never the earnings map**, so no data can
   add a column — which is what keeps the sick-hours assertion load-bearing, and
   is itself pinned by a fixture that puts `sick_hours` in the map and demands a
   byte-identical file. `touched` widened with `earnings.keys()` or a
   benefit-only person is dropped.
   UI: a read-only **Benefits** block in the timesheet row expansion — the two
   above it are decisions and carry editors, this one explains itself instead,
   naming *"Earned at DF02, and this shift was at DF01"*, which is Angelica's 359
   rows in one sentence and the thing FMP's stamp could never say. A **Benefits**
   column on the worksheet's Hours block (dollars, beside Premium's hours) and a
   per-benefit total on the export summary bar. **`/payroll-benefits`**, a list
   with no detail route (`/shop-sections`' shape) where `gusto_column` is a
   `PickList` over `EARNING_COLUMNS` so a typo is *unenterable*. And a **Payroll
   block on the employee record** carrying the entitlements plus the four columns
   that had **no UI writer anywhere in the app** — `gusto_id`, `homebase_id`,
   `primary_wage_type`, `excludes_tips` — while `exportReadiness` had been
   reporting "N people have no Gusto id" with no way to act on it.
   `migration/backfill-employee-benefits.mjs` (dry run by default) recovers the
   13 people × 19 rows and **diffs its own answer against FileMaker's 4,663
   stamps**, which is what actually proves the rule. It sets
   **`starts_on = 2022-06-27`**, and that is a measurement rather than a guess:
   zero stamps exist before that date in seven years and the first day is a solid
   block of people. Without it Gaspar López Alarcon alone picks up 343 days in
   2020–21 that nobody was ever paid for.
   **The diff's verdict: ZERO days where a currently active person was paid and
   we would not**, and 56 days FileMaker's script missed (Casildo's seven among
   them). All 531 "only FileMaker" days belong to eight **inactive** people whose
   FMP config was cleared when they left, or to a **punchless bare-stamp row** —
   FMP sometimes carried the $12 on a third row with no position, no punches and
   no hours, which the punch-based rule correctly refuses.
   Verified end to end: all 33 migrations apply on the Docker harness, the
   exclusion constraint refused an overlap and accepted an abutting range, the
   freeze refused bogus ids BY NAME and replaced rather than duplicated on
   re-freeze, 479 fixtures pass (29 new, each rule checked by breaking it), and
   **the real export rendered through the real components over the real
   07/20–08/02 pay period matches Mark's actual Gusto file person for person —
   $432.00 vs $432.00.**
   **Qualification is PUNCH-BASED, not hours-based**, and that is the choice a
   rewrite would most likely flip: a flat allowance pays for showing up, so a
   quarter-hour shift earns it in full and a nine-hour PTO adjustment earns
   nothing. There is **no per-hour or percentage unit and there must never be
   one** — a percentage would be a percentage of wages, which needs a rate, which
   decision 1 forbids storing.
   **Shipped 2026-08-21 — THE WORKFLOW GUIDES YOU** (Mark: "there's a workflow
   here and the app should help guide the user through it as various events
   occur. Identify those events and proper responses to them").
   **THE RULES ARE DATA, IN `lib/orderWorkflow`, AND THEY CLOSE THEMSELVES.**
   The six behaviours Mark listed are the same rule from two directions — an ACT
   implies a DATE ("the quote went out, so it was sent today"), a DATE implies a
   STATE ("a quote was sent, so this is a Quote"). Wired as six handlers they
   CHAIN: downloading a quote asks "set the sent date?", and the write answering
   THAT asks "move to Quote?" — two dialogs for one act, the second looking like
   the app second-guessing the answer you just gave. So `whatFollows` closes the
   chain itself and the caller asks ONCE, with a line per consequence.
   **A FINDING THAT CHANGED THE ASK: emailing already stamped its own date.**
   `send-special-order-email`'s `STAGE_COLUMN` has always written
   `quote_sent_at` / `invoice_sent_at` / `receipt_sent_at` / `order_printed_at`,
   so two of the six were already half-built. What was missing everywhere was
   that **nothing ever touched `status` or `todo`**.
   **DOWNLOAD NOW STAMPS SILENTLY TOO** (Mark's call over asking): downloading
   is how a document gets printed, so both routes out of the card record the
   same fact the same way — and **only PREVIEW leaves no trace**, because
   previewing is how you check the wording before committing to either. The
   stamp is skipped when the date is already there: a second copy printed next
   week is not a second send, and overwriting would move the date the customer's
   own copy carries.
   **THREE GUARDS, each a real order that would otherwise break.** *Forward
   only* — 8,330 orders came out of FileMaker and backfilling a quote date onto
   a finished one must not drag its status back. *Never a template or standing
   order* — 051's `special_orders_status_iff_order` makes `status` NULL exactly
   when `kind` isn't `order`, so proposing one proposes a write a CHECK refuses,
   which is the one refusal `InlineValue` cannot explain. *Never a cancelled
   order.* A fourth lives in the CALLERS: **only ask when a date goes EMPTY →
   SET**, since only they know what was there before — correcting a typo is not
   a workflow event, and unsetting a date is somebody undoing something.
   **IT ASKS AFTER THE WRITE, which is why `CompletionDates` uses `onWrite` and
   not `alsoUpdate`** — the latter composes the statement and so runs BEFORE it,
   which would put the question on screen for something that hadn't happened and
   leave it there if the write then failed. `onWrite` carries the `.select()`
   discipline with it, or a silently-refused write would report success and then
   offer to advance an order that never moved.
   **EVERY LINE IS INDIVIDUALLY UNTICKABLE**, and that is decision 4 surviving:
   the app may suggest a to-do and must never write one, so a pre-ticked box you
   can clear keeps the human the author while saving the typing. All accepted
   lines land in ONE statement, so an order can never rest half-advanced — and
   054's trigger then narrates it as one line ("Status changed from lead to
   order; To-do set to Print Order"), so the history reads the same whether a
   person typed it or accepted it here, which is true: they did accept it.
   **THE CATCH-UP OFFER IS THE QUIET HALF** — `StatusCatchUp`, the receiving
   screen's `→` beside the Status cell, yellow, dismissible. The prompts catch
   the moment; this catches the 8,330 imported orders, a date set from a screen
   that doesn't ask, and anyone who declined on Tuesday and wants it on
   Thursday. It reads the DATES ONLY and never the to-do: a stale to-do is
   somebody's note to themselves, where a status behind its own evidence is the
   record disagreeing with itself.
   **A SETTLING PAYMENT OFFERS THE WHOLE STEP** (Mark's addition to his own
   list) — recording the money IS the paid event. It fires on the BALANCE, not
   the payment, so a deposit on a wedding order doesn't ask; and it reads
   `balance - value` because the server hasn't re-rendered yet.
   **A `Leads` BAND WAS BUILT THE SAME DAY AND WITHDRAWN** (Mark, 2026-08-21:
   "I changed my mind about the leads band. lets revert that change. Flagging
   the order is enough for now. I may want to revisit this in the future"). It
   pinned `source === "inquiry"` leads to the top of the list under their own
   band and exempted them from the `upcoming` date filter. **Reverted whole** —
   no dead predicate left behind, since git has it and unreachable machinery is
   a liability rather than a head start.
   What made the reversal safe is that **058's flag already does the job**: a
   new inquiry arrives with `flag_reason` "New Inquiry", which paints the row
   FULL-WIDTH RED and puts it top of `needsAttention`. Confirmed on the live
   list — #10015 arrived flagged and reads as a red row in the ordinary date
   band, which is the noticing this was meant to provide.
   **The one thing that went with it, and is worth knowing if it comes back:**
   the default `upcoming` view wants `event_date >= today`, so an inquiry whose
   customer left the date blank, or asked for a day that has since passed, does
   not appear there at all — it is reached through Needs attention, the Lead
   status filter, or All orders. Measured at the time: 1 of the 3 real inquiry
   leads (#10014, dated yesterday and already worked). If this is revisited, the
   VISIBILITY question is the substantive half; the band is presentation.
   Verified against the live database and the order restored afterwards: setting
   Invoice paid offered both consequences and wrote them in one statement,
   setting Order printed offered the single one as a sentence with no redundant
   checkbox, and the catch-up appeared on an order whose quote had gone out
   while its status still read Lead. **1094 fixtures pass**, 23 new, each rule
   checked by breaking it.
