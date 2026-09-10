"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { PageHeading } from "@/components/ui/PageHeading";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { ControlField } from "@/components/ui/ControlField";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
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

/** The Category picklist's value for a document filed under no category. */
const NO_CATEGORY = "__none__";

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
  // "all", NO_CATEGORY, or a category name (Mark, 2026-09-10).
  const [category, setCategory] = useState<string>("all");
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
  const searched = useMemo(
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

  // THE CATEGORY PICKLIST (Mark, 2026-09-10: "filter document types"). Its
  // options are every category the org has, so a chosen one never vanishes
  // from the list; its COUNTS follow the search and never the picker itself
  // (lib/filterMenus' rule).
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of searched) {
      const key = r.category ?? NO_CATEGORY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const names = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort(
      (a, b) => a.localeCompare(b)
    );
    return [
      { value: "all", label: "All categories", hint: String(searched.length) },
      ...names.map((c) => ({ value: c, label: c, hint: String(counts.get(c) ?? 0) })),
      ...(rows.some((r) => !r.category)
        ? [{ value: NO_CATEGORY, label: "No category", hint: String(counts.get(NO_CATEGORY) ?? 0) }]
        : []),
    ];
  }, [rows, searched]);

  const filtered = useMemo(
    () =>
      category === "all"
        ? searched
        : searched.filter((r) => (r.category ?? NO_CATEGORY) === category),
    [searched, category]
  );
  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  usePublishRecordSet(
    "/documents",
    useMemo(() => sorted.map((r) => ({ id: r.id, href: href(r.id) })), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Documents"
        total={rows.length}
        visible={sorted.length}
        noun="documents"
        action={action}
      />
      <p className="text-sm text-muted">The forms, checklists, signs and manuals the shops print.</p>
      <div className="flex flex-wrap items-end gap-3">
        <TextInput
          value={q}
          onValueChange={setQ}
          aria-label="Search documents"
          className="w-72"
          icon={<SearchGlyph />}
        />
        <ControlField label="Category">
          <PickList
            ariaLabel="Which category of documents to show"
            variant="field"
            value={category}
            onPick={setCategory}
            options={categoryOptions}
            fit
          />
        </ControlField>
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
