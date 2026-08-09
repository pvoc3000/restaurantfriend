"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { TextInput } from "@/components/ui/TextInput";
import {
  daysBetween,
  formatPeriodRange,
  isoWeekday,
  nextPeriodAfter,
  overlapsAny,
  payrollSettings,
  periodContaining,
  type PayrollSettings,
  type PeriodRange,
} from "@/lib/payPeriods";

const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Open the next fortnight.
 *
 * The `NewEmployee` template: a command right-aligned in the filter row →
 * `ui/Dialog` → insert → land on the new record. Since 2026-08-06 the "record"
 * is the Timesheets screen scoped to the new period — the pay-period record
 * screen is gone, and this is the only thing that ever pushed to it.
 *
 * It PROPOSES rather than dictates. The proposal continues the cadence from the
 * last period that exists — the day after it ends, for `period_days` — which is
 * what keeps the sequence unbroken even if someone's idea of the anchor day
 * changes; only when there are no periods at all does it fall back to snapping
 * to the anchor weekday. Both dates stay editable, because a real calendar
 * eventually needs a short period (a provider switch, a year-end) and refusing
 * one would send you to the SQL editor.
 *
 * What it will not let you do is create an OVERLAP. Migration 027's exclusion
 * constraint refuses one outright, so without this check the reader would get a
 * raw Postgres exclusion-constraint error; with it, they get the sentence and
 * the period it collides with.
 */
export function NewPayPeriod({
  rows,
  today,
  settings: rawSettings,
  orgId,
}: {
  /** Every period, for the cadence and the overlap check. Only the two dates are
   *  read, so this asks for the narrowest thing that satisfies it — it used to
   *  take the deleted pay-period list's own row type. */
  rows: readonly PeriodRange[];
  today: string;
  settings?: unknown;
  /** Required by 027's insert policy — see the note on the insert itself. */
  orgId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const settings: PayrollSettings = useMemo(() => payrollSettings(rawSettings), [rawSettings]);

  // The latest period by END date — not by created_at, and not the first row of
  // whatever order the list happens to be in.
  const last = useMemo(
    () =>
      rows.reduce<PeriodRange | null>(
        (best, r) => (best === null || r.end_date > best.end_date ? r : best),
        null
      ),
    [rows]
  );

  const proposal = useMemo(
    () => (last ? nextPeriodAfter(last.end_date, settings) : periodContaining(today, settings)),
    [last, settings, today]
  );

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(proposal.start_date);
  const [end, setEnd] = useState<string | null>(proposal.end_date);
  const [notes, setNotes] = useState("");

  function close() {
    if (pending) return;
    setOpen(false);
    setStart(proposal.start_date);
    setEnd(proposal.end_date);
    setNotes("");
    setFailed(null);
  }

  const range = useMemo(
    () => (start && end ? { start_date: start, end_date: end } : null),
    [start, end]
  );
  const backwards = range !== null && range.end_date < range.start_date;
  const collision = useMemo(() => {
    if (!range || backwards) return null;
    if (!overlapsAny(range, rows)) return null;
    return rows.find((r) => overlapsAny(range, [r])) ?? null;
  }, [range, rows, backwards]);

  const ready = range !== null && !backwards && collision === null && !pending;

  // Said, never enforced. The fortnight is org configuration (design rule 2)
  // and 024's lesson is that a statement true of finished data can still be
  // wrong as a constraint — a short period at a provider switch is legal.
  const notices: string[] = [];
  if (range && !backwards) {
    const n = daysBetween(range.start_date, range.end_date);
    if (n !== settings.period_days) {
      notices.push(`${n} days, where this org's periods are normally ${settings.period_days}.`);
    }
    const dow = isoWeekday(range.start_date);
    if (dow !== settings.period_starts_on) {
      notices.push(
        `Starts on a ${WEEKDAY[dow]}, where this org's periods normally start on a ${WEEKDAY[settings.period_starts_on]}.`
      );
    }
    // Inclusive day counts, so "the day after" is 2. Anything larger is a gap;
    // anything smaller is an overlap, which `collision` has already refused.
    if (last && daysBetween(last.end_date, range.start_date) > 2) {
      notices.push(
        `Leaves a gap after ${formatPeriodRange(last)} — the hours in between would have no period to belong to.`
      );
    }
  }

  function add() {
    if (!ready || !range) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("pay_periods")
        .insert({
          // WITHOUT THIS THE INSERT IS REFUSED AS AN RLS VIOLATION, and the
          // message names the policy rather than the missing column, which is
          // what made this hard to read (Mark, 2026-08-05). 027's
          // `pay_periods_insert` is `with check (user_has_role(org_id, …))`, and
          // a WITH CHECK is evaluated BEFORE the NOT NULL constraint — so an
          // omitted org_id reaches the policy as null, `user_has_role(null, …)`
          // is not true, and Postgres reports the policy it actually failed.
          //
          // Nothing had ever caught it because all 177 existing periods came
          // from the service_role loader, which bypasses RLS entirely. Every
          // other insert in the app passes org_id explicitly; this was the one
          // that didn't.
          org_id: orgId,
          start_date: range.start_date,
          end_date: range.end_date,
          // A new period is always open. The ladder only ever moves forward
          // from here, and the historical load is the one thing that writes
          // `closed` directly.
          status: "open",
          notes: notes.trim() === "" ? null : notes.trim(),
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The pay period could not be created.");
        return;
      }
      router.refresh();
      router.push(`/timesheets?period=${data.id as string}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        New pay period
      </button>

      {open && (
        <Dialog
          title="New pay period"
          onClose={close}
          busy={pending}
          // Enter commits, guarded by exactly what the commit button's
          // `disabled` asks — an Enter that fires a refused write is worse
          // than one that does nothing.
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-xl"
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button type="button" onClick={add} disabled={!ready} className={DIALOG_COMMIT_CLASS}>
                {pending ? "Opening…" : "Open period"}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <p className="max-w-[60ch] text-sm text-muted">
              {last
                ? `The last period ended ${last.end_date}. This one continues from the day after.`
                : "The first period. It starts on this org's usual payroll weekday."}
            </p>

            <div className="flex flex-wrap items-end gap-6">
              <label className="space-y-1.5">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                  Starts
                </span>
                <DateField value={start} onChange={setStart} ariaLabel="Period start date" />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                  Ends
                </span>
                <DateField value={end} onChange={setEnd} ariaLabel="Period end date" />
              </label>
              {range && !backwards && (
                <p className="pb-1 text-sm text-muted">
                  {formatPeriodRange(range)} · {daysBetween(range.start_date, range.end_date)} days
                </p>
              )}
            </div>

            <label className="block space-y-1.5">
              <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                Note
              </span>
              <TextInput
                value={notes}
                onValueChange={setNotes}
                placeholder="Optional"
                aria-label="Note"
                clearLabel="Clear the note"
                className="w-full"
              />
            </label>

            {backwards && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">
                The end date is before the start date.
              </p>
            )}

            {/* A collision is FATAL — the database refuses it — so it reads as
                an error, where the notices below are yellow and passable. */}
            {collision && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">
                This overlaps {formatPeriodRange(collision)}, which already
                exists. Pay periods can&rsquo;t overlap — that is what makes
                &ldquo;which period owns this shift&rdquo; a question with one
                answer.
              </p>
            )}

            {notices.length > 0 && !collision && !backwards && (
              <div className="space-y-1 border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
                {notices.map((n) => (
                  <p key={n}>{n}</p>
                ))}
                <p className="text-[13px]">
                  That may be exactly right — it isn&rsquo;t blocked.
                </p>
              </div>
            )}

            {failed && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
