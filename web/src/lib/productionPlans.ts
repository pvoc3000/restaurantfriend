/**
 * Plans — production brief decision 9.
 *
 * A plan is (selling location, kitchen, date range, trays). Several plans for
 * one shop may be active at once, and their UNION is that shop's menu: DF01
 * makes DF02's raised donuts while DF02 makes its own cake donuts, which is two
 * answers for one shop and exactly what `locations.kitchen_by_weekday` could
 * never hold.
 */

export const WEEKDAYS = [
  { iso: 1, short: "Mon", long: "Monday" },
  { iso: 2, short: "Tue", long: "Tuesday" },
  { iso: 3, short: "Wed", long: "Wednesday" },
  { iso: 4, short: "Thu", long: "Thursday" },
  { iso: 5, short: "Fri", long: "Friday" },
  { iso: 6, short: "Sat", long: "Saturday" },
  { iso: 7, short: "Sun", long: "Sunday" },
] as const;

export type PlanDates = { starts_on: string; ends_on: string | null };

/**
 * Is this plan in force on `date`? Open-ended plans (`ends_on` null) run until
 * somebody says otherwise, which is a real thing to want and what null means.
 *
 * String comparison, not `Date`: these are ISO `yyyy-mm-dd` from a `date`
 * column, which sort correctly as text and carry no timezone to get wrong.
 * `new Date("2026-08-07")` is UTC midnight and would shift a plan's first day
 * for anyone west of Greenwich — which is everybody here.
 */
export function coversDate(plan: PlanDates, date: string): boolean {
  if (date < plan.starts_on) return false;
  return plan.ends_on === null || date <= plan.ends_on;
}

/** Do two plans' date ranges touch at all? */
export function rangesOverlap(a: PlanDates, b: PlanDates): boolean {
  const aEnds = a.ends_on ?? "9999-12-31";
  const bEnds = b.ends_on ?? "9999-12-31";
  return a.starts_on <= bEnds && b.starts_on <= aEnds;
}

export type PlanSummary = {
  id: string;
  title: string;
  location_id: string;
  kitchen_location_id: string | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
};

/**
 * WHICH KITCHEN MAKES THIS PLAN'S DONUTS.
 *
 * `kitchen_location_id` is NULLABLE — 039 left it open for a plan written
 * before anyone had decided — and decision 9's reading of a null is that the
 * selling shop makes its own. `plansInForce` has always applied that fallback;
 * this is the same rule with a name, so the three screens that now scope
 * themselves by kitchen cannot each remember it differently.
 *
 * Getting it wrong is silent and total: without the fallback a plan whose
 * kitchen is unset belongs to NO shop and vanishes from every list.
 */
export function planKitchen(plan: {
  location_id: string;
  kitchen_location_id: string | null;
}): string {
  return plan.kitchen_location_id ?? plan.location_id;
}

/**
 * The shops that SELL what this kitchen makes, over a date range.
 *
 * `generate_production_schedules` is asked for SELLING shops and works out the
 * kitchens itself from the plans — "the kitchen is NOT a parameter: the DAY
 * tells you which kitchens are involved" (040, still true in 069). So the only
 * way to aim a run at one kitchen from outside the function is to ask which
 * sellers feed it, which is what this answers.
 *
 * ACTIVE plans only, because generation reads the active ones; a retired plan
 * naming this kitchen would offer a shop that then generates nothing.
 *
 * KNOWN LIMIT, and it is the function's shape rather than a bug: a selling shop
 * whose plans point at TWO kitchens qualifies here on the strength of one of
 * them, and generating it also writes the other kitchen's schedule. Measured
 * 2026-08-28 over the live data — 2 plans, both selling and making at the same
 * shop, ZERO shops with plans spanning two kitchens — so the case does not
 * exist today. Closing it properly means a kitchen argument on the generator,
 * which is a migration reproducing 069's function in full.
 */
export function sellingShopsForKitchen(
  plans: readonly PlanSummary[],
  kitchenId: string,
  range: PlanDates
): string[] {
  const out = new Set<string>();
  for (const p of plans) {
    if (!p.is_active) continue;
    if (planKitchen(p) !== kitchenId) continue;
    if (!rangesOverlap(p, range)) continue;
    out.add(p.location_id);
  }
  return [...out];
}

/**
 * Which ACTIVE plans overlap each other at one shop — decision 9's
 * generation-time warning, computed here so the plan list can show it long
 * before anyone generates anything.
 *
 * Overlapping is NOT an error and never blocks: it is the feature. What it
 * means is that pars SUM, so the person needs to know rather than be stopped —
 * the under-minimum-vendor pattern.
 */
export function overlappingPlans(plans: PlanSummary[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const active = plans.filter((p) => p.is_active);
  for (const a of active) {
    const others = active.filter(
      (b) => b.id !== a.id && b.location_id === a.location_id && rangesOverlap(a, b)
    );
    if (others.length) out.set(a.id, others.map((o) => o.title));
  }
  return out;
}

/** "3 Sep 2018 – 4 Nov 2018", or "from 3 Sep 2018". */
export function planRange(plan: PlanDates): string {
  const show = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
    return `${d} ${month} ${y}`;
  };
  return plan.ends_on ? `${show(plan.starts_on)} – ${show(plan.ends_on)}` : `from ${show(plan.starts_on)}`;
}

export type TraySlot = { itemId: string; name: string; rowId: string; par: number | null };

/**
 * How the trays are ORDERED on screen — a view, never a write.
 *
 * `production_plan_trays.sort` is untouched either way, so the printed packet
 * and `production_day` keep reading the plan's real order however you are
 * looking at it.
 */
export type MatrixGrouping = "tray" | "category" | "type";

/** What an uncategorised tray's band says. */
export const NO_CATEGORY = "No category";
/** And a tray whose Monday is empty, or whose item has no type. */
export const NO_TYPE = "No type";
/** The second band level under a type — FileMaker's BANANA / VANILLA. */
export const NO_CUT = "No cut";

/** An item's taxonomy, as `production_items` records it. */
export type ItemTaxonomy = { item_type: string | null; subtype: string | null; finish: string | null };

type MatrixTrayInput = { id: string; tray_number: string; band: string | null; sort: number | null };

/** Empty LAST, in both directions — `lib/tableSort`'s rule for a missing value. */
function compareValues(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * What a tray is grouped BY, under each grouping — one key to band on, a label
 * to print, and the ordered values to sort by.
 *
 * The band key and the sort key are deliberately DIFFERENT things for "type":
 * FileMaker bands the donut TYPE (its black CAKE / MOCHI / OLD FASHIONED rules)
 * and orders within it by cut and then finish. Banding on all three would put a
 * rule above almost every tray, which names nothing.
 */
function groupOf(
  tray: MatrixTrayInput,
  representative: ItemTaxonomy | null,
  grouping: MatrixGrouping
): { key: string; label: string; sortBy: string[]; subKey: string; subLabel: string | null } {
  if (grouping === "category") {
    const category = (tray.band ?? "").trim();
    return {
      key: category,
      label: category || NO_CATEGORY,
      sortBy: [category],
      subKey: "",
      subLabel: null,
    };
  }
  if (grouping === "type") {
    const type = (representative?.item_type ?? "").trim();
    const cut = (representative?.subtype ?? "").trim();
    const finish = (representative?.finish ?? "").trim();
    return {
      key: type,
      label: type || NO_TYPE,
      sortBy: [type, cut, finish],
      // The CUT is the second band level, and it nests: two types can both have
      // a "Plain" cut, so the run has to be keyed by the pair or the second
      // CAKE/Plain run would read as a continuation of the MOCHI/Plain one.
      subKey: `${type} ${cut}`,
      subLabel: cut || NO_CUT,
    };
  }
  return { key: "", label: "", sortBy: [], subKey: "", subLabel: null };
}

/**
 * The matrix a plan editor renders: one row per tray, seven columns of slots.
 *
 * Pure, so the shape is testable without a database — and it is the piece most
 * likely to go wrong by one, since a weekday off by one silently shifts a whole
 * shop's menu by a day.
 *
 * `groupLabel` is set on the FIRST row of each category run and null elsewhere,
 * so a caller draws one band per run without tracking a variable down the list —
 * `DataTable`'s rule that a grouping can only band what the ORDER already
 * groups, which is why the label comes from the same function that sorts.
 * `groupCount` rides with it: how many trays that run holds, computed here
 * rather than by the caller for the same reason — this is the function that
 * knows where the run ends.
 */
export function buildMatrix(
  trays: MatrixTrayInput[],
  slots: { id: string; tray_id: string; weekday: number; item_id: string; par: number | null }[],
  itemNames: Map<string, string>,
  grouping: MatrixGrouping = "tray",
  /**
   * Each item's taxonomy, for the `type` grouping. Only the FIRST item on a
   * tray's MONDAY speaks for that tray (Mark, 2026-08-08) — a tray usually
   * carries one kind of donut all week, so one representative is enough, and
   * picking a day makes the answer stable instead of depending on which cell
   * you happened to look at.
   */
  taxonomy?: Map<string, ItemTaxonomy>
): {
  tray: { id: string; tray_number: string; band: string | null };
  days: TraySlot[][];
  groupLabel: string | null;
  groupCount: number | null;
  /** The second band level — the CUT, under a type. Null when there isn't one. */
  subGroupLabel: string | null;
  /** Last row of its cut run, so the caller can leave a gap after it. */
  endsSubGroup: boolean;
}[] {
  const byTray = new Map<string, typeof slots>();
  for (const s of slots) {
    const list = byTray.get(s.tray_id) ?? [];
    list.push(s);
    byTray.set(s.tray_id, list);
  }

  const monday = WEEKDAYS[0].iso;
  const grouped = trays.map((tray) => {
    const first = (byTray.get(tray.id) ?? []).find((s) => s.weekday === monday);
    const representative = first ? taxonomy?.get(first.item_id) ?? null : null;
    return { tray, group: groupOf(tray, representative, grouping) };
  });

  const ordered = grouped.slice().sort((a, b) => {
    for (let i = 0; i < Math.max(a.group.sortBy.length, b.group.sortBy.length); i++) {
      const d = compareValues(a.group.sortBy[i] ?? "", b.group.sortBy[i] ?? "");
      if (d !== 0) return d;
    }
    return compareTrayNumbers(a.tray.tray_number, b.tray.tray_number) || (a.tray.sort ?? 0) - (b.tray.sort ?? 0);
  });

  return ordered.map(({ tray, group }, i) => {
    // Grouping by TRAY bands nothing — the plan's own order has no runs to name.
    const startsRun =
      grouping !== "tray" && (i === 0 || group.key !== ordered[i - 1].group.key);
    return {
      tray: { id: tray.id, tray_number: tray.tray_number, band: tray.band },
      days: WEEKDAYS.map((d) =>
        (byTray.get(tray.id) ?? [])
          .filter((s) => s.weekday === d.iso)
          .map((s) => ({
            itemId: s.item_id,
            rowId: s.id,
            name: itemNames.get(s.item_id) ?? "—",
            // `s.par` and not `s.par || null`: a deliberate ZERO must survive
            // the trip to the screen, or decision 3 is invisible to a reader
            // while the database still holds it.
            par: s.par,
          }))
          // BY NAME within a day (Mark, 2026-09-04: a tray holding three
          // mochis listed them in a different order on every day). Slots
          // arrive in whatever order they were written, and a cell whose
          // order depends on which donut was added first is a cell you have
          // to re-read on every column.
          .sort((a, b) => compareValues(a.name, b.name) || a.itemId.localeCompare(b.itemId))
      ),
      groupLabel: startsRun ? group.label : null,
      // How many trays this run holds — counted here, so the band can say it
      // without the caller tracking a running total down the list.
      groupCount: startsRun
        ? ordered.filter((o) => o.group.key === group.key).length
        : null,
      subGroupLabel:
        group.subLabel !== null &&
        (i === 0 || group.subKey !== ordered[i - 1].group.subKey)
          ? group.subLabel
          : null,
      endsSubGroup:
        group.subLabel !== null &&
        (i === ordered.length - 1 || group.subKey !== ordered[i + 1].group.subKey),
    };
  });
}

/**
 * The item's DEFAULT par at one shop — `production_item_locations.par_by_weekday`,
 * which since migration 043 is a seed and nothing else.
 *
 * Keyed by item id, each value the shop's seven-slot strip in ISO order.
 */
export type DefaultPars = Record<string, (number | null)[]>;

/**
 * The seed for a new plan slot's par: this item's default at THIS SHOP on THIS
 * weekday.
 *
 * ISO in, 0-based out — `weekday - 1`, and getting that wrong puts Sunday's
 * number on Saturday's tray. Since 043 there is no array subscript left in SQL
 * at all, so this is the one place the off-by-one can still happen, which is
 * why it is a named function with a fixture rather than an inline expression.
 *
 * Null for every kind of absence — no row at this shop, no strip, a short
 * strip — AND for a default of ZERO. A zero in the old array meant "we don't
 * make it that day", which is silence; a zero on a slot is a person saying
 * "making none today", which paints the derived day suppressed. Seeding one as
 * the other would manufacture a decision nobody made. The invariant: a
 * suppressed line always traces back to a human act on the plan.
 *
 * Never `undefined`: `insert({ par: undefined })` is serialised with the key
 * OMITTED, so the write would quietly succeed with a different payload than the
 * one you thought you sent.
 */
export function defaultParFor(
  defaults: DefaultPars,
  itemId: string,
  weekday: number
): number | null {
  const slot = defaults[itemId]?.[weekday - 1];
  return slot === null || slot === undefined || slot === 0 ? null : slot;
}

/**
 * How a slot's par reads on the matrix: "—" for one nobody has set, "0" for one
 * somebody deliberately set to none.
 *
 * The obvious `par || "—"` renders a real zero as an unset slot, which is
 * exactly the distinction decision 3 exists to draw.
 */
export function slotParLabel(par: number | null): string {
  return par === null ? "—" : String(par);
}

/**
 * Step a par by one BOX — FMP's stacked pair of steppers beside each par, which
 * is how a par is actually changed: you make donuts by the box, so you plan by
 * the box too.
 *
 * `step` is the item's own `tally_box_size` (037, default 6, per item) rather
 * than a hardcoded 6, so the number a par moves by and the number the printed
 * tally strip counts in are the same fact stated once. An item set to tray in
 * twelves steps by twelve with no further work.
 *
 * ZERO IS THE FLOOR — Mark's rule, and it is also the only sane one: a negative
 * par is not a thing a kitchen can make, and `production_plan_tray_items.par`
 * carries a `>= 0` check that would bounce it anyway.
 *
 * NULL COUNTS AS ZERO, so a press turns silence into a number: up from "nobody
 * has said" is one box, down from it is a deliberate none. Pressing a stepper is
 * itself the human act that the null/zero distinction turns on, so this does not
 * manufacture a decision — it records one.
 */
export function stepPar(par: number | null, step: number, direction: 1 | -1): number {
  return Math.max(0, (par ?? 0) + step * direction);
}

/**
 * A number for a duplicated tray that no other tray in the plan is using —
 * `production_plan_trays` is unique on (plan, tray_number), so a duplicate that
 * reuses the number is refused by the database.
 *
 * A purely numeric label counts UP and keeps its width, so a case of 01…12 stays
 * in order and "01" duplicates to the first free "02", "03"… Anything else —
 * FMP's "7A", or a name — takes a suffix instead, because incrementing a label
 * that isn't a number is guesswork.
 */
/**
 * Set on the URL a duplicate lands on, so the new plan opens OFFERING each
 * shop's own default beside every par that disagrees with it — the same
 * `→ use default n` a drag-copy leaves, applied to the whole plan at once.
 *
 * A parameter rather than stored state: the offer is a question about a copy
 * you just made, not a fact about the plan, so it should not survive being
 * navigated back to next week.
 */
export const REVIEW_DEFAULTS_PARAM = "defaults";

/**
 * A name for a duplicated plan.
 *
 * `production_plans` has no unique constraint on the title, so this is for the
 * READER rather than the database: two rows called "SUMMER 2026" in a list you
 * pick a plan from is the problem being solved.
 */
/**
 * The order trays are READ in: by their NUMBER, numerically, so "07" sits
 * between "05" and "10" and "7A" after "7" (Mark, 2026-09-04: grouping by
 * tray "doesn't look like the trays are being sorted by tray number").
 *
 * `production_plan_trays.sort` used to lead, and nothing ever wrote it except
 * "append": a tray added or duplicated after its neighbours sat wherever it
 * was created. `sort` is what `production_day` and the printed packet order
 * by, so it is kept IN STEP with this comparator rather than replaced — see
 * `traySortUpdates`.
 */
export function compareTrayNumbers(a: string, b: string): number {
  return a.trim().localeCompare(b.trim(), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The `sort` each tray should carry so the database orders them the way this
 * screen reads them — 1-based, by number — returning ONLY the trays whose
 * stored value differs, so a plan already in order writes nothing.
 */
export function traySortUpdates(
  trays: readonly { id: string; tray_number: string; sort: number | null }[]
): { id: string; sort: number }[] {
  return trays
    .slice()
    .sort((a, b) => compareTrayNumbers(a.tray_number, b.tray_number))
    .map((t, i) => ({ id: t.id, sort: i + 1, was: t.sort }))
    .filter((t) => t.was !== t.sort)
    .map(({ id, sort }) => ({ id, sort }));
}

/**
 * "Renumber trays": the plan's trays in READING order become 01, 02, 03 … —
 * padded to two digits (more only past 99), which is what FileMaker's numbers
 * look like and what `compareTrayNumbers` sorts as a number anyway. Returns
 * ONLY the trays whose number changes, in reading order.
 */
export function renumberTrays(
  trays: readonly { id: string; tray_number: string; sort: number | null }[]
): { id: string; from: string; to: string }[] {
  const width = Math.max(2, String(trays.length).length);
  return trays
    .slice()
    .sort((a, b) => compareTrayNumbers(a.tray_number, b.tray_number) || (a.sort ?? 0) - (b.sort ?? 0))
    .map((t, i) => ({ id: t.id, from: t.tray_number, to: String(i + 1).padStart(width, "0") }))
    .filter((t) => t.from !== t.to);
}

export function duplicateTitle(existing: readonly string[], from: string): string {
  const taken = new Set(existing.map((t) => t.trim()));
  for (let i = 1; i <= 200; i++) {
    const candidate = i === 1 ? `${from} copy` : `${from} copy ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${from} copy`;
}

export function nextTrayNumber(existing: readonly string[], from: string): string {
  const taken = new Set(existing);
  const digits = /^(\d+)$/.exec(from.trim());
  if (digits) {
    const width = digits[1].length;
    const start = Number(digits[1]);
    for (let n = start + 1; n <= start + 200; n++) {
      const candidate = String(n).padStart(width, "0");
      if (!taken.has(candidate)) return candidate;
    }
  }
  for (let i = 1; i <= 200; i++) {
    const candidate = i === 1 ? `${from} copy` : `${from} copy ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${from} copy`;
}
