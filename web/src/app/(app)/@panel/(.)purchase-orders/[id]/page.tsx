import type { RawSearchParams } from "@/lib/itemFilters";
import { DetailPanel } from "@/components/DetailPanel";
import { PurchaseOrderDetailView } from "../../../purchase-orders/[id]/PurchaseOrderDetailView";

// In-app navigation to a PO intercepts here: the same detail body, floated
// over the page you were on. Refresh or share the URL → the dedicated page.
export default async function PurchaseOrderPanel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return (
    <DetailPanel>
      <PurchaseOrderDetailView id={id} rawParams={rawParams} inPanel />
    </DetailPanel>
  );
}
