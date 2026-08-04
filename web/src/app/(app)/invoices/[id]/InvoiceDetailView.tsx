import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canApprovePayment, canWriteCatalog } from "@/lib/roles";
import type { RawSearchParams } from "@/lib/itemFilters";
import { crumbPath, currentQuery, parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import {
  fetchDuplicateCandidates,
  fetchInvoiceDocuments,
  fetchInvoiceWithLines,
  fetchLinkedOrders,
} from "@/lib/invoiceQueries";
import { InvoiceDetail } from "@/components/purchasing/InvoiceDetail";

/** The invoice detail's whole body — every query lives here. */
export async function InvoiceDetailView({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const trail = parseTrail(rawParams, { href: "/invoices", label: "Invoices" });
  const session = await getAppSession();
  const supabase = await createClient();

  const { invoice, lines, error, lineError } = await fetchInvoiceWithLines(
    supabase,
    id
  );

  if (error) {
    return <p className="text-sm text-accent">Could not load invoice: {error}</p>;
  }
  if (!invoice) notFound();

  const locationCode =
    session.locations.find((l) => l.id === invoice.location_id)?.code ?? "—";

  // Three more, overlapped where they can be. The linked orders depend on the
  // lines, so that one genuinely has to wait.
  const documentsPromise = fetchInvoiceDocuments(supabase, id).then((r) => r);
  const candidatesPromise = fetchDuplicateCandidates(supabase, {
    orgId: invoice.org_id,
    vendorId: invoice.vendor_id,
  }).then((r) => r);
  const { orders: linkedOrders, error: linkError } = await fetchLinkedOrders(
    supabase,
    lines
  );
  const { attachments, error: documentError } = await documentsPromise;
  const duplicateCandidates = await candidatesPromise;

  // Every active vendor, for the vendor picker — an invoice filed against the
  // wrong vendor is a likely mistake on a hand-created one, and the PO links
  // are per-line so changing it disturbs nothing.
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("org_id", invoice.org_id)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-16">
      <Breadcrumbs
        trail={trail}
        current={invoice.invoice_number ?? "No number"}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {lineError ? (
        <p className="text-sm text-accent">
          Could not load this invoice&rsquo;s lines: {lineError}
        </p>
      ) : (
        <InvoiceDetail
          invoice={invoice}
          lines={lines}
          linkedOrders={linkedOrders}
          linkError={linkError}
          attachments={attachments}
          // Said out loud rather than swallowed: an empty document pane would
          // read as "nothing filed yet" instead of "this isn't wired up here".
          documentError={documentError}
          duplicateCandidates={duplicateCandidates}
          locationCode={locationCode}
          orgId={invoice.org_id}
          vendors={(vendors ?? []) as { id: string; name: string }[]}
          locations={session.activeLocations.map((l) => ({
            id: l.id,
            code: l.code,
            name: l.name,
          }))}
          canEdit={canWriteCatalog(session.membership.role)}
          canApprove={canApprovePayment(session.membership.role)}
          // Built here because only the server has rawParams — without
          // currentQuery a stamped crumb is a bare href and the trail that led
          // here is lost.
          selfHref={`/invoices/${id}${currentQuery(rawParams)}`}
          closeHref={crumbPath(trail[trail.length - 1]) ?? "/invoices"}
        />
      )}
    </div>
  );
}
