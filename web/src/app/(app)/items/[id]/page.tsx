import type { RawSearchParams } from "@/lib/itemFilters";
import { ItemDetail } from "./ItemDetail";

// The body lives in ItemDetail, shared with the app-wide slide-over panel
// (@panel's intercepting route). This page is the hard-load / deep-link form.
export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <ItemDetail id={id} rawParams={rawParams} />;
}
