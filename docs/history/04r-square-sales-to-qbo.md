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

