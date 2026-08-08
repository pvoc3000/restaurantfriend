import { PlanDetail } from "./PlanDetail";

// The body lives in PlanDetail; this page is its shell.
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <PlanDetail id={id} rawParams={rawParams} />;
}
