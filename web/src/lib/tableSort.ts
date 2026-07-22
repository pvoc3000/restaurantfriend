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

    return (primary === 0 ? tieBreak() : primary) * sign;
  };
}
