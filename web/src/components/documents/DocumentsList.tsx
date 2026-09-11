"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { PageHeading } from "@/components/ui/PageHeading";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { ControlField } from "@/components/ui/ControlField";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { Checkbox } from "@/components/ui/Checkbox";
import { RowMenu } from "@/components/ui/RowMenu";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { usePublishRecordSet } from "@/lib/recordSet";
import { sortRows, type SortDir } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { openWindowNow } from "@/lib/poProcessing";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { DOCUMENT_BUCKET } from "@/lib/orgDocuments";
import { NewDocument } from "./NewDocument";
import { deleteDocuments, duplicateDocument } from "./documentWrites";

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
 * look for a form: "the office forms", "the signs".
 *
 * THE COMMANDS (Mark, 2026-09-11): a checkbox column at the left, a ⋯ at the
 * right (Open · Duplicate · Delete), and one Actions menu in the title row
 * (New Document… · Open Selected · Duplicate Selected · Delete Selected).
 * The row menu and the Actions menu run the SAME three functions, taking the
 * rows as a parameter, so the confirm and the row-count checks cannot drift
 * between doors (`deleteOrders`' rule). Duplicate is supervisor+ and Delete is
 * owner/admin, which is 094 — a role is not offered a row the database refuses.
 */
export function DocumentsList({
  rows,
  orgId,
  today,
  categories,
  locations,
  editable,
  canDelete,
}: {
  rows: DocumentRow[];
  orgId: string;
  today: string;
  categories: string[];
  locations: { id: string; code: string }[];
  /** Supervisor+ (the Page Permissions row): New and Duplicate. */
  editable: boolean;
  /** Owner/admin (094): Delete. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const from = { href: "/documents", label: "Documents" };
  const [q, setQ] = useState("");
  // "all", NO_CATEGORY, or a category name (Mark, 2026-09-10).
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "category", dir: "asc" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const href = (id: string) => withFrom(`/documents/${id}`, from);

  /**
   * Open the files themselves in browser tabs, where printing and downloading
   * already are (Mark, 2026-09-11: "skip the middleman and just open the pdf in
   * a new tab so it can be printed and downloaded. I don't see the point of
   * opening it in a separate panel first"). This replaces a preview panel whose
   * whole job was to put a viewer, a Print and a Download in front of the same
   * file the browser shows for nothing.
   *
   * THE TABS ARE OPENED BEFORE ANYTHING IS AWAITED, and the signed URLs are
   * written into them once they arrive — a window opened after an await is
   * silently blocked (`openWindowNow`'s rule, which every PDF in this app
   * already follows). The row carries its own file count, so the right number
   * of tabs is known without asking the database first.
   */
  function openFiles(targets: DocumentRow[]) {
    const withFiles = targets.filter((t) => t.file_count > 0);
    if (withFiles.length === 0) return;
    const wanted = withFiles.reduce((n, t) => n + t.file_count, 0);
    const windows = Array.from({ length: wanted }, () => openWindowNow());
    const blocked = windows.filter((w) => !w).length;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("org_document_files")
        .select("document_id, storage_path")
        .in(
          "document_id",
          withFiles.map((t) => t.id)
        )
        .order("created_at");
      if (error) {
        windows.forEach((w) => w?.close());
        setFailed(error.message);
        return;
      }
      // In the order they were asked for: each document's files, oldest first.
      const byDocument = new Map<string, string[]>();
      for (const f of data ?? []) {
        const list = byDocument.get(f.document_id as string) ?? [];
        list.push(f.storage_path as string);
        byDocument.set(f.document_id as string, list);
      }
      const paths = withFiles.flatMap((t) => byDocument.get(t.id) ?? []);
      const { data: urls } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
      const signed = new Map<string, string>();
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);

      let used = 0;
      for (const path of paths) {
        const url = signed.get(path);
        const win = windows[used++];
        if (win && url) win.location.href = url;
        else win?.close();
      }
      // A tab per file the row CLAIMED; close any the record turned out not to
      // have, rather than leaving somebody a blank tab to wonder about.
      windows.slice(used).forEach((w) => w?.close());

      if (blocked > 0) {
        setFailed(
          blocked === wanted
            ? `The browser blocked the new tab${wanted === 1 ? "" : "s"}. Allow pop-ups for this site, then try again.`
            : `${blocked} of ${wanted} tabs were blocked. Allow pop-ups for this site to open them all.`
        );
      } else if (signed.size < paths.length || paths.length === 0) {
        setFailed("Some files could not be opened. Reload the page and try again.");
      }
    });
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(targets: DocumentRow[]) {
    if (targets.length === 0) return;
    const one = targets.length === 1 ? targets[0] : null;
    const files = targets.reduce((n, t) => n + t.file_count, 0);
    const fileLine =
      files === 0
        ? ""
        : one
          ? `Its ${files === 1 ? "file goes" : `${files} files go`} with it. `
          : `${files} file${files === 1 ? " goes" : "s go"} with them. `;
    const ok = await confirmDialog({
      title: one ? `Delete “${one.title}”?` : `Delete ${targets.length} documents?`,
      body: `${fileLine}This cannot be undone.`,
      tone: "danger",
      confirmLabel: one ? "Delete it" : "Delete them",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const result = await deleteDocuments(
        supabase,
        targets.map((t) => t.id)
      );
      if (result.error) setFailed(result.error);
      setChecked((prev) => {
        const next = new Set(prev);
        targets.forEach((t) => next.delete(t.id));
        return next;
      });
      router.refresh();
    });
  }

  // One document lands on its copy, as a tag's Duplicate does; several stay on
  // the list, where the copies appear beside their originals.
  function duplicate(targets: DocumentRow[]) {
    if (targets.length === 0) return;
    setFailed(null);
    startTransition(async () => {
      const created: string[] = [];
      const problems: string[] = [];
      for (const t of targets) {
        const result = await duplicateDocument(supabase, orgId, t.id, today);
        if (result.error || !result.id) {
          problems.push(`${t.title}: ${result.error ?? "the copy was not created."}`);
          continue;
        }
        created.push(result.id);
        if (result.warning) problems.push(`${t.title}: ${result.warning}`);
      }
      if (targets.length === 1 && created.length === 1 && problems.length === 0) {
        router.push(withFrom(`/documents/${created[0]}`, from));
        return;
      }
      if (problems.length > 0) setFailed(problems.join(" "));
      setChecked(new Set());
      router.refresh();
    });
  }

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

  const allChecked = filtered.length > 0 && filtered.every((r) => checked.has(r.id));

  const columns: DataColumn<DocumentRow>[] = [
    {
      key: "select",
      label: "",
      width: 56,
      pinned: true,
      header: (
        <Checkbox
          checked={allChecked}
          onChange={() =>
            setChecked((prev) => {
              const next = new Set(prev);
              if (allChecked) filtered.forEach((r) => next.delete(r.id));
              else filtered.forEach((r) => next.add(r.id));
              return next;
            })
          }
          label="Select every document shown"
        />
      ),
      render: (r) => (
        <Checkbox checked={checked.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.title}`} />
      ),
    },
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
    // The row's own commands — unlabelled, so the Columns menu never offers it.
    {
      key: "menu",
      label: "",
      width: 68,
      align: "right",
      render: (r) => (
        <RowMenu
          label={`Actions for ${r.title}`}
          items={[
            { label: "Open", disabled: r.file_count === 0 || busy, onSelect: () => openFiles([r]) },
            ...(editable ? [{ label: "Duplicate", disabled: busy, onSelect: () => duplicate([r]) }] : []),
            ...(canDelete
              ? [{ label: "Delete", danger: true, disabled: busy, onSelect: () => void remove([r]) }]
              : []),
          ]}
        />
      ),
    },
  ];

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  usePublishRecordSet(
    "/documents",
    useMemo(() => sorted.map((r) => ({ id: r.id, href: href(r.id) })), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selected = rows.filter((r) => checked.has(r.id));
  const none = selected.length === 0;
  const commands = (openNew?: () => void): ActionMenuItem[] => [
    ...(openNew ? [{ label: "New Document…", onSelect: openNew }] : []),
    {
      label: "Open Selected",
      separatorBefore: true,
      disabled: busy || !selected.some((r) => r.file_count > 0),
      onSelect: () => openFiles(selected),
    },
    ...(editable
      ? [{ label: "Duplicate Selected", disabled: none || busy, onSelect: () => duplicate(selected) }]
      : []),
    ...(canDelete
      ? [
          {
            label: "Delete Selected",
            danger: true,
            separatorBefore: true,
            disabled: none || busy,
            onSelect: () => void remove(selected),
          },
        ]
      : []),
  ];
  const actions = editable ? (
    <NewDocument orgId={orgId} today={today} categories={categories} locations={locations}>
      {(openNew) => <ActionMenu ariaLabel="Document actions" items={commands(openNew)} />}
    </NewDocument>
  ) : (
    <ActionMenu ariaLabel="Document actions" items={commands()} />
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Documents"
        total={rows.length}
        visible={sorted.length}
        noun="documents"
        action={actions}
      />
      <p className="text-sm text-muted">The forms, checklists, signs and manuals the shops print.</p>
      <div className="flex flex-wrap items-end gap-3">
        <TextInput
          value={q}
          onValueChange={setQ}
          aria-label="Search documents"
          search
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
      {failed && <p className="text-sm text-accent">{failed}</p>}
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
