/**
 * A RATE STORED AS A FRACTION AND TYPED AS A PERCENTAGE.
 *
 * Mark, 2026-09-20, on the special order's Payments tab: "it seems like we
 * should enter a whole number and let the app convert it to a decimal. I
 * intuitively typed 20 for a percentage instead of .2. I think others would as
 * well."
 *
 * He is right, and the cell was already telling him so: the RESTING value read
 * "20%" while the EDITOR wanted `.2`. Those are two different units in one
 * control, and `InlineValue`'s own `scale` prop exists for exactly this —
 * "showing 0.50 at rest and putting 30 in the box the moment you click it
 * invites someone to type an hour figure into a minutes column", written for
 * `unpaid_break_minutes` and never applied here. So this is not a new idea, it
 * is the existing one reaching the three cells that needed it.
 *
 * WHAT IT DOES NOT DO IS GUESS. A rule like "over 1 means a percentage" would
 * read 20 as 20% and 0.2 as 20% too, which is convenient right up to the first
 * person who means half a per cent. The cell is a percentage field end to end:
 * what it shows is what you type, and 0.2 typed here is two tenths of one per
 * cent — visibly, because the cell then reads "0.2%".
 *
 * THE STORED FRACTION IS UNCHANGED. `special_orders.tax_rate` is
 * `numeric(6,5)`, `discount_rate` is `numeric(6,4)` "a FRACTION: .10 is ten per
 * cent", and `locations.tax_rate` feeds the snapshot. Nothing about the schema
 * or the arithmetic moves; only the units the human types in.
 */

/**
 * 0.0975 → 9.75. Fraction to the number on the sign in the window.
 *
 * ROUNDED, because `0.07 * 100` is `7.000000000000001` in binary floating
 * point and that is what would land in the edit box. Four decimal places is
 * past anything either column can hold: `numeric(6,5)` stops at 0.001%.
 */
export function toPercent(fraction: number): number {
  return Number((fraction * 100).toFixed(4));
}

/**
 * 9.75 → 0.0975. The number typed, back into the column's own unit.
 *
 * Six places for the same reason in the other direction — `20 / 100` is exact
 * but plenty of pairs are not — and it is deliberately finer than either
 * column's scale, so the rounding that decides the stored value is Postgres's
 * own and not a second opinion here.
 */
export function toFraction(percent: number): number {
  return Number((percent / 100).toFixed(6));
}

/** Both ways, for `InlineValue`'s `scale`. */
export const PERCENT_SCALE = { toShown: toPercent, toStored: toFraction };

/**
 * The resting label: 9.75 → "9.75%", 20 → "20%".
 *
 * It takes the SHOWN value, because `format` is applied after `scale` — so the
 * pair is passed together or not at all. No trailing zeros: "9.750%" is a
 * precision claim nobody made, and the two callers on the Payments tab had
 * been spelling this two different ways (three decimals and two) for no reason
 * anybody could state.
 */
export function percentLabel(shown: string | number): string {
  const n = typeof shown === "string" ? Number(shown) : shown;
  return Number.isFinite(n) ? `${Number(Number(n).toFixed(4))}%` : String(shown);
}
