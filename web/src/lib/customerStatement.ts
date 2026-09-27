/**
 * A CUSTOMER'S ACCOUNT (migration 144) — the statement and the aging, worked
 * out from two readings: their POSTED invoices (`customer_invoice_totals`) and
 * the money that reached the account (`customer_account_entries`: each
 * payment's applications to invoices, and whatever of it is applied to
 * nothing). Money held on an order is not on the account until its invoice is
 * sent, so it is not here.
 *
 * Pure, so the fixtures reach the arithmetic; `fetchStatement` in
 * `customerInvoiceQueries` reads the rows. Dates are ISO days and compare as
 * text; money is rounded to the cent at every sum.
 */

/** The statement as a document: who it is for, and the account. */
export type StatementDocument = {
  customer: {
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  statement: Statement;
};

export type AccountInvoice = {
  id: string;
  /** As printed — "1014", "1014-2", with the org's prefix. */
  label: string;
  issued_on: string;
  due_on: string | null;
  total: number;
  /** Sent and later voided — replaced by a revision, or cancelled. It stays
   *  on the statement at no charge, so a number the customer holds is
   *  accounted for. */
  void: boolean;
};

export type AccountEntry = {
  payment_id: string;
  paid_on: string | null;
  payment_type: string | null;
  customer_invoice_id: string | null;
  amount: number;
  created_at: string;
};

export type StatementRow = {
  date: string | null;
  kind: "invoice" | "void" | "payment" | "refund";
  /** An invoice row's invoice. */
  invoice: { label: string; due_on: string | null } | null;
  /** A payment row's method, the invoices it paid and what it left as credit. */
  payment: { type: string | null; paid: string[]; credit: number } | null;
  charge: number;
  paid: number;
  /** The running balance after this row. */
  balance: number;
};

export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "days30", label: "1–30 days" },
  { key: "days60", label: "31–60 days" },
  { key: "days90", label: "61–90 days" },
  { key: "over90", label: "90+ days" },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];
export type Aging = Record<AgingKey, number>;

export type OpenAccountInvoice = {
  id: string;
  label: string;
  issued_on: string;
  due_on: string | null;
  balance: number;
  /** Days past its due date (its issue date when it has none); 0 or less is
   *  not yet due. */
  daysPastDue: number;
  bucket: AgingKey;
};

export type Statement = {
  from: string;
  to: string;
  opening: number;
  rows: StatementRow[];
  charges: number;
  payments: number;
  closing: number;
  /** As of `to`: each invoice still owing, and the aging of those balances. */
  open: OpenAccountInvoice[];
  aging: Aging;
  /** As of `to`: money received and applied to nothing, less than which the
   *  aging comes to the closing balance. */
  credit: number;
};

const cents = (v: number) => Math.round(v * 100) / 100;

function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : NaN;
}

/** Whole days from `from` to `to` — negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/** Days past due into its column: due today is current; 30 days late is
 *  still the first column, 31 the second. */
export function agingBucket(daysPastDue: number): AgingKey {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "days30";
  if (daysPastDue <= 60) return "days60";
  if (daysPastDue <= 90) return "days90";
  return "over90";
}

/**
 * The statement's default period: a month back to today, as QuickBooks'
 * balance-forward statement starts. The opening balance carries everything
 * before it, so consecutive statements need not meet exactly. A day the
 * month before does not have becomes its last day (March 31 → February 28).
 */
export function statementPeriod(today: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m) return { from: today, to: today };
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(m[3]), last);
  const from = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { from, to: today };
}

/** Before `day`, a missing date counting as the oldest there is. */
const before = (date: string | null, day: string) => (date ?? "") < day;
const within = (date: string | null, from: string, to: string) => !before(date, from) && !before(to, date ?? "");
const onOrBefore = (date: string | null, day: string) => (date ?? "") <= day;

export function buildStatement(input: {
  invoices: AccountInvoice[];
  entries: AccountEntry[];
  from: string;
  to: string;
}): Statement {
  const { invoices, entries, from, to } = input;
  const labelOf = new Map(invoices.map((i) => [i.id, i.label]));

  // Each payment once, whatever it paid.
  const byPayment = new Map<string, AccountEntry[]>();
  for (const e of entries) byPayment.set(e.payment_id, [...(byPayment.get(e.payment_id) ?? []), e]);

  type Event = Omit<StatementRow, "balance"> & { order: number; tie: string };
  const events: Event[] = [];
  for (const inv of invoices) {
    events.push({
      date: inv.issued_on,
      kind: inv.void ? "void" : "invoice",
      invoice: { label: inv.label, due_on: inv.due_on },
      payment: null,
      charge: inv.void ? 0 : cents(inv.total),
      paid: 0,
      order: 0,
      tie: inv.label,
    });
  }
  for (const [, rows] of byPayment) {
    const amount = cents(rows.reduce((a, r) => a + r.amount, 0));
    if (Math.abs(amount) < 0.005) continue;
    const first = rows[0];
    events.push({
      date: first.paid_on,
      kind: amount < 0 ? "refund" : "payment",
      invoice: null,
      payment: {
        type: first.payment_type,
        // Each invoice once: one payment across a week's orders is several
        // applications to the same invoice.
        paid: [
          ...new Set(
            rows
              .filter((r) => r.customer_invoice_id)
              .map((r) => labelOf.get(r.customer_invoice_id as string) ?? "")
              .filter(Boolean)
          ),
        ],
        credit: cents(rows.filter((r) => !r.customer_invoice_id).reduce((a, r) => a + r.amount, 0)),
      },
      charge: 0,
      paid: amount,
      order: 1,
      tie: first.created_at,
    });
  }
  // By day; on one day the charges before the money, so a week's invoice paid
  // the day it went out never reads as credit first.
  events.sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.order - b.order ||
      // "1014-2" before "1015"; a payment's ISO timestamp compares the same way.
      a.tie.localeCompare(b.tie, "en", { numeric: true })
  );

  let opening = 0;
  for (const e of events) if (before(e.date, from)) opening += e.charge - e.paid;
  opening = cents(opening);

  let running = opening;
  let charges = 0;
  let payments = 0;
  const rows: StatementRow[] = [];
  for (const e of events) {
    if (!within(e.date, from, to)) continue;
    running = cents(running + e.charge - e.paid);
    charges += e.charge;
    payments += e.paid;
    rows.push({ date: e.date, kind: e.kind, invoice: e.invoice, payment: e.payment, charge: e.charge, paid: e.paid, balance: running });
  }
  const closing = cents(opening + charges - payments);

  const open: OpenAccountInvoice[] = [];
  const aging: Aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  for (const inv of invoices) {
    if (inv.void || !onOrBefore(inv.issued_on, to)) continue;
    const collected = entries
      .filter((e) => e.customer_invoice_id === inv.id && onOrBefore(e.paid_on, to))
      .reduce((a, e) => a + e.amount, 0);
    const balance = cents(inv.total - collected);
    if (balance <= 0.005) continue;
    const daysPastDue = daysBetween(inv.due_on ?? inv.issued_on, to);
    const bucket = agingBucket(daysPastDue);
    aging[bucket] = cents(aging[bucket] + balance);
    open.push({ id: inv.id, label: inv.label, issued_on: inv.issued_on, due_on: inv.due_on, balance, daysPastDue, bucket });
  }
  const owing = cents(open.reduce((a, o) => a + o.balance, 0));

  return {
    from,
    to,
    opening,
    rows,
    charges: cents(charges),
    payments: cents(payments),
    closing,
    open,
    aging,
    credit: cents(owing - closing),
  };
}
