/**
 * Purchase requests.
 *
 * Two rules here are worth pinning, and both are rules the app shares with the
 * database rather than owns:
 *
 *   · `requestRequiresNote` is the TypeScript twin of 059's
 *     `purchase_requests_reason_when_dismissed`. If they ever disagree, the
 *     dialog lets somebody commit a write the CHECK then bounces back as a raw
 *     23514 — which is the one refusal an inline cell cannot explain, and the
 *     reason the exits are dialogs at all.
 *   · The queue's resting order is high-priority-first and oldest-first within
 *     a priority, and only HALF of that is declared. The second half is a
 *     property of the shared comparator (a tiebreak always reads ascending
 *     whichever way the primary points), so it is asserted through `sortRows`
 *     rather than by reading `REQUESTS_NATURAL_SORT`, which would prove
 *     nothing.
 *
 * `priorityRank` exists because the column is TEXT: Postgres would sort it
 * high < low < normal, so the ranking has to be somewhere, and everything below
 * is what stops that somewhere from drifting.
 */

import { test, eq, ok, no } from "./harness";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  REQUESTS_NATURAL_SORT,
  hasNote,
  priorityRank,
  requestRequiresNote,
  type RequestPriority,
  type RequestStatus,
} from "../../src/lib/purchaseRequests";
import { sortRows, type SortableColumn } from "../../src/lib/tableSort";

// ---------------------------------------------------------------------------
// The note requirement — 059's check constraint, restated
// ---------------------------------------------------------------------------

test("only a dismissal requires a note", () => {
  eq(REQUEST_STATUSES.filter(requestRequiresNote), ["dismissed"]);
});

test("marking ordered needs no note — 032's lesson, second costume", () => {
  no(requestRequiresNote("ordered"), "ordered explains itself");
  no(requestRequiresNote("open"), "an open request has not been resolved at all");
  ok(requestRequiresNote("dismissed"), "saying no has to leave a record of why");
});

test("whitespace is not a reason — 059 asks length(btrim(...)) > 0", () => {
  no(hasNote("   "), "three spaces would satisfy a naive `note !== \"\"`");
  no(hasNote("\n\t"), "nor is a newline");
  no(hasNote(""), "");
  no(hasNote(null), "");
  no(hasNote(undefined), "");
  ok(hasNote("duplicate of #12"), "");
  ok(hasNote(" x "), "one real character, padded, is a reason");
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

test("priorityRank orders high above normal above low", () => {
  ok(
    priorityRank("high") > priorityRank("normal") &&
      priorityRank("normal") > priorityRank("low"),
    "the ranking the TEXT column cannot express"
  );
});

test("an unrecognised priority sits with normal, never at an end", () => {
  // A row written before 059's default, or by a future migration widening the
  // vocabulary, must not silently jump to the top of somebody's queue or
  // disappear off the bottom of it.
  eq(priorityRank("urgent"), priorityRank("normal"));
  eq(priorityRank(null), priorityRank("normal"));
});

test("REQUEST_PRIORITIES is offered highest-first", () => {
  eq(REQUEST_PRIORITIES, ["high", "normal", "low"]);
  const ranks = REQUEST_PRIORITIES.map((p) => priorityRank(p));
  eq(ranks, [2, 1, 0], "the list's order and the ranking agree");
});

// ---------------------------------------------------------------------------
// The resting queue order, asserted through the real comparator
// ---------------------------------------------------------------------------

type Row = { id: string; priority: RequestPriority; created_at: string };

const COLUMNS: SortableColumn<Row>[] = [
  {
    key: "priority",
    sortValue: (r) => priorityRank(r.priority),
    sortTiebreaks: [(r) => r.created_at],
  },
];

const QUEUE: Row[] = [
  { id: "normal-old", priority: "normal", created_at: "2026-08-01T09:00:00Z" },
  { id: "high-new", priority: "high", created_at: "2026-08-20T09:00:00Z" },
  { id: "low", priority: "low", created_at: "2026-07-01T09:00:00Z" },
  { id: "high-old", priority: "high", created_at: "2026-08-02T09:00:00Z" },
  { id: "normal-new", priority: "normal", created_at: "2026-08-19T09:00:00Z" },
];

test("the resting queue is high first, oldest first within a priority", () => {
  const sorted = sortRows(QUEUE, COLUMNS, REQUESTS_NATURAL_SORT);
  eq(sorted.map((r) => r.id), [
    "high-old",
    "high-new",
    "normal-old",
    "normal-new",
    "low",
  ]);
});

test("the FIFO half comes from the comparator, not from the sort object", () => {
  // The tiebreak is declared once, ascending, and stays ascending while the
  // primary points DESC. Point the primary the other way and the tiebreak does
  // NOT flip with it — which is the property the resting order depends on, and
  // the one a rewrite of `makeComparator` would most plausibly break.
  const ascending = sortRows(QUEUE, COLUMNS, { key: "priority", dir: "asc" });
  eq(ascending.map((r) => r.id), [
    "low",
    "normal-old",
    "normal-new",
    "high-old",
    "high-new",
  ]);
});

test("REQUESTS_NATURAL_SORT names a column the list actually sorts by", () => {
  ok(
    COLUMNS.some((c) => c.key === REQUESTS_NATURAL_SORT.key),
    "a natural sort naming a column that has no sortValue leaves rows unsorted, silently"
  );
  eq(REQUESTS_NATURAL_SORT.dir, "desc", "ascending would bury the urgent ones");
});

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

test("the statuses are 001's three, in queue order", () => {
  const statuses: RequestStatus[] = ["open", "ordered", "dismissed"];
  eq(REQUEST_STATUSES, statuses);
});
