import { PageLoading } from "@/components/ui/PageLoading";

// Without this, the LIST's loading.tsx one segment up covers the wait and says
// "Loading purchase orders…" while you're actually opening one order.
export default function Loading() {
  return <PageLoading label="this purchase order" />;
}
