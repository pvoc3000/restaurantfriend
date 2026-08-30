/**
 * Roles: the vocabulary, its labels, and the predicates that gate the UI.
 *
 * `org_members.role` is a CLOSED set — migration 001's own check constraint,
 * widened by 020 — so labelling it here is not the "zero business hardcoding"
 * rule's business: these five values are schema, not org configuration, the
 * same reasoning ORDER_TYPE_LABEL already relies on.
 *
 * The order below is the ladder Mark described, from FMP's 1–5 user levels:
 * staff · supervisor · purchaser · admin · owner. Nothing in the schema treats
 * roles as ordered — there is no rank function and "purchaser+" is a phrase in
 * comments, not a construct — so the ladder is a way of talking about them,
 * and each predicate below names its own set.
 */

import type { PickOption } from "@/components/ui/PickList";

export type Role = "owner" | "admin" | "purchaser" | "supervisor" | "staff";

/**
 * `admin` displays as "Manager" — FMP's level 3, and the word Donut Friend
 * uses. The stored value stays 'admin' because it is what every RLS policy in
 * the schema names; renaming it would be a rewrite of the whole policy surface
 * to change a label.
 */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Manager",
  purchaser: "Purchaser",
  supervisor: "Supervisor",
  staff: "Staff",
};

/**
 * What an invite or a role change may set.
 *
 * `owner` is deliberately absent. 001's members_write policy would technically
 * let an admin write it — a pre-existing surface, unchanged here — but the UI
 * never offers it: ownership moves in the SQL editor, deliberately and rarely.
 */
export const ROLE_OPTIONS: PickOption[] = [
  { value: "admin", label: "Manager", hint: "everything, incl. HR and access" },
  { value: "purchaser", label: "Purchaser", hint: "catalog and PO writes" },
  { value: "supervisor", label: "Supervisor", hint: "staff, plus shift tools" },
  { value: "staff", label: "Staff", hint: "guide entries and requests" },
];

/**
 * Catalog and purchase-order writes — the gate every purchasing screen has
 * used since the module shipped, and the exact set named by the write policies
 * in 001's generic loop, by create_purchase_orders_from_guide, and by both
 * edge functions. A supervisor is NOT in it: they walk the guide (that table's
 * insert/update policies are membership-only) but don't change the catalog.
 */
export function canWriteCatalog(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "purchaser";
}

/**
 * Record what a shift actually produced — production phase 5.
 *
 * The first predicate in this file that admits a supervisor, and it is the
 * reason the role exists (020: "when supervisors get shift reports and
 * production schedules, those tables' own policies name the role").
 *
 * It mirrors migration 044's `set_schedule_actual`, which checks this same set
 * inside the function because RLS filters ROWS and "a supervisor may set made
 * and leftover and nothing else" is a COLUMN rule. Reaching for
 * `canWriteCatalog` here instead would lock supervisors out of the whole
 * feature while the function kept working — the cell simply wouldn't be
 * offered — which is why the fixtures assert both halves.
 *
 * `mark_schedule_printed` names the same set: printing the night's packet is
 * the same closing routine the counts are entered in.
 */
export function canEnterCounts(role: Role): boolean {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "purchaser" ||
    role === "supervisor"
  );
}

/**
 * Log a batch — migration 044's `production_batches` write policies and
 * `generate_production_batches`.
 *
 * The same set as `canEnterCounts` today, and named separately for the reason
 * `canReadHr` gives: "may record what the case sold" and "may record what came
 * out of the mixer" are different questions with the same answer today, and one
 * of them will move first. DELETING a batch is purchaser+ — `canWriteCatalog`
 * — because correcting a batch is editing it and erasing the record that one
 * happened is a different act.
 */
export const canLogBatch = canEnterCounts;

/** Invite people, change roles, remove access. 001's members_write. */
export function canManageMembers(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Read and write the HR record — migration 020's employees policies.
 *
 * The same set as canManageMembers today, and named separately on purpose:
 * "may grant app access" and "may read a home address" are different questions
 * that happen to have the same answer, and one of them will move first.
 */
export const canReadHr = canManageMembers;

/**
 * Pull daily sales and tips from Square — migration 063's `record_daily_sales`,
 * which checks this same set inside the function.
 *
 * READING `/sales` is open to every member: what the shop took is a shop-floor
 * fact, and 063's select policy is membership-wide. This is only the SYNC,
 * which is an IMPORT — it rewrites the org's sales history and feeds the tip
 * figure payroll divides — and 030 already gates imports here.
 *
 * Named separately from `canManageMembers` for that file's own reason: "may
 * invite a colleague" and "may restate a year of takings" are different
 * questions with the same answer today.
 */
export const canSyncSales = canManageMembers;

/**
 * Approve a vendor invoice for payment — migration 025's
 * `set_vendor_invoice_approval`, which checks this same set inside the
 * function because RLS filters rows and this is a COLUMN rule.
 *
 * Purchaser+ can create and edit an invoice; saying "we owe this money" is
 * manager work in FMP's own 1–5 ladder. Named separately from
 * `canManageMembers` for the reason `canReadHr` is: "may grant app access" and
 * "may approve a payment" are different questions with the same answer today,
 * and one of them will move first.
 */
export const canApprovePayment = canManageMembers;

/**
 * Run payroll — read and correct timesheets, adjudicate break premiums and
 * overtime, produce the export. Migration 028's policies, which are owner/admin
 * on EVERY verb including select.
 *
 * That read gate is unusual in this schema, where reads are almost always
 * membership-only, and it follows 020's reasoning about `employees`: what a
 * named person was paid for is the same class of fact as their home address.
 * Migration 027's `pay_periods` is deliberately NOT gated this way — a period
 * is two dates and a status, and a supervisor reporting Saturday's tips has to
 * know which fortnight is open.
 *
 * The same set as `canReadHr` today, and named separately for the reason that
 * one already gives: "may read a home address" and "may see what someone was
 * paid" are different questions with the same answer today, and one of them
 * will move first. Loosening this for supervisors later is a definer function
 * naming safe columns — 020's own comment anticipates it — never a policy
 * change.
 */
export const canRunPayroll = canManageMembers;

/**
 * Resolve a purchase request — mark it ordered, dismiss it, reopen it.
 * Migration 001's `preq_resolve`, whose role array is this set verbatim.
 *
 * Note what it does NOT gate: FILING a request is membership-only
 * (`preq_insert`), so the New request command is never behind this, and 059's
 * `preq_author_update` lets the person who filed one correct or withdraw it
 * while it is still open. A queue that staff can read and not add to would be
 * the feature inverted.
 *
 * The same set as `canWriteCatalog` today, and named separately for the reason
 * `canReadHr` gives: "may edit the catalog" and "may say we bought this" are
 * different questions with the same answer today, and one of them will move
 * first — a supervisor resolving requests is the obvious candidate.
 */
export const canResolveRequests = canWriteCatalog;

/**
 * Walk a checklist, work a task — migrations 075 and 076, whose policies name
 * this same set on every verb.
 *
 * The same set as `canEnterCounts` today, and named separately for this file's
 * own stated reason: "may record what came out of the mixer" and "may record
 * that the walk-in is at 44 degrees" are different questions with the same
 * answer today, and one of them will move first.
 *
 * Note what it does NOT gate. READING the templates and the equipment register
 * is membership-only, because everyone should be able to see what they will be
 * asked and to resolve the name of the thing they are asked about. Only the
 * WALK is here.
 */
export function canWalkChecklists(role: Role): boolean {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "purchaser" ||
    role === "supervisor"
  );
}

/**
 * Edit the master checklists and the equipment register — 076's
 * `checklist_templates_write` and 075's `equipment_write`.
 *
 * Mark, 2026-08-29: "Managers and purchasers should be able to edit the master
 * lists." That is `canWriteCatalog`'s set exactly, and the reasoning is the
 * same one that put the catalog there: a master checklist IS a catalog, and
 * maintaining it is the same kind of act as maintaining an item.
 *
 * Named separately anyway, per the convention above — a supervisor who
 * maintains their own shop's list is the obvious candidate to move first.
 */
export const canEditChecklists = canWriteCatalog;

/**
 * Close, cancel or reassign a task. 075's `location_tasks_update`.
 *
 * DELIBERATELY the same as `canWalkChecklists` and NOT `canWriteCatalog`: a
 * task is worked by whoever is on tonight, so the supervisor who boils out the
 * fryer is by definition not the manager who raised it. Gating the close at
 * purchaser+ would leave the carried-forward list unclearable by the only
 * people standing in front of it.
 */
export const canResolveTasks = canWalkChecklists;
