import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
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
  purchase_orders: { id: string; po_number: string }[];
  document_count: number;
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

  let query = supabase
    .from("vendor_invoices")
    .select(
      `id, invoice_number, invoice_date, due_date, total, tax, freight,
       is_credit, status, vendors ( id, name )`
    )
    .eq("location_id", session.activeLocation.id)
    .order("invoice_date", { ascending: false })
    .limit(500);

  const start = rangeStart(filters.range, timeZone);
  if (start) query = query.gte("invoice_date", start);

  const { data: invoices, error } = await query;

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
  const poNumbers = new Map<string, string>();
  const allPoIds = [...new Set([...poIdsByInvoice.values()].flatMap((s) => [...s]))];
  if (allPoIds.length > 0) {
    const { data: orders } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .in("id", allPoIds);
    for (const o of orders ?? []) poNumbers.set(o.id, o.po_number);
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
      "line_count" | "purchase_orders" | "document_count"
    >),
    line_count: counts.get(i.id) ?? 0,
    purchase_orders: [...(poIdsByInvoice.get(i.id) ?? [])]
      .map((id) => ({ id, po_number: poNumbers.get(id) ?? "" }))
      .filter((p) => p.po_number)
      .sort((a, b) => a.po_number.localeCompare(b.po_number)),
    document_count: documentCounts.get(i.id) ?? 0,
  }));

  // Every active vendor, order_type 'none' included — the landlord and the
  // plumber are precisely why this screen can create an invoice at all.
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("org_id", session.membership.org_id)
    .eq("is_active", true)
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
      vendors={(vendors ?? []) as { id: string; name: string }[]}
      canEdit={canWriteCatalog(session.membership.role)}
    />
  );
}
