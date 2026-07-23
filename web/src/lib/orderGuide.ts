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
  par_mode: string | null;
  vendor_item_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_order_type: string;
  brand: string | null;
  vendor_item_description: string | null;
  product_id: string | null;
  package_desc: string | null;
  package_content: number | null;
  effective_price: number | null;
  unit_price: number | null;
  vendor_minimum: number | null;
  vendor_delivery_days: number[] | null;
  is_orderable: boolean;
  hidden_reason: string | null;
  /**
   * True when this line is a plan row — a favorite (§4.1). False for the other
   * vendor items that sell the same inventory item, which the guide carries so
   * you can reassign a line in the moment (§4.2) and compare unit prices.
   */
  is_favorite: boolean;
};

/**
 * The quick filters from the FMP guide's find panel (§4.6).
 * - `all` — every active vendor item for the items on this plan
 * - `favorites` — the plan rows, the default working mode
 * - `skipped` — favorites you've decided NOT to order (zeroed or untouched)
 * - `will_order` — anything with a quantity, favorite or not
 */
export type GuideFilter = "all" | "favorites" | "skipped" | "will_order";

export const GUIDE_FILTER_LABEL: Record<GuideFilter, string> = {
  all: "All",
  favorites: "Favorites",
  skipped: "Skipped",
  will_order: "Will order",
};

export function matchesGuideFilter(
  row: GuideRow,
  entry: EntryState | undefined,
  filter: GuideFilter
): boolean {
  const qty = entry?.qty_to_order ?? null;
  switch (filter) {
    case "all":
      return true;
    case "favorites":
      return row.is_favorite;
    case "skipped":
      // "No order amount" covers both zeroed and untouched: either way this
      // favorite isn't being ordered, which is what you're scanning for.
      return row.is_favorite && (qty === null || Number(qty) === 0);
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

// Filled, not tinted — these read at arm's length on a shelf, which is the
// whole point of the three states.
export const QTY_CLASS: Record<QtyState, string> = {
  entered: "border-green-600 bg-green-200 text-green-950",
  zeroed: "border-red-500 bg-red-200 text-red-950",
  untouched: "border-neutral-400 bg-white text-neutral-900",
};

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
 * Group rows, then items, then their plan lines. Multi-favorite plan rows
 * (schema 003) mean one item can have several lines on the same day, so the
 * item is the header and lines nest beneath it (brief §A).
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
        // Item-level par: the plan row's par is a PER-LINE override, so the
        // header shows the first line's par only as a starting point.
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
