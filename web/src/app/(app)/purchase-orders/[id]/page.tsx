import type { RawSearchParams } from "@/lib/itemFilters";
import { PurchaseOrderDetailView } from "./PurchaseOrderDetailView";

// The body lives in PurchaseOrderDetailView; this page is its shell. Detail
// views are full-screen pages (Mark, 2026-07-30) — no interception, no panel
// slot.
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
