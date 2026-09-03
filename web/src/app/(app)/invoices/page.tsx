import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canApprovePayment, canWriteCatalog } from "@/lib/roles";
import type { RawSearchParams } from "@/lib/itemFilters";
import {
  parseInvoiceFilters,
  parseInvoiceView,
  rangeStart,
  INVOICE_VIEW_COOKIE,
} from "@/lib/invoiceFilters";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { InvoiceStatus } from "@/lib/invoices";
import { InvoiceList } from "@/components/purchasing/InvoiceList";

export type InvoiceListRow = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total: number | null;
  tax: number | null;
  freight: number | null;
  is_credit: boolean;
  status: InvoiceStatus;
  vendors: { id: string; name: string } | null;
  line_count: number;
  /** The purchase orders this invoice's lines point at — derived, never a
   *  column, so it cannot claim an order none of its lines touch. */
  purchase_orders: { id: string; po_number: string; order_date: string | null }[];
  document_count: number;
  /** Whether a QuickBooks document is linked. Only the presence matters here —
   *  086's reasoning, applied one level down: a list has no use for the id. */
  qbo_linked: boolean;
  /** 088's cache: what QuickBooks last said was owed, and when. Never one
   *  without the other. */
  qbo_balance: number | null;
  qbo_checked_at: string | null;
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // How you left the list last time, read on the server so the first paint is
  // already filtered — same session cookie as the PO list, same reasoning.
  const remembered = parseInvoiceView(
    (await cookies()).get(INVOICE_VIEW_COOKIE)?.value
  );
  const filters = parseInvoiceFilters(await searchParams, remembered);
  const session = await getAppSession();
  const supabase = await createClient();

  if (!session.activeLocation) {
    return (
      <p className="text-sm text-muted">Pick a location to see its invoices.</p>
    );
  }

  // The org's calendar day, not the host's — the aging buckets are computed
  // from it, and a UTC server would start calling this afternoon's bills
  // overdue at 5pm Pacific (see lib/today, migration 007).
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);

  const start = rangeStart(filters.range, timeZone);
  const locationId = session.activeLocation.id;

  // THE SELECT LIST IS WRITTEN OUT AT EACH CALL SITE, not passed in. A helper
  // taking `columns: string` reads better and breaks the types: supabase-js
  // parses the list at the TYPE level, so a `string` parameter collapses every
  // row to `GenericStringError` — which is what happened when this was written
  // that way (2026-09-02), and is the same trap `CONNECTION_COLUMNS` fell into.
  let query = supabase
    .from("vendor_invoices")
    .select(
      `id, invoice_number, invoice_date, due_date, total, tax, freight,
       is_credit, status, external_ref, qbo_balance, qbo_checked_at,
       vendors ( id, name )`
    )
    .eq("location_id", locationId)
    .order("invoice_date", { ascending: false })
    .limit(500);
  if (start) query = query.gte("invoice_date", start);

  let { data: invoices, error } = await query;

  // 088's two columns arrive after this code. Selecting a column that does not
  // exist yet 400s the WHOLE query, which would take the invoice list down
  // rather than costing it one chip — so on that ONE failure it asks again
  // without them. Bills then read Submitted where they would read Paid, which
  // is the honest answer when nothing has been cached.
  //
  // Narrow on purpose: only a missing column is retried, and every other
  // failure is still reported rather than swallowed.
  if (error && /qbo_balance|qbo_checked_at/.test(error.message)) {
    let retry = supabase
      .from("vendor_invoices")
      .select(
        `id, invoice_number, invoice_date, due_date, total, tax, freight,
         is_credit, status, external_ref, vendors ( id, name )`
      )
      .eq("location_id", locationId)
      .order("invoice_date", { ascending: false })
      .limit(500);
    if (start) retry = retry.gte("invoice_date", start);
    const fallback = await retry;
    invoices = fallback.data as unknown as typeof invoices;
    error = fallback.error;
  }

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load invoices: {error.message}
      </p>
    );
  }

  const ids = (invoices ?? []).map((i) => i.id);

  // Line counts and the PO link, in one bulk pass rather than per invoice.
  // Paginated for the same reason the PO list's totals pass is: PostgREST caps
  // a page at 1000.
  const counts = new Map<string, number>();
  const poIdsByInvoice = new Map<string, Set<string>>();
  for (let from = 0; ids.length > 0; from += 1000) {
    const { data: lines, error: lineError } = await supabase
      .from("vendor_invoice_lines")
      .select("invoice_id, purchase_order_id")
      .in("invoice_id", ids)
      .range(from, from + 999);

    if (lineError) {
      return (
        <p className="text-sm text-accent">
          Could not load invoice lines: {lineError.message}
        </p>
      );
    }
    for (const line of lines ?? []) {
      counts.set(line.invoice_id, (counts.get(line.invoice_id) ?? 0) + 1);
      if (line.purchase_order_id) {
        const set = poIdsByInvoice.get(line.invoice_id) ?? new Set<string>();
        set.add(line.purchase_order_id);
        poIdsByInvoice.set(line.invoice_id, set);
      }
    }
    if (!lines || lines.length < 1000) break;
  }

  // One more pass so the PO column prints numbers rather than uuids.
  const poNumbers = new Map<string, { po_number: string; order_date: string | null }>();
  const allPoIds = [...new Set([...poIdsByInvoice.values()].flatMap((s) => [...s]))];
  if (allPoIds.length > 0) {
    const { data: orders } = await supabase
      .from("purchase_orders")
      .select("id, po_number, order_date")
      .in("id", allPoIds);
    for (const o of orders ?? []) poNumbers.set(o.id, o);
  }

  // And the documents, exactly as the PO list counts its Files column.
  const documentCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: files } = await supabase
      .from("purchase_order_attachments")
      .select("invoice_id")
      .in("invoice_id", ids);
    for (const f of files ?? []) {
      if (!f.invoice_id) continue;
      documentCounts.set(f.invoice_id, (documentCounts.get(f.invoice_id) ?? 0) + 1);
    }
  }

  const rows: InvoiceListRow[] = (invoices ?? []).map((i) => ({
    ...(i as unknown as Omit<
      InvoiceListRow,
      "line_count" | "purchase_orders" | "document_count" | "qbo_linked"
    >),
    // The PRESENCE of a link, never the id — a list has no use for it, and
    // sending an id to the browser is what 086 exists to stop.
    qbo_linked: Boolean(
      (i as unknown as { external_ref?: { qbo?: { id?: string } } }).external_ref?.qbo?.id
    ),
    line_count: counts.get(i.id) ?? 0,
    purchase_orders: [...(poIdsByInvoice.get(i.id) ?? [])]
      .map((id) => ({
        id,
        po_number: poNumbers.get(id)?.po_number ?? "",
        order_date: poNumbers.get(id)?.order_date ?? null,
      }))
      .filter((p) => p.po_number)
      .sort((a, b) => a.po_number.localeCompare(b.po_number)),
    document_count: documentCounts.get(i.id) ?? 0,
  }));

  // Every active vendor, order_type 'none' included — the landlord and the
  // plumber are precisely why this screen can create an invoice at all.
  // NO ACTIVE FILTER (Mark, 2026-08-15): a retired vendor is listed under
  // `PickList`'s own Inactive heading rather than being unfindable. A bill
  // from a vendor you have stopped ordering from still arrives.
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, is_active")
    .eq("org_id", session.membership.org_id)
    .order("name");

  return (
    <InvoiceList
      invoices={rows}
      initialFilters={filters}
      activeLocationCode={session.activeLocation.code}
      today={today}
      capped={rows.length === 500}
      orgId={session.membership.org_id}
      locationId={session.activeLocation.id}
      vendors={(vendors ?? []).map((v) => ({
        id: v.id as string,
        name: v.name as string,
        inactive: v.is_active === false,
      }))}
      canEdit={canWriteCatalog(session.membership.role)}
      canApprove={canApprovePayment(session.membership.role)}
    />
  );
}
