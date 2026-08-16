"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * Drag a ROW up or down to reorder it — the third member of this app's drag
 * family, after `useColumnDrag` (a header sideways) and `useSlotDrag` (an item
 * from one plan cell to another).
 *
 * A SIBLING RATHER THAN A WIDENING of `useColumnDrag`, which is the precedent
 * `planSlotDrag` set: that hook is what every list in the app depends on, and it
 * is column-shaped all the way down — it takes a header row, reads `<th>`s, and
 * index-aligns them against a slot list the table builds per render. Teaching it
 * an axis would complicate the one drag nothing can afford to break, for one
 * caller. So the skeleton is copied and every property it paid for is kept:
 * pointer events rather than the HTML5 drag API, geometry measured ONCE at
 * pointer-down, exactly two React state changes per drag with the per-move
 * values written straight to the overlay nodes, and a capture-phase click
 * squelch on release.
 *
 * Three things differ from the column version, each for a stated reason:
 *
 *   * THE THRESHOLD IS VERTICAL-DOMINANT. `useColumnDrag` abandons on a vertical
 *     move because that is a scroll; here vertical IS the gesture, so there is
 *     nothing to abandon to and the test is simply that the movement is downish
 *     or upish and has travelled 6px.
 *
 *   * THE HANDLE MUST BE `touch-none`, NOT `touch-pan-y`. A column header can
 *     hand vertical pans back to the browser because its drag is horizontal.
 *     Here the drag direction and the page-scroll direction are the same one, so
 *     the handle has to take it — which is exactly why a caller wants a small
 *     dedicated grip rather than making the whole row draggable. `touch-none`
 *     across a full-width row would stop an iPad scrolling over the table at
 *     all, and the row usually holds live controls besides. Same argument
 *     `PlanMatrix` makes for using only the item name as its handle.
 *
 *   * THE DROP LINE IS HORIZONTAL, and runs the table's on-screen width.
 *
 * The target contract is one data attribute: any element inside `bodyRef`
 * carrying `data-row-id` is a row. A row that must never be a drop target — a
 * totals row — simply doesn't carry one.
 */

/**
 * Where a drag would land, and the splice that carries it out.
 *
 * BOTH ARE `columnOrder`'s, re-exported rather than re-derived.
 * `movedColumnOrder` is a pure list splice over string keys with a
 * `{before}|{after}` target and an unknown-anchor no-op — it is generic in
 * everything but its name, and it is already pinned by 13 fixture cases. Copying
 * six lines to avoid an odd-looking import is exactly the second-implementation
 * drift this app keeps paying for; the alias is what makes it read right at a
 * row's call site. (Renaming them at source is the tidier end state, and is
 * worth doing the day a third caller appears.)
 */
export {
  movedColumnOrder as moveInOrder,
  type ColumnDropTarget as DropTarget,
} from "./columnOrder";

import { type ColumnDropTarget as DropTarget } from "./columnOrder";

// ---------------------------------------------------------------------------
// Pure logic — fixture-tested (scripts/fixtures/rowDrag.fixtures.ts).
// ---------------------------------------------------------------------------

/**
 * The minimal `{ id, sort }` writes that make `order` the stored order.
 *
 * TWO RULES, and a rewrite is likely to get either of them backwards.
 *
 * IT RENUMBERS THE WHOLE LIST 1..n, not just the row that moved. Every reader of
 * a nullable sort column in this app treats null as LAST (`?? MAX_SAFE_INTEGER`
 * — see `ProductionItemDetail`), and the migrated data is null everywhere, so
 * writing a single row's sort does not put it where you dropped it: it puts it
 * FIRST, ahead of every null, and leaves the rest in whatever order the
 * secondary key gives. Neither order, and nothing on screen to explain it. That
 * is the same trap `ItemComponents` documents for its insert path.
 *
 * IT EMITS ONLY THE ROWS WHOSE SORT ACTUALLY CHANGES. Once a list is fully
 * numbered, dragging one row of seven moves two or three of them and the rest
 * must not be written — a no-op update is a round trip, an `updated_at` bump and
 * a row in the audit of a change nobody made. Which also means dropping a row
 * back where it started writes nothing at all.
 *
 * Numbering runs from 1 rather than in tens. Gaps exist to be typed into by
 * hand, which is what `AddRecipeRow`'s last-plus-ten is for; a list that is
 * reordered by dragging is renumbered wholesale every time, so a gap would never
 * be used and would only make the stored numbers harder to read.
 */
export function renumber(
  order: readonly string[],
  current: ReadonlyMap<string, number | null>
): { id: string; sort: number }[] {
  const writes: { id: string; sort: number }[] = [];
  order.forEach((id, i) => {
    const sort = i + 1;
    if (current.get(id) !== sort) writes.push({ id, sort });
  });
  return writes;
}

// ---------------------------------------------------------------------------
// The drag itself.
// ---------------------------------------------------------------------------

export type RowDragging = {
  id: string;
  label: string;
  touch: boolean;
  /** Pointer position at activation — the chip's first paint. */
  x: number;
  y: number;
  /** The drop line's horizontal run: the table's on-screen extent. */
  tableLeft: number;
  tableWidth: number;
};

export function useRowDrag({
  bodyRef,
  onDrop,
}: {
  bodyRef: RefObject<HTMLElement | null>;
  onDrop: (dragId: string, target: DropTarget) => void;
}) {
  const [dragging, setDragging] = useState<RowDragging | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);

  function startRowDrag(event: ReactPointerEvent, row: { id: string; label: string }) {
    if (!event.isPrimary || event.button !== 0) return;
    const body = bodyRef.current;
    if (!body) return;

    // Visual-order geometry of every row that declares itself a target. Read
    // once: nothing reflows during the drag, so the boundaries cannot move
    // under it.
    const slots: { id: string; top: number; mid: number; bottom: number }[] = [];
    body.querySelectorAll<HTMLElement>("[data-row-id]").forEach((el) => {
      const id = el.dataset.rowId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      slots.push({ id, top: r.top, mid: r.top + r.height / 2, bottom: r.bottom });
    });
    const from = slots.findIndex((s) => s.id === row.id);
    if (from === -1 || slots.length < 2) return;

    const table = body.closest("table") ?? body;
    const tableRect = table.getBoundingClientRect();
    const tableLeft = Math.max(tableRect.left, 0);
    const tableWidth = Math.max(Math.min(tableRect.right, window.innerWidth) - tableLeft, 0);

    const startX = event.clientX;
    const startY = event.clientY;
    const touch = event.pointerType === "touch";

    let active = false;
    let currentTarget: DropTarget | null = null;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

    const resolve = (y: number) => {
      const last = slots[slots.length - 1];
      let target: DropTarget = { after: last.id };
      let indicatorY = last.bottom;
      for (const s of slots) {
        if (y < s.mid) {
          target = { before: s.id };
          indicatorY = s.top;
          break;
        }
      }
      // Dropping a row back where it already sits changes nothing — the line
      // hides to say so, rather than promising a move that won't happen.
      const noop =
        "before" in target
          ? target.before === row.id || slots[from + 1]?.id === target.before
          : from === slots.length - 1;
      return { target, indicatorY, noop };
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
        if (Math.abs(dy) < 6 || Math.abs(dy) <= Math.abs(dx)) return;
        active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        setDragging({
          id: row.id,
          label: row.label,
          touch,
          x: e.clientX,
          y: e.clientY,
          tableLeft,
          tableWidth,
        });
      }

      const r = resolve(e.clientY);
      currentTarget = r.noop ? null : r.target;

      // The overlay mounts on the render the activation setDragging triggers,
      // so these refs can be null for the first move or two — the next move
      // catches up. Styles written directly: no re-render per move.
      const line = indicatorRef.current;
      if (line) {
        line.style.display = r.noop ? "none" : "";
        line.style.top = `${r.indicatorY - 1}px`;
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
      // The pointerup is about to mint a click on whatever the press started on.
      // One capture-phase squelch eats it; the timeout covers the pointerups
      // that produce no click at all.
      const squelch = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
      };
      window.addEventListener("click", squelch, true);
      setTimeout(() => window.removeEventListener("click", squelch, true), 0);
      if (target) onDrop(row.id, target);
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  return { dragging, startRowDrag, indicatorRef, chipRef };
}
