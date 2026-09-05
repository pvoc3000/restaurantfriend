/* -- the inventory item record's own sections ------------------------------- */

/**
 * The item record is three screens (Mark, 2026-09-05: "add 3 tabs to the
 * inventory item detail page: 'Info', 'Vendor Items' and 'Purchase History'").
 * Info — what the item IS plus its per-location config; Vendor Items — every
 * source it can be bought as; Purchase History — every purchase order line of
 * it that was actually RECEIVED, across every shop.
 *
 * `ui/SectionNav` is the control and `lib/vendors` is the sibling this mirrors
 * line for line; the pattern is under "A detail screen that outgrows one page"
 * in CLAUDE.md. The tab rides in the URL under the key `tab`, which is what
 * lets the record book keep it when paging (`RecordNav` carries `tab` by
 * default), and `info` writes no parameter so the plain record address stays
 * canonical for every link already stored.
 */
export type ItemTab = "info" | "vendor-items" | "purchase-history";

/**
 * Cap on the Purchase History fetch — `/purchase-orders`' own 500.
 *
 * IN THIS MODULE AND NOT IN THE COMPONENT, and that placement is a bug fix:
 * it shipped as an export of the `"use client"` table, imported into the
 * server component, and Next turns EVERY export of a client module into a
 * client reference on the server — so `.slice(0, ITEM_PURCHASE_CAP)` was
 * `.slice(0, <object>)` and the tab read "0" over 103 real rows. A constant a
 * server component reads lives in `lib/`, never beside a component.
 */
export const ITEM_PURCHASE_CAP = 500;

export const ITEM_TABS: ItemTab[] = ["info", "vendor-items", "purchase-history"];

export const ITEM_TAB_LABEL: Record<ItemTab, string> = {
  info: "Info",
  "vendor-items": "Vendor Items",
  "purchase-history": "Purchase History",
};

/** Anything unrecognised shows the record rather than an error. */
export function parseItemTab(raw: string | string[] | undefined): ItemTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ITEM_TABS as string[]).includes(value ?? "") ? (value as ItemTab) : "info";
}

/** A link to one tab of the item you are on, carrying the current params (the
 *  breadcrumb trail above all) through. */
export function itemTabHref(
  id: string,
  tab: ItemTab,
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
  return `/items/${id}${query ? `?${query}` : ""}`;
}
