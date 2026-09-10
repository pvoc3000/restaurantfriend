// What each tablet landing tile says (lib/tablet/landingState) — the sentence
// and, where one thing in particular is waiting, the door straight to it.

import {
  batchLogsState,
  checklistState,
  planState,
  purchaseOrdersState,
  schedulesState,
  shiftReportState,
  specialOrdersState,
  tagsState,
  tasksState,
} from "../../src/lib/tablet/landingState";
import { eq, test } from "./harness";

test("one draft shift report opens its own runner", () => {
  eq(shiftReportState([{ id: "r1", shift: "closing" }]), {
    note: "Resume today's closing report",
    href: "/shift-reports/r1/run",
  });
});

test("no draft, or several, stays on the list", () => {
  eq(shiftReportState([]), { note: "No report yet today" });
  eq(
    shiftReportState([
      { id: "a", shift: "opening" },
      { id: "b", shift: "closing" },
    ]),
    { note: "2 drafts today" }
  );
});

test("checklist: one open run is the door; the counts name what is left", () => {
  eq(checklistState({ asked: 2, started: 1, openRuns: [{ id: "x" }] }), {
    note: "1 not started, 1 in progress",
    href: "/checklists/x/run",
  });
  eq(checklistState({ asked: 1, started: 1, openRuns: [] }), { note: "Done for today", href: undefined });
  eq(checklistState({ asked: 0, started: 0, openRuns: [] }), { note: "None asked for today", href: undefined });
  eq(checklistState({ asked: 2, started: 2, openRuns: [{ id: "a" }, { id: "b" }] }), {
    note: "2 in progress",
    href: undefined,
  });
});

test("tasks count the open ones and name the ones pinned for you", () => {
  eq(tasksState({ open: 0, pinned: 0 }), { note: "Nothing open" });
  eq(tasksState({ open: 1, pinned: 0 }), { note: "1 open task" });
  eq(tasksState({ open: 5, pinned: 3 }), { note: "5 open tasks, 3 pinned for you" });
});

test("plans in force: none, one, two, many", () => {
  eq(planState([]), { note: "No plan in force today" });
  eq(planState(["Fall 2026 - DF02"]), { note: "Fall 2026 - DF02" });
  eq(planState(["A", "B"]), { note: "A + B" });
  eq(planState(["A", "B", "C"]), { note: "A + 2 more" });
});

test("the rest are one sentence each way", () => {
  eq(schedulesState({ tomorrow: 1 }).note, "Tomorrow's schedule is made");
  eq(schedulesState({ tomorrow: 0 }).note, "Nothing generated for tomorrow yet");
  eq(tagsState({ onPlan: 23 }).note, "23 on today's plan");
  eq(tagsState({ onPlan: 0 }).note, "None on today's plan");
  eq(purchaseOrdersState({ open: 4 }).note, "4 awaiting delivery");
  eq(purchaseOrdersState({ open: 0 }).note, "Nothing awaiting delivery");
  eq(specialOrdersState({ thisWeek: 3 }).note, "3 this week");
  eq(specialOrdersState({ thisWeek: 0 }).note, "None this week");
});

test("batch logs: no log, all done, or how many to do", () => {
  eq(batchLogsState({ logs: 0, outstanding: 0 }).note, "No batch log from today on");
  eq(batchLogsState({ logs: 1, outstanding: 0 }).note, "Every batch is done");
  eq(batchLogsState({ logs: 1, outstanding: 1 }).note, "1 batch to do");
  eq(batchLogsState({ logs: 2, outstanding: 7 }).note, "7 batches to do");
});
