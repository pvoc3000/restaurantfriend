import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { orderTotals } from "@/lib/specialOrders";
import { CustomersList, type CustomerRow } from "@/components/specialOrders/CustomersList";

/**
 * The customer book — org-wide, supervisor+, and exempt from
 * `InactiveLocationGate` for the same reason `/employees` is: a customer
 * belongs to the org, not to a shop.
 *
 * ORDER COUNT, LAST ORDER AND THE OUTSTANDING BALANCE ARE DERIVED HERE.
 * FileMaker kept all three as calc fields on the customer; a stored count goes
 * wrong the first time an order is deleted, and this list is where anybody
 * would notice last.
 *
 * That is four paginated sweeps over the whole book. It is the honest cost of
 * having no stored total, and it is bounded: 5,874 customers, 8,330 orders,
 * 47,827 lines. Every sweep `.order()`s before `.range()`, or the pages
 * overlap and a customer silently loses orders.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();

  if (!canEnterCounts(session.membership.role)) {
    return (
      <p className="text-sm text-muted">
        The customer book is open to supervisors and up — it carries names,
        addresses, phone numbers and email addresses.
      </p>
    );
  }

  const supabase = await createClient();
  const orgId = session.membership.org_id;

  const customers: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name, company, phone, email, address")
      .eq("org_id", orgId)
      .order("id")
      .range(from, from + 999);
    if (error) {
      return (
        <p className="text-sm text-accent">
          Could not load customers: {error.message}
          {error.message.includes("customers") ? (
            <span className="mt-2 block text-muted">
              If this names a missing relation, migration 051 has not been applied yet.
            </span>
          ) : null}
        </p>
      );
    }
    customers.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // The orders, reduced to what this list says about them.
  const orders: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("special_orders")
      .select("id, customer_id, event_date, status, kind, ignore_balance, tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee")
      .eq("org_id", orgId)
      .not("customer_id", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) {
      return <p className="text-sm text-accent">Could not load orders: {error.message}</p>;
    }
    orders.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const orderIds = orders.map((o) => o.id as string);
  const lines = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean }[]>();
  const payments = new Map<string, { amount: number | null }[]>();

  if (orderIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("special_order_items")
        .select("order_id, qty, unit_price, taxable")
        .eq("org_id", orgId)
        .order("id")
        .range(from, from + 999);
      for (const l of data ?? []) {
        const list = lines.get(l.order_id as string) ?? [];
        list.push({ qty: l.qty as number, unit_price: l.unit_price as number, taxable: l.taxable as boolean });
        lines.set(l.order_id as string, list);
      }
      if (!data || data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("special_order_payments")
        .select("order_id, amount")
        .eq("org_id", orgId)
        .order("id")
        .range(from, from + 999);
      for (const p of data ?? []) {
        const list = payments.get(p.order_id as string) ?? [];
        list.push({ amount: p.amount as number });
        payments.set(p.order_id as string, list);
      }
      if (!data || data.length < 1000) break;
    }
  }

  const stats = new Map<string, { count: number; last: string | null; owed: number }>();
  for (const o of orders) {
    const cid = o.customer_id as string;
    const s = stats.get(cid) ?? { count: 0, last: null, owed: 0 };
    // A cancelled order is not an order they placed with us, and a template is
    // not an order at all — neither counts toward the relationship.
    if (o.status !== "cancelled" && o.kind === "order") {
      s.count += 1;
      const d = o.event_date as string | null;
      if (d && (!s.last || d > s.last)) s.last = d;
      if (!o.ignore_balance) {
        const totals = orderTotals(
          o as never,
          lines.get(o.id as string) ?? [],
          payments.get(o.id as string) ?? []
        );
        if (totals.balance > 0) s.owed += totals.balance;
      }
    }
    stats.set(cid, s);
  }

  const rows: CustomerRow[] = customers.map((c) => {
    const s = stats.get(c.id as string);
    const address = (c.address ?? {}) as Record<string, unknown>;
    return {
      id: c.id as string,
      first_name: c.first_name as string | null,
      last_name: c.last_name as string | null,
      company: c.company as string | null,
      phone: c.phone as string | null,
      email: c.email as string | null,
      city: (address.city as string | null) ?? null,
      orderCount: s?.count ?? 0,
      lastOrder: s?.last ?? null,
      outstanding: Math.round((s?.owed ?? 0) * 100) / 100,
    };
  });

  return (
    <CustomersList
      rows={rows}
      initialFilters={params}
      initialSearch={parseFilterSearch(params)}
      canWrite={canEnterCounts(session.membership.role)}
      orgId={orgId}
    />
  );
}
