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
 *
 * RESET COLUMN WIDTHS LIVES HERE TOO (Mark, 2026-09-10, making resizing easier
 * on a tablet). The table's own "Reset column widths" line under the rows is
 * desk furniture — off on the screens that pass `resetFooter={false}` — and a
 * double-click on a grip is no gesture at all on a touch screen, so on an iPad
 * there was no way back from a bad drag. Offered only while some width has
 * actually been changed.
 */
export function ColumnsMenu<T>({
  storageKey,
  columns,
  compact,
  onResetWidths,
}: {
  /** The table's own key — the same one it stores column widths under. */
  storageKey: string;
  columns: DataColumn<T>[];
  /** Whether the table is currently under its `compactBelow` width. */
  compact: boolean;
  /** Put every column back to its declared width. Omit when none has moved. */
  onResetWidths?: () => void;
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
            {onResetWidths && (
              <button
                type="button"
                onClick={() => {
                  onResetWidths();
                  close();
                }}
                className="block w-full border-t border-hairline px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink hover:bg-neutral-100"
              >
                Reset column widths
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Three columns — Material Symbols Outlined `view_column` (Apache 2.0), 24px at
 * wght 300. Inlined as a path rather than pulled from a font or a package: one
 * icon doesn't justify a dependency, and the artifact is a `currentColor` shape
 * that inherits the button's hover the way `RowMenu`'s ⋯ does.
 *
 * COLUMNS AGAIN (Mark, 2026-10-13: "use view_column in place of the eye"). It
 * was an eye from 2026-07-31 — the verb alone, the table being said by where
 * the button sits. Since then the menu also REORDERS, and a second button (the
 * calendar's) sits beside it, so the glyph has to say which of the two this is.
 *
 * A Material weight is a DIFFERENT PATH, not a `stroke-width` — changing it
 * means fetching the `wght300` artwork, so don't expect a CSS knob here.
 *
 * DRAWN AT 28px IN THE 32px BUTTON (Mark, 2026-10-13: "a little bigger"). The
 * artwork fills less of its square than the eye did — 680 of 960 units wide,
 * 520 tall — so at 24 it read small beside the calendar glyph.
 */
export function ColumnsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="currentColor"
        d="M140.62-292.31v-375.38q0-29.83 21.24-51.07Q183.1-740 212.92-740h534.77q29.83 0 51.07 21.24Q820-697.52 820-667.69v375.38q0 29.83-21.24 51.07Q777.52-220 747.69-220H212.92q-29.82 0-51.06-21.24-21.24-21.24-21.24-51.07ZM212.31-280h134.15v-400H212.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85Zm194.15 0h146.46v-400H406.46v400Zm206.46 0h134.16q4.61 0 8.46-3.85 3.84-3.84 3.84-8.46v-375.38q0-4.62-3.84-8.46-3.85-3.85-8.46-3.85H612.92v400Z"
      />
    </svg>
  );
}
