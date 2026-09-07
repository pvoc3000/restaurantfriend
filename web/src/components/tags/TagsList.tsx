"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateField } from "@/components/ui/DateField";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { Checkbox } from "@/components/ui/Checkbox";
import { PageHeading } from "@/components/ui/PageHeading";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { sortRows, type SortDir } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { TAG_SIZES, formatTagPrice, type TagSize } from "@/lib/displayTags";
import { PrintTags } from "./PrintTags";

/** Plain data only — this crosses the server → client line. */
export type TagRow = {
  id: string;
  title: string;
  item_id: string | null;
  item_name: string | null;
  /** `name · size · type · cut`, for the tooltip — the name alone is ambiguous. */
  item_label: string | null;
  /** The linked item's price at the working shop; null when unlinked or unpriced. */
  price: number | null;
  images: Partial<Record<TagSize, { path: string; url: string | null }>>;
  on_plan: boolean;
  is_active: boolean;
};

type Tier = "plan" | "all";

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

const SIZE_SHORT: Record<TagSize, string> = { "2x3.5": "3.5", "2x8": "8", "2x10": "10" };

/**
 * The case signs. Opens on the tags whose donut is on THIS shop's plan — the
 * ones you would be printing tonight — with All tags and a search that
 * reaches everything (Mark, 2026-09-06: "by default, only the tags that are
 * on the current plan should be displayed, but … the ability to find and
 * select any donuts").
 *
 * The selection column is offered to EVERY role that can open the screen:
 * printing is a read act, and the sheet stamps nothing.
 */
export function TagsList({
  rows,
  locationCode,
  today,
  day,
  action,
}: {
  rows: TagRow[];
  locationCode: string;
  today: string;
  /** The day On the plan is asked about — `?date=`, default today. */
  day: string;
  action?: React.ReactNode;
}) {
  const router = useRouter();
  const from = { href: "/tags", label: "Tags" };
  const [tier, setTier] = useState<Tier>("plan");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "title", dir: "asc" });
  const href = (id: string) => withFrom(`/tags/${id}`, from);

  const term = search.trim().toLowerCase();
  // A search reaches the whole set: you typed a name, so the tier would only
  // hide the answer.
  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (term) return r.title.toLowerCase().includes(term) || (r.item_name ?? "").toLowerCase().includes(term);
        return tier === "all" || r.on_plan;
      }),
    [rows, term, tier]
  );
  const onPlanCount = useMemo(() => rows.filter((r) => r.on_plan).length, [rows]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.id));

  const columns: DataColumn<TagRow>[] = [
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
              if (allChecked) visible.forEach((r) => next.delete(r.id));
              else visible.forEach((r) => next.add(r.id));
              return next;
            })
          }
          label="Select every tag shown"
          size={18}
        />
      ),
      render: (r) => (
        <Checkbox checked={checked.has(r.id)} onChange={() => toggle(r.id)} label={`Select ${r.title}`} size={18} />
      ),
    },
    {
      key: "title",
      label: "Tag",
      pinned: true,
      width: 260,
      sortValue: (r) => r.title,
      render: (r) => (
        <Link href={href(r.id)} className={`${LINK} ${r.is_active ? "" : "text-muted"}`}>
          {r.title}
        </Link>
      ),
    },
    {
      key: "item",
      label: "Item",
      width: 260,
      sortValue: (r) => r.item_name,
      render: (r) =>
        r.item_id ? (
          <Link href={`/production-items/${r.item_id}`} className={`${LINK} text-muted`} title={r.item_label ?? undefined}>
            {r.item_name}
          </Link>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "price",
      label: "Price",
      width: 100,
      align: "right",
      sortValue: (r) => r.price,
      render: (r) =>
        r.price === null ? (
          <span className="bg-mark-fill px-1 text-[12px] text-ink">no price</span>
        ) : (
          <span className="tabular-nums">{formatTagPrice(r.price)}</span>
        ),
    },
    {
      key: "sizes",
      label: "Sizes",
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => TAG_SIZES.filter((s) => r.images[s]).length,
      render: (r) => (
        <span className="flex gap-2 tabular-nums">
          {TAG_SIZES.map((s) => (
            <span key={s} className={r.images[s] ? "text-ink" : "text-faint"} title={r.images[s] ? `${s} on file` : `no ${s} background`}>
              {SIZE_SHORT[s]}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "on_plan",
      label: "On plan",
      width: 100,
      sortValue: (r) => (r.on_plan ? 0 : 1),
      render: (r) => (r.on_plan ? <span>{locationCode}</span> : <span className="text-faint">—</span>),
    },
  ];

  const sorted = useMemo(() => sortRows(visible, columns, sort), [visible, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  usePublishRecordSet(
    "/tags",
    useMemo(() => sorted.map((r) => ({ id: r.id, href: href(r.id) })), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selected = rows.filter((r) => checked.has(r.id));

  return (
    <div className="space-y-6">
      <PageHeading title="Tags" code={locationCode} visible={visible.length} total={rows.length} noun="tags" />
      <p className="text-sm text-muted">The display signs for the case, priced for this shop.</p>

      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search tags"
          aria-label="Search tags"
          clearLabel="Clear the search"
          className="w-72"
        />
        <TabPicker<Tier>
          value={term ? "all" : tier}
          onChange={setTier}
          ariaLabel="Which tags"
          options={[
            { key: "all", label: "All tags", count: rows.length },
            { key: "plan", label: "On plan", count: onPlanCount },
          ]}
        />
        {/* The day On the plan is asked about. A real navigation (the
            /events window's rule): the server decides which plans are in
            force, so the day rides in the URL and the default writes none. */}
        {/* `boxed` in the cell dress is the h-9 border the search box and the
            tabs wear; the wrapper gives its `w-full` something to mean. */}
        {/* The day, captioned — "On plan 23 · for 09/06/2026". The count sits
            between the cell and the box, so the box needs a word of its own or
            the two numbers run together (Mark, 2026-09-06). */}
        <label className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">for</span>
          <span className="block w-44">
            <DateField
            value={day}
            onChange={(next) => router.push(next && next !== today ? `/tags?date=${next}` : "/tags")}
            ariaLabel="Which day the plan is read for"
            boxed
          />
          </span>
        </label>
        {action && <div className="ml-auto flex items-center">{action}</div>}
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rf.tags.v1"
        sort={sort}
        onSortChange={setSort}
        compactBelow={1280}
        empty={
          <p className="text-sm text-muted">
            {term
              ? "No tag matches that."
              : tier === "plan"
                ? `No tag's donut is on ${locationCode}'s plan for ${day}. All tags shows every one.`
                : "No tags yet."}
          </p>
        }
      />

      {checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-4 border border-ink bg-white px-4 py-3 text-sm">
          <span className="font-medium">
            {checked.size} {checked.size === 1 ? "tag" : "tags"} selected
          </span>
          {TAG_SIZES.map((s) => (
            <PrintTags key={s} size={s} tags={selected} locationCode={locationCode} today={today} />
          ))}
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="ml-auto text-muted underline underline-offset-[3px] hover:text-ink"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
