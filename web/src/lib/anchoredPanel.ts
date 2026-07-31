"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Where a portalled panel should sit, in viewport coordinates. */
export type AnchorBox = { top: number; left: number; width: number };

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
