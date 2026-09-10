// WHAT EACH LANDING TILE SAYS ABOUT TODAY (Mark, 2026-09-09: tiles carry live
// state). Pure sentence builders over numbers the page has already counted, so
// the wording is fixture-tested and the page is only queries.
//
// Every builder returns `{ note, href? }`: one muted line under the tile's
// label, and — where one thing in particular is waiting — a more specific
// destination than the tile's own. The rule for the line is the shift
// report's own: say what is OUTSTANDING, and say nothing when there is
// nothing to say. A tile that always has a sentence teaches people not to
// read the sentences.

import { SHIFT_SLOT_LABEL, type ShiftSlot } from "../employeeEvents";

export type TileState = { note: string | null; href?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * ONE draft goes straight into its runner (Mark deferred to this): "Resume
 * tonight's closing report" is the whole reason the tile exists. None or
 * several fall back to the list, which can show them side by side.
 */
export function shiftReportState(drafts: readonly { id: string; shift: ShiftSlot }[]): TileState {
  if (drafts.length === 1) {
    const d = drafts[0];
    return {
      note: `Resume today's ${SHIFT_SLOT_LABEL[d.shift].toLowerCase()} report`,
      href: `/shift-reports/${d.id}/run`,
    };
  }
  if (drafts.length > 1) return { note: `${drafts.length} drafts today` };
  return { note: "No report yet today" };
}

/**
 * `asked` is how many active templates today's weekday calls for, `started`
 * how many of those have a run today, `openRuns` the runs still open. One
 * open run is the runner's own door.
 */
export function checklistState(input: {
  asked: number;
  started: number;
  openRuns: readonly { id: string }[];
}): TileState {
  const href = input.openRuns.length === 1 ? `/checklists/${input.openRuns[0].id}/run` : undefined;
  const notStarted = Math.max(0, input.asked - input.started);
  if (input.asked === 0) return { note: "None asked for today", href };
  if (notStarted === 0 && input.openRuns.length === 0) return { note: "Done for today", href };
  const parts: string[] = [];
  if (notStarted > 0) parts.push(`${notStarted} not started`);
  if (input.openRuns.length > 0) parts.push(`${input.openRuns.length} in progress`);
  return { note: parts.join(", "), href };
}

/** `pinned` is the subset in front of THIS person tonight (`openTasksForRun`). */
export function tasksState(input: { open: number; pinned: number }): TileState {
  if (input.open === 0) return { note: "Nothing open" };
  const pinned = input.pinned > 0 ? `, ${input.pinned} pinned for you` : "";
  return { note: `${plural(input.open, "open task")}${pinned}` };
}

/** The titles of the plans in force today — several can be (decision 9). */
export function planState(titles: readonly string[]): TileState {
  if (titles.length === 0) return { note: "No plan in force today" };
  if (titles.length <= 2) return { note: titles.join(" + ") };
  return { note: `${titles[0]} + ${titles.length - 1} more` };
}

export function schedulesState(input: { tomorrow: number }): TileState {
  return {
    note: input.tomorrow > 0 ? "Tomorrow's schedule is made" : "Nothing generated for tomorrow yet",
  };
}

export function tagsState(input: { onPlan: number }): TileState {
  return { note: input.onPlan > 0 ? `${input.onPlan} on today's plan` : "None on today's plan" };
}

/** `open` is draft + sent: orders a delivery is still owed on. */
export function purchaseOrdersState(input: { open: number }): TileState {
  return { note: input.open > 0 ? `${input.open} awaiting delivery` : "Nothing awaiting delivery" };
}

export function specialOrdersState(input: { thisWeek: number }): TileState {
  return { note: input.thisWeek > 0 ? `${input.thisWeek} this week` : "None this week" };
}

/**
 * Batch logs are a checklist somebody works down (044): what matters is how
 * many batches on the logs from today forward are still to do.
 */
export function batchLogsState(input: { logs: number; outstanding: number }): TileState {
  if (input.logs === 0) return { note: "No batch log from today on" };
  if (input.outstanding === 0) return { note: "Every batch is done" };
  return { note: `${plural(input.outstanding, "batch", "batches")} to do` };
}
