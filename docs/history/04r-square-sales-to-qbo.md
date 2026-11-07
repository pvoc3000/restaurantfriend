<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4r. 🚧 **SQUARE SALES POSTED TO QUICKBOOKS — replacing Shogo (2026-09-17;
   migration 104 APPLIED 2026-09-17; `sync-square-sales`, `qbo-sync` and
   `qbo-oauth` DEPLOYED).** *Probe, don't read this line.* Probed the day it
   was applied: `daily_sales.breakdown` selects, `accounting_sales_mappings`
   holds all ten roles plus every category and tender seen, every one MAPPED,
   DF01 and DF02 carry a class and a location, and **96 shop-days (2026-08-01
   → 09-17) dry-build through the real builder with 0 refusals, 0 unmapped
   and every day balanced**. Two days warn and both are the documented
   refund-by-amount case (DF02 08-12 $250, DF01 09-11 $13.35): the stored net
   figure excludes it where the breakdown's Uncategorized return carries it.
   Mark posted the first real entry himself the same day (`DF02-2026-09-16`,
   read back with its sync token) and compared it against Shogo's for the same
   day — see the deposits block below for what that comparison settled. Mark: replace the third-party app that posts a
   journal entry per location nightly with a simpler in-app equivalent —
   "all I care about are category sales… also refunds, discounts. Everything
   else can be misc"; "as few mappings as possible… as adaptable when new
   things are encountered as possible"; Shogo "stops working whenever it
   encounters a sales item it hasn't seen before without notice."
   Read **`docs/quickbooks-sales-setup.md`** first (the routine, the entry, the
   parallel run, the cutover) and the breakdown section of
   **`docs/square-setup.md`** (which cube answers what, MEASURED).
   **ONE JOURNAL ENTRY PER SHOP-DAY**, DocNumber `DF01-2026-09-15`, Class and
   Location on EVERY line (a JournalEntry has no header DepartmentRef), the
   QBO id and SyncToken stored on `daily_sales.external_ref` so a repost
   UPDATES the same entry, and a day whose entry has not changed is SKIPPED
   and says so. Journal entry first (Mark's call) — it diffs line for line
   against Shogo's entry for the same day; a sales receipt is a later switch.
   **ONE MAPPING GRID FOR THE ORG, NOT ONE PER SHOP** (`accounting_sales_
   mappings`, Settings → Accounting → Sales from Square): ten fixed ROLES
   plus a row per Square CATEGORY and TENDER the sync has SEEN — `record_
   daily_sales` writes those with no account the moment a new name arrives,
   so an unknown name is on the grid with a picker and an `unmapped` chip,
   posts to its role's default (categories → Uncategorized Income, tenders →
   Undeposited Square Funds), is NAMED on the receipt and counted on the
   Sales screen, and a repost after mapping corrects the entry in place. A
   missing ROLE refuses by name. The shop's Class and Location are the SHOP's
   facts, on `locations` (its Operations tab, beside the Square location id,
   which had no editor before).
   **THE IDENTITY WAS MEASURED BEFORE ANYTHING WAS BUILT** — sixty days of
   both shops and every tender type, to the cent, through the function's new
   owner-only `query` mode: Σ categories (ItemSales gross − returns, GIFT_CARD
   lines excluded) + Σ service charges (net) + tax + tips + gift cards sold =
   Σ tenders (PaymentMethods by the HOUR, bucketed at the 01:00 rollover — the
   payment cubes have no `reporting_day`) + discounts; fees inside the card
   tender. Three traps: service charges are INSIDE net sales; a refund by
   amount is already a CUSTOM_AMOUNT return on Uncategorized; gift-card line
   items are not income. QuickBooks calls income accounts **`Revenue`**, not
   Income — a picker filtered on the wrong word offers nothing.
   **THE BUILDER IS PURE AND THE SERVER VALIDATES** (`lib/salesPosting`,
   `push_bill`'s shape): debits ≠ credits REFUSES naming both sides, **no
   plug line ever**; a negative category flips to a debit; CARD is net of its
   fee and every fee debits the fees role; the payroll figure disagreeing
   with the breakdown is a WARNING (the entry follows the breakdown, which
   has to balance to Square's tenders). `post_daily_sales` checks DocNumber,
   date, balance, every account against the grid, every line's class and
   location against the shop's, and that an Id is present iff the day has
   one. `find_journal_entries` reads a month back for **Compare with Shogo**,
   which identifies Shogo's entries (`260910DF01`, noted "Square …") by the
   class on their lines and diffs per account — the expected deltas are in
   the doc. Every `invokeQbo` call is SEQUENTIAL.
   **Verified**: 1864 fixtures (the real DF01 2026-09-10 asserted on the
   emitted `Line[]`); all 104 migrations replay on the Docker harness and, as
   real roles, a purchaser syncs a breakdown and records a post, staff are
   refused by name, a purchaser's write to the grid is refused, a manual row
   still takes the breakdown, a re-pull reads as stale, a second day claiming
   an entry's id is refused by the index; the deployed modes answer their
   refusals by name and `find_journal_entries` returned Shogo's real entries.
   **NOT yet seen in the browser** (the pane is behind the PIN lock).
   **THE DEPOSITS — migration 105 APPLIED 2026-09-17; `sync-square-sales`,
   `qbo-sync` and `qbo-oauth` DEPLOYED the same day.** *Probe, don't read
   this line.* Probed the hour it was applied: `square_payouts` selects (0
   rows until the first sync), `record_payout_posting(null-id, null, null)`
   answers 0 rows, `record_square_payouts('[]')` answers
   `{"payouts_upserted": 0}` and a bad location raises by name. Mark: "shogo
   creates a deposit that gets matched with an online transaction when I
   download them from my bank. Let's implement this as well."
   **THE DEPOSITS ON THE BOOKS ARE THE BANK FEED'S, NOT SHOGO'S** — read back
   through the new owner-only `query` mode: a Bank Deposit per Square payout
   into Chase ACH, one line to Undeposited Square Funds, every one carrying
   the bank's own ACH memo, no DocNumber, and the DF02 location on DF01's
   payouts too, which is a bank rule adding them. Mark's account of the
   ROUTINE is still what this builds: a deposit on the books before the bank
   line lands, so the feed MATCHES. Uber Eats and DoorDash pay out on their
   own and stay the feed's; this posts nothing for them.
   **ONE DEPOSIT PER PAYOUT, ONE LINE, THE EXACT AMOUNT.** `square_payouts`
   is pulled by every sync from the Payouts API (`loadPayouts`; the token has
   PAYOUTS_READ), keyed by Square's id, arriving-date ranged on the Sales
   screen under a **Square deposits** table with the days' QuickBooks column.
   `buildDeposit` (`lib/salesPosting`, fixture-pinned on the real DF01 payout
   of 2026-09-16) makes a QBO `Deposit` into the new **`bank` role**'s account
   from the `card` role's, class on the line, location on the HEADER (a
   Deposit has one where a JournalEntry does not), DocNumber = the payout's
   `end_to_end_id` — the id the bank memo carries as IND ID. FAILED, zero and
   negative payouts refuse by name. `post_square_payout` validates the amount
   to the cent, the date, the bank, the account, the shop's refs and the
   stored-id rule; `record_payout_posting` stamps the row's amount and date
   into the ref so `payoutPostingState` can say `changed since posted` with no
   rebuild. The post dialog gains a Deposits half sent AFTER the days;
   Compare with Shogo gains a deposits section (`find_deposits` +
   `matchDeposits`: ours by DocNumber, theirs by amount within four days, a
   payout with both marked DOUBLED).
   **EVERY FEE NOW NETS AGAINST THE CARD LINE**, which is the one change to
   104's entry and the measurement that decided the deposit's shape: with
   every payout's entries paged and bucketed by the charge's reporting day,
   18 complete shop-days agreed with the card line net of ALL fees to within
   0–123 cents (Square's own fee rounding, cube against ledger), where the
   gift-card load fee keyed to CASH left the payout short of the entry by the
   whole fee. So the deposit carries no fee lines — they were expensed on the
   day — and Undeposited Square Funds clears to within a few dollars a month.
   Verified: 1873 fixtures; all 105 migrations replay and, as real roles, a
   purchaser records and re-pulls (status moves, the posted ref survives),
   a second payout cannot claim a deposit id, staff read and write nothing
   (0 rows, no error), anon is refused; the deployed modes answer their
   refusals by name; `find_deposits` returned the twelve real deposits of
   09-14..17; and **all 26 real payouts dry-build through the compiled
   builder with a bank role stood in, 0 refusals** — no deposit has been
   posted, and none of this has been seen in the browser.


**Compare with Shogo has a Total row (Mark, 2026-10-04)** — Ours, Shogo and Δ
summed at the foot of the account table. The columns are signed (credit
positive, debit negative), so a side that balances totals $0.00; a non-zero
total is red. Not walked in a browser.


**A TENDER FOLLOWS THE DATE OF ITS SALE, NOT THE DATE IT WAS PROCESSED (Mark,
2026-10-07; `sync-square-sales` DEPLOYED the same day — *probe, don't read
this line*).** DF01's entry for 2026-10-06 was refused $458.85 apart. The DF01
HP register was offline from 5:20 PM to 9:07 PM; its 37 payments (34 card, 3
cash) reached Square at 6:35 the next morning. The Sales cube dates an order
when it is rung up and PaymentMethods dates a payment when it is processed, so
the day's sales had no tender behind them — and 10-07 would have been out by
the same amount the other way. `Sales.total_collected_amount` for the day
($1,973.61) already included them, which is the tell: **collected minus the
tender lines is the missing payment, to the cent.**
The rule is `_shared/tenderDay` (pure, fixtures): a PAYMENT is counted on the
reporting day `Sales` gives its ORDER; a REFUND, and a payment whose order
`Sales` does not carry (62 of 17,868), keep the 01:00 rollover rule. The fees
ride with their payment. Both pulls reach seven days past the window — orders
behind and ahead, payments ahead — and go a fortnight at a time, refusing by
name at the row limit.
**Measured before it was written** (both shops, 08-01 → 10-06, 134 shop-days,
against `total_collected_amount`): by the payment's hour, 1 day off; by the
order's day, 0, moving those 37 payments and nothing else. **And after**, the
new step run query for query through `query` mode over the compiled module:
58 shop-days (09-08 → 10-06) all balance, and three stored lines change —
DF01 10-06 card +$419.72, cash +$39.13, fees +$14.33.
**What it costs:** the card money still PAYS OUT with the day it was
processed, so Undeposited Square Funds carries that day's offline card takings
until the next payout clears them; and Square's payment-dated reports show
those payments a day later than the entry does. Mark chose this over moving
the sales, which would have disagreed with Square's Sales Summary and with the
net sales figure payroll reads.
**A day synced BEFORE its offline payments upload still does not balance** —
correctly; sync it again once they have.

**A RE-POST DOUBLED THE DEPOSIT (2026-10-15, Mark).** Posting 10-14 again with
"Post unchanged days and deposits again" ticked updated both shops' deposits
(551094, 551095 — same ids, sync token 0 → 1) but each came back with TWO
lines, the old and the new, so each deposit read double. Mark deleted the
extra line by hand; the audit log shows an edit, not a second deposit.
Cause: the update is a full update (`sparse: false`) whose lines carry no
`Id`, and QuickBooks reads an id-less line as a NEW line and kept the old one
beside it. Fix (`qbo-sync` v53), at all three posting paths — days, deposits
and the labor split: `withLiveLineIds` reads the live document before an
update and gives its line ids, in order, to the lines being sent; and
`savedLinesMatch` compares what QuickBooks KEPT (line count and sum) with what
was sent after every save, recording the post as FAILED with the reason when
they differ, so a doubled document can no longer pass silently. **PROVEN the
same day**: Mark re-posted 10-14 with "again" ticked — both deposits stayed one
line, no post_error. (An unchanged update does not move QuickBooks' sync
token: the deposits stayed at 2, Mark's hand edit, and the entries at 1.)
**Twelve journal entries had been updated the old way** (both shops, 10-01
through 10-05 and 10-14). **Journal-entry updates did NOT double**: the
proving re-post sent `DF01-2026-10-14` (updated the old way at 14:58) with its
live line ids, and `savedLinesMatch` found the same count kept — a doubled
entry would have kept twice the lines and failed. QuickBooks replaces a
JournalEntry's lines on a full update; only the Deposit appended.

**SYNC FROM SQUARE ASKS WHICH DAYS (Mark, 2026-10-21).** The default was
this month and last, whole and unasked — on Oct 21 that is 09-01 → 10-21, about
102 shop-days re-pulled on every press. The Actions row is now "Sync from
Square…" and opens a dialog with a `RangePicker` (Last 7 Days · Today ·
Yesterday · This Month · Last Month, or any two dates), defaulting to the last
seven days through today; it pulls EVERY day in the range, clipped at today.
Same day, a rolling window that reached back to the oldest day `isDayComplete`
called unfinished was built and committed, then replaced by this. A "skip days
already pulled" box was asked for and dropped: pulled is not final — 10-06 was
pulled after closing and still missed 37 offline payments that uploaded the
next morning — and skipping days splits one Square request into several. The
Close Pay Period panel passes its own range and is not asked. Typechecked and
linted; not walked in a browser (the pane was on the PIN lock screen).

**THE MORNING RUN (Mark, 2026-10-29; migrations 212 and 213 WRITTEN, NOT
APPLIED; `sales-nightly` WRITTEN, NOT DEPLOYED).** "I've been manually syncing
square sales and pushing them to qbo every morning for a few weeks now, and
everything has gone without a hitch. I think it's safe to turn this task into a
cron job, with some sort of fallback mechanism to let me know when there is an
issue." And on the email: "A nice summary email when the job runs that includes
sales and deposits for the previous day. compares sales to the same day 52
weeks ago. This is what Shogo did and I miss it. The email can let us know when
there is a problem as well, and with what. We should also include a banner on
the daily sales page when there is an issue and how to fix it." 7 AM Pacific.
**THE FIRST CRON IN THE APP.** pg_cron fires at 14:00 and 15:00 UTC; the
function goes ahead only when it is 7 AM in `orgs.settings.timezone`, and a
partial unique index on `(org_id, local_date)` for real cron runs makes a
second run on one date a conflict. pg_net does not wait: the function answers
202 and works under `EdgeRuntime.waitUntil`.
**IT SIGNS IN AS A MEMBER OF ITS OWN** (`orgs.settings.sales_automation.
bot_user_id`, a purchaser), minted with service_role by `generateLink` +
`verifyOtp` and signed out at the end, and calls `sync-square-sales` and
`qbo-sync` exactly as the browser does. Neither function changed; the other
way — a service_role door in both — would have rewritten the gates on the code
that writes money.
**THE BUILDER IS THE BROWSER'S, COPIED, NOT TWINNED.** `web/scripts/
sync-shared.mjs` copies `lib/salesPosting.ts` and `lib/quickbooks.ts` to
`supabase/functions/_shared/generated/`, rewriting only the extensionless
imports; `npm run fixtures` runs it with `--check` first and fails on a stale
copy (proven by appending a line to the copy). The run's own rules — the
window (seven days through yesterday), −364 days for "the same weekday last
year", a fix and a link per problem kind, the email — are
`_shared/salesAutomation.ts`, pure and fixture-tested (DST: exactly one of the
two firings runs on each of 10-31, 11-01, 11-02 and both March days); the
screen's half (late after 8 AM, stuck after 20 minutes, an unsent email as a
problem) is `web/src/lib/salesRun.ts`.
**RECIPIENTS ARE BY ROLE** — owner and managers, the shift report's management
rule — so there is no list in settings; the panel (Settings → Integrations →
Square → Morning Sales Run) holds the on switch, the member it signs in as,
the last run and Send a Test Email (a dry run: no sync, no posts).
**Verified**: 2,474 fixtures; tsc and lint; `deno check sales-nightly` (via
`npx deno`) including the generated copies. **Not yet**: 212/213 applied, the
function deployed, the bot member created, a real or dry run, and either screen
seen in a browser. The setup steps are in `docs/quickbooks-sales-setup.md`,
*The morning run*.

**Same day: 212 APPLIED and `sales-nightly` DEPLOYED** (v1, `verify_jwt`
false), after Mark created the member (`sales-bot@donutfriend.com`, "Morning
Sales Run", purchaser). *Probe, don't read this line.* Probed: the table has
RLS on, one read policy and the one-cron-run-per-date index; the function
answers "not signed in" with no JWT and with the bare anon key, and "wrong
secret" to a wrong cron header; no run row was written. **Still to do, Mark's:**
choose the member in Settings → Integrations → Square → Morning Sales Run and
Send a Test Email; set `SALES_AUTOMATION_SECRET` and the two Vault entries;
apply 213; switch on Runs at 7 AM.

**Mark's first test email (2026-10-29, a dry run) read clean and showed two
faults, fixed and redeployed the same day (`sales-nightly` v3).** *Probe,
don't read this line.* (1) **The run would have re-sent twelve unchanged
entries every morning.** 104's `breakdown_hash` is `md5(breakdown::text)` and
the breakdown carries `pulled_at`, so every sync makes every re-pulled day
differ from what was posted — 12 of the window's 14 days, all posted, after
Mark's 14:47 sync of the week. The run now calls a day unchanged when its
JOURNAL hash matches the posted one (DocNumber, date, every line), however
recently it was pulled. The Sales screen's "pulled again" label still reads
the breakdown hash and still lights up on every re-pull; making that hash
ignore `pulled_at` would quiet it and is a separate change to 104's generated
column. (2) **ONLINE** (active, a Square id, no sales since 2026-07-28) was a
row of dashes, and in a real run a "no sales yesterday" problem every
morning; the summary now lists the shops with a day in the week's window. A
dry run also now counts what it WOULD post, under "Would post to QuickBooks".
The vault secret, the URL and the edge secret were proven to match by
calling the function with Vault's values: "not enabled, or not 7 AM".

**213 APPLIED the same day (Mark: "Apply 213").** *Probe, don't read this
line.* pg_cron 1.6.4 and pg_net 0.20.4 installed; `sales-nightly-14utc` and
`sales-nightly-15utc` scheduled and active, each reading
`sales_automation_secret` from Vault. At application the org had the bot
member chosen, timezone America/Los_Angeles, and `enabled` false — the jobs
fire and the function answers "not enabled" until Runs at 7 AM is switched on.
To see what a firing did: `cron.job_run_details` (did the job run) and
`net._http_response` (what the function answered), then the run's row in
`sales_automation_runs`.

**THE EMAIL IN THE APP'S LOOK, WITH THE WEEK CHARTED (Mark, 2026-10-29: "give
the morning email a little Restaurant Friend design flair … Add a sales graph
to the top"; `sales-nightly` v4).** *Probe, don't read this line.* A black
masthead with the wordmark set in type, a 2px window with a hard shadow and
the Mac title bar's ruled stripes (1px table rows — Gmail strips gradients,
SVG and `<style>`), the 48px total with its change on last year as a FILLED
chip (green up, red down, black ink), then the chart: the window's seven days,
every shop together, black bars this week beside the Mac grey with a black
outline for the same weekday last year (grey alone is under 3:1 on white —
dataviz's validator; its lightness/chroma "fails" are the design system's
no-decorative-colour rule, ΔE between the two is 77). One value label, on
yesterday. Then Needs you on the yellow FILL, the black group bands (By shop,
Square deposits, Posted to QuickBooks), and a white Mac button. `RunSummary`
gained `week` (the function now reads the window and the same seven days a
year back in one query). Rendered from the real 10-22..28 figures and checked
at 600 and at 375 wide — no sideways scroll at 375, after narrowing the bars,
stacking the change chip, folding each deposit's QuickBooks document onto a
second line and trimming the gutters. Seen in Chromium only, not yet in Mail
or Gmail. The shift report email is untouched.

### 2026-10-29 — Post to QuickBooks skips on the entry alone

Mark noticed the dialog offering "update" for 24 already-posted days whose
figures had not moved. The dialog called a day unchanged only when BOTH the
journal hash and the breakdown hash matched what was stored, and the breakdown
hash includes `pulled_at` — so every Sync from Square (and the morning run's
seven-day re-sync) made every re-pulled day look changed. Posting would have
rewritten them in place with identical figures: harmless, but 24 pointless
QuickBooks calls. The dialog now compares `journal_hash` alone, as
`sales-nightly` already did; any change of figure or mapping changes the entry
and so its hash. The "pulled again" tag on the list has the same cause and is
not changed here.

**The same afternoon: the real cause was line ORDER.** With the breakdown hash
gone, all 56 posted October days still offered "update". Rebuilt from live data,
none matched its stored `journal_hash`. But reordering each day's lines within
their kind reproduced the stored hash for all 56 (the four with seven
categories needed the search widened to 7!). `sync-square-sales` appends lines
in the order Square returns its rows, which changes from one pull to the next,
and `journalHash` hashed them in that order. It now sorts the line tuples before
hashing (with a fixture that reverses the lines). Every posted day's stored hash
is in the old style, so each is offered as an update ONE more time; after that
post, re-pulls no longer move it. `sales-nightly` carries the generated copy and
has to be redeployed with this.

**And the deposits paid for it.** `depositHash` was built on `journalHash`, so
sorting the lines changed every stored deposit hash too ("Credit" sorts before
"Debit"), and every posted deposit read "update". Mark posted; the run re-sent
both 10/01 deposits and then stopped at DF01's 10/02 deposit, which QuickBooks
no longer has ("Deposit 550951 is no longer in QuickBooks (deleted there?)").
That failure had been invisible while the deposit read "skip". `depositHash`
now has its own fixed-order canonical form, exactly as before; rebuilt from
live data, 50 of 52 posted deposits match their stored hash again, and the two
that don't are the 10/01 pair re-sent during that hour.

**The missing 10/02 deposits, relinked (Mark's choice).** A read-only check of
all 52 stored deposit ids found exactly two missing, both 10/02: #550951 (DF01
$1,831.06) and #550952 (DF02 $1,159.79). Their place is taken by two BANK-FEED
deposits for the same amounts, #550889 and #550893, with lower ids, so they
predate the app's post. Most likely the bank lines were Added instead of
Matched and the app's deposits were then deleted as duplicates. Same accounts
(Chase ACH ← Undeposited Square Funds), but no Class on either, and DF01's
carried the DF02 DTLA location. Both `square_payouts` rows now point at the
bank-feed ids (`relinked_from` keeps the old id; `deposit_hash` cleared so the
next post UPDATES them in place with the app's class and location).

### 2026-10-29 — "This pay period" before the period exists

Mark: the Sales range picker's "This pay period" showed 10/16–10/29 when it
should be 10/26–11/8. The newest `pay_periods` row ended 10/25 (a period is
created when payroll reaches it), so nothing covered today and
`resolveSalesRange` fell back to the last 14 days, with the note saying so. It
now carries the newest period's own cadence forward (its length, from the row)
to the period containing today, and "last pay period" is the newest row. The
14-day fallback remains only for an empty calendar.

### 2026-10-30 — App emails shown as raw source on iPhone

Mark: the shift report and the morning sales email "sometimes" showed on his
iPhone as raw MIME (`--rf-po-boundary` and base64). Traced with three raw
sources he pasted: the copies delivered to mark@donutfriend.com and to
trombino@mac.com were both REPACKAGED by Gmail on delivery (its own divider,
quoted-printable) and well-formed; the broken one was info@donutfriend.com's
SENT copy, which keeps the app's own text verbatim, pulled into the thread on
an iPhone that has info@ as an account — hence "sometimes". That text was also
valid MIME (Python's strict parser: no defects), so `_shared/email.ts` now
packages like Gmail does: a random divider per message, quoted-printable text
bodies, the subject in as few encoded words as fit (two, where it was six
folded lines), and its own Date header. Every function that imports the module
has to be redeployed for it to take effect.

### 2026-11-06 — The courier charge posts to Third Party Fees again

Mark, after reconciling the delivery-app statements for 2026: `Merchant
Services:Third Party Fees` held 265 Shogo lines described `THIRD_PARTY_FEE`,
Jan–Sep, about $450–$1,000 per shop per month — and none for October. The
suspicion was that the courier charge had gone unbooked since the cutover.
**It had not. It was misfiled.** Measured read-only (an owner session minted
and signed out, `sync-square-sales`' `get` and `query` modes, `qbo-sync`'s
`query`):

- `PaymentMethods.fee_amount`, which the sync has always pulled as each
  tender's fee, INCLUDES the DoorDash Drive courier charge on a Square Online
  delivery. What is left after `processing_fee_amount` and `tax_on_fee_amount`
  is exactly the Fees cube's `APP_FEE` and the payout entries'
  `THIRD_PARTY_FEE`: October, DF01 $832.20 (45 charges, $18.10 of it on a
  gift-card-paid order), DF02 $578.27 (33), to the cent. Gift-card load fees
  and Square's `ADDITIONAL_FEE` sit inside processing.
- October's stored fee lines reconcile to the cent against the Fees cube by
  type (DF01 $3,411.72 = capture 2,556.51 + app 832.20 + load 8.27 +
  additional 14.74; DF02 $1,887.16 = 1,289.60 + 578.27 + 19.29).
- Payout entries bucketed by reporting day agree with the day's card takings
  net of fees to within cents only WITH the courier entries counted — so
  Undeposited Square Funds was never short; the card line was already net of
  the charge.
- `DF01-2026-10-04` in QuickBooks: "Square fees" $176.21 to `Merchant
  Services:Square Fees`, of which $84.89 was that day's courier charge.

So from 10-01 the total expense was right and the account was wrong:
$1,410.47 in October and $101.63 for Nov 1–5 (DF01 $54.72, DF02 $46.91) sit in
Square Fees that Shogo would have put in Third Party Fees.

**The fix (Mark: "Yes, build it").** `sync-square-sales` adds
`processing_fee_amount` and `tax_on_fee_amount` to the PaymentMethods pull it
already makes — same rows, so the courier charge follows the same
order-day rule as the fee it is part of — and records the remainder as one
`app_fee` line (key `APP_FEE`). **It is a PART of the fee lines, not beside
them**: the fee lines still carry every fee, so a builder that has never
heard of `app_fee` (an old browser tab, an undeployed `sales-nightly`) posts
exactly what it did before, and no deploy order can leave a charge
unexpensed. `buildJournalEntry` debits Square fees *minus* the app fee to the
`fees` role and the app fee to a new role, **`third_party_fees` ("Third-party
app fees", Expense)**; the card line is unchanged. The role is required only
by a day that has a courier charge, and refused BY NAME when empty, like every
role — never folded into Square fees. `diffAgainstShogo`'s comment no longer
lists Third Party Fees as a Shogo-only account. No migration: role rows are
written by the grid, and `post_daily_sales` checks accounts against the grid
whatever the role.
**Verified**: 2,552 fixtures (five new, pinned on the real DF01 10-04; removing
the subtraction turns two red); tsc, lint, `deno check` of
`sync-square-sales` and `sales-nightly` with the regenerated copy. **Dry-built
every October–November shop-day (72) through the compiled builder** with the
app fee computed from live PaymentMethods rows and the role stood in at 740:
0 refusals, Square fees never negative, monthly totals equal to the Fees cube
to the cent. Six days differ from the payout's own dating, in three adjacent
pairs that cancel (a charge dated by its sale here, by Square's effective time
there).
**Live 2026-11-07**: Mark mapped the role to `Merchant Services:Third Party
Fees` (740), then `sync-square-sales` v28 (verify_jwt on) and `sales-nightly`
v11 (`--no-verify-jwt`) were deployed. Probed: the sync answers its
`locations` mode, and the nightly refuses a caller without its secret (401).
**Re-posted 2026-11-07** (Mark: "Re-sync and post"): the 74 posted shop-days
10-01 → 11-06 were backed up, re-synced from Square, and planned against the
old breakdowns. All 74 old stored hashes matched the old build (so the re-sync
changed nothing else), 54 entries differed ONLY by the courier amount moving
from Square Fees to Third Party Fees, 20 days had no courier charge and were
skipped, and all 70 deposits were unchanged and not sent. DF01-2026-10-04 went
first and read back as $91.32 + $84.89 = the old $176.21; the other 53
followed, every one `updated`, no warnings, no `post_error`. Read back from
QuickBooks: 74 entries, all balanced; Third Party Fees October DF01 $832.20,
DF02 $578.27, November 1–6 DF01 $79.43, DF02 $46.91; Square Fees + Third Party
Fees for October equals the measured fee totals (DF01 $3,411.72, DF02
$1,887.16). **The order was**: map *Third-party app fees* to `Merchant
Services:Third Party Fees` on the grid FIRST (or every day with a courier
charge refuses), then deploy both functions. **Catch-up**: Sync from Square
10-01 → today and Post — every posted day's entry changes (its hash moves) and
is updated in place, moving the courier part out of Square Fees; the
deposits do not change. The alternative is one reclass entry per shop.

**Side finding, not fixed:** three payout entries of type `OTHER`, positive and
in no Reporting cube, so never booked — DF02 2026-09-22 +$62.52 (Shogo era),
DF01 2026-10-08 +$42.88, DF02 2026-10-27 +$56.81. Each leaves Undeposited
Square Funds over-cleared by its amount. Unidentified; perhaps courier-fee
credits. Square's dashboard should name them.
