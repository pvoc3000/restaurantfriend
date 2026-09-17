# Posting each day's Square sales to QuickBooks

This replaces Shogo. Every shop-day that has been pulled from Square can be
posted to QuickBooks Online as **one journal entry** — one line per Square
category, one for discounts, one for tax, one for tips, one per tender, one
for Square's fees — stamped with the shop's Class and Location, and updated
in place when the day is pulled again.

It is a **button, not a schedule**: `Sales → Actions → Post to QuickBooks…`.
A nightly run is a later second door, once a few weeks of posts have read
clean beside Shogo's.

---

## Before the first post

1. **QuickBooks is connected** (`Settings → Accounting`), and in
   `Account and settings → Advanced → Categories` both **Track classes** and
   **Track locations** are on. QuickBooks accepts a class or a location on a
   line and *silently drops it* when the preference is off; the post says so
   afterwards, but it is better not to find out that way.

2. **Each shop knows its Class and Location.** `Facilities → Locations → DF01
   → Operations → QuickBooks and Square`: pick the QuickBooks class and
   location for the shop. Both are required — a shop missing either is
   refused by name. (The Square location id is editable there too; it used to
   be SQL-only.)

3. **The mapping grid is filled in** — `Settings → Accounting → Sales from
   Square`. It is ONE grid for the whole business, not one per shop, and it
   holds three kinds of row:

   | Kind | Rows | Where it comes from |
   | --- | --- | --- |
   | Role | ten fixed slots — unmapped categories, discounts, service charges, tax, tips, gift cards, card, cash, unmapped tenders, fees | always listed |
   | Category | one per Square item category | written by **Sync from Square** the first time it sees the name |
   | Tender | one per payment method — `CARD`, `CASH`, `SQUARE_GIFT_CARD`, `OTHER:UBEREATS`, `OTHER:DOORDASH`, `AFTERPAY`, … | written by the sync likewise |

   Every **role** needs an account before a day that uses it can post; the
   grid says which are still empty. A **category** or **tender** does not:
   one with no account posts to its role's default (unmapped categories → the
   *Unmapped categories* account, usually Uncategorized Income; unmapped
   tenders → the *Unmapped tenders* account, usually Undeposited Square Funds)
   and is **named on the receipt** and counted on the Sales screen until
   somebody maps it. `CARD`, `CASH` and `SQUARE_GIFT_CARD` have fixed homes
   (the card, cash and gift-card roles) whatever the grid says.

   The accounts this was designed against: Beverages, Coffee & Tea, Delivery
   Services, Discounts Given, Ice Cream, Merchandise, Signatures, Special
   Orders, Specials, Uncategorized Income, Wholesale Income (categories);
   `Franchise Tax Board Payable:Sales Tax Payable` (tax); Square Tips; Square
   Gift Cards; Undeposited Square Funds (card and marketplace tenders);
   Undeposited Cash; `Merchant Services:Square Fees`.

---

## The daily routine

1. `Sales → Actions → Sync from Square` (this month and last).
2. `Actions → Post to QuickBooks… (n)`. The dialog builds every day in the
   range **before sending anything** and shows a receipt:

   | Column | Meaning |
   | --- | --- |
   | Action | `create` — never posted; `update` — posted and since pulled again or remapped; `skip (unchanged)` — already in QuickBooks exactly as it would be built; `refused` — see Notes |
   | Debits / Credits | the two sides, which always agree or the day is refused |
   | Unmapped | Square names on this day that posted to a default |
   | Notes | refusals, warnings, and after sending what QuickBooks said |

   Press **Post n entries**. Days go one after another; a failure stops the
   run and names where it stopped, and the days after it are untouched.

3. The **QuickBooks** column on the Sales table then reads the document
   number (`DF01-2026-09-15`), `pulled again` when the day has been synced
   since it was posted (post again to update the entry), or `failed` with the
   reason on hover.

**Unmapped names** are the thing to watch. The Sales screen carries a
standing count linking to the grid; map the name, then post the days again —
the entry is updated in place under the same document number.

---

## What one entry looks like

DF01, 2026-09-10, exactly as Square reported it:

| Side | Account | Amount | From |
| --- | --- | --- | --- |
| Credit | Ice Cream | 130.75 | category, gross net of returns |
| Credit | Coffee & Tea | 77.55 | |
| Credit | Special Orders | 719.20 | |
| Credit | Beverages | 26.50 | |
| Credit | Signatures | 1,764.45 | |
| Debit | Discounts Given | 54.89 | every discount and comp, one line |
| Credit | Sales Tax Payable | 180.74 | every tax Square collected, one line |
| Credit | Square Tips | 153.91 | |
| Debit | Undeposited Square Funds | 2,233.39 | card, **net of fees** |
| Debit | *Uber Eats' account* | 322.71 | tender `OTHER:UBEREATS` |
| Debit | Undeposited Square Funds | 318.84 | tender `OTHER:DOORDASH`, unmapped → default |
| Debit | Undeposited Cash | 50.93 | cash net of cash refunds |
| Debit | Square Fees | 72.34 | |

Both sides come to $3,053.10. Other lines appear only when the day has them:
a **service charge** (delivery fee, courier tip) credits the service-charges
role; **gift cards sold** credit the gift-card liability and gift cards
**redeemed** debit it; a category in net return flips to a debit.

### What is deliberately not posted

- **Cash over/short, pay-ins and pay-outs.** Shogo sent them all to
  Undeposited Cash anyway. The cash line here is what Square recorded as cash
  payments less cash refunds.
- **A refund by amount** (money handed back with no item) is not its own
  line: Square reports it as a return on the *Uncategorized* category, and
  that is where it posts. The receipt names it.
- **Taxes remitted by Uber** are inside the tax line like every other tax
  (Mark's call: one tax account). Uber's payout arrives short of them, which
  is reconciled at the deposit, not here.

### Why it always balances

Measured over sixty days of both shops and every tender type, to the cent:

```
Σ categories + Σ service charges + tax + tips + gift cards sold
  = Σ tenders + discounts
```

with fees inside the card tender. The builder refuses a day that does not
balance and names both sides — there is no plug line, and there must never be
one.

---

## Comparing with Shogo

`Actions → Compare with Shogo…` reads the journal entries already on the
books for the range (up to 31 days), keeps every one that is not ours
(Shogo's are numbered `260910DF01` and noted "Square 2026-09-10"), matches
each to a shop by the class or location on its lines, and shows ours beside
theirs **per account**, with the non-zero deltas in red. Nothing is written,
and it works from dry builds, so it runs before anything has been posted.

Expected differences, from the first real day compared:

- Shogo books a **"Payment Exceptions"** credit against Undeposited Square
  Funds and lowers its category, tax and tip lines by the same total — an
  order it treated as not yet closed. We follow Square's own Sales report,
  which counted it, so our categories, tax and tips read higher by exactly
  that amount and our Square Funds debit likewise.
- Shogo posts **one tax line per tax name** (a dozen Uber lines a day) and
  **one discount line per discount name**; ours are one line each. The
  per-account totals compare all the same.
- Shogo splits the card takings into Square Balance / Square Batched; ours is
  one line net of fees. The account total is the comparison.

## Switching Shogo off

1. Pick a date. Stop Shogo posting from that date.
2. Post that date here, and compare the days before it while both exist.
3. Once a week of posts reads clean, cancel Shogo. The entries it already
   made stay where they are.

---

## When it goes wrong

| What you see | What it is |
| --- | --- |
| `No breakdown has been pulled for this day` | The day was synced before migration 104, or a breakdown cube failed (the sync's warnings say). Sync again |
| `DF01 has no QuickBooks class / location` | Set it on the location's record |
| `No account is set for “Sales tax collected”` | A role row in the grid is empty |
| `The day does not balance: debits … against credits …` | Square's figures disagree with themselves for this day. Sync again; if it persists this day needs a look, and `sync-square-sales`' `query` mode is how to look |
| `QuickBooks did not keep the location / class` | The tracking preference is off in QuickBooks. Turn it on and post again |
| `This day is already in QuickBooks as entry …` | The screen was stale. Reload |
| `pulled again` in the QuickBooks column | The breakdown moved since the post. Post again to update the entry |
| `failed` in the QuickBooks column | QuickBooks refused the last post; the reason is on hover, and the entry it already had (if any) is unchanged |

## Reference

| Thing | Where |
| --- | --- |
| The rule (the entry, the balance, the fallbacks) | `web/src/lib/salesPosting.ts`, fixture-tested |
| The breakdown pull | `supabase/functions/sync-square-sales/index.ts` (`loadBreakdown`); the cube identity is in `docs/square-setup.md` |
| The post and the read-back | `supabase/functions/qbo-sync/index.ts` — `post_daily_sales`, `find_journal_entries` |
| The schema | `supabase/migrations/104_sales_to_quickbooks.sql` |
| The grid | `Settings → Accounting → Sales from Square` (`accounting_sales_mappings`) |
| Who may post | Purchaser and above, the Sales cell in the Page Permissions sheet. Who may map: managers and the owner |
