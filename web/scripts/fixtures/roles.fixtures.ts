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
  canResolveRequests,
  canScheduleProduction,
  canSyncSales,
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

test("canLogBatch admits EVERY role since 092, and is not the delete gate", () => {
  // The Page Permissions sheet (2026-09-04) has Batch Logs at "Y" all the way
  // across; 092 widened production_batches' insert/update and
  // next_batch_number to match. Staff is the member that moved.
  eq(admits(canLogBatch), ["owner", "admin", "purchaser", "supervisor", "staff"]);
  ok(canLogBatch("staff"), "the overnight baker logs the batch");
  // Deleting a batch is still purchaser+ (044) — correcting a batch is
  // editing it; erasing the record that one happened is a different act.
  no(canWriteCatalog("supervisor"), "delete must stay out of a supervisor's reach");
});

test("canScheduleProduction is the supervisor+ set", () => {
  // 092 widened production_schedules' insert/delete to supervisor+, and the
  // invoker functions schedule_special_order / unschedule_special_order answer
  // to those policies — so this is exactly that set.
  eq(admits(canScheduleProduction), ["owner", "admin", "purchaser", "supervisor"]);
  no(canScheduleProduction("staff"), "staff read an order and never commit a kitchen's night");
});

test("canSyncSales is purchaser+ since 092", () => {
  eq(admits(canSyncSales), ["owner", "admin", "purchaser"]);
  no(canSyncSales("supervisor"), "a supervisor reads sales and syncs nothing");
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

test("canResolveRequests is exactly 092's preq_resolve role array", () => {
  // 001 had it at purchaser+ and named the supervisor as the obvious next
  // member; the Page Permissions sheet moved them (Requests "Y"). Filing is
  // still NOT gated at the database (`preq_insert` is membership-only), so
  // the assertion that matters most here is the staff one: they may add to
  // the queue and never decide it.
  eq(admits(canResolveRequests), ["owner", "admin", "purchaser", "supervisor"]);
  ok(canResolveRequests("supervisor"), "a supervisor resolves requests since 092");
  no(canResolveRequests("staff"), "staff file requests and never decide them");
});
