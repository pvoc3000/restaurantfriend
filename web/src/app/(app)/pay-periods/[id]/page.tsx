import type { RawSearchParams } from "@/lib/itemFilters";
import { PayPeriodDetail } from "./PayPeriodDetail";

// The body lives in PayPeriodDetail; this page is its shell, like every other
// detail screen.
//
// KEYED BY THE RECORD. Walking the book from /pay-periods/A to /pay-periods/B
// is a soft navigation within the SAME dynamic segment, so React keeps every
// component instance and a `useState(props)` initialiser never sees the new
// period — the reopen dialog would hold the previous record's reason.
export default async function PayPeriodDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <PayPeriodDetail key={id} id={id} rawParams={rawParams} />;
}
