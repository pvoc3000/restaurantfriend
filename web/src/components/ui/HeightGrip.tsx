"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * A field the reader can make TALLER, and never wider (Mark, 2026-11-23, on a
 * maintenance request's description: "add a resize drag handle … it should
 * only be able to be dragged downward, not wider").
 *
 * WHY NOT THE BROWSER'S `resize: vertical`: an inline note rests as a BUTTON
 * and edits as a textarea laid over a hidden sizer (`InlineValue`'s rule that
 * a cell is the same size before and after you click it). The native handle
 * exists only on the textarea, only while editing, and resizing it grows the
 * textarea out of its box and over whatever is below. So the height lives one
 * level up, as a `min-height` both states wear, and the grip is our own.
 *
 * The height is a DISPLAY PREFERENCE (conventions: "display preferences in
 * localStorage"), kept per field — `storageKey` names the field, not the
 * record — so a description dragged tall stays tall on the next request.
 * Double-click the grip to put it back.
 */
// One in-memory copy over localStorage, so a drag re-renders from memory
// (every pointer move) and every field sharing a key moves together.
const heights = new Map<string, number | null>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readHeight(key: string): number | null {
  if (heights.has(key)) return heights.get(key) ?? null;
  let n: number | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) n = parsed;
  } catch {
    /* storage unavailable — the field starts at its natural height */
  }
  heights.set(key, n);
  return n;
}

function writeHeight(key: string, next: number | null) {
  heights.set(key, next);
  try {
    if (next === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(next)));
  } catch {
    /* nothing to do */
  }
  for (const l of listeners) l();
}

export function useFieldHeight(
  storageKey: string | null,
): [number | null, (h: number | null) => void] {
  const height = useSyncExternalStore(
    subscribe,
    () => (storageKey ? readHeight(storageKey) : null),
    // The server has no localStorage: natural height, then the stored one
    // arrives at hydration — column widths' contract.
    () => null,
  );
  const set = useCallback(
    (next: number | null) => {
      if (storageKey) writeHeight(storageKey, next);
    },
    [storageKey],
  );
  return [height, set];
}

/**
 * The grip itself: three diagonal strokes in the field's bottom-right corner,
 * the Mac's own resize mark. Place it inside a `relative` box whose height is
 * what `onHeight` sets. Dragging up only ever returns the field towards its
 * natural height — a `min-height` cannot cut the text off.
 */
export function HeightGrip({
  target,
  onHeight,
  label = "Drag to make taller",
}: {
  /** The box being resized — its current height is where a drag starts. */
  target: React.RefObject<HTMLElement | null>;
  onHeight: (height: number | null) => void;
  label?: string;
}) {
  const start = useRef<{ y: number; h: number } | null>(null);

  return (
    <span
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={`${label} · double-click to reset`}
      // `touch-none` so a finger drag on an iPad resizes instead of scrolling.
      className="absolute bottom-0 right-0 z-10 flex h-4 w-4 cursor-ns-resize touch-none items-end justify-end text-subtle hover:text-ink"
      // PREVENTED, so pressing the grip neither clicks the resting button
      // open nor blurs (and so saves and closes) an open editor.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const box = target.current;
        if (!box) return;
        start.current = { y: e.clientY, h: box.getBoundingClientRect().height };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onHeight(Math.max(0, start.current.h + (e.clientY - start.current.y)));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onHeight(null);
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="mb-[2px] mr-[2px]">
        <path d="M9 1 L1 9 M9 4.5 L4.5 9 M9 8 L8 9" stroke="currentColor" strokeWidth="1.1" fill="none" />
      </svg>
    </span>
  );
}
