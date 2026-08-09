import { BatchLogDetail } from "./BatchLogDetail";

// The body lives in BatchLogDetail; this page is its shell.
export default async function BatchLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <BatchLogDetail id={id} rawParams={rawParams} />;
}
