import type { RawSearchParams } from "@/lib/filterMenus";
import { SpecialOrderDetail } from "./SpecialOrderDetail";

export default async function SpecialOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen: /special-orders/A
  // → /special-orders/B is a soft navigation within one dynamic segment, so a
  // client child seeding useState from props would show A's data beside B's.
  return <SpecialOrderDetail key={id} id={id} rawParams={rawParams} />;
}
