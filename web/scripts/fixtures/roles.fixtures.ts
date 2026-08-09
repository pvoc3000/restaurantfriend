// lib/roles — the predicates that gate the UI.
//
// The repo had no fixtures for this file until production phase 5, and phase 5
// is what made them worth having: `canEnterCounts` is the first predicate that
// admits a SUPERVISOR, and the one-line mistake of reaching for
// `canWriteCatalog` instead would re-lock supervisors out of the whole feature
// while migration 044's function kept working perfectly — the cell simply would
// not be offered, so nothing would error and nothing would be written.
//
// Hence every case below asserts the SET, not just the happy member: what a
// predicate admits and what it refuses are equally load-bearing, and a
// predicate that says yes to everyone passes any test that only checks yes.

import { test, eq, ok, no } from "./harness";
import {
  ROLE_LABEL,
  ROLE_OPTIONS,
  canWriteCatalog,
  canEnterCounts,
  canLogBatch,
  canManageMembers,
  canReadHr,
  canApprovePayment,
  canRunPayroll,
  type Role,
} from "../../src/lib/roles";

const ALL: Role[] = ["owner", "admin", "purchaser", "supervisor", "staff"];

/** Everyone the predicate admits, in the ladder's own order. */
function admits(p: (r: Role) => boolean): Role[] {
  return ALL.filter(p);
}

test("canEnterCounts admits a supervisor and canWriteCatalog does not", () => {
  // THE case this file exists for. Both halves, because either one alone
  // passes while the feature is broken.
  ok(canEnterCounts("supervisor"), "a supervisor may record a count");
  no(canWriteCatalog("supervisor"), "a supervisor may not write the catalog");
});

test("canEnterCounts is exactly 044's set_schedule_actual role array", () => {
  eq(admits(canEnterCounts), ["owner", "admin", "purchaser", "supervisor"]);
});

test("canEnterCounts refuses staff", () => {
  // Staff walk the order guide and file purchase requests. Counting what the
  // case sold is not theirs, and 044's function raises for them.
  no(canEnterCounts("staff"));
});

test("canLogBatch is the same set, and is not the delete gate", () => {
  eq(admits(canLogBatch), admits(canEnterCounts));
  // Deleting a batch is purchaser+ in 044's policy — correcting a batch is
  // editing it; erasing the record that one happened is a different act.
  no(canWriteCatalog("supervisor"), "delete must stay out of a supervisor's reach");
});

test("canWriteCatalog is unchanged by phase 5", () => {
  eq(admits(canWriteCatalog), ["owner", "admin", "purchaser"]);
});

test("the manager-and-up predicates all refuse a supervisor", () => {
  // Phase 5 widened production, not HR or money. If a future edit ever
  // loosens one of these by copying canEnterCounts, this goes red.
  for (const p of [canManageMembers, canReadHr, canApprovePayment, canRunPayroll]) {
    eq(admits(p), ["owner", "admin"]);
  }
});

test("every role has a label, and admin displays as Manager", () => {
  for (const r of ALL) ok(ROLE_LABEL[r], `label for ${r}`);
  // The stored value stays 'admin' because it is what every RLS policy names.
  eq(ROLE_LABEL.admin, "Manager");
});

test("ROLE_OPTIONS offers every role except owner", () => {
  // Ownership moves in the SQL editor, deliberately and rarely.
  eq(
    ROLE_OPTIONS.map((o) => o.value).sort(),
    ["admin", "purchaser", "staff", "supervisor"]
  );
});
