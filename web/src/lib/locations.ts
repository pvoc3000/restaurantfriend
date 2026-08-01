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
