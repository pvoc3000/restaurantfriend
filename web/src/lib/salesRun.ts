/**
 * THE MORNING SALES RUN, as the Sales screen reads it (migration 212).
 *
 * `sales-nightly` syncs from Square, posts to QuickBooks and emails a summary
 * at 7 AM (Mark, 2026-10-29). Its rules — the window, the fix each problem
 * carries, the email — are `supabase/functions/_shared/salesAutomation.ts`;
 * this is only what the screen needs to say about the latest run: whether it
 * needs somebody, whether it is late, whether it stopped without finishing.
 */

import { zonedParts } from "./timeZone";

/** After this hour the screen says the morning's run is late. The run itself
 *  is at 7; an hour is room for a slow Square. */
export const OVERDUE_HOUR = 8;

/** A run still marked running after this long was cut off — the function's
 *  wall-clock limit is minutes, not this. */
export const STUCK_MINUTES = 20;

/** `RunProblem` in `_shared/salesAutomation.ts`, as stored in the row. */
export type RunProblem = {
  kind: string;
  shop?: string;
  date?: string;
  message: string;
  fix: string;
  href?: string;
  hrefLabel?: string;
};

export type SalesRun = {
  id: string;
  trigger: "cron" | "manual";
  dry_run: boolean;
  local_date: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "attention" | "failed";
  problems: RunProblem[];
  emailed_to: string | null;
  email_error: string | null;
};

export type SalesRunSettings = {
  enabled: boolean;
  botUserId: string | null;
};

export function readSalesRunSettings(settings: Record<string, unknown> | null | undefined): SalesRunSettings {
  const s = ((settings ?? {}).sales_automation ?? {}) as Record<string, unknown>;
  return {
    enabled: s.enabled === true,
    botUserId: typeof s.bot_user_id === "string" && s.bot_user_id ? s.bot_user_id : null,
  };
}

/** A run that was marked running and never finished. */
export function isStuck(run: Pick<SalesRun, "status" | "started_at">, now: number): boolean {
  return run.status === "running" && now - Date.parse(run.started_at) > STUCK_MINUTES * 60_000;
}

/**
 * The morning's run is LATE: it is on, it is past the overdue hour in the
 * org's zone, and no real run has finished today. A run that finished with
 * problems is not late — its own banner says what is wrong.
 */
export function isOverdue(input: {
  enabled: boolean;
  now: number;
  zone: string;
  lastFinishedLocalDate: string | null;
}): boolean {
  if (!input.enabled) return false;
  const w = zonedParts(input.zone, input.now);
  if (w.hour < OVERDUE_HOUR) return false;
  const today = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  return input.lastFinishedLocalDate !== today;
}

/** The problems a run leaves for somebody, with an email that did not go
 *  counted as one — the email is how anybody learns of the rest. */
export function runProblems(run: SalesRun, now: number): RunProblem[] {
  const out = [...(run.problems ?? [])];
  if (isStuck(run, now)) {
    out.push({
      kind: "crash",
      message: "The run stopped without finishing.",
      fix: "Press Run Now. If it stops again, the function's log in Supabase says why.",
    });
  }
  if (run.finished_at && run.email_error) {
    out.push({
      kind: "email",
      message: `The summary email was not sent: ${run.email_error}`,
      fix: "Check the org's mailbox in Settings → Messages; the run itself is unaffected.",
      href: "/settings?tab=messages",
      hrefLabel: "Messages settings",
    });
  }
  return out;
}

/** The banner's state at this moment — `todayInTimeZone`'s shape: the clock is
 *  read here, once, so a server component renders from one instant. */
export function morningRunNow(input: {
  enabled: boolean;
  zone: string;
  lastFinishedLocalDate: string | null;
}): { now: number; overdue: boolean } {
  const now = Date.now();
  return { now, overdue: isOverdue({ ...input, now }) };
}
