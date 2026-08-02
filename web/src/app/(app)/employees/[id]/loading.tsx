import { PageLoading } from "@/components/ui/PageLoading";

// Without this, the LIST's loading.tsx one segment up covers the wait and says
// "Loading the employee list…" while you're actually opening one person.
export default function Loading() {
  return <PageLoading label="this employee" />;
}
