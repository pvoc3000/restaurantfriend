"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/session";
import { money, qty } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { WEEKDAY_PICKER_WIDTH } from "./WeekdayPicker";

// ISO weekdays, 1 = Monday … 7 = Sunday (CLAUDE.md).
const DAYS = [
  { weekday: 1, label: "Mo" },
  { weekday: 2, label: "Tu" },
  { weekday: 3, label: "We" },
  { weekday: 4, label: "Th" },
  { weekday: 5, label: "Fr" },
  { weekday: 6, label: "Sa" },
  { weekday: 7, label: "Su" },
];

export type VendorItemLocationRow = {
  location: Location;
  /** The item-location row, when this shop stocks the inventory item at all. */
  itemLocationId: string | null;
  itemLocationActive: boolean;
  defaultPar: number | null;
  /** Weekdays this vendor item is a favorite at this location. */
  favoriteDays: number[];
  /** Per-location price override, if one exists. */
  overridePrice: number | null;
  lastOrderDate: string | null;
};

/**
 * Favorite days for ONE vendor item at ONE location — the control spec §4.8
 * describes on the FMP vendor-item card ("a favorite-days row per location").
 *
 * Unlike WeekdayPicker this can't write an array: a favorite is a row in
 * order_guide_plan_days keyed by (item-location, weekday, vendor item), so a
 * day goes on with an insert and off with a delete. Optimistic, reverting on
 * failure — a silently dropped favorite would quietly change what the guide
 * marks green.
 *
 * Deleting is safe: since 009 the plan row carries no payload (par moved to
 * inventory_item_locations, where it belongs), so un-favoriting a day loses
 * nothing but the preference itself.
 */
function FavoriteDays({
  itemLocationId,
  vendorItemId,
  orgId,
  days,
}: {
  itemLocationId: string;
  vendorItemId: string;
  orgId: string;
  days: number[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState<number[]>(days);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle(weekday: number) {
    const adding = !on.includes(weekday);
    const previous = on;
    setOn(adding ? [...on, weekday].sort((a, b) => a - b) : on.filter((d) => d !== weekday));
    setBusy(true);
    setFailed(false);

    const { error } = adding
      ? await supabase.from("order_guide_plan_days").insert({
          org_id: orgId,
          item_location_id: itemLocationId,
          weekday,
          vendor_item_id: vendorItemId,
        })
      : await supabase
          .from("order_guide_plan_days")
          .delete()
          .eq("item_location_id", itemLocationId)
          .eq("vendor_item_id", vendorItemId)
          .eq("weekday", weekday);

    setBusy(false);
    if (error) {
      setOn(previous);
      setFailed(true);
      return;
    }
    router.refresh();
  }

  // All-on / all-off in one click. Turning on inserts only the MISSING days —
  // re-inserting an existing favorite would trip the unique plan-row key.
  const allOn = on.length === DAYS.length;

  async function toggleAll() {
    const previous = on;
    setOn(allOn ? [] : DAYS.map((d) => d.weekday));
    setBusy(true);
    setFailed(false);

    const { error } = allOn
      ? await supabase
          .from("order_guide_plan_days")
          .delete()
          .eq("item_location_id", itemLocationId)
          .eq("vendor_item_id", vendorItemId)
      : await supabase.from("order_guide_plan_days").insert(
          DAYS.filter((d) => !previous.includes(d.weekday)).map((d) => ({
            org_id: orgId,
            item_location_id: itemLocationId,
            weekday: d.weekday,
            vendor_item_id: vendorItemId,
          }))
        );

    setBusy(false);
    if (error) {
      setOn(previous);
      setFailed(true);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center">
      {DAYS.map((d) => {
        const active = on.includes(d.weekday);
        return (
          <button
            key={d.weekday}
            type="button"
            aria-pressed={active}
            aria-label={`Favorite on ${d.label}`}
            disabled={busy}
            onClick={() => toggle(d.weekday)}
            className={`inline-flex h-8 w-8 items-center justify-center border border-l-0 border-ink text-xs tabular-nums transition-colors first:border-l disabled:opacity-35 ${
              active ? "bg-ink text-white" : "bg-white text-faint hover:text-ink"
            }`}
          >
            {d.label}
          </button>
        );
      })}
      {/* Bordered rather than filled so it reads as a command, not an 8th day. */}
      <button
        type="button"
        aria-pressed={allOn}
        aria-label={allOn ? "Clear every favorite day" : "Favorite every day"}
        disabled={busy}
        onClick={toggleAll}
        title={allOn ? "Clear every day" : "Favorite on every day"}
        className="ml-2 text-xs text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 disabled:opacity-35"
      >
        {allOn ? "None" : "All"}
      </button>
      {failed && <span className="ml-1 text-xs text-accent">retry</span>}
    </span>
  );
}

/**
 * One row per location: where this vendor item is the preferred source, what it
 * costs there, and when it was last actually bought. This is the context a
 * vendor-item row in a grid can't carry, and the reason this screen exists.
 */
export function VendorItemLocations({
  rows,
  vendorItemId,
  orgId,
  globalPrice,
  activeLocationId,
}: {
  rows: VendorItemLocationRow[];
  vendorItemId: string;
  orgId: string;
  globalPrice: number | null;
  activeLocationId: string | null;
}) {
  const dash = <span className="text-faint">—</span>;

  const columns: DataColumn<VendorItemLocationRow>[] = [
    {
      key: "location",
      // The row IS the location — never hideable.
      pinned: true,
      label: "Location",
      width: 180,
      sortValue: (r) => r.location.code,
      render: (r) => (
        <>
          {r.location.code}
          {r.location.id === activeLocationId && (
            <span className="ml-1.5 border border-ink px-1 text-[10px] uppercase tracking-[0.12em] text-ink">
              here
            </span>
          )}
        </>
      ),
    },
    {
      key: "favorite_days",
      label: "Favorite days",
      width: WEEKDAY_PICKER_WIDTH,
      // Sorts on how many days it's the preferred source here.
      sortValue: (r) => (r.itemLocationId ? r.favoriteDays.length : null),
      render: (r) =>
        r.itemLocationId ? (
          <FavoriteDays
            itemLocationId={r.itemLocationId}
            vendorItemId={vendorItemId}
            orgId={orgId}
            days={r.favoriteDays}
          />
        ) : (
          <span className="text-xs text-faint">not stocked here</span>
        ),
    },
    {
      key: "price",
      label: "Price",
      width: 155,
      align: "right",
      sortValue: (r) =>
        r.overridePrice === null
          ? globalPrice === null
            ? null
            : Number(globalPrice)
          : Number(r.overridePrice),
      render: (r) =>
        r.overridePrice !== null ? (
          <span className="text-body">
            {money(r.overridePrice)}
            <span className="ml-1 border border-ink bg-mark-fill px-1 text-xs text-ink">
              override
            </span>
          </span>
        ) : (
          <span className="text-subtle">{money(globalPrice)}</span>
        ),
    },
    {
      key: "par",
      label: "Item par",
      width: 120,
      align: "right",
      sortValue: (r) => (r.defaultPar === null ? null : Number(r.defaultPar)),
      render: (r) => (r.itemLocationId ? qty(r.defaultPar) : dash),
    },
    {
      key: "last_ordered",
      label: "Last ordered",
      width: 155,
      sortValue: (r) => r.lastOrderDate,
      render: (r) =>
        r.lastOrderDate ? (
          <span className="tabular-nums text-muted">{r.lastOrderDate}</span>
        ) : (
          <span className="text-faint">never</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.location.id}
      storageKey="rf.vendorItemLocations.columnWidths.v1"
        columnChooser
      defaultSort={{ key: "location" }}
      rowClassName={(r) =>
        r.itemLocationId && !r.itemLocationActive ? "text-faint" : ""
      }
    />
  );
}
