import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import {
  parsePoFilters,
  parsePoView,
  rangeStart,
  PO_VIEW_COOKIE,
} from "@/lib/poFilters";
import { serverTimeZone } from "@/lib/today";
import type { PoStatus } from "@/lib/purchaseOrders";
import { PurchaseOrderList } from "@/components/purchasing/PurchaseOrderList";

export type PoListRow = {
  id: string;
  po_number: string;
  status: PoStatus;
  sent_via: string | null;
  order_date: string;
  delivery_date: string | null;
  vendors: { id: string; name: string; order_type: string } | null;
  line_count: number;
  ordered_total: number;
  received_total: number;
};

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // How you left the list last time, from the session cookie — read on the
  // server so the first paint is already sorted and filtered the way you had
  // it, rather than flashing the defaults. An explicit query param still wins.
  const remembered = parsePoView((await cookies()).get(PO_VIEW_COOKIE)?.value);
  const filters = parsePoFilters(await searchParams, remembered);
  const session = await getAppSession();
  const supabase = await createClient();

  if (!session.activeLocation) {
    return (
      <p className="text-sm text-muted">
        Pick a location to see its purchase orders.
      </p>
    );
  }

  // POs are location-scoped (design rule 3) and bounded by the date window —
  // 16.8k rows exist and the working set is the recent past.
  let query = supabase
    .from("purchase_orders")
    .select(
      `id, po_number, status, sent_via, order_date, delivery_date,
       vendors ( id, name, order_type )`
    )
    .eq("location_id", session.activeLocation.id)
    .order("order_date", { ascending: false })
    .limit(500);

  // The org's calendar day, not the host's — a Today window on a UTC host
  // would otherwise start hiding this afternoon's orders (see lib/today).
  const start = rangeStart(
    filters.range,
    session.orgSettings.timezone ?? serverTimeZone()
  );
  if (start) query = query.gte("order_date", start);

  const { data: orders, error } = await query;

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load purchase orders: {error.message}
      </p>
    );
  }

  const poIds = (orders ?? []).map((o) => o.id);

  // Line counts and totals in one pass rather than per-PO. Paginated because
  // PostgREST caps a page at 1000 and 500 POs is a few thousand lines.
  const totals = new Map<string, { lines: number; ordered: number; received: number }>();
  for (let from = 0; poIds.length > 0; from += 1000) {
    const { data: lines, error: lineError } = await supabase
      .from("purchase_order_items")
      .select("po_id, qty_ordered, qty_received, unit_price")
      .in("po_id", poIds)
      .range(from, from + 999);

    if (lineError) {
      return (
        <p className="text-sm text-accent">
          Could not load order lines: {lineError.message}
        </p>
      );
    }
    for (const line of lines ?? []) {
      const entry = totals.get(line.po_id) ?? { lines: 0, ordered: 0, received: 0 };
      entry.lines += 1;
      entry.ordered += Number(line.qty_ordered ?? 0) * Number(line.unit_price ?? 0);
      entry.received += Number(line.qty_received ?? 0) * Number(line.unit_price ?? 0);
      totals.set(line.po_id, entry);
    }
    if (!lines || lines.length < 1000) break;
  }

  const rows: PoListRow[] = (orders ?? []).map((o) => {
    const t = totals.get(o.id);
    return {
      ...(o as unknown as Omit<PoListRow, "line_count" | "ordered_total" | "received_total">),
      line_count: t?.lines ?? 0,
      ordered_total: t?.ordered ?? 0,
      received_total: t?.received ?? 0,
    };
  });

  return (
    <PurchaseOrderList
      orders={rows}
      initialFilters={filters}
      activeLocationCode={session.activeLocation.code}
      capped={rows.length === 500}
    />
  );
}
