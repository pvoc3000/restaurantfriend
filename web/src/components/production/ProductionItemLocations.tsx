"use client";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";

export type ItemLocationRow = {
  id: string;
  location_id: string;
  par_by_weekday: number[] | null;
  price_override: number | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Per-shop par and price for one item.
 *
 * The par is 009's seven-slot array, slot n = weekday n, and it really does
 * vary by day: item 32 is 18 all week at DF02 and 18/18/18/18/24/36/36 at
 * DF01, because Friday and the weekend are busier.
 *
 * SINCE MIGRATION 043 IT IS A DEFAULT, NOT THE PAR. The par lives on the plan
 * slot; this is the number a NEW slot is seeded with when the item is added to
 * a plan at that shop, and nothing reads it at generation.
 *
 * IT IS READ-ONLY HERE, and the reason is no longer the one that used to be
 * written down. That reason — "`InlineValue` writes a whole column and a par
 * cell has to write one slot of a Postgres array" — has been false since 041
 * shipped `arrayColumn`/`arrayIndex`/`arrayStrip`/`arrayWidth` for the recipe
 * sheet. The real reason now is stronger: after 043 an edit here changes
 * NOTHING THAT EXISTS. It reaches no plan, no schedule and no day; it only
 * changes what some future slot on some future plan will start at. A
 * live-looking editor whose effect is invisible until an unrelated act, on an
 * unrelated screen, at an unspecified later time is worse than a read-only
 * figure — it lies about its own reach. Building it properly would also mean
 * /price-grid's "set" INSERT button, since most (item, location) pairs have no
 * row at all to write to, which is real work for a column scheduled to be
 * dropped once real plans carry the numbers. The plan is where a par is
 * changed in anger, and it is one tap away.
 *
 * Enumerating over ACTIVE locations, never all of them — design rule 3.
 */
export function ProductionItemLocations({
  pars,
  locations,
  gridPrice,
  editable,
}: {
  itemId: string;
  pars: ItemLocationRow[];
  locations: { id: string; code: string; name: string }[];
  /** What the grid says, so an override can be read against it. */
  gridPrice: number | null;
  editable: boolean;
}) {
  const byLocation = new Map(pars.map((p) => [p.location_id, p]));

  type Line = {
    location: { id: string; code: string; name: string };
    row: ItemLocationRow | null;
  };
  const lines: Line[] = locations.map((l) => ({
    location: l,
    row: byLocation.get(l.id) ?? null,
  }));

  const columns: DataColumn<Line>[] = [
    {
      key: "location",
      label: "Location",
      width: 200,
      pinned: true,
      sortValue: (l) => l.location.code,
      render: (l) => (
        <span>
          <span className="font-medium">{l.location.code}</span>
          <span className="ml-2 text-muted">{l.location.name}</span>
        </span>
      ),
    },
    {
      key: "par",
      label: "Default par",
      width: 340,
      render: (l) => (
        <span className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
          {WEEKDAYS.map((day, i) => (
            <span key={day} className="inline-flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-[0.08em] text-subtle">{day}</span>
              <span className={l.row?.par_by_weekday?.[i] == null ? "text-subtle" : ""}>
                {l.row?.par_by_weekday?.[i] ?? "–"}
              </span>
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "price",
      label: "Price here",
      width: 200,
      align: "right",
      sortValue: (l) => l.row?.price_override ?? null,
      render: (l) => {
        if (!l.row) {
          return <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>;
        }
        return (
          <span className="flex flex-col items-end">
            {editable ? (
              <InlineValue
                table="production_item_locations"
                id={l.row.id}
                column="price_override"
                kind="number"
                align="right"
                value={l.row.price_override}
                format={(v) => `$${Number(v).toFixed(2)}`}
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                {l.row.price_override === null ? "—" : `$${l.row.price_override.toFixed(2)}`}
              </span>
            )}
            {/* What it would be without the override, so the exception reads as
                one. Grey, because it is not in force. */}
            {l.row.price_override === null ? (
              <span className={`${READ_ONLY_VALUE} text-[12px] text-subtle`}>
                {gridPrice === null ? "no grid price" : `grid $${gridPrice.toFixed(2)}`}
              </span>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <section>
      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.location.id}
        storageKey="production-item-locations"
        columnChooser
        leading={
          <div className="space-y-1">
            <SectionHeading count={pars.length}>Default pars</SectionHeading>
            <p className="max-w-[80ch] text-[13px] text-muted">
              The default par is what a plan slot starts with when this item is
              added to a plan at that shop. Changing it does not change plans
              that already exist — the number on the plan is the one that gets
              made. A price here overrides the grid for this item at this shop
              only.
            </p>
          </div>
        }
      />
    </section>
  );
}
