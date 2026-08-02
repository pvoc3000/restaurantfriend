"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Where a portalled panel should sit, in viewport coordinates. */
export type AnchorBox = { top: number; left: number; width: number };

// --- The dress ------------------------------------------------------------
//
// Every popup menu in the app wears these (Mark, 2026-08-01: our popup menus
// "look different stylistically from our other elements"). They live beside the
// positioning hook because the three panels that share that hook had each
// drifted a little on their own — PickList's rows were `px-2 py-1.5` against
// RowMenu's and ColumnsMenu's `px-3 py-2`, and only PickList marked a row under
// the keyboard. Same reasoning as `ui/Dialog`: three hand-rolled copies of one
// object, each having learned a different subset of the lessons.

/**
 * The floating panel itself. 2px black edge and NO shadow — depth is edges in
 * this design system — square corners, and `z-50` to clear the ActionBar while
 * sitting under the masthead, which is the only thing above it.
 */
export const MENU_PANEL_CLASS =
  "fixed z-50 max-h-[70vh] overflow-auto border-2 border-ink bg-white text-ink";

/**
 * One row: a command, an option, a checkbox line. Metrics and type only —
 * **no `display`**, because the three menus genuinely lay their rows out
 * differently (an option sets its hint beside the label, a command stacks it
 * underneath, a checkbox row centres on the box) and a `display` in here can't
 * be overridden by adding one at the call site: Tailwind resolves two utilities
 * touching the same property by their order in the STYLESHEET, not in the class
 * string, so `${MENU_ITEM_CLASS} block` silently stayed `flex` and put a
 * command's hint beside its label (caught in the browser, 2026-08-01). Each
 * caller states its own `flex`/`block`.
 */
export const MENU_ITEM_CLASS =
  "w-full px-3 py-2 text-left text-sm disabled:opacity-35 disabled:hover:bg-white";

/**
 * A row's state. `active` is the keyboard/pointer cursor — a solid black bar,
 * the same "selected" mark the TabPicker and the day strip use, so one idea has
 * one look. A menu with no cursor concept passes false and gets the hover wash.
 */
export function menuItemState(active: boolean): string {
  return active ? "bg-ink text-white" : "hover:bg-neutral-100";
}

/** A group heading inside the list — not selectable, just a label. */
export const MENU_HEADER_CLASS =
  "border-b border-hairline bg-neutral-50 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-subtle";

/** The find box pinned to the top of a long list. */
export const MENU_SEARCH_CLASS =
  "sticky top-0 z-10 w-full border-b border-hairline bg-white px-3 py-2 text-sm outline-none";

/**
 * Position a small panel directly below the control that opened it, and take it
 * away again at the right moments.
 *
 * This is `PickList`'s mechanism, lifted out so the ⋯ row menu can have exactly
 * the same one rather than a second implementation that behaves almost the same.
 * Both of the things it does are load-bearing, and both were learned from where
 * the panel is used rather than from taste:
 *
 * - **Portal to the body, position `fixed`.** Half the homes for one of these
 *   are table cells inside `overflow-auto` panes — the vendor's items table —
 *   where an absolutely-positioned panel is simply clipped. Coordinates measured
 *   off the trigger escape both that and WebKit's rule that a table cell under
 *   `border-collapse` is not a containing block (CLAUDE.md). The hook returns
 *   the box; the CALLER does the portal, since only it knows what to draw.
 * - **Close on scroll.** Fixed coordinates go stale the moment the page moves,
 *   and a list left floating over unrelated rows is worse than one that shut.
 *   The listener is registered in CAPTURE so a scroll inside a pane closes it
 *   too, not just the window's own. `resize` closes it for the same reason.
 *
 * Escape also closes and returns focus to the trigger; an outside mousedown
 * closes without stealing focus.
 */
export function useAnchoredPanel({
  open,
  triggerRef,
  panelRef,
  align = "left",
  onClose,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  /** So an outside-click can tell "outside" from "inside the panel". */
  panelRef: RefObject<HTMLElement | null>;
  /** `right` anchors the panel's right edge to the trigger's. */
  align?: "left" | "right";
  onClose: () => void;
}): AnchorBox | null {
  const [box, setBox] = useState<AnchorBox | null>(null);

  // Measured off the trigger at open time, and again if the panel's own size
  // changes under it (a filtered list shrinks as you type).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({
        top: r.bottom + 2,
        left: align === "right" ? r.right : r.left,
        width: r.width,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => observer.disconnect();
  }, [open, align, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stopped here so an Escape aimed at the panel doesn't also reach a
        // dialog or a page-level handler behind it.
        e.stopPropagation();
        onClose();
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, triggerRef, panelRef]);

  return box;
}
