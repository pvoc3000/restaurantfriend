import type { RawSearchParams } from "@/lib/itemFilters";
import { ReceivingView } from "./ReceivingView";

/**
 * Receiving a delivery against its invoice — its own route, reached from PO
 * detail and (later) from a list of orders awaiting receiving.
 *
 * A route rather than a mode on the PO detail table, which is what this
 * replaces. See components/purchasing/Receiving.tsx for why.
 */
export default async function ReceivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <ReceivingView id={id} rawParams={rawParams} />;
}
