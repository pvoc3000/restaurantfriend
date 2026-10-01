"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { batchDate } from "@/lib/productionBatches";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { myEmployeeId } from "@/lib/myEmployee";
import {
  SCHEDULE_CLASSES,
  SCHEDULE_CLASS_LABEL,
  type ScheduleClass,
} from "@/lib/production";

/**
 * "Generate a batch log" — migration 045.
 *
 * A DATE, at the kitchen you are standing in. Not a week and not a weekday,
 * because the round has no days in it (Mark, 2026-08-09): a batch log is a
 * collection of things to be made sometime soon, and the staff choose the
 * order. So the log carries the date it was generated and the items carry no
 * date at all.
 *
 * IT DOES NOT OFFER A KITCHEN, and that is a fix rather than a simplification.
 * The list is scoped to the working kitchen (Mark's call, 2026-08-09 — "keep
 * logs from each kitchen separated"), so a picker here could write a log the
 * list would never show: generate for DF02 while standing at DF01 and it
 * vanishes. That is exactly what happened. Generating follows the working
 * location like every other operational screen (design rule 3); to make
 * another kitchen's log, go and work at that kitchen.
 *
 * IT ASKS FOR A SCHEDULE (migration 153; Mark, 2026-09-30: "When creating a new
 * batch log, we then choose the schedule instead of the element types"). A log
 * is ONE schedule's — Weekly, Donut or Ice Cream — and generates every element
 * on that schedule that this kitchen has on its batch log. The element-type
 * checkboxes 047 added are gone with it.
 *
 * Generating the same day and schedule twice TOPS UP the same log rather than
 * making a second — the unique index on (location, date, schedule) says so, and
 * the receipt says which happened.
 *
 * There is deliberately no preview of what it will produce. Computing it here
 * would be a TypeScript twin of the SQL rule — 016's `nextDeliveryDate` trap,
 * and here the rule decides what a kitchen is told to make. The receipt reports
 * what actually happened instead.
 */


type Created = { element_name: string; batch_number: string };
type Skipped = { batch_id: string; element_name: string; reason: string };
type Warning = { kind: string; element_name: string };

type Receipt = {
  log_id: string;
  log_date: string;
  new_log: boolean;
  location_code: string;
  schedule: ScheduleClass;
  created: Created[];
  skipped: Skipped[];
  warnings: Warning[];
};

/** Yellow, never red: the generation went ahead anyway. */
const WARNING_TITLE: Record<string, string> = {
  no_master_recipe: "No master recipe",
};

export function GenerateBatches({
  orgId,
  locationId,
  locationCode,
  today,
}: {
  orgId: string;
  /** The WORKING kitchen. Not a choice — see the note above. */
  locationId: string;
  locationCode: string;
  today: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [logDate, setLogDate] = useState<string | null>(today);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleClass>("WEEKLY");
  /** How many elements each schedule would generate here; null until read. */
  const [counts, setCounts] = useState<Map<string, number> | null>(null);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setLogDate(today);
    setCounts(null);
  }

  /**
   * How many elements each schedule holds AT THIS KITCHEN, read when the dialog
   * opens — the count beside each choice says what Generate is about to add.
   */
  useEffect(() => {
    if (!open || counts !== null) return;
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("production_element_locations")
        .select("is_active, production_elements!inner ( schedule_class, is_active )")
        .eq("location_id", locationId);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setCounts(new Map());
        return;
      }
      const next = new Map<string, number>();
      for (const row of (data ?? []) as unknown as {
        is_active: boolean;
        production_elements: { schedule_class: string | null; is_active: boolean };
      }[]) {
        // The conditions the SQL generates on, so a count cannot promise a
        // batch the function then declines to make.
        if (!row.is_active || !row.production_elements.is_active) continue;
        const key = row.production_elements.schedule_class;
        if (key) next.set(key, (next.get(key) ?? 0) + 1);
      }
      setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, counts, locationId, supabase]);

  async function run(replace: boolean) {
    if (!logDate) return;
    setRunning(true);
    setError(null);
    const { data, error } = await supabase.rpc("generate_production_batches", {
      p_location_id: locationId,
      p_log_date: logDate,
      p_schedule: schedule,
      p_replace: replace,
    });
    if (!error) {
      // PREPARED BY IS WHOEVER GENERATED IT (Mark, 2026-09-16). The SQL
      // leaves the operator null, so the batches this run CREATED are stamped
      // here — by number, never the whole log, because a top-up must not
      // rename the people who made the batches already on it. Soft: a login
      // with no HR record, or a refused write, leaves the field for the record.
      const numbers = ((data as Receipt | null)?.created ?? []).map((c) => c.batch_number);
      const operatorId = numbers.length > 0 ? await myEmployeeId(supabase, orgId) : null;
      if (operatorId) {
        await supabase
          .from("production_batches")
          .update({ operator_employee_id: operatorId })
          .eq("log_id", (data as Receipt).log_id)
          .in("batch_number", numbers)
          .is("operator_employee_id", null);
      }
    }
    setRunning(false);
    if (error) {
      setError(
        // The schedule parameter arrives with 153. Without it PostgREST reports
        // no matching function, which names neither the migration nor the fix.
        /PGRST202|function public\.generate_production_batches/i.test(error.message)
          ? `${error.message} — migration 153 has not been applied yet.`
          : error.message
      );
      return;
    }
    setReceipt(data as Receipt);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={BUTTON_CLASS}
      >
        New batch log
      </button>

      {open && (
        <Dialog
          title={receipt ? "Batch log generated" : "Generate a batch log"}
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
                    onClick={() => run(true)}
                    disabled={running}
                    className={DIALOG_CANCEL_CLASS}
                  >
                    Refresh these {receipt.skipped.length}
                  </button>
                ) : null}
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
                  onClick={() => run(false)}
                  disabled={running || !logDate || counts === null}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {running ? "Generating…" : "Generate"}
                </button>
              </>
            )
          }
        >
          {error ? <p className="mb-3 text-sm text-accent">{error}</p> : null}

          {receipt ? (
            <div className="space-y-5 text-sm">
              <p className="text-muted">
                {receipt.location_code} · {SCHEDULE_CLASS_LABEL[receipt.schedule] ?? receipt.schedule}{" "}
                · {batchDate(receipt.log_date)}
                {receipt.new_log ? " · new log" : " · added to the existing log"}
              </p>

              <Block
                title={`${receipt.created.length} ${receipt.created.length === 1 ? "batch" : "batches"} added`}
              >
                {receipt.created.length === 0 ? (
                  <p className="text-muted">
                    Nothing to add. Put an element on this kitchen&rsquo;s batch log
                    from its Kitchens table.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline border border-hairline">
                    {receipt.created.map((c) => (
                      <li
                        key={c.batch_number}
                        className="flex items-baseline gap-3 px-3 py-1.5"
                      >
                        <span className="font-medium">{c.element_name}</span>
                        <span className="ml-auto tabular-nums text-subtle">
                          {c.batch_number}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>

              {receipt.skipped.length > 0 ? (
                <Block title={`${receipt.skipped.length} already logged`}>
                  <p className="mb-2 text-muted">
                    Left exactly as they are. Refreshing them re-reads the
                    amounts and recipe version and keeps every yield, count,
                    status and note somebody entered.
                  </p>
                  <ul className="divide-y divide-hairline border border-hairline">
                    {receipt.skipped.slice(0, 12).map((s) => (
                      <li key={s.batch_id} className="flex items-baseline gap-3 px-3 py-1.5">
                        <span>{s.element_name}</span>
                      </li>
                    ))}
                  </ul>
                  {receipt.skipped.length > 12 ? (
                    <p className="mt-1 text-xs text-muted">
                      and {receipt.skipped.length - 12} more
                    </p>
                  ) : null}
                </Block>
              ) : null}

              {receipt.warnings.length > 0 ? (
                <Block title="Worth knowing">
                  <ul className="space-y-1">
                    {receipt.warnings.map((w, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="border border-ink bg-[var(--rf-yellow-200)] px-1.5 text-[11px] uppercase tracking-[0.06em]">
                          {WARNING_TITLE[w.kind] ?? w.kind}
                        </span>
                        <span>{w.element_name}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">
                    These were generated anyway — a batch with no master recipe
                    is still a batch somebody has to make.
                  </p>
                </Block>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              {/* No explanatory paragraph (Mark, 2026-08-09). The schedule
                  list below says what will be generated, in the only terms that
                  matter — the counts — so a sentence describing the rule was
                  restating what the reader can already see and count. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Kitchen
                  </span>
                  {/* Stated, not chosen: a log belongs to the kitchen you are
                      working at, and the list only shows that kitchen's. */}
                  <span className="block h-9 border border-hairline px-3 py-1.5 text-sm text-muted">
                    {locationCode}
                  </span>
                </div>

                <label className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Date
                  </span>
                  <DateField
                    value={logDate}
                    onChange={(next) => setLogDate(next)}
                    ariaLabel="The day this log is for"
                  />
                  <span className="block text-xs text-muted">
                    {logDate ? batchDate(logDate) : "Pick a day"}
                  </span>
                </label>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Schedule
                </span>
                <Radio
                  vertical
                  ariaLabel="Which schedule to generate"
                  value={schedule}
                  onChange={setSchedule}
                  options={SCHEDULE_CLASSES.map((value) => ({
                    value,
                    label: SCHEDULE_CLASS_LABEL[value],
                    after: (
                      <span className="tabular-nums text-subtle">
                        {counts === null
                          ? "…"
                          : `${counts.get(value) ?? 0} ${
                              (counts.get(value) ?? 0) === 1 ? "element" : "elements"
                            }`}
                      </span>
                    ),
                  }))}
                />
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}
