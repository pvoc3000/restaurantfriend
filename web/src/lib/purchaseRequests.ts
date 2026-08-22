/**
 * Purchase requests: the vocabulary, and the two rules the screen shares with
 * the database.
 *
 * A request is somebody on the floor saying "we need X". It has two exits —
 * the purchaser buys it and says so, or tells them no and says why — and
 * migration 059 is what makes that asymmetry real.
 *
 * Both vocabularies are CLOSED SETS with check constraints behind them (001 for
 * `status`, 059 for `priority`), so labelling them here is not the
 * zero-hardcoding rule's business: they are schema, not org configuration, the
 * same reasoning `ROLE_LABEL` and `ORDER_TYPE_LABEL` already rest on.
 */

import type { ListSort } from "@/lib/filterMenus";

export type RequestStatus = "open" | "ordered" | "dismissed";
export type RequestPriority = "low" | "normal" | "high";

/** Queue order: what you are working, then the two ways it leaves. */
export const REQUEST_STATUSES: RequestStatus[] = ["open", "ordered", "dismissed"];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  open: "Open",
  ordered: "Ordered",
  dismissed: "Dismissed",
};

/** Highest first — the order they are offered in, and the order they matter. */
export const REQUEST_PRIORITIES: RequestPriority[] = ["high", "normal", "low"];

export const REQUEST_PRIORITY_LABEL: Record<RequestPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * DO NOT REACH FOR `.order("priority")`. The column is TEXT, so Postgres sorts
 * it alphabetically — `high` < `low` < `normal` — which puts Low in the middle
 * and looks almost right, which is the dangerous kind of wrong. The ranking
 * lives here and the queue is ordered in the browser, where the rows are few.
 */
export function priorityRank(priority: string | null): number {
  if (priority === "high") return 2;
  if (priority === "low") return 0;
  return 1; // 'normal', and anything unrecognised, sits in the middle
}

/**
 * The TypeScript twin of 059's `purchase_requests_reason_when_dismissed`.
 *
 * Saying no to somebody has to leave a record of why — it is the only trace a
 * request that vanished ever gets, and withdrawing your own is a dismissal
 * too. Saying yes does not: "ordered" explains itself, and demanding a
 * sentence for the common case is how people learn to stop reading the dialog
 * (migration 032's lesson, in a second costume).
 *
 * Stated twice on purpose, and the constraint is named in a comment at both
 * ends: the dialog asks so the person is told BEFORE they commit, and the
 * CHECK asks because a constraint is the only thing that actually holds. If
 * one moves, move the other.
 */
export function requestRequiresNote(status: RequestStatus): boolean {
  return status === "dismissed";
}

/** What 059 accepts as a note — whitespace is not a reason. */
export function hasNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.trim().length > 0;
}

/**
 * The resting order of the queue: highest priority first, and oldest first
 * within a priority.
 *
 * The second half is free rather than declared — `lib/tableSort`'s tiebreaks
 * always read ascending whichever way the primary points — so pointing the
 * priority column DESC gives high-first and FIFO underneath it, which is what
 * a queue wants. Keep the list's `sort` STATE null at rest and pass this as
 * the fallback, so the screen keeps one canonical address.
 */
export const REQUESTS_NATURAL_SORT: ListSort = { key: "priority", dir: "desc" };
