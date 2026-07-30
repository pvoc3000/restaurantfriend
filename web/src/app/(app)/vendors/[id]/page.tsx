import type { RawSearchParams } from "@/lib/itemFilters";
import { VendorDetail } from "./VendorDetail";

// The body lives in VendorDetail; this page is its shell. Detail views are
// full-screen pages (Mark, 2026-07-30) — no interception, no panel slot.
export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <VendorDetail id={id} rawParams={rawParams} />;
}
