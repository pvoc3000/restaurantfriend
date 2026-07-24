import type { RawSearchParams } from "@/lib/itemFilters";
import { VendorDetail } from "./VendorDetail";

// The body lives in VendorDetail, shared with the app-wide slide-over panel
// (@panel's intercepting route). This page is the hard-load / deep-link form.
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
