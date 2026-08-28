"use client";

import { useState } from "react";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "./fieldLook";
import { createClient } from "@/lib/supabase/client";
import { WorkflowOffer } from "./WorkflowOffer";
import {
  afterDateSet,
  type Consequence,
  type StageColumn,
  type WorkflowOrder,
} from "@/lib/orderWorkflow";

/**
 * The nine stage dates, and the workflow questions setting one raises.
 *
 * A CLIENT COMPONENT because the cells need `alsoUpdate`-class behaviour —
 * something has to happen after the write — and CLAUDE.md's rule is that any
 * `InlineValue` needing a function prop must be rendered from one. The dates
 * themselves are unchanged; what is new is that the component watches them.
 *
 * ---------------------------------------------------------------------------
 * IT ONLY ASKS WHEN A DATE GOES EMPTY -> SET
 * ---------------------------------------------------------------------------
 * The fourth guard, and it lives here rather than in `lib/orderWorkflow`
 * because only the caller knows what was there before. Correcting a typo in a
 * date that is already filled in is not a workflow event — the quote was sent
 * either way, and the app has already asked about it once. Clearing a date
 * asks nothing either: unsetting is how somebody undoes a mistake, and
 * proposing a status move in the middle of an undo is the opposite of helping.
 *
 * ---------------------------------------------------------------------------
 * IT ASKS AFTER THE WRITE, WHICH IS WHY IT USES `onWrite` AND NOT `alsoUpdate`
 * ---------------------------------------------------------------------------
 * `alsoUpdate` composes the statement and therefore runs BEFORE it — asking
 * there would put the question on screen for something that had not happened
 * yet, and leave it there if the write then failed. `onWrite` replaces the
 * update, so the date lands first and the question follows only once it has.
 *
 * It carries the `.select()` discipline with it: an update matching no RLS
 * policy changes nothing and PostgREST returns NO error, so without the row
 * count a refused write would report success and then cheerfully ask whether to
 * advance an order that had not moved.
 */
export function CompletionDates({
  id,
  order,
  canWrite,
}: {
  id: string;
  order: WorkflowOrder & Record<string, unknown>;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  const rows: { label: string; column: string; aria: string }[] = [
    { label: "Initiated", column: "date_initiated", aria: "Date initiated" },
    { label: "Quote sent", column: "quote_sent_at", aria: "Quote sent" },
    { label: "Quote approved", column: "quote_returned_at", aria: "Quote approved" },
    { label: "Invoice sent", column: "invoice_sent_at", aria: "Invoice sent" },
    { label: "Invoice paid", column: "invoice_paid_at", aria: "Invoice paid" },
    { label: "Receipt sent", column: "receipt_sent_at", aria: "Receipt sent" },
    { label: "Delivery scheduled", column: "delivery_scheduled_at", aria: "Delivery scheduled" },
    { label: "Order printed", column: "order_printed_at", aria: "Order printed" },
    { label: "Production scheduled", column: "order_scheduled_at", aria: "Production scheduled" },
  ];

  return (
    <>
      <div className="grid gap-x-10 gap-y-1.5 sm:grid-cols-2">
        {rows.map((r) => {
          const value = (order[r.column] ?? null) as string | null;
          return (
            <div key={r.column} className="flex items-baseline gap-3">
              <dt className="w-32 shrink-0 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {r.label}
              </dt>
              <dd className="min-w-0">
                {canWrite ? (
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="special_orders"
                    id={id}
                    column={r.column}
                    kind="date"
                    value={value}
                    ariaLabel={r.aria}
                    onWrite={async (next) => {
                      const { data, error } = await supabase
                        .from("special_orders")
                        .update({ [r.column]: next })
                        .eq("id", id)
                        .select("id");
                      if (error) return { error: error.message };
                      if (!data?.length) {
                        return { error: "That wasn't saved — the database refused it silently." };
                      }
                      // EMPTY -> SET only; see the header. Answering is its own
                      // write, so declining leaves the date exactly as typed.
                      if (next && !value) {
                        const cs = afterDateSet(
                          { ...order, [r.column]: String(next) },
                          r.column as StageColumn
                        );
                        if (cs.length > 0) setOffer(cs);
                      }
                      return { error: null };
                    }}
                  />
                ) : (
                  <span className={READ_ONLY_VALUE}>{value ?? "—"}</span>
                )}
              </dd>
            </div>
          );
        })}
      </div>

      {offer && (
        <WorkflowOffer
          orderId={id}
          consequences={offer}
          onClose={() => setOffer(null)}
        />
      )}
    </>
  );
}
