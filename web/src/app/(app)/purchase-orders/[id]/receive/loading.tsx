import { PageLoading } from "@/components/ui/PageLoading";

// Its own, on the leaf segment: without it the `[id]` segment's loading.tsx
// covers this wait and announces the wrong thing ("Loading this purchase
// order…" while you're opening receiving).
export default function Loading() {
  return <PageLoading label="this delivery" />;
}
