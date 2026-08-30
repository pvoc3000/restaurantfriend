/**
 * Tasks and maintenance requests, and the carry-forward.
 *
 * The rule this file exists for is the one Mark was most excited about
 * (2026-08-29): anything flagged on a walkthrough appears on every subsequent
 * supervisor's checklist until it is done. Its failure mode is the thing being
 * pinned here — a task that appears IDENTICALLY for thirty nights is one people
 * learn to scroll past, so the carried-forward row has to age visibly and the
 * old ones have to surface somewhere a manager reads.
 *
 * `daysBetween` is pinned hardest because it is the quiet one: written as
 * `new Date(a) - new Date(b)` on YYYY-MM-DD strings it is right in Greenwich
 * and off by a day for everyone west of it, which is exactly nobody's local
 * machine here.
 */

import { test, eq, ok, no } from "./harness";
import {
  OPEN_TASK_STATUSES,
  TASK_OVERDUE_DAYS,
  TASK_STALE_DAYS,
  daysBetween,
  isTaskOpen,
  issueAlreadyRaised,
  openTasksForRun,
  staleTaskBanner,
  taskAge,
  taskAgeLabel,
  taskTitleFromIssue,
  taskTone,
  type CarryableTask,
} from "../../src/lib/facilityTasks";

const task = (over: Partial<CarryableTask> = {}): CarryableTask => ({
  id: "t",
  status: "open",
  carry_forward: true,
  target_shift: null,
  due_on: null,
  created_at: "2026-08-25",
  priority: "normal",
  ...over,
});

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

test("OPEN means not finished with — both live states", () => {
  eq(OPEN_TASK_STATUSES, ["open", "in_progress"]);
  ok(isTaskOpen(task({ status: "open" })));
  ok(isTaskOpen(task({ status: "in_progress" })));
  no(isTaskOpen(task({ status: "done" })));
  no(isTaskOpen(task({ status: "cancelled" })), "cancelled is inert, not outstanding");
});

// ---------------------------------------------------------------------------
// The carry-forward
// ---------------------------------------------------------------------------

test("openTasksForRun: only open, carried-forward tasks appear", () => {
  const tasks = [
    task({ id: "open" }),
    task({ id: "done", status: "done" }),
    task({ id: "cancelled", status: "cancelled" }),
    task({ id: "not-carried", carry_forward: false }),
  ];
  eq(openTasksForRun(tasks, "closing").map((t) => t.id), ["open"]);
});

test("openTasksForRun: a task aimed at CLOSING does not appear on the opening list", () => {
  const tasks = [
    task({ id: "any", target_shift: null }),
    task({ id: "closing-only", target_shift: "closing" }),
  ];
  eq(openTasksForRun(tasks, "closing").map((t) => t.id).sort(), ["any", "closing-only"]);
  eq(openTasksForRun(tasks, "opening").map((t) => t.id), ["any"]);
});

test("openTasksForRun: a run with NO shift sees everything", () => {
  // A walkthrough has no shift, and it should still show the backlog.
  const tasks = [task({ id: "a", target_shift: "closing" }), task({ id: "b" })];
  eq(openTasksForRun(tasks, null).map((t) => t.id).sort(), ["a", "b"]);
});

test("openTasksForRun: OLDEST first — the point of the band is what's been ignored longest", () => {
  const tasks = [
    task({ id: "new", created_at: "2026-08-28" }),
    task({ id: "old", created_at: "2026-08-20" }),
    task({ id: "mid", created_at: "2026-08-24" }),
  ];
  eq(openTasksForRun(tasks, "closing").map((t) => t.id), ["old", "mid", "new"]);
});

test("openTasksForRun: priority breaks a tie, and only a tie", () => {
  const tasks = [
    task({ id: "low-today", created_at: "2026-08-28", priority: "low" }),
    task({ id: "high-today", created_at: "2026-08-28", priority: "high" }),
    task({ id: "low-old", created_at: "2026-08-20", priority: "low" }),
  ];
  // Age wins over priority; within one day, high leads.
  eq(openTasksForRun(tasks, "closing").map((t) => t.id), [
    "low-old",
    "high-today",
    "low-today",
  ]);
});

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

test("daysBetween is UTC-pinned on both sides", () => {
  eq(daysBetween("2026-08-25", "2026-08-29"), 4);
  eq(daysBetween("2026-08-29", "2026-08-29"), 0);
  eq(daysBetween("2026-08-31", "2026-09-01"), 1, "across a month");
  eq(daysBetween("2026-12-31", "2027-01-01"), 1, "across a year");
  eq(daysBetween("2026-08-30", "2026-08-29"), -1, "and it can read backwards");
});

test("daysBetween tolerates a full timestamp on either side", () => {
  // `created_at` is a timestamptz, so the callers hand it the whole string.
  eq(daysBetween("2026-08-25T23:59:00Z", "2026-08-29T00:01:00Z"), 4);
});

test("taskAge never reads negative", () => {
  eq(taskAge({ created_at: "2026-08-30" }, "2026-08-29"), 0);
});

test("taskTone gets LOUDER, and is quiet for the first few nights", () => {
  const t = task({ created_at: "2026-08-25" });
  eq(taskTone(t, "2026-08-25"), "quiet", "day 0");
  eq(taskTone(t, `2026-08-${25 + TASK_STALE_DAYS - 1}`), "quiet", "the day before stale");
  eq(taskTone(t, `2026-08-${25 + TASK_STALE_DAYS}`), "mark", "stale");
  eq(taskTone(t, "2026-09-02"), "loud", `${TASK_OVERDUE_DAYS} days`);
});

test("taskTone: a missed DUE DATE is loud however young the task is", () => {
  eq(taskTone(task({ created_at: "2026-08-29", due_on: "2026-08-28" }), "2026-08-29"), "loud");
  eq(taskTone(task({ created_at: "2026-08-29", due_on: "2026-08-29" }), "2026-08-29"), "quiet");
});

test("taskAgeLabel is SILENT while a task is quiet", () => {
  // A note on every task from day one is the noise this whole mechanism exists
  // to avoid.
  eq(taskAgeLabel(task({ created_at: "2026-08-28" }), "2026-08-29"), null);
  eq(taskAgeLabel(task({ created_at: "2026-08-25" }), "2026-08-29"), "open 4 days");
  eq(
    taskAgeLabel(task({ created_at: "2026-08-29", due_on: "2026-08-27" }), "2026-08-29"),
    "2 days overdue",
  );
});

test("staleTaskBanner says nothing until something is actually stale", () => {
  const fresh = [task({ created_at: "2026-08-28" })];
  eq(staleTaskBanner(fresh, "2026-08-29"), null);

  const stale = [
    task({ id: "a", created_at: "2026-08-01" }),
    task({ id: "b", created_at: "2026-08-02" }),
    task({ id: "fresh", created_at: "2026-08-29" }),
  ];
  eq(
    staleTaskBanner(stale, "2026-08-29"),
    "2 open tasks have been outstanding more than a week",
  );
});

test("staleTaskBanner ignores tasks that are already finished with", () => {
  const done = [task({ created_at: "2026-08-01", status: "done" })];
  eq(staleTaskBanner(done, "2026-08-29"), null);
});

test("staleTaskBanner reads correctly for exactly one", () => {
  eq(
    staleTaskBanner([task({ created_at: "2026-08-01" })], "2026-08-29"),
    "1 open task has been outstanding more than a week",
  );
});

// ---------------------------------------------------------------------------
// Raising one from an issue
// ---------------------------------------------------------------------------

test("taskTitleFromIssue reads as a job, not a fragment", () => {
  eq(
    taskTitleFromIssue("Walk-in temperature", "reading 44, door seal torn"),
    "Walk-in temperature — reading 44, door seal torn",
  );
  eq(taskTitleFromIssue("Fryer wiped down", null), "Fryer wiped down");
  eq(taskTitleFromIssue("Fryer wiped down", "   "), "Fryer wiped down", "whitespace is no note");
});

test("issueAlreadyRaised stops three supervisors filing three tasks", () => {
  no(issueAlreadyRaised({ task_id: null }));
  ok(issueAlreadyRaised({ task_id: "abc" }));
});
