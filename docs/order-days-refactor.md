# Brief: guide membership vs "should order"

**Status: model settled with Mark 2026-07-22, not built.** Read
`docs/purchasing-spec.md` §4.1–4.6 and CLAUDE.md first. This supersedes an
earlier draft of this file that framed the problem as "order days vs favorites";
that framing was wrong in an instructive way — see *What I got wrong*.

## The model, in Mark's words

Two separate questions, and the current build answers neither cleanly.

**1. Does this line appear on the guide at all?** Active vendor item **and**
active inventory item **and** active vendor. Nothing else. Maximum flexibility:
everything orderable is reachable every day, in case this is the week you need
it.

**2. Is this a line I need to touch today?** ("should order" — FMP's focus
list.) All four must be true for the day being walked:

```
should_order(day) =
      membership (the active cascade above)
  AND day ∈ vendor_locations.order_days          -- vendor takes orders that day
  AND day ∈ inventory item's order days          -- we order this item that day
  AND day ∈ that vendor item's favorite days     -- and prefer this source
```

Consequences Mark relies on:

- **Green fills the order box for should-order lines** — not for "a quantity was
  entered". Red still wins for an explicitly zeroed line.
- **"Skipped"** = should-order lines whose order amount hasn't been touched.
- **Everything else is present but quiet** — reachable, orderable, not demanding
  attention.

"Favorites" is one of four conditions, not the organising idea. The organising
idea is *should order*.

## What the current build gets wrong

| | now | should be |
|---|---|---|
| membership | items with a plan row that day, plus their alternates | the active cascade, full stop |
| vendor order days | ignored entirely | a should-order condition |
| item order days | not stored; derived from plan rows | stored per item-location |
| green | a quantity was entered | this is a should-order line |
| Skipped | untouched favorites | untouched **should-order** lines |

Measured at DF01, 2026-07-22:

| | lines |
|---|---|
| membership (active cascade) | **883** across 337 item-locations |
| should order, Monday | **229** |
| should order, Wednesday | **118** |
| what we currently show as "All" / "Favorites" (Wed) | 841 / 402 |

883 is the right order of magnitude for the FMP Monday guide, whose record
counter read "1 of 705". Today's Wednesday "Favorites" count of 402 is wrong by
roughly 3× because vendor order days are ignored and membership is conflated.

## Work

1. **Migration 008** — `inventory_item_locations.order_days smallint[] not null
   default '{}'`, mirroring the column `vendor_locations` already has. Backfill
   from the distinct weekdays each item-location currently has plan rows for;
   that is faithful to the present data.
   `order_guide_plan_days` then means only "this vendor item is a favorite on
   this weekday" (plus its `par_qty` / `par_mode` overrides).
2. **`v_order_guide`** — drive membership off the active cascade, LEFT JOIN plan
   rows, and expose a computed `should_order` boolean per line using the four
   conditions. Keep `is_orderable` / `hidden_reason`; membership already implies
   orderable, so the guide's existing filter stays honest.
3. **`web/src/app/(app)/order-guide/page.tsx`** — delete the alternates block
   entirely. With membership defined properly the view returns every line, and
   the hand-rolled merge of "plan rows plus other vendor items" goes away.
4. **`web/src/lib/orderGuide.ts`** — `qtyClass()` keys off `should_order` rather
   than `is_favorite`; filters become All / Should order / Skipped / Will order.
5. **`web/src/components/catalog/OrderDaysPicker.tsx`** — write the array instead
   of creating and deleting plan rows. It converges with `WeekdayPicker`
   (`vendor_locations.order_days`); merge them. The confirm dialog goes: clearing
   a day stops destroying favorites, which is a defect in its own right.

## Decide before building

- **`in_person` vendors.** Restaurant Depot accounts for 65 of the 176 DF01
  Wednesday lines whose vendor doesn't take Wednesday orders — but you *go
  shopping* there rather than sending an order, so its `order_days` may mean
  something different. Ask Mark whether the vendor-day condition applies to
  `order_type = 'in_person'`.
- **Blank day sets.** An item-location or vendor with `order_days = '{}'` will
  never be should-order. Confirm that's intended rather than treating empty as
  "any day".

## Don't change

- Multi-favorite plan rows (schema 003) and per-line `par_qty`.
- The rule that inactive vendor / vendor item / inventory item lines are absent
  rather than greyed (Mark, 2026-07-22) — that IS the membership rule above.
- `/cleanup`, untouched by convention.

## Verification

- Membership count at DF01 should land near 883; should-order Monday near 229.
- An item-location with `order_days = '{}'` must still be reachable under All
  and must not be green anywhere.
- Clearing an item's order days then restoring them must leave favorites intact.
- Test reversibly against the live DB and confirm with a read-only query;
  it holds 13 years of history.

## What I got wrong (keep, so it isn't repeated)

I first read "897 of 1,035 item-locations carry all seven weekdays" as a
migration artifact and proposed re-deriving order days from PO history. Mark ran
FileMaker that way on purpose: seven days was the default and item order days
were only one of four conditions, so leaving them open cost nothing. The lesson
is that the day sets were never meant to carry the whole decision — asking what
*else* gated the FMP guide was the question that unlocked this, and it should
have come before any diagnosis of the data.
