"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TextInput } from "@/components/ui/TextInput";
import { WorkingHere } from "./WorkingHere";
import { locationDetailHref } from "@/lib/locations";
import { usePublishRecordSet } from "@/lib/recordSet";
import { makeComparator, type SortDir, type SortValue } from "@/lib/tableSort";

const WIDTHS_STORAGE_KEY = "rf.locations.columnWidths.v1";

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  kind: "physical" | "virtual";
  is_active: boolean;
  /** From `address.shipping.city` — unpacked by the page, not read here. */
  city: string | null;
};

type SortKey = "active" | "working" | "code" | "name" | "kind" | "city";

/**
 * The six locations, with the two things you come here to do: choose where
 * you're working, and open a record.
 *
 * Sorting is CONTROLLED from local state rather than left to DataTable's own,
 * because the found set published for the record book has to be in the order
 * that's on screen — the book walks what the list is showing. Local state and
 * not the URL: there are no filters here worth sharing or restoring.
 */
export function LocationsList({
  rows,
  workingLocationId,
  editable,
}: {
  rows: LocationRow[];
  workingLocationId: string | null;
  editable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "code",
    dir: "asc",
  });

  function sortValue(row: LocationRow, key: SortKey): SortValue {
    switch (key) {
      case "active":
        return row.is_active ? 0 : 1;
      case "working":
        return row.id === workingLocationId ? 0 : 1;
      case "code":
        return row.code;
      case "name":
        return row.name;
      case "kind":
        return row.kind;
      case "city":
        return row.city;
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.code} ${r.name} ${r.kind} ${r.city ?? ""}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const sorted = useMemo(
    () =>
      [...shown].sort(
        makeComparator<LocationRow>({
          value: (r) => sortValue(r, sort.key),
          dir: sort.dir,
          tiebreaks: [(r) => r.code],
        })
      ),
    // sortValue closes over workingLocationId, which the Working column sorts on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, sort.key, sort.dir, workingLocationId]
  );

  // The found set, for the record book on location detail (lib/recordSet).
  usePublishRecordSet(
    "/locations",
    useMemo(() => sorted.map((l) => ({ id: l.id, href: locationDetailHref(l.id) })), [sorted])
  );

  // Fading has to be applied CELL by cell: every cell here sets its own colour
  // (a link is text-ink, a value is text-muted), and those beat a class on the
  // row. It matters most for staff, who don't get the Active column and would
  // otherwise have nothing at all telling them why three rows offer no button.
  const link = (r: LocationRow) =>
    `underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 ${
      r.is_active ? "text-ink" : "text-faint"
    }`;
  const value = (r: LocationRow) => (r.is_active ? "text-muted" : "text-faint");

  const columns: DataColumn<LocationRow>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23).
    ...(editable
      ? [
          {
            key: "active",
            label: "Active",
            width: 95,
            sortValue: (r: LocationRow) => sortValue(r, "active"),
            render: (r: LocationRow) => (
              <ActiveToggle
                table="locations"
                id={r.id}
                active={r.is_active}
                label={`${r.code} active`}
              />
            ),
          } satisfies DataColumn<LocationRow>,
        ]
      : []),
    {
      key: "working",
      label: "Working",
      width: 170,
      // Hiding this would remove the screen's whole point.
      pinned: true,
      sortValue: (r) => sortValue(r, "working"),
      render: (r) => (
        <WorkingHere
          locationId={r.id}
          isWorking={r.id === workingLocationId}
          isActive={r.is_active}
        />
      ),
    },
    {
      key: "code",
      label: "Code",
      width: 100,
      sortValue: (r) => sortValue(r, "code"),
      render: (r) => (
        <Link href={locationDetailHref(r.id)} className={link(r)}>
          {r.code}
        </Link>
      ),
    },
    {
      key: "name",
      label: "Name",
      width: 330,
      pinned: true,
      sortValue: (r) => sortValue(r, "name"),
      render: (r) => (
        <Link href={locationDetailHref(r.id)} className={link(r)}>
          {r.name}
        </Link>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 120,
      sortValue: (r) => sortValue(r, "kind"),
      render: (r) => <span className={value(r)}>{r.kind}</span>,
    },
    {
      key: "city",
      label: "City",
      width: 180,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "city"),
      render: (r) => <span className={value(r)}>{r.city ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <TextInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search locations"
          aria-label="Search locations"
          clearLabel="Clear the search"
          className="w-72"
        />
        <span className="text-sm text-muted">
          {shown.length === rows.length
            ? `${rows.length} location${rows.length === 1 ? "" : "s"}`
            : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        // Sheds City only. Kind is short, and it's what tells EVENT apart from
        // the shops.
        compactBelow={1280}
        sort={sort}
        onSortChange={(next) => setSort({ key: next.key as SortKey, dir: next.dir })}
        // The working row is stated twice: the filled chip in its own column,
        // and weight here. Deliberately not a background wash — DataTable's
        // hover:bg-neutral-50 outranks a plain background, so the marked row
        // would get LIGHTER under the pointer than its neighbours.
        rowClassName={(r) => (r.id === workingLocationId ? "font-semibold" : "")}
        empty={<p className="text-sm text-muted">No locations match that search.</p>}
      />
    </div>
  );
}
