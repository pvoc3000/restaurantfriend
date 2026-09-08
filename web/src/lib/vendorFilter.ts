// Filtering a purchasing list to one vendor or several — the order guide, the
// PO list and the invoice list (Mark, 2026-09-08: "a picklist of vendors … so
// that we can easily filter by vendor? selecting multiple options should be
// allowed").
//
// AN EMPTY SET MEANS EVERY VENDOR, which is `ui/PickSet`'s own rule and
// `lib/filterMenus`' `FILTER_ALL` in a plural form. Unticking the last vendor
// therefore widens the view rather than emptying the screen.
//
// IT FILTERS BY NAME, NOT BY ID, which is `/sales` picking its shops by CODE
// and for the same two reasons. A name IS its own label, so a vendor you have
// chosen can still be named — and unticked — on a day when the window holds
// none of its rows; an id would leave the trigger reading a uuid, or force the
// selection to be dropped, which silently widens the view at the moment you
// narrow the window. And it keeps the URL legible and the session cookies
// small, where a list of uuids costs 37 bytes each against a 4KB budget the
// guide already shares with its search term.
//
// The cost is real and small, and both halves fail by showing MORE rather than
// fewer rows: two vendors sharing a name filter as one (there is no unique
// index on `vendors.name` — 038's reasoning, "two entries for one supplier is
// a real thing a shop does"), and a rename drops out of a selection made
// before it.

/** One option in the picker: the vendor's name, and how many rows it has. */
export type VendorFilterOption = { value: string; label: string; hint: string };

/**
 * Names, as the URL and the session cookies carry them: REPEATED params
 * (`?vendor=BakeMark&vendor=Chefs+Warehouse`) rather than one comma-separated
 * value, so a vendor whose name contains the separator needs no escaping
 * scheme — "Smith, Jones & Co" is a name somebody will eventually type.
 */
export const VENDOR_FILTER_PARAM = "vendor";

/**
 * A fence against a cookie, not a working limit. A browser drops an oversized
 * cookie WHOLE, so an absurd selection would take the guide's filters and
 * search term down with it rather than merely truncating itself. Nothing you
 * would actually choose comes close — and past a handful, "all vendors" is the
 * same view with less typing.
 */
export const MAX_VENDOR_FILTER = 25;

/** Deduped, blanks dropped, capped. Tolerant of anything a stale cookie holds. */
export function parseVendorFilter(raw: string | string[] | undefined | null): string[] {
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const value of list) {
    const name = (value ?? "").trim();
    if (!name || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_VENDOR_FILTER) break;
  }
  return out;
}

/** Appends the chosen names to a query or cookie being built. */
export function appendVendorFilter(
  params: URLSearchParams,
  names: readonly string[]
): void {
  for (const name of parseVendorFilter([...names])) {
    params.append(VENDOR_FILTER_PARAM, name);
  }
}

/**
 * Does this row survive the filter?
 *
 * A row with NO vendor is excluded whenever a filter is on — you asked for
 * these vendors, and "no vendor" is not one of them — and included when it is
 * off, which is what an empty set means.
 */
export function matchesVendorFilter(
  name: string | null | undefined,
  selected: readonly string[]
): boolean {
  if (selected.length === 0) return true;
  return name !== null && name !== undefined && selected.includes(name);
}

/**
 * The picker's options: every vendor among the rows IN SCOPE, with its row
 * count, plus any vendor already chosen that this view has none of.
 *
 * COUNTED OVER ROWS THAT HAVE PASSED EVERY OTHER FILTER BUT THIS ONE, which is
 * `lib/filterMenus`' rule — conditioned on the other controls and never on
 * itself, or every vendor but the chosen one would read 0.
 *
 * A CHOSEN VENDOR IS ALWAYS LISTED, at 0, even when the window holds none of
 * its rows. Dropping it would take the selection off the screen while it was
 * still narrowing the list — the reader would see an empty table and no
 * control saying why, with no way to untick what caused it.
 */
export function vendorFilterOptions(
  names: readonly (string | null | undefined)[],
  selected: readonly string[]
): VendorFilterOption[] {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const name of selected) if (!counts.has(name)) counts.set(name, 0);

  return [...counts.entries()]
    .map(([name, count]) => ({
      value: name,
      label: name,
      hint: String(count),
    }))
    // Numeric-aware, matching `lib/tableSort` so the whole app orders text the
    // same way — a vendor list holds "3M" and "7-Eleven".
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
