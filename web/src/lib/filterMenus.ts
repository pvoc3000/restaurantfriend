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

import type { SortDir } from "./tableSort";

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
  /**
   * THE RESTING VALUE — what this dimension says when the URL says nothing, and
   * the value that therefore writes no parameter.
   *
   * `FILTER_ALL` for a menu, which is the default and the whole story for the
   * bar. It exists for the lists whose resting state is a real filter: recipes
   * and plans open on ACTIVE, as the catalog lists always have, so "the plain
   * `/recipes` shows every recipe" would be a change of behaviour rather than a
   * change of address. With a default, "clear" means back to REST rather than
   * back to everything — see `clearedFilters` — and `activeFilterCount` counts
   * a dimension only when it has moved off it, so a list does not open reading
   * "Clear 1 filter".
   *
   * A dimension with a default needs a real token for "no filter" (recipes
   * writes `?tier=all`): an empty value cannot be written to a query string, so
   * `FILTER_ALL` and "absent" would be the same URL and the default would win.
   */
  defaultValue?: string;
};

/** What this dimension says when nothing has been chosen. */
export function dimensionDefault<T>(dimension: FilterDimension<T>): string {
  return dimension.defaultValue ?? FILTER_ALL;
}

export type FilterValues = Record<string, string>;

/** One dimension's verdict on one row. Unset always passes. */
export function matchesDimension<T>(
  dimension: FilterDimension<T>,
  row: T,
  values: FilterValues
): boolean {
  const chosen = values[dimension.key] ?? dimensionDefault(dimension);
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
  // Off its RESTING value, not off "All" — see `defaultValue`. Identical for
  // every menu, which rests at "All".
  return dimensions.filter(
    (d) => (values[d.key] ?? dimensionDefault(d)) !== dimensionDefault(d)
  ).length;
}

/** Every dimension back to rest. Values for unknown keys are dropped. */
export function clearedFilters<T>(dimensions: FilterDimension<T>[]): FilterValues {
  return Object.fromEntries(dimensions.map((d) => [d.key, dimensionDefault(d)]));
}

/* -------------------------------------------------------------------------
 * THE URL
 *
 * Filters describe the VIEW, so they belong in the query string — the app's
 * standing rule, and one that earns its keep far more here than it did with a
 * single tab row: four combining menus make a view worth sending to someone,
 * and worth getting back when you return from an element's own screen.
 *
 * Written with `history.replaceState`, never `router.replace`: everything the
 * menus do is client-side over rows the server already sent, and a replace
 * would re-run the server component — a full refetch and a fresh cost graph —
 * on every keystroke and every pick. That is `ItemsList`'s reasoning and this
 * follows it exactly.
 * ------------------------------------------------------------------------- */

/** Next hands searchParams over as string | string[] | undefined per key. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** The search box's parameter. `q` because that is what /items already uses. */
export const SEARCH_PARAM = "q";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseFilterSearch(params: RawSearchParams): string {
  return one(params[SEARCH_PARAM]);
}

/**
 * Read the declared dimensions out of a URL, KEEPING ONLY REAL OPTION VALUES.
 *
 * A value that no option offers is dropped rather than obeyed — `?kind=cheese`
 * would otherwise filter to nothing while the menu, which shows a stored value
 * even when it isn't on its list, sat there reading "cheese". An empty list
 * under a menu naming something that does not exist is a worse answer to a
 * mistyped link than simply not filtering.
 *
 * Validating here rather than on the server is deliberate: a dimension's
 * options can depend on the data (the element schedules are whatever the column
 * holds), and its `matches` is a closure, so the only place that knows the real
 * vocabulary is the component holding it.
 */
export function parseFilterValues<T>(
  dimensions: FilterDimension<T>[],
  params: RawSearchParams
): FilterValues {
  const values: FilterValues = {};
  for (const dimension of dimensions) {
    const raw = one(params[dimension.key]);
    if (raw && dimension.options.some((o) => o.value === raw)) values[dimension.key] = raw;
    // A dimension that rests somewhere other than "All" states its resting
    // value, so a caller can drive a control from this record alone. One that
    // rests at "All" stays ABSENT, which is what every existing caller and
    // fixture expects of an empty query.
    else if (dimensionDefault(dimension) !== FILTER_ALL)
      values[dimension.key] = dimensionDefault(dimension);
  }
  return values;
}

/* -------------------------------------------------------------------------
 * THE SORT
 *
 * It rides in the URL beside the filters, because it is the same kind of fact:
 * the sort IS part of the view, which is why `/items` and the PO list have
 * always kept theirs there. The two menu-driven lists left it to `DataTable`'s
 * own local state, so it was forgotten on every return trip (Mark, 2026-08-14:
 * "the chosen column to sort by also isn't restored").
 *
 * Owning it costs the caller a comparator (`lib/tableSort`'s `sortRows`) and
 * buys a second fix: the found set is published in the order the table is
 * actually showing, so the record book on a detail screen stops calling the
 * FIRST row "67 of 190".
 * ------------------------------------------------------------------------- */

export const SORT_PARAM = "sort";
export const DIR_PARAM = "dir";

export type ListSort = { key: string; dir: SortDir };

/**
 * The sort a URL is asking for, or null for the list's natural order.
 *
 * `keys` is the set of columns that can be sorted, so `?sort=cheese` is dropped
 * rather than leaving the header arrow pointing at a column that isn't there —
 * `parseFilterValues`' rule, for the same reason.
 */
export function parseListSort(
  params: RawSearchParams,
  keys: readonly string[]
): ListSort | null {
  const key = one(params[SORT_PARAM]);
  if (!key || !keys.includes(key)) return null;
  const dir = one(params[DIR_PARAM]);
  return { key, dir: dir === "desc" ? "desc" : "asc" };
}

/**
 * The query string for a view: the search term, any menu that is saying
 * something, and the sort. A menu on "All" writes NO parameter, so the
 * unfiltered list keeps one canonical address — the same rule the recipe tabs
 * follow, and the reason a null sort writes nothing either.
 *
 * A dimension keyed `sort` or `dir` would collide with the sort's own
 * parameters. None does, and the two names are declared above so a new one
 * can be checked against them.
 */
export function filterQuery<T>(
  dimensions: FilterDimension<T>[],
  values: FilterValues,
  search = "",
  sort: ListSort | null = null
): string {
  const params = new URLSearchParams();
  if (search.trim()) params.set(SEARCH_PARAM, search.trim());
  for (const dimension of dimensions) {
    const chosen = values[dimension.key] ?? dimensionDefault(dimension);
    // The RESTING value writes nothing, so the plain list keeps one address.
    if (chosen !== dimensionDefault(dimension)) params.set(dimension.key, chosen);
  }
  if (sort) {
    params.set(SORT_PARAM, sort.key);
    params.set(DIR_PARAM, sort.dir);
  }
  return params.toString();
}

/**
 * THE QUERY THE BROWSER IS ACTUALLY SHOWING — or null when it can't be trusted.
 *
 * `history.replaceState` moves the address bar and tells Next's router its new
 * canonical URL, but it does NOT rewrite the RSC payload cached against that
 * history entry: that tree was rendered for the URL the entry was CREATED with.
 * Back and forward restore the cached tree, so a list seeded purely from its
 * server props comes back with the filters it had when you first arrived, while
 * the address bar reads the ones you set (Mark, 2026-08-14 — "the production
 * item page doesn't seem to be remembering filter settings when I return").
 * Reproduced: arrive at a bare `/production-items`, pick Type = Raised, open an
 * item, press Back — URL `?type=Raised`, screen "307 items", every menu on All.
 *
 * Every list writing filters with `replaceState` has it; it is not a bug in any
 * one screen, which is why the cure lives here. The URL is the view's one true
 * statement, so a list reads it directly at mount rather than trusting a prop
 * that may have been rendered for a different query.
 *
 * THE PATH GUARD IS LOAD-BEARING, not defensive tidying. Next applies a Link
 * navigation's `pushState` in an effect AFTER the incoming tree renders, so
 * during a breadcrumb's first render `window.location` is still the DETAIL
 * screen's URL — reading it there would parse `?from=…&fromLabel=…`, find no
 * filter keys, and clear the very filters the breadcrumb exists to restore.
 * A restore is the opposite: the browser updates the URL before it fires
 * `popstate`, so by the time the tree renders the address bar is already right.
 * Matching the path is what tells the two apart. Falling back to the prop is
 * always safe — it is exactly today's behaviour.
 */
export function urlFilterParams(path: string): RawSearchParams | null {
  if (typeof window === "undefined") return null;
  if (window.location.pathname !== path) return null;
  const params: RawSearchParams = {};
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

/** That query on a path: `/elements?kind=made&schedule=WEEKLY`. */
export function filterHref<T>(
  path: string,
  dimensions: FilterDimension<T>[],
  values: FilterValues,
  search = "",
  sort: ListSort | null = null
): string {
  const query = filterQuery(dimensions, values, search, sort);
  return query ? `${path}?${query}` : path;
}
