/**
 * The provisional sales figure, shared between two siblings.
 *
 * The Sales page reads today's figure live from Square; the runner needs it at
 * Send so the email can quote what the supervisor was looking at. The two are
 * SIBLINGS under a server component that builds each page as a ReactNode, so
 * no prop and no callback can reach between them — which is exactly the
 * situation `lib/shiftFocus` exists for, and this is that module's shape.
 *
 * A module value plus `useSyncExternalStore`, deliberately not React context:
 * context would mean wrapping the server-rendered pages in a client provider
 * and turning them all into client components.
 *
 * It is NOT persisted and must not be: a provisional figure is true for about
 * an hour, and a stale one quoted in tomorrow's email would be worse than none.
 */
export type ProvisionalSales = {
  reportId: string;
  netCents: number | null;
  tipsCents: number | null;
  /** False once Square has closed the day and the sync has stored it. */
  provisional: boolean;
};

let current: ProvisionalSales | null = null;
const listeners = new Set<() => void>();

export function publishSales(next: ProvisionalSales): void {
  current = next;
  for (const l of listeners) l();
}

export function clearSales(): void {
  current = null;
  for (const l of listeners) l();
}

export function subscribeSales(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server snapshot is null: there is nothing to know before the browser
 *  has asked Square, and returning anything else would hydrate a lie. */
export function salesSnapshot(): ProvisionalSales | null {
  return current;
}

export function serverSalesSnapshot(): ProvisionalSales | null {
  return null;
}
