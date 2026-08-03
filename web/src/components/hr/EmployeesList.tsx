"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickList } from "@/components/ui/PickList";
import {
  employeeDetailHref,
  employeeName,
  foodHandlerState,
  SCHEDULE_LABEL,
  STATUS_LABEL,
  type EmployeeSchedule,
  type EmployeeStatus,
} from "@/lib/employees";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { usePublishRecordSet } from "@/lib/recordSet";
import { makeComparator, type SortDir, type SortValue } from "@/lib/tableSort";
import { NewEmployee } from "./NewEmployee";

const WIDTHS_STORAGE_KEY = "rf.employees.columnWidths.v1";

export type EmployeeRow = {
  id: string;
  status: EmployeeStatus;
  last_name: string;
  first_name: string;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  schedule: EmployeeSchedule | null;
  start_date: string | null;
  food_handler_expires: string | null;
  /** Resolved by the page from `session.locations` — the FULL list, so a
   *  closed shop shows its code rather than an em dash. */
  location_code: string | null;
  /** The role of this person's app access, or null if they have none. */
  role: Role | null;
};

type StatusFilter = EmployeeStatus | "all";

type SortKey =
  | "name"
  | "status"
  | "location"
  | "position"
  | "schedule"
  | "phone"
  | "start"
  | "fhc"
  | "access";

/**
 * The roster.
 *
 * Defaults to Active, which is 26 rows of 445 — the other 417 are people who
 * left over thirteen years, and they are here because they're the referent of
 * every rating, timesheet and order they ever touched, not because you want to
 * scroll past them. "All" is one tap away.
 *
 * Sorting is CONTROLLED from local state, like the Locations list, because the
 * found set published for the record book has to be in the order that's on
 * screen. Local state and not the URL: no filter here is worth sharing.
 */
export function EmployeesList({
  rows,
  locationCodes,
  locationOptions,
  positions,
  today,
  orgId,
}: {
  rows: EmployeeRow[];
  /** Every location code in the org, for the filter. */
  locationCodes: string[];
  /**
   * Where someone can be HIRED to — active locations only (design rule 3).
   * Deliberately not the same set as `locationCodes`, which comes from the full
   * list so a row whose shop has closed still shows DF03 rather than an em dash.
   * You filter by a closed shop; you don't hire into one.
   */
  locationOptions: { id: string; code: string; name: string }[];
  /** Every position already in use — the vocabulary, derived from the data. */
  positions: string[];
  /** The org's today, from the server (orgs.settings.timezone). */
  today: string;
  orgId: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [location, setLocation] = useState("");
  const [position, setPosition] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "name",
    dir: "asc",
  });

  function sortValue(row: EmployeeRow, key: SortKey): SortValue {
    switch (key) {
      case "name":
        return employeeName(row);
      case "status":
        return row.status;
      case "location":
        return row.location_code;
      case "position":
        return row.position;
      case "schedule":
        return row.schedule;
      case "phone":
        return row.phone;
      case "start":
        return row.start_date;
      case "fhc":
        return row.food_handler_expires;
      case "access":
        // No access sinks below every role rather than sorting as an empty
        // string, so "who can sign in" is one click on this column.
        return row.role ? `0${row.role}` : null;
    }
  }

  /**
   * The four columns that band their runs when you sort by them (Mark,
   * 2026-08-02, from FileMaker's employee list, which broke on location).
   *
   * Only these four: a band earns its place when the column has FEW values and
   * many rows per value, so the run it opens is worth naming. Sorting by name,
   * phone or a date would put a heading above nearly every row, which is why
   * Vendors and Inventory band on the same condition.
   */
  const GROUP_LABEL: Partial<Record<SortKey, (row: EmployeeRow) => string>> = {
    location: (r) => r.location_code ?? "No location",
    status: (r) => STATUS_LABEL[r.status],
    position: (r) => r.position ?? "No position",
    schedule: (r) => (r.schedule ? SCHEDULE_LABEL[r.schedule] : "No schedule"),
  };
  const groupLabel = GROUP_LABEL[sort.key];

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      active: 0,
      new_hire: 0,
      inactive: 0,
      all: rows.length,
    };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (location && r.location_code !== location) return false;
      if (position && r.position !== position) return false;
      if (!q) return true;
      return `${r.first_name} ${r.last_name} ${r.nickname ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, status, location, position]);

  const sorted = useMemo(
    () =>
      [...shown].sort(
        makeComparator<EmployeeRow>({
          value: (r) => sortValue(r, sort.key),
          dir: sort.dir,
          tiebreaks: [(r) => employeeName(r)],
        })
      ),
    [shown, sort.key, sort.dir]
  );

  usePublishRecordSet(
    "/employees",
    useMemo(
      () => sorted.map((e) => ({ id: e.id, href: employeeDetailHref(e.id) })),
      [sorted]
    )
  );

  const LINK =
    "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

  const columns: DataColumn<EmployeeRow>[] = [
    {
      key: "name",
      label: "Name",
      width: 255,
      pinned: true,
      wrap: true,
      sortValue: (r) => sortValue(r, "name"),
      render: (r) => (
        <span>
          <Link href={employeeDetailHref(r.id)} className={LINK}>
            {employeeName(r)}
          </Link>
          {r.nickname && (
            <span className="text-muted"> &ldquo;{r.nickname}&rdquo;</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 110,
      sortValue: (r) => sortValue(r, "status"),
      // Colour means record STATE, which this is: an inactive person is a
      // closed record, the same mark a deactivated catalog row carries.
      render: (r) => (
        <span className={r.status === "inactive" ? "text-muted" : ""}>
          {STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      key: "location",
      label: "Location",
      width: 125,
      sortValue: (r) => sortValue(r, "location"),
      render: (r) => <span className="text-muted">{r.location_code ?? "—"}</span>,
    },
    {
      key: "position",
      label: "Position",
      width: 150,
      sortValue: (r) => sortValue(r, "position"),
      render: (r) => r.position ?? <span className="text-subtle">—</span>,
    },
    {
      key: "schedule",
      label: "Schedule",
      width: 125,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "schedule"),
      render: (r) => (
        <span className="text-muted">
          {r.schedule ? SCHEDULE_LABEL[r.schedule] : "—"}
        </span>
      ),
    },
    {
      key: "phone",
      label: "Phone",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "phone"),
      render: (r) => <span className="text-muted">{r.phone ?? "—"}</span>,
    },
    {
      key: "start",
      label: "Started",
      width: 115,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "start"),
      render: (r) => <span className="text-muted">{r.start_date ?? "—"}</span>,
    },
    {
      key: "fhc",
      label: "Food card",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "fhc"),
      render: (r) => {
        // Only for people who still work here — a lapsed card on someone who
        // left in 2016 is not a finding, it's noise.
        const state =
          r.status === "inactive"
            ? "ok"
            : foodHandlerState(r.food_handler_expires, today);
        if (!r.food_handler_expires) return <span className="text-subtle">—</span>;
        return (
          <span className={state === "expired" ? "text-accent" : "text-muted"}>
            {r.food_handler_expires}
          </span>
        );
      },
    },
    {
      key: "access",
      label: "Access",
      width: 110,
      sortValue: (r) => sortValue(r, "access"),
      render: (r) =>
        r.role ? (
          ROLE_LABEL[r.role]
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
  ];

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "new_hire", label: "New hires", count: counts.new_hire },
    { key: "inactive", label: "Former", count: counts.inactive },
    { key: "all", label: "All", count: counts.all },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search people"
            aria-label="Search people"
            clearLabel="Clear the search"
            className="h-9 w-72 text-sm"
          />
          <PickList
            value={location}
            onPick={setLocation}
            variant="field"
            placeholder="All locations"
            ariaLabel="Filter by location"
            options={[
              { value: "", label: "All locations" },
              ...locationCodes.map((c) => ({ value: c, label: c })),
            ]}
            className="w-44"
          />
          <PickList
            value={position}
            onPick={setPosition}
            variant="field"
            placeholder="All positions"
            ariaLabel="Filter by position"
            options={[
              { value: "", label: "All positions" },
              ...positions.map((p) => ({ value: p, label: p })),
            ]}
            className="w-56"
          />
          <span className="text-sm text-muted">
            {shown.length === rows.length
              ? `${rows.length} ${rows.length === 1 ? "person" : "people"}`
              : `${shown.length} of ${rows.length}`}
          </span>

          {/* Right-aligned against the filters (Mark's placement), and
              `shrink-0` so it never squeezes: when the row wraps it goes with
              the last line rather than being crushed between two pickers.
              `roster` is the FULL set, not `shown` — the rehire check has to see
              the 417 former employees a filter is hiding. */}
          <NewEmployee
            orgId={orgId}
            roster={rows}
            locationOptions={locationOptions}
            positions={positions}
            today={today}
          />
        </div>

        <TabPicker
          options={statusTabs}
          value={status}
          onChange={setStatus}
          ariaLabel="Filter by status"
        />
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        // 1400, not the app's usual 1280. Nine columns is more than any other
        // list carries, and measured at 1280 six of the nine LABELS truncated
        // ("STAT…", "FOOD C…") — the columns fit, since they're fluid, but you
        // can't read what they are. Below 1400 the compact set leaves five
        // roomy ones; at 1440 and up all nine fit with their labels intact.
        // Either way the Columns menu overrides it, per column.
        compactBelow={1400}
        sort={sort}
        onSortChange={(next) => setSort({ key: next.key as SortKey, dir: next.dir })}
        // Bands only when the sort IS a groupable column — see GROUP_LABEL. The
        // rows are already contiguous by that label, since it's the primary
        // sort and `sorted` tie-breaks on name inside it.
        group={groupLabel ? { label: groupLabel } : undefined}
        empty={<p className="text-sm text-muted">No one matches those filters.</p>}
      />
    </div>
  );
}
