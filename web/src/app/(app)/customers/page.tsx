import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { countsAsOwed, orderTotals } from "@/lib/specialOrders";
import { CustomersList, type CustomerRow } from "@/components/specialOrders/CustomersList";
import { canEditPage } from "@/lib/pageAccess";

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

  const supabase = await createClient();
  const orgId = session.membership.org_id;

  // All four sweeps at once, and every sweep's pages at once too. Run one page
  // after another this was ~70 round trips in a row — measured 10.4s, 6.4s of
  // it the 48 pages of lines alone.
  const [customerRes, orderRes, lineRes, paymentRes] = await Promise.all([
    sweepAll<Record<string, unknown>>(() =>
      supabase.from("customers").select("id, first_name, last_name, company, phone, email, address", { count: "exact" }).eq("org_id", orgId)
    ),
    sweepAll<Record<string, unknown>>(() =>
      supabase
        .from("special_orders")
        .select(
          "id, customer_id, event_date, status, kind, ignore_balance, tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee",
          { count: "exact" }
        )
        .eq("org_id", orgId)
        .not("customer_id", "is", null)
    ),
    sweepAll<{ order_id: string; qty: number | null; unit_price: number | null; taxable: boolean }>(() =>
      supabase.from("special_order_items").select("order_id, qty, unit_price, taxable", { count: "exact" }).eq("org_id", orgId)
    ),
    sweepAll<{ order_id: string; amount: number | null }>(() =>
      supabase.from("special_order_payments").select("order_id, amount", { count: "exact" }).eq("org_id", orgId)
    ),
  ]);

  if (customerRes.error) {
    return (
      <p className="text-sm text-accent">
        Could not load customers: {customerRes.error}
        {customerRes.error.includes("customers") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 051 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }
  // A short sweep of lines or payments would quietly UNDER- or OVER-state what
  // somebody owes, so any failure is a refusal rather than a smaller number.
  const failed = orderRes.error ?? lineRes.error ?? paymentRes.error;
  if (failed) {
    return <p className="text-sm text-accent">Could not load orders: {failed}</p>;
  }
  const customers = customerRes.rows;
  const orders = orderRes.rows;

  const lines = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean }[]>();
  for (const l of lineRes.rows) {
    const list = lines.get(l.order_id) ?? [];
    list.push({ qty: l.qty, unit_price: l.unit_price, taxable: l.taxable });
    lines.set(l.order_id, list);
  }
  const payments = new Map<string, { amount: number | null }[]>();
  for (const p of paymentRes.rows) {
    const list = payments.get(p.order_id) ?? [];
    list.push({ amount: p.amount });
    payments.set(p.order_id, list);
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
      // Only a BILLED order is money owed — a lead or a quote is a price we
      // offered (`countsAsOwed`, shared with the customer record).
      if (countsAsOwed(o as never)) {
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
      canWrite={canEditPage(session.membership.role, "/customers")}
      orgId={orgId}
    />
  );
}

type Paged = {
  order: (column: string) => Paged;
  range: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
    count: number | null;
  }>;
};

/**
 * Every row of a select, with its pages fetched CONCURRENTLY: the first page
 * asks for the exact count, the rest go out together. PostgREST caps a select
 * at 1,000 rows silently, and pages only line up if the sweep `.order()`s on a
 * unique column — hence `id`.
 *
 * `build` is a function because a Supabase builder is single-use: each page
 * needs its own.
 */
async function sweepAll<T>(
  build: () => unknown
): Promise<{ rows: T[]; error: string | null }> {
  const PAGE = 1000;
  const page = (from: number) =>
    (build() as Paged).order("id").range(from, from + PAGE - 1);

  const first = await page(0);
  if (first.error) return { rows: [], error: first.error.message };
  const total = first.count ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      page((i + 1) * PAGE)
    )
  );
  const bad = rest.find((r) => r.error);
  if (bad?.error) return { rows: [], error: bad.error.message };
  const rows = [first, ...rest].flatMap((r) => (r.data ?? []) as T[]);
  return { rows, error: null };
}
