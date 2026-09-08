"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { addDays, materializationSummary, type MaterializationReceipt } from "@/lib/specialOrders";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * DECISION 13'S ESCAPE HATCH — FileMaker's Instantiate, kept for the one job it
 * is still the answer to.
 *
 * The horizon fills itself, so there is nothing routine to press here; what a
 * rolling fortnight cannot do is reach a one-off further out — Cafe Knotted
 * asking for the whole of December in October, or somebody wanting to see the
 * orders before a wholesale price change lands. So this takes a THROUGH DATE
 * and runs the same function the list and the generate dialog run, scoped to
 * one standing order.
 *
 * SCOPED, and that is not a detail: run over the org it would make every
 * standing order's December too, which is a much larger act than the button
 * says. `p_order_id` is what 099 takes it for.
 *
 * IT STAYS OPEN ON SUCCESS, which is the opposite of this app's create-dialog
 * rule and for that rule's own reason. A create dialog closes because the row
 * lands on the list behind it and the count moves — the confirmation is on
 * screen. Here there is nothing behind: the standing order's record does not
 * list its days, so the RECEIPT is the only thing that says what happened, and
 * closing over it would leave you pressing it again to find out.
 */
export function MaterializeNow({
  orgId,
  standingOrderId,
  number,
  today,
  horizonDays,
}: {
  orgId: string;
  standingOrderId: string;
  number: string;
  /** The ORG's calendar day — never the browser's (`lib/today`). */
  today: string;
  horizonDays: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [through, setThrough] = useState<string | null>(addDays(today, horizonDays));
  const [receipt, setReceipt] = useState<MaterializationReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setReceipt(null);
    setError(null);
    setThrough(addDays(today, horizonDays));
    setOpen(true);
  }

  function run() {
    if (!through) return;
    setError(null);
    setReceipt(null);
    start(async () => {
      const { data, error: e } = await supabase.rpc("ensure_standing_orders_materialized", {
        p_org_id: orgId,
        // ALWAYS FROM TODAY, whatever the reader typed. 099 will not make a day
        // before `p_from` and this is the only caller a person types into, so
        // the guard against ordering donuts for last Tuesday lives here.
        p_from: today,
        p_through: through,
        p_order_id: standingOrderId,
      });
      if (e) {
        setError(e.message);
        return;
      }
      setReceipt(data as MaterializationReceipt);
      // The days are orders now, so anything counting them is stale.
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={openDialog}>
        Materialize now…
      </button>

      {open ? (
        <Dialog
          title={`Materialize ${number}`}
          onClose={() => setOpen(false)}
          busy={pending}
          width="max-w-lg"
          onSubmit={through && !pending ? run : undefined}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setOpen(false)}>
                {receipt ? "Done" : "Cancel"}
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={run}
                disabled={pending || !through}
              >
                {pending ? "Making…" : "Materialize"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Days through the next {horizonDays} are made by themselves. This is
              for reaching further out — the orders it makes are ordinary orders
              you can edit, and running it twice makes nothing twice.
            </p>

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Make days through
              </label>
              <DateField
                variant="field"
                value={through}
                onChange={setThrough}
                ariaLabel="Make days through this date"
              />
              <p className="text-[12px] text-muted">Starting today, {today}.</p>
            </div>

            {receipt ? (
              <div className="space-y-2 border-t border-hairline pt-4">
                <p className="text-sm">{materializationSummary(receipt)}</p>
                {receipt.orders?.length ? (
                  <ul className="max-h-48 space-y-0.5 overflow-y-auto text-[13px] text-muted">
                    {receipt.orders.map((o) => (
                      <li key={o.number}>
                        <span className="tabular-nums">{o.event_date}</span> — order {o.number}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* 099 names a standing order it could not act on rather than
                    going quiet — paused, no weekdays, no items. Asked for BY
                    NAME, "nothing happened" with no reason is the answer that
                    sends somebody to look for a bug. */}
                {receipt.warnings?.length ? (
                  <ul className="space-y-1 text-[13px]">
                    {receipt.warnings.map((w, i) => (
                      <li key={i}>
                        <span className="bg-mark-fill px-1">{w.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="text-sm text-accent">{error}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
