"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDayPaint } from "@/lib/dayPaint";
import type { Location } from "@/lib/session";
import { money, qty, HERE_BADGE_CLASS } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import {
  WEEKDAY_DAY_CLASS,
  WEEKDAY_OFF_CLASS,
  WEEKDAY_ON_CLASS,
  WEEKDAY_PICKER_WIDTH,
  WEEKDAY_SLOT_CLASS,
} from "./WeekdayPicker";

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
  readOnly = false,
}: {
  itemLocationId: string;
  vendorItemId: string;
  orgId: string;
  days: number[];
  /** The seven boxes as a statement — a Read Only cell of the sheet. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState<number[]>(days);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Write the DIFFERENCE between what is on and what should be: insert the
  // days that are missing, delete the ones that are going. A favorite is a plan
  // ROW rather than an array slot, so a swipe across four days is two
  // statements rather than one — inserting an existing favorite would trip the
  // unique plan-row key, and a delete names only the days being removed. Both
  // are attempted; the first refusal reverts the strip.
  async function write(next: number[]) {
    const previous = on;
    const adding = next.filter((d) => !previous.includes(d));
    const removing = previous.filter((d) => !next.includes(d));
    if (adding.length === 0 && removing.length === 0) return;
    setOn(next);
    setBusy(true);
    setFailed(false);

    let error = null;
    if (adding.length > 0) {
      ({ error } = await supabase.from("order_guide_plan_days").insert(
        adding.map((weekday) => ({
          org_id: orgId,
          item_location_id: itemLocationId,
          weekday,
          vendor_item_id: vendorItemId,
        }))
      ));
    }
    if (!error && removing.length > 0) {
      ({ error } = await supabase
        .from("order_guide_plan_days")
        .delete()
        .eq("item_location_id", itemLocationId)
        .eq("vendor_item_id", vendorItemId)
        .in("weekday", removing));
    }

    setBusy(false);
    if (error) {
      setOn(previous);
      setFailed(true);
      return;
    }
    router.refresh();
  }

  // Press a day to flip it; hold and swipe across others to make them match
  // it (`lib/dayPaint`).
  const paint = useDayPaint({ days: on, disabled: busy, commit: write });

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

  if (readOnly) {
    return (
      <span className="inline-flex items-center" aria-label="Favorite days">
        {DAYS.map((d) => (
          <span key={d.weekday} className={WEEKDAY_SLOT_CLASS}>
            <span
              className={`${WEEKDAY_DAY_CLASS} ${
                on.includes(d.weekday) ? WEEKDAY_ON_CLASS : "bg-white text-faint"
              }`}
            >
              {d.label}
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center">
      {DAYS.map((d) => {
        const active = paint.shown.includes(d.weekday);
        return (
          <span key={d.weekday} className={WEEKDAY_SLOT_CLASS}>
            <button
              type="button"
              aria-pressed={active}
              aria-label={`Favorite on ${d.label}`}
              disabled={busy}
              {...paint.dayProps(d.weekday)}
              className={`mac-day ${WEEKDAY_DAY_CLASS} disabled:opacity-35 ${
                active ? WEEKDAY_ON_CLASS : WEEKDAY_OFF_CLASS
              }`}
            >
              {d.label}
            </button>
          </span>
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
  editable,
}: {
  /** The Page Permissions sheet's cell for /vendor-items. */
  editable: boolean;
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
            <span className={HERE_BADGE_CLASS}>
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
      minWidth: WEEKDAY_PICKER_WIDTH,
      // Sorts on how many days it's the preferred source here.
      sortValue: (r) => (r.itemLocationId ? r.favoriteDays.length : null),
      render: (r) =>
        r.itemLocationId ? (
          <FavoriteDays
            itemLocationId={r.itemLocationId}
            vendorItemId={vendorItemId}
            orgId={orgId}
            days={r.favoriteDays}
            readOnly={!editable}
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
