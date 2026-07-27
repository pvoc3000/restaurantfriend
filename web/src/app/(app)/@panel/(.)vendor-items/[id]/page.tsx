import type { RawSearchParams } from "@/lib/itemFilters";
import { DetailPanel } from "@/components/DetailPanel";
import { VendorItemDetail } from "../../../vendor-items/[id]/VendorItemDetail";

// In-app navigation to a vendor item intercepts here: the same detail body,
// floated over the page you were on. Refresh or share → the dedicated page.
export default async function VendorItemPanel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return (
    <DetailPanel typeLabel="Vendor Item">
      <VendorItemDetail id={id} rawParams={rawParams} inPanel />
    </DetailPanel>
  );
}
