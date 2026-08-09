import { BatchDetail } from "./BatchDetail";

// The body lives in BatchDetail; this page is its shell.
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <BatchDetail id={id} rawParams={rawParams} />;
}
