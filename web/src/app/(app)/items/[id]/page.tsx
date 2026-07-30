import type { RawSearchParams } from "@/lib/itemFilters";
import { ItemDetail } from "./ItemDetail";

// The body lives in ItemDetail; this page is its shell. Detail views are
// full-screen pages (Mark, 2026-07-30) — no interception, no panel slot.
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
