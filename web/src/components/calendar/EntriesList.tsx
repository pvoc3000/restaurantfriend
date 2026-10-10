"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import {
  blackoutLabels,
  entryDates,
  entryShops,
  isBlackout,
  type CalendarEntry,
} from "@/lib/blackoutDates";
import type { EntryLocation } from "@/components/calendar/EntryDialog";

type When = "upcoming" | "past";

/**
 * Every typed entry, as a list — the month view's other face.
 *
 * The month shows 42 days; a year of holidays is twelve presses of ›. This is
 * where they are read and checked in one place. A row opens the same dialog
 * the month does, and is edited THERE rather than cell by cell: an entry's
 * dates, shops and switches are one decision ("closed the 24th to the 26th, at
 * both shops"), the dialog counts what is already on those dates before it
 * saves, and 181's policies judge the row as a whole.
 */
export function EntriesList({
  entries,
  today,
  locations,
  canWrite,
  canSetBlackouts,
  onOpen,
}: {
  entries: CalendarEntry[];
  today: string;
  locations: EntryLocation[];
  canWrite: boolean;
  canSetBlackouts: boolean;
  onOpen: (id: string) => void;
}) {
  const [when, setWhen] = useState<When>("upcoming");
  const upcoming = useMemo(() => entries.filter((e) => e.ends_on >= today), [entries, today]);
  const past = useMemo(() => entries.filter((e) => e.ends_on < today), [entries, today]);
  const rows = when === "upcoming" ? upcoming : past;

  const columns: DataColumn<CalendarEntry>[] = [
    {
      key: "dates",
      label: "Dates",
      width: 170,
      sortValue: (e) => e.starts_on,
      render: (e) => (
        <span className="tabular-nums">
          {entryDates(e)}, {e.ends_on.slice(0, 4)}
        </span>
      ),
    },
    {
      key: "title",
      label: "Title",
      width: 320,
      pinned: true,
      sortValue: (e) => e.title,
      render: (e) => (
        <button
          type="button"
          onClick={() => onOpen(e.id)}
          className="text-left font-semibold underline-offset-2 hover:underline"
        >
          {e.title}
        </button>
      ),
    },
    {
      key: "shops",
      label: "Shops",
      width: 160,
      sortValue: (e) => entryShops(e, locations),
      render: (e) => entryShops(e, locations),
    },
    {
      key: "stops",
      label: "On these dates",
      width: 380,
      sortValue: (e) => blackoutLabels(e).join(", "),
      render: (e) =>
        isBlackout(e) ? (
          blackoutLabels(e).join(" · ")
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "note",
      label: "Note",
      width: 300,
      hideWhenCompact: true,
      sortValue: (e) => e.note ?? "",
      render: (e) => <span className="text-muted">{e.note ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <TabPicker<When>
        ariaLabel="Which entries"
        value={when}
        onChange={setWhen}
        options={[
          { key: "upcoming", label: "Upcoming", count: upcoming.length },
          { key: "past", label: "Past", count: past.length },
        ]}
      />
      <DataTable
        // Keyed by the tab: a `defaultSort` is read once, and Past wants the
        // newest first where Upcoming wants the soonest.
        key={when}
        rows={rows}
        columns={columns}
        rowKey={(e) => e.id}
        storageKey="rf.calendarEntries.v1"
        defaultSort={{ key: "dates", dir: when === "upcoming" ? "asc" : "desc" }}
        columnChooser
        compactBelow={1280}
        empty={
          <p className="text-sm text-muted">
            {when === "upcoming"
              ? canWrite
                ? canSetBlackouts
                  ? "Nothing coming up. New entry adds a note, an event or a blackout."
                  : "Nothing coming up. New entry adds a note or an event."
                : "Nothing coming up."
              : "No past entries."}
          </p>
        }
      />
    </div>
  );
}
