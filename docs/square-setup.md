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

Then set each id on the shop's record: **Location → Locations → DF01 → Square
location id**. It is an ordinary editable field.

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
| Who may sync | Owner or manager. Any member may *read* `/sales` |

### Not set up, deliberately

**There is no nightly cron.** The sync is a button. Adding a schedule would make
this the first scheduled job in the project, and the cost is not the schedule —
it is that an unattended run has nobody reading its response, so it also needs a
run-record table and a way to notice a token revoked in March before June. Worth
doing; not done.
