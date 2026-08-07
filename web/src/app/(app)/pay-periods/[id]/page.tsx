import { redirect } from "next/navigation";

// The other half of the shim beside this folder's page. `/pay-periods/[id]` was
// the pay-period RECORD until 2026-08-06; what was on it is now the "Export
// timesheets…" panel on the Timesheets screen, so the honest destination is that
// screen scoped to this period.
//
// Note the id is NOT validated first. A period that no longer exists lands on
// Timesheets, whose own picker falls back to the newest period with shifts —
// which is a better answer than a 404 telling you a fortnight is missing, and it
// saves a query on every follow of an old bookmark.
export default async function LegacyPayPeriodPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/timesheets?period=${id}`);
}
