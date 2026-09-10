// The shell switch (lib/shell) and the tablet landing's pure half
// (lib/tablet/landing): which shell a browser gets, which tiles a role sees,
// where Back goes.

import { SECTIONS } from "../../src/lib/nav";
import { canReachPage } from "../../src/lib/pageAccess";
import { TABLET_HOME, parseShell, resolveShell } from "../../src/lib/shell";
import {
  LANDING_GROUPS,
  tabletBackHref,
  tilesForRole,
} from "../../src/lib/tablet/landing";
import { eq, ok, test } from "./harness";

// ------------------------------------------------------------- resolveShell

test("no cookie: a registered device is a tablet, anything else a desk", () => {
  eq(resolveShell(undefined, true), "tablet");
  eq(resolveShell(undefined, false), "desk");
  eq(resolveShell(null, true), "tablet");
});

test("an explicit cookie beats the device either way", () => {
  eq(resolveShell("desk", true), "desk", "a manager fixing something on the iPad");
  eq(resolveShell("tablet", false), "tablet", "a manager's own iPad");
});

test("a hand-edited cookie is not a third shell", () => {
  eq(parseShell("phone"), null);
  eq(parseShell(""), null);
  eq(resolveShell("phone", true), "tablet", "falls through to the device");
});

// ------------------------------------------------------------- tilesForRole

test("every tile's href is a governed route the menu also knows", () => {
  const menuHrefs = new Set(
    SECTIONS.flatMap((s) => s.subs.filter((sub) => sub.built).map((sub) => sub.href))
  );
  for (const group of LANDING_GROUPS) {
    for (const tile of group.tiles) {
      const path = tile.href.split("?")[0];
      ok(menuHrefs.has(path), `${tile.key} → ${path} is a built menu entry`);
    }
  }
});

test("the owner sees every tile in Mark's five groups", () => {
  const groups = tilesForRole("owner");
  eq(groups.length, 5);
  eq(
    groups.flatMap((g) => g.tiles.map((t) => t.key)),
    LANDING_GROUPS.flatMap((g) => g.tiles.map((t) => t.key))
  );
});

test("a role sees exactly the tiles whose route it may reach", () => {
  for (const role of ["staff", "supervisor", "purchaser"] as const) {
    const shown = new Set(tilesForRole(role).flatMap((g) => g.tiles.map((t) => t.key)));
    for (const group of LANDING_GROUPS) {
      for (const tile of group.tiles) {
        eq(shown.has(tile.key), canReachPage(role, tile.href.split("?")[0]), `${role} ${tile.key}`);
      }
    }
  }
});

test("a group left with no tiles is dropped, not shown empty", () => {
  // Staff may reach none of Shift's three (shift reports, documents, tags).
  const staff = tilesForRole("staff");
  ok(!staff.some((g) => g.label === "Shift"), "no Shift heading for staff");
  ok(staff.every((g) => g.tiles.length > 0));
});

// ----------------------------------------------------------- tabletBackHref

test("Back on the landing page is nowhere", () => {
  eq(tabletBackHref(TABLET_HOME, {}), null);
});

test("Back follows the breadcrumb trail when there is one", () => {
  eq(
    tabletBackHref("/items/abc", { from: "/vendors/9?tab=items", fromLabel: "BakeMark" }),
    "/vendors/9?tab=items"
  );
});

test("Back follows the LAST crumb of a nested trail", () => {
  const nested = "/vendors/9?from=%2Fvendors&fromLabel=Vendors";
  eq(tabletBackHref("/items/abc", { from: nested, fromLabel: "BakeMark" }), nested);
});

test("a detail route with no trail goes to its own list", () => {
  eq(tabletBackHref("/vendors/9", {}), "/vendors");
  eq(tabletBackHref("/shift-reports/abc/run", {}), "/shift-reports");
});

test("a list, or a route the menu does not know, goes home", () => {
  eq(tabletBackHref("/vendors", {}), TABLET_HOME);
  eq(tabletBackHref("/account", {}), TABLET_HOME);
});

test("a half trail — from with no label — is ignored", () => {
  eq(tabletBackHref("/vendors/9", { from: "/items" }), "/vendors");
});
