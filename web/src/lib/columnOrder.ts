"use client";

// Where a list's columns sit (Mark, 2026-08-01: "allow the user to drag columns
// to whatever position they want them in").
//
// A per-user DISPLAY preference, so localStorage and `useSyncExternalStore` —
// the same rule and the same mechanism as column widths and visibility, stored
// beside them under `${storageKey}.order`. Every DataTable gets it by having a
// storageKey rather than by opting in, exactly like the Columns menu.
//
// MOVABLE = labelled and not pinned — the same set the Columns menu offers, on
// the same reasoning: `pinned` marks the column that IS the row (the item's
// name, the PO number), and control columns (select-all, the ⋯ menu) have no
// label to grab. Those keep their DECLARED slots — Active stays first (Mark,
// 2026-07-23), the ⋯ stays at the right edge — and the movable columns permute
// around them.
//
// Stored as the full ordered key list of the movable columns at the time of the
// drag. Reconciliation handles the app changing underneath it: a stored key
// whose column is gone drops out, and a column added next month is inserted at
// its DECLARED position among the movable set — where the code put it — instead
// of being shoved to the end for anyone who ever dragged.

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

// ---------------------------------------------------------------------------
// Pure logic — fixture-tested (scripts/fixtures/columnOrder.fixtures.ts).
// ---------------------------------------------------------------------------

export type OrderableColumn = { key: string; label: string; pinned?: boolean };

export function isMovableColumn(column: OrderableColumn): boolean {
  return column.label !== "" && !column.pinned;
}

/**
 * The declared columns in the user's order. Pinned and control columns hold
 * their declared indexes; the movable ones fill the remaining slots in stored
 * order, with unknown-to-the-store columns inserted at their declared position.
 */
export function applyColumnOrder<C extends OrderableColumn>(
  columns: C[],
  stored: readonly string[]
): C[] {
  if (stored.length === 0) return columns;
  const movable = columns.filter(isMovableColumn);
  const byKey = new Map(movable.map((c) => [c.key, c]));

  const orderedKeys = stored.filter((k) => byKey.has(k));
  movable.forEach((c, declaredIndex) => {
    if (!orderedKeys.includes(c.key)) {
      orderedKeys.splice(Math.min(declaredIndex, orderedKeys.length), 0, c.key);
    }
  });

  let next = 0;
  return columns.map((c) => (isMovableColumn(c) ? byKey.get(orderedKeys[next++])! : c));
}

/** Where a drag would land: before a movable column, or after one (the end). */
export type ColumnDropTarget = { before: string } | { after: string };

/**
 * The movable key list with `dragKey` moved next to the anchor. Operates on the
 * FULL movable order — hidden and compact-dropped columns included — so a drop
 * "at the end of what I can see" still lands before any trailing hidden
 * columns' stored positions are disturbed. An unknown anchor is a no-op.
 */
export function movedColumnOrder(
  orderedMovableKeys: readonly string[],
  dragKey: string,
  target: ColumnDropTarget
): string[] {
  const without = orderedMovableKeys.filter((k) => k !== dragKey);
  const anchor = "before" in target ? target.before : target.after;
  const at = without.indexOf(anchor);
  if (at === -1) return [...orderedMovableKeys];
  without.splice("before" in target ? at : at + 1, 0, dragKey);
  return without;
}

// ---------------------------------------------------------------------------
// The store — columnVisibility's shape with an ordered array instead of a Set.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

// Referentially stable snapshots — a new array per read would re-render forever.
const cache = new Map<string, { raw: string | null; parsed: string[] }>();
const EMPTY: string[] = [];

function key(storageKey: string) {
  return `${storageKey}.order`;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function announce() {
  for (const listener of listeners) listener();
}

function read(storageKey: string): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key(storageKey));
  } catch {
    return EMPTY; // Private mode — declared order rather than a crash.
  }
  const hit = cache.get(storageKey);
  if (hit && hit.raw === raw) return hit.parsed;

  let parsed = EMPTY;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (Array.isArray(value)) {
        parsed = value.filter((v): v is string => typeof v === "string");
      }
    } catch {
      parsed = EMPTY; // Corrupt entry — ignore rather than break the list.
    }
  }
  cache.set(storageKey, { raw, parsed });
  return parsed;
}

function write(storageKey: string, order: readonly string[]) {
  try {
    if (order.length === 0) window.localStorage.removeItem(key(storageKey));
    else window.localStorage.setItem(key(storageKey), JSON.stringify(order));
  } catch {
    // Not being able to persist shouldn't stop dragging working this session.
  }
  announce();
}

/** A table's stored column order, and the two ways to change it. */
export function useColumnOrder(storageKey: string) {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => EMPTY // The server has no localStorage: declared order, then the
    // stored one arrives at hydration. Same contract as column widths.
  );

  const setOrder = useCallback(
    (keys: readonly string[]) => write(storageKey, keys),
    [storageKey]
  );

  const resetOrder = useCallback(() => write(storageKey, EMPTY), [storageKey]);

  return { stored, setOrder, resetOrder, customized: stored.length > 0 };
}

// ---------------------------------------------------------------------------
// The drag itself.
// ---------------------------------------------------------------------------

/** What a header cell is, in visual order — built by DataTable per render. */
export type ColumnDragSlot = { key: string; movable: boolean };

export type ColumnDragging = {
  key: string;
  label: string;
  touch: boolean;
  /** Pointer position at activation — the chip's first paint. */
  x: number;
  y: number;
  /** The drop line's vertical run: the table's on-screen extent. */
  tableTop: number;
  tableHeight: number;
};

/**
 * Drag a column header sideways to move the column. Pointer events, never the
 * HTML5 drag API — iPad Safari is the ordering stopgap and native DnD is poor
 * there, and the resize grips already speak pointer events.
 *
 * Three gestures share a header cell and a threshold keeps them apart: the
 * grip's own pointerdown never reaches this (ColumnHeader excludes it), a press
 * that travels < 6px horizontally is a CLICK and sorts as it always did, and a
 * vertical move is a scroll (the header is `touch-pan-y`, so the browser takes
 * vertical pans and cancels the pointer — horizontal ones come to us).
 *
 * React state changes exactly twice per drag — activation and release — because
 * a per-move setState would re-render every row under the header, and Inventory
 * has 790 of them. The per-move values (chip position, drop line) are written
 * straight to the overlay nodes through refs, the same no-state trick as the
 * receiving screen's measured height.
 *
 * Everything is measured ONCE at pointer-down: nothing reorders live during the
 * drag, so the column boundaries can't move under it.
 */
export function useColumnDrag({
  headRowRef,
  onDrop,
}: {
  headRowRef: RefObject<HTMLTableRowElement | null>;
  onDrop: (dragKey: string, target: ColumnDropTarget) => void;
}) {
  const [dragging, setDragging] = useState<ColumnDragging | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);

  function startColumnDrag(
    event: ReactPointerEvent,
    column: { key: string; label: string },
    visible: ColumnDragSlot[]
  ) {
    if (!event.isPrimary || event.button !== 0) return;
    const row = headRowRef.current;
    if (!row) return;

    // Visual-order geometry of the movable headers. The <th>s index-align with
    // `visible` — DataTable renders one per visible column.
    const ths = Array.from(row.querySelectorAll("th"));
    const slots: { key: string; left: number; mid: number; right: number }[] = [];
    visible.forEach((v, i) => {
      const th = ths[i];
      if (!v.movable || !th) return;
      const r = th.getBoundingClientRect();
      slots.push({ key: v.key, left: r.left, mid: r.left + r.width / 2, right: r.right });
    });
    const from = slots.findIndex((s) => s.key === column.key);
    if (from === -1 || slots.length < 2) return;

    const table = row.closest("table");
    const tableRect = table?.getBoundingClientRect();
    const tableTop = Math.max(tableRect?.top ?? 0, 0);
    const tableHeight =
      Math.max(Math.min(tableRect?.bottom ?? window.innerHeight, window.innerHeight) - tableTop, 0);

    const startX = event.clientX;
    const startY = event.clientY;
    const touch = event.pointerType === "touch";

    let active = false;
    let currentTarget: ColumnDropTarget | null = null;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

    const resolve = (x: number) => {
      const last = slots[slots.length - 1];
      let target: ColumnDropTarget = { after: last.key };
      let indicatorX = last.right;
      for (const s of slots) {
        if (x < s.mid) {
          target = { before: s.key };
          indicatorX = s.left;
          break;
        }
      }
      // Dropping a column back where it already sits changes nothing — the
      // line hides to say so.
      const noop =
        "before" in target
          ? target.before === column.key || slots[from + 1]?.key === target.before
          : from === slots.length - 1;
      return { target, indicatorX, noop };
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      setDragging(null);
    };

    const onMove = (e: PointerEvent) => {
      if (!active) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // Vertical intent first: that's a scroll (touch) or a sloppy click, and
        // committing to a drag now would fight it.
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          cleanup();
          return;
        }
        if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return;
        active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setDragging({
          key: column.key,
          label: column.label,
          touch,
          x: e.clientX,
          y: e.clientY,
          tableTop,
          tableHeight,
        });
      }

      const r = resolve(e.clientX);
      currentTarget = r.noop ? null : r.target;

      // The overlay mounts on the render the activation setDragging triggers,
      // so these refs can be null for the first move or two — the next move
      // catches up. Styles written directly: no re-render per move.
      const line = indicatorRef.current;
      if (line) {
        line.style.display = r.noop ? "none" : "";
        line.style.left = `${r.indicatorX - 1}px`;
      }
      const chip = chipRef.current;
      if (chip) {
        chip.style.left = `${e.clientX}px`;
        chip.style.top = `${e.clientY}px`;
      }
    };

    const onUp = () => {
      const wasActive = active;
      const target = currentTarget;
      cleanup();
      if (!wasActive) return;
      // The pointerup is about to mint a click on whatever the press started on
      // — the sort button. One capture-phase squelch eats it; the timeout
      // covers the pointerups that produce no click at all.
      const squelch = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
      };
      window.addEventListener("click", squelch, true);
      setTimeout(() => window.removeEventListener("click", squelch, true), 0);
      if (target) onDrop(column.key, target);
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return { dragging, startColumnDrag, indicatorRef, chipRef };
}
