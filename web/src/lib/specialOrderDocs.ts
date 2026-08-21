/**
 * SPECIAL ORDER DOCUMENTS — decision 11's four papers, plus decision 21's
 * statement, and everything that has to be true before one is rendered.
 *
 * Two halves, and the split matters:
 *
 *   · the PURE half — what a document is called, how its dates read, how its
 *     lines group, what the email says — which is fixture-tested and which the
 *     public approval page reuses without a database anywhere near it;
 *   · `fetchOrderDocData`, which is CLIENT-SAFE on purpose (the `poProcessing`
 *     idiom): document data is fetched at click time through the caller's own
 *     supabase client, so RLS applies exactly as it would from any screen and
 *     the record and the list share one implementation.
 *
 * THE MONEY IS NOT RE-DERIVED HERE. `orderTotals` in `lib/specialOrders` is
 * decision 6's one arithmetic and this module calls it — a second copy that
 * rounded differently would put a different number on the paper the customer
 * holds from the one the screen shows, which is precisely the drift FileMaker's
 * two stored subtotals produced.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  customerLabel,
  isProductionLine,
  orderTotals,
  type CustomerName,
  type MoneyLine,
  type MoneyOrder,
  type MoneyPayment,
  type OrderTotals,
} from "./specialOrders";

/* ==========================================================================
 * 1. WHAT A DOCUMENT IS
 * ========================================================================== */

/**
 * The four papers. Quote, invoice and receipt share ONE renderer — they are
 * the same document at three moments (decision 11) — and the kitchen order is
 * its own, because it carries no money at all and groups by size class rather
 * than printing a totals block.
 *
 * `signed_quote` is not in this list: it is the quote with an approval block
 * appended, produced only by decision 17's approval page, and it is never a
 * thing you choose to send.
 */
export type DocumentKind = "quote" | "invoice" | "receipt" | "order";

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  quote: "Quote",
  invoice: "Invoice",
  receipt: "Receipt",
  order: "Kitchen order",
};

/** What the masthead prints in the top right — FileMaker's own wording. */
export const DOCUMENT_TITLE: Record<DocumentKind, string> = {
  quote: "QUOTE",
  invoice: "INVOICE",
  receipt: "RECEIPT",
  order: "ORDER",
};

/**
 * Which stage date sending this document stamps, and what the log says.
 *
 * The kitchen order stamps `order_printed_at` even though nothing is printed —
 * it is produced, which is the act FileMaker's "Order printed" recorded, and
 * the list's stage grid reads that column. Naming it anything else would leave
 * a column the app writes to nowhere.
 */
export const DOCUMENT_STAGE: Record<DocumentKind, string> = {
  quote: "quote_sent_at",
  invoice: "invoice_sent_at",
  receipt: "receipt_sent_at",
  order: "order_printed_at",
};

/**
 * Which per-document note prints on it (decision 11). `notes_general` is
 * deliberately absent from this map — it prints NOWHERE, which is the whole
 * reason it is a separate column.
 */
export const DOCUMENT_NOTE_COLUMN: Record<DocumentKind, string> = {
  quote: "notes_quote",
  invoice: "notes_invoice",
  receipt: "notes_receipt",
  order: "notes_production",
};

/* ==========================================================================
 * 2. DATES AND TIMES, THE WAY THE PAPER READS THEM
 * ========================================================================== */

/**
 * `2026-08-16` → `8/16/2026`.
 *
 * Parsed as STRING PARTS, never through `new Date("2026-08-16")`, which is UTC
 * midnight and prints the previous day for everyone west of Greenwich — the
 * `lib/productionPlans` lesson, and on a document it would misdate somebody's
 * wedding.
 */
export function usDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

const WEEKDAY_NAMES = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

/** `2026-08-16` → `SATURDAY`. The kitchen document's second header band. */
export function usWeekday(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  // UTC throughout, so the arithmetic can't be moved by the host's zone. The
  // date is a wall-clock date, not an instant.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY_NAMES[(d.getUTCDay() + 6) % 7];
}

/** `10:00:00` → `10:00 AM`. A `time` column reads back with seconds. */
export function usTime(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return value;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m[2]} ${suffix}`;
}

/**
 * What a produced file is called.
 *
 * FileMaker's own shape — `QUOTE#9885_2026.08.16.pdf` — kept deliberately: it
 * is what twelve years of these are named in Mark's Downloads folder and in
 * customers' inboxes, so a run of them still sorts together.
 */
export function documentFileName(
  kind: DocumentKind | "signed_quote" | "statement",
  number: string,
  date: string
): string {
  const dotted = /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10).replace(/-/g, ".") : date;
  if (kind === "order") return `Order-${number}.pdf`;
  if (kind === "signed_quote") return `QUOTE#${number}_signed_${dotted}.pdf`;
  if (kind === "statement") return `STATEMENT_${number}_${dotted}.pdf`;
  return `${DOCUMENT_TITLE[kind]}#${number}_${dotted}.pdf`;
}

/* ==========================================================================
 * 3. THE LINES
 * ========================================================================== */

export type DocumentLine = {
  id: string;
  sort: number | null;
  name: string;
  item_donut: string | null;
  item_type: string | null;
  item_cut: string | null;
  item_finish: string | null;
  item_size: string | null;
  notes: string | null;
  qty: number;
  unit_price: number;
  taxable: boolean;
};

/**
 * The kitchen document's second line — donut · type · cut · finish · size, in
 * FileMaker's own order, under the customized name.
 *
 * It exists because the NAME is a copy somebody edited ("Promise Ring -
 * Glazed - Letter") and the taxonomy is what the item actually IS. A decorator
 * reads the name; a fryer reads this.
 */
export function taxonomyLine(line: DocumentLine): string {
  return [line.item_donut, line.item_type, line.item_cut, line.item_size, line.item_finish]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" - ");
}

/**
 * The kitchen document groups by SIZE CLASS — REGULAR, MINI, GIANT — which is
 * how the kitchen works: a tray holds one size.
 *
 * Two rules a rewrite would get wrong:
 *
 * **`Misc` lines never reach the kitchen** (decision 5). A Delivery Fee is
 * money, not a donut, and printing one on a production sheet asks somebody to
 * make it. `isProductionLine` is the one test, and an UNTYPED line counts as
 * production — 569 real lines carry no type and they are ordinary donuts.
 *
 * **A line with no size still prints**, under its own heading rather than
 * being dropped. A donut nobody classified is still a donut somebody ordered;
 * silently omitting it is the one failure a kitchen sheet must not have.
 */
export function sizeClassGroups(
  lines: DocumentLine[]
): { label: string; lines: DocumentLine[] }[] {
  const groups = new Map<string, DocumentLine[]>();
  for (const line of lines) {
    if (!isProductionLine(line)) continue;
    const label = (line.item_size ?? "").trim().toUpperCase() || "UNSPECIFIED";
    const list = groups.get(label) ?? [];
    list.push(line);
    groups.set(label, list);
  }
  // Insertion order — which is the line SORT, because the caller hands them in
  // that order. FileMaker prints the sizes in the order they first appear on
  // the order rather than alphabetically, and the person who typed the order
  // typed it in the order they want it made.
  return [...groups.entries()].map(([label, list]) => ({ label, lines: list }));
}

/** `29 items / 29 donuts` — the kitchen sheet's own count, production lines
 *  only, so a delivery fee never inflates it. */
export function productionCount(lines: DocumentLine[]): { lines: number; qty: number } {
  const production = lines.filter(isProductionLine);
  return {
    lines: production.length,
    qty: production.reduce((a, l) => a + (Number(l.qty) || 0), 0),
  };
}

/* ==========================================================================
 * 4. THE ASSEMBLED DOCUMENT DATA
 * ========================================================================== */

export type DocOrg = {
  name: string;
  /** The masthead's second and third lines. See `orgDocHeader` for where each
   *  falls back from. */
  addressLine: string;
  contactLine: string;
  /** Decision 11's terms paragraph and invoice footer, from settings. */
  terms: string;
  invoiceFooter: string;
  /** Where a customer reply should go — the statement and quote emails use it,
   *  and the approval page prints it. */
  replyTo: string | null;
};

export type OrderDocData = {
  id: string;
  org_id: string;
  number: string;
  kind: string;
  status: string | null;
  title: string | null;
  event_date: string | null;
  event_time: string | null;
  ready_by_time: string | null;
  fulfillment: string;
  allergen_info: string | null;
  taken_by: string | null;
  date_initiated: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  delivery_address: string | null;
  delivery_tracking: string | null;
  delivery_boxes: number | null;
  customer: CustomerName & { phone: string | null; email: string | null } | null;
  location_code: string | null;
  location_name: string | null;
  kitchen_code: string | null;
  notes_quote: string | null;
  notes_production: string | null;
  notes_invoice: string | null;
  notes_receipt: string | null;
  lines: DocumentLine[];
  payments: (MoneyPayment & { paid_on: string | null; payment_type: string | null; note: string | null })[];
  money: MoneyOrder;
  totals: OrderTotals;
};

/** The masthead, assembled once so both the PDF and the approval page agree.
 *
 *  Design rule 2 all the way down: nothing here is a literal. The address comes
 *  from `orgs.settings.billing`, which the PO documents already print, and the
 *  phone and email fall back to it — but special orders have their OWN pair
 *  (`settings.special_orders.document_phone` / `.reply_to`), because the real
 *  quote prints the special-orders line rather than the billing one, and the
 *  customer replying to a quote must not land in accounts payable. */
export function orgDocHeader(
  orgName: string,
  orgSettings: Record<string, unknown>
): Pick<DocOrg, "name" | "addressLine" | "contactLine" | "replyTo"> {
  const billing = (orgSettings?.billing ?? {}) as Record<string, string | undefined>;
  const so = (orgSettings?.special_orders ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

  const addressLine = [
    billing.address1 ?? billing.street1,
    billing.city,
    billing.state,
    billing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  const phone = str(so.document_phone) ?? billing.phone ?? null;

  /**
   * THE PUBLIC ADDRESS IS STATED ONCE, and it may be stated in either of two
   * places — so this reads both rather than making somebody write it twice.
   *
   * `special_orders.reply_to` is the explicit one. But configuring the module's
   * mailbox (docs/po-email-setup.md) already sets a `reply_to` INSIDE
   * `email_provider`, and an org that has said "replies to this quote go to
   * specialorders@" has thereby said what address the quote should print.
   * Reading only the top-level key left every document printing the BILLING
   * address after a correct setup, which is two facts about one address
   * disagreeing — caught by Mark's on 2026-08-17.
   */
  const provider = (so.email_provider ?? {}) as Record<string, unknown>;
  const email =
    str(so.reply_to) ?? str(provider.reply_to) ?? billing.email ?? null;

  return {
    /**
     * THE ORG NAME, not the billing entity — and that ordering is the opposite
     * of `PoPdf`'s on purpose.
     *
     * A purchase order's Bill-to has to name the legal person who pays, so it
     * leads with `billing.entity_name` ("DONUT FRIEND, INC."). A customer's
     * quote is the other way round: the masthead is the shop's name, and the
     * real 9885 quote prints "DONUT FRIEND". Reading the org name first gets
     * that right with nothing configured, and `document_name` is there for an
     * org whose trading name is neither.
     */
    name: (str(so.document_name) ?? orgName ?? billing.entity_name ?? "").toUpperCase(),
    addressLine,
    contactLine: [phone, email].filter(Boolean).join(" / "),
    replyTo: email,
  };
}

/**
 * Everything the documents need, for one or many orders, in FIVE queries
 * regardless of how many — the `fetchPoDocData` shape, and for the same reason:
 * the record screen sends one and the list's selection bar sends a batch, and
 * a per-order round trip would make batching the slow path.
 */
export async function fetchOrderDocData(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<{ org: DocOrg; orders: OrderDocData[] }> {
  if (orderIds.length === 0) throw new Error("No orders given");

  const [{ data: org, error: orgError }, { data: orderRows, error: orderError }] =
    await Promise.all([
      supabase.from("orgs").select("name, settings").maybeSingle(),
      supabase
        .from("special_orders")
        .select(
          `id, org_id, number, kind, status, title, event_date, event_time,
           ready_by_time, fulfillment, allergen_info, taken_by, date_initiated,
           contact_name, contact_phone, contact_email,
           delivery_address, delivery_tracking, delivery_boxes,
           location_id, kitchen_location_id,
           tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
           ignore_balance,
           notes_quote, notes_production, notes_invoice, notes_receipt,
           customers ( id, first_name, last_name, company, phone, email )`
        )
        .in("id", orderIds),
    ]);
  if (orgError) throw new Error(orgError.message);
  if (orderError) throw new Error(orderError.message);
  if (!org) throw new Error("No org visible — are you signed in?");

  type Row = Record<string, unknown> & {
    id: string;
    location_id: string | null;
    kitchen_location_id: string | null;
    customers: (CustomerName & { phone: string | null; email: string | null }) | null;
  };
  const rows = (orderRows ?? []) as unknown as Row[];

  const locationIds = [
    ...new Set(
      rows.flatMap((r) => [r.location_id, r.kitchen_location_id]).filter(Boolean) as string[]
    ),
  ];

  const [{ data: lineRows, error: lineError }, { data: payRows }, { data: locRows }] =
    await Promise.all([
      supabase
        .from("special_order_items")
        .select(
          `id, order_id, sort, name, item_donut, item_type, item_cut, item_finish,
           item_size, notes, qty, unit_price, taxable`
        )
        .in("order_id", orderIds)
        .order("sort", { ascending: true, nullsFirst: false }),
      supabase
        .from("special_order_payments")
        .select("order_id, paid_on, amount, payment_type, note")
        .in("order_id", orderIds)
        .order("paid_on", { ascending: true, nullsFirst: false }),
      locationIds.length
        ? supabase.from("locations").select("id, code, name").in("id", locationIds)
        : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    ]);
  if (lineError) throw new Error(lineError.message);

  const locations = new Map(
    ((locRows ?? []) as { id: string; code: string; name: string }[]).map((l) => [l.id, l])
  );

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const soSettings = (settings.special_orders ?? {}) as Record<string, unknown>;
  const header = orgDocHeader(org.name as string, settings);

  const orders: OrderDocData[] = rows.map((row) => {
    const lines = ((lineRows ?? []) as unknown as (DocumentLine & { order_id: string })[])
      .filter((l) => l.order_id === row.id)
      .map((l) => ({
        id: l.id,
        sort: l.sort,
        name: l.name,
        item_donut: l.item_donut,
        item_type: l.item_type,
        item_cut: l.item_cut,
        item_finish: l.item_finish,
        item_size: l.item_size,
        notes: l.notes,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
        taxable: Boolean(l.taxable),
      }));
    const payments = ((payRows ?? []) as unknown as {
      order_id: string;
      paid_on: string | null;
      amount: number;
      payment_type: string | null;
      note: string | null;
    }[])
      .filter((p) => p.order_id === row.id)
      .map((p) => ({
        paid_on: p.paid_on,
        amount: Number(p.amount),
        payment_type: p.payment_type,
        note: p.note,
      }));

    const money: MoneyOrder = {
      tax_rate: row.tax_rate as number | null,
      discount_amount: row.discount_amount as number | null,
      discount_rate: row.discount_rate as number | null,
      delivery_charge: row.delivery_charge as number | null,
      rush_fee: row.rush_fee as number | null,
      ignore_balance: Boolean(row.ignore_balance),
    };

    const pickup = row.location_id ? locations.get(row.location_id) : undefined;
    const kitchen = row.kitchen_location_id ? locations.get(row.kitchen_location_id) : undefined;

    return {
      id: row.id,
      org_id: row.org_id as string,
      number: row.number as string,
      kind: row.kind as string,
      status: row.status as string | null,
      title: row.title as string | null,
      event_date: row.event_date as string | null,
      event_time: row.event_time as string | null,
      ready_by_time: row.ready_by_time as string | null,
      fulfillment: (row.fulfillment as string) ?? "pickup",
      allergen_info: row.allergen_info as string | null,
      taken_by: row.taken_by as string | null,
      date_initiated: row.date_initiated as string | null,
      contact_name: row.contact_name as string | null,
      contact_phone: row.contact_phone as string | null,
      contact_email: row.contact_email as string | null,
      delivery_address: row.delivery_address as string | null,
      delivery_tracking: row.delivery_tracking as string | null,
      delivery_boxes: row.delivery_boxes as number | null,
      customer: row.customers ?? null,
      location_code: pickup?.code ?? null,
      location_name: pickup?.name ?? null,
      kitchen_code: kitchen?.code ?? pickup?.code ?? null,
      notes_quote: row.notes_quote as string | null,
      notes_production: row.notes_production as string | null,
      notes_invoice: row.notes_invoice as string | null,
      notes_receipt: row.notes_receipt as string | null,
      lines,
      payments,
      money,
      totals: orderTotals(money, lines as MoneyLine[], payments),
    };
  });

  // The order the CALLER asked for, not PostgREST's — a batch of documents
  // should come out in the order they were selected.
  orders.sort((a, b) => orderIds.indexOf(a.id) - orderIds.indexOf(b.id));

  return {
    org: {
      ...header,
      terms: typeof soSettings.terms === "string" ? soSettings.terms : "",
      invoiceFooter:
        typeof soSettings.invoice_footer === "string" ? soSettings.invoice_footer : "",
    },
    orders,
  };
}

/* ==========================================================================
 * 5. THE STATEMENT (decision 21)
 * ========================================================================== */

export type StatementOrder = {
  id: string;
  number: string;
  event_date: string | null;
  title: string | null;
  totals: OrderTotals;
};

export type StatementData = {
  customer: (CustomerName & { phone: string | null; email: string | null }) | null;
  from: string;
  to: string;
  orders: StatementOrder[];
  total: number;
  paid: number;
  balance: number;
};

/**
 * The week a statement defaults to: the MONDAY-to-SUNDAY week BEFORE the one
 * `today` is in.
 *
 * "Last week" and not "the last seven days", because that is what billing in
 * arrears means — a week that is over, with the same boundaries every time, so
 * two consecutive statements can neither overlap nor leave a day out. Weeks
 * start Monday, the schema's convention everywhere (ISO 1 = Monday).
 */
export function lastWeek(today: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m) return { from: today, to: today };
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday
  // Back to this week's Monday, then back one more week.
  d.setUTCDate(d.getUTCDate() - (isoDow - 1) - 7);
  const from = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from, to: d.toISOString().slice(0, 10) };
}

/**
 * One customer's orders over a period, with the money derived per order and
 * summed — never a stored total, decision 6 all the way through.
 *
 * REAL ORDERS ONLY. A standing order carries lines and no payments, so it
 * derives a balance forever; billing a customer for the SHAPE of their weekly
 * order as well as for each day of it would double the invoice. That is the
 * same `kind === "order"` rule the customer record learned the hard way.
 */
export async function fetchStatementData(
  supabase: SupabaseClient,
  customerId: string,
  from: string,
  to: string
): Promise<StatementData> {
  const [{ data: customer }, { data: orderRows, error }] = await Promise.all([
    supabase
      .from("customers")
      .select("first_name, last_name, company, phone, email")
      .eq("id", customerId)
      .maybeSingle(),
    supabase
      .from("special_orders")
      .select(
        `id, number, title, event_date,
         tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
         ignore_balance`
      )
      .eq("customer_id", customerId)
      .eq("kind", "order")
      .neq("status", "cancelled")
      .gte("event_date", from)
      .lte("event_date", to)
      .order("event_date", { ascending: true, nullsFirst: false }),
  ]);
  if (error) throw new Error(error.message);

  const rows = (orderRows ?? []) as unknown as (MoneyOrder & {
    id: string;
    number: string;
    title: string | null;
    event_date: string | null;
  })[];
  const ids = rows.map((r) => r.id);

  const lines = new Map<string, MoneyLine[]>();
  const payments = new Map<string, MoneyPayment[]>();
  if (ids.length) {
    const [{ data: lineRows }, { data: payRows }] = await Promise.all([
      supabase
        .from("special_order_items")
        .select("order_id, qty, unit_price, taxable, item_type")
        .in("order_id", ids),
      supabase.from("special_order_payments").select("order_id, amount").in("order_id", ids),
    ]);
    for (const l of (lineRows ?? []) as unknown as (MoneyLine & { order_id: string })[]) {
      const list = lines.get(l.order_id) ?? [];
      list.push(l);
      lines.set(l.order_id, list);
    }
    for (const p of (payRows ?? []) as unknown as (MoneyPayment & { order_id: string })[]) {
      const list = payments.get(p.order_id) ?? [];
      list.push(p);
      payments.set(p.order_id, list);
    }
  }

  const orders: StatementOrder[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    event_date: r.event_date,
    title: r.title,
    totals: orderTotals(r, lines.get(r.id) ?? [], payments.get(r.id) ?? []),
  }));

  const sum = (pick: (t: OrderTotals) => number) =>
    Math.round(orders.reduce((a, o) => a + pick(o.totals), 0) * 100) / 100;

  return {
    customer: (customer ?? null) as StatementData["customer"],
    from,
    to,
    orders,
    total: sum((t) => t.total),
    paid: sum((t) => t.paid),
    balance: sum((t) => t.balance),
  };
}

/* ==========================================================================
 * 6. THE EMAIL (decision 12)
 * ========================================================================== */

export type EmailParts = { to: string; cc: string; subject: string; body: string };

/**
 * The templates, per document, from `orgs.settings.special_orders.email` —
 * design rule 2, exactly as `po_email` works. The fallbacks in code are
 * deliberately generic: no business identity, no signature naming anybody.
 *
 * FileMaker hardcoded "The Donut Friend Team" into a script. We don't.
 */
export const DEFAULT_TEMPLATES: Record<
  DocumentKind | "statement" | "inquiry",
  { subject: string; body: string }
> = {
  quote: {
    subject: "Your quote #{number}{title_suffix}",
    body:
      "Hi {first_name},\n\n" +
      "Thanks for your order! Your quote is attached — please review it and let us know if anything needs changing.\n" +
      "{approve_line}" +
      "\nEvent: {event_date}{event_time_clause}\n" +
      "Total: {total}\n\n" +
      "Thank you!",
  },
  invoice: {
    subject: "Your invoice #{number}{title_suffix}",
    body:
      "Hi {first_name},\n\n" +
      "Your invoice is attached.\n\n" +
      "Event: {event_date}{event_time_clause}\n" +
      "Total: {total}\n" +
      "Balance due: {balance}\n\n" +
      "Thank you!",
  },
  receipt: {
    subject: "Your receipt #{number}{title_suffix}",
    body:
      "Hi {first_name},\n\n" +
      "Thank you! Your receipt is attached.\n\n" +
      "Event: {event_date}{event_time_clause}\n" +
      "Paid: {paid}\n\n" +
      "We appreciate your business.",
  },
  order: {
    subject: "Order #{number} — {event_date}",
    body: "The kitchen order for #{number} is attached.\n",
  },
  /**
   * THE INQUIRY CONFIRMATION IS SENT BY THE EDGE FUNCTION, NOT BY THIS APP, so
   * this entry is a MIRROR of `supabase/functions/submit-inquiry/index.ts` and
   * the two must be kept in step by hand. The Deno runtime cannot import from
   * `web/` — the same boundary that makes `send-special-order-email` keep its
   * own copy of `STAGE_COLUMN` — and both ends carry a comment saying so.
   *
   * Nothing here is what gets SENT; the function's own copy is. This exists so
   * the settings screen can show a person what the default says before they
   * decide to replace it. Drift costs a slightly wrong placeholder, which is
   * why the duplication is acceptable and why it is not load-bearing.
   *
   * `buildDocumentEmail` can never be called with this kind — its parameter is
   * `DocumentKind | "statement"` — which is the type saying the same thing.
   */
  inquiry: {
    subject: "We got your special order inquiry — #{number}",
    body:
      "Hi {first_name},\n\n" +
      "Thanks for getting in touch — we have your inquiry and a real person is\n" +
      "reading it. We'll come back to you with a quote.\n\n" +
      "Your reference is #{number}. Just reply to this message if you want to add\n" +
      "anything or change a detail.\n\n" +
      "— {org}\n",
  },
  statement: {
    subject: "Statement {period}",
    body:
      "Hi {first_name},\n\n" +
      "Your statement for {period} is attached.\n\n" +
      "Total: {total}\n\n" +
      "Thank you!",
  },
};

/**
 * Fill a template.
 *
 * An unknown `{placeholder}` is left ALONE rather than blanked — a typo in a
 * template should be visible in the compose card, where somebody can fix it,
 * not silently swallowed into a gap in a sentence a customer reads.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

/** The variables every special-order template can use. */
export function templateVars(
  order: OrderDocData,
  extras: Record<string, string> = {}
): Record<string, string> {
  const name = order.contact_name || customerLabel(order.customer);
  const first = (name || "").trim().split(/\s+/)[0] ?? "";
  const m = (v: number) => `$${v.toFixed(2)}`;
  return {
    number: order.number,
    title: order.title ?? "",
    title_suffix: order.title ? ` — ${order.title}` : "",
    first_name: first || "there",
    full_name: name,
    event_date: usDate(order.event_date),
    event_time: usTime(order.event_time),
    event_time_clause: order.event_time ? ` at ${usTime(order.event_time)}` : "",
    location: order.location_name ?? order.location_code ?? "",
    total: m(order.totals.total),
    balance: m(order.totals.balance),
    paid: m(order.totals.paid),
    subtotal: m(order.totals.subtotal),
    // Filled by the caller only when there is a live approval link to offer;
    // an empty string is the honest value everywhere else, and the template's
    // own newline handling means the paragraph simply isn't there.
    approve_line: "",
    ...extras,
  };
}

/**
 * Who the document goes TO, and it is deliberately not just the customer.
 *
 * The DAY-OF CONTACT is preferred where there is one — filled on 7,735 of the
 * 8,330 real orders, and on a corporate order it is the person who actually
 * placed it, while the customer record may be an accounts address. The
 * customer's own email is the fallback, which is what a walk-in order has.
 */
export function documentRecipient(order: OrderDocData): string {
  return (order.contact_email ?? order.customer?.email ?? "").trim();
}

export function buildDocumentEmail(
  kind: DocumentKind | "statement",
  order: OrderDocData,
  orgSettings: Record<string, unknown>,
  extras: Record<string, string> = {}
): EmailParts {
  const so = (orgSettings?.special_orders ?? {}) as Record<string, unknown>;
  const templates = (so.email ?? {}) as Record<string, { subject?: string; body?: string }>;
  const fallback = DEFAULT_TEMPLATES[kind];
  const configured = templates[kind] ?? {};
  const vars = templateVars(order, extras);
  return {
    to: documentRecipient(order),
    cc: typeof so.email_cc === "string" ? so.email_cc : "",
    subject: fillTemplate(configured.subject ?? fallback.subject, vars),
    body: fillTemplate(configured.body ?? fallback.body, vars),
  };
}

/**
 * The reply the customer sees, threaded onto their own inquiry.
 *
 * FileMaker pasted the inbound SUBJECT into the reply so Mail.app would thread
 * it (`Email_Token`, Mark: "1000% certain there's a better way"). There is:
 * `In-Reply-To` and `References` carry the inbound `Message-ID`, which is what
 * every mail client actually threads on, and keeping the original subject
 * prefixed `Re:` is the belt to that brace for the clients that fall back to
 * subject matching.
 *
 * Returns null when there is nothing to thread onto, which is every order that
 * did not start as an inquiry — 8,330 of them today, so this is the normal
 * case and must not produce a malformed header.
 */
export function threadHeaders(order: {
  inbound_message_id?: string | null;
  inbound_subject?: string | null;
}): { inReplyTo: string; references: string } | null {
  const id = (order.inbound_message_id ?? "").trim();
  if (!id) return null;
  // A Message-ID is angle-bracketed on the wire; stored values may or may not
  // be, and sending `<<id>>` threads with nothing.
  const bracketed = id.startsWith("<") ? id : `<${id}>`;
  return { inReplyTo: bracketed, references: bracketed };
}

/** `Re: ` the stored subject, without stacking a second `Re:` on a reply. */
export function replySubject(inboundSubject: string | null | undefined): string | null {
  const s = (inboundSubject ?? "").trim();
  if (!s) return null;
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
