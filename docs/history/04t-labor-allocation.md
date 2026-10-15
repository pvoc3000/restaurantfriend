# 4t — Labor by Shop (labor cost split by hours, posted to QuickBooks)

## Why (2026-10-14)

Gusto lets each employee have ONE work location, and its QuickBooks sync puts
all of that person's payroll on the Class mapped to it. Anybody who works at
both shops therefore lands entirely on one, so DF01/DF02 labor cost in
QuickBooks is wrong. The timesheets know where the hours were worked.

Options weighed in conversation with Mark, 2026-10-09 to 2026-10-14:

1. **Split total labor by total hours** — CHOSEN ("let's build option 1").
2. Split each employee's own cost by their own hours (more accurate when pay
   rates differ; not chosen).
3. Point Gusto at a clearing location and allocate all of it from the app.
4. **Fix it inside Gusto — RULED OUT.** Researched 2026-10-14 against Gusto's
   own QuickBooks Online article: Gusto can split its journal entry "by job"
   and give each job ONE QuickBooks *Class* (never a Location), so it would
   take a job per role per shop for every person who floats. That collides
   with the rule the Smart Import experiment hit on 2026-09-29 (04d): one pay
   rate can carry only one job title, so two shops at the same rate are two
   jobs Gusto refuses. And every unplanned cover shift would need a job set up
   in Gusto before payroll.

## What was built (migration 205)

- `accounting_labor_accounts`: which QuickBooks accounts are labor. Chosen on
  Settings → Integrations → QuickBooks → Labor Accounts
  (`components/settings/LaborAccountsSettings.tsx`). Expense accounts only.
- `labor_hours_by_month(p_org, p_from, p_to)`: decided hours (regular +
  overtime + double) per shop per month by `business_date`, summed on the
  server (PostgREST's 1,000-row cap). Security invoker, so 028's owner/admin
  policy applies. Sick hours and break premiums are left out.
- `labor_allocations`: one row per month once posted or failed, holding
  `external_ref.qbo {id, sync_token, doc_number, journal_hash}`. Written only by
  `record_labor_allocation` (security definer, owner/admin, no rows on refusal,
  `p_error` keeps the stored ref).
- `lib/laborAllocation.ts` (pure, fixtures in
  `scripts/fixtures/laborAllocation.fixtures.ts`) builds the entry.
- `qbo-sync`: `find_journal_entries` now returns `class_ref`/`department_ref`
  on each line; new `post_labor_allocation` (owner/admin).
- Screen `/labor-allocation`, menu HR → **Labor by Shop**, pageAccess
  `X X X W W`. One row per month for the last twelve; **Review…** opens
  `LaborAllocationDialog`, which reads QuickBooks and shows the entry before
  anything is sent.

## Which accounts count (2026-10-14, corrected the same day)

A chosen account covers ITSELF AND EVERY ACCOUNT UNDER IT
(`expandLaborAccounts`; `qbo-sync` expands again from QuickBooks' own chart).
Mark first chose the parents `Benefit Expenses` and `Employee Earnings`, which
under an exact-account match would have found nothing — Gusto posts to the
sub-accounts. A leaf-only picker was tried for an hour and was WRONG the other
way: QuickBooks lets a parent hold postings, and Gusto posts payroll tax
straight to `Payroll Tax`, which also has a sub-account, so the leaf-only
picker would not offer it. The branch is the rule.

## How the entry works

- **The pool** is every journal-entry line dated in the month on a labor
  account, minus our own `LABOR-` entry, summed per account × (Class,
  Location). Only JOURNAL ENTRIES count — Gusto posts journal entries; a check
  or bill coded to a wage account is not in the pool.
- **Reverse, then re-split**: per account, every bucket is credited away and
  each shop is debited its hours share (largest-remainder cents) carrying BOTH
  its Class and its Location, netted per bucket. This is what makes it right
  in both dimensions — Gusto sets a Class and leaves Location empty, so a
  "DF01 class, no location" bucket has to be emptied, not adjusted.
- **Every account nets to zero**, checked again by the server: total labor
  never changes, only which shop carries it.
- `DocNumber LABOR-YYYY-MM`, dated the last day of the month; the private note
  carries the hours and percentages. Posting again updates the same entry by
  stored id; unchanged (same `journal_hash`) is skipped unless forced.
- A shop with hours and no QuickBooks Class or Location is REFUSED by name,
  never dropped (dropping it would hand its labor to the other shops). Hours on
  no shop are counted and left out.

## Bill-paid accounts (January 2026, the first real review)

Mark's first review, January 2026, checked against his P&L by Class: five
accounts (Commuter Benefit, Overtime, PTO and Sick, Regular Wages, Payroll Tax)
matched to the cent. Two did not. **Workers Comp** and **Medical Dental
Vision** are paid by BILL or CHECK with no class, and Mark's own month-end
journal entries move them onto the shops. The pool reads journal entries only,
so it saw the reclass and not the bill: Workers Comp netted to $0.00 and
Medical to −$817.02, and the split would have undone his allocation and left
negative medical at both shops.

First fix: leave out any account whose postings net to zero or less (kept as
a guard). Mark then said the hand split must NOT be kept ("it was based on
earnings as defined by Gusto, which is what we're trying to correct"), so the
pool now comes from QuickBooks' **General Ledger report** (`qbo-sync`
`labor_ledger`, read-only, owner/admin): every posting on the labor accounts —
journal entries, bills, checks — with the Class and Location each carries. The
report gives NAMES; they are resolved against QuickBooks' Class and Department
lists, and a name that matches nothing refuses the read rather than becoming
"no class" (which would leave that class's balance unreversed). Our own
`LABOR-` entry is still excluded by doc number. With the ledger, Mark's
month-end reclass entries no longer matter: every bucket is emptied and
re-split by hours.

**Unverified against the live report as of this writing**: the column keys
(`klass_name`, `dept_name`, `subt_nat_amount`), the sign convention (a debit to
an expense account positive), and that each account section's header carries
the account id. The first Review… of January checks all three: its "now"
figures must equal the P&L by Class to the cent. `raw: true` returns the
report untouched for checking the parse.

## Known approximation

Gusto dates its entries by check date; hours count on the day they were
worked. A payroll paid on the 3rd for late-month hours lands in the next
month's pool while its hours were in this month's shares. Mark: "I don't need
it to be exact." It washes out month to month. If it ever matters, the fix is
to date the pool by pay period rather than check date.

## Measured

September 2026: DF01 1,457.18 h, DF02 899.52 h → 61.8% / 38.2%. Since July no
shift has a null location and none is at EVENT.

## Verified

- Fixtures: 15 cases; breaking largest-remainder (4 red) and the reversal (6
  red) both caught.
- Migration 205 dry-run on the hosted DB in a never-committed transaction
  (2026-10-14): owner reads hours and writes accounts; `record_labor_allocation`
  posts, records an error without losing the ref, then clears it; a direct
  insert into `labor_allocations` is refused; a mid-month date is refused; a
  supervisor sees 0 rows everywhere and is refused an insert; `anon` cannot
  execute either function. Nothing committed (checked afterwards).

## Not done yet

- (Done 2026-10-14, at Mark's request: 205 applied via `db query --linked` in one
  transaction, after-checks 3 policies / 2 functions / anon refused; `qbo-sync`
  deployed as v50 with `verify_jwt` still true, and it boots.)
- Nothing has been posted to QuickBooks. First post: September 2026, after Mark
  reviews the preview. Then read it back, check both refs stuck, and check a
  P&L by Class shows the split.
- Which accounts Gusto actually posts to has not been looked at; the first
  Review… of September will show them.
