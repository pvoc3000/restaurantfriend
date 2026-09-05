/* -- the vendor record's own sections -------------------------------------- */

/**
 * The vendor record is two screens, not one long page (Mark, 2026-08-17): Info
 * — what this vendor IS, plus the per-location config — and Items, the whole of
 * the Vendor items section.
 *
 * `ui/SectionNav` is the control, the same one `/employees/[id]` uses, which is
 * what Mark asked for when that shipped ("if we need tabs in any detail view in
 * the future, this is the way to do it, and we should reuse the code here so it
 * doesn't drift"). The pattern is written up under "A detail screen that
 * outgrows one page" in CLAUDE.md.
 *
 * IN THE URL, not in client state, because a tab is VIEW STATE — the same rule
 * that puts filters and sort in the query string. It makes a tab linkable, the
 * back button walks the two, and it is what lets the page fetch only the tab
 * being looked at: Info skips the vendor items entirely, and Items skips both
 * of the last-ordered round trips' reason for existing along with the type list
 * the Type picker offers.
 */
/**
 * FOUR SECTIONS SINCE 2026-09-05 (Mark: "add a 'Purchase Orders' and
 * 'Invoices' tabs to the Vendor detail page"). The two new ones are the
 * vendor's RECORDS — every order placed with them and every bill they sent,
 * across every shop — as a simplified reading of `/purchase-orders` and
 * `/invoices`: no filters, no selection bar, no commands, just the rows and
 * a link into each. Not the scanned documents; those live on the order.
 *
 * ORG-WIDE, NOT SCOPED TO THE WORKING SHOP, which is the one way these differ
 * from the lists they are simplified from. A vendor is an org-level record
 * whose Info tab already lists every shop's account number side by side, so
 * "what have we bought from these people" is answered the same way — with a
 * Shop column — rather than answered for DF01 and silently not for DF02.
 */
export type VendorTab = "info" | "items" | "purchase-orders" | "invoices";

export const VENDOR_TABS: VendorTab[] = ["info", "items", "purchase-orders", "invoices"];

export const VENDOR_TAB_LABEL: Record<VendorTab, string> = {
  info: "Info",
  items: "Items",
  "purchase-orders": "Purchase Orders",
  invoices: "Invoices",
};

/**
 * The tab a request is asking for. Anything unrecognised — a stale bookmark, a
 * typo, a missing parameter — falls back to `info` rather than throwing or
 * rendering an empty shell: a bad tab should show you the record, not an error.
 */
export function parseVendorTab(raw: string | string[] | undefined): VendorTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (VENDOR_TABS as string[]).includes(value ?? "") ? (value as VendorTab) : "info";
}

/**
 * A link to one tab of the vendor you are already on.
 *
 * It carries the CURRENT params through — `from` and `fromLabel` above all, or
 * moving between tabs would quietly strip the breadcrumb trail that led here and
 * the record book would lose its found set.
 *
 * `info` writes no parameter at all, so the default tab's URL is the plain
 * record address. That keeps every link already stored elsewhere — the list's
 * rows, the found set, the order guide's vendor links, a pasted URL — pointing
 * at something canonical instead of at `?tab=info`.
 */
export function vendorTabHref(
  id: string,
  tab: VendorTab,
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
  return `/vendors/${id}${query ? `?${query}` : ""}`;
}
