import type { RawSearchParams } from "@/lib/filterMenus";
import { CustomerInvoiceDetail } from "./CustomerInvoiceDetail";

export default async function CustomerInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen.
  return <CustomerInvoiceDetail key={id} id={id} rawParams={rawParams} />;
}
