import { ElementDetail } from "./ElementDetail";

// The body lives in ElementDetail; this page is its shell.
export default async function ElementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <ElementDetail id={id} rawParams={rawParams} />;
}
