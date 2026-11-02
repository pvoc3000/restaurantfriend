/**
 * CUSTOMER CREDIT MEMOS — the client's half (migrations 217, 218;
 * docs/customer-credit-memos-brief.md).
 *
 * A short is recorded on the order (`record_order_short`); a memo is issued
 * from it (`issue_credit_memo`) or as an allowance (`issue_allowance`), and
 * then SETTLED:
 *
 *   - 'credit' — applied to the customer's next invoice when it is sent. A
 *     QuickBooks memo must first be a QuickBooks CreditMemo (`push_credit_memo`)
 *     or QuickBooks cannot apply it;
 *   - 'refund' — given back now, through the processor that took the payment
 *     (`qbo-sync`'s `refund_payment` or `square-refund`, each with
 *     `credit_memo_id`), or by hand where the app collects.
 *
 * Every step after the issue can fail on its own and be done again from the
 * memo's record, so `settleCreditMemo` reports what happened rather than
 * throwing once the memo exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { invokeQbo } from "@/lib/qboClient";

export type CreditMemoKind = "short_shipment" | "allowance";
export type CreditMemoSettlement = "credit" | "refund";

/** One item of 217's `order_delivery`. */
export type DeliveryItem = {
  item_id: string;
  name: string;
  sort: number | null;
  ordered: number;
  delivered: number;
  /** A short is on record (delivered differs from ordered). */
  recorded: boolean;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string | null;
  /** On invoices that went out (sent, or holding money). */
  billed_qty: number;
  billed_price: number | null;
  credited_qty: number;
  /** The most a short memo may still give back. */
  creditable: number;
  taxable: boolean;
};

/** 220's `order_refundable`: what is billed and not yet given back, by kind.
 *  Amounts; a discount is negative. */
export type OrderRefundable = {
  items: number;
  discount: number;
  delivery: number;
  rush: number;
  tax: number;
  /** Already given back as an amount — "All" refuses an order with one. */
  allowance: number;
  total: number;
};

export type OrderDelivery = {
  items: DeliveryItem[];
  unbilled: number;
  credited: number;
  refundable: OrderRefundable;
  short_decision: "no_credit" | null;
  short_decision_note: string | null;
  short_decision_by: string | null;
  short_decision_at: string | null;
};

export function normalizeDelivery(raw: unknown): OrderDelivery | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    items: ((r.items as Record<string, unknown>[]) ?? []).map((i) => ({
      item_id: String(i.item_id),
      name: String(i.name ?? ""),
      sort: i.sort === null || i.sort === undefined ? null : Number(i.sort),
      ordered: num(i.ordered),
      delivered: num(i.delivered),
      recorded: Boolean(i.recorded),
      note: (i.note as string | null) ?? null,
      recorded_by: (i.recorded_by as string | null) ?? null,
      recorded_at: (i.recorded_at as string | null) ?? null,
      billed_qty: num(i.billed_qty),
      billed_price: i.billed_price === null || i.billed_price === undefined ? null : Number(i.billed_price),
      credited_qty: num(i.credited_qty),
      creditable: num(i.creditable),
      taxable: Boolean(i.taxable),
    })),
    unbilled: num(r.unbilled),
    credited: num(r.credited),
    refundable: (() => {
      const f = (r.refundable ?? {}) as Record<string, unknown>;
      return {
        items: num(f.items), discount: num(f.discount), delivery: num(f.delivery), rush: num(f.rush),
        tax: num(f.tax), allowance: num(f.allowance), total: num(f.total),
      };
    })(),
    short_decision: (r.short_decision as "no_credit" | null) ?? null,
    short_decision_note: (r.short_decision_note as string | null) ?? null,
    short_decision_by: (r.short_decision_by as string | null) ?? null,
    short_decision_at: (r.short_decision_at as string | null) ?? null,
  };
}

/** What is still waiting for a manager: a short on billed quantity that no
 *  memo covers and nobody decided against. Mirrors 217's to-do rule. */
export function creditableItems(d: OrderDelivery | null): DeliveryItem[] {
  if (!d || d.short_decision) return [];
  return d.items.filter((i) => i.creditable > 0);
}

/** `orgs.settings.customer_credit_memos.allowance_reasons`: why money is
 *  given back on anything but a short. */
export function readAllowanceReasons(settings: Record<string, unknown> | null | undefined): string[] {
  const m = (settings?.customer_credit_memos ?? {}) as { allowance_reasons?: unknown };
  return Array.isArray(m.allowance_reasons) ? m.allowance_reasons.filter((r): r is string => typeof r === "string") : [];
}

/** Quantities print as the order prints them: whole numbers bare. */
export function qtyLabel(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** "CM-10000", from the org's prefix (`orgs.settings.customer_credit_memos`). */
export function creditMemoNumberText(number: number, prefix: string | null | undefined): string {
  return `${prefix ?? ""}${number}`;
}

export const CREDIT_MEMO_KIND_LABEL: Record<CreditMemoKind, string> = {
  short_shipment: "Short shipment",
  allowance: "Allowance",
};

/** Which processor gives a memo's refund back. */
export type MemoRefundRoute = "quickbooks" | "square" | "hand";

/**
 * SETTLE A MEMO THAT EXISTS: push it to QuickBooks (credit), or refund it
 * (refund). Never throws — the memo is issued either way, and the record
 * screen can do the step again.
 */
export async function settleCreditMemo(
  supabase: SupabaseClient,
  memo: { id: string; processor: "square" | "quickbooks"; settlement: CreditMemoSettlement },
  opts: { handType?: "cash" | "check"; reason?: string } = {}
): Promise<{ ok: boolean; message: string | null; warning: string | null }> {
  if (memo.settlement === "credit") {
    if (memo.processor !== "quickbooks") return { ok: true, message: null, warning: null };
    const { data, message } = await invokeQbo(supabase, { mode: "push_credit_memo", credit_memo_id: memo.id });
    if (message) return { ok: false, message: `QuickBooks: ${message}`, warning: null };
    return { ok: true, message: null, warning: (data?.warning as string | undefined) ?? null };
  }

  if (opts.handType) {
    const { error } = await supabase.rpc("record_credit_memo_refund", {
      p_memo: memo.id,
      p_application: null,
      p_refund_id: null,
      p_note: opts.reason?.trim() || null,
      p_type: opts.handType,
    });
    return error ? { ok: false, message: error.message, warning: null } : { ok: true, message: null, warning: null };
  }

  const key = crypto.randomUUID();
  if (memo.processor === "quickbooks") {
    const { data, message } = await invokeQbo(supabase, {
      mode: "refund_payment",
      credit_memo_id: memo.id,
      reason: opts.reason?.trim() || null,
      idempotency_key: key,
    });
    if (message) return { ok: false, message: `QuickBooks: ${message}`, warning: null };
    return { ok: true, message: null, warning: (data?.warning as string | undefined) ?? null };
  }
  const { data, error } = await supabase.functions.invoke("square-refund", {
    body: { credit_memo_id: memo.id, reason: opts.reason?.trim() || null, idempotency_key: key },
  });
  if (error) {
    let message = error.message;
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) message = parsed.error as string;
    } catch {
      /* keep it */
    }
    return { ok: false, message: `Square: ${message}`, warning: null };
  }
  return { ok: true, message: null, warning: ((data as { warning?: string } | null)?.warning) ?? null };
}

/* ==========================================================================
 * THE MEMO RECORD — one read for the screen and the paper
 * ========================================================================== */

export type CreditMemoLineRow = {
  line_type: "item" | "discount" | "delivery" | "rush" | "tax" | "allowance";
  description: string;
  qty: number | null;
  unit_price: number | null;
  amount: number;
  taxable: boolean;
  sort: number | null;
};

/** One line as the paper and the table print it. An item line's billed and
 *  delivered quantities are in its description, written by 218 at issue
 *  ("Knotted Bismark - 42g — short 42, delivered 518 of 560"), because they
 *  are what the record said THEN. */
export type CreditMemoPaperLine = {
  item: string;
  billed: number | null;
  delivered: number | null;
  price: number | null;
  short: number | null;
  amount: number;
  kind: CreditMemoLineRow["line_type"];
};

export function paperLine(l: CreditMemoLineRow): CreditMemoPaperLine {
  if (l.line_type === "item") {
    const m = /^(.*) — short [\d.]+, delivered ([\d.]+) of ([\d.]+)$/.exec(l.description);
    // 220: an item given back whole (All) is no short — its quantity rides
    // the name, and the Short column stays empty.
    if (!m) {
      return {
        item: l.qty === null ? l.description : `${l.description} × ${qtyLabel(l.qty)}`,
        billed: null, delivered: null, price: l.unit_price, short: null, amount: l.amount, kind: l.line_type,
      };
    }
    return {
      item: m[1],
      billed: Number(m[3]),
      delivered: Number(m[2]),
      price: l.unit_price,
      short: l.qty,
      amount: l.amount,
      kind: l.line_type,
    };
  }
  return { item: l.description, billed: null, delivered: null, price: null, short: null, amount: l.amount, kind: l.line_type };
}

export type CreditMemoApplication = {
  id: string;
  invoice_id: string | null;
  invoice_label: string | null;
  order_id: string | null;
  amount: number;
  created_at: string;
};

export type CreditMemoRefund = {
  amount: number;
  payment_type: string | null;
  paid_on: string | null;
  /** How the original was paid, for "Refunded to visa ending 2998". */
  method: string | null;
};

export type CreditMemoView = {
  memo: {
    id: string;
    org_id: string;
    number: number;
    kind: CreditMemoKind;
    reason_code: string;
    note: string | null;
    issued_on: string;
    processor: "square" | "quickbooks";
    settlement: CreditMemoSettlement;
    sent_at: string | null;
    voided_at: string | null;
    document_path: string | null;
    external_ref: { qbo?: { id?: string; doc_number?: string | null } } | null;
    customer_id: string;
    credits_invoice_id: string | null;
    special_order_id: string | null;
  };
  label: string;
  lines: CreditMemoLineRow[];
  total: number;
  applied: number;
  unapplied: number;
  applications: CreditMemoApplication[];
  refunds: CreditMemoRefund[];
  customer: { name: string; email: string | null; phone: string | null; first_name: string | null };
  invoice: { id: string; label: string } | null;
  order: { id: string; number: string; title: string | null; contact_email: string | null } | null;
};

const cents = (v: number) => Math.round(v * 100) / 100;

export function readMemoPrefix(settings: Record<string, unknown> | null | undefined): string {
  const cm = ((settings ?? {}).customer_credit_memos ?? {}) as Record<string, unknown>;
  return typeof cm.prefix === "string" ? cm.prefix : "";
}

/** Read through the caller's RLS; null when it is not theirs to see. */
export async function fetchCreditMemoView(
  supabase: SupabaseClient,
  id: string,
  settings: Record<string, unknown>
): Promise<CreditMemoView | null> {
  const { data: memo, error } = await supabase
    .from("customer_credit_memos")
    .select(
      "id, org_id, number, kind, reason_code, note, issued_on, processor, settlement, sent_at, voided_at, document_path, external_ref, customer_id, credits_invoice_id, special_order_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!memo) return null;
  const invoicePrefix = String(((settings.customer_invoices ?? {}) as Record<string, unknown>).prefix ?? "");
  const invLabel = (n: number, r: number) => `${invoicePrefix}${n}${r > 1 ? `-${r}` : ""}`;

  const [{ data: lineRows }, { data: appRows }, { data: customer }, { data: invoice }, { data: order }] =
    await Promise.all([
      supabase
        .from("customer_credit_memo_lines")
        .select("line_type, description, qty, unit_price, amount, taxable, sort")
        .eq("memo_id", id)
        .order("sort", { ascending: true, nullsFirst: false }),
      supabase
        .from("payment_applications")
        .select("id, customer_invoice_id, special_order_id, amount, created_at, customer_invoices ( number, revision )")
        .eq("credit_memo_id", id)
        .order("created_at"),
      supabase
        .from("customers")
        .select("first_name, last_name, company, email, phone")
        .eq("id", memo.customer_id)
        .maybeSingle(),
      memo.credits_invoice_id
        ? supabase.from("customer_invoices").select("id, number, revision").eq("id", memo.credits_invoice_id).maybeSingle()
        : Promise.resolve({ data: null }),
      memo.special_order_id
        ? supabase.from("special_orders").select("id, number, title, contact_email").eq("id", memo.special_order_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((l) => ({
    line_type: l.line_type as CreditMemoLineRow["line_type"],
    description: String(l.description ?? ""),
    qty: l.qty === null ? null : Number(l.qty),
    unit_price: l.unit_price === null ? null : Number(l.unit_price),
    amount: Number(l.amount),
    taxable: Boolean(l.taxable),
    sort: l.sort === null ? null : Number(l.sort),
  }));
  const applications = ((appRows ?? []) as Record<string, unknown>[]).map((a) => {
    const inv = a.customer_invoices as { number: number; revision: number } | null;
    return {
      id: String(a.id),
      invoice_id: (a.customer_invoice_id as string | null) ?? null,
      invoice_label: inv ? invLabel(inv.number, inv.revision) : null,
      order_id: (a.special_order_id as string | null) ?? null,
      amount: Number(a.amount),
      created_at: String(a.created_at),
    };
  });

  // A REFUNDED MEMO'S REFUND is the negative application 218 writes on the
  // invoice it credits IN THE SAME TRANSACTION as the memo's own — so the same
  // `created_at` (a transaction's `now()`), whichever processor gave it back.
  let refunds: CreditMemoRefund[] = [];
  if (memo.settlement === "refund" && memo.credits_invoice_id && applications.length) {
    const stamps = applications.map((a) => a.created_at);
    const { data: refundRows } = await supabase
      .from("payment_applications")
      .select("amount, created_at, customer_payments ( payment_type, paid_on, refund_of )")
      .eq("customer_invoice_id", memo.credits_invoice_id)
      .lt("amount", 0)
      .in("created_at", stamps);
    const rows = ((refundRows ?? []) as Record<string, unknown>[]).filter((r) => r.customer_payments);
    const originals = rows
      .map((r) => (r.customer_payments as { refund_of: string | null }).refund_of)
      .filter((x): x is string => !!x);
    const { data: origRows } = originals.length
      ? await supabase.from("customer_payments").select("id, note").in("id", originals)
      : { data: [] as { id: string; note: string | null }[] };
    const noteOf = new Map(((origRows ?? []) as { id: string; note: string | null }[]).map((o) => [o.id, o.note]));
    refunds = rows.map((r) => {
      const p = r.customer_payments as { payment_type: string | null; paid_on: string | null; refund_of: string | null };
      const note = p.refund_of ? noteOf.get(p.refund_of) ?? null : null;
      return {
        amount: -Number(r.amount),
        payment_type: p.payment_type,
        paid_on: p.paid_on,
        method: note && /^Pay link · /.test(note) ? note.replace(/^Pay link · /, "") : null,
      };
    });
  }

  const total = cents(lines.reduce((a, l) => a + l.amount, 0));
  const applied = cents(applications.reduce((a, x) => a + x.amount, 0));
  const c = (customer ?? {}) as Record<string, string | null>;
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return {
    memo: {
      ...(memo as unknown as CreditMemoView["memo"]),
      number: Number(memo.number),
    },
    label: creditMemoNumberText(Number(memo.number), readMemoPrefix(settings)),
    lines,
    total,
    applied,
    unapplied: cents(total - applied),
    applications,
    refunds,
    customer: { name: c.company || person || c.email || "—", email: c.email ?? null, phone: c.phone ?? null, first_name: c.first_name ?? null },
    invoice: invoice ? { id: String(invoice.id), label: invLabel(Number(invoice.number), Number(invoice.revision)) } : null,
    order: order
      ? { id: String(order.id), number: String(order.number), title: (order.title as string | null) ?? null, contact_email: (order.contact_email as string | null) ?? null }
      : null,
  };
}

/** Where a memo stands, in words. */
export function settlementLabel(v: Pick<CreditMemoView, "memo" | "applied" | "unapplied" | "refunds">): string {
  if (v.memo.voided_at) return "Void";
  if (v.memo.settlement === "refund") return v.refunds.length || v.applied > 0 ? "Refunded" : "To be refunded";
  if (v.unapplied <= 0.005) return "Applied as credit";
  return v.applied > 0 ? "Partly applied" : "Credit, not yet applied";
}

/** What is still to do after the issue, if anything: the step
 *  `settleCreditMemo` would run. */
export function outstandingStep(v: Pick<CreditMemoView, "memo" | "applied">): "push" | "refund" | null {
  if (v.memo.voided_at) return null;
  if (v.memo.settlement === "refund") return v.applied > 0 ? null : "refund";
  if (v.memo.processor === "quickbooks" && !v.memo.external_ref?.qbo?.id) return "push";
  return null;
}

/** The paper's closing sentence. */
export function memoSettlementSentence(v: Pick<CreditMemoView, "memo" | "refunds">, usDate: (d: string) => string): string {
  if (v.memo.settlement === "refund") {
    const r = v.refunds[0];
    if (!r) return "This credit will be refunded to you.";
    const how =
      r.payment_type === "cash" || r.payment_type === "check"
        ? `by ${r.payment_type}`
        : r.method
        ? `to ${r.method}`
        : "to the card it was paid with";
    return `Refunded ${how}${r.paid_on ? ` on ${usDate(r.paid_on)}` : ""}.`;
  }
  return "This credit will be applied to your next invoice.";
}

export function creditMemoFileName(label: string, date: string): string {
  const dotted = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10).replace(/-/g, ".") : date;
  return `CREDIT-MEMO#${label}_${dotted}.pdf`;
}

/** The email, from `orgs.settings.customer_credit_memos.email_subject` /
 *  `email_body`, with these defaults. Placeholders: {number} {first_name}
 *  {customer} {total} {invoice} {order} {reason} {settlement_line}
 *  {employee_name}. */
export const DEFAULT_CREDIT_MEMO_EMAIL = {
  subject: "Credit memo #{number}",
  body:
    "Hi {first_name},\n\n" +
    "Credit memo #{number} is attached — {total}, crediting invoice {invoice} ({reason}).\n\n" +
    "{settlement_line}\n\n" +
    "Thank you,\n{employee_name}",
};

/** A memo's state on the Credit Memos list — the record's `settlementLabel`,
 *  as a value a filter can hold. Here and not in the list, because the
 *  SERVER page works it out and the list is a client component. */
export type CreditMemoStatus = "open" | "partly" | "applied" | "to_refund" | "refunded" | "void";

export const CREDIT_MEMO_STATUS_LABEL: Record<CreditMemoStatus, string> = {
  open: "Credit, not yet applied",
  partly: "Partly applied",
  applied: "Applied as credit",
  to_refund: "To be refunded",
  refunded: "Refunded",
  void: "Void",
};
export const CREDIT_MEMO_STATUS_ORDER: CreditMemoStatus[] = ["to_refund", "open", "partly", "applied", "refunded", "void"];

export function memoStatus(m: { voided: boolean; settlement: "credit" | "refund"; total: number; used: number }): CreditMemoStatus {
  if (m.voided) return "void";
  if (m.settlement === "refund") return m.used > 0 ? "refunded" : "to_refund";
  if (m.total - m.used <= 0.005) return "applied";
  return m.used > 0 ? "partly" : "open";
}
