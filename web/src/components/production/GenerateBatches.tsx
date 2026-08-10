"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { batchDate } from "@/lib/productionBatches";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";

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
 * Generating the same day twice TOPS UP the same log rather than making a
 * second — the unique index on (location, date) says so, and the receipt says
 * which happened.
 *
 * There is deliberately no preview of what it will produce. Computing it here
 * would be a TypeScript twin of the SQL rule — 016's `nextDeliveryDate` trap,
 * and here the rule decides what a kitchen is told to make. The receipt reports
 * what actually happened instead.
 */

/** A type on this kitchen's round, and how many elements carry it. */
type RoundType = { value: string; label: string; count: number };

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
  locationId,
  locationCode,
  today,
}: {
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
  /**
   * The types on this kitchen's round, and which are ticked.
   *
   * ALL TICKED BY DEFAULT (Mark, 2026-08-09), which keeps the ordinary act one
   * press: generating the whole round is what this button has always done and
   * still is. The checkboxes are for the day you only want the glazes.
   *
   * `chosen === null` means "not loaded yet", told apart from the empty set —
   * which is a real state (everything unticked) and must disable Generate
   * rather than silently generating everything, since the RPC reads an empty
   * array as "no types" and null as "all".
   */
  const [types, setTypes] = useState<RoundType[] | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  function openDialog() {
    setOpen(true);
    setReceipt(null);
    setError(null);
    setLogDate(today);
  }

  /**
   * What is actually on this kitchen's round, read when the dialog opens.
   *
   * FROM THE ROUND, not from the whole catalog: offering all 16 of the app's
   * element types would list nine that cannot produce a batch here, and
   * unticking one of those would do nothing at all. DF02's round has seven.
   *
   * The COUNT rides along because it is what makes a tick meaningful — "Glaze
   * 12" tells you what you are about to add where a bare label does not.
   */
  useEffect(() => {
    if (!open || types !== null) return;
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("production_element_locations")
        .select("is_active, production_elements!inner ( element_type, is_active )")
        .eq("location_id", locationId)
        .eq("on_weekly_log", true);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setTypes([]);
        setChosen(new Set());
        return;
      }
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as unknown as {
        is_active: boolean;
        production_elements: { element_type: string | null; is_active: boolean };
      }[]) {
        // The same three conditions the SQL generates on, so the list cannot
        // promise a batch the function then declines to make.
        if (!row.is_active || !row.production_elements.is_active) continue;
        const key = row.production_elements.element_type ?? "";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const list = [...counts.entries()]
        .map(([value, count]) => ({ value, label: value || "No type", count }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setTypes(list);
      setChosen(new Set(list.map((t) => t.value)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, types, locationId, supabase]);

  async function run(replace: boolean) {
    if (!logDate) return;
    setRunning(true);
    setError(null);
    const { data, error } = await supabase.rpc("generate_production_batches", {
      p_location_id: locationId,
      p_log_date: logDate,
      p_replace: replace,
      // NULL when every type is ticked, so the ordinary run is the call 045
      // always made and the array is only sent when it narrows something.
      p_element_types:
        chosen && types && chosen.size < types.length ? [...chosen] : null,
    });
    setRunning(false);
    if (error) {
      setError(
        // The parameter arrives with 047. Without it PostgREST reports no
        // matching function, which names neither the migration nor the fix.
        /PGRST202|function public\.generate_production_batches/i.test(error.message)
          ? `${error.message} — migration 047 has not been applied yet.`
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
        className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white"
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
                  disabled={running || !logDate || chosen === null || chosen.size === 0}
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
              {/* No explanatory paragraph (Mark, 2026-08-09). The type list
                  below now says what will be generated, in the only terms that
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
                <div className="flex items-baseline gap-3">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Element types
                  </span>
                  {/* All / None, the WeekdayPicker's command in this dialog's
                      terms: with seven boxes, "just the glazes" is six clicks
                      without it and two with. */}
                  {types && types.length > 1 && chosen ? (
                    <button
                      type="button"
                      onClick={() =>
                        setChosen(
                          chosen.size === types.length
                            ? new Set()
                            : new Set(types.map((t) => t.value))
                        )
                      }
                      className="text-[11px] uppercase tracking-[0.08em] text-subtle hover:text-ink"
                    >
                      {chosen.size === types.length ? "None" : "All"}
                    </button>
                  ) : null}
                </div>

                {types === null ? (
                  <p className="text-sm text-muted">Reading the round…</p>
                ) : types.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nothing is on {locationCode}&rsquo;s weekly round, so there is
                    nothing to generate.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline border border-hairline">
                    {types.map((t) => {
                      const on = chosen?.has(t.value) ?? false;
                      return (
                        <li
                          key={t.value}
                          className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-neutral-50"
                        >
                          {/* `ui/Checkbox` IS the button and takes the label as
                              children — so the box and its word are one target,
                              which is what a 20px square needs. Nesting it in a
                              row-wide button of my own would have been a button
                              inside a button. */}
                          <Checkbox
                            size={18}
                            checked={on}
                            onChange={() => {
                              const next = new Set(chosen ?? []);
                              if (on) next.delete(t.value);
                              else next.add(t.value);
                              setChosen(next);
                            }}
                          >
                            <span className={on ? "" : "text-muted"}>{t.label}</span>
                          </Checkbox>
                          <span className="ml-auto tabular-nums text-subtle">{t.count}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
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
