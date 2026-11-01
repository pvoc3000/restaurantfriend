// The /forms specimens for the CREDIT MEMO (218) — the two cases it was built
// for: Knotted's 42 Bismarks short on a paid wholesale invoice, credited to
// the next one, and a retail order's missing item refunded to the card.

import type { CreditMemoDoc } from "@/components/creditMemos/pdf/CreditMemoPdf";

export const sampleCreditMemo: CreditMemoDoc = {
  number: "CM-10000",
  kindLabel: "Short shipment",
  reason: "Short shipment",
  note: "Dropped a rack at the handover.",
  issued_on: "2026-11-01",
  invoice: "INV-10025-2",
  order: "SO-10137 · Knotted weekly",
  customer: { name: "Cafe Knotted", phone: "(323) 555-0142", email: "orders@example.com" },
  lines: [
    { item: "Knotted Bismark - 42g", billed: 560, delivered: 518, price: 1.55, short: 42, amount: 65.1, kind: "item" },
  ],
  total: 65.1,
  settlement: "This credit will be applied to your next invoice.",
  void: false,
};

export const sampleRefundedCreditMemo: CreditMemoDoc = {
  number: "CM-10001",
  kindLabel: "Short shipment",
  reason: "Short shipment",
  note: "Left out of the box.",
  issued_on: "2026-11-01",
  invoice: "INV-10032",
  order: "SO-10152 · Birthday",
  customer: { name: "A retail customer", phone: null, email: "customer@example.com" },
  lines: [
    { item: "Small Brown Bites (x12)", billed: 4, delivered: 0, price: 4.45, short: 4, amount: 17.8, kind: "item" },
    { item: "Sales tax", billed: null, delivered: null, price: null, short: null, amount: 1.82, kind: "tax" },
  ],
  total: 19.62,
  settlement: "Refunded to the card it was paid with on 11/1/2026.",
  void: false,
};
