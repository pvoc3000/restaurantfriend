import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  countsAsOwed,
  customerLabel,
  money,
  orderTotals,
  type SpecialOrderStatus,
  readSettings,
} from "@/lib/specialOrders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SectionNav } from "@/components/ui/SectionNav";
import { CustomerCommandMenu } from "@/components/specialOrders/CustomerCommandMenu";
import { CustomerOrdersTable } from "@/components/specialOrders/CustomerOrdersTable";
import { CustomerAccounting } from "@/components/specialOrders/CustomerAccounting";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { canEditPage } from "@/lib/pageAccess";
import {
  invoiceNumberText,
  invoiceStatus,
  readInvoiceTerms,
} from "@/lib/customerInvoices";
import { AGING_BUCKETS, agingBucket, daysBetween, type Aging } from "@/lib/customerStatement";
import { usDate } from "@/lib/specialOrderDocs";
import { InvoiceStatusChip } from "@/components/customerInvoices/InvoiceStatusChip";
import { CustomerCredit, type CreditRow } from "@/components/customerInvoices/CustomerCredit";
import { canRefundPayments } from "@/lib/roles";

const CUSTOMERS_CRUMB = { href: "/customers", label: "Customers" };

/** THE RECORD'S TWO TABS (Mark, 2026-09-28): who they are, and their money. */
const TABS = [
  { key: "info", label: "Info" },
  { key: "billing", label: "Billing" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * One customer, and everything they have ever ordered.
 *
 * TWO TABS, the tab in the URL: INFO is who they are (details, address,
 * notes); BILLING is their money — open INVOICES, aged; orders owed and NOT
 * INVOICED; their CREDIT; their QuickBooks link; and every order, in a pane
 * that ends at the foot of the window. What they owe is also in the line under the name,
 * above the split, because "what does Cafe Knotted owe us" is the reason
 * anybody opens this record. Since 144 it is read the textbook way, in three
 * parts that never overlap (`customer_balances`).
 *
 * There are no `balance`, `spent` or `order_count` columns on `customers` and
 * there must never be. FMP had all three as calc fields; here they are summed
 * on every load, so deleting an order cannot leave a customer claiming money
 * nobody owes.
 */
export async function CustomerDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();

  const supabase = await createClient();
  // The Page Permissions sheet: staff, supervisors and purchasers READ the
  // customer book; a manager and the owner change it.
  const canWrite = canEditPage(session.membership.role, "/customers");

  const [{ data: customer, error }, { data: orderRows, error: orderError }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, org_id, legacy_id, first_name, last_name, company, phone, email, address, notes")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("special_orders")
      .select(
        `id, number, kind, status, title, event_date, ignore_balance,
         tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate`
      )
      .eq("customer_id", id)
      .order("event_date", { ascending: false, nullsFirst: false })
      .limit(500),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this customer: {error.message}
        {error.message.includes("customers") ? (
          <span className="mt-2 block text-muted">
            If this names a missing relation, migration 051 has not been applied yet.
          </span>
        ) : null}
      </p>
    );
  }
  if (!customer) {
    return <p className="text-sm text-muted">That customer does not exist, or is not yours to see.</p>;
  }

  const orders = orderRows ?? [];
  const ids = orders.map((o) => o.id as string);

  const lines = new Map<string, { qty: number | null; unit_price: number | null; taxable: boolean }[]>();
  const payments = new Map<string, { amount: number | null }[]>();
  if (ids.length) {
    const [{ data: lineRows }, { data: payRows }] = await Promise.all([
      supabase.from("special_order_items").select("order_id, qty, unit_price, taxable").in("order_id", ids),
      supabase.from("order_payments").select("order_id, amount").in("order_id", ids),
    ]);
    for (const l of lineRows ?? []) {
      const list = lines.get(l.order_id as string) ?? [];
      list.push({ qty: l.qty as number, unit_price: l.unit_price as number, taxable: l.taxable as boolean });
      lines.set(l.order_id as string, list);
    }
    for (const p of payRows ?? []) {
      const list = payments.get(p.order_id as string) ?? [];
      list.push({ amount: p.amount as number });
      payments.set(p.order_id as string, list);
    }
  }

  const withMoney = orders.map((o) => ({
    id: o.id as string,
    number: o.number as string,
    kind: o.kind as string,
    status: o.status as SpecialOrderStatus | null,
    title: o.title as string | null,
    event_date: o.event_date as string | null,
    ignore_balance: Boolean(o.ignore_balance),
    totals: orderTotals(o as never, lines.get(o.id as string) ?? [], payments.get(o.id as string) ?? [], readSettings(session.orgSettings).rush),
  }));

  // Payments are payments whatever the record's kind — a template has none.
  const spent = withMoney.reduce((a, o) => a + o.totals.paid, 0);

  const tab: Tab = TABS.some((t) => t.key === rawParams.tab) ? (rawParams.tab as Tab) : "info";
  const billing = tab === "billing";
  // `SKIP` stands in for a read only the Billing tab wants, so the
  // destructuring keeps its shape — VendorDetail's idiom.
  const SKIP = { data: null };

  // WHAT THEY OWE (144), in three parts, and their invoices (124) with each
  // one's money — a failed read hides a part rather than breaking the record.
  // The balances are read on both tabs: the line under the name states them.
  const [{ data: balanceRows }, { data: uninvoicedRows }, { data: invoiceRows }, { data: creditData }] =
    await Promise.all([
      supabase.rpc("customer_balances", { p_org: customer.org_id, p_customer: id }),
      billing ? supabase.rpc("customer_uninvoiced_orders", { p_customer: id }) : SKIP,
      billing
        ? supabase
            .from("customer_invoice_totals")
            .select("id, number, revision, issued_on, due_on, sent_at, paid_at, voided_at, total, applied, balance, posted")
            .eq("customer_id", id)
            .order("number", { ascending: false })
            .order("revision", { ascending: false })
        : SKIP,
      // Their CREDIT (143): money applied to nothing.
      billing ? supabase.rpc("customer_credit", { p_customer: id }) : SKIP,
    ]);
  const owes = ((balanceRows ?? []) as { invoiced: number; not_invoiced: number; credit: number }[])[0];
  const invoiced = Number(owes?.invoiced ?? 0);
  const notInvoiced = Number(owes?.not_invoiced ?? 0);
  const credit = Number(owes?.credit ?? 0);

  /**
   * `countsAsOwed` IS LOAD-BEARING (`customer_uninvoiced_orders` applies it in
   * SQL): a standing order carries lines and no payments, so it always derives
   * a balance, and the record once claimed $1,738.50 outstanding for Cafe
   * Knotted from two RECURRENCES. A lead or a quote is a price offered, not a
   * debt. And an order on a sent invoice is owed THROUGH that invoice, so it
   * is not here twice.
   */
  const uninvoiced = ((uninvoicedRows ?? []) as {
    id: string; number: string; title: string | null; event_date: string | null; status: SpecialOrderStatus | null;
    total: number; not_invoiced: number;
  }[]).map((o) => ({
    id: o.id,
    number: o.number,
    kind: "order",
    status: o.status,
    title: o.title,
    event_date: o.event_date,
    total: Number(o.total),
    due: Number(o.not_invoiced),
  }));

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const invoiceTerms = readInvoiceTerms(session.orgSettings as Record<string, unknown>);
  const invoices = ((invoiceRows ?? []) as {
    id: string; number: number; revision: number; issued_on: string; due_on: string | null;
    sent_at: string | null; paid_at: string | null; voided_at: string | null;
    total: number; applied: number; balance: number; posted: boolean;
  }[]).map((r) => ({
    id: r.id,
    number: invoiceNumberText(r.number, invoiceTerms, r.revision),
    issued_on: r.issued_on,
    due_on: r.due_on,
    status: invoiceStatus(r, today),
    total: Number(r.total),
    balance: Number(r.balance),
    posted: r.posted,
  }));
  // The open ones, aged as of today — a posted invoice still asking for money.
  const aging: Aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  for (const inv of invoices) {
    if (!inv.posted || inv.balance <= 0.005) continue;
    const bucket = agingBucket(daysBetween(inv.due_on ?? inv.issued_on, today));
    aging[bucket] = Math.round((aging[bucket] + inv.balance) * 100) / 100;
  }

  const creditRows = ((creditData ?? []) as CreditRow[]).map((c) => ({ ...c, credit: Number(c.credit) }));

  const trail = parseTrail(rawParams, CUSTOMERS_CRUMB);
  const address = (customer.address ?? {}) as Record<string, unknown>;

  // A link to one tab of this record, carrying the other params through —
  // `from` above all, or moving between tabs would strip the breadcrumb trail.
  // Info writes no parameter, so the record's plain address stays canonical.
  const tabHref = (t: Tab) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(rawParams)) {
      const one = Array.isArray(v) ? v[0] : v;
      if (k !== "tab" && one) q.set(k, one);
    }
    if (t !== "info") q.set("tab", t);
    const qs = q.toString();
    return `/customers/${id}${qs ? `?${qs}` : ""}`;
  };
  const tabItems = TABS.map((t) => ({ key: t.key, label: t.label, href: tabHref(t.key) }));
  // Links out of the Billing tab come back to it.
  const here = { href: tabHref("billing"), label: "Customer" };

  return (
    <div className="space-y-12">
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={customerLabel(customer)} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      {/* THE TITLE ROW CARRIES THE ONE ACTIONS MENU, level with the name at
          the right margin — every record screen's shape. Above the split, so
          it is on both tabs. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {customerLabel(customer)}
          </h1>
          <p className="text-sm text-muted">
            {withMoney.length} order{withMoney.length === 1 ? "" : "s"}
            {spent > 0 ? ` · ${money(spent)} paid` : ""}
            {invoiced > 0 ? <span className="text-accent"> · {money(invoiced)} invoiced</span> : null}
            {notInvoiced > 0 ? <span className="text-accent"> · {money(notInvoiced)} not invoiced</span> : null}
            {credit > 0 ? ` · ${money(credit)} credit` : ""}
          </p>
        </div>
        <CustomerCommandMenu
          id={id}
          orgId={customer.org_id as string}
          name={customerLabel(customer)}
          orderCount={withMoney.length}
          today={today}
          defaultLocationId={session.activeLocation?.id ?? null}
          takenBy={session.membership.display_name ?? session.email}
          canWrite={canWrite}
        />
      </div>

      {/* The section nav of every tabbed record — a sidebar at desk width, the
          Mac tabs below `lg`. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this customer" value={tab} items={tabItems} />
        </div>
        <div className="lg:hidden">
          <SectionNav orientation="horizontal" ariaLabel="Which part of this customer" value={tab} items={tabItems} />
        </div>

        <div className="min-w-0 flex-1 space-y-12">
          {tab === "info" && (
            <>
              <section className="space-y-3">
                <SectionHeading>Details</SectionHeading>
                <div className="grid max-w-[56rem] gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Row label="First name"><Cell id={id} canWrite={canWrite} address={address} column="first_name" value={customer.first_name as string | null} label="First name" /></Row>
                  <Row label="Last name"><Cell id={id} canWrite={canWrite} address={address} column="last_name" value={customer.last_name as string | null} label="Last name" /></Row>
                  <Row label="Company"><Cell id={id} canWrite={canWrite} address={address} column="company" value={customer.company as string | null} label="Company" /></Row>
                  <Row label="Phone"><Cell id={id} canWrite={canWrite} address={address} column="phone" value={customer.phone as string | null} label="Phone" /></Row>
                  <Row label="Email"><Cell id={id} canWrite={canWrite} address={address} column="email" value={customer.email as string | null} label="Email" /></Row>
                  <Row label="FileMaker id">
                    {/* History, never edited: it is how a re-export finds this row. */}
                    <span className={READ_ONLY_VALUE}>{(customer.legacy_id as string) ?? "—"}</span>
                  </Row>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Address</SectionHeading>
                {/* jsonb, edited a key at a time — `locations.address`' idiom, and the
                    reason it stays jsonb: an address is read whole and written whole,
                    and `InlineValue` already has a json path for it. */}
                <div className="grid max-w-[56rem] gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Row label="Street"><Cell id={id} canWrite={canWrite} address={address} column="address" jsonPath={["street"]} value={(address.street as string) ?? null} label="Street" /></Row>
                  <Row label="Street 2"><Cell id={id} canWrite={canWrite} address={address} column="address" jsonPath={["street2"]} value={(address.street2 as string) ?? null} label="Street line 2" /></Row>
                  <Row label="City"><Cell id={id} canWrite={canWrite} address={address} column="address" jsonPath={["city"]} value={(address.city as string) ?? null} label="City" /></Row>
                  <Row label="State"><Cell id={id} canWrite={canWrite} address={address} column="address" jsonPath={["state"]} value={(address.state as string) ?? null} label="State" /></Row>
                  <Row label="ZIP"><Cell id={id} canWrite={canWrite} address={address} column="address" jsonPath={["zip"]} value={(address.zip as string) ?? null} label="ZIP" /></Row>
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Notes</SectionHeading>
                {canWrite ? (
                  <InlineValue table="customers" id={id} column="notes" multiline boxed={BOXED_FIELDS}
                               value={customer.notes as string | null} ariaLabel="Notes about this customer" />
                ) : (
                  <p
                    className={`${READ_ONLY_VALUE} whitespace-pre-wrap ${
                      BOXED_FIELDS ? "block min-h-16 w-full border border-hairline" : ""
                    }`}
                  >
                    {(customer.notes as string) ?? "—"}
                  </p>
                )}
              </section>
            </>
          )}

          {tab === "billing" && (
            <>
              {invoices.length > 0 ? (
                <section className="space-y-2">
                  <SectionHeading count={invoices.length}>Invoices</SectionHeading>
                  {invoiced > 0 ? (
                    <dl className="flex max-w-[60rem] flex-wrap gap-x-8 gap-y-2 pb-1">
                      {AGING_BUCKETS.map((b) => (
                        <div key={b.key} className="space-y-0.5">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{b.label}</dt>
                          <dd className={`tabular-nums ${aging[b.key] ? (b.key === "current" ? "" : "text-accent") : "text-faint"}`}>
                            {aging[b.key] ? money(aging[b.key]) : "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <table className="w-full max-w-[60rem] border-collapse text-[14px]">
                    <thead>
                      <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
                        <th className="w-28 px-3 py-2 text-left">Invoice</th>
                        <th className="w-32 px-3 py-2 text-left">Issued</th>
                        <th className="w-32 px-3 py-2 text-left">Due date</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="w-28 px-3 py-2 text-right">Total</th>
                        <th className="w-28 px-3 py-2 text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-neutral-50">
                          <td className="px-3 py-2 tabular-nums">
                            <Link
                              href={withFrom(`/customer-invoices/${inv.id}`, here)}
                              className="hover:underline"
                            >
                              {inv.number}
                            </Link>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted">{usDate(inv.issued_on)}</td>
                          <td className="px-3 py-2 tabular-nums text-muted">{inv.due_on ? usDate(inv.due_on) : "—"}</td>
                          <td className="px-3 py-2">
                            <InvoiceStatusChip status={inv.status} />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(inv.total)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-accent">
                            {inv.posted && inv.balance > 0.005 ? money(inv.balance) : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {uninvoiced.length > 0 ? (
                <CustomerOrdersTable
                  heading="Not Invoiced"
                  rows={uninvoiced}
                  from={here}
                  storageKey="rf.customerUninvoiced.v1"
                  accent
                />
              ) : null}

              <CustomerCredit rows={creditRows} canRefund={canRefundPayments(session.membership.role)} />

              <CustomerAccounting
                customerId={customer.id}
                orgId={customer.org_id as string}
                customerName={customerLabel(customer as never) || "This customer"}
              />

              {/* LAST, because its pane runs to the foot of the window: a
                  wholesale account has hundreds of orders, and they scroll
                  inside the pane rather than taking the record with them. */}
              {orderError ? (
                <p className="text-sm text-accent">Could not load their orders: {orderError.message}</p>
              ) : (
                <CustomerOrdersTable
                  heading="Orders"
                  rows={withMoney.map((o) => ({
                    id: o.id,
                    number: o.number,
                    kind: o.kind,
                    status: o.status,
                    title: o.title,
                    event_date: o.event_date,
                    total: o.totals.total,
                    due: countsAsOwed(o) && o.totals.balance > 0 ? o.totals.balance : 0,
                  }))}
                  from={here}
                  storageKey="rf.customerOrders.v1"
                  fillViewport
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One editable field on the customer, or plain text below supervisor+.
 *
 * MODULE SCOPE, not a closure inside the record. A component declared during
 * render is a NEW component type every render, so React unmounts and remounts
 * it — which for an inline editor means the cell you are typing in resets on
 * the first keystroke that re-renders the page. The lint rule
 * (`react-hooks/static-components`) is what caught it.
 *
 * `READ_ONLY_VALUE` rather than a bare span: the padding is what keeps the
 * column straight beside the editable cells (the `sent_via` lesson).
 */
function Cell({
  id,
  canWrite,
  address,
  column,
  value,
  label,
  jsonPath,
}: {
  id: string;
  canWrite: boolean;
  address: Record<string, unknown>;
  column: string;
  value: string | null;
  label: string;
  jsonPath?: string[];
}) {
  if (!canWrite) return <span className={READ_ONLY_VALUE}>{value ?? "—"}</span>;
  return (
    <InlineValue
      // THE SEAM. Every editable cell on this record goes through here, so one
      // default boxes the lot — and a read-only value keeps none, which is what
      // the box means.
      boxed={BOXED_FIELDS}
      table="customers"
      id={id}
      column={jsonPath ? "address" : column}
      jsonColumn={jsonPath ? "address" : undefined}
      jsonPath={jsonPath}
      jsonDocument={jsonPath ? address : undefined}
      value={value}
      ariaLabel={label}
    />
  );
}
