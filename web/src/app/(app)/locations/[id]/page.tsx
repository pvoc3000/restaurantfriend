import type { RawSearchParams } from "@/lib/itemFilters";
import { LocationDetail } from "./LocationDetail";

// The body lives in LocationDetail; this page is its shell, like the other
// detail screens.
//
// KEYED BY THE RECORD, and it has to be: walking the book from /locations/A to
// /locations/B is a soft navigation within the SAME dynamic segment, so React
// keeps every component instance and a `useState(props)` initialiser — which
// runs once per mount — never sees the new location. That is the bug Mark hit
// on the old /location screen when switching the working location (2026-07-30):
// the Active switch still read `aria-checked="true"` beside a label that
// already said "Inactive", and the hours and production mapping were the
// previous record's, while everything stateless updated correctly — a partial
// refresh, which is the hardest kind to spot.
//
// Key the whole body rather than the offending children: it costs the same and
// no future stateful child can quietly inherit the last record's data.
export default async function LocationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <LocationDetail key={id} id={id} rawParams={rawParams} />;
}
