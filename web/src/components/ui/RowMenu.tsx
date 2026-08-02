"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  menuItemState,
  useAnchoredPanel,
} from "@/lib/anchoredPanel";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  /** Said quietly under the label — what the command will actually do. */
  hint?: string;
  /** Destructive: rendered in the accent, and last. */
  danger?: boolean;
  disabled?: boolean;
};

/**
 * A ⋯ button on a table row that opens that row's commands.
 *
 * A MENU BUTTON rather than a right-click (the open thread's call, 2026-07-23):
 * a context menu has no touch equivalent, and iPad Safari is the ordering
 * surface, so a command reachable only by right-click is a command half the
 * operation cannot reach.
 *
 * It shares `lib/anchoredPanel` with `PickList` — same portal, same fixed
 * coordinates, same close-on-scroll — because its first home is the vendor's
 * items table, which is an `overflow-auto` pane that would clip an absolutely
 * positioned panel outright.
 *
 * Anchored `right` by default: this lives in a table's last column, and a panel
 * hanging off the left of a 56px cell would run off the screen edge.
 */
export function RowMenu({
  items,
  label,
  align = "right",
}: {
  items: RowMenuItem[];
  /** What this menu is FOR, for screen readers — "Actions for AP flour". */
  label: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({ open, triggerRef, panelRef, align, onClose: close });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        // 36px square: a comfortable thumb target inside a 56px row, and square
        // like every other control here.
        className="grid h-9 w-9 place-items-center text-[17px] leading-none text-muted hover:bg-neutral-100 hover:text-ink"
      >
        ⋯
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            style={{
              top: box.top,
              left: box.left,
              ...(align === "right" ? { transform: "translateX(-100%)" } : {}),
              // Wide enough for a command and its hint, and no wider — this is
              // a short list of verbs, not a browser.
              minWidth: 200,
            }}
            className={MENU_PANEL_CLASS}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                // A command stacks its hint UNDER the label, where an option
                // sets one beside it — hence `block` here (see MENU_ITEM_CLASS).
                className={`${MENU_ITEM_CLASS} block ${menuItemState(false)} ${
                  item.danger ? "text-accent" : ""
                }`}
              >
                <span className="block">{item.label}</span>
                {item.hint && (
                  <span className="block text-xs text-muted">{item.hint}</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
