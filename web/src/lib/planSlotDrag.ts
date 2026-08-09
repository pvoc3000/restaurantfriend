"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export type SlotDragSource = {
  rowId: string;
  itemId: string;
  name: string;
  par: number | null;
  trayId: string;
  weekday: number;
};

export type SlotDropTarget = { trayId: string; weekday: number };

export type SlotDragging = {
  name: string;
  /** Pointer position at activation — the chip's first paint. */
  x: number;
  y: number;
};

/** The zone under the pointer, and the one beside it, both painted directly. */
const ZONE_BASE =
  "pointer-events-none fixed z-[65] flex items-center justify-center border-2 text-[10px] font-semibold uppercase tracking-[0.08em]";
const ZONE_ACTIVE = `${ZONE_BASE} border-ink bg-mark-fill text-ink`;
const ZONE_IDLE = `${ZONE_BASE} border-dashed border-hairline bg-white/80 text-subtle`;

/**
 * Drag an item from one slot of the plan matrix to another.
 *
 * THE DESTINATION OFFERS TWO DROP ZONES — Move on the left of the cell, Copy on
 * the right (Mark's idea, 2026-08-08). Both outcomes are on screen and labelled,
 * so there is no invisible rule to know, and — the reason it earns its
 * complexity — COPY BECOMES REACHABLE ON TOUCH, which a modifier key never was.
 * Option still forces a copy for anyone with the muscle memory, and when it is
 * held BOTH zones relabel to "Copy" so the screen never says one thing and does
 * another.
 *
 * The par always travels with the item; whether the destination's own default
 * would be better is offered AFTER the drop, where it can be seen and reversed,
 * rather than encoded in which half of a cell you managed to hit.
 *
 * Pointer events, never the HTML5 drag API — `useColumnDrag`'s reasoning, and
 * for the same reason: iPad Safari's native DnD is poor, and everything else in
 * this app that drags (the resize grips, the column reorder) already speaks
 * pointer events.
 *
 * The gesture shares a cell with several controls that must keep working — the
 * par's `InlineValue`, its two steppers, the ✕ — so only the item NAME is a
 * handle, and a press that travels under 6px never becomes a drag at all.
 *
 * React state changes exactly twice per drag, at activation and release. The
 * per-move values — the chip's position and label, both zones' geometry and
 * appearance — are written straight to the overlay nodes through refs, because a
 * per-move setState would re-render every tray on the plan.
 *
 * Every cell is measured ONCE at pointer-down: nothing in the matrix reflows
 * during a drag, so the targets cannot move under it.
 */
export function useSlotDrag({
  tableRef,
  onDrop,
}: {
  tableRef: RefObject<HTMLTableElement | null>;
  onDrop: (source: SlotDragSource, target: SlotDropTarget, copy: boolean) => void;
}) {
  const [dragging, setDragging] = useState<SlotDragging | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const moveZoneRef = useRef<HTMLDivElement | null>(null);
  const copyZoneRef = useRef<HTMLDivElement | null>(null);

  function startSlotDrag(event: ReactPointerEvent, source: SlotDragSource) {
    if (!event.isPrimary || event.button !== 0) return;
    const table = tableRef.current;
    if (!table) return;

    const cells = Array.from(table.querySelectorAll<HTMLElement>("[data-tray-id]")).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        trayId: el.dataset.trayId as string,
        weekday: Number(el.dataset.weekday),
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      };
    });
    if (cells.length < 2) return;

    const startX = event.clientX;
    const startY = event.clientY;

    let active = false;
    let target: SlotDropTarget | null = null;
    let wantsCopy = false;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

    const at = (x: number, y: number) =>
      cells.find(
        (c) => x >= c.left && x <= c.left + c.width && y >= c.top && y <= c.top + c.height
      ) ?? null;

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      setDragging(null);
    };

    // The chip and the zones say which gesture is armed, and they have to keep
    // saying it when the pointer is still and only the key changes — pressing
    // Option without moving fires no pointermove at all.
    const paint = (x: number, y: number, alt: boolean) => {
      const cell = at(x, y);
      const isSelf = !!cell && cell.trayId === source.trayId && cell.weekday === source.weekday;
      const live = cell && !isSelf ? cell : null;

      // Its own cell is never a target: a move there changes nothing, and a copy
      // there is the unique key's own refusal.
      const half = live ? live.width / 2 : 0;
      const inCopyHalf = live ? x >= live.left + half : false;
      wantsCopy = alt || inCopyHalf;
      target = live ? { trayId: live.trayId, weekday: live.weekday } : null;

      const chip = chipRef.current;
      if (chip) {
        chip.style.left = `${x}px`;
        chip.style.top = `${y}px`;
        chip.textContent = wantsCopy ? `Copy ${source.name}` : source.name;
      }

      const place = (
        node: HTMLDivElement | null,
        offset: number,
        label: string,
        isActive: boolean
      ) => {
        if (!node) return;
        if (!live) {
          node.style.display = "none";
          return;
        }
        node.style.display = "";
        node.style.left = `${live.left + offset}px`;
        node.style.top = `${live.top}px`;
        node.style.width = `${half}px`;
        node.style.height = `${live.height}px`;
        node.textContent = label;
        node.className = isActive ? ZONE_ACTIVE : ZONE_IDLE;
      };

      // With Option down BOTH halves are Copy, so wherever you let go the label
      // you were looking at is what happens.
      place(moveZoneRef.current, 0, alt ? "Copy" : "Move", !inCopyHalf);
      place(copyZoneRef.current, half, "Copy", inCopyHalf);
    };

    let lastX = startX;
    let lastY = startY;

    const onMove = (e: PointerEvent) => {
      if (!active) {
        if (Math.abs(e.clientX - startX) < 6 && Math.abs(e.clientY - startY) < 6) return;
        active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setDragging({ name: source.name, x: e.clientX, y: e.clientY });
      }
      lastX = e.clientX;
      lastY = e.clientY;
      // The overlay mounts on the render activation triggers, so the refs can be
      // null for the first move or two — the next move catches up.
      paint(e.clientX, e.clientY, e.altKey);
    };

    const onKey = (e: KeyboardEvent) => {
      if (active) paint(lastX, lastY, e.altKey);
    };

    const onUp = (e: PointerEvent) => {
      const wasActive = active;
      const to = target;
      // Recompute from the RELEASE, so a key let go — or a last-instant slide
      // into the other half — is what counts.
      if (wasActive) paint(e.clientX, e.clientY, e.altKey);
      const copy = wantsCopy;
      const settled = target ?? to;
      cleanup();
      if (!wasActive || !settled) return;
      // The pointerup is about to mint a click on whatever the press started on.
      // One capture-phase squelch eats it; the timeout covers the pointerups
      // that produce no click at all.
      const squelch = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
      };
      window.addEventListener("click", squelch, true);
      setTimeout(() => window.removeEventListener("click", squelch, true), 0);
      onDrop(source, settled, copy);
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
  }

  return { dragging, startSlotDrag, chipRef, moveZoneRef, copyZoneRef };
}
