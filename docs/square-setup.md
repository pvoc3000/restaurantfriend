# Pulling daily sales and tips from Square

**Fifteen minutes, most of it waiting for a page to load.** You need one access
token and two location ids.

Until this is done, `/sales` renders an empty table and the **Sync from Square**
button fails with a sentence naming the missing piece — never silently.

---

## What this replaces

Closing supervisors used to type the day's net sales and tips into the
FileMaker shift report, reading them off Square. Once this is set up the app
reads them itself, and **nobody types a tip figure again** — which is also why
the entry field has come off the timesheet row.

The figures land in two places, and the split matters:

| Table | Holds | Why |
| --- | --- | --- |
| `daily_sales` | **Everything Square has**, sales and tips, however far back | Reporting: year-over-year, per pay period, tips as a share of sales |
| `tip_pools.reported_cents` | Tips **only for days in an open or review pay period** | Payroll. 177 of 180 periods are closed and those pay periods are paid — a sync must not move money that already went out |

`corrected_cents` stays yours alone. A re-sync updates what Square says and
**never touches a correction you made** — there is a fixture that fails if
anyone changes that.

---

## Step 1 — mint a Square access token

Donut Friend owns the Square account this reads, so a **personal access token**
is the right credential. OAuth exists for apps acting on behalf of *other*
people's Square accounts, which this is not.

1. Sign in at **[developer.squareup.com](https://developer.squareup.com)** with
   the same login you use for the Square dashboard.
2. **Applications → +** and create one. Call it `restaurantfriend`. (The name is
   only ever seen by you.)
3. Open it and switch the environment toggle at the top from **Sandbox** to
   **Production**. **This is the step that goes wrong** — a Sandbox token looks
   identical, authenticates fine, and returns a beautifully empty report for
   every day of the year. If your first sync reports zero rows and no error,
   this is why.
4. Under **Credentials**, copy the **Production Access token**. It starts
   `EAAA` and is about 100 characters.
5. Check **OAuth → Permissions** lists `REPORTING_READ` and `MERCHANT_PROFILE_READ`.
   A personal access token normally carries everything your account can do; if
   the Reporting API later answers 401 while the token plainly works, this is
   the thing to come back to.

Paste the token into a plain text editor first, not straight from the clipboard
into a terminal — see the note about newlines under *When it goes wrong*.

## Step 2 — store it as a secret

**Never in the database.** `orgs.settings` is readable by every member of the
org; edge-function secrets are not.

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj SQUARE_ACCESS_TOKEN='EAAA…'
```

Verify — this lists names and digests, never values:

```bash
npx supabase secrets list --project-ref kltxioacvneshbyhxtaj
```

## Step 3 — deploy the function

```bash
npx supabase functions deploy sync-square-sales --project-ref kltxioacvneshbyhxtaj
```

Nothing else needs redeploying. This function does **not** import
`_shared/email.ts`, so the usual "redeploy every importer" rule does not apply.

## Step 4 — map each shop to its Square location

Square identifies a shop by an id like `L4X8RBQ0NPQ9K`, not by its name. The
app matches on the **id** deliberately: "DF01 HP" is a dashboard label that
anyone with a Square login can rename, and a rename must not silently stop the
sync.

Ask the function for the list:

```bash
curl -s -X POST \
  'https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/sync-square-sales' \
  -H "Authorization: Bearer $YOUR_SUPABASE_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"locations"}' | jq
```

You get back each location's `id`, `name`, `status`, `timezone` and `currency`.

> **Check the timezone before going further.** Every one should read
> `America/Los_Angeles`. If a shop reports something else, stop and ask — the
> reporting day will not line up with the others and the daily figures will be
> quietly wrong rather than obviously broken.

Then set each id on the shop's record: **Facilities → Locations → DF01 →
Operations → QuickBooks and Square → Square location**. It is an ordinary
editable field (since 2026-09-17; before that it was set by SQL).

Two shops cannot share an id — the database refuses it. That constraint is not
paranoia: a duplicate would double-count net sales forever *and* still
reconcile against Square's own Total row, so nothing else would ever surface it.

## Step 5 — backfill, and prove it

On `/sales`, **Sync from Square** pulls a month at a time. Run it back as far
as Square holds data.

Then prove the whole thing against Square's own numbers rather than trusting
it. Export two files from the Square dashboard — Reports → Sales summary →
group by Location, focus on **Net sales**, daily, then again on **Tips** — and
diff them against what we stored:

```bash
cd web && npm run verify:square -- \
  --net "$HOME/Downloads/sales-summary-… net sales.csv" \
  --tips "$HOME/Downloads/sales-summary-… tips.csv" \
  --through 2026-08-22
```

**`--through` matters.** A dashboard export made today includes today, which is
a partial trading day — in Mark's own export 2026-08-23 read `$112.95` at DF01
against a `$3,700` norm. Compared, it fails every time and tells you nothing.

The run exits non-zero on any disagreement and names each one. What it checks:

| Check | What a failure means |
| --- | --- |
| Every (shop, date) figure, to the cent | The sync is wrong — most likely the money unit. Stop. |
| Days present in the CSV and absent here | A gap in the backfill; re-run that month |
| **The CSV's Total row against the sum of our shops** | **Square has a location you have not mapped.** Every per-shop check can pass while this fails — it is the only thing that catches a third shop nobody mentioned |
| The reporting-day window printed in the file | See below |

---

## The reporting day, and why it is written down

Square's exports carry a line reading `Reporting day (1:00 AM-12:59 AM PT)`.
That is a **dashboard setting**, and it is what `daily_sales.business_date`
means — not a calendar date.

Two things follow.

**It is why our numbers equal the dashboard's.** The Reporting API's
`local_reporting_timestamp` dimension uses that same window, so a day here is
the same day you read on screen. Aggregating raw orders by UTC timestamp — the
obvious alternative — could never reproduce it.

**If anyone changes that setting, re-backfill.** Every stored date silently
re-buckets and the history stops meaning what it meant. The verifier prints the
window out of the CSV so a change shows up as a line that reads differently.

Known and accepted: this is **not** the same boundary as
`timesheets.business_date`, which is the punch's own calendar date. A sale at
00:30 counts on the previous day for sales and the current day for shifts. The
exposure is one hour a night and the effect on any day's tip rate is small
(Mark, 2026-08-23: "just leave it"). Setting Square's reporting day to midnight
would remove it, at the cost of every past dashboard export no longer matching
new ones.

---

## When it goes wrong

| What you see | What it is |
| --- | --- |
| `SQUARE_ACCESS_TOKEN is not set on this project` | Step 2 hasn't run, or ran against the wrong project ref |
| `Square rejected the access token` **plus a `key_shape` block** | Read the block. `had_control_characters: true` or `had_surrounding_whitespace: true` means a newline came along with the paste — re-set the secret. `starts_with_EAAA: false` means it isn't a Square token. Otherwise the token is wrong, revoked, or lacks Reporting permission |
| Sync succeeds, reports **0 rows**, no error | Almost certainly a **Sandbox** token (Step 1.3). It authenticates perfectly and has no data |
| `no location has a Square id yet` | Step 4 |
| `Square location L… is not mapped to any shop` | A real Square location we don't know about. Map it, or ignore it deliberately — its days are being skipped, never guessed |
| `…was not a readable amount` | **Stop and read this one.** Square sent a figure in a shape `moneyToCents` refuses. That is the money-unit assumption failing loudly instead of storing something a hundred times wrong |
| `Square's answer had no data array — the cube or measure names may have changed` | The Reporting API is in open beta and something was renamed. The stored history is untouched — a broken sync stops *updating* and never *blanks* |
| `Square is still computing this window after 90s` | Genuinely slow. Sync a shorter range; already-written months stay written |
| `locations.square_location_id does not exist` | Migration 063 hasn't been applied |
| `record_daily_sales does not exist` | Same |

## Reference

| Thing | Where |
| --- | --- |
| The token | Edge secret `SQUARE_ACCESS_TOKEN` (never the database) |
| The function | `supabase/functions/sync-square-sales/index.ts` |
| The API version | `SQUARE_VERSION` in that file, pinned to `2026-07-15`. Bump deliberately and re-verify — an unpinned version drifts under a beta endpoint |
| The schema | `supabase/migrations/063_daily_sales.sql` |
| The verifier | `web/scripts/verify-square.ts` — code committed, **CSVs never** (a year of private revenue; paths are given on the command line) |
| Who may sync | Purchaser and above (migration 092). Any member may *read* `/sales` |
| The breakdown | Pulled beside net sales and tips since migration 104, for the QuickBooks posting — see below and `docs/quickbooks-sales-setup.md` |

## The breakdown, and the cubes that answer it

Since migration 104 every real sync also stores the day's **lines** on
`daily_sales.breakdown` — what `docs/quickbooks-sales-setup.md` posts. The
Reporting API is a beta cube engine and its catalogue names hundreds of
measures, so which cube answers what was **measured, not read**: the identity
below was proved over sixty days of both shops and every tender type, to the
cent, before a line of the pull was written (2026-09-17).

| Line | Cube and measure | Day dimension |
| --- | --- | --- |
| category (gross net of returns) | `ItemSales.sales_gross_amount + returns_gross_amount` by `category_name`, **`line_item_type = GIFT_CARD` excluded** | `ItemSales.reporting_day` |
| service charge (net) | `ServiceChargesReport.total_service_charge_amount` by `service_charge_name` | `ServiceChargesReport.reporting_day` |
| discounts | `−(Sales.discounts_amount + Sales.comps_amount)` — signed negative there | `Sales.reporting_day` |
| tax | `Sales.sales_tax_amount` | " |
| tips | `Sales.tips_amount` | " |
| gift cards sold | `Sales.gift_card_sales_amount` | " |
| tender (payments − refunds) | `PaymentMethods.total_amount` by `payment_method` + `payment_external_source`, `status = COMPLETED` | **`local_reporting_timestamp` by the hour**, bucketed at the 01:00 rollover — the payment cubes carry no `reporting_day` |
| fee | `−PaymentMethods.fee_amount`, keyed by the tender | " |

```
Σ categories + Σ service charges + tax + tips + gift cards sold
  = Σ tenders + discounts
```

Three things that cost a day to learn:

- **Service charges are inside net sales.** A courier tip or delivery fee on
  a Square Online order is collected with the order and is in the tenders.
  A returned one is negative; the net is what balances.
- **A refund by amount is already a return on a category.** Square reports
  it in `Sales.refunds_by_amount_amount` *and* as a `CUSTOM_AMOUNT` return on
  *Uncategorized* in ItemSales. It is not its own line.
- **Gift card line items are not income.** They ride ItemSales under
  *Uncategorized* with `line_item_type = GIFT_CARD`; excluded there and
  carried once from the Sales cube, net of their own discounts, which
  `discounts_amount` deliberately excludes.

To ask Square a question the function does not already ask, `mode: "query"`
(owner or manager) passes one cube query through and returns the rows:

```bash
curl -s -X POST \
  'https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/sync-square-sales' \
  -H "Authorization: Bearer $YOUR_SUPABASE_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"query","query":{"measures":["Sales.net_sales"],"dimensions":["Sales.location_id"],"timeDimensions":[{"dimension":"Sales.reporting_day","dateRange":["2026-09-10","2026-09-10"],"granularity":"day"}]}}' | jq
```

If a breakdown cube fails, net sales and tips still land and the response
warns which days will refuse to post until a sync brings the breakdown.

### Not set up, deliberately

**There is no nightly cron.** The sync is a button. Adding a schedule would make
this the first scheduled job in the project, and the cost is not the schedule —
it is that an unattended run has nobody reading its response, so it also needs a
run-record table and a way to notice a token revoked in March before June. Worth
doing; not done.

## Payouts (migration 105)

Every **Sync from Square** also pulls the shop's **payouts** — the money Square
sends to the bank — from the Payouts API (`GET /v2/payouts`, REST, not a
Reporting cube) into `square_payouts`, one row per payout keyed by Square's own
id. The token minted in step 1 needs **PAYOUTS_READ**; the current one has it.

What a payout carries, measured on the real account (2026-09-17):

| Field | What it is |
| --- | --- |
| `created_at` | when Square batched it — about 7:20pm PT, the day after the charges |
| `arrival_date` | the day it reaches the bank; what the bank line is dated |
| `amount_money` | the net amount, integer cents; equals the sum of its entries on all 26 payouts checked |
| `end_to_end_id` | `T316V42B337KEBX` — the bank's ACH memo carries it as `IND ID`, so it is the deposit's document number |
| `status` | `SENT` the day it goes, `PAID` once the bank confirms; a `FAILED` one moved no money |

A payout's **entries** (`/v2/payouts/{id}/payout-entries`, paged by cursor at
100) are per charge: `CHARGE` (gross, fee, net), `REFUND`, `THIRD_PARTY_FEE`
(the DoorDash Drive courier charge — the breakdown's `APP_FEE`) and
`GIFT_CARD_LOAD_FEE` (63¢ per gift card loaded, whatever tender bought it).
The sync does not store them; the function's owner-only `get` mode reads them
when a payout needs explaining.

**How a payout relates to the day's entry.** Bucketing every entry by the
charge's reporting day and comparing against the day's card line **net of
every fee**: 18 complete shop-days agreed to within 0–123 cents each (Square's
own fee rounding — the cube and the ledger disagree with each other by a few
cents a day). That is why the daily entry nets *all* fees against the card
line and the deposit is one line for the payout's exact amount; see
`docs/quickbooks-sales-setup.md`.

The pull asks for payouts **created** from four days before the window to two
days after and keeps everything it gets — a payout is created two days after
its charges and one day before it lands, and the upsert makes the overlap
harmless. A payout arriving *tomorrow* is deliberately kept, so its deposit
can be posted tonight and matched by the bank feed in the morning.
