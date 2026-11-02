// Moving a Square refund of a credit memo out of "Uncategorized" (220).
import { test, eq, ok } from "./harness";
import { allocateCents, splitMemoRefunds, type SplitLine } from "../../../supabase/functions/_shared/memoRefundSplit";

const sum = (lines: SplitLine[]) => lines.reduce((a, l) => a + l.cents, 0);
const day: SplitLine[] = [
  { kind: "category", key: "Donuts", name: "Donuts", cents: 120000 },
  { kind: "category", key: "Special Orders", name: "Special Orders", cents: 16405 },
  { kind: "category", key: "Uncategorized", name: "Uncategorized", cents: -1962 },
  { kind: "tax", key: "sales_tax", name: "Sales tax", cents: 9000 },
  { kind: "tender", key: "CARD", name: "CARD", cents: 143443 },
];

test("splitMemoRefunds: the brown bites — goods to Special Orders, tax back, Uncategorized gone", () => {
  const r = splitMemoRefunds(day, [{ label: "CM-10001", goods: [{ category: "Special Orders", cents: 1780 }], deliveryCents: 0, taxCents: 182 }]);
  eq(r.movedCents, 1962, "moved the whole refund");
  eq(r.warnings.length, 0, "no warning");
  ok(!r.lines.some((l) => l.key === "Uncategorized"), "the zeroed Uncategorized line is dropped");
  eq(r.lines.find((l) => l.key === "Special Orders")!.cents, 16405 - 1780, "goods reversed in their category");
  eq(r.lines.find((l) => l.kind === "tax")!.cents, 9000 - 182, "tax given back");
  eq(sum(r.lines), sum(day), "the day's sum does not move");
});

test("splitMemoRefunds: delivery becomes a negative Delivery service charge", () => {
  const r = splitMemoRefunds(
    [{ kind: "category", key: "Uncategorized", name: "Uncategorized", cents: -2500 }],
    [{ label: "CM-1", goods: [], deliveryCents: 2500, taxCents: 0 }]
  );
  eq(r.lines.length, 1, "one line");
  eq(r.lines[0].kind, "service_charge", "service charge");
  eq(r.lines[0].cents, -2500, "negative");
});

test("splitMemoRefunds: a refund the day does not show is left alone, with a sentence", () => {
  const r = splitMemoRefunds(day, [{ label: "CM-9", goods: [{ category: "Special Orders", cents: 5000 }], deliveryCents: 0, taxCents: 0 }]);
  eq(r.movedCents, 0, "nothing moved");
  eq(r.warnings.length, 1, "said so");
  eq(JSON.stringify(r.lines), JSON.stringify(day), "lines unchanged");
});

test("allocateCents: proportional, exact, pennies to the largest remainders", () => {
  eq(JSON.stringify(allocateCents(100, [1, 1, 1])), JSON.stringify([34, 33, 33]), "100 over three");
  eq(allocateCents(1781, [3780, 1760]).reduce((a, c) => a + c, 0), 1781, "sums exactly");
  eq(JSON.stringify(allocateCents(50, [0, 0])), JSON.stringify([50, 0]), "all-zero weights → first");
});
