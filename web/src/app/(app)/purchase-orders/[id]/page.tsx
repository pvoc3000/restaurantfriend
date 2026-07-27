import type { RawSearchParams } from "@/lib/itemFilters";
import { PurchaseOrderDetailView } from "./PurchaseOrderDetailView";

// The body lives in PurchaseOrderDetailView, shared with the app-wide
// slide-over panel (@panel's intercepting route). This page is the
// hard-load / deep-link form.
export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <PurchaseOrderDetailView id={id} rawParams={rawParams} />;
}
