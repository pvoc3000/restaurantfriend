// `supabase/functions/_shared/squareOrder` — the Square order behind a pay-link
// payment. The one property that matters above all: whatever the split, Square's
// total is the invoice's balance to the cent. Checked by BREAKING it — dropping
// the rounding line (`other += rounding`) turns the half-to-even case red.

import { test, eq, ok } from "./harness";
import {
  bankersRound,
  buildSquareOrder,
  percentString,
  type PayBreakdown,
} from "../../../supabase/functions/_shared/squareOrder";

/** What Square will compute for a plan, the way Square computes it. */
function squareTotal(order: Record<string, unknown>): number {
  const lines = order.line_items as { base_price_money: { amount: number }; applied_taxes?: unknown[] }[];
  const taxes = (order.taxes as { percentage: string }[] | undefined) ?? [];
  const pct = taxes.length ? Number(taxes[0].percentage) : 0;
  let total = 0;
  for (const l of lines) {
    total += l.base_price_money.amount;
    if (l.applied_taxes?.length) total += bankersRound((l.base_price_money.amount * pct) / 100);
  }
  for (const sc of (order.service_charges as { amount_money: { amount: number } }[] | undefined) ?? []) {
    total += sc.amount_money.amount;
  }
  return total;
}

const base = { label: "Order #10071 — Birthday", variationId: "VAR1", locationId: "LOC", referenceId: "Order 10071" };

function bd(over: Partial<PayBreakdown> = {}): PayBreakdown {
  // $100 taxable at 9.5%, $25 rush, $15 delivery — 100 + 9.50 + 25 + 15.
  return { taxable_net: 100, other_net: 25, delivery: 15, tax: 9.5, tax_rate: 0.095, total: 149.5, ...over };
}

test("bankersRound: half to even, everything else to nearest", () => {
  eq(bankersRound(2.5), 2);
  eq(bankersRound(3.5), 4);
  eq(bankersRound(2.4999), 2);
  eq(bankersRound(2.5001), 3);
  eq(bankersRound(7), 7);
});

test("percentString: no float noise", () => {
  eq(percentString(0.095), "9.5");
  eq(percentString(0.1025), "10.25");
  eq(percentString(0.0725), "7.25");
});

test("paid nothing yet: goods, untaxed goods, delivery and tax, summing to the invoice", () => {
  const p = buildSquareOrder({ ...base, balanceCents: 14950, breakdown: bd() });
  eq(p.single, false);
  eq(p.taxCents, 950);
  eq(p.roundingCents, 0);
  const lines = p.order.line_items as { name: string; base_price_money: { amount: number }; catalog_object_id?: string; applied_taxes?: unknown[] }[];
  eq(lines.map((l) => [l.name, l.base_price_money.amount, Boolean(l.applied_taxes)]), [
    ["Order #10071 — Birthday", 10000, true],
    ["Order #10071 — Birthday (not taxed)", 2500, false],
  ]);
  ok(lines.every((l) => l.catalog_object_id === "VAR1"), "every line is the Special Orders item");
  eq((p.order.service_charges as { name: string; amount_money: { amount: number }; taxable: boolean }[])[0].amount_money.amount, 1500);
  eq(squareTotal(p.order), 14950);
});

test("Square's half-to-even tax differs from ours by a cent: the untaxed line absorbs it", () => {
  // $10.50 taxable at 10% → 105 cents exactly, no disagreement; at 5% → 52.5¢:
  // Square says 52 (even), orderTotals said 53 (half up). Invoice total 11.03.
  const p = buildSquareOrder({
    ...base,
    balanceCents: 1103,
    breakdown: bd({ taxable_net: 10.5, other_net: 0, delivery: 0, tax: 0.53, tax_rate: 0.05, total: 11.03 }),
  });
  eq(p.taxCents, 52);
  eq(p.roundingCents, 1);
  eq(squareTotal(p.order), 1103);
  const lines = p.order.line_items as unknown[];
  eq(lines[1], { name: "Order #10071 — Birthday (not taxed)", quantity: "1", catalog_object_id: "VAR1", base_price_money: { amount: 1, currency: "USD" } });
});

test("part-paid: every part scales to the balance, and still sums exactly", () => {
  // $50 deposit already recorded on the $149.50 invoice.
  const p = buildSquareOrder({ ...base, balanceCents: 9950, breakdown: bd() });
  eq(p.single, false);
  eq(squareTotal(p.order), 9950);
  ok(Math.abs(p.roundingCents) <= 2, "pennies only");
});

test("no tax on the order: no tax object, and still exact", () => {
  const p = buildSquareOrder({ ...base, balanceCents: 4000, breakdown: bd({ taxable_net: 0, other_net: 40, delivery: 0, tax: 0, total: 40 }) });
  eq(p.order.taxes, undefined);
  eq((p.order.line_items as unknown[]).length, 1);
  eq(squareTotal(p.order), 4000);
});

test("no breakdown (a link sent before 123): one line, Special Orders, the balance", () => {
  const p = buildSquareOrder({ ...base, balanceCents: 4200, breakdown: null });
  eq(p.single, true);
  eq(squareTotal(p.order), 4200);
  eq((p.order.line_items as { catalog_object_id?: string }[])[0].catalog_object_id, "VAR1");
});

test("no Special Orders item configured: lines carry no catalog id (Uncategorized), totals unchanged", () => {
  const p = buildSquareOrder({ ...base, variationId: null, balanceCents: 14950, breakdown: bd() });
  ok((p.order.line_items as Record<string, unknown>[]).every((l) => !("catalog_object_id" in l)));
  eq(squareTotal(p.order), 14950);
});

test("a breakdown that disagrees with the balance by more than pennies falls back to one line", () => {
  const p = buildSquareOrder({ ...base, balanceCents: 14950, breakdown: bd({ total: 149.5, other_net: 90 }) });
  eq(p.single, true);
  eq(squareTotal(p.order), 14950);
});

// ---- 126: lines per Square item ----------------------------------------

const untaxed = (total: number, delivery = 0): PayBreakdown => ({
  taxable_net: 0, other_net: total - delivery, delivery, tax: 0, tax_rate: 0, total,
});

test("groups: Knotted days as Wholesale and a birthday as Special, one order, each its own item", () => {
  const plan = buildSquareOrder({
    ...base,
    balanceCents: 173850,
    breakdown: null,
    groups: [
      { variationId: "WHOLE", breakdown: untaxed(613.5, 40) },
      { variationId: "WHOLE", breakdown: untaxed(1125, 40) },
      { variationId: "SPECIAL", breakdown: untaxed(0, 0) },
    ].filter((g) => g.breakdown.total > 0),
  });
  eq(plan.single, false);
  eq(squareTotal(plan.order), 173850);
  const lines = plan.order.line_items as { catalog_object_id: string; base_price_money: { amount: number } }[];
  eq(lines.length, 1, "the two Wholesale days merge into one line");
  eq(lines[0].catalog_object_id, "WHOLE");
  eq((plan.order.service_charges as { amount_money: { amount: number } }[])[0].amount_money.amount, 8000);
});

test("groups: two items, two lines, the total to the cent", () => {
  const plan = buildSquareOrder({
    ...base,
    balanceCents: 100000,
    breakdown: null,
    groups: [
      { variationId: "WHOLE", breakdown: untaxed(613.5, 40) },
      { variationId: "SPECIAL", breakdown: untaxed(386.5) },
    ],
  });
  const lines = plan.order.line_items as { catalog_object_id: string; base_price_money: { amount: number } }[];
  eq(lines.map((l) => l.catalog_object_id), ["WHOLE", "SPECIAL"]);
  eq(lines.map((l) => l.base_price_money.amount), [57350, 38650]);
  eq(squareTotal(plan.order), 100000);
});

test("groups: a part-paid invoice scales every group and still lands on the balance", () => {
  const plan = buildSquareOrder({
    ...base,
    balanceCents: 33333,
    breakdown: null,
    groups: [
      { variationId: "WHOLE", breakdown: untaxed(613.5, 40) },
      { variationId: "SPECIAL", breakdown: untaxed(386.5) },
    ],
  });
  eq(plan.single, false);
  eq(squareTotal(plan.order), 33333);
});

test("groups: tax on one item's goods is predicted as for one line", () => {
  const taxed: PayBreakdown = { taxable_net: 100, other_net: 0, delivery: 0, tax: 9.75, tax_rate: 0.0975, total: 109.75 };
  const plan = buildSquareOrder({
    ...base,
    balanceCents: 72325,
    breakdown: null,
    groups: [
      { variationId: "WHOLE", breakdown: untaxed(613.5) },
      { variationId: "SPECIAL", breakdown: taxed },
    ],
  });
  eq(plan.single, false);
  eq(plan.taxCents, 975);
  eq(squareTotal(plan.order), 72325);
});

test("groups: taxed goods under two items collapse to the one-item order", () => {
  const taxed: PayBreakdown = { taxable_net: 100, other_net: 0, delivery: 0, tax: 9.75, tax_rate: 0.0975, total: 109.75 };
  const summed: PayBreakdown = { taxable_net: 200, other_net: 0, delivery: 0, tax: 19.5, tax_rate: 0.0975, total: 219.5 };
  const plan = buildSquareOrder({
    ...base,
    balanceCents: 21950,
    breakdown: summed,
    variationId: "SPECIAL",
    groups: [
      { variationId: "WHOLE", breakdown: taxed },
      { variationId: "SPECIAL", breakdown: taxed },
    ],
  });
  const lines = plan.order.line_items as { catalog_object_id: string }[];
  ok(lines.every((l) => l.catalog_object_id === "SPECIAL"), "one item, the fallback's");
  eq(squareTotal(plan.order), 21950);
});

test("groups: absent or a single item is exactly the one-item order", () => {
  const one = buildSquareOrder({ ...base, balanceCents: 61350, breakdown: untaxed(613.5, 40), variationId: "WHOLE" });
  const grouped = buildSquareOrder({
    ...base,
    balanceCents: 61350,
    breakdown: null,
    variationId: null,
    groups: [{ variationId: "WHOLE", breakdown: untaxed(613.5, 40) }],
  });
  eq(grouped, one);
});
