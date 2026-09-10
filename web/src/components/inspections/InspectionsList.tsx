"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { usePublishRecordSet } from "@/lib/recordSet";
import { sortRows, type SortDir } from "@/lib/tableSort";
import { PageHeading } from "@/components/ui/PageHeading";
import { withFrom } from "@/lib/breadcrumbs";
import { excerpt, scoreTone } from "@/lib/inspections";

export type InspectionRow = {
  id: string;
  inspected_on: string;
  inspection_type: string;
  inspector: string | null;
  score: string | null;
  violations: string | null;
  document_count: number;
  open_tasks: number;
};

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

/** The score as a chip: quiet for an A, the mark fill for a B, red below. */
export function ScoreChip({ score }: { score: string | null }) {
  if (!score) return <span className="text-faint">—</span>;
  const tone = scoreTone(score);
  const dress =
    tone === "alarm"
      ? "border-accent bg-[var(--rf-red-200)] text-ink"
      : tone === "warn"
        ? "border-ink bg-mark-fill text-ink"
        : "border-ink bg-white text-ink";
  return (
    <span
      className={`inline-flex h-6 items-center border px-2 text-[12px] font-semibold tabular-nums tracking-[0.06em] ${dress}`}
    >
      {score}
    </span>
  );
}

/**
 * Every inspection at this shop, newest first — a handful a year, so no date
 * window and no filters (Mark, 2026-09-05: "the result of their inspection and
 * nothing more").
 */
export function InspectionsList({
  rows,
  locationCode,
  action,
}: {
  rows: InspectionRow[];
  locationCode: string;
  action?: React.ReactNode;
}) {
  const from = { href: "/inspection-logs", label: "Inspection logs" };
  // The list OWNS its sort (CLAUDE.md: a list that publishes a found set must),
  // so the record book walks the rows in the order they are on screen.
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({
    key: "inspected_on",
    dir: "desc",
  });
  const href = (id: string) => withFrom(`/inspection-logs/${id}`, from);
  const columns: DataColumn<InspectionRow>[] = [
    {
      key: "inspected_on",
      label: "Date",
      pinned: true,
      width: 130,
      sortValue: (r) => r.inspected_on,
      render: (r) => (
        <Link href={href(r.id)} className={`${LINK} tabular-nums`}>
          {r.inspected_on}
        </Link>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 120,
      sortValue: (r) => r.inspection_type,
      render: (r) => <span className="text-body">{r.inspection_type}</span>,
    },
    {
      key: "score",
      label: "Score",
      width: 90,
      sortValue: (r) => r.score,
      render: (r) => <ScoreChip score={r.score} />,
    },
    {
      key: "inspector",
      label: "Inspector",
      width: 150,
      hideWhenCompact: true,
      sortValue: (r) => r.inspector,
      render: (r) => <span className="text-muted">{r.inspector ?? "—"}</span>,
    },
    {
      key: "violations",
      label: "Violations",
      width: 420,
      sortValue: (r) => r.violations,
      render: (r) =>
        r.violations ? (
          <span className="text-body">{excerpt(r.violations, 110)}</span>
        ) : (
          <span className="text-faint">none noted</span>
        ),
    },
    {
      key: "documents",
      label: "Report",
      width: 90,
      align: "right",
      sortValue: (r) => r.document_count,
      render: (r) =>
        r.document_count === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums text-muted">{r.document_count}</span>
        ),
    },
    {
      key: "open_tasks",
      label: "Open tasks",
      width: 110,
      align: "right",
      sortValue: (r) => r.open_tasks,
      render: (r) =>
        r.open_tasks === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="bg-mark-fill px-1 tabular-nums text-ink">{r.open_tasks}</span>
        ),
    },
  ];

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // The found set, for the record book on the inspection record (lib/recordSet).
  usePublishRecordSet(
    "/inspection-logs",
    useMemo(() => sorted.map((r) => ({ id: r.id, href: href(r.id) })), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Inspection logs"
        code={locationCode}
        total={rows.length}
        noun="inspections"
        // The create command rides in the TITLE row (Mark, 2026-09-10).
        action={action}
      />
      <p className="text-sm text-muted">Health and physical inspection reports.</p>
      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rf.inspections.v1"
        sort={sort}
        onSortChange={setSort}
        compactBelow={1280}
        empty={<p className="text-sm text-muted">No inspections recorded at {locationCode} yet.</p>}
      />
    </div>
  );
}
