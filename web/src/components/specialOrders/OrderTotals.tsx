"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { money, type MoneyOrder, type OrderTotals as Totals } from "@/lib/specialOrders";

/**
 * The money — DERIVED, every figure of it (decision 6).
 *
 * FileMaker stored subtotal, tax and total, TWICE, by era: `Order_Subtotal`
 * and `Order_Subtotal2`. Fifty of its 8,330 orders no longer reproduce either
 * from their own lines, which is what a stored total does over twelve years.
 * So the editable cells here are the INPUTS — the tax rate, the two discounts,
 * the delivery charge, the rush fee — and everything in the right-hand column
 * is arithmetic done on read.
 *
 * A rewrite adding a `total` column to save this computation is the one change
 * this module cannot survive. The immutable copy of a quote is the PDF that was
 * sent, filed as an attachment, which is decision 17's whole mechanism.
 */
export function OrderTotals({
  id,
  totals,
  inputs,
  rushSuggestion,
  canWrite,
}: {
  id: string;
  totals: Totals;
  inputs: MoneyOrder;
  /** Decision 22's figure, or null outside the cutoff. */
  rushSuggestion: number | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Dismissed like every other offer on the receiving screen. */
  const [dismissed, setDismissed] = useState(false);

  function takeRushFee(amount: number) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ rush_fee: amount })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The fee wasn't saved — the database refused it silently.");
      else router.refresh();
    });
  }

  function setIgnoreBalance(next: boolean) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ ignore_balance: next })
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else router.refresh();
    });
  }

  const currentRush = Number(inputs.rush_fee ?? 0);
  // Only while it would actually change something, and only until dismissed.
  const offerRush =
    canWrite && rushSuggestion !== null && !dismissed && Math.abs(currentRush - rushSuggestion) > 0.005;

  return (
    <section className="space-y-2">
      <SectionHeading>Money</SectionHeading>

      {/* ONE COLUMN, since 2026-08-19 — this block is now half of a row rather
          than the full width of the page (Mark: "put Payments and Money
          sections in two separate columns side by side"), and the two `dl`s
          were laid out for the width it used to have.

          It reads better stacked anyway: the inputs are what you SET and the
          figures are what they COME TO, so one under the other is the sentence.
          Side by side inside a 384px column they were two 168px tracks, which
          puts "Delivery charge" on two lines. `max-w` caps it below `xl`, where
          the row stacks and this would otherwise run the width of the page. */}
      <div className="max-w-[26rem] space-y-6">
        {/* --------- the inputs --------- */}
        <dl className="space-y-3 text-[14px]">
          <Line label="Tax rate">
            {/* Stored as a FRACTION (.0975), shown as one. FileMaker's own
                convention, and the transform kept it — six spellings of a
                percentage in one column is how a rate becomes unreadable. */}
            <Cell id={id} canWrite={canWrite} column="tax_rate" value={inputs.tax_rate} label="Tax rate"
                  format={(v) => `${(Number(v) * 100).toFixed(3).replace(/\.?0+$/, "")}%`} />
          </Line>
          <Line label="Discount ($)">
            <Cell id={id} canWrite={canWrite} column="discount_amount" value={inputs.discount_amount} label="Discount amount"
                  format={(v) => money(Number(v))} />
          </Line>
          <Line label="Discount (rate)">
            <Cell id={id} canWrite={canWrite} column="discount_rate" value={inputs.discount_rate} label="Discount rate"
                  format={(v) => `${(Number(v) * 100).toFixed(2).replace(/\.?0+$/, "")}%`} />
          </Line>
          <Line label="Delivery charge">
            <Cell id={id} canWrite={canWrite} column="delivery_charge" value={inputs.delivery_charge} label="Delivery charge"
                  format={(v) => money(Number(v))} />
          </Line>
          <Line label="Rush fee">
            <span className="inline-flex items-baseline gap-2">
              <Cell id={id} canWrite={canWrite} column="rush_fee" value={inputs.rush_fee} label="Rush fee"
                    format={(v) => money(Number(v))} />
              {/* Decision 22: the receiving screen's `→` idiom. A SUGGESTION
                  you tap, never an automatic write — an automatic one would
                  charge a wholesale customer a rush fee every Friday, quietly.
                  It states the terms so the number is not a mystery. */}
              {offerRush ? (
                <>
                  <button
                    type="button"
                    onClick={() => takeRushFee(rushSuggestion)}
                    disabled={pending}
                    title="Inside two business days: $25 or 30%, whichever is greater"
                    className="text-[12px] text-mark underline underline-offset-2 hover:text-ink disabled:opacity-35"
                  >
                    → {money(rushSuggestion)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss the rush fee suggestion"
                    className="text-[12px] leading-none text-subtle hover:text-ink"
                  >
                    ✕
                  </button>
                </>
              ) : null}
            </span>
          </Line>
          <Line label="Ignore the balance">
            <span className="inline-flex items-center gap-2">
              <Switch
                on={Boolean(inputs.ignore_balance)}
                disabled={!canWrite || pending}
                onToggle={() => setIgnoreBalance(!inputs.ignore_balance)}
                size="sm"
                ariaLabel="Keep this order out of the unpaid queue"
              />
              <span className="text-[12px] text-muted">
                Wholesale days are billed weekly, not per order
              </span>
            </span>
          </Line>
        </dl>

        {/* --------- what they come to --------- */}
        <dl className="space-y-2 text-[14px]">
          <Figure label="Items" value={totals.subtotal} />
          {totals.discount > 0 ? <Figure label="Discount" value={-totals.discount} /> : null}
          {totals.deliveryCharge > 0 ? <Figure label="Delivery" value={totals.deliveryCharge} /> : null}
          {totals.rushFee > 0 ? <Figure label="Rush fee" value={totals.rushFee} /> : null}
          <Figure label="Tax" value={totals.tax} hint={`on ${money(totals.taxableSubtotal)} taxable`} />
          <Figure label="Total" value={totals.total} strong />
          <Figure label="Paid" value={totals.paid} />
          <Figure
            label="Balance"
            value={totals.balance}
            strong
            tone={totals.balance > 0 && !inputs.ignore_balance ? "accent" : undefined}
          />
        </dl>
      </div>

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </section>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Figure({
  label,
  value,
  strong = false,
  tone,
  hint,
}: {
  label: string;
  value: number;
  strong?: boolean;
  tone?: "accent";
  hint?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-hairline pt-2 font-semibold" : ""}`}>
      <dt className="text-muted">
        {label}
        {hint ? <span className="ml-1 text-[12px] text-subtle">{hint}</span> : null}
      </dt>
      <dd className={`tabular-nums ${tone === "accent" ? "text-accent" : ""}`}>{money(value)}</dd>
    </div>
  );
}

/**
 * One money INPUT — never a derived figure, which is the whole of decision 6.
 *
 * MODULE SCOPE — see `CustomerDetail`'s note.
 */
function Cell({
  id,
  canWrite,
  column,
  value,
  label,
  format,
}: {
  id: string;
  canWrite: boolean;
  column: string;
  value: number | null;
  label: string;
  format?: (v: string | number) => string;
}) {
  if (!canWrite) {
    return (
      <span className={`${READ_ONLY_VALUE} tabular-nums`}>
        {value === null ? "—" : format ? format(value) : value}
      </span>
    );
  }
  return (
    <InlineValue
      table="special_orders"
      id={id}
      column={column}
      kind="number"
      value={value}
      align="right"
      className="text-right"
      ariaLabel={label}
      format={format}
    />
  );
}
