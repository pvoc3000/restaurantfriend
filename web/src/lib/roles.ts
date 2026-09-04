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
 *
 * WHICH SCREENS A ROLE MAY OPEN, AND WHETHER A SCREEN OFFERS WRITES AT ALL, is
 * NOT here — that is `lib/pageAccess`, the Page Permissions sheet as code.
 * What is here is the set of ACTS stricter than their screen: approving a
 * payment, syncing sales, reopening a run. A page-level cell is a ceiling; a
 * predicate is one button.
 */

import type { PickOption } from "@/components/ui/PickList";

export type Role = "owner" | "admin" | "purchaser" | "supervisor" | "staff";

/** Every role, ladder order. */
export const ROLES: Role[] = ["owner", "admin", "purchaser", "supervisor", "staff"];

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
 * Log a batch — migration 092's `production_batches` write policies and
 * `next_batch_number`, which check this same set.
 *
 * EVERY MEMBER since 2026-09-04 (the Page Permissions sheet: Batch Logs is
 * "Y" all the way across, staff included). 044 had it at supervisor+.
 * Recording what came out of the mixer is done by whoever was at the mixer,
 * and the overnight baker is staff. DELETING a batch is still purchaser+ —
 * `canWriteCatalog` — because correcting a batch is editing it and erasing
 * the record that one happened is a different act. GENERATING the week's
 * batch list stays supervisor+ in 047, an act-level exception the way editing
 * a master checklist is on the Checklists screen.
 */
export function canLogBatch(role: Role): boolean {
  return ROLES.includes(role);
}

/**
 * Put a special order's donuts on a real production schedule —
 * `schedule_special_order` and `unschedule_special_order` (068/069), which
 * are SECURITY INVOKER and so answer to `production_schedules`' own insert
 * and delete policies. 092 widened those to supervisor+ (the sheet has
 * Schedules AND Special Orders at "Y" for a supervisor), so this is that set.
 * 068's header argued the opposite — that a definer would "silently widen"
 * scheduling to supervisors — and the widening is now explicit and the
 * policy's, which is what that header asked for.
 */
export const canScheduleProduction = canEnterCounts;

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
 * Pull daily sales and tips from Square, and correct a day's figures by hand
 * — migration 092's `record_daily_sales`, `set_daily_sales_figure` and
 * `revert_daily_sales_to_square`, which check this same set inside the
 * function.
 *
 * PURCHASER+ since 2026-09-04 (the Page Permissions sheet: Sales is "Y" for a
 * purchaser). It was owner/admin from 063 on the reasoning that a sync is an
 * IMPORT — it rewrites the org's sales history and feeds the tip figure
 * payroll divides — and that reasoning still holds for STAFF and supervisors,
 * who read the screen and go no further.
 *
 * READING `/sales` is open to every member at the database (063's select
 * policy); which roles OPEN the screen is `lib/pageAccess`' business.
 */
export const canSyncSales = canWriteCatalog;

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
 * Migration 092's `preq_resolve`, whose role array is this set verbatim.
 *
 * SUPERVISOR+ since 2026-09-04 (the Page Permissions sheet: Requests is "Y"
 * for a supervisor). 001 had it at purchaser+, and this file's own note on
 * that version named "a supervisor resolving requests" as the obvious
 * candidate to move first. It has.
 *
 * Note what it does NOT gate: FILING a request is membership-only
 * (`preq_insert`), and 059's `preq_author_update` lets the person who filed
 * one correct or withdraw it while it is still open. Whether the New request
 * command is OFFERED is `lib/pageAccess`' call — the sheet has staff at
 * "Read Only" on that screen, so they read the queue and do not add to it
 * from there.
 */
export const canResolveRequests = canEnterCounts;

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
 * Take a FINISHED checklist back to open.
 *
 * 076's own words: "Owner/admin may correct a submitted one; that is the
 * closed-pay-period rule applied here." Its UPDATE policy already permits
 * exactly this, so nothing in the schema moves — but a supervisor who walked
 * the list is deliberately not offered it, because a completed walk is the
 * record that a named person made a claim at a time.
 *
 * Named separately from `canManageMembers` on `canReadHr`'s reasoning: "may
 * grant app access" and "may unfinish somebody's walk" are different questions
 * that happen to have the same answer today, and one of them will move first.
 */
export function canReopenChecklistRun(role: Role): boolean {
  return role === "owner" || role === "admin";
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
