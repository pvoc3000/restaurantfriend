"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { sortRows } from "@/lib/tableSort";
import { dateInTimeZone } from "@/lib/today";
import {
  applyListFilters,
  filterCounts,
  filterHref,
  parseFilterSearch,
  parseFilterValues,
  parseListSort,
  urlFilterParams,
  type FilterDimension,
  type FilterValues,
  type ListSort,
  type RawSearchParams,
} from "@/lib/filterMenus";
import {
  REQUESTS_NATURAL_SORT,
  REQUEST_PRIORITIES,
  REQUEST_PRIORITY_LABEL,
  REQUEST_STATUS_LABEL,
  priorityRank,
  type RequestPriority,
  type RequestStatus,
} from "@/lib/purchaseRequests";
import { NewPurchaseRequest } from "@/components/purchasing/NewPurchaseRequest";
import { RequestActions } from "@/components/purchasing/RequestActions";

export type PurchaseRequestRow = {
  id: string;
  request_text: string;
  /** The requester's own explanation — migration 060. Usually absent. */
  details: string | null;
  priority: RequestPriority;
  status: RequestStatus;
  requested_by: string | null;
  requesterName: string;
  inventory_item_id: string | null;
  itemName: string | null;
  resolution_note: string | null;
  created_at: string;
};

/** This list's own address. */
const PATH = "/purchase-requests";

/**
 * Every column you can sort by — `columns` below, minus the ones with no
 * `sortValue`. KEEP THE TWO IN STEP: a key missing from here sorts perfectly
 * well and is silently forgotten on the way back from a detail screen.
 */
const SORT_KEYS = [
  "priority",
  "request",
  "item",
  "requester",
  "created",
  "status",
  "note",
] as const;

/**
 * The queue: what the shop has asked for, and what happened to it.
 *
 * ONE FILTER DIMENSION, so it stays a `TabPicker` — `ui/FilterMenus` is for
 * three or more. What it borrows from `lib/filterMenus` is the URL CONTRACT,
 * not the control: the view rides in the query like every other list's, without
 * a bespoke filter module of its own. `/recipes` is the same arrangement for
 * the same reasons.
 *
 * Filing is open to everyone and resolving is not — `preq_insert` is
 * membership-only where `preq_resolve` is purchaser+ — so almost every gate in
 * here is on `canResolve` and the New request button deliberately has none.
 */
export function PurchaseRequestsList({
  rows,
  orgId,
  locationId,
  locationCode,
  userId,
  canResolve,
  timeZone,
  capped,
  initialFilters,
  initialSearch = "",
}: {
  rows: PurchaseRequestRow[];
  orgId: string;
  locationId: string;
  locationCode: string;
  userId: string;
  canResolve: boolean;
  /** The org's zone — a request filed at 5pm Pacific is not tomorrow's. */
  timeZone: string;
  /** True if the query hit its own ceiling and older rows are not shown. */
  capped: boolean;
  initialFilters?: RawSearchParams;
  initialSearch?: string;
}) {
  /**
   * `defaultValue: "open"` is what makes the URL contract work here — the queue
   * opens on the work, so `open` is the value that writes no parameter and a
   * plain `/purchase-requests` is unchanged. Which in turn is why "all" has to
   * be a REAL token rather than the bar's empty one: an empty value cannot be
   * written to a query string, so "everything" and "unstated" would be the same
   * URL and the default would win on every reload.
   */
  const dimensions = useMemo<FilterDimension<PurchaseRequestRow>[]>(
    () => [
      {
        key: "status",
        label: "Which requests",
        defaultValue: "open",
        options: [
          { value: "open", label: "Open" },
          { value: "ordered", label: "Ordered" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" },
        ],
        matches: (r, v) => (v === "all" ? true : r.status === v),
      },
    ],
    []
  );

  // Seeded from the ADDRESS BAR where it can be read, from the props otherwise
  // — a back/forward restore hands this component the props of whatever query
  // the history entry was created with, which after a replaceState is not the
  // query it now shows.
  const [search, setSearch] = useState(() => {
    const live = urlFilterParams(PATH);
    return live ? parseFilterSearch(live) : initialSearch;
  });
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, urlFilterParams(PATH) ?? initialFilters ?? {})
  );
  const [sort, setSort] = useState<ListSort | null>(() =>
    parseListSort(urlFilterParams(PATH) ?? initialFilters ?? {}, SORT_KEYS)
  );

  // `history.replaceState`, never `router.replace`: the filtering is all
  // client-side over rows the server already sent, and a replace would re-run
  // the page on every keystroke.
  function writeUrl(f: FilterValues, q: string, s: ListSort | null) {
    window.history.replaceState(null, "", filterHref(PATH, dimensions, f, q, s));
  }
  function changeStatus(next: string) {
    const nextFilters = { ...filters, status: next };
    setFilters(nextFilters);
    writeUrl(nextFilters, search, sort);
  }
  function changeSearch(next: string) {
    setSearch(next);
    writeUrl(filters, next, sort);
  }
  function changeSort(next: ListSort) {
    setSort(next);
    writeUrl(filters, search, next);
  }

  // Search first, so the tab counts describe the list you are looking at.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.request_text.toLowerCase().includes(q) ||
        (r.details ?? "").toLowerCase().includes(q) ||
        r.requesterName.toLowerCase().includes(q) ||
        (r.itemName ?? "").toLowerCase().includes(q) ||
        (r.resolution_note ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );
  const counts = filterCounts(searched, dimensions, filters).status;

  /**
   * Who may edit the words of a request: the purchaser working the queue, and
   * the person who filed it while it is still open (059's `preq_author_update`).
   * Anyone else gets plain text — an update matching no policy changes zero rows
   * and PostgREST returns NO error, so a cell that offered the edit would
   * silently eat what was typed.
   */
  const mayEdit = (r: PurchaseRequestRow) =>
    canResolve || (r.status === "open" && r.requested_by === userId);

  const columns: DataColumn<PurchaseRequestRow>[] = [
    {
      key: "priority",
      label: "Priority",
      width: 110,
      sortValue: (r) => priorityRank(r.priority),
      sortTiebreaks: [(r) => r.created_at],
      render: (r) =>
        mayEdit(r) ? (
          <InlineValue
            table="purchase_requests"
            id={r.id}
            column="priority"
            value={r.priority}
            kind="pick"
            nullable={false}
            ariaLabel={`Priority for ${r.request_text}`}
            options={REQUEST_PRIORITIES.map((p) => ({
              value: p,
              label: REQUEST_PRIORITY_LABEL[p],
            }))}
            // RED, not the mark colour (Mark, 2026-08-22). A high-priority
            // request is the same class of thing as a flagged special order —
            // not an error, a thing that cannot wait — and yellow on white is
            // about 1.5:1, which is a word you cannot read.
            className={r.priority === "high" ? "text-accent" : undefined}
          />
        ) : (
          <span
            className={`${READ_ONLY_VALUE} ${r.priority === "high" ? "text-accent" : "text-muted"}`}
          >
            {REQUEST_PRIORITY_LABEL[r.priority]}
          </span>
        ),
    },
    {
      key: "request",
      label: "Request",
      width: 330,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.request_text,
      /**
       * THE ASK AND ITS EXPLANATION SHARE ONE COLUMN — the line over the
       * paragraph, PO detail's Item cell in another costume ("two columns'
       * information in one column's width").
       *
       * Not a `DataTable` expansion, which was the first instinct and is wrong
       * here for two reasons. The chevron rides in the FIRST cell and applies
       * `truncate` to it, so putting it on this column would silently stop a
       * request wrapping — the one column that has to. And a queue you are
       * working is the wrong place to hide the reason for each row behind a
       * disclosure: you would open every one.
       */
      render: (r) => (
        <div className="min-w-0 space-y-0.5">
          {mayEdit(r) ? (
            <InlineValue
              table="purchase_requests"
              id={r.id}
              column="request_text"
              value={r.request_text}
              multiline
              nullable={false}
              ariaLabel="What was asked for"
            />
          ) : (
            <span className={READ_ONLY_VALUE}>{r.request_text}</span>
          )}
          {mayEdit(r) ? (
            // The placeholder does double duty: it says the field is empty AND
            // that you can fill it in, which is the only thing here that says
            // details exist at all.
            <InlineValue
              table="purchase_requests"
              id={r.id}
              column="details"
              value={r.details}
              multiline
              placeholder="Add details…"
              ariaLabel={`Details for ${r.request_text}`}
              className="block text-[12px] text-muted"
            />
          ) : r.details ? (
            <span className={`${READ_ONLY_VALUE} block text-[12px] text-muted`}>
              {r.details}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "item",
      label: "Item",
      width: 190,
      hideWhenCompact: true,
      sortValue: (r) => r.itemName ?? "",
      sortTiebreaks: [(r) => r.request_text],
      render: (r) =>
        r.inventory_item_id && r.itemName ? (
          <Link href={`/items/${r.inventory_item_id}`} className="text-muted hover:underline">
            {r.itemName}
          </Link>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "requester",
      label: "Asked by",
      width: 150,
      sortValue: (r) => r.requesterName,
      sortTiebreaks: [(r) => r.created_at],
      render: (r) => <span className="text-muted">{r.requesterName}</span>,
    },
    {
      key: "created",
      label: "Filed",
      width: 110,
      sortValue: (r) => r.created_at,
      render: (r) => (
        <span className="tabular-nums text-muted">
          {dateInTimeZone(r.created_at, timeZone)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 110,
      sortValue: (r) => r.status,
      sortTiebreaks: [(r) => r.created_at],
      render: (r) => (
        <span className={r.status === "open" ? "" : "text-muted"}>
          {REQUEST_STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      key: "note",
      label: "Note",
      width: 220,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (r) => r.resolution_note ?? "",
      sortTiebreaks: [(r) => r.created_at],
      render: (r) =>
        r.resolution_note ? (
          <span className="text-muted">{r.resolution_note}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "actions",
      label: "",
      width: 60,
      render: (r) => (
        <RequestActions
          id={r.id}
          status={r.status}
          itemId={r.inventory_item_id}
          itemName={r.itemName}
          userId={userId}
          canResolve={canResolve}
          isAuthor={r.requested_by === userId}
          label={`Actions for ${r.request_text}`}
        />
      ),
    },
  ];

  // The rows in the order the table shows them — `DataTable` is TOLD the sort
  // rather than finding one, so the two can never disagree. The fallback is the
  // resting queue order (highest first, oldest first within a priority) while
  // the sort STATE stays null, so the screen keeps one canonical address.
  const sorted = sortRows(visible, columns, sort ?? REQUESTS_NATURAL_SORT);

  return (
    <div className="space-y-4">
      {/* The module's model header (`PurchaseOrderList`): title, then a
          small-caps line leading with the shop. */}
      <div>
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Purchase Requests
        </h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
          {locationCode} · {visible.length} of {rows.length} requests
        </p>
      </div>

      <DataTable
      rows={sorted}
      sort={sort ?? REQUESTS_NATURAL_SORT}
      onSortChange={changeSort}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="purchase-requests.v1"
      compactBelow={1280}
      columnChooser
      empty={
        <p className="text-sm text-muted">
          {rows.length === 0
            ? `Nothing has been asked for at ${locationCode} yet.`
            : "No requests match these filters."}
        </p>
      }
      leading={
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={search}
              onValueChange={changeSearch}
              placeholder="Search requests"
              className="w-64"
              aria-label="Search purchase requests"
              clearLabel="Clear the search"
            />
            <TabPicker
              ariaLabel="Which requests"
              value={filters.status ?? "open"}
              onChange={changeStatus}
              options={dimensions[0].options.map((o) => ({
                key: o.value,
                label: o.label,
                count: counts[o.value],
              }))}
            />
            {capped ? (
              <span className="text-[12px] text-subtle">
                Showing the most recent 500.
              </span>
            ) : null}
            <div className="ml-auto">
              <NewPurchaseRequest
                orgId={orgId}
                locationId={locationId}
                userId={userId}
                locationCode={locationCode}
              />
            </div>
          </div>
        </div>
      }
    />
    </div>
  );
}
