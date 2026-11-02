// A SQUARE REFUND OF A CREDIT MEMO, BOOKED AS WHAT IT WAS (220; the pinned
// 2026-09-22 refund thread, option 1).
//
// Square's API refunds by AMOUNT only, and reports an amount refund as a return
// on the "Uncategorized" category with the tax left inside it — so the morning
// journal entry used to reverse a Special Orders sale into Uncategorized Income
// and never give the tax back. A memo knows what the money was: goods, delivery
// and tax. On the day the refund reports, its amount comes OUT of the
// Uncategorized return and goes back against the lines the pay link's sale was
// booked on — the goods' own categories, the "Delivery" service charge, the
// sales tax. The day's sum does not move, so it balances exactly as before.
//
// A refund the day does not show as an Uncategorized return of at least its
// amount is left as Square reports it, with a sentence: never a guess.
//
// PURE, NO DENO APIS AND NO IMPORTS, so `web/scripts/fixtures` compiles and
// tests this very file.

export type SplitLine = { kind: string; key: string; name: string; cents: number };

export type MemoRefund = {
  /** "CM-10001". */
  label: string;
  /** Goods given back, by the category the original sale's lines report in. */
  goods: { category: string; cents: number }[];
  deliveryCents: number;
  taxCents: number;
};

const UNCATEGORIZED = "Uncategorized";

/** `total` split over `weights` in proportion, the pennies to the largest
 *  remainders, summing exactly. All-zero weights put it all on the first. */
export function allocateCents(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((a, c) => a + c, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i] += 1;
  return out;
}

/** The day's lines with each memo refund moved out of Uncategorized. */
export function splitMemoRefunds(
  lines: SplitLine[],
  refunds: MemoRefund[]
): { lines: SplitLine[]; movedCents: number; warnings: string[] } {
  const out = lines.map((l) => ({ ...l }));
  const warnings: string[] = [];
  let moved = 0;
  const bump = (kind: string, key: string, name: string, cents: number) => {
    if (cents === 0) return;
    const l = out.find((x) => x.kind === kind && x.key === key);
    if (l) l.cents += cents;
    else out.push({ kind, key, name, cents });
  };
  for (const r of refunds) {
    const goods = r.goods.reduce((a, g) => a + g.cents, 0);
    const total = goods + r.deliveryCents + r.taxCents;
    if (total <= 0) continue;
    const uncategorized = out.find((l) => l.kind === "category" && l.key === UNCATEGORIZED);
    if (!uncategorized || uncategorized.cents > -total) {
      warnings.push(
        `${r.label}'s refund of $${(total / 100).toFixed(2)} is not an Uncategorized return on this day, so it posts as Square reports it`
      );
      continue;
    }
    uncategorized.cents += total;
    for (const g of r.goods) bump("category", g.category, g.category, -g.cents);
    bump("service_charge", "Delivery", "Delivery", -r.deliveryCents);
    bump("tax", "sales_tax", "Sales tax", -r.taxCents);
    moved += total;
  }
  return { lines: out.filter((l) => l.cents !== 0), movedCents: moved, warnings };
}
