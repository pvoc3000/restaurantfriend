/**
 * The batch the batch log's pane is showing — a one-value store, `lib/shiftFocus`'
 * shape.
 *
 * The Actions menu (in the crumb row on the tablet) and the pane
 * (`BatchLogItems`) are SIBLINGS under a server component, and only the pane
 * knows which batch is selected. Delete Batch… moved from the tablet footer into
 * that menu (Mark, 2026-09-12), so the pane publishes its selection here and the
 * menu reads it.
 */

export type SelectedBatch = {
  id: string;
  elementName: string;
  batchNumber: string;
  hasYield: boolean;
  photoPath: string | null;
};

let current: SelectedBatch | null = null;
const listeners = new Set<() => void>();

export function setSelectedBatch(next: SelectedBatch | null): void {
  if (
    current === next ||
    (current &&
      next &&
      current.id === next.id &&
      current.hasYield === next.hasYield &&
      current.photoPath === next.photoPath &&
      current.elementName === next.elementName &&
      current.batchNumber === next.batchNumber)
  ) {
    return;
  }
  current = next;
  for (const l of listeners) l();
}

export function subscribeSelectedBatch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readSelectedBatch(): SelectedBatch | null {
  return current;
}

export function serverSelectedBatch(): null {
  return null;
}
