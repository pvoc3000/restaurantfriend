import type { RawSearchParams } from "@/lib/itemFilters";
import { VendorItemDetail } from "./VendorItemDetail";

// The body lives in VendorItemDetail; this page is its shell. Detail views
// are full-screen pages (Mark, 2026-07-30) — no interception, no panel slot.
export default async function VendorItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <VendorItemDetail id={id} rawParams={rawParams} />;
}
