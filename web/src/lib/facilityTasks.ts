/**
 * Tasks and maintenance requests — the pure half.
 *
 * Migration 075 is the schema. One table, two screens, told apart by `kind`:
 * a task is something the crew does, a maintenance request is something a
 * vendor does, and promoting one to the other is an UPDATE.
 *
 * THE RULE THIS FILE EXISTS FOR (Mark, 2026-08-29): "anything flagged in a
 * walkthrough could be added to every subsequent supervisor's checklist until
 * it's completed."
 *
 * That is a good idea with one failure mode, and everything below is aimed at
 * it: a task flagged and never done appears on thirty consecutive checklists
 * IDENTICALLY, and by night four supervisors have learned to scroll past the
 * section that also holds tonight's real work. So the carried-forward row is
 * not just repeated — it AGES, visibly, and anything old enough is escalated
 * somewhere a manager reads.
 */

import type { ShiftSlot } from "./employeeEvents";

export type TaskKind = "task" | "maintenance";

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  task: "Task",
  maintenance: "Maintenance",
};

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export type TaskPriority = "low" | "normal" | "high";

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

/**
 * OPEN means "not finished with", which is both live states.
 *
 * `/purchase-orders`' roll-up made the same distinction and its lesson applies:
 * open reads as NOT INERT rather than as "not done". `done` and `cancelled` are
 * both inert; only these two are outstanding work.
 */
export const OPEN_TASK_STATUSES: TaskStatus[] = ["open", "in_progress"];

export function isTaskOpen(task: { status: TaskStatus }): boolean {
  return OPEN_TASK_STATUSES.includes(task.status);
}

// ---------------------------------------------------------------------------
// The carry-forward
// ---------------------------------------------------------------------------

export type CarryableTask = {
  id: string;
  status: TaskStatus;
  carry_forward: boolean;
  /** Null means any shift. */
  target_shift: string | null;
  due_on: string | null;
  created_at: string;
  priority: TaskPriority;
  /** 079. An app user (`org_members.user_id`), or null for anybody. */
  assigned_to?: string | null;
};

/**
 * Who is looking, and who still works here.
 *
 * `memberIds` is the org's CURRENT membership, and it is not bookkeeping: 079's
 * column has no `on delete` clause because revoking access BANS an auth user
 * rather than deleting it (4c), so an assignment outlives the person's login.
 * Without this set, the day somebody leaves every task assigned to them stops
 * appearing on any checklist at all — silently, which is the one failure this
 * whole module is built to prevent. An orphaned assignment falls back to
 * everybody.
 *
 * Omit it and no orphan check runs, which is the right behaviour for a caller
 * that genuinely does not have the roster: an assigned task then simply belongs
 * to its assignee.
 */
export type TaskViewer = {
  /** The signed-in user, or null when nobody is (a printed sheet). */
  viewerId: string | null;
  memberIds?: ReadonlySet<string>;
};

/**
 * Is this task in front of THIS person?
 *
 * Three answers, in order, and the order is the whole rule:
 *   · unassigned  — anybody's, which is the resting state and most tasks.
 *   · orphaned    — assigned to somebody who is no longer a member, so it goes
 *                   back to being anybody's rather than disappearing.
 *   · assigned    — theirs alone.
 *
 * A null viewer (nobody signed in) sees only the unassigned and the orphaned:
 * "this is for Karina" is a true thing to leave off a sheet nobody's name is on.
 */
export function taskIsFor(
  task: { assigned_to?: string | null },
  viewer: TaskViewer,
): boolean {
  const to = task.assigned_to ?? null;
  if (to === null) return true;
  if (viewer.memberIds && !viewer.memberIds.has(to)) return true;
  return to === viewer.viewerId;
}

/** Assigned to somebody who has left — the case `taskIsFor` reopens to all. */
export function assignmentIsOrphaned(
  task: { assigned_to?: string | null },
  memberIds: ReadonlySet<string>,
): boolean {
  const to = task.assigned_to ?? null;
  return to !== null && !memberIds.has(to);
}

/**
 * Which open tasks go in front of tonight's supervisor.
 *
 * Three filters and each one is a real case:
 *
 *   · OPEN only — a done or cancelled task has left the building.
 *   · `carry_forward` — false is the standing job somebody wants tracked
 *     without putting it in front of a supervisor every single night.
 *   · TARGET SHIFT — "boil out the fryer before morning" is the closing shift's
 *     job and "call the linen company" is anybody's, so null means any and a
 *     named shift means only that one.
 *   · ASSIGNMENT (079) — "when assigned they only appear on that person's
 *     checklist". `taskIsFor` carries the orphan rule with it, which is why the
 *     viewer is a whole object rather than an id.
 *
 * Order: the oldest first, because the point of the band is the thing that has
 * been ignored longest. Priority breaks ties — a high-priority job raised today
 * should not sit under a low one raised on Tuesday, but age is what this list
 * is about.
 */
export function openTasksForRun<T extends CarryableTask>(
  tasks: T[],
  shift: ShiftSlot | null,
  // REQUIRED, with no default. A default of "nobody" would hide every assigned
  // task from a caller that simply forgot to pass one — silently, which is the
  // failure this file exists to prevent. A compile error is the cheaper way to
  // find out.
  viewer: TaskViewer,
): T[] {
  const rank: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
  return tasks
    .filter((t) => isTaskOpen(t))
    .filter((t) => t.carry_forward)
    .filter((t) => !t.target_shift || !shift || t.target_shift === shift)
    .filter((t) => taskIsFor(t, viewer))
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      const r = rank[a.priority] - rank[b.priority];
      if (r !== 0) return r;
      return a.id < b.id ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// Age, and getting louder
// ---------------------------------------------------------------------------

/** Whole days between two YYYY-MM-DD dates. Never `new Date(x) - new Date(y)`
 *  on a local string — `new Date("2026-08-29")` is UTC midnight, so the answer
 *  moves for everyone west of Greenwich. Both sides are pinned to UTC here. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function taskAge(task: { created_at: string }, today: string): number {
  return Math.max(0, daysBetween(task.created_at, today));
}

/**
 * How loud a carried-forward row should be.
 *
 * `quiet` for the first few nights — it is simply tonight's work. `mark` once
 * it has been ignored for most of a week. `loud` past a week, which is also
 * what the escalation band counts.
 *
 * Tones, not colours: the caller maps them, because "yellow is a FILL, never an
 * ink" is a rule about rendering and this module renders nothing.
 */
export type TaskTone = "quiet" | "mark" | "loud";

export const TASK_STALE_DAYS = 4;
export const TASK_OVERDUE_DAYS = 8;

export function taskTone(task: CarryableTask, today: string): TaskTone {
  if (task.due_on && daysBetween(task.due_on, today) > 0) return "loud";
  const age = taskAge(task, today);
  if (age >= TASK_OVERDUE_DAYS) return "loud";
  if (age >= TASK_STALE_DAYS) return "mark";
  return "quiet";
}

/**
 * The words beside an aged row. Silent while it is quiet — a note on every task
 * from day one is the noise this whole mechanism is trying to avoid.
 */
export function taskAgeLabel(task: CarryableTask, today: string): string | null {
  if (task.due_on) {
    const over = daysBetween(task.due_on, today);
    if (over > 0) return `${over} day${over === 1 ? "" : "s"} overdue`;
  }
  const age = taskAge(task, today);
  if (age < TASK_STALE_DAYS) return null;
  return `open ${age} days`;
}

/**
 * The escalation band's own sentence, or null when there is nothing to say.
 *
 * This is the half of the carry-forward that stops it becoming wallpaper: after
 * a week something has to surface where a MANAGER reads rather than only in
 * front of whoever is closing tonight.
 */
export function staleTaskBanner(tasks: CarryableTask[], today: string): string | null {
  const loud = tasks.filter((t) => isTaskOpen(t) && taskTone(t, today) === "loud");
  if (loud.length === 0) return null;
  return `${loud.length} open ${loud.length === 1 ? "task has" : "tasks have"} been outstanding more than a week`;
}

// ---------------------------------------------------------------------------
// Raising a task from a checklist issue
// ---------------------------------------------------------------------------

/**
 * The title a task gets when it is raised from a flagged item.
 *
 * The item's PROMPT is what it is about ("Walk-in temperature"), and the
 * supervisor's NOTE is what is wrong ("reading 44, door seal torn"). Both, in
 * that order, so the task reads as a job rather than as a fragment.
 */
export function taskTitleFromIssue(prompt: string, note: string | null): string {
  const n = note?.trim();
  if (!n) return prompt;
  return `${prompt} — ${n}`;
}

/**
 * Has this issue already been reported?
 *
 * Without this, three supervisors flag the same fryer on three nights and file
 * three tasks. The run item carries `task_id` once it has been raised, and
 * night two shows "already reported" rather than a second button.
 */
export function issueAlreadyRaised(item: { task_id: string | null }): boolean {
  return item.task_id != null;
}
