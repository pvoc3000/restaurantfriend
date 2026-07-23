# Brief: separate "order days" from "favorites"

**Status: agreed with Mark 2026-07-22, not started.** Read
`docs/purchasing-spec.md` §4.1–4.6 and CLAUDE.md first.

## The problem, in one paragraph

FileMaker kept two independent facts: **item order days** ("we order this here
on Mon/Fri") and **favorites** ("and we prefer this vendor item"). The current
schema merged them into one table, `order_guide_plan_days`, whose rows are
`(item_location, weekday, vendor_item)`. An item's order days are therefore not
stored — they're derived from which favorites happen to exist. That conflation
is the direct cause of three problems:

1. **The guide can't show an item with no favorites for the day.** `/order-guide`
   asks `v_order_guide` for the day's plan rows and builds the "All" filter from
   the *alternates of those items*. An item with zero rows never enters the list,
   so it can't be ordered on the off chance — the exact FMP behaviour Mark relies
   on (clear the order days, keep the item reachable).
2. **Clearing a day destroys favorites.** `OrderDaysPicker` deletes that
   weekday's rows, so which vendor you preferred is lost. The confirm dialog in
   that component is papering over avoidable data loss.
3. **Order days can't be corrected in bulk**, because there's nothing to correct
   — only rows to delete and recreate, which loses vendor choice and per-line par.

Multi-favorite per day (schema 003) and per-line `par_qty` are good and must
survive. They never required the merge: item-level days and a multi-row
favorites table are orthogonal.

## Target model

Add order days to the item-location, mirroring the column `vendor_locations`
already has:

```sql
alter table inventory_item_locations
  add column order_days smallint[] not null default '{}';
```

- **`inventory_item_locations.order_days`** — does this item appear on this
  day's guide at this location. The ONLY thing that decides guide membership.
- **`order_guide_plan_days`** — favorites only: which vendor item(s) are
  preferred, plus `par_qty` / `par_mode` overrides. No longer decides membership.

## Work

1. **Migration 008**: add the column; backfill (see below); no drop of
   `order_guide_plan_days` — its rows stay as favorites.
2. **`v_order_guide`**: drive the FROM clause off `inventory_item_locations`
   where `order_days @> array[weekday]`, LEFT JOIN plan rows for that weekday.
   An item with days but no favorite for the day should still emit a line,
   resolving the vendor item via `il.default_vendor_item_id` (today's
   `coalesce(iod.vendor_item_id, il.default_vendor_item_id)` already does this —
   keep it). Emitting one line per favorite, or one line when there are none.
3. **`web/src/components/catalog/OrderDaysPicker.tsx`**: write the array instead
   of inserting/deleting plan rows. It becomes almost identical to
   `WeekdayPicker` (`vendor_locations.order_days`) — consider merging them.
   The confirm dialog goes away: clearing a day no longer destroys anything.
4. **`web/src/app/(app)/order-guide/page.tsx`**: the alternates block can be
   simplified — with membership decided by `order_days`, "All" is naturally
   every active vendor item for every item scheduled that day.
5. **`web/src/lib/orderGuide.ts`**: `is_favorite` still means "has a plan row for
   this weekday". Filters keep their current meanings (skipped = untouched
   favorites only).

## Backfill — straightforward

Backfill `order_days` from the distinct weekdays each item-location already has
plan rows for. That is faithful to the current data and needs no re-export.

**Do not "fix" the all-seven-days items.** An earlier draft of this brief called
897-of-1,035 item-locations carrying all seven weekdays a migration artifact.
**It isn't** — Mark ran FileMaker that way deliberately (2026-07-22): seven days
was the default, and leaving items on every day kept the solution flexible
because item order days were only *one* of several conditions deciding whether a
line appeared. Treat the current day sets as correct.

## The real open question: what else filtered the FMP guide

Mark: "whether or not a vendor item appeared in the order guide was determined
by a number of things — inventory order days was just one of them." Those other
conditions are NOT yet identified, and they are why the new guide shows items
his Monday guide didn't. **Ask Mark before guessing.**

One condition is already measurable and is very likely part of it — **the vendor's
own order days**. `vendor_locations.order_days` records which weekdays each
vendor accepts orders at each location, and `v_order_guide` ignores the column
completely. Measured on DF01 Wednesday, 2026-07-22:

| | lines |
|---|---|
| orderable guide lines | 398 |
| vendor **does** take Wednesday orders | 222 |
| vendor does **not** take Wednesday orders | **176** |

The offenders are exactly the vendors you would expect to be day-restricted:
Restaurant Depot (65 lines), Amazon (38), BakeMark (18), CREAMO (11).

If that condition belongs in the guide, it is a small change to the view
(`and vl.order_days @> array[weekday]`) and would cut Wednesday's lines by ~44%
on its own — possibly resolving the complaint without any of the work above.
Confirm with Mark first: some vendors are self-shop (Restaurant Depot, order
type `in_person`) where "order days" may mean something different.

## Don't change

- Multi-favorite plan rows (schema 003) or per-line `par_qty`.
- `/cleanup` — untouched by convention.
- The guide's "only orderable lines" rule (Mark, 2026-07-22): inactive vendor,
  vendor item, or inventory item are all filtered out, not greyed.

## Verification

- `v_order_guide` line count for DF01 Wednesday should drop sharply from 476.
- An item with `order_days = '{}'` must NOT appear under Favorites but MUST be
  reachable under All.
- Clearing a day then re-setting it must leave the favorites intact — the
  regression this whole brief exists to remove.
- Test reversibly on real data and verify with a read-only query afterwards;
  the DB is live and holds 13 years of history.

## Related open threads (CLAUDE.md)

- **"Default vendor item may be the wrong concept."** Same underlying question:
  what drives the guide. Worth settling in the same pass — with `order_days`
  deciding membership, `default_vendor_item_id` becomes the fallback source for
  a scheduled day with no favorite, which is a coherent job for it.
