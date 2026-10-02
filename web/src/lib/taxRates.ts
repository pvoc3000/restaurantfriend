import { toFraction, toPercent } from "./percent";

/**
 * AN ORDER'S TAX RATE IS CHOSEN FROM THE RATES THE SHOPS CHARGE (Mark,
 * 2026-10-02), not typed — "a known vocabulary is chosen, never typed" — with
 * typing kept for the rare rate no shop uses, a delivery district say.
 *
 * Why it matters now: sending to QuickBooks chooses the tax code whose rate
 * EQUALS the order's (`_shared/taxCodes`), so a typo is no longer a wrong tax
 * quietly charged, it is an invoice refused. SO-10098 was typed at 10.5%, a
 * rate no other order and no QuickBooks code has; picking from the list is how
 * that stops happening at the source.
 *
 * The list is the APP's, not QuickBooks': a quote must not need QuickBooks to
 * be connected, and most orders are collected through Square and never go
 * there at all.
 */

export type TaxRateOption = { value: string; label: string; hint?: string };

/** A chosen option carries its FRACTION behind this prefix; anything else
 *  reaching `parseTaxRatePick` was typed, and is read as a percentage. */
const PICKED = "rate:";

/** 0.1025 → "10.25%". */
export function taxRateLabel(fraction: number): string {
  return `${toPercent(fraction)}%`;
}

/**
 * Each distinct rate the ACTIVE shops charge, naming the shops; 0% for an
 * untaxed order; and the order's own rate when it is none of those, so the
 * field still says what it holds.
 */
export function taxRateOptions(
  shops: { code: string; tax_rate: number | string | null }[],
  current: number | null
): TaxRateOption[] {
  const byRate = new Map<number, string[]>();
  for (const s of shops) {
    if (s.tax_rate === null || s.tax_rate === "") continue;
    const r = Number(s.tax_rate);
    if (!Number.isFinite(r) || r <= 0) continue;
    const key = toFraction(toPercent(r));
    byRate.set(key, [...(byRate.get(key) ?? []), s.code]);
  }
  const out: TaxRateOption[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([r, codes]) => ({
      value: optionValue(r),
      label: taxRateLabel(r),
      hint: codes.sort().join(", "),
    }));
  out.push({ value: optionValue(0), label: taxRateLabel(0), hint: "not taxed" });
  if (current !== null && Number.isFinite(Number(current))) {
    const c = optionValue(Number(current));
    if (!out.some((o) => o.value === c)) {
      out.push({ value: c, label: taxRateLabel(Number(current)), hint: "this order" });
    }
  }
  return out;
}

/** The value an option at this rate carries — and the field's own value, so
 *  the current rate is shown as chosen. */
export function optionValue(fraction: number): string {
  return `${PICKED}${toFraction(toPercent(fraction))}`;
}

/**
 * What a pick means, as the fraction to store. A chosen option is exact; typed
 * text is a PERCENTAGE ("10.5" or "10.5%"), the unit on the sign in the window
 * (`lib/percent`). Null for anything that is not a rate: empty, negative, or
 * 100% and over.
 */
export function parseTaxRatePick(picked: string): number | null {
  const raw = picked.trim();
  if (raw.startsWith(PICKED)) {
    const f = Number(raw.slice(PICKED.length));
    return Number.isFinite(f) && f >= 0 && f < 1 ? f : null;
  }
  const text = raw.replace(/%$/, "").trim();
  if (text === "" || !/^\d*\.?\d+$/.test(text)) return null;
  const pct = Number(text);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
  return toFraction(pct);
}
