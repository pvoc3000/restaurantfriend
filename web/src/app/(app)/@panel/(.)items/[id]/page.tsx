import type { RawSearchParams } from "@/lib/itemFilters";
import { DetailPanel } from "@/components/DetailPanel";
import { ItemDetail } from "../../../items/[id]/ItemDetail";

// In-app navigation to an item intercepts here: the same detail body, floated
// over the page you were on. Refresh or share the URL → the dedicated page.
export default async function ItemPanel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return (
    <DetailPanel typeLabel="Inventory">
      <ItemDetail id={id} rawParams={rawParams} inPanel />
    </DetailPanel>
  );
}
