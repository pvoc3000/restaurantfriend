"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { PageHeading } from "@/components/ui/PageHeading";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { sortRows, type SortDir } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";

export type DocumentRow = {
  id: string;
  title: string;
  version: string | null;
  category: string | null;
  location_code: string | null;
  description: string | null;
  added_on: string | null;
  file_count: number;
};

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

/**
 * Every document the organisation keeps — org-wide, not scoped to the working
 * shop (a form is not a fact about a shop; the Shop column says which ones
 * are). Grouped by CATEGORY, which is how FileMaker's list read and how you
 * look for a form: "the office forms", "the signs". A search box and nothing
 * else — "super simple" (Mark, 2026-09-05).
 */
export function DocumentsList({ rows, action }: { rows: DocumentRow[]; action?: React.ReactNode }) {
  const from = { href: "/documents", label: "Documents" };
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "category", dir: "asc" });
  const href = (id: string) => withFrom(`/documents/${id}`, from);

  const columns: DataColumn<DocumentRow>[] = [
    {
      key: "title",
      label: "Title",
      pinned: true,
      width: 260,
      sortValue: (r) => r.title,
      render: (r) => (
        <Link href={href(r.id)} className={LINK}>
          {r.title}
        </Link>
      ),
    },
    {
      key: "version",
      label: "Version",
      width: 90,
      sortValue: (r) => r.version,
      render: (r) => <span className="tabular-nums text-muted">{r.version ?? "—"}</span>,
    },
    {
      key: "category",
      label: "Category",
      width: 160,
      // Title within a category, so a band reads alphabetically.
      sortTiebreaks: [(r) => r.title],
      sortValue: (r) => r.category,
      render: (r) => <span className="text-body">{r.category ?? <span className="text-faint">—</span>}</span>,
    },
    {
      key: "location",
      label: "Shop",
      width: 80,
      sortValue: (r) => r.location_code,
      render: (r) => <span className="text-muted">{r.location_code ?? "All"}</span>,
    },
    {
      key: "description",
      label: "Description",
      width: 360,
      hideWhenCompact: true,
      sortValue: (r) => r.description,
      render: (r) => <span className="text-body">{r.description ?? ""}</span>,
    },
    {
      key: "added_on",
      label: "Added",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.added_on,
      render: (r) => <span className="tabular-nums text-muted">{r.added_on ?? "—"}</span>,
    },
    {
      key: "files",
      label: "File",
      width: 70,
      align: "right",
      sortValue: (r) => r.file_count,
      render: (r) =>
        r.file_count === 0 ? (
          // A record with nothing to print is the one worth an eye.
          <span className="bg-mark-fill px-1 text-ink">none</span>
        ) : (
          <span className="tabular-nums text-muted">{r.file_count}</span>
        ),
    },
  ];

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? rows.filter((r) =>
            [r.title, r.category, r.description, r.version, r.location_code]
              .filter(Boolean)
              .some((v) => (v as string).toLowerCase().includes(needle))
          )
        : rows,
    [rows, needle]
  );
  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  usePublishRecordSet(
    "/documents",
    useMemo(() => sorted.map((r) => ({ id: r.id, href: href(r.id) })), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-6">
      <PageHeading title="Documents" total={rows.length} visible={sorted.length} noun="documents" />
      <p className="text-sm text-muted">The forms, checklists, signs and manuals the shops print.</p>
      <div className="flex items-end gap-3">
        <TextInput
          value={q}
          onValueChange={setQ}
          placeholder="Search title, category, description"
          aria-label="Search documents"
          className="w-72"
        />
        {action}
      </div>
      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rf.documents.v1"
        sort={sort}
        onSortChange={setSort}
        compactBelow={1280}
        group={{ label: (r) => r.category ?? "No category", sortKey: "category" }}
        empty={<p className="text-sm text-muted">No documents{needle ? " match" : " yet"}.</p>}
      />
    </div>
  );
}
