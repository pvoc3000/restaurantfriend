"use client";

// Persisted table column widths. These are a per-user display preference, not
// part of the view being shared, so they live in localStorage rather than the
// URL (filters and sort are in the URL — see lib/itemFilters.ts).
//
// Read through useSyncExternalStore rather than an effect: the server has no
// localStorage, so the server snapshot is "no overrides" and React swaps in the
// stored widths after hydration without a mismatch — and without a setState in
// an effect, which the lint config rejects.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

export type ColumnWidths = Record<string, number>;

const listeners = new Set<() => void>();

// getSnapshot must return a referentially stable value or React re-renders
// forever, so the parsed object is cached until the raw string changes.
const cache = new Map<string, { raw: string | null; parsed: ColumnWidths }>();

const EMPTY: ColumnWidths = {};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab writing the same key should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSnapshot(storageKey: string): ColumnWidths {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    // Private mode / storage disabled — fall back to defaults.
    return EMPTY;
  }
  const hit = cache.get(storageKey);
  if (hit && hit.raw === raw) return hit.parsed;

  let parsed: ColumnWidths = EMPTY;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object") {
        parsed = Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0)
            .map(([k, v]) => [k, v as number])
        );
      }
    } catch {
      parsed = EMPTY; // Corrupt entry — ignore it rather than crash the screen.
    }
  }
  cache.set(storageKey, { raw, parsed });
  return parsed;
}

function write(storageKey: string, widths: ColumnWidths) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Not being able to persist shouldn't break resizing in this session.
  }
  for (const listener of listeners) listener();
}

/**
 * `defaults` must be a stable reference (a module-level constant) — it's part
 * of the memo key for the merged result.
 */
export function useColumnWidths(storageKey: string, defaults: ColumnWidths) {
  const stored = useSyncExternalStore(
    subscribe,
    useCallback(() => readSnapshot(storageKey), [storageKey]),
    () => EMPTY
  );

  const widths = useMemo(() => ({ ...defaults, ...stored }), [defaults, stored]);

  const setWidth = useCallback(
    (column: string, px: number) => {
      write(storageKey, { ...readSnapshot(storageKey), [column]: Math.round(px) });
    },
    [storageKey]
  );

  const reset = useCallback(() => write(storageKey, {}), [storageKey]);

  const customized = Object.keys(stored).length > 0;

  return { widths, setWidth, reset, customized };
}

export const MIN_COLUMN_WIDTH = 48;

/**
 * Everything a resizable table header needs: persisted widths plus the
 * pointer-drag that changes them. Shared by every list screen so the drag
 * behaviour (and its Safari fixes) can't drift between them.
 *
 * `defaults` must be a stable module-level constant.
 */
export function useResizableColumns(storageKey: string, defaults: ColumnWidths) {
  const { widths, setWidth, reset, customized } = useColumnWidths(storageKey, defaults);

  // Live widths during a drag, committed to storage on pointer-up so we're not
  // writing localStorage on every mouse move.
  const [dragWidths, setDragWidths] = useState<ColumnWidths | null>(null);
  const effective = dragWidths ?? widths;

  function startResize(event: React.PointerEvent, column: string) {
    event.preventDefault();
    const startX = event.clientX;
    const base = { ...effective };
    const startWidth = base[column] ?? MIN_COLUMN_WIDTH;
    const widthAt = (clientX: number) =>
      Math.max(MIN_COLUMN_WIDTH, startWidth + clientX - startX);

    // Hold the resize cursor and kill text selection for the whole page while
    // dragging — otherwise the cursor flickers back to a caret the moment the
    // pointer leaves the grip, which reads as the drag having stopped.
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e: PointerEvent) => {
      setDragWidths({ ...base, [column]: widthAt(e.clientX) });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      setDragWidths(null);
      setWidth(column, widthAt(e.clientX));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const totalWidth = (columns: { key: string; width: number }[]) =>
    columns.reduce((sum, c) => sum + (effective[c.key] ?? c.width), 0);

  return { widths: effective, startResize, setWidth, reset, customized, totalWidth };
}
