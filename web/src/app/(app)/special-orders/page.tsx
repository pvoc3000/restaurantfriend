import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { orderTotals, readSettings } from "@/lib/specialOrders";
import {
  SpecialOrdersList,
  type SpecialOrderRow,
} from "@/components/specialOrders/SpecialOrdersList";

/**
 * The special orders work queue.
 *
 * ORG-WIDE (decision 8) — no `location_id` filter anywhere below, and the
 * screen is exempt from `InactiveLocationGate` for the same reason
 * `/employees` is. Kitchen and pickup shop are filter MENUS.
 *
 * THE MONEY IS DERIVED HERE, on the server, from the lines and the payments
 * (decision 6). That is three queries instead of one, and it is the price of
 * having no stored total to drift: FileMaker kept `Order_Subtotal` AND
 * `Order_Subtotal2`, by era, and 50 of its 8,330 orders no longer reproduce
 * either from their own lines.
 *
 * Both child sweeps PAGINATE. `special_order_items` holds 47,827 rows and
 * `special_order_payments` 6,457 — well past PostgREST's silent 1,000-row cap,
 * which returns a short array and no error. A 500-order page can easily carry
 * more than a thousand lines.
 */
export default async function SpecialOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();

  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const settings = readSettings(session.orgSettings);

  /**
   * The window. Twelve years and 8,330 orders is not a list, so the default is
   * everything from a month ago forward plus the templates and standing orders
   * — which is what the `upcoming` view shows anyway. `?range=all` is the
   * escape hatch the `past` view needs, and the list says when it is capped.
   */
  // `past` and `all` are the two views that ask to look backwards. They must
  // match the `view` dimension's option values in `SpecialOrdersList` — a
  // window that disagrees with the filter shows an empty list and blames the
  // filter for it.
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const showAll = view === "past" || view === "all";
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);

  let query = supabase
    .from("special_orders")
    .select(
      `id, number, kind, status, todo, flag_reason, title, event_date, event_time,
       fulfillment, standing_days, ignore_balance,
       tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee,
       quote_sent_at, quote_returned_at, invoice_sent_at, invoice_paid_at,
       receipt_sent_at, delivery_scheduled_at, order_printed_at, order_scheduled_at,
       location_id, kitchen_location_id,
       customers ( id, first_name, last_name, company )`
    )
    .eq("org_id", session.membership.org_id)
    .order("event_date", { ascending: false })
    .limit(500);

  // A record with no event date — every template and standing order — must
  // survive the window, or the KIND menu would lead to an empty list.
  if (!showAll) {
    query = query.or(`event_date.gte.${since.toISOString().slice(0, 10)},event_date.is.null`);
  }

  const { data: orders, error } = await query;

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load special orders: {error.message}
        {error.message.includes("special_orders") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 051 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }

  const ids = (orders ?? []).map((o) => o.id as string);

  const lines = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean }[]>();
  const payments = new Map<string, { amount: number | null }[]>();

  if (ids.length > 0) {
    // `.order()` before `.range()`, always — without it the pages overlap and
    // an order silently loses lines, which here would understate its total.
    for (let from = 0; ; from += 1000) {
      const { data, error: lineError } = await supabase
        .from("special_order_items")
        .select("order_id, qty, unit_price, taxable")
        .in("order_id", ids)
        .order("id")
        .range(from, from + 999);
      if (lineError) {
        return <p className="text-sm text-accent">Could not load order lines: {lineError.message}</p>;
      }
      for (const l of data ?? []) {
        const list = lines.get(l.order_id as string) ?? [];
        list.push({ qty: l.qty as number, unit_price: l.unit_price as number, taxable: l.taxable as boolean });
        lines.set(l.order_id as string, list);
      }
      if (!data || data.length < 1000) break;
    }

    for (let from = 0; ; from += 1000) {
      const { data, error: payError } = await supabase
        .from("special_order_payments")
        .select("order_id, amount")
        .in("order_id", ids)
        .order("id")
        .range(from, from + 999);
      if (payError) {
        return <p className="text-sm text-accent">Could not load payments: {payError.message}</p>;
      }
      for (const p of data ?? []) {
        const list = payments.get(p.order_id as string) ?? [];
        list.push({ amount: p.amount as number });
        payments.set(p.order_id as string, list);
      }
      if (!data || data.length < 1000) break;
    }
  }

  // Codes rather than ids on the row: the list groups, filters and prints by
  // code, and `session.locations` is the FULL list so an order at a closed
  // shop still shows which one instead of an em dash.
  const codeOf = (id: string | null) =>
    id ? session.locations.find((l) => l.id === id)?.code ?? null : null;

  const rows: SpecialOrderRow[] = (orders ?? []).map((o) => {
    const raw = o as unknown as Record<string, unknown>;
    const money = {
      tax_rate: raw.tax_rate as number | null,
      discount_amount: raw.discount_amount as number | null,
      discount_rate: raw.discount_rate as number | null,
      delivery_charge: raw.delivery_charge as number | null,
      rush_fee: raw.rush_fee as number | null,
      ignore_balance: raw.ignore_balance as boolean,
    };
    return {
      ...(raw as unknown as SpecialOrderRow),
      ...money,
      ignore_balance: Boolean(raw.ignore_balance),
      location_code: codeOf(raw.location_id as string | null),
      kitchen_code: codeOf(raw.kitchen_location_id as string | null),
      customer: (raw.customers as SpecialOrderRow["customer"]) ?? null,
      totals: orderTotals(money, lines.get(o.id as string) ?? [], payments.get(o.id as string) ?? []),
    };
  });

  return (
    <SpecialOrdersList
      rows={rows}
      today={today}
      thresholds={settings.attention}
      canWrite={canEnterCounts(session.membership.role)}
      orgId={session.membership.org_id}
      kitchens={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
      defaultLocationId={session.activeLocation?.id ?? null}
      initialFilters={params}
      initialSearch={parseFilterSearch(params)}
      capped={rows.length === 500}
    />
  );
}
