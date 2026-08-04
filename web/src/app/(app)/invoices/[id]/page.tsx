import type { RawSearchParams } from "@/lib/itemFilters";
import { InvoiceDetailView } from "./InvoiceDetailView";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen: /invoices/A →
  // /invoices/B is a soft navigation within one dynamic segment, so a client
  // child seeding useState from props would show A's data beside B's text.
  return <InvoiceDetailView key={id} id={id} rawParams={rawParams} />;
}
