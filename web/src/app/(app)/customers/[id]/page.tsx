import type { RawSearchParams } from "@/lib/filterMenus";
import { CustomerDetail } from "./CustomerDetail";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  // Keyed by the record's id, like every other detail screen.
  return <CustomerDetail key={id} id={id} rawParams={rawParams} />;
}
