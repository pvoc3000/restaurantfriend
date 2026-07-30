import { PageLoading } from "@/components/ui/PageLoading";

// Without this, the LIST's loading.tsx one segment up covers the wait and says
// "Loading the vendor list…" while you're actually opening one vendor.
export default function Loading() {
  return <PageLoading label="this vendor" />;
}
