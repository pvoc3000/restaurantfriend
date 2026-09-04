// WHO MAY OPEN WHICH SCREEN, AND WHETHER THEY MAY CHANGE ANYTHING ON IT.
//
// This is Mark's "Page Permissions" spreadsheet (docs/Page Permissions.xlsx,
// 2026-09-04) as code, one row per screen, one column per role, so that
// changing who sees what is an edit to THIS FILE and a deploy — never a
// migration. Read it the way the sheet reads:
//
//   staff · supervisor · purchaser · manager · owner
//
// A cell is one of four values:
//
//   W  "Y" on the sheet — the screen opens and its controls are offered.
//   R  "Read Only" — the screen opens with every write control hidden.
//   -  blank — HIDDEN: the menu omits it and a typed URL gets a sentence.
//   X  "Unreachable" — hidden exactly like "-", AND the database refuses the
//      rows. The letter is documentation: it records that the row's data is
//      the kind the sheet reserves for HR (a home address, what somebody was
//      paid), so a future loosening here is a migration and not an edit.
//
// TWO LAYERS, AND THIS FILE IS ONLY ONE OF THEM. Row-level security in
// Postgres is the gate; this table is what the SCREENS do. It can take access
// away from a role the database would still serve (a purchaser on /plans is
// "R" here while 039's write policy still admits them — the door is closed at
// the screen and not at the table, which Mark accepted for everything outside
// HR), and it can NEVER grant access the database refuses: an "R" or "W" cell
// on a table whose policy says no renders an empty list or a write that
// matches zero rows. Every loosening the sheet asked for was therefore ALSO a
// policy change — migration 092 — and the fixture that pins this table says
// which cells those are, so the next one is recognised as a migration too.
//
// A page-level cell is a CEILING, not the whole story. Some single acts on a
// "W" screen are stricter than the screen — approving an invoice, syncing
// sales, reopening a finished checklist, editing a master checklist — and
// those stay where they are, as named predicates in lib/roles. This file
// decides whether you can open the screen and whether it offers writes at all;
// a predicate decides one button.
//
// Routes are matched by PREFIX, longest wins, so a record route inherits its
// list's row without being listed (/plans/[id] is /plans). A route with no row
// at all is UNGOVERNED — /settings, /, the login pages — and passes; the
// fixture asserts every built menu entry has a row, so nothing reaches the
// menu ungoverned by accident.

import { ROLE_LABEL, type Role } from "./roles";

export type PageAccess = "none" | "unreachable" | "read" | "write";

type Cell = "-" | "X" | "R" | "W";

const CELL: Record<Cell, PageAccess> = {
  "-": "none",
  X: "unreachable",
  R: "read",
  W: "write",
};

/** The five roles in the sheet's own column order. */
export const ROLE_COLUMNS: Role[] = ["staff", "supervisor", "purchaser", "admin", "owner"];

/** One spreadsheet row: staff · supervisor · purchaser · manager · owner. */
function row(staff: Cell, supervisor: Cell, purchaser: Cell, admin: Cell, owner: Cell): Record<Role, PageAccess> {
  return {
    staff: CELL[staff],
    supervisor: CELL[supervisor],
    purchaser: CELL[purchaser],
    admin: CELL[admin],
    owner: CELL[owner],
  };
}

/**
 * The sheet. Keys are the menu's own hrefs (lib/nav), plus the record and
 * shim routes that light the same tab without sitting under it.
 *
 * Rows the sheet did not carry are marked; each keeps the rule the screen had
 * before this file existed, and is the obvious place to look when Mark adds
 * them to the sheet.
 */
export const PAGE_ACCESS: Record<string, Record<Role, PageAccess>> = {
  // ── Facilities ────────────────────────────────── staff  sup  purch  mgr  own
  "/locations":            row("-", "-", "-", "W", "W"),
  "/shop-sections":        row("-", "-", "-", "-", "W"),
  "/checklists":           row("-", "W", "W", "W", "W"),
  // The template RECORD and the retired list shim — nav's `also` for Checklists.
  "/checklist-templates":  row("-", "W", "W", "W", "W"),
  "/tasks":                row("-", "W", "W", "W", "W"),
  "/maintenance-requests": row("-", "W", "W", "W", "W"),
  // Not on the sheet. Supervisor+ was the menu's rule since it shipped; the
  // walk is 076's own policy.
  "/inspection-logs":      row("-", "W", "W", "W", "W"),
  // Not on the sheet. Read was open to everyone (075's policy) and the menu
  // showed it to all; staff are hidden here to match every other Facilities
  // row on the sheet, which is the one assumption in this file — one letter
  // to reverse.
  "/equipment":            row("-", "R", "W", "W", "W"),

  // ── HR ────────────────────────────────────────────────────────────────────
  // Purchaser is blank on the sheet, not X. The database is stricter than the
  // sheet here (020/035 gate READ at owner/admin), so a purchaser typing the
  // URL gets this file's sentence and would get an empty screen without it.
  "/employees":            row("X", "X", "-", "W", "W"),
  "/events":               row("X", "X", "-", "W", "W"),
  "/soon/hr/team-reviews": row("X", "X", "-", "W", "W"),
  // Not on the sheet. 028 is owner/admin on every verb, select included.
  "/timesheets":           row("X", "X", "X", "W", "W"),
  "/pay-periods":          row("X", "X", "X", "W", "W"),
  // Owner only — the manager cell is BLANK on the sheet. 033's write policy
  // still admits a manager; hidden, per Mark's rule for everything not HR.
  "/payroll-benefits":     row("X", "X", "-", "-", "W"),

  // ── Operations ────────────────────────────────────────────────────────────
  "/shift-reports":        row("-", "W", "W", "W", "W"),
  "/sales":                row("-", "R", "W", "W", "W"),
  "/soon/operations/documents": row("-", "W", "W", "W", "W"),
  "/soon/operations/policies":  row("-", "W", "W", "W", "W"),
  "/soon/operations/tags":      row("-", "R", "W", "W", "W"),
  "/price-grid":           row("-", "R", "W", "W", "W"),

  // ── Production ────────────────────────────────────────────────────────────
  "/plans":                row("-", "R", "R", "W", "W"),
  "/schedules":            row("R", "W", "W", "W", "W"),
  // The derived day is a sibling of the schedules screen (nav's `also`).
  "/production-day":       row("R", "W", "W", "W", "W"),
  "/production-items":     row("-", "R", "R", "W", "W"),
  "/elements":             row("-", "R", "R", "W", "W"),
  "/recipes":              row("R", "R", "R", "W", "W"),
  "/batch-logs":           row("W", "W", "W", "W", "W"),

  // ── Purchasing ────────────────────────────────────────────────────────────
  "/vendors":              row("R", "R", "W", "W", "W"),
  // A vendor item is reached from Vendors and from Inventory; it follows the
  // closer parent, as nav's `also` already says.
  "/vendor-items":         row("R", "R", "W", "W", "W"),
  "/items":                row("-", "R", "W", "W", "W"),
  "/purchase-requests":    row("R", "W", "W", "W", "W"),
  "/order-guide":          row("-", "W", "W", "W", "W"),
  "/purchase-orders":      row("-", "R", "W", "W", "W"),
  "/invoices":             row("-", "-", "R", "W", "W"),
  // Not on the sheet. A catalog-cleanup tool, so it follows the catalog's
  // own write rule.
  "/cleanup":              row("-", "-", "W", "W", "W"),

  // ── Special Orders ────────────────────────────────────────────────────────
  "/special-orders":       row("R", "W", "W", "W", "W"),
  "/customers":            row("R", "R", "R", "W", "W"),
};

/**
 * The cells that asked the DATABASE to loosen — every one a policy or a
 * function widened by migration 092. Listed so the fixture can pin that the
 * table and the migration name the same set, and so the next such cell is
 * recognised as the migration it is.
 */
export const LOOSENED_BY_092: { route: string; role: Role; access: PageAccess }[] = [
  { route: "/batch-logs", role: "staff", access: "write" },
  { route: "/schedules", role: "supervisor", access: "write" },
  { route: "/special-orders", role: "staff", access: "read" },
  { route: "/customers", role: "staff", access: "read" },
  { route: "/purchase-requests", role: "supervisor", access: "write" },
  { route: "/sales", role: "purchaser", access: "write" },
];

/** A path matches a key if it IS it or sits under it — /items must not match
 *  /items-archive. Same rule as nav's `under`. */
function under(pathname: string, key: string): boolean {
  return pathname === key || pathname.startsWith(`${key}/`);
}

/**
 * The row governing a pathname, or null for an UNGOVERNED route. Longest key
 * wins, so /production-day is never mistaken for /production-items and a
 * record route inherits its list's row.
 */
export function pageAccessRow(pathname: string): Record<Role, PageAccess> | null {
  let best: { key: string; row: Record<Role, PageAccess> } | null = null;
  for (const [key, row] of Object.entries(PAGE_ACCESS)) {
    if (under(pathname, key) && (!best || key.length > best.key.length)) {
      best = { key, row };
    }
  }
  return best?.row ?? null;
}

/** What this role may do on this screen, or null if the route is ungoverned. */
export function pageAccess(role: Role, pathname: string): PageAccess | null {
  const row = pageAccessRow(pathname);
  return row ? row[role] : null;
}

/** May this role OPEN the screen at all? An ungoverned route always opens. */
export function canReachPage(role: Role, pathname: string): boolean {
  const access = pageAccess(role, pathname);
  return access === null || access === "read" || access === "write";
}

/**
 * May this role be OFFERED writes on the screen? This is the page-level
 * ceiling — an ungoverned route answers false, because a screen that wants
 * writes should be in the table rather than defaulting to them.
 */
export function canEditPage(role: Role, pathname: string): boolean {
  return pageAccess(role, pathname) === "write";
}

/** The roles that may open a screen, in the sheet's column order. */
export function rolesWhoMayReach(pathname: string): Role[] {
  const row = pageAccessRow(pathname);
  if (!row) return [...ROLE_COLUMNS];
  return ROLE_COLUMNS.filter((r) => row[r] === "read" || row[r] === "write");
}

/**
 * "…is open to supervisors, purchasers and managers." — the sentence a refused
 * screen says. Plural for a role that several people hold; "the owner" is one
 * person. Never the raw role names, which would put `admin` on screen where
 * the app says Manager.
 */
export function whoMayReachSentence(pathname: string): string {
  const words = rolesWhoMayReach(pathname).map((r) => {
    if (r === "owner") return "the owner";
    if (r === "staff") return "staff";
    return `${ROLE_LABEL[r].toLowerCase()}s`;
  });
  if (words.length === 0) return "nobody";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
