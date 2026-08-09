"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { batchDate } from "@/lib/productionBatches";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";

/**
 * "Generate a batch log" — migration 045.
 *
 * A KITCHEN and a DATE. Not a week and not a weekday, because the round has no
 * days in it (Mark, 2026-08-09): a batch log is a collection of things to be
 * made sometime soon, and the staff choose the order. So the log carries the
 * date it was generated and the items carry no date at all.
 *
 * Generating the same day twice TOPS UP the same log rather than making a
 * second — the unique index on (location, date) says so, and the receipt says
 * which happened.
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
  created: Created[];
  skipped: Skipped[];
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
  const [logDate, setLogDate] = useState<string | null>(today);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setKitchen(defaultLocationId);
    setLogDate(today);
  }

  async function run(replace: boolean) {
    if (!kitchen || !logDate) return;
    setRunning(true);
    setError(null);
    const { data, error } = await supabase.rpc("generate_production_batches", {
      p_location_id: kitchen,
      p_log_date: logDate,
      p_replace: replace,
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
        Generate a log…
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
                    Refresh these {receipt.skipped.length} from the round
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
                  disabled={running || !kitchen || !logDate}
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
                {receipt.location_code} · {batchDate(receipt.log_date)}
                {receipt.new_log ? " · new log" : " · added to the existing log"}
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
                    round&rsquo;s amounts and recipe version and keeps every
                    yield, status and note somebody entered.
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
              <p className="text-sm text-muted">
                One kitchen, one day. Every element on that kitchen&rsquo;s
                weekly round becomes one batch to do — what needs making, in no
                particular order. Anything off the round is logged by hand.
                Generating the same day again tops up the same log.
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
