import {
  customerLabel,
  needsAttention,
  orderTotals,
  readSettings,
  type AttentionOrder,
  type CustomerName,
} from "@/lib/specialOrders";
import { daysAfter, daysBefore } from "@/lib/today";

import { CARD_ITEMS, StartCard, urgentCount, type CardItem, type CardSummary } from "../StartCard";
import type { Result, StartContext, Supabase } from "./shared";

export async function SpecialOrdersWidget(ctx: StartContext) {
  return <StartCard {...(await summarize(ctx))} />;
}

/** What Special orders adds to the Home button's badge. */
export async function specialOrdersAttention(ctx: StartContext): Promise<number> {
  return urgentCount(await summarize(ctx));
}

async function summarize(ctx: StartContext): Promise<CardSummary> {
  const settings = readSettings(ctx.session.orgSettings);
  return specialOrdersSummary({
    result: await loadSpecialOrders(ctx.supabase, ctx.orgId, ctx.today, ctx.shop.id),
    today: ctx.today,
    thresholds: settings.attention,
    rush: settings.rush,
  });
}

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
      `id, number, kind, status, todo, flag_reason, flag_source, title, event_date, fulfillment,
       ignore_balance, tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate,
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
      .from("order_payments")
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

function specialOrdersSummary({
  result,
  today,
  thresholds,
  rush,
}: {
  result: Result<OrderRow[]>;
  today: string;
  thresholds: ReturnType<typeof readSettings>["attention"];
  /** 118: a rate needs the org's floor to resolve to money. Passed beside the
   *  thresholds because it comes from the same `readSettings` call. */
  rush: ReturnType<typeof readSettings>["rush"];
}): CardSummary {
  if (result.data === null) {
    return { lines: [], error: result.error };
  }
  const judged = result.data
    .map((o) => ({ o, reason: needsAttention(o, today, orderTotals(o, o.lines, o.payments, rush), thresholds) }))
    .filter((x): x is { o: OrderRow; reason: string } => x.reason !== null);
  // Flagged first — a human asked for eyes — then by event date.
  const flagged = judged.filter((x) => x.o.flag_reason);
  const rest = judged.filter((x) => !x.o.flag_reason);
  const thisWeek = result.data.filter(
    (o) => o.status === "order" && o.event_date !== null && o.event_date >= today && o.event_date <= daysAfter(today, 6)
  );

  const items: CardItem[] = [...flagged, ...rest].slice(0, CARD_ITEMS).map(({ o, reason }) => ({
    primary: `#${o.number} ${o.customer ? customerLabel(o.customer) : (o.title ?? "")}`.trim(),
    secondary: reason,
    href: `/special-orders/${o.id}`,
  }));

  return {
    lines: [
      /* `status=attention` SINCE 2026-09-20, when Needs Attention moved out of
         the Show menu and into Status — Show answers WHEN and this answers
         what state an order is in.
         `view=all` rides with it, and that is a fix rather than plumbing: the
         old link set Show to `attention`, which REPLACED the default Upcoming
         window, so it showed overdue orders. Split across two menus, Show
         would have stayed on Upcoming and hidden exactly the orders this line
         is counting — the ones whose event has gone by unpaid or unprinted.
         `all` also widens the SERVER window, which `attention` never did. */
      { count: flagged.length, label: "flagged", href: "/special-orders?status=attention&view=all", subset: true },
      { count: judged.length, label: "need attention", href: "/special-orders?status=attention&view=all" },
      { count: thisWeek.length, label: "committed orders in the next 7 days", href: "/special-orders?view=upcoming", urgent: false },
    ],
    items,
  };
}
