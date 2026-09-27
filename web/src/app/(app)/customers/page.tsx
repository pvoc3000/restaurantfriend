import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/filterMenus";
import { parseFilterSearch } from "@/lib/filterMenus";
import { CustomersList, type CustomerRow } from "@/components/specialOrders/CustomersList";
import { canEditPage } from "@/lib/pageAccess";

/**
 * The customer book — org-wide, supervisor+, and exempt from
 * `InactiveLocationGate` for the same reason `/employees` is: a customer
 * belongs to the org, not to a shop.
 *
 * ORDER COUNT, LAST ORDER AND WHAT THEY OWE ARE DERIVED HERE. FileMaker kept
 * them as calc fields on the customer; a stored count goes wrong the first
 * time an order is deleted, and this list is where anybody would notice last.
 *
 * What they owe is `customer_balances` (144) — invoiced, not invoiced and
 * credit, worked out in the database for the few dozen customers who have
 * any. It replaced sweeping all 47,827 order lines and every payment to
 * re-derive each order's balance here. The customers and their orders are
 * still swept, for the count and the last order; every sweep `.order()`s
 * before `.range()`, or the pages overlap and a customer silently loses orders.
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

  // Every sweep at once, and every sweep's pages at once too. Run one page
  // after another this was ~70 round trips in a row (measured 10.4s).
  const [customerRes, orderRes, balanceRes] = await Promise.all([
    sweepAll<Record<string, unknown>>(() =>
      supabase.from("customers").select("id, first_name, last_name, company, phone, email, address", { count: "exact" }).eq("org_id", orgId)
    ),
    sweepAll<{ id: string; customer_id: string; event_date: string | null; status: string | null; kind: string }>(() =>
      supabase
        .from("special_orders")
        .select("id, customer_id, event_date, status, kind", { count: "exact" })
        .eq("org_id", orgId)
        .not("customer_id", "is", null)
    ),
    sweepBalances(supabase, orgId),
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
  // A short read would quietly UNDER-state what somebody owes, so any failure
  // is a refusal rather than a smaller number.
  const failed = orderRes.error ?? balanceRes.error;
  if (failed) {
    return <p className="text-sm text-accent">Could not load orders: {failed}</p>;
  }
  const customers = customerRes.rows;

  const stats = new Map<string, { count: number; last: string | null }>();
  for (const o of orderRes.rows) {
    const s = stats.get(o.customer_id) ?? { count: 0, last: null };
    // A cancelled order is not an order they placed with us, and a template is
    // not an order at all — neither counts toward the relationship.
    if (o.status !== "cancelled" && o.kind === "order") {
      s.count += 1;
      if (o.event_date && (!s.last || o.event_date > s.last)) s.last = o.event_date;
    }
    stats.set(o.customer_id, s);
  }
  const owes = new Map(balanceRes.rows.map((b) => [b.customer_id, b]));

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
      invoiced: Number(owes.get(c.id as string)?.invoiced ?? 0),
      notInvoiced: Number(owes.get(c.id as string)?.not_invoiced ?? 0),
      credit: Number(owes.get(c.id as string)?.credit ?? 0),
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

type Balance = { customer_id: string; invoiced: number; not_invoiced: number; credit: number };

/** `customer_balances` (144), paged like the tables: an RPC's rows stop at
 *  1,000 as silently as a select's. It returns only customers who owe or
 *  hold credit, a few dozen, in customer id order. */
async function sweepBalances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<{ rows: Balance[]; error: string | null }> {
  const rows: Balance[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc("customer_balances", { p_org: orgId })
      .range(from, from + 999);
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as Balance[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}
