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
