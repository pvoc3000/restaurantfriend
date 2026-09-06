"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/session";
import { type CatalogItemLocation, HERE_BADGE_CLASS } from "@/lib/catalog";
import { DataTable, type DataColumn } from "./DataTable";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { WeekdayPicker, WEEKDAY_PICKER_WIDTH } from "./WeekdayPicker";
import { FavoritesEditor } from "./FavoritesEditor";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// One row per location, whether or not the item is stocked there — an item
// missing from a shop is a fact worth seeing, and it's where "Stock here" goes.
type Row = { location: Location; il: CatalogItemLocation | null };

/**
 * One row per location so the shops' differences are visible side by side: par,
 * shop section, order days, and the weekday favorites grid behind the row's
 * disclosure.
 *
 * THE WEEKDAY PAR STRIP (Mark, 2026-09-05: "one thing we lost from FMP that we
 * should maybe bring back — different pars for each day of the week"). It was
 * never lost from the DATA — 009 restored FMP's seven-slot `Par__array` as
 * `par_by_weekday` and the guide's view has read it ever since — only from the
 * screen: this table edited `default_par` alone, so the 34 rows carrying a
 * weekday override could be seen on the guide and changed nowhere. Seven
 * `InlineValue`s through `arrayColumn`, the production item record's idiom,
 * each in its own `min-w-0 flex-1` pen. AN EMPTY SLOT MEANS THE DEFAULT, which
 * is what the view's coalesce says and what the column's own label says.
 *
 * The favorites editor is the existing cleanup component reused as-is — same
 * grid, now reachable for healthy items too, which was the gap brief §D names.
 */
export function ItemLocationRows({
  rows,
  locations,
  inventoryItemId,
  baseUnit,
  orgId,
  activeLocationId,
  sectionsByLocation,
  leading,
  editable,
}: {
  /** The Page Permissions sheet's cell for /items — false renders values,
   *  no switch and no "Stock here". */
  editable: boolean;
  rows: CatalogItemLocation[];
  locations: Location[];
  inventoryItemId: string;
  baseUnit: string;
  orgId: string;
  activeLocationId: string | null;
  /** That shop's shelves, in walk order, keyed by location id. Each row is a
   *  different shop, and a shelf belongs to exactly one of them. */
  sectionsByLocation: Record<string, { value: string; label: string }[]>;
  /** The section heading, so it sits ON the table rather than 40px above
   *  it — see DataTable's `leading`. */
  leading?: ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byLocation = new Map(rows.map((r) => [r.location_id, r]));

  const tableRows: Row[] = locations.map((location) => ({
    location,
    il: byLocation.get(location.id) ?? null,
  }));

  // Locations where this item isn't stocked yet get a one-click "Stock here",
  // which is how a new location's catalog gets seeded item by item.
  async function stockHere(locationId: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("inventory_item_locations").insert({
      org_id: orgId,
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  const dash = <span className="text-faint">—</span>;

  const columns: DataColumn<Row>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23). For a location
    // that doesn't stock the item yet, the same slot holds "Stock here" —
    // both are the row's on/off switch.
    {
      key: "is_active",
      label: "Active",
      // WEIGHTS, REBALANCED 2026-09-05 when the item record grew a 192px
      // sidebar: this table's content column is 977px at 1280, and at the old
      // weights Order days resolved to 197px against the 300 its All/None
      // command needs (CLAUDE.md's WEEKDAY_PICKER_WIDTH warning, met). The
      // two weekday strips are the columns that cannot give; Section and Note
      // are the compact set instead. Measured: 350px each at 1280 compact,
      // 320 each at 1440 with all seven columns.
      width: 90,
      sortValue: (r) => (r.il ? (r.il.is_active ? 0 : 1) : 2),
      render: (r) =>
        r.il ? (
          <ActiveToggle
            readOnly={!editable}
            table="inventory_item_locations"
            id={r.il.id}
            active={r.il.is_active}
            label={`Item active at ${r.location.code}`}
          />
        ) : !editable ? (
          <span className="text-faint">—</span>
        ) : (
          <button
            disabled={busy}
            onClick={() => stockHere(r.location.id)}
            className="border border-ink px-2 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Stock here
          </button>
        ),
    },
    {
      key: "location",
      // The row IS the location — never hideable.
      pinned: true,
      // "Shop", not "Location": at this weight the longer word clipped to
      // "LOCA…", and a clipped single-word label means the column is too
      // narrow for its name (CLAUDE.md). It is also what the vendor and item
      // records' new tabs call the same column.
      label: "Shop",
      width: 90,
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
      key: "section",
      label: "Section",
      width: 150,
      hideWhenCompact: true,
      // Still sorts on the shelf's WALK position, not its name — "what order do
      // I meet these shops' copies of this item in" is the question.
      sortValue: (r) => r.il?.shop_sections?.sort_order ?? null,
      render: (r) => {
        if (!r.il) return dash;
        const options = sectionsByLocation[r.location.id] ?? [];
        // A shop with no shelves yet has nothing to offer, and an empty picker
        // panel is worse than a sentence.
        if (options.length === 0) {
          return <span className="text-faint">no sections at {r.location.code}</span>;
        }
        return (
          <InlineValue
            readOnly={!editable}
            table="inventory_item_locations"
            id={r.il.id}
            column="shop_section_id"
            kind="pick"
            value={r.il.shop_section_id}
            // "No section" is a real choice with an empty value, not the
            // absence of one — without it in the list there'd be no way to take
            // an item OFF a shelf, and it's the label the guide uses for the
            // items that land nowhere.
            options={[{ value: "", label: "No section" }, ...options]}
            placeholder="No section"
          />
        );
      },
    },
    {
      key: "order_days",
      label: "Order days",
      // Above WEEKDAY_PICKER_WIDTH on purpose: widths are weights, and this
      // is what keeps the RESOLVED width at or over 300 beside the par strip.
      width: Math.max(WEEKDAY_PICKER_WIDTH, 330),
      // Sorts on how MANY days it's ordered — "which items do we buy most
      // often here" is the question worth asking of this column.
      sortValue: (r) => (r.il ? r.il.order_days.length : null),
      render: (r) =>
        r.il ? (
          <WeekdayPicker
            readOnly={!editable}
            table="inventory_item_locations"
            id={r.il.id}
            column="order_days"
            value={r.il.order_days}
            label="Order days"
          />
        ) : (
          dash
        ),
    },
    {
      key: "par",
      label: `Default par (${baseUnit})`,
      width: 90,
      align: "right",
      sortValue: (r) =>
        r.il?.default_par === null || r.il?.default_par === undefined
          ? null
          : Number(r.il.default_par),
      render: (r) =>
        r.il ? (
          <InlineValue
            readOnly={!editable}
            table="inventory_item_locations"
            id={r.il.id}
            column="default_par"
            value={r.il.default_par}
            kind="number"
            align="right"
          />
        ) : (
          dash
        ),
    },
    {
      key: "weekday_par",
      // "– = default" is the one fact the strip cannot show about itself.
      label: "Weekday par (– = default)",
      // Seven pens at ≥45px each — a four-digit par ("1500", the real vegan
      // raised mix) is 37px of ink plus the cell button's 8px of padding, with
      // 24px of gaps between the pens. Measured at 217px/24px a pen first,
      // which rendered "15 14 13 12 11", then at 309/40 which clipped by 4.
      width: 370,
      render: (r) => {
        if (!r.il) return dash;
        const il = r.il;
        return (
          <span className="flex gap-x-1 tabular-nums">
            {WEEKDAYS.map((day, i) => (
              // Each slot in its own pen — an open editor is a bare flex
              // wrapper that grows to its text, and without `min-w-0 flex-1
              // overflow-hidden` it lies over the next day's box.
              <span key={day} className="flex min-w-0 flex-1 flex-col items-center overflow-hidden">
                <span className="text-[10px] uppercase tracking-[0.08em] text-subtle">{day}</span>
                <InlineValue
                  readOnly={!editable}
                  table="inventory_item_locations"
                  id={il.id}
                  column="par"
                  ariaLabel={`${day} par at ${r.location.code}`}
                  kind="number"
                  align="right"
                  value={il.par_by_weekday?.[i] ?? null}
                  placeholder="–"
                  className="w-full"
                  arrayColumn="par_by_weekday"
                  arrayIndex={i}
                  arrayStrip={il.par_by_weekday}
                  arrayWidth={7}
                />
              </span>
            ))}
          </span>
        );
      },
    },
    // "Default vendor item" and its price lived here until migration 012.
    // The guide stopped resolving lines through the default in 008 and the
    // column is gone; which vendor supplies this item at this location is the
    // favorites grid behind the row's disclosure, and the Vendor items section
    // below carries the prices.
    {
      key: "note",
      label: "Note",
      width: 110,
      hideWhenCompact: true,
      sortValue: (r) => r.il?.note ?? null,
      render: (r) =>
        r.il ? (
          <InlineValue
            readOnly={!editable}
            table="inventory_item_locations"
            id={r.il.id}
            column="note"
            value={r.il.note}
          />
        ) : (
          dash
        ),
    },
  ];

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-accent">{error}</p>}

      <DataTable
        rows={tableRows}
        columns={columns}
        rowKey={(r) => r.location.id}
        leading={leading}
        // v2 (2026-09-05): the weekday par strip joined the columns.
        storageKey="rf.itemLocations.columnWidths.v2"
        columnChooser
        // 1440: beside the record's sidebar this table has ~190px less than a
        // list, and both weekday strips must hold 300px — see the Active
        // column's note.
        compactBelow={1440}
        defaultSort={{ key: "location" }}
        rowClassName={(r) => (r.il && !r.il.is_active ? "text-faint" : "")}
        expand={{
          // Only stocked locations have plan rows to favorite.
          canExpand: (r) => r.il !== null,
          summary: (r) => (r.il ? null : "not stocked here"),
          render: (r) =>
            r.il ? (
              <FavoritesEditor
                itemLocationId={r.il.id}
                inventoryItemId={inventoryItemId}
                orgId={orgId}
                onChanged={() => router.refresh()}
              />
            ) : null,
        }}
      />
    </div>
  );
}
