// The order guide (spec §4.1–4.6). Everything here is derived from the live
// view `v_order_guide` — never materialized, never cached (design rule 4).

export type GuideRow = {
  item_location_id: string;
  inventory_item_id: string;
  item_name: string;
  category: string | null;
  base_unit: string;
  shop_section: string | null;
  shop_section_sort: number | null;
  par_qty: number | null;
  vendor_item_id: string;
  vendor_id: string;
  vendor_name: string;
  brand: string | null;
  vendor_item_description: string | null;
  product_id: string | null;
  package_desc: string | null;
  package_content: number | null;
  /** FMP's pack structure, restored by 010: "12 × 32 oz" rather than "1 × 24 lbs". */
  pack_count: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  effective_price: number | null;
  unit_price: number | null;
  vendor_minimum: number | null;
  vendor_delivery_days: number[] | null;
  /**
   * True when a plan row exists for this line on this weekday — this source is
   * a favorite today. A favorite is the preferred source whether or not the
   * line is today's work; should_order is the separate question.
   */
  is_favorite: boolean;
  /**
   * The four-way AND, computed in the view: membership (the active cascade)
   * AND the walked day is in the vendor's order days AND the item's order days
   * AND this line's favorite days. The guide's focus list.
   */
  should_order: boolean;
  /** The three raw day arrays behind should_order — what makes "why isn't
   *  this green" explainable per line (see notGreenReason). */
  vendor_order_days: number[];
  item_order_days: number[];
  favorite_days: number[];
};

/**
 * The quick filters from the FMP guide's find panel (§4.6), in two day tiers:
 * - `all` — everything orderable AND relevant to the day being walked (the
 *   vendor takes orders that day and the item is scheduled that day). Picking a
 *   day has to mean something for the list, not just for the green.
 * - `favorites` — `all` plus "and this source is the one we prefer that day",
 *   the default working mode
 * - `skipped` — favorites whose order amount hasn't been touched
 * - `will_order` — anything with a quantity, favorite or not
 *
 * Why `favorites` and not "should order": `all` now carries the vendor-day and
 * item-day conditions itself, so within the visible list the ONLY thing
 * `should_order` adds is the favorite-day check. Same set, and the name says
 * which condition you're actually toggling.
 *
 * `ignoreDays` lifts the vendor-day and item-day gates off every filter, not
 * just `all` — so the switch means the same thing whichever one you're on, and
 * flipping it never has to move you off your filter. `favorites` then rests on
 * the favorite-day condition alone (`is_favorite`), which is the condition that
 * gives the filter its name. FMP did this with its
 * `g_IgnoreOrderDayWhenSearching_b` flag.
 */
export type GuideFilter = "all" | "favorites" | "skipped" | "will_order";

export const GUIDE_FILTERS: GuideFilter[] = [
  "all",
  "favorites",
  "skipped",
  "will_order",
];

export const GUIDE_FILTER_LABEL: Record<GuideFilter, string> = {
  all: "All",
  favorites: "Favorites",
  skipped: "Skipped",
  will_order: "Will order",
};

export function matchesGuideFilter(
  row: GuideRow,
  entry: EntryState | undefined,
  filter: GuideFilter,
  weekday: number,
  ignoreDays: boolean
): boolean {
  const qty = entry?.qty_to_order ?? null;
  switch (filter) {
    case "all":
      // Day-relevant membership: the two conditions that are facts about the
      // day rather than about your preference. The favorite check is what
      // `should_order` adds on top.
      return (
        ignoreDays ||
        (row.vendor_order_days.includes(weekday) &&
          row.item_order_days.includes(weekday))
      );
    case "favorites":
      // `should_order` is the precomputed four-way AND; the vendor-day and
      // item-day halves of it are already true for anything `all` shows, so
      // inside the visible list this reads exactly as "and it's a favorite".
      // With the day gates lifted, that favorite-day condition stands alone.
      return ignoreDays ? row.is_favorite : row.should_order;
    case "skipped":
      // Untouched only. A zeroed line is a decision already made — you looked
      // and said no — so it isn't waiting on you; an untouched one is.
      return (ignoreDays ? row.is_favorite : row.should_order) && qty === null;
    case "will_order":
      return qty !== null && Number(qty) > 0;
  }
}

/** What's been entered against a line today. Absent = untouched. */
export type GuideEntry = {
  vendor_item_id: string;
  on_hand: number | null;
  qty_to_order: number | null;
};

export type EntryState = {
  on_hand: number | null;
  qty_to_order: number | null;
};

/**
 * The three states FMP encoded and we deliberately preserve (§4.8):
 * entered (>0), explicitly zeroed (0), untouched (null). "I decided no" and
 * "I haven't looked yet" are different facts during a walk.
 */
export type QtyState = "entered" | "zeroed" | "untouched";

export function qtyState(qty: number | null | undefined): QtyState {
  if (qty === null || qty === undefined) return "untouched";
  return Number(qty) > 0 ? "entered" : "zeroed";
}

/**
 * The order box's fill. Filled rather than tinted — these read at arm's length
 * on a shelf.
 *
 * - zeroed        red, whatever the line is. An explicit "no" outranks
 *                 everything else on the row.
 * - should-order  green: today's work. Pale while untouched, solid once a
 *                 quantity is in, so you can still see what you've done.
 * - other lines   white until used. A quantity on a NON-favorite is blue —
 *                 you switched source, which is true whether or not the line
 *                 was today's work. A quantity on a favorite that isn't
 *                 today's work fills neutral: it's your preferred source,
 *                 just ordered off-schedule.
 */
export function qtyClass(
  state: QtyState,
  shouldOrder: boolean,
  isFavorite: boolean
): string {
  const base = "border-2 border-ink text-ink";
  if (state === "zeroed") return `${base} bg-[var(--rf-red-200)]`;
  if (shouldOrder)
    return state === "entered"
      ? `${base} bg-[var(--rf-green-200)]`
      : `${base} bg-[var(--rf-green-50)]`;
  if (state === "entered")
    return isFavorite
      ? `${base} bg-neutral-100`
      : `${base} bg-[var(--rf-yellow-200)]`; // "you switched source"
  return `${base} bg-white`;
}

/**
 * Why this line is NOT green today (§ "say WHY a line isn't should-order").
 * should_order is a four-way AND, so a quiet line has up to four reasons; the
 * view ships the three day arrays on every line, so naming the failing
 * condition costs nothing. Null when the line IS should-order.
 */
export function notGreenReason(row: GuideRow, weekday: number): string | null {
  if (row.should_order) return null;
  // No "not orderable" branch: the guide's query filters is_orderable = true,
  // so a dead pairing never reaches this function — and carrying the column
  // just to test it cost 877 constants per load. Blocked lines are /cleanup's
  // job, not the walk's.
  const day = WEEKDAY_LABELS[weekday - 1];
  const reasons: string[] = [];
  if (!row.vendor_order_days.includes(weekday))
    reasons.push(`${row.vendor_name} doesn't take ${day} orders`);
  if (!row.item_order_days.includes(weekday))
    reasons.push(`item not scheduled ${day}`);
  if (!row.favorite_days.includes(weekday))
    reasons.push(`this source isn't a favorite ${day}`);
  // All three day sets include today yet the view said no — data changed
  // between render and read; say something rather than nothing.
  if (reasons.length === 0) return "not on today's plan";
  return reasons.join(" · ");
}

/**
 * Count mode (§4.3): on-hand in base units → packages to order.
 * `ceil((par − on_hand) / package_content)`, floored at zero. Returns null when
 * the data can't support a suggestion — a missing par or package content is
 * exactly what the cleanup queue flags, and guessing here would be worse than
 * saying nothing.
 */
export function suggestQty(
  par: number | null,
  onHand: number | null,
  packageContent: number | null
): number | null {
  if (par === null || onHand === null) return null;
  if (packageContent === null || Number(packageContent) <= 0) return null;
  const needed = Number(par) - Number(onHand);
  if (needed <= 0) return 0;
  return Math.ceil(needed / Number(packageContent));
}

/** One inventory item and its plan lines — the guide's unit of display. */
export type GuideItem = {
  inventory_item_id: string;
  item_name: string;
  base_unit: string;
  par_qty: number | null;
  lines: GuideRow[];
};

export type GuideSection = {
  key: string;
  label: string;
  sort: number;
  /** Item mode has nothing to head each group with — the list is the group. */
  showHeader: boolean;
  items: GuideItem[];
};

/**
 * How the guide is organised. Three real jobs, not three sorts of one list:
 * - `section` — the physical walk (§4.6), the default working mode
 * - `item` — one flat A–Z list, for looking something up rather than walking
 * - `vendor` — what each vendor's order looks like, which is how the minimum
 *   question is actually answered
 *
 * An item sourced from two vendors appears under BOTH vendor groups in vendor
 * mode, each showing only that vendor's line — which is the point: you're
 * looking at one vendor's basket, not the item's full plan.
 */
export type GuideGrouping = "section" | "item" | "vendor";

export const GROUPING_LABEL: Record<GuideGrouping, string> = {
  section: "Shop section",
  item: "Item",
  vendor: "Vendor",
};

export const GUIDE_GROUPINGS: GuideGrouping[] = ["section", "item", "vendor"];

/**
 * How you left the guide: the day you were walking, the filter, the grouping
 * and whether the day gates were lifted. Kept in a SESSION cookie rather than
 * the URL (the convention for list filters) for two reasons: the nav link is a
 * bare `/order-guide` with no query to carry, and the weekday has to be known
 * on the SERVER before the view is queried, so a client-side store would render
 * the wrong day first and correct it. The cookie dies with the browser session
 * and `signOut` clears it — "until you log out", as asked (Mark, 2026-07-23).
 *
 * An explicit `?day=` still wins, so shared links and the panel's back-trail
 * keep working.
 */
export const GUIDE_VIEW_COOKIE = "rf.guide.view";

export type GuideView = {
  /** null = no remembered day, fall back to today. */
  weekday: number | null;
  filter: GuideFilter;
  grouping: GuideGrouping;
  ignoreDays: boolean;
};

export const DEFAULT_GUIDE_VIEW: GuideView = {
  weekday: null,
  filter: "favorites",
  grouping: "section",
  ignoreDays: false,
};

/** Tolerant of anything: a stale or hand-edited cookie falls back to defaults. */
export function parseGuideView(raw: string | undefined | null): GuideView {
  if (!raw) return DEFAULT_GUIDE_VIEW;
  const q = new URLSearchParams(raw);

  const day = Number(q.get("day"));
  const filter = q.get("filter") as GuideFilter | null;
  const grouping = q.get("group") as GuideGrouping | null;

  return {
    weekday: day >= 1 && day <= 7 ? day : null,
    filter: filter && GUIDE_FILTERS.includes(filter) ? filter : DEFAULT_GUIDE_VIEW.filter,
    grouping:
      grouping && GUIDE_GROUPINGS.includes(grouping)
        ? grouping
        : DEFAULT_GUIDE_VIEW.grouping,
    ignoreDays: q.get("ignore") === "1",
  };
}

export function serializeGuideView(view: GuideView): string {
  return new URLSearchParams({
    day: String(view.weekday ?? ""),
    filter: view.filter,
    group: view.grouping,
    ignore: view.ignoreDays ? "1" : "0",
  }).toString();
}

function groupKeyFor(row: GuideRow, mode: GuideGrouping): { label: string; sort: number } {
  if (mode === "vendor") return { label: row.vendor_name, sort: 0 };
  if (mode === "item") return { label: "", sort: 0 };
  return {
    label: row.shop_section ?? "Uncategorized",
    // Unassigned items sort last rather than first — an "Uncategorized" bucket
    // at the top of a walk is noise before you've taken a step.
    sort: row.shop_section ? Number(row.shop_section_sort ?? 0) : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Order the lines under one item: vendor, then that vendor's own description.
 * Empty descriptions sink last and the compare is numeric-aware, matching the
 * list screens (`lib/tableSort.ts`) so the whole app orders text the same way.
 */
function compareLines(a: GuideRow, b: GuideRow): number {
  const byVendor = a.vendor_name.localeCompare(b.vendor_name, undefined, {
    numeric: true,
  });
  if (byVendor !== 0) return byVendor;

  const da = a.vendor_item_description ?? "";
  const db = b.vendor_item_description ?? "";
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db, undefined, { numeric: true });
}

/**
 * Group rows, then items, then their plan lines. Multi-favorite plan rows
 * (schema 003) mean one item can have several lines on the same day, so the
 * item is the header and lines nest beneath it (brief §A).
 *
 * The full walk order is shop section → inventory item → vendor → vendor item
 * description (Mark, 2026-07-23). The last two matter because an item sourced
 * from several vendors used to list its lines in whatever order the query
 * returned them, which moved between loads.
 */
export function groupGuide(
  rows: GuideRow[],
  mode: GuideGrouping = "section"
): GuideSection[] {
  const sections = new Map<string, GuideSection>();

  for (const row of rows) {
    const { label, sort } = groupKeyFor(row, mode);

    let section = sections.get(label);
    if (!section) {
      section = { key: label || "all", label, sort, showHeader: mode !== "item", items: [] };
      sections.set(label, section);
    }

    let item = section.items.find((i) => i.inventory_item_id === row.inventory_item_id);
    if (!item) {
      item = {
        inventory_item_id: row.inventory_item_id,
        item_name: row.item_name,
        base_unit: row.base_unit,
        // Par is per (item-location, weekday) since 009, so every line under
        // this item carries the same number — the first one is the item's par.
        par_qty: row.par_qty,
        lines: [],
      };
      section.items.push(item);
    }
    item.lines.push(row);
  }

  // Section mode has a meaningful numeric order (the walk); the others are
  // alphabetical.
  const list = [...sections.values()].sort((a, b) =>
    mode === "section" ? a.sort - b.sort : a.label.localeCompare(b.label)
  );
  for (const section of list) {
    section.items.sort((a, b) => a.item_name.localeCompare(b.item_name));
    for (const item of section.items) item.lines.sort(compareLines);
  }
  return list;
}

export type VendorTotal = {
  vendor_id: string;
  vendor_name: string;
  minimum: number | null;
  subtotal: number;
  lines: number;
  /** Under an existing minimum: this vendor generates no PO (§4.2). */
  short: boolean;
};

/** Running subtotal per vendor against its minimum — the guide's instrument. */
export function vendorTotals(
  rows: GuideRow[],
  entries: Map<string, EntryState>
): VendorTotal[] {
  const totals = new Map<string, VendorTotal>();

  for (const row of rows) {
    const qty = entries.get(row.vendor_item_id)?.qty_to_order ?? null;
    if (qty === null || Number(qty) <= 0) continue;

    const entry = totals.get(row.vendor_id) ?? {
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      minimum: row.vendor_minimum === null ? null : Number(row.vendor_minimum),
      subtotal: 0,
      lines: 0,
      short: false,
    };
    entry.subtotal += Number(qty) * Number(row.effective_price ?? 0);
    entry.lines += 1;
    totals.set(row.vendor_id, entry);
  }

  const list = [...totals.values()];
  for (const t of list) t.short = t.minimum !== null && t.subtotal < t.minimum;
  return list.sort((a, b) => b.subtotal - a.subtotal);
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "arrives Thu" chips (§4.1) — delivery days are already in the data. */
export function deliveryLabel(days: number[] | null): string | null {
  if (!days || days.length === 0) return null;
  const labels = [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d - 1] ?? d);
  return `arrives ${labels.join("/")}`;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Today's calendar date AND weekday in one timezone, so they can never
 * disagree.
 *
 * Doing this with `new Date().toISOString()` is wrong and fails quietly: at
 * 7pm in Los Angeles it is already tomorrow in UTC, so an evening walk gets
 * filed under tomorrow's date while the weekday still says today — one session
 * split across two guide dates, with the morning's entries seeming to vanish.
 *
 * The zone comes from `orgs.settings.timezone` (design rule 2: no business
 * facts in code). With none set we fall back to wherever the server thinks it
 * is, which is right in local dev and wrong on a UTC host — so set it before
 * deploying.
 */
export function guideToday(timeZone: string): { date: string; weekday: number } {
  // en-CA formats as YYYY-MM-DD, which is the shape Postgres `date` wants.
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Read the weekday back off that calendar date rather than off the instant,
  // which is what keeps the two in step.
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, weekday: ((jsDay + 6) % 7) + 1 }; // JS Sunday=0 → ISO Mon=1
}

export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
