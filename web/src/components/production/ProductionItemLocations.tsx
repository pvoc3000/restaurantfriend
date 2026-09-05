"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
 * Per-shop DEFAULT par and price for one item.
 *
 * The par is 009's seven-slot array, slot n = weekday n, and it really does
 * vary by day: item 32 is 18 all week at DF02 and 18/18/18/18/24/36/36 at
 * DF01, because Friday and the weekend are busier.
 *
 * SINCE MIGRATION 043 IT IS A DEFAULT, NOT THE PAR. The par lives on the plan
 * slot; this is the number a NEW slot is seeded with when the item is added to
 * a plan at that shop, and nothing reads it at generation. The heading and the
 * sentence under it say so.
 *
 * EDITABLE SINCE 2026-09-04 (Mark: "we should be able to edit the default
 * pars"), reversing the read-only call made when 043 shipped. That call argued
 * an edit here "changes nothing that exists"; what it missed is that a NEW item
 * has no plan slot yet, so the default is the only number anyone can write
 * before it reaches a tray — and typing seven pars into a plan for every new
 * item is the transcription the default exists to avoid. One `InlineValue` per
 * weekday through `arrayColumn`, the recipe sheet's idiom, each in its own
 * `min-w-0 flex-1` pen so an open editor cannot lie over its neighbour.
 *
 * Most (item, location) pairs have NO row, so a shop with none offers
 * **Set pars**, which inserts the row — /price-grid's "set" and the inventory
 * item's "Stock here": a cell with no row to write to cannot be an
 * `InlineValue`.
 *
 * Enumerating over ACTIVE locations, never all of them — design rule 3.
 */
export function ProductionItemLocations({
  itemId,
  orgId,
  pars,
  locations,
  gridPrice,
  editable,
}: {
  itemId: string;
  orgId: string;
  pars: ItemLocationRow[];
  locations: { id: string; code: string; name: string }[];
  /** What the grid says, so an override can be read against it. */
  gridPrice: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A shop with no row yet gets one, empty — org_id EXPLICITLY (design rule 1).
  async function createRow(locationId: string) {
    setBusy(locationId);
    setError(null);
    const { data, error } = await supabase
      .from("production_item_locations")
      .insert({ org_id: orgId, item_id: itemId, location_id: locationId })
      .select("id");
    setBusy(null);
    if (error || !data?.length) {
      setError(error?.message ?? "Nothing was written — you may not have permission.");
      return;
    }
    router.refresh();
  }

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
      width: 440,
      render: (l) => {
        if (!l.row) {
          return editable ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void createRow(l.location.id)}
              className="border border-ink px-2 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {busy === l.location.id ? "Setting…" : "Set pars"}
            </button>
          ) : (
            <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
          );
        }
        const row = l.row;
        return (
          <span className="flex gap-x-1 tabular-nums">
            {WEEKDAYS.map((day, i) => (
              // Each slot in its own pen: an open editor is a bare flex wrapper
              // that grows to its text, and without `min-w-0 flex-1
              // overflow-hidden` it lies over the next day's box.
              <span key={day} className="flex min-w-0 flex-1 flex-col items-center overflow-hidden">
                <span className="text-[10px] uppercase tracking-[0.08em] text-subtle">{day}</span>
                {editable ? (
                  <InlineValue
                    table="production_item_locations"
                    id={row.id}
                    column="par"
                    ariaLabel={`${day} default par at ${l.location.code}`}
                    kind="number"
                    align="right"
                    value={row.par_by_weekday?.[i] ?? null}
                    placeholder="–"
                    className="w-full"
                    arrayColumn="par_by_weekday"
                    arrayIndex={i}
                    arrayStrip={row.par_by_weekday}
                    arrayWidth={7}
                  />
                ) : (
                  <span className={row.par_by_weekday?.[i] == null ? "text-subtle" : ""}>
                    {row.par_by_weekday?.[i] ?? "–"}
                  </span>
                )}
              </span>
            ))}
          </span>
        );
      },
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
    <section className="space-y-2">
      {error && <p className="text-sm text-accent">{error}</p>}
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
