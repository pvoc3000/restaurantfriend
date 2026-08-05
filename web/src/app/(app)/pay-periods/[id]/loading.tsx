import { PageLoading } from "@/components/ui/PageLoading";

// Its OWN loading.tsx, not the list's — without one the list's covers the wait
// and announces the wrong thing ("Loading the pay periods…" while one opens).
export default function Loading() {
  return <PageLoading label="the pay period" />;
}
