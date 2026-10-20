"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { DropTarget } from "./moveInOrder";
import { tileDropTarget, type TileRect, type WidgetKind } from "./startLayout";

/**
 * Drag a WIDGET to a new place on the start page's grid (2026-10-20) — the
 * fourth member of the drag family, after `useColumnDrag`, `useSlotDrag` and
 * `useRowDrag`, and a sibling of the row version for the reason that one gives:
 * each is shaped by its axis, and widening one would complicate a drag other
 * screens depend on. Every property the family paid for is kept — pointer
 * events rather than the HTML5 drag API (poor on iPad Safari), geometry
 * measured ONCE at pointer-down, two React state changes per drag with the
 * per-move values written straight to the overlay nodes, and a capture-phase
 * click squelch on release.
 *
 * What differs is the axis: tiles flow left to right and wrap, so the hit test
 * is two-dimensional (`tileDropTarget`, pure and fixture-tested) and the drop
 * line is VERTICAL, beside the tile it lands next to. The threshold is any 6px
 * of travel. The handle is a small `touch-none` grip, as `rowDrag` argues: a
 * whole tile taking touch would stop an iPad scrolling the page.
 *
 * The target contract is one data attribute: an element inside `gridRef`
 * carrying `data-tile` is a tile.
 */
export type TileDragging = {
  kind: WidgetKind;
  label: string;
  touch: boolean;
  x: number;
  y: number;
};

export function useTileDrag({
  gridRef,
  onDrop,
}: {
  gridRef: RefObject<HTMLElement | null>;
  onDrop: (kind: WidgetKind, target: DropTarget) => void;
}) {
  const [dragging, setDragging] = useState<TileDragging | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);

  function startTileDrag(event: ReactPointerEvent, tile: { kind: WidgetKind; label: string }) {
    if (!event.isPrimary || event.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;

    const rects: TileRect[] = [];
    grid.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => {
      const r = el.getBoundingClientRect();
      rects.push({ kind: el.dataset.tile as WidgetKind, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
    if (rects.length < 2) return;
    const byKind = new Map(rects.map((r) => [r.kind as string, r]));
    const order = rects.map((r) => r.kind as string);
    const from = order.indexOf(tile.kind);

    const startX = event.clientX;
    const startY = event.clientY;
    const touch = event.pointerType === "touch";
    let active = false;
    let currentTarget: DropTarget | null = null;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

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
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
        active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setDragging({ kind: tile.kind, label: tile.label, touch, x: e.clientX, y: e.clientY });
      }

      const target = tileDropTarget(rects, e.clientX, e.clientY, tile.kind);
      // Dropping a tile back where it already sits changes nothing — the line
      // hides to say so, rather than promising a move that won't happen.
      const noop =
        target === null ||
        ("before" in target ? order[from + 1] === target.before : order[from - 1] === target.after);
      currentTarget = noop ? null : target;

      const line = indicatorRef.current;
      if (line) {
        const anchor = target && byKind.get("before" in target ? target.before : target.after);
        line.style.display = noop || !anchor ? "none" : "";
        if (anchor && target) {
          // Half a gutter (12px of `gap-6`) outside the tile's edge.
          const x = "before" in target ? anchor.left - 12 : anchor.right + 12;
          line.style.left = `${x - 1}px`;
          line.style.top = `${anchor.top}px`;
          line.style.height = `${anchor.bottom - anchor.top}px`;
        }
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
      const squelch = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
      };
      window.addEventListener("click", squelch, true);
      setTimeout(() => window.removeEventListener("click", squelch, true), 0);
      if (target) onDrop(tile.kind, target);
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return { dragging, startTileDrag, indicatorRef, chipRef };
}
