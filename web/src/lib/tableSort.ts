// Shared sort semantics for the list screens, so Inventory and Vendors order
// rows the same way rather than each inventing its own rules.

export type SortDir = "asc" | "desc";

/** What a column sorts on. null = the cell is empty. */
export type SortValue = string | number | null;

export function nextSortDir(active: boolean, current: SortDir): SortDir {
  // Clicking a new column starts ascending; clicking the active one flips.
  return active ? (current === "asc" ? "desc" : "asc") : "asc";
}

/**
 * Empty cells sink to the bottom in BOTH directions — flipping the sort to find
 * the largest value shouldn't fill the top with rows that have no value at all.
 * `tiebreaks` run in order when the primary values are equal, and are only used
 * to break ties, never to override the chosen column.
 *
 * **A TIEBREAK ALWAYS READS ASCENDING, whichever way the primary points.** It
 * used to take the primary's sign, which meant "Ordered newest first, then
 * vendor" listed each day's vendors Z→A — not what "then vendor" means to
 * anyone (Mark, 2026-08-03, asking for vendor as the secondary sort on the PO
 * list). Flipping a column reverses the ORDER YOU CHOSE, not the stable
 * fallback used where that column can't decide.
 *
 * The function already agreed with this in one branch and not the other: two
 * null primaries have always returned the tiebreak unsigned, four lines below.
 * That inconsistency is the tell that the sign was a slip rather than a
 * decision. Every caller passes a name or a code — vendors, employees,
 * locations, items, PO lines — and none of them wants it reversed.
 */
export function makeComparator<T>({
  value,
  dir,
  tiebreaks = [],
}: {
  value: (row: T) => SortValue;
  dir: SortDir;
  tiebreaks?: ((row: T) => string)[];
}) {
  const sign = dir === "asc" ? 1 : -1;

  return (a: T, b: T): number => {
    const va = value(a);
    const vb = value(b);

    const tieBreak = () => {
      for (const key of tiebreaks) {
        const c = key(a).localeCompare(key(b));
        if (c !== 0) return c;
      }
      return 0;
    };

    if (va === null && vb === null) return tieBreak();
    if (va === null) return 1;
    if (vb === null) return -1;

    const primary =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true });

    // The sign is the PRIMARY's alone — see the note above.
    return primary === 0 ? tieBreak() : primary * sign;
  };
}

/**
 * A table's ROWS IN THE ORDER IT SHOWS THEM — the one implementation, used by
 * `DataTable` when it sorts itself and by every list that owns its own sort.
 *
 * IT EXISTS BECAUSE THE ORDER IS ALSO THE FOUND SET. `lib/recordSet`'s contract
 * is that a list publishes what it is showing "in the order it is showing it",
 * and a list that leaves sorting to `DataTable` cannot honour that — it holds
 * the filtered rows in whatever order the server sent them and has no idea what
 * the reader last clicked. Mark, 2026-08-14: sort `/production-items` by Item,
 * open the first row, and the record book calls Angry Samoa "67 of 190".
 *
 * Typed structurally rather than against `DataColumn` so it can live here and
 * be fixture-tested; a `DataColumn<T>` satisfies it as it stands. A null sort,
 * an unknown key or a column with nothing to sort on all return `rows`
 * UNCHANGED and never a copy, which is what keeps it cheap to call on every
 * render of a 790-row list.
 */
export type SortableColumn<T> = {
  key: string;
  sortValue?: (row: T) => SortValue;
  sortTiebreaks?: ((row: T) => string)[];
};

export function sortRows<T>(
  rows: T[],
  columns: SortableColumn<T>[],
  sort: { key: string; dir: SortDir } | null | undefined
): T[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column?.sortValue) return rows;
  const value = column.sortValue;
  return [...rows].sort(
    makeComparator<T>({ value, dir: sort.dir, tiebreaks: column.sortTiebreaks })
  );
}

/**
 * WHICH GROUPING A TABLE IS BANDING BY, given what it is sorted by.
 *
 * A band can only band what the ORDER already groups, so a grouping declares
 * the column it belongs to and appears only while that column is the sort.
 * Passing an ARRAY declares one grouping per column, which is what lets a list
 * band by whatever you are sorting by — Type when sorted by Type, Cut when
 * sorted by Cut, and nothing at all when sorted by name (Mark, 2026-08-13:
 * "when sorting by item name there's no need to group the list by type").
 *
 * Generic over `{ sortKey?: string }` rather than typed to `DataGroup` on
 * purpose: this is the rule, not the payload, and keeping it ignorant of the
 * component's own type is what lets it live in `lib` and be fixture-tested at
 * all.
 */
export function activeGrouping<G extends { sortKey?: string }>(
  group: G | G[] | undefined | null,
  sortKey: string | undefined
): G | null {
  const applies = (g: G) => !g.sortKey || g.sortKey === sortKey;
  if (Array.isArray(group)) return group.find(applies) ?? null;
  // A LONE grouping with no `sortKey` bands unconditionally — the original
  // contract, and what a table with only one sensible grouping wants.
  return group && applies(group) ? group : null;
}
