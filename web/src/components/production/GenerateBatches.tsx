"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { batchDate, weekLabel, weekStart } from "@/lib/productionBatches";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";

/**
 * "Generate the week" — the batch log's own generator, migration 044.
 *
 * Mark, 2026-08-09: an employee generates the week's batch log for a kitchen
 * from the WEEKLY-class element schedule, then works the list down. So this
 * takes a KITCHEN and a WEEK, where `GenerateSchedules` takes a start date, a
 * number of days and a set of shops — the two are different acts and the
 * difference is real: a schedule is one shop's day, a batch log is one
 * kitchen's week.
 *
 * It shares that generator's guards exactly, so there is one rule to learn: an
 * existing batch is SKIPPED and named, replacing is a second explicit press,
 * and a batch already carrying a YIELD refuses to be replaced without a third.
 *
 * There is deliberately no preview of what the week will produce. Computing it
 * here would be a TypeScript twin of the SQL rule — 016's `nextDeliveryDate`
 * trap, and here the rule decides what a kitchen is told to make. The receipt
 * reports what actually happened instead.
 */

type Created = {
  date: string;
  element_name: string;
  batch_label: string | null;
  batch_number: string;
  shift: string | null;
};

type Skipped = {
  batch_id: string;
  date: string;
  element_name: string;
  batch_label: string | null;
  reason: string;
};

type Replaced = Omit<Skipped, "reason">;

type Warning = { kind: string; element_name: string };

type Receipt = {
  week_start: string;
  location_code: string;
  created: Created[];
  skipped: Skipped[];
  replaced: Replaced[];
  warnings: Warning[];
};

/** Yellow, never red: the generation went ahead anyway. */
const WARNING_TITLE: Record<string, string> = {
  no_master_recipe: "No master recipe",
};

export function GenerateBatches({
  locations,
  defaultLocationId,
  today,
}: {
  locations: { id: string; code: string; name: string }[];
  defaultLocationId: string | null;
  today: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [kitchen, setKitchen] = useState<string | null>(defaultLocationId);
  const [week, setWeek] = useState<string | null>(today);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setKitchen(defaultLocationId);
    setWeek(today);
  }

  async function run(replace: boolean, allowYields: boolean) {
    if (!kitchen || !week) return;
    setRunning(true);
    setError(null);
    const { data, error } = await supabase.rpc("generate_production_batches", {
      p_location_id: kitchen,
      p_week_start: week,
      p_replace: replace,
      p_allow_yields: allowYields,
    });
    setRunning(false);
    if (error) {
      setError(error.message);
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
        className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
      >
        Generate the week…
      </button>

      {open && (
        <Dialog
          title={receipt ? "Batch log generated" : "Generate the week's batch log"}
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
                    onClick={() => run(true, true)}
                    disabled={running}
                    className={DIALOG_CANCEL_CLASS}
                  >
                    Refresh these {receipt.skipped.length} from the schedule
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
                  onClick={() => run(false, false)}
                  disabled={running || !kitchen || !week}
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
                {receipt.location_code} · week of {weekLabel(receipt.week_start)}
              </p>

              <Block
                title={`${receipt.created.length} ${receipt.created.length === 1 ? "batch" : "batches"} added`}
              >
                {receipt.created.length === 0 ? (
                  <p className="text-muted">
                    Nothing to add. Only WEEKLY-class elements are generated — an
                    AB or donut batch is logged by hand.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline border border-hairline">
                    {receipt.created.map((c) => (
                      <li
                        key={c.batch_number}
                        className="flex items-baseline gap-3 px-3 py-1.5"
                      >
                        <span className="w-20 shrink-0 text-muted">{batchDate(c.date)}</span>
                        <span className="font-medium">{c.element_name}</span>
                        {c.batch_label ? (
                          <span className="text-muted">#{c.batch_label}</span>
                        ) : null}
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
                    schedule&rsquo;s amounts and recipe version and keeps every
                    yield, status and note somebody entered.
                  </p>
                  <ul className="divide-y divide-hairline border border-hairline">
                    {receipt.skipped.slice(0, 12).map((s) => (
                      <li key={s.batch_id} className="flex items-baseline gap-3 px-3 py-1.5">
                        <span className="w-20 shrink-0 text-muted">{batchDate(s.date)}</span>
                        <span>{s.element_name}</span>
                        {s.batch_label ? (
                          <span className="text-muted">#{s.batch_label}</span>
                        ) : null}
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

              {receipt.replaced.length > 0 ? (
                <Block title={`${receipt.replaced.length} refreshed`}>
                  <p className="text-muted">
                    Their amounts and recipe versions now match the schedule.
                    Yields, statuses and notes were left alone.
                  </p>
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
              <p className="text-sm text-muted">
                One kitchen, one week. Every WEEKLY-class element on that
                kitchen&rsquo;s schedule becomes a batch to do — including each
                separate batch of a morning, so a dough made four times is four
                rows. AB and donut elements are not generated; log those by hand.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Kitchen
                  </span>
                  <PickList
                    value={kitchen}
                    onPick={(next) => setKitchen(next || null)}
                    variant="field"
                    ariaLabel="Which kitchen"
                    options={locations.map((l) => ({
                      value: l.id,
                      label: l.code,
                      hint: l.name,
                    }))}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Week
                  </span>
                  <DateField
                    value={week}
                    onChange={(next) => setWeek(next)}
                    ariaLabel="A day in the week to generate"
                  />
                  <span className="block text-xs text-muted">
                    {week ? weekLabel(week) : "Pick any day in the week"}
                    {week && weekStart(week) !== week
                      ? " — the week that day falls in"
                      : ""}
                  </span>
                </label>
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
