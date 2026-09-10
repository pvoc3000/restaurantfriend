// THE TABLET LANDING PAGE'S TILES, AND THE BAR'S TWO QUESTIONS — where Back
// goes, and what the screen is called (Mark, 2026-09-09).
//
// Pure, fixture-tested. The tiles are Mark's own list, in his groups and his
// words; the hrefs are the desk routes, because the tablet shell reuses every
// screen. Which tiles a role SEES is `lib/pageAccess` applied to the href —
// the same table the desk menu reads — so a supervisor who may not open
// /purchase-orders is not shown a door to it.

import { parseTrail } from "../breadcrumbs";
import type { RawSearchParams } from "../filterMenus";
import { SECTIONS, findSection, findSub, resolveRoute } from "../nav";
import { canReachPage } from "../pageAccess";
import type { Role } from "../roles";
import { TABLET_HOME } from "../shell";

export type TileKey =
  | "shift_report"
  | "documents"
  | "tags"
  | "checklist"
  | "tasks"
  | "plan"
  | "schedules"
  | "recipes"
  | "batch_logs"
  | "vendors"
  | "order_guide"
  | "purchase_orders"
  | "special_orders";

export type Tile = { key: TileKey; label: string; href: string };
export type TileGroup = { label: string; tiles: Tile[] };

export const LANDING_GROUPS: readonly TileGroup[] = [
  {
    label: "Shift",
    tiles: [
      { key: "shift_report", label: "Start or Resume a Shift Report", href: "/shift-reports" },
      { key: "documents", label: "Print a Document", href: "/documents" },
      { key: "tags", label: "Print some Tags", href: "/tags" },
    ],
  },
  {
    label: "Facilities",
    tiles: [
      { key: "checklist", label: "Start or Resume a Check List", href: "/checklists" },
      { key: "tasks", label: "Complete a Task", href: "/tasks" },
    ],
  },
  {
    label: "Production",
    tiles: [
      { key: "plan", label: "View the Current Plan", href: "/plans?tier=current" },
      { key: "schedules", label: "Generate or Print Schedules", href: "/schedules" },
      { key: "recipes", label: "View a Recipe", href: "/recipes" },
      { key: "batch_logs", label: "Generate Batch Logs", href: "/batch-logs" },
    ],
  },
  {
    label: "Purchasing",
    tiles: [
      { key: "vendors", label: "View the Vendor List", href: "/vendors" },
      { key: "order_guide", label: "Run the Order Guide", href: "/order-guide" },
      { key: "purchase_orders", label: "View Purchase Orders", href: "/purchase-orders" },
    ],
  },
  {
    label: "Special Orders",
    tiles: [{ key: "special_orders", label: "View Special Orders", href: "/special-orders" }],
  },
];

/** The href's PATH — `/plans?tier=current` is governed by `/plans`'s row. */
function pathOf(href: string): string {
  return href.split("?")[0];
}

/**
 * The groups a role sees, with every tile it may not open removed and any
 * group left empty removed with it — a heading over nothing is a claim that
 * something is missing.
 */
export function tilesForRole(role: Role): TileGroup[] {
  return LANDING_GROUPS.map((group) => ({
    label: group.label,
    tiles: group.tiles.filter((t) => canReachPage(role, pathOf(t.href))),
  })).filter((group) => group.tiles.length > 0);
}

/**
 * Where the bar's Back goes, or null when there is nowhere back to be — the
 * landing page itself.
 *
 * DETERMINISTIC, NEVER `history.back()`: a shared iPad's history is whatever
 * the last person left in it. Three answers, in order:
 *   1. the breadcrumb trail — `?from=` records the route actually taken, so
 *      a record reached through a vendor goes back to that vendor;
 *   2. a detail route with no trail (a pasted or remembered URL) goes to its
 *      own list, which `resolveRoute` knows;
 *   3. everything else — a list, /account — goes home.
 */
export function tabletBackHref(pathname: string, params: RawSearchParams): string | null {
  if (pathname === TABLET_HOME) return null;

  const trail = parseTrail(params, { href: "", label: "" });
  const last = trail[trail.length - 1];
  if (last && last.href !== "") return last.href;

  const position = resolveRoute(pathname);
  if (position) {
    const section = findSection(position.sectionSlug);
    const sub = section && findSub(section, position.subSlug);
    if (sub && sub.href !== pathname) return sub.href;
  }

  return TABLET_HOME;
}

/**
 * What the bar calls the screen — the menu's own label for the sub-section,
 * which is a detail route's list name too (/vendors/9 is still Vendors). The
 * two utilities the menu never names are named here.
 */
export function tabletTitle(pathname: string): string {
  if (pathname === TABLET_HOME) return "Home";
  if (pathname === "/account" || pathname.startsWith("/account/")) return "Your settings";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "Settings";
  const position = resolveRoute(pathname);
  if (!position) return "";
  const section = SECTIONS.find((s) => s.slug === position.sectionSlug);
  const sub = section && findSub(section, position.subSlug);
  return sub?.label ?? section?.label ?? "";
}
