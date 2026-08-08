import { RecipeDetail } from "./RecipeDetail";

// The body lives in RecipeDetail; this page is its shell.
export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <RecipeDetail id={id} rawParams={rawParams} />;
}
