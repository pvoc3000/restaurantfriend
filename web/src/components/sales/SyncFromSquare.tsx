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
 * EVERY DAY, INCLUDING THE ONE STILL BEING TAKEN (Mark, 2026-08-31, reversing
 * his own 2026-08-28 call: "I take that back. Let's go back to loading all
 * sales data and making a note when a day's data is incomplete.").
 *
 * The pull used to stop at YESTERDAY, because today's figure is a part-day that
 * "lands in the table looking exactly as authoritative as the fourteen complete
 * days beside it". That was right about the risk and wrong about the remedy:
 * today's takings are the figure a manager most wants at 4pm, and the answer to
 * a number needing a caveat is the caveat rather than the absence.
 *
 * So the caveat is real and lives in ONE place — `isDayComplete` in
 * `lib/sales`, which compares a row's `synced_at` against the end of the
 * reporting day it covers. That is deliberately not "is this date today": a row
 * pulled at 4pm on Tuesday and never pulled again is a part-day forever, and a
 * date test would quietly call it settled by Thursday.
 *
 * `today` is the ORG's calendar day, never the browser's — it arrives from
 * `todayInTimeZone` on the server for that reason.
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
            // case a tip settled late — up to and including TODAY, whose figure
            // the screen then marks as still being taken.
            const from = addDays(`${today.slice(0, 7)}-01`, -1);
            void run(monthsBetween(`${from.slice(0, 7)}-01`, today), "Syncing");
          }}
        >
          Sync from Square
        </button>

      </div>

      {busy ? <ProgressBand label={busy} /> : null}

      {failed ? <p className="text-xs text-accent">{failed}</p> : null}
      {result && !failed ? (
        // The end date is NAMED, and so is what today's figure is worth: a pull
        // at 4pm gets four hours of trading, and somebody reading the total
        // straight afterwards should not have to work that out.
        <p className="text-xs text-muted">
          {result} Up to {today}, whose figure is still being taken.
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
