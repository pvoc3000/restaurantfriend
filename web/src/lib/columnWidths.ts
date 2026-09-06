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

  /** Several columns in ONE write — a resize moves two (see `resizeWeights`),
   *  and two writes would notify every table twice for one gesture. */
  const setWidths = useCallback(
    (patch: ColumnWidths) => {
      // A value back at its default is NOT stored — it would make `customized`
      // true and the "Reset column widths" footer appear on a table that is
      // exactly as declared, which a double-click reset would otherwise do.
      const next = { ...readSnapshot(storageKey) };
      for (const [k, v] of Object.entries(patch)) {
        const rounded = Math.round(v);
        if (rounded === defaults[k]) delete next[k];
        else next[k] = rounded;
      }
      write(storageKey, next);
    },
    [storageKey, defaults]
  );

  const reset = useCallback(() => write(storageKey, {}), [storageKey]);

  const customized = Object.keys(stored).length > 0;

  return { widths, setWidth, setWidths, reset, customized };
}

export const MIN_COLUMN_WIDTH = 48;

/**
 * THE RESIZE RULE: the column you drag changes by what you dragged, and ONE
 * other column pays for it (Mark, 2026-09-05: "when I resize a column, every
 * other column resizes as well, making it difficult to get right … I don't
 * like it"). Option 1 of the three he was offered — last-column-absorbs, with
 * a pairwise fallback — chosen because it fixes the feel without giving up
 * anything the fluid layout bought: the SUM of the weights never changes, so
 * the table is still exactly as wide as its pane, the labels still stick, and
 * nothing scrolls sideways.
 *
 * Widths are WEIGHTS, and the caller converts the drag's pixels into weight
 * units before calling this (`startResize` measures the table). In weight
 * units the rule is arithmetic:
 *
 *   - `column` moves by `delta`, floored at `min`;
 *   - the PAYER is the LAST column in `order` that isn't `column` — the
 *     rightmost one, NSTableView's default and Finder's list view — and it
 *     moves the other way by the same amount;
 *   - if the payer is at its floor the remainder is taken from the next column
 *     leftwards, and so on (dragging the last column therefore borrows from
 *     its left neighbour, which is the pairwise case);
 *   - a SHRINK hands all of the slack to the payer alone — there is no floor
 *     on growing;
 *   - if nobody can pay, the drag is capped at what could be paid for.
 *
 * Returns ONLY the weights that changed, or null when nothing can move — a
 * caller writes exactly those, so untouched columns keep their stored value
 * (or none). Pure, so `scripts/fixtures` pins every clause above.
 */
export function resizeWeights(
  weights: ColumnWidths,
  order: readonly string[],
  column: string,
  delta: number,
  /** The floor, overall or PER COLUMN — a weekday picker's All/None needs
   *  300 and a drag elsewhere must not crush it to 48 on its way past. */
  minimum: number | ((key: string) => number) = MIN_COLUMN_WIDTH
): ColumnWidths | null {
  const minFor = typeof minimum === "function" ? minimum : () => minimum;
  if (!order.includes(column) || delta === 0) return null;
  const min = minFor(column);
  const start = weights[column] ?? min;
  // What the dragged column actually moves, once its own floor is applied.
  const wanted = Math.max(min, start + delta) - start;
  if (wanted === 0) return null;

  const payers = order.filter((k) => k !== column).reverse();
  if (payers.length === 0) return null;
  const out: ColumnWidths = {};

  if (wanted < 0) {
    // Shrinking: the slack goes to the last column, all of it.
    out[column] = start + wanted;
    out[payers[0]] = (weights[payers[0]] ?? minFor(payers[0])) - wanted;
    return out;
  }

  // Growing: take from the last column, then the one before it, each down to
  // its floor, until the drag is paid for or nobody is left.
  let paid = 0;
  for (const payer of payers) {
    const floor = minFor(payer);
    const have = weights[payer] ?? floor;
    const spare = Math.max(0, have - floor);
    if (spare <= 0) continue;
    const take = Math.min(spare, wanted - paid);
    out[payer] = have - take;
    paid += take;
    if (paid >= wanted) break;
  }
  if (paid === 0) return null;
  out[column] = start + paid;
  return out;
}

/**
 * Everything a resizable table header needs: persisted widths plus the
 * pointer-drag that changes them. Shared by every list screen so the drag
 * behaviour (and its Safari fixes) can't drift between them.
 *
 * `defaults` must be a stable module-level constant.
 */
export function useResizableColumns(storageKey: string, defaults: ColumnWidths) {
  const { widths, setWidth, setWidths, reset, customized } = useColumnWidths(
    storageKey,
    defaults
  );

  // Live widths during a drag, committed to storage on pointer-up so we're not
  // writing localStorage on every mouse move.
  const [dragWidths, setDragWidths] = useState<ColumnWidths | null>(null);
  const effective = dragWidths ?? widths;

  /**
   * `order` is the VISIBLE columns, left to right — the rule needs to know
   * which column is last and which are on screen to pay. The drag is 1:1 in
   * PIXELS: the table is measured off the grip's own `<table>` so a weight is
   * converted at the rate the browser is actually rendering it. Without that,
   * a weight of 100 in a 1400-weight table on a 977px pane would move 0.7px
   * per pixel of mouse, which is the old "not quite following the mouse" feel.
   */
  function startResize(
    event: React.PointerEvent,
    column: string,
    order: readonly string[],
    minFor?: (key: string) => number
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const base = { ...effective };
    const table = (event.currentTarget as Element).closest("table");
    const sum = order.reduce((n, k) => n + (base[k] ?? MIN_COLUMN_WIDTH), 0);
    const pxPerWeight = table && sum > 0 ? table.getBoundingClientRect().width / sum : 1;
    const widthsAt = (clientX: number) => {
      const patch = resizeWeights(base, order, column, (clientX - startX) / pxPerWeight, minFor);
      return patch ? { ...base, ...patch } : base;
    };

    // Hold the resize cursor and kill text selection for the whole page while
    // dragging — otherwise the cursor flickers back to a caret the moment the
    // pointer leaves the grip, which reads as the drag having stopped.
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e: PointerEvent) => {
      setDragWidths(widthsAt(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      setDragWidths(null);
      const patch = resizeWeights(base, order, column, (e.clientX - startX) / pxPerWeight, minFor);
      if (patch) setWidths(patch);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /**
   * Double-click on a grip: this column back to its declared weight, with the
   * difference going to the payer — the same rule as a drag, so a reset moves
   * two columns and not the whole row. A bare "set it back" would change the
   * sum and re-divide every other column, which is the thing being retired.
   */
  function resetColumn(
    column: string,
    order: readonly string[],
    defaultWidth: number,
    minFor?: (key: string) => number
  ) {
    const current = effective[column] ?? defaultWidth;
    const patch = resizeWeights(effective, order, column, defaultWidth - current, minFor);
    if (patch) setWidths(patch);
  }

  const totalWidth = (columns: { key: string; width: number }[]) =>
    columns.reduce((sum, c) => sum + (effective[c.key] ?? c.width), 0);

  return { widths: effective, startResize, resetColumn, setWidth, reset, customized, totalWidth };
}
