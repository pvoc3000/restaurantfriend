import { PageLoading } from "@/components/ui/PageLoading";

// Without this, the LIST's loading.tsx one segment up covers the wait and says
// "Loading inventory…" while you're actually opening one item.
export default function Loading() {
  return <PageLoading label="this item" />;
}
