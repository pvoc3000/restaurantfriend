"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { packetDate } from "@/lib/productionSchedule";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";

/**
 * "Generate schedules" — production brief decision 7.
 *
 * There is no nightly cron and there never will be: generation is part of the
 * supervisor's closing routine, and the dialog takes a start date, a NUMBER OF
 * DAYS and a location set because generating ahead is a real workflow — closed
 * days, long weekends, a supervisor who won't be in. FMP's own generator dialog
 * takes exactly these three.
 *
 * Everything else FMP put around it is gone. Its Skip/Continue gauntlet, its
 * overwrite warning and its "locked" flag all existed because a pre-generated
 * document was the only place to store intent about a future date; par
 * overrides are that intent now, so an existing day is simply SKIPPED and
 * reported, and regenerating one is a second, explicit press.
 */

type Created = {
  schedule_id: string;
  date: string;
  location_code: string;
  kitchen_code: string;
  line_count: number;
  par_total: number;
};

type Skipped = Created & { reason: string; has_actuals: boolean };

type Replaced = {
  schedule_id: string;
  date: string;
  location_code: string;
  kitchen_code: string;
  lines_before: number;
  lines_after: number;
  actuals_carried: number;
  actuals_lost: number;
  manual_kept: number;
};

type Warning = {
  kind: string;
  date: string;
  location_code: string;
  item_name: string;
  detail: string;
};

type Receipt = {
  start: string;
  days: number;
  created: Created[];
  skipped: Skipped[];
  replaced: Replaced[];
  warnings: Warning[];
};

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28].map((n) => ({
  value: String(n),
  label: n === 1 ? "1 day" : `${n} days`,
}));

/** Yellow, never red: every one of these names something worth an eye, and the
 *  generation went ahead anyway — the under-minimum-vendor pattern. */
const WARNING_TITLE: Record<string, string> = {
  overlapping_plans: "Pars summed",
  kitchen_split_override: "Override went to one kitchen",
  kitchen_assumed: "Kitchen assumed",
  not_made: "Not made",
};

export function GenerateSchedules({
  locations,
  today,
}: {
  locations: { id: string; code: string; name: string }[];
  today: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(today);
  const [days, setDays] = useState("1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ignoreSpecial, setIgnoreSpecial] = useState(false);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setStart(today);
    setDays("1");
    setIgnoreSpecial(false);
    // Every active shop, preselected. Unlike the PO generator there is no
    // per-location guard to encode here — an already-generated day is reported
    // by the function itself rather than guessed at up front, because "which
    // kitchens does this day involve" is only answerable from the plans.
    setSelected(new Set(locations.map((l) => l.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(replace: boolean, allowActuals: boolean) {
    if (!start) return;
    setRunning(true);
    setError(null);

    const { data, error } = await supabase.rpc("generate_production_schedules", {
      p_start: start,
      p_days: Number(days),
      p_location_ids: [...selected],
      p_ignore_special_orders: ignoreSpecial,
      p_replace: replace,
      p_allow_actuals: allowActuals,
    });

    setRunning(false);
    if (error) {
      setError(error.message);
      return;
    }
    setReceipt(data as Receipt);
    router.refresh();
  }

  const blockedByActuals = (receipt?.skipped ?? []).some((s) => s.has_actuals);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
      >
        Generate schedules…
      </button>

      {open && (
        <Dialog
          title={receipt ? "Schedules generated" : "Generate schedules"}
          onClose={() => setOpen(false)}
          busy={running}
          width="max-w-2xl"
          top="pt-[8vh]"
          footer={
            receipt ? (
              <>
                {receipt.skipped.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => run(true, blockedByActuals)}
                    disabled={running}
                    className={DIALOG_CANCEL_CLASS}
                  >
                    {blockedByActuals
                      ? `Regenerate anyway (${receipt.skipped.length})`
                      : `Regenerate these ${receipt.skipped.length}`}
                  </button>
                ) : null}
                {/* A BUTTON THAT CLOSES, not a link to /schedules.
                    This dialog only ever renders ON /schedules, so the link
                    pointed at the page it was already on — which Next treats as
                    a no-op, leaving the panel up and the button reading as
                    dead. The list behind it was refreshed by `run` the moment
                    the receipt arrived, so there is nothing to navigate TO;
                    finishing here means putting the receipt away. */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={DIALOG_COMMIT_CLASS}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={running}
                  className={DIALOG_CANCEL_CLASS}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => run(false, false)}
                  disabled={running || selected.size === 0 || !start}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {running ? "Generating…" : "Generate"}
                </button>
              </>
            )
          }
        >
          {error && <p className="mt-2 text-sm text-accent">{error}</p>}

          {receipt ? (
            <Receipt receipt={receipt} />
          ) : (
            <div className="mt-3 space-y-5">
              <p className="text-sm text-muted">
                One schedule per shop per kitchen, from the plans active on each
                date plus any par overrides written for it. A day that already
                has a schedule is reported rather than replaced.
              </p>

              <div className="flex flex-wrap items-end gap-6">
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Starting
                  </span>
                  <DateField
                    value={start}
                    onChange={setStart}
                    required
                    ariaLabel="First date to generate"
                  />
                </label>
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    For
                  </span>
                  <PickList
                    variant="field"
                    value={days}
                    onPick={setDays}
                    options={DAY_OPTIONS}
                    ariaLabel="How many days to generate"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Shops
                </span>
                <ul className="divide-y divide-hairline border border-ink">
                  {locations.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Checkbox
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                        label={`Generate schedules for ${l.name}`}
                        size={18}
                      />
                      <span className="text-[13px] font-semibold uppercase tracking-[0.06em]">
                        {l.code}
                      </span>
                      <span className="text-subtle">{l.name}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  The shop that SELLS. Which kitchen makes each item comes from
                  the plans, so one shop can produce two schedules.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  checked={ignoreSpecial}
                  onChange={() => setIgnoreSpecial((v) => !v)}
                  label="Ignore special orders"
                  size={18}
                />
                <span className="text-sm">
                  Ignore special orders
                  <span className="block text-xs text-muted">
                    Recorded on each schedule so the printed totals explain
                    themselves later. A special order becomes its OWN schedule,
                    scheduled from the order — this never writes one.
                  </span>
                </span>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function Receipt({ receipt }: { receipt: Receipt }) {
  const nothing =
    receipt.created.length === 0 &&
    receipt.replaced.length === 0 &&
    receipt.skipped.length === 0;

  return (
    <div className="mt-3 space-y-5">
      {nothing ? (
        <p className="text-sm text-muted">
          Nothing to generate. No plan active on{" "}
          {receipt.days === 1 ? packetDate(receipt.start) : `those ${receipt.days} days`}{" "}
          carries an item with a par at the shops you chose — which is what the
          “not made” notes below explain, if there are any.
        </p>
      ) : null}

      {receipt.created.length > 0 ? (
        <Block title={`Created ${receipt.created.length}`}>
          {receipt.created.map((c) => (
            <Row key={c.schedule_id} left={<ScheduleLink row={c} />}>
              {c.line_count} {c.line_count === 1 ? "item" : "items"} ·{" "}
              {Number(c.par_total).toLocaleString()} to make
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.replaced.length > 0 ? (
        <Block title={`Regenerated ${receipt.replaced.length}`}>
          {receipt.replaced.map((r) => (
            <Row key={r.schedule_id} left={<ScheduleLink row={r} />}>
              {r.lines_before} → {r.lines_after} items
              {r.actuals_carried
                ? ` · ${r.actuals_carried} counted ${r.actuals_carried === 1 ? "line" : "lines"} kept`
                : ""}
              {r.manual_kept ? ` · ${r.manual_kept} added by hand kept` : ""}
              {r.actuals_lost ? (
                <span className="text-accent"> · {r.actuals_lost} counted lines dropped</span>
              ) : null}
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.skipped.length > 0 ? (
        <Block title={`Already generated — ${receipt.skipped.length} left alone`}>
          {receipt.skipped.map((s) => (
            <Row key={s.schedule_id} left={<ScheduleLink row={s} />}>
              {s.line_count} {s.line_count === 1 ? "item" : "items"}
              {s.has_actuals ? (
                <span className="text-mark"> · has counted quantities</span>
              ) : null}
            </Row>
          ))}
        </Block>
      ) : null}

      {receipt.warnings.length > 0 ? (
        <Block title={`Worth a look — ${receipt.warnings.length}`}>
          {receipt.warnings.map((w, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-xs text-ink">
                {WARNING_TITLE[w.kind] ?? w.kind}
              </span>{" "}
              <span className="font-medium">{w.item_name}</span>{" "}
              <span className="text-muted">
                at {w.location_code} on {w.date} — {w.detail}
              </span>
            </li>
          ))}
        </Block>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
      <ul className="divide-y divide-hairline border border-ink">{children}</ul>
    </section>
  );
}

function Row({ left, children }: { left: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
      <span>{left}</span>
      <span className="text-muted">{children}</span>
    </li>
  );
}

function ScheduleLink({
  row,
}: {
  row: { schedule_id: string; date: string; location_code: string; kitchen_code: string };
}) {
  return (
    <Link
      href={`/schedules/${row.schedule_id}`}
      className="font-medium text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
    >
      {packetDate(row.date)} · {row.location_code}
      {row.kitchen_code !== row.location_code ? ` (made at ${row.kitchen_code})` : ""}
    </Link>
  );
}
