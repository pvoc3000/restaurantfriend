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
 * totals row — simply doesn't carry one. `rowAttribute` names another one, for
 * a `DataTable`, whose rows already carry `data-row-key` (the recipe's
 * ingredient lines, 2026-11-03).
 */

/**
 * Where a drag would land, and the splice that carries it out — `lib/moveInOrder`,
 * shared with `columnOrder` and the start page's `tileDrag` (it began as
 * `columnOrder`'s `movedColumnOrder` and moved to its own module when that third
 * caller appeared, 2026-10-20). Re-exported so this hook's callers keep one import.
 */
export { moveInOrder, type DropTarget } from "./moveInOrder";

import { type DropTarget } from "./moveInOrder";

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
 * hand, which is what the recipe add dialogs' last-plus-ten is for; a list that is
 * reordered by dragging is renumbered wholesale every time, so a gap would never
 * be used and would only make the stored numbers harder to read.
 *
 * EXCEPT where something else writes the list in tens: a recipe's ingredient
 * lines, whose add dialog writes last-plus-ten (FileMaker's habit), so a drag
 * there numbers in `step` 10 and the two writers agree (2026-11-03).
 */
export function renumber(
  order: readonly string[],
  current: ReadonlyMap<string, number | null>,
  step = 1
): { id: string; sort: number }[] {
  const writes: { id: string; sort: number }[] = [];
  order.forEach((id, i) => {
    const sort = (i + 1) * step;
    if (current.get(id) !== sort) writes.push({ id, sort });
  });
  return writes;
}

/**
 * How far to scroll this frame while a dragged row is held near an EDGE of
 * the box it scrolls in — negative up, positive down, 0 away from both.
 *
 * Added 2026-11-03 so a recipe's ingredient lines could lose their typed Sort
 * column (Mark: "Auto-scroll, drop Sort"): without it a line could only be
 * dropped somewhere already on screen, and a long recipe's top and bottom are
 * never on screen together. The speed ramps across the zone and is full at or
 * past the edge, the way a Finder window scrolls under a drag. A box too short
 * for two whole zones gets a quarter of its height each, so the middle still
 * holds still.
 */
export function edgeScrollStep(
  y: number,
  top: number,
  bottom: number,
  zone = 48,
  max = 18
): number {
  const z = bottom - top < zone * 2 ? (bottom - top) / 4 : zone;
  if (z <= 0) return 0;
  if (y < top + z) return -Math.ceil(max * Math.min(1, (top + z - y) / z));
  if (y > bottom - z) return Math.ceil(max * Math.min(1, (y - (bottom - z)) / z));
  return 0;
}

/**
 * The nearest ancestor that actually scrolls vertically — null for the window.
 *
 * MORE THAN A SCROLLBAR'S WORTH OF OVERFLOW, not merely some (2026-11-10). A
 * table's `overflow-x-auto` wrapper computes `overflow-y: auto` too (CSS turns
 * a `visible` beside a non-visible into `auto`), and when it shows a horizontal
 * scrollbar its `clientHeight` loses the bar's ~15px while `scrollHeight` does
 * not — so it passed for a vertical scroller and the drag scrolled IT, a few
 * pixels and then nothing, while the page that needed to move stood still.
 * That was a special order's lines on a narrow window.
 */
const SCROLLBAR_ALLOWANCE = 20;
function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight - n.clientHeight > SCROLLBAR_ALLOWANCE) {
      return n;
    }
  }
  return null;
}

/** Marks a band pinned over the bottom of the window (`ui/StickyFooter`), so
 *  a drag's bottom edge is the band's top rather than the window's floor. */
export const STICKY_FOOTER_ATTRIBUTE = "data-rf-sticky-footer";

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
  rowAttribute = "data-row-id",
}: {
  bodyRef: RefObject<HTMLElement | null>;
  onDrop: (dragId: string, target: DropTarget) => void;
  rowAttribute?: string;
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
    body.querySelectorAll<HTMLElement>(`[${rowAttribute}]`).forEach((el) => {
      const id = el.getAttribute(rowAttribute);
      if (!id) return;
      const r = el.getBoundingClientRect();
      slots.push({ id, top: r.top, mid: r.top + r.height / 2, bottom: r.bottom });
    });
    const from = slots.findIndex((s) => s.id === row.id);
    if (from === -1 || slots.length < 2) return;

    // THE BOX THAT SCROLLS, and where it stood at pointer-down. Rows are still
    // measured once; a scroll during the drag is added back as an offset, so
    // the slots stay where they were measured and the pointer is read against
    // them in CONTENT coordinates. The offset counts the window AS WELL as the
    // box, because a box at the end of its travel hands the scroll on to the
    // page (see `tick`), and either one moves the rows.
    const scroller = scrollParent(body.querySelector(`[${rowAttribute}]`));
    const readScroll = () => (scroller ? scroller.scrollTop : 0) + window.scrollY;
    const startScroll = readScroll();

    const table = body.closest("table") ?? body.querySelector("table") ?? body;
    const thead = table.querySelector(":scope > thead");

    /**
     * THE EDGES ARE WHERE THE ROWS STOP BEING VISIBLE, not where the window
     * does (2026-11-10, Mark: "dragging beyond the bounds of the scroll view or
     * near the bounds … actually scrolled the view"). Read every frame, because
     * the sticky parts move as the page scrolls under them:
     *
     *   * TOP — the masthead (`--rf-header-h`), the scrolling box's own top, and
     *     the table's column labels, which stick under the masthead and cover
     *     the rows passing beneath. Measured against the window alone, the zone
     *     sat UNDER the labels and you had to drag over them, past where any
     *     row is, before anything moved.
     *   * BOTTOM — the window's floor, the box's own bottom, and a band pinned
     *     over the bottom (`ui/StickyFooter`, which marks itself with
     *     `STICKY_FOOTER_ATTRIBUTE`). A special order's Add item footer is
     *     ~70px of rows you cannot see, and the zone used to be inside it.
     *
     * Held anywhere past an edge — over the labels, the masthead, the footer or
     * off the window altogether — is full speed (`edgeScrollStep`).
     */
    const edges = () => {
      let top =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rf-header-h")) || 0;
      let bottom = window.innerHeight;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        top = Math.max(top, r.top);
        bottom = Math.min(bottom, r.bottom);
      }
      if (thead) top = Math.max(top, thead.getBoundingClientRect().bottom);
      document.querySelectorAll(`[${STICKY_FOOTER_ATTRIBUTE}]`).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top > top) bottom = Math.min(bottom, r.top);
      });
      return { top, bottom };
    };

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

    const resolve = (screenY: number) => {
      const shift = readScroll() - startScroll;
      const y = screenY + shift;
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
      return { target, indicatorY: indicatorY - shift, noop };
    };

    let frame = 0;
    let lastX = startX;
    let lastY = startY;

    const cleanup = () => {
      cancelAnimationFrame(frame);
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
        frame = requestAnimationFrame(tick);
      }
      lastX = e.clientX;
      lastY = e.clientY;
      place();
    };

    // The pointer read against the rows, and the overlay moved to say so.
    const place = () => {
      const r = resolve(lastY);
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
        chip.style.left = `${lastX}px`;
        chip.style.top = `${lastY}px`;
      }
    };

    // Every frame while the drag is live: scroll if the pointer is held at an
    // edge, and re-read the target — a held pointer sends no moves, but the
    // rows are passing under it.
    const tick = () => {
      const { top, bottom } = edges();
      const step = edgeScrollStep(lastY, top, bottom);
      if (step !== 0) {
        // The box first; once it can travel no further that way, the page —
        // a pane at its end inside a taller page still gets you there.
        const before = scroller ? scroller.scrollTop : null;
        if (scroller) scroller.scrollTop += step;
        if (!scroller || scroller.scrollTop === before) window.scrollBy(0, step);
        place();
      }
      frame = requestAnimationFrame(tick);
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
