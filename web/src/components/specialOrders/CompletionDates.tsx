"use client";

import { useState } from "react";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { COMPLETION_DATES } from "@/lib/specialOrders";
import { createClient } from "@/lib/supabase/client";
import { WorkflowOffer } from "./WorkflowOffer";
import {
  afterDateSet,
  type Consequence,
  type OrderMoney,
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
 * THE PAID DATE ALSO READS THE MONEY (Mark, 2026-09-19)
 * ---------------------------------------------------------------------------
 * "When we set a paid date and the order is still unsettled/has a balance due,
 * we should offer to create a payment for the order so it becomes settled."
 * The reasoning is `lib/orderWorkflow`'s; what this screen contributes is the
 * `money` prop, because a stage date on its own cannot tell you what is owed.
 * It is the mirror of the offer `OrderPayments` already makes in the other
 * direction, and between them the date and the balance can no longer disagree
 * without somebody having said so.
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
  orgId,
  order,
  money,
  canWrite,
}: {
  id: string;
  /** Design rule 1 — the paid date's offer can insert a payment. */
  orgId: string;
  order: WorkflowOrder & Record<string, unknown>;
  /**
   * What is still owed, and whether it is owed at all. The Invoice paid date is
   * the only row here that reads it (Mark, 2026-09-19) — see the module header.
   */
  money: OrderMoney;
  canWrite: boolean;
}) {
  const supabase = createClient();
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  // MARK'S ARRANGEMENT (2026-09-16): Order initiated alone, then the pairs —
  // quote sent · approved, invoice sent · paid, delivery scheduled · receipt
  // sent (swapped the same day), order printed · order scheduled.
  //
  // THE LIST IS `COMPLETION_DATES` SINCE 2026-09-20, shared with the batch
  // command that offers the same nine: a second copy is how one door quietly
  // starts offering a date the other does not. What stays HERE is the layout —
  // `newRow` starts the first pair on a fresh row, leaving Initiated half width
  // and alone above it, which is this block's business and not the vocabulary's.
  const rows = COMPLETION_DATES.map((d) => ({
    ...d,
    aria: d.label,
    newRow: d.column === "quote_sent_at",
  }));

  // A PICKUP HAS NO DELIVERY TO SCHEDULE (Mark, 2026-09-16), so that date is
  // greyed there — kept in its slot, box and all, so the pairs stay put. A
  // date already on a pickup (entered before it switched) still shows.
  const isPickup = ((order.fulfillment as string | null) ?? "pickup") !== "delivery";

  return (
    <>
      {/* STACKED, LIKE EVERY OTHER BLOCK ON THIS TAB (2026-08-28).
          It was a fixed 128px label track with the value beside it, and boxing
          the fields made that arrangement impossible rather than merely tight.
          Measured: the longest label here wanted 174px ("Production scheduled",
          now "Order scheduled")
          and a date needs ~96px, in a 205px column — so the label wrapped AND
          the date was left 65px, which clipped it to "06/1".
          Before the boxes the same block simply OVERFLOWED its quadrant by
          75px instead, which is the same problem wearing a different failure.
          Stacked, the field gets the whole column, the label may be as long as
          it likes, and the block reads like Details directly above it. It costs
          about 95px of height in a pane that scrolls, which is the cheaper half
          of the trade. */}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => {
          const value = (order[r.column] ?? null) as string | null;
          return (
            <div
              key={r.column}
              className={`min-w-0 space-y-1 ${r.newRow ? "sm:col-start-1" : ""}`}
            >
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
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
                    disabled={isPickup && r.column === "delivery_scheduled_at"}
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
                          r.column as StageColumn,
                          money
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
          orgId={orgId}
          consequences={offer}
          onClose={() => setOffer(null)}
        />
      )}
    </>
  );
}
