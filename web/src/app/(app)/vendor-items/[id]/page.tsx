import type { RawSearchParams } from "@/lib/itemFilters";
import { VendorItemDetail } from "./VendorItemDetail";

// The body lives in VendorItemDetail, shared with the app-wide slide-over panel
// (@panel's intercepting route). This page is the hard-load / deep-link form.
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
