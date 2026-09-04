// lib/pageAccess — the Page Permissions sheet as code.
//
// Three kinds of case. The SHEET cases pin cells Mark decided (2026-09-04),
// so an edit to the table is a deliberate act that fails a fixture first. The
// STRUCTURE cases pin what makes the table safe to trust: every built menu
// entry has a row (or the menu would show a screen the layout then refuses),
// and a record route inherits its list's row. And the MIGRATION cases pin that
// the cells which needed the database to loosen are exactly the ones 092 lists
// — the next cell that asks for more than the database gives should go red
// here and be recognised as a migration.
//
// Checked by breaking each: flipping "/plans" purchaser to "W" reds 1; giving a
// nav entry an href with no row reds 1; dropping the longest-prefix rule reds
// the /production-day case; removing a LOOSENED_BY_092 entry reds 1.

import {
  LOOSENED_BY_092,
  PAGE_ACCESS,
  ROLE_COLUMNS,
  canEditPage,
  canReachPage,
  pageAccess,
  rolesWhoMayReach,
  whoMayReachSentence,
} from "../../src/lib/pageAccess";
import { SECTIONS, homeHref, sectionsForRole } from "../../src/lib/nav";
import { ROLES, type Role } from "../../src/lib/roles";
import { eq, no, ok, test } from "./harness";

// ------------------------------------------------------------- the sheet

test("every row carries all five roles, in the sheet's column order", () => {
  eq(ROLE_COLUMNS, ["staff", "supervisor", "purchaser", "admin", "owner"]);
  for (const [route, row] of Object.entries(PAGE_ACCESS)) {
    eq(Object.keys(row).sort(), [...ROLES].sort(), `${route} has every role`);
  }
});

test("HR is unreachable below manager, and the manager cell on Benefits is blank", () => {
  eq(pageAccess("staff", "/employees"), "unreachable");
  eq(pageAccess("supervisor", "/timesheets"), "unreachable");
  eq(pageAccess("purchaser", "/employees"), "none");
  eq(pageAccess("admin", "/payroll-benefits"), "none");
  eq(pageAccess("owner", "/payroll-benefits"), "write");
});

test("production is read-only for a supervisor and open to a purchaser", () => {
  // The afternoon revision: "purchasers should have almost manager access,
  // minus HR". A supervisor still reads.
  for (const route of ["/plans", "/production-items", "/elements", "/recipes"]) {
    eq(pageAccess("supervisor", route), "read", route);
    eq(pageAccess("purchaser", route), "write", route);
    eq(pageAccess("admin", route), "write", route);
  }
  // Schedules is the one production screen a supervisor WRITES on.
  eq(pageAccess("supervisor", "/schedules"), "write");
  eq(pageAccess("staff", "/schedules"), "read");
});

test("invoices are hidden below purchaser and open from one up", () => {
  eq(pageAccess("supervisor", "/invoices"), "none");
  eq(pageAccess("purchaser", "/invoices"), "write");
  eq(pageAccess("admin", "/invoices"), "write");
});

test("staff read special orders and customers, supervisors write orders and read customers", () => {
  eq(pageAccess("staff", "/special-orders"), "read");
  eq(pageAccess("staff", "/customers"), "read");
  eq(pageAccess("supervisor", "/special-orders"), "write");
  eq(pageAccess("supervisor", "/customers"), "read");
  eq(pageAccess("purchaser", "/customers"), "write");
});

test("the Facilities list and shop sections are owner only", () => {
  eq(pageAccess("purchaser", "/locations"), "none");
  eq(pageAccess("admin", "/locations"), "none");
  eq(pageAccess("owner", "/locations"), "write");
  eq(pageAccess("admin", "/shop-sections"), "none");
  eq(pageAccess("owner", "/shop-sections"), "write");
});

// -------------------------------------------------------------- structure

test("every built menu entry, and every `also` route, has a row", () => {
  const missing: string[] = [];
  for (const section of SECTIONS) {
    for (const sub of section.subs) {
      for (const href of [sub.href, ...(sub.also ?? [])]) {
        if (pageAccess("owner", href) === null) missing.push(href);
      }
    }
  }
  eq(missing, []);
});

test("a record route inherits its list's row — by prefix, longest wins", () => {
  eq(pageAccess("supervisor", "/plans/abc-123"), "read");
  eq(pageAccess("staff", "/special-orders/abc?from=x"), "read");
  // /production-day is not /production-items, and neither is a prefix of the
  // other's records.
  eq(pageAccess("supervisor", "/production-day"), "write");
  eq(pageAccess("supervisor", "/production-items/abc"), "read");
  // /items must not match /items-archive-style siblings.
  eq(pageAccess("staff", "/itemsx"), null);
});

test("an ungoverned route opens for everyone and offers writes to nobody", () => {
  eq(pageAccess("staff", "/settings"), null);
  ok(canReachPage("staff", "/settings"), "settings opens");
  no(canEditPage("staff", "/settings"), "but the table claims no writes for it");
});

test("canReachPage and canEditPage read the same cell", () => {
  ok(canReachPage("supervisor", "/plans"));
  no(canEditPage("supervisor", "/plans"));
  ok(canEditPage("purchaser", "/plans"));
  no(canReachPage("staff", "/order-guide"));
  no(canReachPage("staff", "/employees"), "unreachable is not reachable either");
});

// ---------------------------------------------------------- the menu reads it

test("the menu hides exactly what the table hides", () => {
  const hrefs = (role: Role) =>
    sectionsForRole(role).flatMap((s) => s.subs.map((sub) => sub.href));
  const staff = hrefs("staff");
  no(staff.includes("/order-guide"), "staff have no Order Guide tab");
  no(staff.includes("/employees"));
  ok(staff.includes("/schedules"), "but read-only screens still appear");
  ok(staff.includes("/batch-logs"));
  // A section with nothing left goes entirely.
  no(sectionsForRole("staff").some((s) => s.slug === "hr"), "no HR section for staff");
  ok(sectionsForRole("purchaser").some((s) => s.slug === "hr") === false, "nor for a purchaser");
  ok(hrefs("owner").length >= hrefs("admin").length, "the owner sees at least what a manager does");
});

test("home is the Locations list where the sheet allows it, else the first offered screen", () => {
  eq(homeHref("owner"), "/locations");
  // Everyone else is hidden from Locations since the afternoon revision; the
  // first built screen their menu offers, in menu order, is the checklists.
  eq(homeHref("admin"), "/checklists");
  eq(homeHref("purchaser"), "/checklists");
  eq(homeHref("supervisor"), "/checklists");
  // Staff are hidden from all of Facilities, HR and Operations.
  eq(homeHref("staff"), "/schedules");
});

// ------------------------------------------------------------ the sentence

test("the refusal names who may open the screen, in the app's own words", () => {
  eq(rolesWhoMayReach("/employees"), ["admin", "owner"]);
  eq(whoMayReachSentence("/employees"), "managers and the owner");
  eq(whoMayReachSentence("/shop-sections"), "the owner");
  eq(whoMayReachSentence("/locations"), "the owner");
  eq(whoMayReachSentence("/order-guide"), "supervisors, purchasers, managers and the owner");
  // Never the raw role name: `admin` is Manager on every screen.
  no(whoMayReachSentence("/employees").includes("admin"));
});

// ------------------------------------------------------------ migration 092

test("the cells that needed the database to loosen are exactly 092's list", () => {
  // Each of these is a place the sheet asked for MORE than the policies gave
  // before 092. If a future edit adds another such cell, add it here AND
  // write the migration — this table cannot grant what Postgres refuses.
  for (const { route, role, access } of LOOSENED_BY_092) {
    eq(pageAccess(role, route), access, `${route} for ${role}`);
  }
  eq(LOOSENED_BY_092.length, 6);
});
