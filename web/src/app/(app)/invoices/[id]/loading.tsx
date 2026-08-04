import { PageLoading } from "@/components/ui/PageLoading";

// Its own, not the list's: without one, /invoices/loading.tsx covers this wait
// and announces the wrong thing ("Loading invoices…" while one invoice opens).
export default function Loading() {
  return <PageLoading label="the invoice" />;
}
