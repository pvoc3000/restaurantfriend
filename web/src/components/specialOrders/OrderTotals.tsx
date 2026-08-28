"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "./fieldLook";
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

      {/* TWO COLUMNS AGAIN, AND STILL HARD RIGHT (Mark, 2026-08-19: "split it
          into two columns. The first column includes tax rate through 'ignore
          the balance', the second column 'items' through 'Balance'. Both
          columns still all the way to the right").

          That split is the two `dl`s exactly as they were written: what you SET
          on the left, what it COMES TO on the right. It was stacked earlier the
          same day because the block had just become half of a row and the pair
          would not fit; a DEFINITE WIDTH is what buys it back — 512px, so each
          track is 240 and neither label wraps, and the block still sizes itself
          rather than taking a share of the row, which is what keeps its right
          edge on the page margin beside a flexible Payments.

          `max-w` and not a fixed `w`: below `xl` this block is stacked under
          Payments at the full width of the page, where two 400px tracks would
          put half a foot of white space between "Delivery charge" and its
          figure — the same complaint that started all of this. Capped, the pair
          reads the same at every width.

          `gap-x-8` rather than the 48px it used to carry: at 240px tracks that
          gap was a fifth of a column, and the two `justify-between` rows
          already separate themselves — a value ending and a label starting is
          its own boundary. */}
      <div className="grid max-w-[32rem] gap-x-8 gap-y-6 md:grid-cols-2">
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
          {/* THE SUGGESTION HANGS UNDER THE LABEL, not under the field (Mark,
              2026-08-28). Beside the field it cost the field twice over —
              squeezed to 88px where the other four were 96 (which is what
              `shrink-0` on `MONEY_FIELD` now prevents), and pushed 67px off the
              right edge they all share. Under the field it kept both, but broke
              the one thing the fixed width bought: a clean column of identical
              boxes. Under the label it costs nothing at all — that side has the
              room, and the offer is a sentence rather than a value. */}
          <Line
            label="Rush fee"
            under={
              /* Decision 22: the receiving screen's `→` idiom. A SUGGESTION you
                 tap, never an automatic write — an automatic one would charge a
                 wholesale customer a rush fee every Friday, quietly. It states
                 the terms so the number is not a mystery. */
              offerRush ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => takeRushFee(rushSuggestion)}
                    disabled={pending}
                    title="Inside two business days: $25 or 30%, whichever is greater"
                    className="text-[12px] bg-mark-fill px-1 text-ink underline underline-offset-2 hover:bg-ink hover:text-white disabled:opacity-35"
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
                </span>
              ) : null
            }
          >
            <Cell id={id} canWrite={canWrite} column="rush_fee" value={inputs.rush_fee} label="Rush fee"
                  format={(v) => money(Number(v))} />
          </Line>
          {/* NO EXPLANATORY SENTENCE BESIDE THE SWITCH (Mark, 2026-08-19:
              "remove the note"). It read "Wholesale days are billed weekly, not
              per order", which is one REASON you might reach for this switch
              and not what it does — so on every other order it was a sentence
              about somebody else's order. The switch's own accessible name still
              says what it does; it is the label that names the control, and the
              control is named. */}
          <Line label="Ignore the balance">
            <Switch
              on={Boolean(inputs.ignore_balance)}
              disabled={!canWrite || pending}
              onToggle={() => setIgnoreBalance(!inputs.ignore_balance)}
              size="sm"
              ariaLabel="Keep this order out of the unpaid queue"
            />
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

/**
 * A money input: its label, and the field against the right edge.
 *
 * `under` hangs something BENEATH THE LABEL rather than beneath the field
 * (Mark, 2026-08-28). Only the rush fee uses it, and the left side is the right
 * side for it: the field column is a stack of identical 96px boxes and anything
 * hung below one interrupts that column, where the label column has empty space
 * to spare and the suggestion is a sentence anyway.
 *
 * It goes INSIDE the `dt` rather than in a wrapper around it, because `dl` >
 * `div` > `dt` is as deep as the grouping element is allowed to nest — another
 * div around the `dt` is invalid. `items-baseline` on the row uses the dt's
 * FIRST line, so the label and the field stay on one line however tall the dt
 * grows, and the dt's own uppercase tracking is reset for the text below.
 */
function Line({
  label,
  under,
  children,
}: {
  label: string;
  under?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {under ? (
          <span className="mt-1 block normal-case tracking-normal">{under}</span>
        ) : null}
      </dt>
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
 * EVERY MONEY INPUT IS THIS WIDE (Mark, 2026-08-28: "make the fields in the
 * money section the same width so empty ones don't collapse. The column can be
 * wider if necessary to accommodate").
 *
 * They collapsed because `BOXED_FIELD`'s `w-full` had nothing to resolve
 * against: each sits in a `justify-between` row whose `<dd>` is shrink-to-fit,
 * so the box came out the width of its VALUE — measured at 44, 49, 57 and, for
 * the empty discount rate, FOURTEEN PIXELS. Underlined that read as a short
 * number; boxed it reads as a broken control, and the one field you most need
 * to find is the empty one.
 *
 * 96px holds "$1,234.56" (~78px of digits, padding and border) with room, which
 * is the widest thing a wedding order puts here. It is a definite width on a
 * WRAPPER rather than a `w-24` passed through `className`: `InlineValue`'s own
 * `w-full` is a competing width utility, and Tailwind resolves those by
 * stylesheet order rather than by the order of the class string, so overriding
 * it from outside is a coin toss.
 *
 * The block grows to fit — it is `shrink-0` and content-sized under a
 * `max-w-[32rem]` cap, so the rows going from 201px to 237px widen it to ~506
 * and Payments beside it gives up the difference. That is the trade Mark
 * offered.
 *
 * MODULE SCOPE — see `CustomerDetail`'s note.
 */
const MONEY_FIELD = "block w-24 shrink-0";

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
    // The same width below purchaser+, or the block reflows depending on who
    // is looking at it.
    return (
      <span className={`${MONEY_FIELD} ${READ_ONLY_VALUE} text-right tabular-nums`}>
        {value === null ? "—" : format ? format(value) : value}
      </span>
    );
  }
  return (
    <span className={MONEY_FIELD}>
    <InlineValue
      boxed={BOXED_FIELDS}
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
    </span>
  );
}
