/**
 * COMBINING FILTERS — the brain behind `ui/FilterMenus` (Mark, 2026-08-09:
 * "we need to be able to perform more complex searching… a row of popup menus
 * to combine filter options", and "if successful, this will be used across the
 * app").
 *
 * The app's existing filter idiom is a `TabPicker`: one row of cells, one
 * dimension, every option on screen. It is the right control while a list has
 * ONE question to ask of it, and it stops working the moment there are three —
 * five cells become fifteen, they wrap, and the row still can't express
 * "uncosted AND on the weekly bake", because a `TabPicker` holds one answer.
 *
 * So a dimension becomes a menu, and this module is what lets several of them
 * cooperate. Nothing here renders; it is pure, which is what lets the counts be
 * fixture-tested rather than eyeballed.
 *
 * The one idea worth stating: a dimension declares HOW TO TEST a row
 * (`matches`), never a pre-filtered list. That is what makes the conditioned
 * counts below possible at all, and what keeps the control from needing to know
 * anything about elements, employees or purchase orders.
 */

/**
 * "No opinion" — this dimension isn't filtering. The empty string rather than
 * "all" so it matches what `PickList` already treats as the unset option (the
 * inventory list's "All categories" has had value "" since the native selects
 * were retired), and so a caller can't accidentally collide with a real value
 * named "all".
 */
export const FILTER_ALL = "";

export type FilterOption = {
  value: string;
  label: string;
  /** Said quietly after the label. The bar fills this with a count. */
  hint?: string;
};

export type FilterDimension<T> = {
  /** Its slot in the values record. Stable — it may end up in a URL. */
  key: string;
  /** The label over the menu: "Schedule". */
  label: string;
  /** The options BESIDE "All", which the bar prepends itself. */
  options: FilterOption[];
  /**
   * Does this row satisfy this option? Only ever called with a real option
   * value — `FILTER_ALL` is answered by the bar, so no caller has to remember
   * to let it through.
   */
  matches: (row: T, value: string) => boolean;
  /** What the unset option reads as, when "All" isn't the natural word. */
  allLabel?: string;
};

export type FilterValues = Record<string, string>;

/** One dimension's verdict on one row. Unset always passes. */
export function matchesDimension<T>(
  dimension: FilterDimension<T>,
  row: T,
  values: FilterValues
): boolean {
  const chosen = values[dimension.key] ?? FILTER_ALL;
  return chosen === FILTER_ALL || dimension.matches(row, chosen);
}

/**
 * Every dimension has to pass — the menus are an AND, which is the whole point
 * of the change. A row of ORs would just be a longer TabPicker.
 */
export function applyListFilters<T>(
  rows: T[],
  dimensions: FilterDimension<T>[],
  values: FilterValues
): T[] {
  return rows.filter((row) => dimensions.every((d) => matchesDimension(d, row, values)));
}

/**
 * How many rows each option WOULD leave, given what the other menus already
 * say — `counts[dimensionKey][optionValue]`, with `FILTER_ALL` carrying the
 * total for that dimension unset.
 *
 * CONDITIONED ON THE OTHER DIMENSIONS AND NEVER ON ITS OWN, which is the one
 * thing here that is easy to get wrong and impossible to see once it is: count
 * a dimension against its own current value and every option in that menu reads
 * 0 except the one already chosen, which looks like data having vanished. The
 * honest question a menu answers is "if I picked this INSTEAD, what would I
 * get" — so the dimension being counted is left out of its own arithmetic.
 *
 * It matters most on the combination that motivated all this. Once you have
 * asked for the uncosted ones, the schedule menu should say how many of THOSE
 * are on the weekly bake, so an empty combination is visible before you choose
 * it rather than as a blank screen afterwards.
 *
 * O(rows × dimensions × options) — 470 elements over four menus is nine
 * thousand predicate calls, which is nothing, and doing it exactly beats
 * approximating it.
 */
export function filterCounts<T>(
  rows: T[],
  dimensions: FilterDimension<T>[],
  values: FilterValues
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const dimension of dimensions) {
    const others = dimensions.filter((d) => d.key !== dimension.key);
    const eligible = rows.filter((row) => others.every((d) => matchesDimension(d, row, values)));
    const forThis: Record<string, number> = { [FILTER_ALL]: eligible.length };
    for (const option of dimension.options) {
      forThis[option.value] = eligible.filter((row) =>
        dimension.matches(row, option.value)
      ).length;
    }
    counts[dimension.key] = forThis;
  }
  return counts;
}

/**
 * How many menus are actually saying something. Drives the Clear command — a
 * row of collapsed menus can hide a list without any one of them looking set,
 * which is the failure mode a popup menu has and a row of chips doesn't.
 */
export function activeFilterCount<T>(
  dimensions: FilterDimension<T>[],
  values: FilterValues
): number {
  return dimensions.filter((d) => (values[d.key] ?? FILTER_ALL) !== FILTER_ALL).length;
}

/** Every dimension back to "All". Values for unknown keys are dropped. */
export function clearedFilters<T>(dimensions: FilterDimension<T>[]): FilterValues {
  return Object.fromEntries(dimensions.map((d) => [d.key, FILTER_ALL]));
}
