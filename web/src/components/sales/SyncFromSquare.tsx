"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { ControlField } from "@/components/ui/ControlField";
import { RangePicker } from "@/components/ui/RangePicker";
import { addDays } from "@/lib/payPeriods";
import type { DateRange, RangePresetSpec } from "@/lib/dateRange";

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
/** What `SalesActions` seats in its menu: the command, without the button. */
export type SyncRow = { label: string; onSelect: () => void; disabled: boolean };

export function SyncFromSquare({
  today,
  range,
  children,
}: {
  today: string;
  /**
   * Pull exactly these days instead of asking which. The Close Pay
   * Period panel passes its period (2026-09-29), because a tip figure is only
   * written for a day an open period covers, and the fix for a missing one
   * belongs where the panel reports it.
   */
  range?: { from: string; to: string };
  /** Given, the command is handed out as a row (`OrderCommandMenu`'s render-prop
   *  shape) and this draws only its progress and warnings beneath; otherwise
   *  it draws its own button. */
  children?: (row: SyncRow) => ReactNode;
}) {
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
    let payouts = 0;
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
        payouts_upserted?: number;
        warnings?: string[];
      };
      sales += r.sales_upserted ?? 0;
      tips += r.tips_written ?? 0;
      payouts += r.payouts_upserted ?? 0;
      if (r.warnings?.length) collected.push(...r.warnings);
    }

    setBusy(null);
    setResult(
      `${sales} shop-day${sales === 1 ? "" : "s"} pulled` +
        (tips ? `, ${tips} fed to the tip pool` : "") +
        (payouts ? `, ${payouts} payout${payouts === 1 ? "" : "s"}` : "") +
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

  /**
   * THE ORDINARY CASE ASKS WHICH DAYS (Mark, 2026-10-21), defaulting to the
   * last seven, and pulls every one of them — no skipping days already pulled,
   * because "pulled" is not "final": the 10-06 offline register uploaded 37
   * payments the next morning, after its day had been pulled after closing.
   *
   * It used to be this month and last, whole and unasked — 51 days × 2 shops
   * on Oct 21, re-pulling some 100 settled shop-days every press. Seven days is
   * what can still move (offline uploads, refunds, tip adjustments); a deeper
   * re-pull is a choice somebody now makes in the same dialog. The days on
   * screen play no part: what you are LOOKING at is a view, and a 90-day view
   * should not make the pull slower.
   *
   * A caller with a `range` skips the question — the Close Pay Period panel's
   * range IS the answer.
   */
  const lastSeven = (t: string): DateRange => ({ from: addDays(t, -6), to: t });
  const presets: RangePresetSpec[] = [
    { key: "last_7_days", label: "Last 7 Days", range: lastSeven },
    "today",
    "yesterday",
    "this_month",
    "last_month",
  ];
  const [asking, setAsking] = useState(false);
  const [chosen, setChosen] = useState<DateRange>(() => lastSeven(today));
  const [pulledTo, setPulledTo] = useState(today);

  // Up to and including TODAY, whose figure the screen marks as still being
  // taken. Never past today: Square has nothing for tomorrow.
  const pull = (r: DateRange) => {
    const to = r.to < today ? r.to : today;
    setPulledTo(to);
    void run(monthsBetween(r.from, to), "Syncing");
  };
  const sync = () => {
    if (range) {
      pull(range);
      return;
    }
    setChosen(lastSeven(today));
    setAsking(true);
  };
  const canPull = chosen.from <= today;
  const confirm = () => {
    if (!canPull) return;
    setAsking(false);
    pull(chosen);
  };
  const label = range ? "Sync from Square" : "Sync from Square…";

  return (
    // RIGHT-ALIGNED AS A BLOCK (Mark, 2026-09-13: the button "should be
    // aligned top right even when there's text below it"). The block was as
    // wide as its longest line, with the button at that block's LEFT edge, so a
    // result sentence underneath pulled it inward. `items-end` pins every child
    // to the right margin, and the sentences read right-aligned beneath it.
    <div className="flex flex-col items-end gap-2 text-right">
      {children ? (
        children({ label, onSelect: sync, disabled: busy !== null })
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={BUTTON_CLASS} disabled={busy !== null} onClick={sync}>
            {label}
          </button>
        </div>
      )}

      {asking ? (
        <Dialog
          title="Sync from Square"
          onClose={() => setAsking(false)}
          width="max-w-md"
          onSubmit={confirm}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} disabled={!canPull} onClick={confirm}>
                Sync
              </button>
            </div>
          }
        >
          <div className="text-left">
            <ControlField label="Dates to pull">
              <RangePicker
                value={chosen}
                onChange={(picked) => {
                  if (picked) setChosen(picked);
                }}
                presets={presets}
                today={today}
                ariaLabel="Which days to pull from Square"
                clearable={false}
                boxed
              />
            </ControlField>
          </div>
        </Dialog>
      ) : null}

      {busy ? <ProgressBand label={busy} /> : null}

      {failed ? <p className="text-xs text-accent">{failed}</p> : null}
      {result && !failed ? (
        // The end date is NAMED, and so is what today's figure is worth: a pull
        // at 4pm gets four hours of trading, and somebody reading the total
        // straight afterwards should not have to work that out.
        <p className="text-xs text-muted">
          {result} Up to {pulledTo}
          {pulledTo === today ? ", whose figure is still being taken." : "."}
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
