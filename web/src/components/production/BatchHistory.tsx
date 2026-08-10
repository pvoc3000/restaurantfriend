"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  batchDate,
  batchMadeNothing,
  batchStatusTone,
  describeAmount,
} from "@/lib/productionBatches";

type HistoryRow = {
  id: string;
  log_date: string;
  status: string;
  notes: string | null;
  recipe_version_label: string | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
  on_hand_count: number | null;
  on_hand_size: number | null;
  on_hand_unit: string | null;
  yield_count: number | null;
  yield_size: number | null;
  yield_unit: string | null;
};

/**
 * EVERY TIME THIS KITCHEN MADE THIS ELEMENT — FileMaker's third column, which
 * its layout mislabels "NOTES" (Mark, 2026-08-09: "the section on the right
 * (mislabeled 'notes') is a history scrollview of all the times the element was
 * made").
 *
 * It is the one thing on the pane that isn't about the batch in front of you,
 * and it is what makes the batch in front of you judgeable: "3 × 1.5 gal on
 * hand" means nothing until you can see that the last four rounds all started
 * from one and made four. That is also why par, on hand, made and the recipe
 * VERSION are the columns — a yield that fell off is usually a version change,
 * and the two sit side by side here.
 *
 * SCOPED TO THIS KITCHEN, not to the org. A batch log belongs to one kitchen and
 * so does the question: DF01's raised dough is a different bowl, a different
 * mixer and a different person, so folding it in would make the run look
 * inconsistent for reasons that are not about this element.
 *
 * FETCHED PER SELECTION rather than for the whole log up front, which is the
 * opposite of this app's usual round-trip discipline and is the right call
 * twice over. A log carries ~30 elements and you open the history of a few;
 * more importantly, thirty elements' full history is exactly the shape that
 * runs into PostgREST's silent 1,000-row cap — it would come back truncated,
 * with no error, and a history that is quietly missing its oldest half looks
 * like a kitchen that started making something recently. One element at a time
 * is bounded by construction, and `limit` makes it provably so.
 *
 * Ordering is done HERE rather than in the query: the date lives on the LOG, and
 * ordering a parent by an embedded column is not something to lean on. The
 * fetch is bounded by `created_at` instead, which is when the log was generated
 * and therefore tracks `log_date` closely enough to pick the recent ones.
 */
export function BatchHistory({
  elementId,
  locationId,
  currentBatchId,
  fill = false,
  showSkipped,
  onHiddenCount,
}: {
  elementId: string | null;
  locationId: string;
  /** The batch the pane is showing — its own row is marked rather than hidden,
   *  so today's numbers read in the same column as the ones they follow. */
  currentBatchId: string;
  /**
   * Take the height the column gives instead of capping (Mark, 2026-08-09:
   * "make the history section fill the frame").
   *
   * The cap was there because the whole Info tab used to be ONE scroller, and a
   * `flex-1` child inside a scrolling parent has no height to divide. Now each
   * column scrolls itself, so there is a real frame to fill — and this is the
   * column that wants it: the fields are a fixed set, where the history is as
   * long as the element is old (60 rows here) and every extra row is another
   * week you can see at a glance.
   */
  fill?: boolean;
  /**
   * Whether to show the rounds where nothing was made.
   *
   * OWNED BY THE PANE, not by this component, because its switch sits on the
   * footer row beside Delete (Mark, 2026-08-09) — a control and the thing it
   * controls in two different boxes, which is what lifting the state is for.
   */
  showSkipped: boolean;
  /**
   * How many rounds the filter is holding back, reported when the data lands so
   * the switch can name the number.
   *
   * Called from the FETCH rather than from render — a parent setState during a
   * child's render is the loop this would otherwise be. The count is a fact
   * about the rows and not about the switch, so it never needs recomputing when
   * the switch moves.
   */
  onHiddenCount?: (count: number) => void;
}) {
  const supabase = createClient();
  // KEYED BY WHAT IT ANSWERS, rather than cleared when the question changes.
  // Resetting in the effect would be a synchronous setState inside one, which
  // is what the set-state-in-effect rule forbids; comparing the key during
  // render says the same thing with no extra pass, and can't leave a frame of
  // the previous element's history on screen either.
  const [state, setState] = useState<{
    key: string;
    rows: HistoryRow[];
    failed: string | null;
  } | null>(null);
  const key = `${elementId ?? ""}|${locationId}`;
  const current = state?.key === key ? state : null;

  const rows = current?.rows ?? [];
  const visible = showSkipped ? rows : rows.filter((r) => !batchMadeNothing(r));
  const hiddenCount = rows.length - visible.length;

  useEffect(() => {
    if (!elementId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("production_batches")
        .select(
          `id, status, notes, recipe_version_label,
           par_count, par_size, par_unit,
           on_hand_count, on_hand_size, on_hand_unit,
           yield_count, yield_size, yield_unit,
           production_batch_logs!inner ( log_date )`
        )
        .eq("element_id", elementId)
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (cancelled) return;
      if (error) {
        setState({ key, rows: [], failed: error.message });
        onHiddenCount?.(0);
        return;
      }
      const mapped = ((data ?? []) as unknown as (Omit<HistoryRow, "log_date"> & {
        production_batch_logs: { log_date: string } | null;
      })[])
        .map((r) => ({
          ...r,
          log_date: r.production_batch_logs?.log_date ?? "",
        }))
        .sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0));
      setState({ key, rows: mapped, failed: null });
      onHiddenCount?.(mapped.filter(batchMadeNothing).length);
    })();
    return () => {
      cancelled = true;
    };
  }, [elementId, locationId, key, supabase, onHiddenCount]);

  return (
    <div className={fill ? "flex min-h-0 flex-col" : ""}>
      <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        Previously made
      </h3>

      {/* `min-h-0` beside `flex-1` is the load-bearing half: without it the
          scroller takes its CONTENT height — sixty rows — and pushes the pane
          out of the frame instead of scrolling inside it. */}
      <div
        className={`mt-1 overflow-y-auto border border-hairline ${
          fill ? "min-h-0 flex-1" : "max-h-60"
        }`}
      >
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 bg-white text-left">
              {["Date", "Par", "On hand", "Made", "Ver"].map((h) => (
                <th
                  key={h}
                  className="border-b border-hairline px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {elementId && !current ? (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-muted">
                  Reading…
                </td>
              </tr>
            ) : !current || visible.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className={`px-2 py-2 ${current?.failed ? "text-accent" : "text-muted"}`}
                >
                  {current?.failed ??
                    // Two different sentences, because they are two different
                    // facts: never made here, versus made here and never
                    // successfully. The second is the more useful thing to know
                    // and would be lost if both read the same.
                    (hiddenCount > 0
                      ? `Nothing was made on the last ${hiddenCount} rounds.`
                      : "Nothing made here before.")}
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const made = describeAmount(r.yield_count, r.yield_size, r.yield_unit);
                // THE SAME COLOUR CODE AS THE LIST ABOVE (Mark, 2026-08-09) —
                // `batchStatusTone`, one function, so the two can never come to
                // disagree about what green means.
                //
                // STATUS decides the colour, and `batchMadeNothing` decides only
                // what the switch hides. They overlap without agreeing: a round
                // marked complete that yielded `0 × 3 gal` is hidden by default
                // and is GREEN when you switch it back on. That is the honest
                // pair of answers — somebody finished that round and got
                // nothing, which is a different fact from having skipped it, and
                // collapsing the two into one grey would lose the one worth
                // seeing.
                return (
                  <tr
                    key={r.id}
                    className={`align-top ${
                      r.id === currentBatchId ? "bg-mark-fill" : ""
                    } ${batchStatusTone(r.status)}`}
                  >
                    <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                      {r.log_date ? batchDate(r.log_date) : "—"}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {describeAmount(r.par_count, r.par_size, r.par_unit)}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {describeAmount(r.on_hand_count, r.on_hand_size, r.on_hand_unit)}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {made}
                      {r.notes ? (
                        <span className="block text-[11px] text-muted">{r.notes}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {r.recipe_version_label ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
