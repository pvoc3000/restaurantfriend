"use client";

import { useState, useTransition } from "react";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Checkbox } from "@/components/ui/Checkbox";
import { missingTaxRate, money, type MoneyOrder, type OrderTotals as Totals } from "@/lib/specialOrders";
import { PERCENT_SCALE, percentLabel, toPercent } from "@/lib/percent";
import { PickList } from "@/components/ui/PickList";
import { useLatestWrite } from "@/lib/latestWrite";
import { optionValue, parseTaxRatePick, taxRateOptions } from "@/lib/taxRates";

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
  shopRates,
  isDelivery,
  canWrite,
}: {
  id: string;
  totals: Totals;
  inputs: MoneyOrder;
  /** Every active shop's code and rate — the Tax rate picker's list. */
  shopRates: { code: string; tax_rate: number | string | null }[];
  /** `fulfillment === "delivery"` — whether a delivery charge belongs here. */
  isDelivery: boolean;
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

  // A RATE IS SET — `null` is no rate, and 0 is somebody saying "no rush fee on
  // this one", which is a rate and must keep the dollar box out of the answer.
  const hasRushRate = inputs.rush_rate !== null && inputs.rush_rate !== undefined;

  const currentRush = Number(inputs.rush_fee ?? 0);
  // Only while it would actually change something, and only until dismissed.
  // NOT OFFERED WHERE A RATE ALREADY DECIDES IT (118): the `→` writes a dollar
  // amount, which a rate would then ignore — an offer whose effect is nothing
  // is worse than no offer. A rush order created since 118 therefore arrives
  // priced rather than asked about, and the tap is still there for the ones
  // that did not.
  const offerRush =
    canWrite && !hasRushRate && rushSuggestion !== null && !dismissed &&
    Math.abs(currentRush - rushSuggestion) > 0.005;

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
      {/* THE TWO TRACKS SIZE TO THEIR CONTENT, not to half the block each.
          `grid-cols-2` is `repeat(2, minmax(0, 1fr))`, so both columns took the
          width of the WIDER one — the inputs — and the figures beside them were
          padded out to match. Sizing each to its own content lets the input
          column take the ~40px the rush-fee offer needs while the figures give
          back the ~60px they never used: measured, the whole block went from
          505px to 483px and Payments beside it gained the difference. The
          `max-w` cap stays as a backstop for the day a label grows. */}
      {/* A WIDE GUTTER, 96px (Mark, 2026-09-25: "add quite a bit of padding
          between the two columns in Money"), once the block had the row to
          itself above Invoices and Payments. The cap grows by the same 64px
          so neither column is squeezed to pay for it. */}
      <div className="grid max-w-[36rem] gap-x-24 gap-y-6 md:grid-cols-[auto_auto]">
        {/* --------- the inputs --------- */}
        <dl className="space-y-3 text-[14px]">
          {/* TAXABLE ITEMS AND NO RATE IS FLAGGED (Mark, 2026-10-06): SO-10110
              reached an invoice untaxed because an empty box here said
              nothing. 0% is a rate and is not flagged. */}
          <Line
            label="Tax rate"
            after={
              missingTaxRate(inputs.tax_rate, totals.taxableSubtotal) ? (
                <span className="bg-mark-fill px-1 text-[12px] font-normal text-ink">not set</span>
              ) : undefined
            }
          >
            {/* Stored as a FRACTION (.0975) and TYPED AS A PERCENTAGE (Mark,
                2026-09-20) — `lib/percent` holds the pair and the reasoning.
                The column keeps FileMaker's convention; the box in front of
                you is in the units on the sign in the window. */}
            {canWrite ? (
              <TaxRateCell id={id} value={inputs.tax_rate} shopRates={shopRates} />
            ) : (
              <Cell id={id} canWrite={false} column="tax_rate" value={inputs.tax_rate} label="Tax rate"
                    percent />
            )}
          </Line>
          {/* ONE DISCOUNT OR THE OTHER (Mark, 2026-10-02: "if a user enters a
              dollar discount amount, the percentage discount field should be
              cleared disabled, and vice versa. Clearing it enables both
              fields again"). Entering one empties the other in the same
              write; each is disabled while the other holds a value. The two
              still ADD in `orderTotals`, which is why both at once was a
              trap: 492 FileMaker orders carry the percentage AND its dollar
              figure, and were discounted twice. An order still holding both
              keeps both enabled, so either can be cleared. */}
          <Line label="Discount ($)">
            <Cell id={id} canWrite={canWrite} column="discount_amount" value={inputs.discount_amount} label="Discount amount"
                  format={(v) => money(Number(v))}
                  disabled={hasValue(inputs.discount_rate) && !hasValue(inputs.discount_amount)}
                  alsoUpdate={(next) => (hasValue(next) ? { discount_rate: null } : null)} />
          </Line>
          {/* "(%)" RATHER THAN "(RATE)" (Mark, 2026-09-20), which pairs it with
              "Discount ($)" directly above: the two rows are one question asked
              in two units, and the labels now say which unit each takes. It is
              also the label agreeing with what the box finally accepts. */}
          <Line label="Discount (%)">
            {/* THE ONE MARK TYPED 20 INTO. It read "2000%" afterwards, which is
                a 20× discount and would have taken the order below zero. */}
            <Cell id={id} canWrite={canWrite} column="discount_rate" value={inputs.discount_rate} label="Discount rate"
                  percent
                  disabled={hasValue(inputs.discount_amount) && !hasValue(inputs.discount_rate)}
                  alsoUpdate={(next) => (hasValue(next) ? { discount_amount: null } : null)} />
          </Line>
          {/* NOT ON A PICKUP ORDER (Mark, 2026-10-02) — switching to pickup
              removes the charge (migration 168), so there is nothing to show.
              Unless one is THERE: 377 orders were pickup with a charge before
              168, the Cafe Knotted standing days among them, and a charge the
              total counts must stay visible and editable. */}
          {(isDelivery || Number(inputs.delivery_charge ?? 0) !== 0) && (
            <Line label="Delivery charge">
              <Cell id={id} canWrite={canWrite} column="delivery_charge" value={inputs.delivery_charge} label="Delivery charge"
                    format={(v) => money(Number(v))} />
            </Line>
          )}
          {/* THE SUGGESTION SITS AFTER THE LABEL, which is the third place it
              has been and the one that costs nothing. Beside the FIELD it
              squeezed it to 88px where the other four were 96 (which is what
              `shrink-0` on `MONEY_FIELD` now prevents); under the field it kept
              the width but broke the clean column of identical boxes that width
              had just bought; under the LABEL it pushed every row beneath it
              down. On the label's own line it takes room the track already had
              once the two grid columns stopped being forced equal. */}
          <Line
            label="Rush fee"
            after={
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
            <Cell id={id} canWrite={canWrite} column="rush_fee"
                  value={inputs.rush_fee} label="Rush fee"
                  format={(v) => money(Number(v))}
                  disabled={hasRushRate && !hasValue(inputs.rush_fee)}
                  alsoUpdate={(next) => (hasValue(next) ? { rush_rate: null } : null)} />
          </Line>
          {/* THE RATE, BESIDE THE AMOUNT — `discount_amount` / `discount_rate`'s
              own pair, one row lower (migration 118). The two rows are one
              question asked in two units, which is the wording decision the
              discount labels already made.

              ONE OR THE OTHER, LIKE THE DISCOUNT (Mark, 2026-10-02: "we need to
              do the same with rush fee as we did discount"). Entering a dollar
              fee empties the rate in the same write and the other way round;
              each is disabled while the other holds a value; clearing it opens
              both. It used to show what a rate came to in a read-only dollar
              box — that figure is in the right-hand column as "Rush fee".
              A RATE OF 0 COUNTS AS SET, unlike a $0 fee: it is somebody saying
              "no rush fee on this one", which `orderTotals` honours. */}
          <Line label="Rush fee (%)">
            <Cell id={id} canWrite={canWrite} column="rush_rate" value={inputs.rush_rate ?? null}
                  label="Rush fee rate" percent
                  disabled={hasValue(inputs.rush_fee) && !hasRushRate}
                  alsoUpdate={(next) => (next === null || next === "" ? null : { rush_fee: null })} />
          </Line>
          {/* NO EXPLANATORY SENTENCE BESIDE THE SWITCH (Mark, 2026-08-19:
              "remove the note"). It read "Wholesale days are billed weekly, not
              per order", which is one REASON you might reach for this switch
              and not what it does — so on every other order it was a sentence
              about somebody else's order. The switch's own accessible name still
              says what it does; it is the label that names the control, and the
              control is named. */}
          <Line label="Ignore the balance">
            <Checkbox
              size="lg"
              checked={Boolean(inputs.ignore_balance)}
              disabled={!canWrite || pending}
              onChange={() => setIgnoreBalance(!inputs.ignore_balance)}
              label="Keep this order out of the unpaid queue"
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
 * `after` puts something on the label's OWN LINE, to its right (Mark,
 * 2026-08-28: "I think the rush fee would fit after the label. If not we could
 * make a little more room for it"). Only the rush fee uses it.
 *
 * It fits because the two grid tracks stopped being forced equal — see the
 * grid's own note. Beneath the label (where this sat for an hour) it pushed
 * every later row down and made the block taller than the figures beside it;
 * beside the label it costs the block nothing at all.
 *
 * It goes INSIDE the `dt` rather than in a wrapper around it, because `dl` >
 * `div` > `dt` is as deep as the grouping element may nest — another div around
 * the `dt` is invalid. The dt's uppercase tracking is reset for it, and the row
 * stays `items-baseline` so the label, the offer and the field sit on one line.
 */
function Line({
  label,
  after,
  children,
}: {
  label: string;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex items-baseline gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {after ? (
          <span className="normal-case tracking-normal">{after}</span>
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

/** A discount field that is SET — null, blank and 0 all mean "no discount". */
function hasValue(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0;
}

function Cell({
  id,
  canWrite,
  column,
  value,
  label,
  format,
  percent = false,
  disabled = false,
  alsoUpdate,
}: {
  id: string;
  canWrite: boolean;
  /** Greyed and unwritable, box kept — the discount pair's other half. */
  disabled?: boolean;
  /** Columns written in the SAME update — `InlineValue`'s own prop. */
  alsoUpdate?: (next: string | number | null) => Record<string, string | number | null> | null;
  column: string;
  value: number | null;
  label: string;
  format?: (v: string | number) => string;
  /**
   * A rate stored as a FRACTION and read and typed as a percentage — the scale
   * and the label travel together, because either one alone is a cell in two
   * units. See `lib/percent`.
   */
  percent?: boolean;
}) {
  const label_ = percent ? percentLabel : format;
  if (!canWrite) {
    // The same width below purchaser+, or the block reflows depending on who
    // is looking at it. The read-only branch scales for itself: it never goes
    // near `InlineValue`, so nothing else would do it.
    const shown = percent && value !== null ? toPercent(Number(value)) : value;
    return (
      <span className={`${MONEY_FIELD} ${READ_ONLY_VALUE} text-right tabular-nums`}>
        {shown === null ? "—" : label_ ? label_(shown) : shown}
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
      scale={percent ? PERCENT_SCALE : undefined}
      format={label_}
      disabled={disabled}
      alsoUpdate={alsoUpdate}
    />
    </span>
  );
}

/**
 * THE TAX RATE IS CHOSEN, from the rates the shops charge (Mark, 2026-10-02),
 * with typing kept for a rate no shop uses. Sending to QuickBooks now picks
 * the tax code whose rate EQUALS this one, so a typo is a refused invoice
 * rather than a wrong tax — `lib/taxRates` has the reasoning, and SO-10098's
 * 10.5% is the case.
 *
 * Its own PickList rather than `InlineValue kind="pick"`, because a pick cell
 * writes the option's value as it stands and this one has to turn it into a
 * fraction first. The new rate shows on the tap and is written behind it
 * (`lib/latestWrite`); a refused write puts the old one back.
 */
function TaxRateCell({
  id,
  value,
  shopRates,
}: {
  id: string;
  value: number | string | null;
  shopRates: { code: string; tax_rate: number | string | null }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const saved = value === null || value === "" ? null : Number(value);
  const [shown, setShown] = useState<{ rate: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setShown(null);
  }
  const current = shown ? shown.rate : saved;

  const save = useLatestWrite<number | null>(
    async (rate) => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update({ tax_rate: rate })
        .eq("id", id)
        .select("id");
      if (e) return e.message;
      if (!data?.length) return "The rate wasn't saved — the database refused it silently.";
      return null;
    },
    (failure) => {
      if (failure) {
        setError(failure);
        setShown(null);
      }
      router.refresh();
    }
  );

  return (
    <span className={`${MONEY_FIELD} inline-flex flex-col`}>
      <PickList
        boxed={BOXED_FIELDS}
        allowNew
        clearable
        align="right"
        ariaLabel="Tax rate"
        value={current === null ? null : optionValue(current)}
        options={taxRateOptions(shopRates, current)}
        panelMinWidth={200}
        onPick={(next) => {
          setError(null);
          if (next === "") {
            setShown({ rate: null });
            save(null);
            return;
          }
          const rate = parseTaxRatePick(next);
          if (rate === null) {
            setError("not a rate");
            return;
          }
          setShown({ rate });
          save(rate);
        }}
      />
      {error ? <span className="text-xs text-accent">{error}</span> : null}
    </span>
  );
}
