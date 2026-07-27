// URL-persisted filter + sort state for /vendors, mirroring lib/itemFilters.ts.
// Same reasoning: these describe the view, so they belong in the URL where they
// survive a trip into vendor detail and can be bookmarked. Column widths are a
// display preference and live in localStorage instead.

import type { RawSearchParams } from "./itemFilters";
import type { SortDir } from "./tableSort";
import { withFrom } from "./breadcrumbs";

export type ActiveFilter = "active" | "inactive" | "all";

export const VENDOR_SORT_KEYS = [
  "name",
  "type",
  "order_type",
  "account",
  "minimum",
  "order_days",
  "delivery_days",
  "active",
] as const;
export type VendorSortKey = (typeof VENDOR_SORT_KEYS)[number];

export type VendorFilters = {
  q: string;
  type: string;
  active: ActiveFilter;
  sort: VendorSortKey;
  dir: SortDir;
};

export const DEFAULT_VENDOR_FILTERS: VendorFilters = {
  q: "",
  type: "",
  active: "active",
  sort: "name",
  dir: "asc",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseVendorFilters(params: RawSearchParams): VendorFilters {
  const active = one(params.active);
  const sort = one(params.sort);
  const dir = one(params.dir);
  return {
    q: one(params.q),
    type: one(params.type),
    active:
      active === "inactive" || active === "all" || active === "active"
        ? active
        : DEFAULT_VENDOR_FILTERS.active,
    sort: (VENDOR_SORT_KEYS as readonly string[]).includes(sort)
      ? (sort as VendorSortKey)
      : DEFAULT_VENDOR_FILTERS.sort,
    dir: dir === "desc" ? "desc" : DEFAULT_VENDOR_FILTERS.dir,
  };
}

export function vendorFiltersToQuery(filters: VendorFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.type) params.set("type", filters.type);
  if (filters.active !== DEFAULT_VENDOR_FILTERS.active) params.set("active", filters.active);
  if (filters.sort !== DEFAULT_VENDOR_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.dir !== DEFAULT_VENDOR_FILTERS.dir) params.set("dir", filters.dir);
  return params.toString();
}

export function vendorsHref(filters: VendorFilters): string {
  const query = vendorFiltersToQuery(filters);
  return query ? `/vendors?${query}` : "/vendors";
}

/**
 * Vendor detail records the filtered list as its breadcrumb, so the trail leads
 * back to the exact view you left rather than to a reset list.
 */
export function vendorDetailHref(id: string, filters: VendorFilters): string {
  return withFrom(`/vendors/${id}`, { href: vendorsHref(filters), label: "Vendors" });
}
