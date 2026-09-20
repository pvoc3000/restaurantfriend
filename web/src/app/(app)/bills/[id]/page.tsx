import type { RawSearchParams } from "@/lib/itemFilters";
import { BillDetailView } from "./BillDetailView";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen: /bills/A →
  // /bills/B is a soft navigation within one dynamic segment, so a client
  // child seeding useState from props would show A's data beside B's text.
  return <BillDetailView key={id} id={id} rawParams={rawParams} />;
}
