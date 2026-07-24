# Brief: guide membership vs "should order"

**Status: model settled with Mark 2026-07-22; amended 2026-07-23 after
architect review (Cowork), not built.** Read `docs/purchasing-spec.md` §4.1–4.6
and CLAUDE.md first. This supersedes an earlier draft of this file that framed
the problem as "order days vs favorites"; that framing was wrong in an
instructive way — see *What I got wrong*.

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
idea is *should order*. Favorite and should-order are now **different
questions**: a favorite on a non-should-order day is still the preferred
source, just not today's work — the UI keys different affordances off each
(work item 4).

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

Order matters: 0 before anything, 1–2 are one migration verified at the SQL
layer, 3–6 only after the counts check out.

0. **Pre-flight audit (run BEFORE 008, read-only).** The vendor-day gate is a
   new way for a vendor to go silently dark: active items but an empty
   `vendor_locations.order_days` — or no `vendor_locations` row at all (the
   view LEFT JOINs it) — means that vendor never produces a green line. Run
   this in the SQL editor and eyeball it against the real ~11 Monday POs:

   ```sql
   select l.code                                  as location,
          v.name                                  as vendor,
          coalesce(vl.order_days::text, 'NO ROW') as vendor_order_days,
          count(distinct il.id)                   as active_item_locations
   from vendors v
   join vendor_items vi             on vi.vendor_id = v.id          and vi.is_active
   join inventory_items ii          on ii.id = vi.inventory_item_id and ii.is_active
   join inventory_item_locations il on il.inventory_item_id = ii.id and il.is_active
   join locations l                 on l.id = il.location_id
   left join vendor_locations vl    on vl.vendor_id = v.id and vl.location_id = l.id
   where v.is_active
   group by l.code, v.name, vl.order_days
   order by l.code, v.name;
   ```

   `NO ROW` or `{}` on a vendor Mark actually orders from = fix its order days
   on the vendor page (the Mo–Su picker) before or right after 008. `{}` on a
   vendor he genuinely never schedules is correct and stays.

1. **Migration 008** — one migration, one transaction, three parts:

   a. `inventory_item_locations.order_days smallint[] not null default '{}'`,
   mirroring `vendor_locations`. Backfill from the distinct weekdays each
   item-location currently has plan rows for; that is faithful to the present
   data.

   b. **Kill the null-means-default indirection.** Plan rows with
   `vendor_item_id is null` mean "inherit `default_vendor_item_id`" (001), and
   `OrderDaysPicker` still inserts them today. Once membership no longer comes
   from plan rows, the indirection buys nothing and complicates every favorite
   join. Materialize: set each NULL row's `vendor_item_id` to its
   item-location's `default_vendor_item_id`; where an explicit row for the same
   (item-location, weekday, vendor item) already exists, keep the explicit row
   (its par override is deliberate) and delete the NULL one; delete NULL rows
   with no default to resolve to. Then `alter … vendor_item_id set not null`
   and change the FK from `on delete set null` to `on delete cascade` —
   set-null would now violate NOT NULL, and a deleted vendor item's favorites
   should die with it. Log the counts each step touches.
   `order_guide_plan_days` then means only "this vendor item is a favorite on
   this weekday" (plus its `par_qty` / `par_mode` overrides).

   c. **Recreate `v_order_guide` in the same migration** (drop + recreate; the
   column set changes, so `create or replace` won't do). New grain:
   **item-location × vendor item × weekday** — membership is the active
   cascade, `cross join generate_series(1,7)` supplies the weekday, and the
   plan row LEFT JOINs on plain equality
   `(item_location_id, weekday, vendor_item_id)`. The weekday dimension
   **stays** even though membership is day-independent, because per-line par
   overrides live on plan rows *per weekday* — a day-less view couldn't
   surface the right day's par in one column. The page's
   `.eq("weekday", …)` query keeps its shape; expect ~883 rows per weekday at
   DF01.

   New columns, alongside the survivors (`is_orderable` / `hidden_reason` stay;
   membership already implies orderable, so the guide's existing filter stays
   honest):

   - `should_order boolean` — the four-way AND, computed in SQL
   - `is_favorite boolean` — a plan row exists for this line on this weekday
   - `vendor_order_days`, `item_order_days`, `favorite_days` — the three raw
     arrays (`favorite_days` = this line's plan weekdays). These are what make
     the "why isn't this green" explanation free on the client (see below) —
     no text columns needed.

   End the migration file with the verification queries from §Verification as
   comments, so applying and checking are one paste.

2. *(folded into 1c — kept as its own number so old references don't dangle)*

3. **`web/src/app/(app)/order-guide/page.tsx`** — delete the alternates block
   entirely (~100 lines). With membership defined properly the view returns
   every line, and the hand-rolled merge of "plan rows plus other vendor items"
   goes away. Add the new columns to `SELECT`. **Redefine the day logic**,
   which currently derives `availableDays` from plan rows: default the walked
   day to *today, always* (today is when you're walking); show day chips for
   weekdays with a nonzero should-order count. The guide exists every day now —
   a day with zero should-order lines just renders quiet.

4. **`web/src/lib/orderGuide.ts`** — filters become All / Should order /
   Skipped / Will order, and the **default working mode flips from `favorites`
   to `should_order`**. Green (`qtyClass`) and Skipped key off `should_order`.
   The ★ marker on the vendor cell and the blue "switched source" box **stay
   keyed to `is_favorite`** — blue on a non-favorite still means "you changed
   source", which is true whether or not the line was today's work.

5. **`web/src/components/catalog/OrderDaysPicker.tsx`** — write the
   `inventory_item_locations.order_days` array instead of creating and deleting
   plan rows. It converges with `WeekdayPicker`
   (`vendor_locations.order_days`); merge them — `WeekdayPicker` is already
   generic over (table, id, column). The confirm dialog goes: clearing a day
   stops destroying favorites, which is a defect in its own right.

6. **The rest of the sweep** — smaller than it looks, but name it so nothing is
   missed:

   - `ItemLocationRows.tsx` — stops passing plan rows to the picker; the
     order-days column sorts on array length instead of distinct plan-row days.
   - `FavoritesEditor.tsx` — the grid survives as-is functionally, but its
     meaning shifts: checking a day-cell no longer implicitly turns the item's
     order day on (that's the array now). Drop the code path that hides
     null-vendor-item rows — after 008 there are none.
   - `app/(app)/items/[id]/page.tsx` — still fetches plan rows for the
     favorites grid; also needs the item-location `order_days` for the picker.
   - `OrderGuide.tsx` — empty-state copy ("No plan lines for this day…") is
     wrong under the new model; reword around should-order.

## Settled (Mark, 2026-07-22)

- **`in_person` vendors are no different.** The vendor-day condition applies to
  Restaurant Depot and the like exactly as it does to email/online vendors.
- **Empty day sets are meaningful, not missing data.** `order_days = '{}'` on an
  item-location is how you take an item out of focus while keeping it on the
  guide — "sometimes I want to order an alternate item". Never treat empty as
  "any day", and never auto-fill it.

## Build this too: say WHY a line isn't should-order

`should_order` is a four-way AND, so when a line isn't green there are four
possible reasons and, in FMP, no way to see which. The view now ships the three
day arrays on every line, so the client can name the failing condition by
comparing the walked day against each array — `vendor doesn't take Wed`,
`item not scheduled Wed`, `this source isn't a favorite Wed` — the same way
`hidden_reason` explains the active cascade. Surface it on hover or in the item
card. This is the cheap improvement over the old system: the model's complexity
stops being something Mark carries in his head.

## Deliberately NOT doing

- **Collapsing the three day sets.** They answer different questions — the
  vendor's is an objective fact, the vendor item's is the per-source schedule,
  the item's is a master switch over all sources. Mark's answer to empty sets
  above is what makes the third load-bearing.
- **Letting favorites inherit the item's days when they declare none.** Removes
  duplication in the common case, but adds an inheritance rule; boring beats
  clever here (CLAUDE.md).
- **Deriving the day sets from PO history.** The data supports it and spec §3
  parks it in v2. Replacing configuration Mark understands with inference he'd
  have to audit is the wrong trade before the basic loop is habitual.

## Don't change

- Multi-favorite plan rows (schema 003) and per-line `par_qty` — kept; 008
  removes only the null-means-default indirection, not the multi-favorite
  shape. **(Amended 2026-07-23: keeping `par_qty` on the plan row was a
  mistake. 008 left par hanging off a row that gets toggled, so un-favoriting
  destroyed it silently. Migration 009 moved par back to
  `inventory_item_locations.par_by_weekday`, where FMP always had it, and the
  plan row is now a pure favorite record. The multi-favorite shape is
  unaffected.)**
- The rule that inactive vendor / vendor item / inventory item lines are absent
  rather than greyed (Mark, 2026-07-22) — that IS the membership rule above.
- `order_guide_entries` — keyed by (location, date, vendor item); untouched by
  all of this.
- `/cleanup`, untouched by convention.

## Verification

SQL first, web second — the view change is provable in the SQL editor before
any TSX changes:

- Membership count at DF01 should land near 883 per weekday; should-order
  Monday near 229, Wednesday near 118.
- An item-location with `order_days = '{}'` must still be reachable under All
  and must not be green anywhere.
- Clearing an item's order days then restoring them must leave favorites intact.
- Migration 008's NULL-materialization step counts: rows updated + rows deleted
  should sum to the prior NULL-row count, and no plan row has a NULL
  `vendor_item_id` afterward.
- Test reversibly against the live DB and confirm with a read-only query;
  it holds 13 years of history.

Then the web layer: default filter Should order shows ~229 on Monday at DF01;
an off-plan quantity renders blue; hovering a non-green line names the failing
condition.

**Apply 008 and ship the sweep in one sitting.** Between the two, the old page
maps every membership row to `is_favorite: true` and the guide reads as ~883
favorites — harmless in dev, but don't leave it that way across a Monday.

## What I got wrong (keep, so it isn't repeated)

I first read "897 of 1,035 item-locations carry all seven weekdays" as a
migration artifact and proposed re-deriving order days from PO history. Mark ran
FileMaker that way on purpose: seven days was the default and item order days
were only one of four conditions, so leaving them open cost nothing. The lesson
is that the day sets were never meant to carry the whole decision — asking what
*else* gated the FMP guide was the question that unlocked this, and it should
have come before any diagnosis of the data.
