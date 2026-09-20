import { GuideRequests } from "@/components/purchasing/GuideRequests";
import { Reminders } from "@/components/purchasing/Reminders";
import { SalesSummary, type SalesSummaryData } from "@/components/sales/SalesSummary";
import { DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/employeeDocuments";
import { employeeName } from "@/lib/employees";
import { canReachPage } from "@/lib/pageAccess";
import { fetchDueReminders, fetchOpenRequests } from "@/lib/guideBands";
import { canReadHr, canResolveRequests, canWriteCatalog } from "@/lib/roles";
import {
  compareTotals,
  daysIn,
  fetchWindow,
  incompleteDays,
  lastYearRange,
  missingDays,
  previousRange,
  SALES_PREVIOUS_LABEL,
  sumSales,
  type SalesDay,
} from "@/lib/sales";
import type { AppSession } from "@/lib/session";
import {
  customerLabel,
  DEFAULT_SETTINGS,
  needsAttention,
  orderTotals,
  readSettings,
  type AttentionOrder,
  type CustomerName,
} from "@/lib/specialOrders";
import {
  billAttention,
  isOverdueBill,
  missedClosingNights,
  paperworkAlerts,
  yearOverYearTrend,
  type StartBill,
} from "@/lib/startPage";
import { createClient } from "@/lib/supabase/server";
import { daysAfter, daysBefore, serverTimeZone, todayInTimeZone } from "@/lib/today";

import { SalesTrend } from "./SalesTrend";
import { StartCard, type CardItem } from "./StartCard";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Result<T> = { data: T; error: null } | { data: null; error: string };

/** How far back the sales band looks. */
const SALES_DAYS = 30;
/** How many records a card names under its counts. */
const ITEMS = 3;

/**
 * THE DESK START PAGE (Mark, 2026-09-17: "Let's make one for the desktop
 * too, and navigate to it when logging in"; whole org; sales across the top
 * with a year-over-year chart, "needs attention" cards beneath).
 *
 * SCOPED TO THE WORKING SHOP (Mark, 2026-09-17, the same day — it shipped
 * whole-org for an hour). That makes every count agree with the list it links
 * to, since the purchase order, invoice and shift report lists follow the
 * working shop too. Special orders count the shop as either the pickup shop or
 * the kitchen; paperwork counts the staff whose MAIN location it is.
 *
 * READ-ONLY and fetched in one wave. A probe that fails costs its own card a
 * sentence rather than the page, and a card a role may not open is not
 * fetched at all (`lib/pageAccess`, the same table the menu reads).
 */
export async function DeskStart({ session }: { session: AppSession }) {
  const supabase = await createClient();
  const role = session.membership.role;
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const shop = session.activeLocation;

  const may = {
    sales: canReachPage(role, "/sales"),
    bills: canReachPage(role, "/bills"),
    pos: canReachPage(role, "/purchase-orders"),
    orders: canReachPage(role, "/special-orders"),
    reports: canReachPage(role, "/shift-reports"),
    paperwork: canReadHr(role) && canReachPage(role, "/employees"),
    reminders: canReachPage(role, "/order-guide"),
    requests: canReachPage(role, "/purchase-requests"),
  };

  const heading = (
    // Only the TITLE changed (Mark, 2026-09-17: "Welcome to <org name>!");
    // the route and the tablet page are still Start.
    <div>
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        {session.orgName ? `Welcome to ${session.orgName}!` : "Welcome!"}
      </h1>
      <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
        {shop ? `${shop.code} · ` : ""}
        {longDate(today)}
      </p>
    </div>
  );

  if (!shop) {
    return (
      <div className="space-y-10">
        {heading}
        <p className="text-sm text-muted">Pick a location to see how it is doing.</p>
      </div>
    );
  }
  const loc = shop.id;

  const [sales, bills, pos, orders, reports, paperwork, reminders, requests] = await Promise.all([
    may.sales ? loadSales(supabase, today, loc, shop.code) : null,
    may.bills ? loadBills(supabase, loc) : null,
    may.pos ? loadPurchaseOrders(supabase, today, loc) : null,
    may.orders ? loadSpecialOrders(supabase, session.membership.org_id, today, loc) : null,
    may.reports ? loadShiftReports(supabase, today, loc, shop.code) : null,
    may.paperwork ? loadPaperwork(supabase, loc) : null,
    may.reminders ? fetchDueReminders(supabase, loc, today) : null,
    may.requests ? fetchOpenRequests(supabase, loc) : null,
  ]);

  const settings = may.orders ? readSettings(session.orgSettings) : DEFAULT_SETTINGS;

  return (
    <div className="space-y-10">
      {heading}

      {/* THE ORDER GUIDE'S TWO BANDS (Mark, 2026-09-17: "add the order guide's
          reminders and purchase requests to it") — the same components, so
          dismissing, adding a reminder and the request menu behave exactly as
          they do on the guide. Their item names link to the item record here,
          there being no walk to jump down. */}
      {(reminders || requests) && (
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          {reminders && (
            <Reminders
              reminders={reminders}
              guideDate={today}
              locationId={loc}
              orgId={session.membership.org_id}
              canWrite={canWriteCatalog(role)}
            />
          )}
          {requests && (
            <GuideRequests
              requests={requests}
              userId={session.userId}
              canResolve={canResolveRequests(role)}
            />
          )}
        </div>
      )}

      {sales &&
        (sales.data === null ? (
          <p className="text-sm text-accent">Could not load sales: {sales.error}</p>
        ) : (
          <SalesBand days={sales.data.days} shops={sales.data.shops} today={today} timeZone={timeZone} />
        ))}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {bills && <BillsCard result={bills} today={today} />}
        {pos && <PurchaseOrdersCard result={pos} today={today} />}
        {orders && (
          <SpecialOrdersCard result={orders} today={today} thresholds={settings.attention} />
        )}
        {reports && <ShiftReportsCard result={reports} />}
        {paperwork && <PaperworkCard result={paperwork} today={today} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

type ShopRow = { id: string; code: string; openDays: number[] | null; isActive: boolean | null };

async function loadSales(
  supabase: Supabase,
  today: string,
  loc: string,
  code: string
): Promise<Result<{ days: SalesDay[]; shops: ShopRow[] }>> {
  const range = { from: daysBefore(today, SALES_DAYS - 1), to: today };
  const window = fetchWindow(range);
  const days: SalesDay[] = [];
  // Paginated on a TOTAL order: PostgREST stops at 1,000 rows without a word.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("location_id, business_date, net_sales_cents, tips_cents, synced_at, source")
      .eq("location_id", loc)
      .gte("business_date", window.from)
      .lte("business_date", window.to)
      .order("business_date")
      .order("location_id")
      .range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const r of data ?? []) {
      days.push({
        location_id: r.location_id as string,
        locationCode: code,
        business_date: r.business_date as string,
        netSalesCents: Number(r.net_sales_cents),
        tipsCents: Number(r.tips_cents),
        syncedAt: (r.synced_at as string | null) ?? null,
        source: (r.source as string) ?? "square",
      });
    }
    if (!data || data.length < 1000) break;
  }

  // This shop, if Square reports for it — the Sales screen's own definition,
  // so the gap line here and there agree.
  const { data: mapped, error } = await supabase
    .from("locations")
    .select("id, code, open_days, is_active")
    .eq("id", loc)
    .not("square_location_id", "is", null);
  if (error) return { data: null, error: error.message };

  return {
    data: {
      days,
      shops: (mapped ?? []).map((l) => ({
        id: l.id as string,
        code: l.code as string,
        openDays: (l.open_days as number[] | null) ?? null,
        isActive: (l.is_active as boolean | null) ?? null,
      })),
    },
    error: null,
  };
}

function SalesBand({
  days,
  shops,
  today,
  timeZone,
}: {
  days: SalesDay[];
  shops: ShopRow[];
  today: string;
  timeZone: string;
}) {
  const range = { from: daysBefore(today, SALES_DAYS - 1), to: today };
  const prev = previousRange(range);
  const year = lastYearRange(range);
  const current = daysIn(days, range);
  const totals = sumSales(current);

  const summary: SalesSummaryData = {
    rangeLabel: `Last ${SALES_DAYS} days`,
    fellBack: false,
    partial: null,
    previousLabel: SALES_PREVIOUS_LABEL["last-30"],
    current: totals,
    vsPrevious: compareTotals(totals, sumSales(daysIn(days, prev)), prev),
    vsLastYear: compareTotals(totals, sumSales(daysIn(days, year)), year),
    // Through YESTERDAY: today is not a gap, it is a day still being taken.
    gaps: missingDays(current, shops, range, daysBefore(today, 1)),
    unfinished: incompleteDays(current, timeZone).map((d) => ({
      locationCode: d.locationCode,
      business_date: d.business_date,
    })),
  };

  return (
    <div className="space-y-6">
      <SalesSummary summary={summary} />
      <SalesTrend points={yearOverYearTrend(days, range)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

type BillRow = StartBill & {
  id: string;
  invoice_number: string | null;
  location_id: string | null;
  vendor: string | null;
};

async function loadBills(supabase: Supabase, loc: string): Promise<Result<BillRow[]>> {
  const rows: BillRow[] = [];
  for (let from = 0; ; from += 1000) {
    // Everything not void and not known to be paid — the only bills any of
    // the three counts can be about. A QuickBooks balance of zero is paid.
    const { data, error } = await supabase
      .from("vendor_bills")
      .select(
        `id, invoice_number, due_date, total, is_credit, status, external_ref,
         qbo_balance, qbo_checked_at, location_id, vendors ( name )`
      )
      .eq("location_id", loc)
      .neq("status", "void")
      .or("qbo_balance.is.null,qbo_balance.gt.0.005")
      .order("id")
      .range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const r of data ?? []) {
      const raw = r as unknown as Record<string, unknown>;
      const ref = raw.external_ref as { qbo?: { id?: string } } | null;
      const vendor = raw.vendors as { name: string } | { name: string }[] | null;
      rows.push({
        id: raw.id as string,
        invoice_number: (raw.invoice_number as string | null) ?? null,
        location_id: (raw.location_id as string | null) ?? null,
        vendor: (Array.isArray(vendor) ? vendor[0]?.name : vendor?.name) ?? null,
        status: raw.status as StartBill["status"],
        due_date: (raw.due_date as string | null) ?? null,
        total: raw.total === null ? null : Number(raw.total),
        is_credit: Boolean(raw.is_credit),
        linked: Boolean(ref?.qbo?.id),
        qbo_balance: raw.qbo_balance === null ? null : Number(raw.qbo_balance),
        qbo_checked_at: (raw.qbo_checked_at as string | null) ?? null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return { data: rows, error: null };
}

function BillsCard({
  result,
  today,
}: {
  result: Result<BillRow[]>;
  today: string;
}) {
  if (result.data === null) return <StartCard title="Bills" href="/bills" lines={[]} error={result.error} />;
  const rows = result.data;
  const counts = billAttention(rows, today);

  // Overdue first, oldest due date first; then whatever is waiting on an
  // approval, oldest due date first.
  const overdue = rows
    .filter((r) => isOverdueBill(r, today))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const waiting = rows
    .filter((r) => r.status === "open" && !overdue.includes(r))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const items: CardItem[] = [...overdue, ...waiting].slice(0, ITEMS).map((r) => ({
    primary: `${r.vendor ?? "Unknown vendor"} ${r.invoice_number ?? ""}`.trim(),
    secondary: `${overdue.includes(r) ? "Overdue" : "Due"} ${shortDate(r.due_date)}`,
    href: `/bills/${r.id}`,
  }));

  return (
    <StartCard
      title="Bills"
      href="/bills"
      lines={[
        { count: counts.overdue, label: "overdue", href: "/bills?status=all&aging=overdue&range=all" },
        { count: counts.awaitingApproval, label: "awaiting approval", href: "/bills?status=open&range=all" },
        {
          count: counts.notSent,
          label: "approved, not sent to QuickBooks",
          href: "/bills?status=approved&range=all",
        },
      ]}
      items={items}
    />
  );
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

type PoRow = {
  id: string;
  po_number: string;
  status: "draft" | "sent" | "received";
  order_date: string;
  delivery_date: string | null;
  location_id: string;
  vendor: string | null;
};

/** Received this recently and still not closed is worth a nudge; older than
 *  that is FileMaker's history (5,751 orders received and never closed). */
const UNCLOSED_DAYS = 30;

async function loadPurchaseOrders(
  supabase: Supabase,
  today: string,
  loc: string
): Promise<Result<PoRow[]>> {
  const since = daysBefore(today, UNCLOSED_DAYS);
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, order_date, delivery_date, location_id, vendors ( name )")
    .eq("location_id", loc)
    .or(`status.in.(draft,sent),and(status.eq.received,order_date.gte.${since})`)
    .order("order_date")
    .limit(1000);
  if (error) return { data: null, error: error.message };
  return {
    data: (data ?? []).map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      const vendor = raw.vendors as { name: string } | { name: string }[] | null;
      return {
        id: raw.id as string,
        po_number: raw.po_number as string,
        status: raw.status as PoRow["status"],
        order_date: raw.order_date as string,
        delivery_date: (raw.delivery_date as string | null) ?? null,
        location_id: raw.location_id as string,
        vendor: (Array.isArray(vendor) ? vendor[0]?.name : vendor?.name) ?? null,
      };
    }),
    error: null,
  };
}

function PurchaseOrdersCard({
  result,
  today,
}: {
  result: Result<PoRow[]>;
  today: string;
}) {
  if (result.data === null) {
    return <StartCard title="Purchase orders" href="/purchase-orders" lines={[]} error={result.error} />;
  }
  const rows = result.data;
  const drafts = rows.filter((r) => r.status === "draft");
  const sent = rows.filter((r) => r.status === "sent");
  // A sent order whose delivery day has passed and nothing was recorded.
  const late = sent.filter((r) => r.delivery_date !== null && r.delivery_date < today);
  const unclosed = rows.filter((r) => r.status === "received");

  const items: CardItem[] = [...late, ...drafts].slice(0, ITEMS).map((r) => ({
    primary: `${r.vendor ?? "Unknown vendor"} ${r.po_number}`,
    secondary:
      r.status === "draft"
        ? `Draft ${shortDate(r.order_date)}`
        : `Due ${shortDate(r.delivery_date)}`,
    href: `/purchase-orders/${r.id}`,
  }));

  return (
    <StartCard
      title="Purchase orders"
      href="/purchase-orders"
      lines={[
        { count: late.length, label: "past their delivery day", href: "/purchase-orders?status=sent&range=all" },
        { count: drafts.length, label: "drafts not sent", href: "/purchase-orders?status=draft&range=all" },
        { count: sent.length, label: "sent, still to arrive", href: "/purchase-orders?status=sent&range=all" },
        {
          count: unclosed.length,
          label: `received in the last ${UNCLOSED_DAYS} days, not closed`,
          href: "/purchase-orders?status=received&range=30",
        },
      ]}
      items={items}
    />
  );
}

// ---------------------------------------------------------------------------
// Special orders
// ---------------------------------------------------------------------------

type OrderRow = AttentionOrder & {
  id: string;
  number: string;
  title: string | null;
  location_id: string | null;
  kitchen_location_id: string | null;
  customer: CustomerName | null;
  lines: { qty: number | null; unit_price: number | null; taxable: boolean }[];
  payments: { amount: number | null }[];
};

async function loadSpecialOrders(
  supabase: Supabase,
  orgId: string,
  today: string,
  loc: string
): Promise<Result<OrderRow[]>> {
  // The list's own window — a month back and everything ahead — and only
  // real orders, which are all `needsAttention` ever judges.
  const since = daysBefore(today, 30);
  const { data, error } = await supabase
    .from("special_orders")
    .select(
      `id, number, kind, status, todo, flag_reason, title, event_date, fulfillment,
       ignore_balance, tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
       quote_sent_at, quote_returned_at, invoice_sent_at, invoice_paid_at,
       receipt_sent_at, delivery_scheduled_at, order_printed_at, order_scheduled_at,
       location_id, kitchen_location_id,
       customers ( first_name, last_name, company )`
    )
    .eq("org_id", orgId)
    // Sold here or made here — either way it is this shop's to deal with.
    .or(`location_id.eq.${loc},kitchen_location_id.eq.${loc}`)
    .eq("kind", "order")
    .neq("status", "cancelled")
    .gte("event_date", since)
    .order("event_date")
    .limit(1000);
  if (error) return { data: null, error: error.message };

  const ids = (data ?? []).map((o) => o.id as string);
  const lines = new Map<string, OrderRow["lines"]>();
  const payments = new Map<string, OrderRow["payments"]>();
  // `.order()` before `.range()`, or pages overlap and a total comes out short.
  for (let from = 0; ids.length > 0; from += 1000) {
    const { data: page, error: e } = await supabase
      .from("special_order_items")
      .select("order_id, qty, unit_price, taxable")
      .in("order_id", ids)
      .order("id")
      .range(from, from + 999);
    if (e) return { data: null, error: e.message };
    for (const l of page ?? []) {
      const list = lines.get(l.order_id as string) ?? [];
      list.push({ qty: l.qty as number, unit_price: l.unit_price as number, taxable: l.taxable as boolean });
      lines.set(l.order_id as string, list);
    }
    if (!page || page.length < 1000) break;
  }
  for (let from = 0; ids.length > 0; from += 1000) {
    const { data: page, error: e } = await supabase
      .from("special_order_payments")
      .select("order_id, amount")
      .in("order_id", ids)
      .order("id")
      .range(from, from + 999);
    if (e) return { data: null, error: e.message };
    for (const p of page ?? []) {
      const list = payments.get(p.order_id as string) ?? [];
      list.push({ amount: p.amount as number });
      payments.set(p.order_id as string, list);
    }
    if (!page || page.length < 1000) break;
  }

  return {
    data: (data ?? []).map((o) => {
      const raw = o as unknown as Record<string, unknown>;
      const customer = raw.customers as CustomerName | CustomerName[] | null;
      return {
        ...(raw as unknown as AttentionOrder),
        ignore_balance: Boolean(raw.ignore_balance),
        id: raw.id as string,
        number: raw.number as string,
        title: (raw.title as string | null) ?? null,
        location_id: (raw.location_id as string | null) ?? null,
        kitchen_location_id: (raw.kitchen_location_id as string | null) ?? null,
        customer: (Array.isArray(customer) ? customer[0] : customer) ?? null,
        lines: lines.get(raw.id as string) ?? [],
        payments: payments.get(raw.id as string) ?? [],
      };
    }),
    error: null,
  };
}

function SpecialOrdersCard({
  result,
  today,
  thresholds,
}: {
  result: Result<OrderRow[]>;
  today: string;
  thresholds: ReturnType<typeof readSettings>["attention"];
}) {
  if (result.data === null) {
    return <StartCard title="Special orders" href="/special-orders" lines={[]} error={result.error} />;
  }
  const judged = result.data
    .map((o) => ({ o, reason: needsAttention(o, today, orderTotals(o, o.lines, o.payments), thresholds) }))
    .filter((x): x is { o: OrderRow; reason: string } => x.reason !== null);
  // Flagged first — a human asked for eyes — then by event date.
  const flagged = judged.filter((x) => x.o.flag_reason);
  const rest = judged.filter((x) => !x.o.flag_reason);
  const thisWeek = result.data.filter(
    (o) => o.status === "order" && o.event_date !== null && o.event_date >= today && o.event_date <= daysAfter(today, 6)
  );

  const items: CardItem[] = [...flagged, ...rest].slice(0, ITEMS).map(({ o, reason }) => ({
    primary: `#${o.number} ${o.customer ? customerLabel(o.customer) : (o.title ?? "")}`.trim(),
    secondary: reason,
    href: `/special-orders/${o.id}`,
  }));

  return (
    <StartCard
      title="Special orders"
      href="/special-orders"
      lines={[
        { count: flagged.length, label: "flagged", href: "/special-orders?view=attention" },
        { count: judged.length, label: "need attention", href: "/special-orders?view=attention" },
        { count: thisWeek.length, label: "committed orders in the next 7 days", href: "/special-orders?view=upcoming" },
      ]}
      items={items}
    />
  );
}

// ---------------------------------------------------------------------------
// Shift reports
// ---------------------------------------------------------------------------

/** The Shift Reports list's own look-back for missing nights. */
const REPORT_LOOKBACK = 7;

type ReportsData = {
  missed: { code: string; date: string }[];
  staleDrafts: { id: string; code: string; date: string }[];
  notEmailed: number;
};

async function loadShiftReports(
  supabase: Supabase,
  today: string,
  loc: string,
  code: string
): Promise<Result<ReportsData>> {
  const since = daysBefore(today, REPORT_LOOKBACK);
  const [{ data: reports, error }, { data: shops, error: shopError }] = await Promise.all([
    supabase
      .from("shift_reports")
      .select("id, location_id, report_date, shift, status, sent_at, emailed_at")
      .eq("location_id", loc)
      .gte("report_date", since)
      .order("report_date"),
    supabase.from("locations").select("id, code, open_days").eq("id", loc),
  ]);
  if (error) return { data: null, error: error.message };
  if (shopError) return { data: null, error: shopError.message };

  const rows = (reports ?? []) as {
    id: string;
    location_id: string;
    report_date: string;
    shift: string;
    status: string;
    emailed_at: string | null;
  }[];
  return {
    data: {
      missed: missedClosingNights(
        (shops ?? []).map((s) => ({
          id: s.id as string,
          code: s.code as string,
          openDays: (s.open_days as number[] | null) ?? [],
        })),
        rows,
        today,
        REPORT_LOOKBACK
      ),
      // `attentionReason`'s two findings: a draft from an earlier day, and a
      // report that was sent but whose email never went out.
      staleDrafts: rows
        .filter((r) => r.status === "draft" && r.report_date < today)
        .map((r) => ({ id: r.id, code, date: r.report_date })),
      notEmailed: rows.filter((r) => r.status === "sent" && r.emailed_at === null).length,
    },
    error: null,
  };
}

function ShiftReportsCard({ result }: { result: Result<ReportsData> }) {
  if (result.data === null) {
    return <StartCard title="Shift reports" href="/shift-reports" lines={[]} error={result.error} />;
  }
  const { missed, staleDrafts, notEmailed } = result.data;
  const items: CardItem[] = [
    ...missed.map((m) => ({ primary: longDate(m.date), secondary: "No closing report" })),
    ...staleDrafts.map((d) => ({
      primary: longDate(d.date),
      secondary: "Still a draft",
      href: `/shift-reports/${d.id}/run`,
    })),
  ].slice(0, ITEMS);

  return (
    <StartCard
      title="Shift reports"
      href="/shift-reports"
      lines={[
        { count: missed.length, label: `closing nights with no report (last ${REPORT_LOOKBACK} days)` },
        { count: staleDrafts.length, label: "drafts from an earlier day", href: "/shift-reports" },
        { count: notEmailed, label: "sent but not emailed", href: "/shift-reports" },
      ]}
      items={items}
    />
  );
}

// ---------------------------------------------------------------------------
// Paperwork
// ---------------------------------------------------------------------------

type PaperworkData = {
  employees: { id: string; first_name: string; last_name: string; food_handler_expires: string | null }[];
  docs: { employee_id: string; kind: DocumentKind; expires_on: string | null }[];
};

async function loadPaperwork(supabase: Supabase, loc: string): Promise<Result<PaperworkData>> {
  const [{ data: employees, error }, { data: docs, error: docError }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, food_handler_expires")
      .eq("main_location_id", loc)
      .neq("status", "inactive"),
    supabase.from("employee_documents").select("employee_id, kind, expires_on").order("id").limit(1000),
  ]);
  if (error) return { data: null, error: error.message };
  if (docError) return { data: null, error: docError.message };
  return {
    data: {
      employees: (employees ?? []) as PaperworkData["employees"],
      docs: (docs ?? []) as PaperworkData["docs"],
    },
    error: null,
  };
}

function PaperworkCard({ result, today }: { result: Result<PaperworkData>; today: string }) {
  if (result.data === null) {
    return <StartCard title="Employee paperwork" href="/employees" lines={[]} error={result.error} />;
  }
  const { employees, docs } = result.data;
  const alerts = paperworkAlerts(employees, docs, today);
  const nameOf = new Map(employees.map((e) => [e.id, employeeName(e)]));
  const expired = alerts.filter((a) => a.state === "expired");
  const soon = alerts.filter((a) => a.state === "soon");

  return (
    <StartCard
      title="Employee paperwork"
      href="/employees"
      lines={[
        { count: expired.length, label: "current staff with a lapsed document", href: "/employees" },
        { count: soon.length, label: "expiring in the next 60 days", href: "/employees" },
      ]}
      items={alerts.slice(0, ITEMS).map((a) => ({
        primary: nameOf.get(a.employeeId) ?? "Unknown",
        secondary: `${DOCUMENT_KIND_LABEL[a.kind]} · ${a.state === "expired" ? "lapsed" : "expires"} ${shortDate(a.on)}`,
        href: `/employees/${a.employeeId}?tab=documents`,
      }))}
    />
  );
}

// ---------------------------------------------------------------------------

/** "9/1/26" — string arithmetic, never a Date, so no timezone can move it. */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;
}

function longDate(iso: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;
}
