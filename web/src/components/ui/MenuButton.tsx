"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  MENU_CARET,
  MENU_ITEM_CLASS,
  MENU_PANEL_CLASS,
  menuItemState,
  useAnchoredPanel,
} from "@/lib/anchoredPanel";

export type MenuCommand = {
  label: string;
  onSelect: () => void;
  /** Said quietly under the label — what the command will actually do. */
  hint?: string;
  /** Destructive: rendered in the accent, and last. */
  danger?: boolean;
  disabled?: boolean;
};

/**
 * A BUTTON THAT OPENS A SHORT LIST OF COMMANDS — the anchored command menu,
 * with the trigger left to the caller.
 *
 * `ui/RowMenu` was this control with one dress hardcoded (a 36px `⋯` square in
 * a table's last column), and the moment a second dress was needed — a labelled
 * button in a command bar — the choice was to hand-roll a second panel or to
 * lift this out. Hand-rolling is what CLAUDE.md's parts table exists to stop:
 * the panel positions in two passes, flips above the trigger near the foot of
 * the window, closes on a scroll that is not its own, and sits at `z-[70]` so a
 * dialog cannot cover it. None of that is worth learning twice, and a second
 * copy would drift the way `ui/Dialog`'s three hand-rolled ancestors did.
 *
 * So: the machinery is here, `RowMenu` is the ⋯ dress over it, and a command
 * bar passes its own label and the app's one button class.
 *
 * A MENU, NOT A `PickList`. The distinction is what the choice MEANS: a
 * PickList chooses a VALUE that stays chosen and shows which one is current;
 * every row here is a verb that happens once and leaves nothing selected. That
 * is why nothing is ticked and why the trigger's label never changes.
 */
export function MenuButton({
  items,
  label,
  trigger,
  triggerClassName,
  caret = false,
  disabled = false,
  align = "left",
  minWidth = 200,
}: {
  items: MenuCommand[];
  /** What this menu is FOR, for screen readers — "Preview which document". */
  label: string;
  /** What the button shows. `RowMenu` passes `⋯`; a command bar passes words. */
  trigger: ReactNode;
  /** The button's dress. Required in practice — there is no sensible default
   *  shared by a 36px glyph square and a 36px labelled cell. */
  triggerClassName: string;
  /**
   * Wear the caret — the mark that says "this opens a list" (Mark, 2026-08-19:
   * "the new document picklist buttons should have the arrow glyph to indicate
   * it's a picklist").
   *
   * Opt-in rather than always, because `RowMenu`'s trigger IS a marker: `⋯`
   * already means "there is more here", and a caret beside it would be the same
   * claim made twice inside a 36px square. A button that reads as an ordinary
   * command is the case that needs telling.
   *
   * It is `currentColor` at reduced opacity, NOT `text-muted` like PickList's —
   * a command button fills black on hover, where a fixed grey would go
   * dark-on-dark.
   */
  caret?: boolean;
  disabled?: boolean;
  align?: "left" | "right";
  /** Wide enough for a command and its hint, and no wider — this is a short
   *  list of verbs, not a browser. */
  minWidth?: number;
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
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
        {caret ? (
          <span aria-hidden className="ml-2 shrink-0 text-[9px] opacity-60">
            {MENU_CARET}
          </span>
        ) : null}
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
              minWidth,
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
                {item.hint && <span className="block text-xs text-muted">{item.hint}</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
