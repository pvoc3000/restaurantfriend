/* -- the production item record's own sections ------------------------------ */

/**
 * The production item record is three screens (Mark, 2026-09-12: "let's make
 * three tabs on the items detail page. Info — upper two columns and default
 * pars area. Costs — includes the costs area. History — includes the 'last two
 * weeks' area").
 *
 * Info — what the item IS (the fields' two label/value columns) plus the par
 * each shop starts a plan slot at; Costs — the breakdown, one row per
 * contributor, which is the part FileMaker never had; History — the fortnight
 * of what was actually made and sold.
 *
 * `ui/SectionNav` is the control and `lib/inventoryItems` is the sibling this
 * mirrors line for line; the pattern is under "A detail screen that outgrows
 * one page" in CLAUDE.md. The tab rides in the URL under the key `tab`, which
 * is what lets the record book keep it when paging (`RecordNav` carries `tab`
 * by default), and `info` writes no parameter so the plain record address
 * stays canonical for every link already stored.
 */
export type ProductionItemTab = "info" | "costs" | "history";

export const PRODUCTION_ITEM_TABS: ProductionItemTab[] = ["info", "costs", "history"];

export const PRODUCTION_ITEM_TAB_LABEL: Record<ProductionItemTab, string> = {
  info: "Info",
  costs: "Costs",
  history: "History",
};

/** Anything unrecognised shows the record rather than an error. */
export function parseProductionItemTab(
  raw: string | string[] | undefined
): ProductionItemTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PRODUCTION_ITEM_TABS as string[]).includes(value ?? "")
    ? (value as ProductionItemTab)
    : "info";
}

/** A link to one tab of the item you are on, carrying the current params (the
 *  breadcrumb trail above all) through. */
export function productionItemTabHref(
  id: string,
  tab: ProductionItemTab,
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
  return `/production-items/${id}${query ? `?${query}` : ""}`;
}
