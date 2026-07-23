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

## Backfill — read this before planning it

**The item-level order days are NOT in the transformed export.** Verified
2026-07-22:

- `../../FMP Export/transformed/item_order_days.json` is already in plan-row
  shape (`inventory_item_legacy_id, location_code, weekday, vendor_item_legacy_id,
  par_qty, par_mode`) — the transform already collapsed item days ∩ vendor-item
  days into rows.
- **897 of its 1,035 item-locations carry all seven weekdays**, which is why
  DF01's Wednesday guide shows 476 lines. The artifact originates in the Cowork
  transform pipeline, not in `migration/load.mjs` and not in the web app.
- `item_locations.json` and `inventory_items.json` have no order-day fields at
  all, so there is nothing better to load from what's in hand.

Options, in the order worth considering:

1. **Derive from PO history.** 16.8k POs with `order_date` are already loaded:
   for each item-location, the distinct weekdays it was actually ordered on in
   the last N years. This reconstructs what the shop really does rather than
   what the old config claimed, and it's a single SQL statement. Sanity-check it
   against Mark's expectation that nearly everything is Monday.
2. **Re-export from FileMaker** with the item-level order-day field preserved,
   then re-transform. Correct, but needs the pipeline that lives outside this
   repo.
3. **Seed everything to Monday** and let Mark fix exceptions with the picker.
   Crude, but the picker exists and most items really are Monday-only.

Do NOT backfill from the current `order_guide_plan_days` rows — that just
re-imports the all-seven artifact.

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
