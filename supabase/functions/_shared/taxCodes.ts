/**
 * WHICH QUICKBOOKS TAX CODE AN INVOICE GOES UNDER — chosen by RATE, at send
 * time, and never stored (Mark, 2026-10-02).
 *
 * Until this, Settings held one tax code by its QuickBooks Id and every taxed
 * invoice went under it. That Id goes stale on every rate change: editing a
 * custom rate in QuickBooks does not change it, it renames the old code
 * "… - Inactive", deactivates it and makes a new one under a NEW Id. QuickBooks
 * then accepts the dead code on an invoice without a fault and taxes at the old
 * rate — INV-10006, 2026-10-02, taxed at 9.5% under code 6.
 *
 * So the ORDER's rate is the app's truth and the code is looked up: the active
 * code whose rate equals it. A rate QuickBooks has no active code for is a
 * REFUSAL that names the rate, which turns a silent wrong tax into a loud one,
 * and catches a rate changed in one system and not the other.
 *
 * The Settings code survives as a PREFERENCE, consulted only when several
 * active codes carry the same rate (Donut Friend's file has "Sales Tax" and
 * "CA-Los Angeles-Los Angeles-Culver City" both at 10.25%). Which one is
 * chosen does not change the tax; it changes which agency lines QuickBooks
 * reports it under.
 *
 * Pure, and outside `qbo-sync`, so the fixtures can run it.
 */

type Row = Record<string, unknown>;

export type QboTaxCode = {
  id: string;
  name: string;
  /** PERCENT (10.25), the SUM of the code's component rates — a combined code
   *  is state + county + district. Null when QuickBooks gave nothing to add. */
  rate: number | null;
};

/** QuickBooks' `TaxCode` and `TaxRate` rows → each code with its total rate.
 *  Only a code's rates carry a value, so both lists are needed. */
export function taxCodesWithRates(codes: Row[], rates: Row[]): QboTaxCode[] {
  const value = new Map(rates.map((r) => [String(r.Id), Number(r.RateValue)]));
  return codes.map((c) => {
    const details =
      ((c.SalesTaxRateList as { TaxRateDetail?: { TaxRateRef?: { value?: unknown } }[] } | undefined)
        ?.TaxRateDetail ?? []);
    const parts = details.map((d) => value.get(String(d.TaxRateRef?.value)));
    const known = details.length > 0 && parts.every((v) => v !== undefined && Number.isFinite(v));
    return {
      id: String(c.Id),
      name: String(c.Name ?? ""),
      rate: known ? round4(parts.reduce((a: number, v) => a + (v as number), 0)) : null,
    };
  });
}

/** 0.1025 → "10.25%". */
export function percentText(fraction: number): string {
  return `${round4(fraction * 100)}%`;
}

export type TaxCodeChoice =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

/**
 * The code for an invoice taxed at these rates (FRACTIONS, as the orders store
 * them). `codes` must be the ACTIVE codes only — an inactive one is exactly
 * what this exists to avoid.
 */
export function chooseTaxCode(
  fractions: number[],
  codes: QboTaxCode[],
  preferredId: string | null
): TaxCodeChoice {
  const taxed = [...new Set(fractions.filter((f) => Number.isFinite(f) && f > 0).map(round6))];
  if (taxed.length === 0) {
    return { ok: false, error: "This invoice charges tax but none of its orders has a tax rate." };
  }
  if (taxed.length > 1) {
    return {
      ok: false,
      error:
        `This invoice mixes tax rates (${taxed.map(percentText).join(", ")}), and a QuickBooks ` +
        "invoice takes one tax code. Send the orders on separate invoices, or give them the same rate.",
    };
  }
  const want = round4(taxed[0] * 100);
  const matches = codes.filter((c) => c.rate !== null && Math.abs(c.rate - want) < 0.00005);
  if (matches.length === 0) {
    return {
      ok: false,
      error:
        `No active QuickBooks tax code is ${want}%. Check the order's tax rate, or add the ` +
        "rate in QuickBooks, then send again.",
    };
  }
  if (matches.length === 1) return { ok: true, id: matches[0].id, name: matches[0].name };
  const preferred = matches.find((c) => c.id === preferredId);
  if (preferred) return { ok: true, id: preferred.id, name: preferred.name };
  return {
    ok: false,
    error:
      `More than one QuickBooks tax code is ${want}% (${matches.map((c) => c.name).join(", ")}). ` +
      "Choose the one to use in Settings → Integrations → QuickBooks.",
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
