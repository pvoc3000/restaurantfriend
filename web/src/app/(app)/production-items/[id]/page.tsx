import { ProductionItemDetail } from "./ProductionItemDetail";

// The body lives in ProductionItemDetail; this page is its shell.
export default async function ProductionItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <ProductionItemDetail id={id} rawParams={rawParams} />;
}
