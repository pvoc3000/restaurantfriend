import type { RawSearchParams } from "@/lib/filterMenus";
import { CreditMemoDetail } from "./CreditMemoDetail";

export default async function CreditMemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen.
  return <CreditMemoDetail key={id} id={id} rawParams={rawParams} />;
}
