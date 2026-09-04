"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { NewSpecialOrder } from "@/components/specialOrders/NewSpecialOrder";
import { PageHeading } from "@/components/ui/PageHeading";
import { StickyFooter } from "@/components/ui/StickyFooter";
import {
  PROGRESS_LABELS,
  orderProgress,
  progressChecklist,
  progressRowStyle,
  type OrderProgress,
} from "@/lib/specialOrderProgress";
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
  STATUS_LABEL,
  customerLabel,
  money,
  needsAttention,
  suggestedTodo,
  type AttentionThresholds,
  type OrderTotals,
  type SpecialOrderKind,
  type SpecialOrderStatus,
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

/**
 * THE WIDTHS ARE SOLVED, NOT CHOSEN — fifteen columns is a lot for one screen
 * and the arithmetic has to be done once for all of them together.
 *
 * A `width` is a WEIGHT: the rendered pixels are `width / total × table`, so
 * widening one column narrows every other. Bumping the seven stage columns on
 * their own pushed Kitchen, Number and Status into clipping instead — the
 * problem moved rather than went away.
 *
 * What each header needs is its label plus the cell's 24px of padding, and the
 * weights below give every one of them that at a 1440 window (a 1344px table).
 * Measured after, not before: nothing clips and the page does not scroll
 * sideways. Below `compactBelow` the stage columns and Event drop out, which is
 * what makes a narrower screen fit at all.
 *
 * A trap worth naming: measure the label SPAN, not the button around it. A
 * button sizes to its own content and can never report an overflow, which is
 * how two clipped headers survived a first check that said everything was fine.
 */
/**
 * THE SEVEN STAGE COLUMNS ARE GONE (Mark, 2026-08-20: "we can remove the quote,
 * signed, billed, paid, booked, and scheduled columns now as they are
 * redundant" — and then "the print column can go too").
 *
 * The Progress strip says what all seven said, in 92px instead of 868. They
 * were three grains of one fact — how far, which, and when — and the dates were
 * the grain nobody was reading on a list: every stamp is still on the record,
 * which is where you go when you want the day rather than the state.
 *
 * `STAGES` is NOT trimmed. `stageState` and `orderProgress` both read the whole
 * ladder and the record screen still prints every stamp; only the LIST stopped
 * showing them.
 */
const SORT_KEYS = [
  "todo", "kitchen", "number", "status", "date", "customer", "title", "total",
  // `progress` sorts by how many rungs are done — least finished first, which
  // is the only ordering of a progress column anybody wants. It was missing
  // when the column shipped, so a sort by it was dropped on the way to the URL.
  "progress",
] as const;

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * THE ORDER THIS LIST IS IN WHEN NOBODY HAS ASKED FOR ONE — soonest first.
 *
 * A work queue opens on the work. The server fetches event_date DESCENDING
 * (it is taking the most recent 500 of twelve years), and shipping that
 * straight to the screen put December at the top and TODAY'S order at the
 * bottom of the page — caught by looking at the real data, not by review.
 *
 * It cannot be `DataTable`'s `defaultSort`, which is ignored the moment a list
 * controls its own sort (`sort = controlled ? controlledSort ?? null : …`), and
 * a null controlled sort means "render them as given".
 *
 * The `sort` STATE stays null, so the plain list still keeps one canonical
 * address — this is the natural order, not a departure from it, and only a
 * departure belongs in the URL.
 */
/**
 * THE FULL-WIDTH ROW WASH IS ONE SWITCH (Mark, 2026-08-20: "build it so that we
 * can make it a preference later that the user can turn on/off — it might be
 * too loud for some").
 *
 * It is a constant rather than a stored preference because there is nothing to
 * set it WITH yet, and a preference nobody can reach is dead machinery. Turning
 * it into one is: replace this read with a `useSyncExternalStore` over
 * localStorage (`lib/columnVisibility`'s idiom — display preferences live
 * there, never in the URL) and put a switch in the filter row. Every other part
 * is already conditional on it.
 *
 * IT GOVERNS THE WASH ONLY. The Progress strip is a column like any other, so
 * it is hidden from the Columns menu by whoever does not want it — which is the
 * control this app already has, and the reason the two are separate.
 */
const SHOW_ROW_PROGRESS_WASH = true;

const NATURAL_SORT: ListSort = { key: "date", dir: "asc" };

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
  orgId,
  kitchens,
  defaultLocationId,
  takenBy,
  initialFilters,
  initialSearch = "",
  capped = false,
}: {
  rows: SpecialOrderRow[];
  today: string;
  thresholds: AttentionThresholds;
  canWrite: boolean;
  orgId: string;
  kitchens: { id: string; code: string }[];
  /** The shop you are standing in — a new order's pickup shop by default. */
  defaultLocationId: string | null;
  /** The signed-in member's display name — a new order's `taken_by`. */
  takenBy: string;
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
        // The bar prepends its own FILTER_ALL option, and it is labelled the
        // same as the explicit `all` below ON PURPOSE — see that option.
        allLabel: "All orders",
        options: [
          { value: "attention", label: "Needs attention" },
          { value: "upcoming", label: "Upcoming" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "unpaid", label: "Unpaid" },
          { value: "past", label: "Past" },
          /**
           * A REAL TOKEN FOR "NO FILTER", which a dimension with a
           * `defaultValue` cannot do without — `lib/filterMenus` says so
           * outright and `/recipes` writes `?tier=all` for the same reason.
           *
           * `FILTER_ALL` is the empty string, and an empty value cannot be
           * written to a query string, so "absent" and "all" would be the same
           * URL and the DEFAULT would win: picking All orders, opening a
           * record and coming back would silently put you on Upcoming. Caught
           * against the real 8,330 rows, not by review.
           *
           * The cost is that the menu carries two entries reading "All orders"
           * — the bar's own and this one. They do the same thing; only this one
           * survives a reload. Suppressing the bar's would mean changing a
           * control six lists share, to remove an option that is correct
           * everywhere else.
           */
          { value: "all", label: "All orders" },
        ],
        // Upcoming: the working view, and the list's resting state.
        defaultValue: "upcoming",
        matches: (r, v) => {
          if (v === "all") return true;
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

  /**
   * Each row's progress, computed once and read twice — the wash and the strip.
   * Deriving it in both places would let the bar and the ticks disagree about
   * the same order, which is the class of bug this list has already had once.
   */
  const progress = useMemo(() => {
    const m = new Map<string, OrderProgress>();
    for (const r of rows) m.set(r.id, orderProgress(r as never, today, thresholds));
    return m;
  }, [rows, today, thresholds]);

  const listHref = filterHref(PATH, dimensions, filters, search, sort);
  const detailHref = (id: string) =>
    withFrom(`/special-orders/${id}`, { href: listHref, label: "Special Orders" });

  const columns: DataColumn<SpecialOrderRow>[] = [
    // THE ORDER NUMBER LEADS (Mark, 2026-08-20). It is the row's identity — the
    // thing a customer says on the phone and the thing every document prints —
    // so it is what `pinned` means here, and a pinned column belongs at the
    // margin the eye starts from rather than three columns in.
    //
    // NO `storageKey` BUMP, and that is the whole point of `pinned`:
    // `applyColumnOrder` gives pinned columns their DECLARED index and lets the
    // movable ones fill what is left in stored order, so moving this
    // declaration to the front moves the column for everybody without
    // discarding anybody's dragged widths. A bump would have been the reflex —
    // it is what the timesheets table needed — and it is only needed when a
    // MOVABLE column's position changes.
    {
      key: "number",
      label: "Number",
      width: 125,
      pinned: true,
      sortValue: (r) => r.number,
      render: (r) => (
        <Link href={detailHref(r.id)} className="font-medium tabular-nums hover:underline">
          {r.number}
        </Link>
      ),
    },
    {
      key: "kitchen",
      label: "Kitchen",
      width: 128,
      sortValue: (r) => r.kitchen_code ?? "",
      sortTiebreaks: [(r) => r.number],
      render: (r) => <span className="text-muted">{r.kitchen_code ?? "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 116,
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
      // "Date", not "Event" — the TITLE column is the event (FileMaker calls
      // that field Event_Description), and two columns reading EVENT three
      // apart is a header you have to decode.
      label: "Date",
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
      width: 180,
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
      width: 170,
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
    {
      /**
       * THE SIX RUNGS AS TICKS — it says WHICH stage, where the row's wash
       * says HOW FAR. It sits LAST (Mark, 2026-08-20), which is where the seven
       * stage columns it replaced used to end: the strip is the settled state
       * of an order, read after its number, its customer and its money, not
       * before them.
       *
       * `sortValue` is how many are done, so sorting by it is "least finished
       * first" — the only ordering of a progress column anybody wants.
       */
      key: "progress",
      label: "Progress",
      width: 92,
      sortValue: (r) => progress.get(r.id)?.done ?? 0,
      sortTiebreaks: [(r) => r.number],
      render: (r) => {
        const p = progress.get(r.id);
        if (!p || p.tone === "none") return <span className="text-faint">—</span>;
        return (
          <span
            className="inline-flex gap-[2px]"
            title={progressChecklist(p)}
          >
            {p.ticks.map((t) => (
              <span
                key={t.key}
                aria-hidden
                className={`block h-[13px] w-[8px] ${
                  t.state === "done"
                    ? "bg-ink"
                    : t.state === "overdue"
                      ? "bg-accent"
                      : t.state === "waiting"
                        ? "bg-mark-fill"
                        : "bg-neutral-200"
                }`}
              />
            ))}
            <span className="sr-only">
              {p.done} of {p.total} stages done
            </span>
          </span>
        );
      },
    },
    {
      /**
       * LAST, AFTER PROGRESS (Mark, 2026-08-20). It led the list until today,
       * which put a mostly-empty column — the to-do is set on 101 of 8,330
       * orders — at the margin the eye starts from. At the end it reads as what
       * it is: the note somebody left on an order, after the order.
       */
      key: "todo",
      label: "To-do",
      width: 150,
      wrap: true,
      sortValue: (r) => r.todo ?? "",
      sortTiebreaks: [(r) => r.number],
      /**
       * Decision 4: the MANUAL to-do always overrides the derived hint on
       * display.
       *
       * THE DERIVED ATTENTION SENTENCE IS NOT PRINTED HERE (Mark, 2026-08-20:
       * "remove the yellow hint text in the first column. It's not needed").
       * It used to sit under the to-do in the mark colour — "Event has passed
       * and $49.50 is unpaid" — on a large share of the rows, which doubled
       * their height down the whole list to repeat something the list can
       * already be FILTERED by and the record states in full. `needsAttention`
       * is unchanged and still feeds the Attention menu and its count; only
       * this column stopped restating it.
       *
       * A HUMAN FLAG STILL SHOWS, and that is the line between the two: the
       * derived sentence is the app's inference, where `flag_reason` is a
       * sentence somebody typed for the next person to read. It is red, not
       * yellow, which is why it is not what was asked to go.
       */
      render: (r) => {
        const hint = r.todo ? null : suggestedTodo(r as never, today);
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
            {r.flag_reason ? (
              <span className="block text-[12px] text-accent">{r.flag_reason}</span>
            ) : null}
          </span>
        );
      },
    },
  ];

  const sorted = sortRows(visible, columns, sort ?? NATURAL_SORT);

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
    <>
      {/* The app's page header — this screen had no title at all (Mark,
          2026-09-03). Org-wide, so no shop code: decision 8 makes a special
          order the ORG's, which is why this screen is exempt from
          `InactiveLocationGate`. */}
      <PageHeading
        title="Special Orders"
        visible={visible.length}
        total={rows.length}
        noun="orders"
      />

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
          // `PageHeading` states the count now — see `showCount`.
          showCount={false}
          rowAction={
            canWrite ? (
              <NewSpecialOrder
                orgId={orgId}
                kitchens={kitchens}
                defaultLocationId={defaultLocationId}
                today={today}
                takenBy={takenBy}
              />
            ) : undefined
          }
        />
        {capped ? (
          <p className="text-[13px] text-mark">
            Showing the most recent 500. Narrow the view to see further back.
          </p>
        ) : null}
      </div>

    <DataTable
      rows={sorted}
      // `sort ?? NATURAL_SORT` so the header arrow agrees with the rows. The
      // URL is written from `sort` itself, which stays null until you move it.
      sort={sort ?? NATURAL_SORT}
      onSortChange={changeSort}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="special-orders.v2"
      compactBelow={1280}
      columnChooser
      group={groups}
      // Grey and struck, so a cancelled order is legible as history rather than
      // as work. It is not hidden: FileMaker kept 705 of them and they are
      // routinely reinstated.
      rowClassName={(r) => (r.status === "cancelled" ? "text-faint line-through" : "")}
      /**
       * THE ROW IS THE PROGRESS BAR — a wash filling to the fraction done,
       * yellow at the first rung and green at the last, under a 3px rule on the
       * row's bottom edge. Both are backgrounds on the `<tr>`, so both span its
       * full width; anchoring either to a cell makes it as wide as that column.
       *
       * A CANCELLED ORDER GETS NO BAR (the style is `undefined`, not a zero
       * width) and a FLAGGED one is full-width red whatever its stages say —
       * Mark's two special cases, and both are right for the same reason: a
       * flagged order is not a progress question, and a cancelled one is not
       * partly done, it is not happening.
       */
      rowStyle={
        SHOW_ROW_PROGRESS_WASH
          ? (r, layout) => {
              const p = progress.get(r.id);
              // The bar SNAPS to a column rule — see `snapStops`. The table
              // hands over where the rules currently fall, because they move
              // with the reader's dragged widths and with whatever is hidden.
              return p ? (progressRowStyle(p, layout.boundaries) ?? undefined) : undefined;
            }
          : undefined
      }
      empty={<p className="text-sm text-muted">No orders match these filters.</p>}
    />

    {/* THE KEY IS PINNED TO THE FOOT OF THE WINDOW (Mark, 2026-08-20). The
        strip's four states and the six rungs they stand for are a legend, and a
        legend under a 500-row table is a legend nobody has read since the first
        screenful — where pinned it is there at the row you are actually looking
        at. `ui/StickyFooter` measures its own height into a spacer, so the last
        row stays clear of it with no guessed constant. */}
    <StickyFooter spacerClassName="-mt-2">
      {/* The CALLER draws the frame — `ui/StickyFooter` contributes position and
          a white backdrop and nothing else. Without a top rule the rows scroll
          up into an unmarked white band. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-hairline pt-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <Tick className="bg-ink" /> done
        </span>
        <span className="flex items-center gap-1.5">
          <Tick className="bg-accent" /> overdue
        </span>
        <span className="flex items-center gap-1.5">
          <Tick className="bg-mark-fill" /> waiting on them
        </span>
        <span className="flex items-center gap-1.5">
          <Tick className="bg-neutral-200" /> not yet
        </span>
        <span className="text-subtle">{PROGRESS_LABELS.join(" · ")}</span>
      </div>
    </StickyFooter>
    </>
  );
}

/** One legend swatch, the same 8×13 the strip draws. */
function Tick({ className }: { className: string }) {
  return <span aria-hidden className={`block h-[11px] w-[8px] ${className}`} />;
}
