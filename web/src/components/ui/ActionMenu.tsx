"use client";

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { MENU_CARET, useAnchoredPanel } from "@/lib/anchoredPanel";

export type ActionMenuItem = {
  label: string;
  /** What the row does. Omit on a row that only opens `items`. */
  onSelect?: () => void;
  /** A submenu — one level, opened to the side. */
  items?: ActionMenuItem[];
  /** Destructive: the accent colour. */
  danger?: boolean;
  disabled?: boolean;
  /** A rule above this row, to group the commands. */
  separatorBefore?: boolean;
};

/** The panel — a Mac window's dress: 2px black edge and the hard shadow. */
const PANEL = "border-2 border-ink bg-white py-1 text-ink shadow-[4px_4px_0_0_#000]";

/** One row. Grey under the pointer or the keyboard, like every menu here. */
const ROW =
  "flex w-full items-center gap-6 whitespace-nowrap px-4 py-1.5 text-left text-sm outline-none hover:bg-[#c0c0c0] focus-visible:bg-[#c0c0c0] disabled:opacity-35 disabled:hover:bg-transparent";

/**
 * ONE "ACTIONS" BUTTON FOR A SCREEN'S COMMANDS, WITH NESTED SUBMENUS (Mark,
 * 2026-09-11: the special order record's buttons "are all different sizes and
 * colors, and it looks disorganized"). A raised Mac button with a caret opens a
 * vertical menu; a row with `items` shows ▶ and opens its submenu to the side
 * on hover, click or →, flipping to the left edge when there is no room on the
 * right.
 *
 * `ui/MenuButton` stays for a short flat list with hints; this is for a whole
 * screen's commands, grouped with `separatorBefore`. LABELS ARE TITLE CASE
 * (Mark, 2026-09-11: "use title case inside the action menu") — Cancel Order,
 * Schedule Production…, Kitchen Order. The callers set the words; nothing here
 * rewrites them, since a mechanical title-caser capitalises "the" and "of".
 *
 * THE SUBMENU IS INSIDE THE PANEL'S OWN ELEMENT, positioned `absolute` against
 * it, so `useAnchoredPanel`'s click-outside test counts a click in the submenu
 * as inside, and its position follows the panel when it flips.
 *
 * Choosing a row closes the menu and runs `onSelect` in the SAME click, so a
 * command that opens a window (a document preview) is still inside the gesture
 * — the popup gotcha `ui/MenuButton` already honours.
 *
 * Keys: ↓ on the button opens it; ↑ ↓ move; → opens a submenu and ← leaves it;
 * Enter or Space chooses; Escape closes (the panel hook's own).
 */
export function ActionMenu({
  items,
  label = "Actions",
  ariaLabel,
  disabled = false,
  align = "right",
  minWidth = 200,
  triggerClassName = BUTTON_CLASS,
}: {
  items: ActionMenuItem[];
  /** What the button says. */
  label?: string;
  /** What the menu is for, for a screen reader — "Actions for order 10021". */
  ariaLabel?: string;
  disabled?: boolean;
  /** `right` anchors the panel's right edge to the button's — for a button at
   *  the right margin, where a left-anchored panel would run off the page. */
  align?: "left" | "right";
  minWidth?: number;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hoverTimer = useRef<number | null>(null);
  const focusOnOpen = useRef<"main" | "sub" | null>(null);

  const clearTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const close = useCallback(() => {
    setOpen(false);
    setSub(null);
  }, []);

  const box = useAnchoredPanel({ open, triggerRef, panelRef, align, onClose: close });

  // The submenu: level with the row that opened it, to its right — or its left
  // when the right would run off the window — and pulled up if it would run
  // off the bottom. Written straight to the node before paint, so it never
  // shows in the wrong place and nothing re-renders to move it.
  useLayoutEffect(() => {
    const el = subRef.current;
    const row = sub === null ? null : rowRefs.current[sub];
    if (!open || !el || !row) return;
    // The row's top within the panel, less the submenu's own border and top
    // padding, so its first row lines up with the row that opened it.
    const top = row.offsetTop - 6;
    el.style.top = `${top}px`;
    el.style.left = "calc(100% - 2px)";
    el.style.right = "auto";
    if (el.getBoundingClientRect().right > window.innerWidth - 8) {
      el.style.left = "auto";
      el.style.right = "calc(100% - 2px)";
    }
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (over > 0) el.style.top = `${top - over}px`;
    if (focusOnOpen.current === "sub") {
      focusOnOpen.current = null;
      el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }, [open, sub, box]);

  // Opened from the keyboard: the first row takes focus.
  useLayoutEffect(() => {
    if (!open || !box || focusOnOpen.current !== "main") return;
    focusOnOpen.current = null;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, box]);

  const openMenu = () => {
    clearTimer();
    setSub(null);
    setOpen(true);
  };

  const choose = (item: ActionMenuItem) => {
    clearTimer();
    close();
    item.onSelect?.();
  };

  // Moving onto another row switches the submenu after a moment, so a pointer
  // travelling diagonally from a row into its submenu does not shut it on the
  // way past the rows below.
  const hoverRow = (i: number) => {
    clearTimer();
    const target = items[i]?.items?.length && !items[i].disabled ? i : null;
    if (target === sub) return;
    if (sub === null) {
      setSub(target);
      return;
    }
    hoverTimer.current = window.setTimeout(() => setSub(target), 150);
  };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const inSub = Boolean(subRef.current?.contains(document.activeElement));
    const menu = inSub ? subRef.current : listRef.current;
    if (!menu) return;
    const rows = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? 0 : (at + step + rows.length) % rows.length;
      rows[next].focus();
      if (!inSub) setSub(null);
    } else if (e.key === "ArrowRight" && !inSub) {
      const i = rowRefs.current.indexOf(document.activeElement as HTMLButtonElement);
      if (i >= 0 && items[i]?.items?.length) {
        e.preventDefault();
        if (sub === i) {
          subRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        } else {
          focusOnOpen.current = "sub";
          setSub(i);
        }
      }
    } else if (e.key === "ArrowLeft" && inSub && sub !== null) {
      e.preventDefault();
      const i = sub;
      setSub(null);
      rowRefs.current[i]?.focus();
    }
  }

  const subItems = sub === null ? null : (items[sub]?.items ?? null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            focusOnOpen.current = "main";
            openMenu();
          }
        }}
        className={triggerClassName}
      >
        {label}
        <span aria-hidden className="ml-2 shrink-0 text-[9px] opacity-60">
          {MENU_CARET}
        </span>
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            onKeyDown={onKey}
            style={{
              top: box.top,
              left: box.left,
              ...(align === "right" ? { transform: "translateX(-100%)" } : {}),
            }}
            className="fixed z-[70]"
          >
            <div ref={listRef} role="menu" aria-label={ariaLabel ?? label} style={{ minWidth }} className={PANEL}>
              {items.map((item, i) => (
                <div key={item.label}>
                  {item.separatorBefore && i > 0 ? (
                    <div role="separator" className="my-1 border-t border-neutral-300" />
                  ) : null}
                  <button
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    aria-haspopup={item.items ? "menu" : undefined}
                    aria-expanded={item.items ? sub === i : undefined}
                    disabled={item.disabled}
                    onMouseEnter={() => hoverRow(i)}
                    onClick={() => {
                      if (item.items) {
                        clearTimer();
                        setSub(sub === i ? null : i);
                      } else {
                        choose(item);
                      }
                    }}
                    className={`${ROW} ${sub === i ? "bg-[#c0c0c0]" : ""} ${item.danger ? "text-accent" : ""}`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {item.items ? (
                      <span aria-hidden className="text-[9px]">
                        ▶
                      </span>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>

            {subItems ? (
              <div
                ref={subRef}
                role="menu"
                aria-label={items[sub!]?.label}
                onMouseEnter={clearTimer}
                style={{ minWidth: 160 }}
                className={`absolute ${PANEL}`}
              >
                {subItems.map((child) => (
                  <div key={child.label}>
                    {child.separatorBefore ? (
                      <div role="separator" className="my-1 border-t border-neutral-300" />
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={child.disabled}
                      onClick={() => choose(child)}
                      className={`${ROW} ${child.danger ? "text-accent" : ""}`}
                    >
                      {child.label}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>,
          document.body
        )}
    </>
  );
}
