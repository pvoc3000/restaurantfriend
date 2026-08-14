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
