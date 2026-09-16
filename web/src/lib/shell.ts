// WHICH SHELL THIS BROWSER GETS — the desk masthead with its two-tier menu, or
// the tablet bar with a landing page of actions (Mark, 2026-09-09: the menu "is
// the hardest thing to use on a tablet right now").
//
// ONE ROUTE TREE, TWO SHELLS. The `(app)` layout reads `session.shell` and
// mounts `AppHeader` or `TabletBar`; every page underneath is the same page.
// A second route tree was considered and refused: forty thin re-exports, and
// a deep link from an email would land in the desk shell on the iPad.
//
// THE COOKIE IS A DEVICE PROPERTY, NOT A SESSION ONE. It lives beside
// `rf.device` (migration 097) and is deliberately NOT in `clearSessionCookies`:
// locking, unlocking and signing out on the shared iPad must leave it a tablet.
// A registered shared device defaults to the tablet shell without anybody
// setting the cookie at all, which is what makes the iPad right on the day it
// is registered; the explicit cookie is for testing from a desk and for a
// manager who wants the bar on their own iPad.

import type { Role } from "@/lib/roles";

export const SHELL_COOKIE = "rf.shell";

export type Shell = "desk" | "tablet";

/** A stored value, or null for anything that is not one of the two words —
 *  a hand-edited cookie must not become a third shell. */
export function parseShell(raw: string | undefined | null): Shell | null {
  return raw === "desk" || raw === "tablet" ? raw : null;
}

/**
 * SUPERVISORS AND BELOW ALWAYS GET THE TABLET SHELL (Mark, 2026-09-16:
 * "regardless"). The desk shell is the power tool for the people who run the
 * catalog, the money and HR; a supervisor's and a staffer's work is the
 * landing page's list of actions, on whatever device they happen to be using.
 * It outranks the cookie and the device alike, so /account offers no switch.
 */
export function roleForcesTablet(role: Role): boolean {
  return role === "supervisor" || role === "staff";
}

/**
 * A forced role is a tablet. Otherwise the explicit cookie wins; absent, a registered device is a tablet and
 * anything else is a desk. Order matters: a manager can put the desk shell on
 * a registered iPad to fix something, and the device must not override them.
 */
export function resolveShell(
  cookieValue: string | undefined | null,
  registeredDevice: boolean,
  role?: Role
): Shell {
  if (role && roleForcesTablet(role)) return "tablet";
  return parseShell(cookieValue) ?? (registeredDevice ? "tablet" : "desk");
}

/** Where the tablet shell's Home goes, and where `/` lands under it. */
export const TABLET_HOME = "/start";
