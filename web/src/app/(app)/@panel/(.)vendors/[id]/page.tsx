import type { RawSearchParams } from "@/lib/itemFilters";
import { DetailPanel } from "@/components/DetailPanel";
import { VendorDetail } from "../../../vendors/[id]/VendorDetail";

// In-app navigation to a vendor intercepts here: the same detail body, floated
// over the page you were on. Refresh or share the URL → the dedicated page.
export default async function VendorPanel({
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
      <VendorDetail id={id} rawParams={rawParams} inPanel />
    </DetailPanel>
  );
}
