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

export type TraySlot = { itemId: string; name: string; rowId: string };

/**
 * The matrix a plan editor renders: one row per tray, seven columns of slots.
 *
 * Pure, so the shape is testable without a database — and it is the piece most
 * likely to go wrong by one, since a weekday off by one silently shifts a whole
 * shop's menu by a day.
 */
export function buildMatrix(
  trays: { id: string; tray_number: string; band: string | null; sort: number | null }[],
  slots: { id: string; tray_id: string; weekday: number; item_id: string }[],
  itemNames: Map<string, string>
): {
  tray: { id: string; tray_number: string; band: string | null };
  days: TraySlot[][];
}[] {
  const byTray = new Map<string, typeof slots>();
  for (const s of slots) {
    const list = byTray.get(s.tray_id) ?? [];
    list.push(s);
    byTray.set(s.tray_id, list);
  }
  return trays
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.tray_number.localeCompare(b.tray_number))
    .map((tray) => ({
      tray: { id: tray.id, tray_number: tray.tray_number, band: tray.band },
      days: WEEKDAYS.map((d) =>
        (byTray.get(tray.id) ?? [])
          .filter((s) => s.weekday === d.iso)
          .map((s) => ({
            itemId: s.item_id,
            rowId: s.id,
            name: itemNames.get(s.item_id) ?? "—",
          }))
      ),
    }));
}
