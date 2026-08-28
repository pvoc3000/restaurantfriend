import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts } from "@/lib/roles";
import { crumbPath, parseTrail, withFrom } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  KIND_LABEL,
  STATUS_LABEL,
  customerLabel,
  money,
  orderTotals,
  type SpecialOrderStatus,
} from "@/lib/specialOrders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { CustomerActions } from "@/components/specialOrders/CustomerActions";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";

const CUSTOMERS_CRUMB = { href: "/customers", label: "Customers" };

/**
 * One customer, and everything they have ever ordered.
 *
 * THE UNPAID ORDERS COME FIRST, which is FileMaker's own split and the reason
 * anybody opens this record: "what does Cafe Knotted owe us" is answered by
 * looking, not by reading down a list of two hundred.
 *
 * There are no `balance`, `spent` or `order_count` columns on `customers` and
 * there must never be. FMP had all three as calc fields; here they are summed
 * from the orders on every load, so deleting an order cannot leave a customer
 * claiming money nobody owes.
 */
export async function CustomerDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();

  if (!canEnterCounts(session.membership.role)) {
    return (
      <p className="text-sm text-muted">
        Customer records are open to supervisors and up — they carry names,
        addresses and phone numbers.
      </p>
    );
  }

  const supabase = await createClient();
  const canWrite = canEnterCounts(session.membership.role);

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
         tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee`
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
      supabase.from("special_order_payments").select("order_id, amount").in("order_id", ids),
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
    totals: orderTotals(o as never, lines.get(o.id as string) ?? [], payments.get(o.id as string) ?? []),
  }));

  /**
   * `kind === "order"` IS LOAD-BEARING, and leaving it out was a real bug
   * caught by looking at Cafe Knotted: a standing order carries lines and no
   * payments, so it always derives a balance — and the record claimed $1,738.50
   * outstanding from two RECURRENCES while the list, which does check the kind,
   * said nothing was owed. Two screens disagreeing about one customer's money.
   *
   * A standing order is the SHAPE of a recurring order, never a bill. The days
   * it materializes are the orders, and those are in the list below.
   * `needsAttention` guards the same way for the same reason.
   */
  const unpaid = withMoney.filter(
    (o) =>
      o.kind === "order" &&
      o.status !== "cancelled" &&
      !o.ignore_balance &&
      o.totals.balance > 0 &&
      o.totals.total > 0
  );
  const rest = withMoney.filter((o) => !unpaid.includes(o));
  const owed = unpaid.reduce((a, o) => a + o.totals.balance, 0);
  // Payments are payments whatever the record's kind — a template has none.
  const spent = withMoney.reduce((a, o) => a + o.totals.paid, 0);

  const trail = parseTrail(rawParams, CUSTOMERS_CRUMB);
  const address = (customer.address ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-12">
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={customerLabel(customer)} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {customerLabel(customer)}
        </h1>
        <p className="text-sm text-muted">
          {withMoney.length} order{withMoney.length === 1 ? "" : "s"}
          {spent > 0 ? ` · ${money(spent)} paid` : ""}
          {owed > 0 ? (
            <span className="text-accent"> · {money(owed)} outstanding</span>
          ) : null}
        </p>
      </div>

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

      {orderError ? (
        <p className="text-sm text-accent">Could not load their orders: {orderError.message}</p>
      ) : (
        <>
          {unpaid.length > 0 ? (
            <OrderTable
              heading="Outstanding"
              count={unpaid.length}
              rows={unpaid}
              trailHref={`/customers/${id}`}
              accent
            />
          ) : null}
          <OrderTable
            heading={unpaid.length ? "Everything else" : "Orders"}
            count={rest.length}
            rows={rest}
            trailHref={`/customers/${id}`}
          />
        </>
      )}

      <CustomerActions
        id={id}
        orgId={customer.org_id as string}
        name={customerLabel(customer)}
        email={(customer.email as string) ?? null}
        orderCount={withMoney.length}
        today={todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone())}
        defaultLocationId={session.activeLocation?.id ?? null}
        takenBy={session.membership.display_name ?? session.email}
        canWrite={canWrite}
      />
    </div>
  );
}

function OrderTable({
  heading,
  count,
  rows,
  trailHref,
  accent = false,
}: {
  heading: string;
  count: number;
  rows: {
    id: string; number: string; kind: string; status: SpecialOrderStatus | null;
    title: string | null; event_date: string | null;
    totals: { total: number; balance: number };
  }[];
  trailHref: string;
  accent?: boolean;
}) {
  return (
    <section className="space-y-2">
      <SectionHeading count={count}>{heading}</SectionHeading>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing here.</p>
      ) : (
        <table className="w-full max-w-[60rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="w-24 px-3 py-2 text-left">Number</th>
              <th className="w-32 px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">What</th>
              <th className="w-28 px-3 py-2 text-left">Status</th>
              <th className="w-28 px-3 py-2 text-right">Total</th>
              <th className="w-28 px-3 py-2 text-right">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2 tabular-nums">
                  <Link
                    href={withFrom(`/special-orders/${o.id}`, { href: trailHref, label: "Customer" })}
                    className="hover:underline"
                  >
                    {o.number}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">{o.event_date ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{o.title ?? "—"}</td>
                <td className="px-3 py-2 text-muted">
                  {o.kind === "order" ? (o.status ? STATUS_LABEL[o.status] : "—") : KIND_LABEL[o.kind as never]}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(o.totals.total)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${accent ? "text-accent" : "text-faint"}`}>
                  {o.totals.balance > 0 ? money(o.totals.balance) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
