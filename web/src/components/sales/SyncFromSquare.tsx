"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { addDays } from "@/lib/payPeriods";

/**
 * Pull sales and tips from Square.
 *
 * ONE COMMAND, not two. There was a `Backfill…` beside this that walked every
 * month back to 2015; it did its job on 2026-08-23 (8,418 shop-days, eleven
 * years, five locations) and a button whose only purpose is a one-time
 * migration is dead machinery on the screen forever after. Re-pulling a deeper
 * range is a loop over this same function and belongs in a script, not in front
 * of somebody reading yesterday's takings.
 *
 * THE LOOP IS HERE, NOT IN THE EDGE FUNCTION. That function does ONE window,
 * because a single multi-year request is exactly the one that dies at the wall
 * clock having written nothing. Looping in the browser gives a progress line
 * for free, and migration 063's upsert makes a part-finished backfill harmless
 * — re-running a month re-lands it.
 *
 * COMPLETE DAYS ONLY — the pull STOPS AT YESTERDAY (Mark, 2026-08-28). The
 * shops are still trading today, so today's figure is a part-day: it lands in
 * the table looking exactly as authoritative as the fourteen complete days
 * beside it, drags every average down, and turns each comparison into
 * thirteen-and-a-bit days against fourteen. Worse, it is WRONG RATHER THAN
 * MISSING — pulling it again tomorrow corrects it, but nothing on the screen
 * says which of the two you are looking at.
 *
 * It costs nothing, because the rest of the screen already draws the line in
 * the same place: `missingDays` is passed YESTERDAY as its `through`, so a day
 * with no row is only reported as a gap once it is over. Today was never
 * counted as missing, and now it is never half-filled either.
 *
 * Yesterday in the ORG's calendar, never the browser's — `today` arrives from
 * `todayInTimeZone` on the server for that reason, and `addDays` is plain
 * string arithmetic (`new Date("2026-08-28")` is UTC midnight).
 *
 * Owner/admin only. `record_daily_sales` re-checks that itself; this just keeps
 * the button off a screen where pressing it could only fail.
 */
export function SyncFromSquare({ today }: { today: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  /** The last day the shops have finished trading. */
  const lastComplete = addDays(today, -1);

  async function run(months: { from: string; to: string }[], what: string) {
    setBusy(what);
    setResult(null);
    setWarnings([]);
    setFailed(null);

    let sales = 0;
    let tips = 0;
    const collected: string[] = [];

    for (const [i, m] of months.entries()) {
      setBusy(`${what} — ${m.from.slice(0, 7)} (${i + 1} of ${months.length})`);

      const { data, error } = await supabase.functions.invoke("sync-square-sales", {
        body: { from: m.from, to: m.to },
      });

      if (error) {
        // The SDK reports only "Edge Function returned a non-2xx status code"
        // unless you reach into FunctionsHttpError.context and re-parse the
        // body — where the real, actionable sentence lives.
        let message = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          const parsed = await ctx?.json();
          if (parsed?.error) message = parsed.error;
        } catch {
          /* keep the generic message */
        }
        setBusy(null);
        // Everything already written STAYS written — that is the whole point of
        // chunking — so the failure names where it stopped rather than
        // pretending the run did nothing.
        setFailed(
          months.length > 1
            ? `${message} (stopped at ${m.from.slice(0, 7)}; earlier months were saved)`
            : message
        );
        router.refresh();
        return;
      }

      const r = (data ?? {}) as {
        sales_upserted?: number;
        tips_written?: number;
        warnings?: string[];
      };
      sales += r.sales_upserted ?? 0;
      tips += r.tips_written ?? 0;
      if (r.warnings?.length) collected.push(...r.warnings);
    }

    setBusy(null);
    setResult(
      `${sales} shop-day${sales === 1 ? "" : "s"} pulled` +
        (tips ? `, ${tips} fed to the tip pool` : "") +
        "."
    );
    setWarnings(collected);
    router.refresh();
  }

  /** Whole calendar months, oldest first, clipped to `to`. */
  function monthsBetween(from: string, to: string) {
    const out: { from: string; to: string }[] = [];
    let cursor = `${from.slice(0, 7)}-01`;
    while (cursor <= to) {
      const [y, m] = cursor.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${cursor.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
      out.push({ from: cursor > from ? cursor : from, to: end < to ? end : to });
      cursor = addDays(end, 1);
    }
    return out;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={busy !== null}
          onClick={() => {
            // The ordinary case: this month and last, which covers every day
            // anybody is likely to be looking at and re-pulls recent days in
            // case a tip settled late — ending YESTERDAY, see the header.
            const from = addDays(`${today.slice(0, 7)}-01`, -1);
            void run(monthsBetween(`${from.slice(0, 7)}-01`, lastComplete), "Syncing");
          }}
        >
          Sync from Square
        </button>

      </div>

      {busy ? <ProgressBand label={busy} /> : null}

      {failed ? <p className="text-xs text-accent">{failed}</p> : null}
      {result && !failed ? (
        // The end date is NAMED. Somebody who presses this at 4pm and then
        // looks for today's takings needs to be told they were not asked for,
        // or the sync reads as having quietly failed on its most recent day.
        <p className="text-xs text-muted">
          {result} Complete days only, up to {lastComplete}.
        </p>
      ) : null}

      {warnings.length ? (
        // Warnings ride a SUCCESS: the pull happened, and a mapping complaint
        // or an unreadable figure must not be reported as a failed sync. But
        // they must be read — "was not a readable amount" is the money-unit
        // assumption failing out loud.
        <ul className="space-y-0.5 text-xs">
          {warnings.slice(0, 8).map((w, i) => (
            <li key={i}>
              <span className="bg-mark-fill px-1">{w}</span>
            </li>
          ))}
          {warnings.length > 8 ? (
            <li className="text-muted">…and {warnings.length - 8} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
