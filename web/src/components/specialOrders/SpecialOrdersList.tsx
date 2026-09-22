"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RangePicker } from "@/components/ui/RangePicker";
import type { DateRange } from "@/lib/dateRange";
import { kindFilterIsDateless } from "@/lib/specialOrders";
import {
  DEFAULT_ORDER_RANGE,
  ORDER_RANGE_PRESETS,
  inOrderRange,
  isOrderRangeToken,
  orderRangeBounds,
  orderRangeToken,
} from "@/lib/specialOrderRange";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import {
  SPECIAL_ORDER_VIEW_COOKIE,
  hasViewParams,
  viewCookieValue,
} from "@/lib/specialOrderView";
import { SpecialOrderActions } from "@/components/specialOrders/SpecialOrderActions";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Checkbox } from "@/components/ui/Checkbox";
import { SpecialOrderBatchActions } from "@/components/specialOrders/SpecialOrderBatchActions";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { SEARCH_PEN } from "@/components/ui/fieldMetrics";
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
  ORDER_KIND_FILTERS,
  STATUS_LABEL,
  countsAsOwed,
  customerLabel,
  matchesKindFilter,
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
  /** Migration 116 — the to-do hint below reads it through `isPersonFlag`. */
  flag_source: string | null;
  title: string | null;
  event_date: string | null;
  event_time: string | null;
  fulfillment: string | null;
  location_code: string | null;
  kitchen_code: string | null;
  customer: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
  standing_days: number[] | null;
  /** Set when 099 materialized this day FROM a standing order; null on a
   *  hand-typed one. The Kind filter's whole distinction. */
  standing_order_id: string | null;
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
  topUpError = null,
}: {
  rows: SpecialOrderRow[];
  today: string;
  thresholds: AttentionThresholds;
  canWrite: boolean;
  orgId: string;
  kitchens: { id: string; code: string }[];
  /** The shop you are standing in — a new order's pickup shop by default. */
  defaultLocationId: string | null;
  /** The signed-in member's display name — a new order's `taken_by` when the
   *  login has no employee row to link instead (`takenByFields`). */
  takenBy: string;
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  capped?: boolean;
  /**
   * Why the standing-order top-up did not run, if it did not.
   *
   * A list missing its wholesale days looks EXACTLY like a list that has none,
   * which is the whole reason this is surfaced rather than swallowed — 018's
   * rule about a screen saying so when a migration is not applied yet. Null in
   * every ordinary load, so the quiet state is the list as it was.
   */
  topUpError?: string | null;
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
         * WHEN, AND NOTHING ELSE (Mark, 2026-09-20: "move 'needs attention'
         * from show to the status picklist too, and any others that aren't
         * time based").
         *
         * It used to carry Needs Attention and Unpaid as well, on the argument
         * that they "answer the same question the other five options do". They
         * do not: Upcoming, Tomorrow and Past answer WHEN, and those two answer
         * what STATE an order is in. One menu was doing two jobs, which is why
         * picking Unpaid silently threw away Upcoming — the two are questions
         * you want to ask at the same time, and a single menu can only hold
         * one answer.
         */
        key: "view",
        label: "Show",
        /**
         * IT IS STILL A DIMENSION, and that is what buys the conversion for
         * almost nothing: `parseFilterValues`, `filterHref` and the view cookie
         * all read the dimension list, so the window keeps travelling in the
         * URL exactly as it did. What changed is the CONTROL — `FilterMenus` is
         * handed every dimension but this one, and a `RangePicker` is rendered
         * in its place. A dimension nobody draws a menu for is still a filter.
         *
         * The options are the presets, so the ordinary machinery recognises
         * `?view=past`; `accepts` is what lets a calendar pair through, which
         * no list of options could hold. The vocabulary and the matcher both
         * live in `lib/specialOrderRange` — the SERVER reads the same token to
         * size its own window, and the one thing that must never drift is those
         * two disagreeing about what "past" means.
         */
        options: ORDER_RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
        accepts: isOrderRangeToken,
        // Upcoming: the working view, and the list's resting state, as it was.
        defaultValue: DEFAULT_ORDER_RANGE,
        /**
         * PURELY A DATE TEST NOW. `upcoming` used to also require
         * `kind === "order"` and a status other than cancelled — three
         * questions in one menu option, which is the arrangement Mark has just
         * unpicked. Show answers WHEN; a cancelled order still happens on its
         * day, and Status is where you say you do not want to see it.
         */
        /**
         * PURELY A DATE TEST, and it stays that way: the Kind menu switches the
         * whole dimension OFF rather than this closure learning about a second
         * control — see `visible`. A `FilterDimension` that reads another
         * dimension's value cannot exist here anyway, because `filters` is
         * parsed FROM `dimensions` and the two would define each other.
         */
        matches: (r, v) => inOrderRange(r.event_date, orderRangeBounds(v, today)),
      },
      {
        key: "kind",
        label: "Kind",
        options: ORDER_KIND_FILTERS,
        matches: (r, v) => matchesKindFilter(r, v),
      },
      {
        /**
         * THE LADDER, AND THEN UNPAID (Mark, 2026-09-20: "move 'unpaid' from
         * the show picklist to the status picklist").
         *
         * It was an option under Show, beside Upcoming and Past, which made it
         * the odd one out there: those five answer WHEN, and this answers what
         * state the order is in — the same question the ladder answers. The
         * menus now divide the way the questions do.
         *
         * THEY ARE DERIVED, WHERE THE FIVE ABOVE THEM ARE STORED, so they sit
         * below a rule rather than at the end of the list. `status` is typed by
         * a human; these two are read off the record. UNPAID reads the money,
         * which is the authority (`needsAttention` makes the same argument in
         * the same words) — and only a BILLED order can be unpaid, because a
         * lead or a quote is a price OFFERED, which is `countsAsOwed`, the rule
         * both customer screens already ask. NEEDS ATTENTION is decision 19's
         * tier, the same map the to-do column paints from, so the menu and the
         * column can never disagree about which orders those are.
         *
         * NEEDS ATTENTION LEADS, because it is the wider net: an unpaid order
         * whose event has gone by is one of the things it catches.
         */
        key: "status",
        label: "Status",
        options: [
          ...(["lead", "quote", "invoice", "order", "cancelled"] as SpecialOrderStatus[]).map(
            (s) => ({ value: s, label: STATUS_LABEL[s] })
          ),
          { value: "attention", label: "Needs Attention", separatorBefore: true },
          { value: "unpaid", label: "Unpaid" },
        ],
        matches: (r, v) => {
          if (v === "attention") return attention.has(r.id);
          if (v === "unpaid")
            return countsAsOwed(r) && r.totals.balance > 0 && r.totals.total > 0;
          /* AN ORDER'S STATUS, NOT A STANDING ORDER'S (2026-09-20, migration
             112). A standing order now carries one, but it is the rung its DAYS
             start at rather than a state this record is in — and this menu
             answers "what state is it in", which is the whole reason Unpaid and
             Needs Attention left the Show menu. Filtering Invoice and finding
             two templates among the invoices would undo that in one line.
             The Kind menu is where a standing order is found. */
          return r.kind === "order" && r.status === v;
        },
      },
      // LOCATION — the order's pickup shop, `location_id` — BEFORE Kitchen
      // (Mark, 2026-09-16: "between status and kitchen"). The key stays
      // `pickup` so the URL and the remembered-view cookie keep working.
      {
        key: "pickup",
        label: "Location",
        options: codes((r) => r.location_code),
        matches: (r, v) => (v === NONE ? !r.location_code : r.location_code === v),
      },
      {
        key: "kitchen",
        label: "Kitchen",
        options: codes((r) => r.kitchen_code),
        matches: (r, v) => (v === NONE ? !r.kitchen_code : r.kitchen_code === v),
      },
      {
        key: "todo",
        label: "To-do",
        options: [
          ...todos.map((t) => ({ value: t, label: t })),
          { value: NONE, label: "Nothing Set" },
        ],
        matches: (r, v) => (v === NONE ? !r.todo : r.todo === v),
      },
    ];
  }, [rows, today, attention]);

  /** Everything the bar draws a MENU for — see the `view` dimension's note. */
  const menuDimensions = useMemo(
    () => dimensions.filter((d) => d.key !== "view"),
    [dimensions]
  );

  /**
   * The address bar wins when it carries a view; otherwise the props do.
   *
   * `urlFilterParams` returns an EMPTY OBJECT on a bare `/special-orders`, not
   * null — the path matches, there is simply no query — so the plain
   * `urlFilterParams(PATH) ?? initialFilters` this used to be would have
   * ignored the server's remembered view and left the filter bar saying
   * "Upcoming" over rows the server had already filtered to something else.
   * That mismatch is the one thing worse than not remembering at all.
   */
  const seed = (): RawSearchParams => {
    const live = urlFilterParams(PATH);
    return hasViewParams(live) ? (live as RawSearchParams) : initialFilters ?? {};
  };

  const router = useRouter();

  const [search, setSearch] = useState(() => {
    const live = urlFilterParams(PATH);
    return hasViewParams(live) ? parseFilterSearch(live as RawSearchParams) : initialSearch;
  });
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, seed())
  );
  const [sort, setSort] = useState<ListSort | null>(() => parseListSort(seed(), SORT_KEYS));

  /**
   * ONE PLACE WRITES THE VIEW, and it writes it twice — to the URL, so a
   * breadcrumb and a Back press are honest, and to a session cookie, so a HARD
   * load lands where you left off (Mark, 2026-09-08). Keeping them together is
   * what stops the two disagreeing about what the view currently is; storing
   * the href's own query means the cookie needs no second serializer.
   *
   * A session cookie (no max-age) is what "until you log out" means here, and
   * `clearSessionCookies` drops it.
   */
  function writeUrl(f: FilterValues, q: string, s: ListSort | null, navigate = false) {
    const href = filterHref(PATH, dimensions, f, q, s);
    document.cookie = `${SPECIAL_ORDER_VIEW_COOKIE}=${viewCookieValue(href)}; path=/; SameSite=Lax`;
    // THE DATE WINDOW IS A SERVER FILTER, so changing it must re-run the page —
    // `router.push`, where every other control gets `replaceState` (the PO
    // list's lesson, in its own words). `page.tsx` fetches a window sized from
    // this same token, so a range the server has not been told about would
    // filter rows it never loaded: an empty list, blaming the filter.
    if (navigate) router.push(href);
    else window.history.replaceState(null, "", href);
  }
  /**
   * THE BAR'S "CLEAR" MUST NOT TAKE THE WINDOW WITH IT.
   *
   * `FilterMenus` is handed every dimension but `view`, so `clearedFilters`
   * hands back a record that has no `view` in it — and this setter replaces the
   * whole record. Without the merge, pressing Clear while looking at Past would
   * drop the window back to Upcoming CLIENT-SIDE ONLY, leaving the server
   * holding a year of past orders and the filter asking for future ones: the
   * empty list `page.tsx` has always warned about.
   *
   * Keeping it is also the right behaviour. Clear means "clear the menus"; the
   * range wears its own ✕, which clears it to All Time.
   */
  const changeFilters = (next: FilterValues) => {
    const merged =
      next.view === undefined && filters.view !== undefined
        ? { ...next, view: filters.view }
        : next;
    setFilters(merged);
    writeUrl(merged, search, sort);
  };
  const changeSearch = (next: string) => { setSearch(next); writeUrl(filters, next, sort); };
  const changeSort = (next: ListSort) => { setSort(next); writeUrl(filters, search, next); };
  /**
   * `setFilters` AS WELL AS pushing: the push re-renders the server component
   * but does NOT remount this one, so state seeded from props would otherwise
   * keep showing the old window on the control.
   */
  function changeRange(picked: DateRange | null) {
    const next = { ...filters, view: orderRangeToken(picked, today) };
    setFilters(next);
    writeUrl(next, search, sort, true);
  }

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.title, customerLabel(r.customer), r.customer?.company, r.todo]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  /**
   * THE KIND MENU CAN SWITCH THE DATE WINDOW OFF (Mark, 2026-09-21: "since
   * templates do not carry dates, selecting them in the Kind filter requires
   * also changing the 'show' filter to all time. Can the all time filter be
   * inactive when kind is a standing order or regular order template?").
   *
   * A template and a standing order have no `event_date` by design, so asking
   * for them by name and being shown nothing was the list obeying two controls
   * that cannot both be satisfied. The DATE gives way, because the Kind menu is
   * the more specific answer — you asked for the shapes by name.
   *
   * DROPPING THE DIMENSION, not changing its value: `filters.view` is left
   * exactly as it was, so it still travels in the URL and in the view cookie,
   * and switching Kind back restores the window you were looking at. The
   * control says so for itself — it reads "All Time" and goes disabled.
   */
  const dateless = kindFilterIsDateless(filters.kind ?? "");
  const visible = useMemo(
    () =>
      applyListFilters(
        searched,
        dateless ? dimensions.filter((d) => d.key !== "view") : dimensions,
        filters
      ),
    [searched, dimensions, filters, dateless]
  );

  /**
   * THE TICKED ROWS (Mark, 2026-09-20: "add a column to the first position on
   * the special order list so we can select multiple special orders and
   * perform actions on them"). `BillList`'s arrangement, which is where every
   * rule below was paid for.
   *
   * IDS, NOT ROWS, so a refresh that re-reads the list keeps your selection
   * pointing at the same orders rather than at stale copies of them.
   */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  /**
   * What the last bulk command did. Held HERE and not in the component that ran
   * it: reporting clears the selection, and a message owned by something that
   * clearing re-renders past is a message nobody reads — `BillBatchActions`
   * paid for that with a bulk approve that worked and said nothing.
   */
  const [batchReport, setBatchReport] = useState<{
    message: string;
    tone: "done" | "error";
  } | null>(null);

  /**
   * "SELECT ALL SHOWN" IS OVER `visible`, NOT `sorted`. Sorting changes the
   * ORDER and never the set, and `sorted` is derived from `columns`, which this
   * checkbox lives inside — so asking it here would be a circle.
   */
  const allVisibleChecked = visible.length > 0 && visible.every((r) => checked.has(r.id));

  /** Touching the selection retires the last report — `BillList`'s rule, and
   *  stated at the source so the message can render whenever it exists. */
  function toggleAllVisible() {
    setBatchReport(null);
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setBatchReport(null);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    /**
     * THE TICK BOX IS THE FIRST COLUMN (Mark, 2026-09-20), ahead even of the
     * number — it is not a field, it is how you address the row, so it sits
     * where your hand goes before you have read anything.
     *
     * `pinned`, like the number beside it, so `applyColumnOrder` gives it its
     * declared index and a dragged layout cannot put the boxes in the middle of
     * the table. An EMPTY label is what keeps it out of the Columns and Reorder
     * menus — `DataTable`'s own rule for a control column, which has no name to
     * offer and must not be hideable, because hiding it would hide the only way
     * to select anything.
     *
     * IT SHOWS FOR EVERY ROLE THAT CAN ACT, which today is purchaser+ (the gate
     * the row menu already uses). Below that the menu it feeds would be empty,
     * and boxes to tick with nothing to press are worse than no boxes — the
     * bill list's reasoning, where a READ command later earned them back for
     * everybody. If a read-only batch command ever lands here, this gate is the
     * line to revisit.
     */
    ...(canWrite
      ? [
          {
            key: "select",
            label: "",
            width: 44,
            pinned: true,
            header: (
              <Checkbox
                checked={allVisibleChecked}
                onChange={toggleAllVisible}
                label="Select all shown"
              />
            ),
            render: (r: SpecialOrderRow) => (
              <Checkbox
                checked={checked.has(r.id)}
                onChange={() => toggleOne(r.id)}
                label={`select order ${r.number}`}
              />
            ),
          } satisfies DataColumn<SpecialOrderRow>,
        ]
      : []),
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
      /* KIND FIRST, NOT "status ?? kind" (2026-09-20). Since 112 a standing
         order HAS a status, so falling back on its absence would sort the two
         templates in among the invoices — under the word the column does not
         print for them. The cell below has always read kind first; this had
         not, and nothing noticed while only one of them could be true. */
      sortValue: (r) => (r.kind === "order" ? (r.status ?? "") : r.kind),
      sortTiebreaks: [(r) => r.number],
      render: (r) =>
        r.kind === "order" ? (
          <span className="text-muted">
            {r.status ? STATUS_LABEL[r.status] : "—"}
            {/* Which of the two kinds of order this is, under its status —
                the same distinction the Kind menu now filters on, on the row
                it is about. */}
            {r.standing_order_id ? (
              <span className="block text-[12px] text-subtle">Standing order</span>
            ) : null}
          </span>
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
          {r.totals.balance > 0 && countsAsOwed(r) ? (
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
    /**
     * THE ROW'S OWN COMMANDS (Mark, 2026-09-08) — `ProductionItemsList`'s
     * shape, three weeks after the PO list made the same argument: acting on
     * one order meant opening it, and this list is where you are already
     * looking at the one you mean.
     *
     * UNLABELLED, which is what keeps it out of the Columns menu — it is a
     * control rather than a field, and hiding it would hide the only door.
     *
     * WRITE ROLES ONLY. Both entries write, so below that the `⋯` would open an
     * empty panel — unlike the PO list's, which keeps "Open purchase order" for
     * every reader. `/special-orders` is staff-READ (the page-permissions
     * sheet), so this is a real state and not a hypothetical one.
     */
    ...(canWrite
      ? [
          {
            key: "actions",
            label: "",
            // 74, `ProductionItemsList`' measured value and for its reason:
            // weights are shares of the table's TOTAL, so a 68 that is
            // comfortable on a nine-column table is not on an eleven-column
            // one. Verified at 1280 — see the note on the total below.
            width: 74,
            render: (r: SpecialOrderRow) => (
              <span className="flex justify-end">
                <SpecialOrderActions id={r.id} orgId={orgId} number={r.number} />
              </span>
            ),
          } satisfies DataColumn<SpecialOrderRow>,
        ]
      : []),
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
    /* And the band over those rows, for the same reason: a standing order is
       banded as a standing order, not under the status its days will start
       with. */
    {
      sortKey: "status",
      label: (r) =>
        r.kind === "order" ? (r.status ? STATUS_LABEL[r.status] : "—") : KIND_LABEL[r.kind],
    },
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
        // The create command rides in the TITLE row (Mark, 2026-09-10), where it
        // had been the filter bar's `rowAction`.
        action={
          canWrite ? (
            /* ONE MENU FOR THE SCREEN (Mark, 2026-09-20: "move 'new special
               order' button into the new actionmenu you created. first
               position"). The button had ridden in the title row since
               2026-09-10; it is now the first row of the menu that stands
               there instead, which is where the bill list and the PO list both
               ended up the day they grew a selection.

               NEW ORDER LEADS, as it does on the record's own menu and for the
               same reason: it is the one row here that is about no ticked row
               at all, so it belongs before the menu starts talking about them.

               THE TWO COMPONENTS THAT OWN THEIR COMMANDS KEEP OWNING THEM —
               `NewSpecialOrder` its dialog, `SpecialOrderBatchActions` its
               confirms and its skip counts — and hand their rows out through a
               render prop. */
            <NewSpecialOrder
              orgId={orgId}
              kitchens={kitchens}
              defaultLocationId={defaultLocationId}
              today={today}
              takenBy={takenBy}
            >
              {(createRows) => (
                <SpecialOrderBatchActions
                  selected={visible.filter((r) => checked.has(r.id))}
                  orgId={orgId}
                  today={today}
                  canWrite={canWrite}
                  onReport={(message, tone) => {
                    setBatchReport({ message, tone });
                    setChecked(new Set());
                  }}
                >
                  {(batchRows) => (
                    <ActionMenu
                      label="Actions"
                      /* ALWAYS RENDERED AND ALWAYS LIVE, the counts in the rows
                         doing the explaining — the PO list's rule. A trigger
                         that greys out with nothing ticked cannot say why, and
                         this one also holds the create command, which never
                         needs a selection. */
                      ariaLabel={
                        checked.size === 0
                          ? "Actions — select orders first"
                          : `Actions for ${checked.size} selected orders`
                      }
                      minWidth={230}
                      items={[
                        ...createRows,
                        ...batchRows,
                        {
                          label: "Clear Selection",
                          disabled: checked.size === 0,
                          onSelect: () => {
                            setBatchReport(null);
                            setChecked(new Set());
                          },
                        },
                      ]}
                    />
                  )}
                </SpecialOrderBatchActions>
              )}
            </NewSpecialOrder>
          ) : null
        }
      />

      <div className="space-y-3">
        <FilterMenus
          rows={searched}
          total={rows.length}
          noun="orders"
          /* EVERY DIMENSION BUT THE WINDOW. `view` is still a dimension — it is
             what carries the range into the URL and the cookie — but it is
             drawn as a `RangePicker` beside the search rather than as a menu.
             See the dimension's own note. */
          dimensions={menuDimensions}
          values={filters}
          onChange={changeFilters}
          leading={
            <>
              <div className={`${SEARCH_PEN} space-y-1.5`}>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Search
                </span>
                <TextInput
                  value={search}
                  onValueChange={changeSearch}
                  fullWidth
                  // `search` for the sunken dress (Mark, 2026-09-13); `fullWidth`
                  // still decides the width, the caption block wearing the pen.
                  search
                  aria-label="Search special orders"
                  clearLabel="Clear the search"
                  icon={<SearchGlyph />}
                />
              </div>
              {/* THE WINDOW SITS FIRST AMONG THE FILTERS, straight after the
                  search, which is where the PO list and the bill list both put
                  theirs. It keeps the word "Show", because that is what the
                  menu it replaces was called and it is still the same question
                  — only now asked with a calendar. */}
              <div className="w-44 space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Show
                </span>
                <RangePicker
                  /* "All Time" WHILE IT IS OFF, not the window it would apply.
                     A disabled control still reading "Upcoming" over a list of
                     templates would be the screen contradicting itself; null
                     matches the `all` preset, so the face says what is actually
                     in force. The STORED value is untouched underneath. */
                  value={
                    dateless
                      ? null
                      : orderRangeBounds(filters.view ?? DEFAULT_ORDER_RANGE, today)
                  }
                  onChange={changeRange}
                  presets={ORDER_RANGE_PRESETS}
                  today={today}
                  disabled={dateless}
                  ariaLabel="Which orders to show"
                  className="w-full"
                />
              </div>
            </>
          }
          // `PageHeading` states the count now — see `showCount`.
          showCount={false}
        />
        {batchReport ? (
          /* The bill list's own line, and its dress: a boxed yellow band, with
             the WORDS turning red when the report is a failure. */
          <p
            className={`border border-ink bg-mark-fill px-4 py-3 text-sm ${
              batchReport.tone === "error" ? "text-accent" : "text-ink"
            }`}
          >
            {batchReport.message}
          </p>
        ) : null}
        {capped ? (
          /* A FILL, not `text-mark`: yellow-500 on white measures 1.43:1, which
             is not a legibility complaint but text you cannot read. Fixed here
             because this screen was open (CLAUDE.md's standing rule). */
          <p className="text-[13px]">
            <span className="bg-mark-fill px-1">
              Showing the most recent 500. Narrow the view to see further back.
            </span>
          </p>
        ) : null}
        {topUpError ? (
          <p className="text-[13px]">
            <span className="bg-mark-fill px-1">
              Standing orders were not topped up: {topUpError}
            </span>
            {topUpError.includes("ensure_standing_orders_materialized") ? (
              <span className="ml-2 text-muted">Migration 099 has not been applied yet.</span>
            ) : null}
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
