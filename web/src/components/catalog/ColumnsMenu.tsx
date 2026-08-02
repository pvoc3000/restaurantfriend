"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MENU_ITEM_CLASS, MENU_PANEL_CLASS, useAnchoredPanel } from "@/lib/anchoredPanel";
import { isColumnVisible, useColumnVisibility } from "@/lib/columnVisibility";
import { Checkbox } from "@/components/ui/Checkbox";
import type { DataColumn } from "./DataTable";

/**
 * Which columns this list shows (Mark, 2026-07-31 — FileMaker's layout control,
 * done as a menu).
 *
 * It sits with the list's FILTERS, never in the ActionBar: the bar carries
 * commands, and a control that changes what a list shows belongs beside the
 * other controls that change what a list shows (CLAUDE.md). It shares
 * `lib/anchoredPanel` with `PickList` and `RowMenu` — same portal, same fixed
 * coordinates, same close-on-scroll — because a fourth floating panel with its
 * own behaviour is exactly what that module exists to prevent.
 *
 * Columns marked `pinned` aren't offered. Every list has one column that IS the
 * row — the item's name, the PO number — and hiding it leaves a table of
 * attributes belonging to nothing; control columns (the select-all checkbox,
 * the ⋯ menu) have no label to offer in the first place.
 *
 * The checkboxes show EFFECTIVE visibility — what the table is doing, not just
 * what the reader once stored (Mark's iPad report, 2026-08-01: the width tier
 * had dropped two columns while every box sat checked, and checking did
 * nothing). A column the `compactBelow` tier is holding off shows unchecked
 * with a note saying so, and checking it genuinely brings it back — the
 * explicit choice wins (lib/columnVisibility).
 */
export function ColumnsMenu<T>({
  storageKey,
  columns,
  compact,
}: {
  /** The table's own key — the same one it stores column widths under. */
  storageKey: string;
  columns: DataColumn<T>[];
  /** Whether the table is currently under its `compactBelow` width. */
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({
    open,
    triggerRef,
    panelRef,
    align: "right",
    onClose: close,
  });
  const { hidden, shown, setVisible, showAll } = useColumnVisibility(storageKey);

  const offered = columns.filter((c) => c.label && !c.pinned);
  if (offered.length === 0) return null;

  const visibleOf = (c: DataColumn<T>) => isColumnVisible(c, compact, hidden, shown);
  const missing = offered.filter((c) => !visibleOf(c)).length;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Columns"
        onClick={() => setOpen((v) => !v)}
        title={
          missing > 0
            ? `Columns — ${offered.length - missing} of ${offered.length} shown`
            : "Columns — choose which ones this list shows"
        }
        // 32px square around the 24px glyph: the button tracks the icon, or the
        // hover wash sits on the artwork instead of around it. Black whenever
        // the table is showing fewer columns than it offers — by the reader's
        // hand OR the width tier's — because this menu is where the answer to
        // "where did that column go?" lives.
        className={`grid h-8 w-8 shrink-0 place-items-center transition-colors hover:bg-neutral-100 hover:text-ink ${
          missing > 0 ? "text-ink" : "text-muted"
        }`}
      >
        <ColumnsIcon />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="Columns"
            style={{ top: box.top, left: box.left, transform: "translateX(-100%)", minWidth: 220 }}
            className={MENU_PANEL_CLASS}
          >
            {offered.map((column) => {
              const visible = visibleOf(column);
              // Off because of the width tier, not the reader — say so, or an
              // unchecked box the reader never unchecked reads as a glitch.
              const widthDropped = !visible && !hidden.has(column.key);
              return (
                // A label, not a button with a checkbox inside it: the whole
                // row is the target, which is what you expect of a checklist
                // and what a thumb needs.
                <label
                  key={column.key}
                  // items-center, not baseline: a checkbox is a box, and a
                  // baseline would hang it below the label.
                  className={`${MENU_ITEM_CLASS} flex cursor-pointer items-center gap-3 hover:bg-neutral-100`}
                >
                  <Checkbox
                    checked={visible}
                    onChange={() => setVisible(column.key, !visible)}
                    label={`Show ${column.label}`}
                  />
                  <span>{column.label}</span>
                  {widthDropped && (
                    <span className="ml-auto pl-3 text-[11px] text-faint">
                      off to fit this screen
                    </span>
                  )}
                </label>
              );
            })}
            <button
              type="button"
              onClick={() => showAll(offered.map((c) => c.key))}
              disabled={missing === 0}
              className="block w-full border-t border-hairline px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink hover:bg-neutral-100 disabled:opacity-35 disabled:hover:bg-white"
            >
              Show all
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * An eye — Material Symbols Outlined `visibility` (Apache 2.0), 24px at
 * wght 300. Inlined as a path rather than pulled from a font or a package: one
 * icon doesn't justify a dependency, and the artifact is a `currentColor` shape
 * that inherits the button's hover the way `RowMenu`'s ⋯ does.
 *
 * JUST the eye (Mark, 2026-07-31). It arrived as three columns, then as
 * `table_eye` — a table with an eye in the corner — and both were trying to say
 * "columns" as well as "show". They don't need to: the control sits ON the
 * table, directly above its last column header, so the table is already said by
 * where it is. What's left for the glyph is the verb, and at 24px the eye alone
 * is legible where a grid-plus-eye is a smudge.
 *
 * A Material weight is a DIFFERENT PATH, not a `stroke-width` — changing it
 * means fetching the `wght300` artwork, so don't expect a CSS knob here.
 */
function ColumnsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="currentColor"
        d="M595.58-384.51q47.5-47.59 47.5-115.58t-47.59-115.49q-47.59-47.5-115.58-47.5t-115.49 47.59q-47.5 47.59-47.5 115.58t47.59 115.49q47.59 47.5 115.58 47.5t115.49-47.59ZM403.5-423.5Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM228.62-296.12Q115.16-372.23 61.54-500q53.62-127.77 167.02-203.88Q341.97-780 479.95-780q137.97 0 251.43 76.12Q844.84-627.77 898.46-500q-53.62 127.77-167.02 203.88Q618.03-220 480.05-220q-137.97 0-251.43-76.12ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z"
      />
    </svg>
  );
}
