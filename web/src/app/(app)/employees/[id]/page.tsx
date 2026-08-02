import type { RawSearchParams } from "@/lib/itemFilters";
import { EmployeeDetail } from "./EmployeeDetail";

// The body lives in EmployeeDetail; this page is its shell, like every other
// detail screen.
//
// KEYED BY THE RECORD. Walking the book from /employees/A to /employees/B is a
// soft navigation within the SAME dynamic segment, so React keeps every
// component instance and a `useState(props)` initialiser — which runs once per
// mount — never sees the new person. That produces a PARTIAL refresh, the
// hardest kind to spot: the name and dates update while a picker still holds
// the previous record's value.
export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <EmployeeDetail key={id} id={id} rawParams={rawParams} />;
}
