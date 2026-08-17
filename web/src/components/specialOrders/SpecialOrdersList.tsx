"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { NewSpecialOrder } from "@/components/specialOrders/NewSpecialOrder";
import { usePublishRecordSet } from "@/lib/recordSet";
import { withFrom } from "@/lib/breadcrumbs";
import {
  applyListFilters,
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
import { sortRows } from "@/lib/tableSort";
import {
  KIND_LABEL,
  STAGES,
  STATUS_LABEL,
  customerLabel,
  money,
  needsAttention,
  stageState,
  suggestedTodo,
  type AttentionThresholds,
  type OrderTotals,
  type SpecialOrderKind,
  type SpecialOrderStatus,
  type StageState,
} from "@/lib/specialOrders";

export type SpecialOrderRow = {
  id: string;
  number: string;
  kind: SpecialOrderKind;
  status: SpecialOrderStatus | null;
  todo: string | null;
  flag_reason: string | null;
  title: string | null;
  event_date: string | null;
  event_time: string | null;
  fulfillment: string | null;
  location_code: string | null;
  kitchen_code: string | null;
  customer: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
  standing_days: number[] | null;
  /** Derived on the server from the lines and the payments — never a column. */
  totals: OrderTotals;
  /** Every stage date, so the grid and `needsAttention` read the same row. */
  quote_sent_at: string | null;
  quote_returned_at: string | null;
  invoice_sent_at: string | null;
  invoice_paid_at: string | null;
  receipt_sent_at: string | null;
  delivery_scheduled_at: string | null;
  order_printed_at: string | null;
  order_scheduled_at: string | null;
  tax_rate: number | null;
  discount_amount: number | null;
  discount_rate: number | null;
  delivery_charge: number | null;
  rush_fee: number | null;
  ignore_balance: boolean;
};

const PATH = "/special-orders";
const NONE = "none";

const SORT_KEYS = [
  "todo", "kitchen", "number", "status", "date", "customer", "title", "total",
  ...STAGES.map((s) => s.key),
] as const;

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "SUN, AUG 16" — the band over each day's run, FileMaker's own heading. */
function dayBand(date: string | null): string {
  if (!date) return "No date";
  const d = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
    .format(d)
    .toUpperCase();
}

/** "10:30 AM" from a Postgres `time`. */
function clock(value: string | null): string {
  if (!value) return "—";
  const [h, m] = value.split(":");
  const hour = Number(h);
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${m} ${suffix}`;
}

/**
 * THE WORK QUEUE, grouped by event date — FileMaker's own arrangement, and the
 * thing the brief says it got right: day bands, one row per order, and a grid
 * of stage dates down the right where AN EMPTY CELL IS THE TO-DO LIST.
 *
 * ORG-WIDE, not location-scoped (decision 8). Kitchen and pickup shop are two
 * of the filter menus rather than a scope around the screen, because an order
 * is routinely made at one shop for pickup at another and the phone rings
 * wherever it rings.
 *
 * The colours are this app's, not FileMaker's. FMP marked "waiting on the
 * customer" GREEN; here green means GO (the order guide's should-order), so
 * waiting is YELLOW — the app's "worth your eye" mark — and red stays what it
 * is everywhere else, something wrong. See `stageState`.
 */
export function SpecialOrdersList({
  rows,
  today,
  thresholds,
  canWrite,
  kitchens,
  initialFilters,
  initialSearch = "",
  capped = false,
}: {
  rows: SpecialOrderRow[];
  today: string;
  thresholds: AttentionThresholds;
  canWrite: boolean;
  kitchens: { id: string; code: string }[];
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  capped?: boolean;
}) {
  /**
   * The reason each row wants a human, computed once and reused three times —
   * the `attention` filter, the count in its menu, and the sentence in the
   * row. Deriving it per render in three places would let the queue and its
   * own count disagree.
   */
  const attention = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const why = needsAttention(r as never, today, r.totals, thresholds);
      if (why) m.set(r.id, why);
    }
    return m;
  }, [rows, today, thresholds]);

  const dimensions = useMemo<FilterDimension<SpecialOrderRow>[]>(() => {
    const codes = (read: (r: SpecialOrderRow) => string | null) => {
      const found = [...new Set(rows.map(read).filter(Boolean) as string[])].sort();
      return [...found.map((v) => ({ value: v, label: v })), { value: NONE, label: "Not set" }];
    };
    const todos = [...new Set(rows.map((r) => r.todo).filter(Boolean) as string[])].sort();

    return [
      {
        /**
         * The one dimension that isn't a column — it is WHICH ORDERS, and it
         * carries decision 19's tier. `attention` is a menu option rather than
         * a control of its own because it answers the same question the other
         * five options do, and a separate chip beside a menu that already says
         * "Upcoming" is two controls arguing about scope.
         */
        key: "view",
        label: "Show",
        allLabel: "All orders",
        options: [
          { value: "attention", label: "Needs attention" },
          { value: "upcoming", label: "Upcoming" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "unpaid", label: "Unpaid" },
          { value: "past", label: "Past" },
        ],
        // Upcoming: the working view, and the list's resting state.
        defaultValue: "upcoming",
        matches: (r, v) => {
          if (v === "attention") return attention.has(r.id);
          // Templates and standing orders have no event date, so every
          // date-based view would hide them. They are reached through the KIND
          // menu, which is FileMaker's saved finds, and `all` shows them.
          if (v === "upcoming")
            return r.kind === "order" && r.status !== "cancelled" && !!r.event_date && r.event_date >= today;
          if (v === "tomorrow") {
            const d = new Date(`${today}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            return r.event_date === d.toISOString().slice(0, 10);
          }
          if (v === "unpaid")
            return (
              r.kind === "order" &&
              r.status !== "cancelled" &&
              !r.ignore_balance &&
              r.totals.balance > 0 &&
              r.totals.total > 0
            );
          if (v === "past") return !!r.event_date && r.event_date < today;
          return true;
        },
      },
      {
        key: "kind",
        label: "Kind",
        options: (["order", "standing_order", "template"] as SpecialOrderKind[]).map((k) => ({
          value: k,
          label: KIND_LABEL[k],
        })),
        matches: (r, v) => r.kind === v,
      },
      {
        key: "status",
        label: "Status",
        options: (["lead", "quote", "invoice", "order", "cancelled"] as SpecialOrderStatus[]).map(
          (s) => ({ value: s, label: STATUS_LABEL[s] })
        ),
        matches: (r, v) => r.status === v,
      },
      {
        key: "kitchen",
        label: "Kitchen",
        options: codes((r) => r.kitchen_code),
        matches: (r, v) => (v === NONE ? !r.kitchen_code : r.kitchen_code === v),
      },
      {
        key: "pickup",
        label: "Pickup",
        options: codes((r) => r.location_code),
        matches: (r, v) => (v === NONE ? !r.location_code : r.location_code === v),
      },
      {
        key: "todo",
        label: "To-do",
        options: [
          ...todos.map((t) => ({ value: t, label: t })),
          { value: NONE, label: "Nothing set" },
        ],
        matches: (r, v) => (v === NONE ? !r.todo : r.todo === v),
      },
    ];
  }, [rows, today, attention]);

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

  function writeUrl(f: FilterValues, q: string, s: ListSort | null) {
    window.history.replaceState(null, "", filterHref(PATH, dimensions, f, q, s));
  }
  const changeFilters = (next: FilterValues) => { setFilters(next); writeUrl(next, search, sort); };
  const changeSearch = (next: string) => { setSearch(next); writeUrl(filters, next, sort); };
  const changeSort = (next: ListSort) => { setSort(next); writeUrl(filters, search, next); };

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.title, customerLabel(r.customer), r.customer?.company, r.todo]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  const listHref = filterHref(PATH, dimensions, filters, search, sort);
  const detailHref = (id: string) =>
    withFrom(`/special-orders/${id}`, { href: listHref, label: "Special Orders" });

  /** One stage cell. Done prints the date; the rest are a state, not a word. */
  function stageCell(row: SpecialOrderRow, key: string) {
    const stage = STAGES.find((s) => s.key === key)!;
    const value = row[stage.field as keyof SpecialOrderRow] as string | null;
    const state: StageState = stageState(row as never, stage, today, thresholds);
    if (state === "done" && value) {
      return <span className="tabular-nums text-[12px] text-muted">{value.slice(5)}</span>;
    }
    if (state === "overdue") {
      return <span className="text-accent" title="Overdue">●</span>;
    }
    if (state === "waiting") {
      return <span className="text-mark" title="Waiting on the customer">●</span>;
    }
    return <span className="text-faint">—</span>;
  }

  const columns: DataColumn<SpecialOrderRow>[] = [
    {
      key: "todo",
      label: "To-do",
      width: 150,
      wrap: true,
      sortValue: (r) => r.todo ?? "",
      sortTiebreaks: [(r) => r.number],
      /**
       * Decision 4: the MANUAL to-do always overrides the derived hint on
       * display. Below it, the reason this row is in the attention queue — in
       * words, never a bare mark, because "12 orders need attention" with no
       * reasons is a number you cannot act on.
       */
      render: (r) => {
        const why = attention.get(r.id);
        const hint = r.todo ? null : suggestedTodo(r as never);
        return (
          <span className="block">
            {r.todo ? (
              <span className="font-medium">{r.todo}</span>
            ) : hint ? (
              <span className="text-subtle italic" title="Suggested — nothing is written until you set it">
                {hint}?
              </span>
            ) : (
              <span className="text-faint">—</span>
            )}
            {why ? (
              <span className={`block text-[12px] ${r.flag_reason ? "text-accent" : "text-mark"}`}>
                {why}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "kitchen",
      label: "Kitchen",
      width: 80,
      sortValue: (r) => r.kitchen_code ?? "",
      sortTiebreaks: [(r) => r.number],
      render: (r) => <span className="text-muted">{r.kitchen_code ?? "—"}</span>,
    },
    {
      key: "number",
      label: "Number",
      width: 100,
      pinned: true,
      sortValue: (r) => r.number,
      render: (r) => (
        <Link href={detailHref(r.id)} className="font-medium tabular-nums hover:underline">
          {r.number}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 100,
      sortValue: (r) => r.status ?? r.kind,
      sortTiebreaks: [(r) => r.number],
      render: (r) =>
        r.kind === "order" ? (
          <span className="text-muted">{r.status ? STATUS_LABEL[r.status] : "—"}</span>
        ) : (
          <span className="text-muted">{KIND_LABEL[r.kind]}</span>
        ),
    },
    {
      key: "date",
      label: "Event",
      width: 150,
      sortValue: (r) => r.event_date ?? "",
      sortTiebreaks: [(r) => r.event_time ?? "", (r) => r.number],
      /**
       * A STANDING ORDER SHOWS ITS WEEKDAY SET WHERE DATES WOULD BE — it has no
       * event date, and an em dash would say "nobody has filled this in" about
       * the one field that defines the record.
       */
      render: (r) =>
        r.kind === "standing_order" ? (
          <span className="text-muted">
            {(r.standing_days ?? []).map((d) => WEEKDAY_SHORT[d]).join(" ") || "No days"}
          </span>
        ) : (
          <span className="block">
            <span className="tabular-nums">{r.event_date ?? "—"}</span>
            <span className="block text-[12px] text-subtle">
              {clock(r.event_time)}
              {r.fulfillment === "delivery" ? " · delivery" : ""}
            </span>
          </span>
        ),
    },
    {
      key: "customer",
      label: "Customer",
      width: 200,
      wrap: true,
      sortValue: (r) => customerLabel(r.customer).toLowerCase(),
      sortTiebreaks: [(r) => r.number],
      render: (r) =>
        r.customer ? (
          <Link
            href={withFrom(`/customers/${r.customer.id}`, { href: listHref, label: "Special Orders" })}
            className="hover:underline"
          >
            {customerLabel(r.customer)}
          </Link>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "title",
      label: "Event",
      width: 240,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (r) => r.title ?? "",
      sortTiebreaks: [(r) => r.number],
      render: (r) => <span className="text-muted">{r.title ?? "—"}</span>,
    },
    {
      key: "total",
      label: "Total",
      width: 110,
      align: "right",
      sortValue: (r) => r.totals.total,
      sortTiebreaks: [(r) => r.number],
      /**
       * DERIVED, every time (decision 6). The balance sits under it only when
       * there is one to answer for — an unpaid figure on every settled row
       * would be eight thousand zeroes.
       */
      render: (r) => (
        <span className="block tabular-nums">
          {money(r.totals.total)}
          {r.totals.balance > 0 && !r.ignore_balance ? (
            <span className="block text-[12px] text-accent">{money(r.totals.balance)} due</span>
          ) : null}
        </span>
      ),
    },
    ...STAGES.map<DataColumn<SpecialOrderRow>>((stage) => ({
      key: stage.key,
      label: stage.label,
      width: 72,
      align: "right",
      hideWhenCompact: true,
      sortValue: (r) => (r[stage.field as keyof SpecialOrderRow] as string | null) ?? "",
      sortTiebreaks: [(r) => r.number],
      render: (r) => stageCell(r, stage.key),
    })),
  ];

  const sorted = sortRows(visible, columns, sort);

  usePublishRecordSet(PATH, sorted.map((r) => ({ id: r.id, href: detailHref(r.id) })));

  /**
   * Bands by EVENT DATE whichever way that column points — few values, many
   * rows each, which is the test a column has to pass to earn a band. Nothing
   * else here does: a number is unique per row and a customer is usually one
   * order.
   */
  const groups: DataGroup<SpecialOrderRow>[] = [
    { sortKey: "date", label: (r) => dayBand(r.event_date) },
    { sortKey: "status", label: (r) => (r.status ? STATUS_LABEL[r.status] : KIND_LABEL[r.kind]) },
    { sortKey: "kitchen", label: (r) => r.kitchen_code ?? "No kitchen" },
  ];

  return (
    <DataTable
      rows={sorted}
      sort={sort}
      onSortChange={changeSort}
      defaultSort={{ key: "date", dir: "asc" }}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="special-orders.v1"
      compactBelow={1280}
      columnChooser
      group={groups}
      // Grey and struck, so a cancelled order is legible as history rather than
      // as work. It is not hidden: FileMaker kept 705 of them and they are
      // routinely reinstated.
      rowClassName={(r) => (r.status === "cancelled" ? "text-faint line-through" : "")}
      empty={<p className="text-sm text-muted">No orders match these filters.</p>}
      leading={
        <div className="space-y-3">
          <FilterMenus
            rows={searched}
            total={rows.length}
            noun="orders"
            dimensions={dimensions}
            values={filters}
            onChange={changeFilters}
            leading={
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Search
                </span>
                <TextInput
                  value={search}
                  onValueChange={changeSearch}
                  placeholder="Number, customer, event…"
                  className="w-56"
                  aria-label="Search special orders"
                  clearLabel="Clear the search"
                />
              </div>
            }
            trailing={canWrite ? <NewSpecialOrder kitchens={kitchens} /> : undefined}
          />
          {capped ? (
            <p className="text-[13px] text-mark">
              Showing the most recent 500. Narrow the view to see further back.
            </p>
          ) : null}
        </div>
      }
    />
  );
}
