import { daysBefore } from "@/lib/today";

import { CARD_ITEMS, StartCard, type CardItem } from "../StartCard";
import { shortDate, type Result, type StartContext, type Supabase } from "./shared";

export async function PurchaseOrdersWidget(ctx: StartContext) {
  return <PurchaseOrdersCard result={await loadPurchaseOrders(ctx.supabase, ctx.today, ctx.shop.id)} today={ctx.today} />;
}

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
    return <StartCard lines={[]} error={result.error} />;
  }
  const rows = result.data;
  const drafts = rows.filter((r) => r.status === "draft");
  const sent = rows.filter((r) => r.status === "sent");
  // A sent order whose delivery day has passed and nothing was recorded.
  const late = sent.filter((r) => r.delivery_date !== null && r.delivery_date < today);
  const unclosed = rows.filter((r) => r.status === "received");

  const items: CardItem[] = [...late, ...drafts].slice(0, CARD_ITEMS).map((r) => ({
    primary: `${r.vendor ?? "Unknown vendor"} ${r.po_number}`,
    secondary:
      r.status === "draft"
        ? `Draft ${shortDate(r.order_date)}`
        : `Due ${shortDate(r.delivery_date)}`,
    href: `/purchase-orders/${r.id}`,
  }));

  return (
    <StartCard
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
