"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import { SHIFT_SLOT_LABEL } from "@/lib/employeeEvents";
import { CHECKLIST_KIND_LABEL, type ChecklistKind } from "@/lib/checklists";

const WIDTHS_KEY = "rf.checklists.columnWidths.v1";

export type RunRow = {
  id: string;
  kind: ChecklistKind;
  title: string;
  business_date: string;
  shift: string | null;
  status: "open" | "submitted";
  item_count: number;
  done_count: number;
  issue_count: number;
  in_shift_report: boolean;
};

export type StartableTemplate = {
  id: string;
  name: string;
  kind: ChecklistKind;
  shifts: string[] | null;
  asked_today: boolean;
  already_run_today: boolean;
};

/**
 * The walks.
 *
 * It renders NO create command of its own (Mark, 2026-08-30): both callers —
 * `/checklists` and `/inspection-logs` — put Start a walk beside their own
 * heading, which is where this app keeps a screen's commands. Passing one in
 * would have been a slot nobody needs; the caller already owns that row.
 */
export function ChecklistsList({
  rows,
  startable,
  locationCode,
  action,
}: {
  rows: RunRow[];
  startable: StartableTemplate[];
  locationCode: string;
  /**
   * The screen's create command, right-aligned at the end of this row (Mark,
   * 2026-09-03, moving it down out of the title row). A NODE rather than a
   * flag: only the page knows which command this list is for, and what it may
   * pass it.
   */
  action?: ReactNode;
}) {
  const [tier, setTier] = useState<"open" | "all">("open");

  const shown = useMemo(
    () => (tier === "open" ? rows.filter((r) => r.status === "open") : rows),
    [rows, tier],
  );

  // What today is asked for and has NOT been walked. Stated as a sentence
  // rather than as an empty row, because "nobody has walked the closing list"
  // and "there is no closing list" are different facts and a missing row says
  // neither.
  const outstanding = startable.filter((t) => t.asked_today && !t.already_run_today);

  const columns: DataColumn<RunRow>[] = [
    {
      key: "business_date",
      label: "Date",
      width: 130,
      sortValue: (r) => r.business_date,
      render: (r) => <span className="tabular-nums">{r.business_date}</span>,
    },
    {
      key: "title",
      // NOT "Walk". That word was one this module invented and Mark took it out
      // of every visible string on 2026-08-30; this column header survived the
      // sweep. "Name" rather than "Checklist", because /inspection-logs renders
      // the same table and the Kind column beside it already says which.
      label: "Name",
      width: 320,
      pinned: true,
      sortValue: (r) => r.title,
      render: (r) => (
        <Link href={`/checklists/${r.id}`} className="font-medium hover:underline">
          {r.title}
        </Link>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => r.kind,
      render: (r) => CHECKLIST_KIND_LABEL[r.kind],
    },
    {
      key: "shift",
      label: "Shift",
      width: 120,
      sortValue: (r) => r.shift ?? "",
      render: (r) =>
        r.shift ? (SHIFT_SLOT_LABEL[r.shift as never] ?? r.shift) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "progress",
      label: "Progress",
      width: 140,
      align: "right",
      sortValue: (r) => (r.item_count ? r.done_count / r.item_count : 0),
      render: (r) => (
        <span className="tabular-nums">
          {r.done_count} of {r.item_count}
        </span>
      ),
    },
    {
      key: "issue_count",
      label: "Issues",
      width: 100,
      align: "right",
      sortValue: (r) => r.issue_count,
      // Red, because an issue IS something wrong — which is the one thing the
      // accent is reserved for. The count is silent at zero rather than
      // rendering a nought, so the eye lands only where there is something.
      render: (r) =>
        r.issue_count > 0 ? (
          <span className="bg-accent px-1 tabular-nums text-white">{r.issue_count}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (r) => r.status,
      render: (r) =>
        r.status === "open" ? (
          <Link href={`/checklists/${r.id}/run`} className="underline">
            Continue
          </Link>
        ) : (
          <span className="text-muted">Finished</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {outstanding.length > 0 && (
        <section className="border-2 border-hairline p-3">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Asked for today — not started
          </h2>
          <ul className="space-y-1 text-sm">
            {outstanding.map((t) => (
              <li key={t.id}>
                <span className="bg-mark-fill px-1">{t.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <TabPicker
          ariaLabel="Which ones"
          value={tier}
          options={[
            {
              key: "open",
              label: "Unfinished",
              count: rows.filter((r) => r.status === "open").length,
            },
            { key: "all", label: "All", count: rows.length },
          ]}
          onChange={(v) => setTier(v as typeof tier)}
        />
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        compactBelow={1280}
        storageKey={WIDTHS_KEY}
        columnChooser
        defaultSort={{ key: "business_date", dir: "desc" }}
        // Bands sort by the ISO DATE underneath, never by a friendly label —
        // the bug 044 found in `BatchLogsIndex`, where a week read Mon 8/3 →
        // Thu 8/6 → Tue 8/4 because the string sorted alphabetically.
        group={{ label: (r) => r.business_date, sortKey: "business_date" }}
        empty={
          <p className="max-w-[72ch] text-sm text-muted">
            {tier === "open"
              ? "Nothing unfinished at " + locationCode + "."
              : `Nothing recorded at ${locationCode} in this window.`}
          </p>
        }
      />
    </div>
  );
}
