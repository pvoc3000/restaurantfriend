// Where a location record lives, and how you get back to the list.
//
// One function, because the same string has to feed BOTH the row's link and the
// found set the list publishes for the record book — if those two ever disagree
// the book walks you somewhere the list wasn't pointing (the `vendorDetailHref`
// rule, lib/vendorFilters.ts).
//
// Unlike its siblings it takes no filters: the Locations list keeps its search
// and sort in local state rather than the URL, so there is nothing about the
// view to carry back and the crumb is a constant.

import { withFrom, type Crumb } from "./breadcrumbs";

export const LOCATIONS_CRUMB: Crumb = { href: "/locations", label: "Locations" };

export function locationDetailHref(id: string): string {
  return withFrom(`/locations/${id}`, LOCATIONS_CRUMB);
}

/* -- the location record's own sections ------------------------------------ */

/**
 * The location record is three screens (Mark, 2026-09-12: "Info — everything
 * above the addresses. Addresses — the shipping and billing addresses.
 * Operations — everything below the addresses").
 *
 * Info — what the shop IS (active, code, public name, kind) and the four counts
 * that say how much of the business is at it; Addresses — the two of them, side
 * by side as they already were; Operations — how it RUNS: opening hours, the
 * tax and labour rates and the register count, and which tier its purchase
 * orders are emailed through.
 *
 * `ui/SectionNav` is the control and `lib/productionItems` is the sibling this
 * mirrors line for line; the pattern is under "A detail screen that outgrows
 * one page" in CLAUDE.md. The tab rides in the URL under the key `tab`, which
 * is what lets the record book keep it when paging (`RecordNav` carries `tab`
 * by default), and `info` writes no parameter so `locationDetailHref` above
 * stays the record's one canonical address.
 */
export type LocationTab = "info" | "addresses" | "operations";

export const LOCATION_TABS: LocationTab[] = ["info", "addresses", "operations"];

export const LOCATION_TAB_LABEL: Record<LocationTab, string> = {
  info: "Info",
  addresses: "Addresses",
  operations: "Operations",
};

/** Anything unrecognised shows the record rather than an error. */
export function parseLocationTab(raw: string | string[] | undefined): LocationTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (LOCATION_TABS as string[]).includes(value ?? "")
    ? (value as LocationTab)
    : "info";
}

/** A link to one tab of the location you are on, carrying the current params
 *  (the breadcrumb trail above all) through. */
export function locationTabHref(
  id: string,
  tab: LocationTab,
  params: Record<string, string | string[] | undefined> = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab") continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  if (tab !== "info") search.set("tab", tab);
  const query = search.toString();
  return `/locations/${id}${query ? `?${query}` : ""}`;
}
