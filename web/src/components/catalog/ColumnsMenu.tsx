"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import { useColumnVisibility } from "@/lib/columnVisibility";
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
 * The choice is remembered per table and per user, and composes with the
 * responsive `compactBelow` set: narrow screens still shed their marked
 * columns, and this takes out whatever you've unchecked on top of that.
 */
export function ColumnsMenu<T>({
  storageKey,
  columns,
}: {
  /** The table's own key — the same one it stores column widths under. */
  storageKey: string;
  columns: DataColumn<T>[];
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
  const { hidden, toggle, showAll } = useColumnVisibility(storageKey);

  const offered = columns.filter((c) => c.label && !c.pinned);
  if (offered.length === 0) return null;

  const hiddenHere = offered.filter((c) => hidden.has(c.key)).length;

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
          hiddenHere > 0
            ? `Columns — ${offered.length - hiddenHere} of ${offered.length} shown`
            : "Columns — choose which ones this list shows"
        }
        className={`grid h-8 w-8 shrink-0 place-items-center transition-colors hover:bg-neutral-100 hover:text-ink ${
          hiddenHere > 0 ? "text-ink" : "text-muted"
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
            className="fixed z-50 max-h-[70vh] overflow-y-auto border-2 border-ink bg-white text-ink"
          >
            {offered.map((column) => (
              // A label, not a button with a checkbox inside it: the whole row
              // is the target, which is what you expect of a checklist and what
              // a thumb needs.
              <label
                key={column.key}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-100"
              >
                <Checkbox
                  checked={!hidden.has(column.key)}
                  onChange={() => toggle(column.key)}
                  label={`Show ${column.label}`}
                />
                <span>{column.label}</span>
              </label>
            ))}
            <button
              type="button"
              onClick={showAll}
              disabled={hiddenHere === 0}
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
 * A table with an eye — Material Symbols Outlined `table_eye` (Apache 2.0),
 * the glyph Mark picked (2026-07-31). Inlined as a path rather than pulled from
 * a font or a package: one icon doesn't justify a dependency, and the artifact
 * is a strict-CSP-friendly `currentColor` shape that inherits the button's
 * hover the way `RowMenu`'s ⋯ does.
 *
 * An EYE, not three bars, because the eye is what the control does — this menu
 * only ever shows and hides. A first pass drew plain columns and carried the
 * state in a hollow third bar; the eye says "visibility" on its own, so the
 * state moved to the button's ink instead (muted at rest, black when something
 * is hidden), which is the app's usual way of saying a view is narrowed.
 */
function ColumnsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="currentColor"
        d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v333q-19-11-39-20t-41-16v-137H520v137q-46 14-86 40t-74 63H200v160h82q11 22 22 42t24 38H200Zm0-320h240v-160H200v160Zm0-240h560v-80H200v80Zm280 200Zm0 0Zm0 0Zm0 0ZM640-40q-91 0-168-48T360-220q35-84 112-132t168-48q91 0 168 48t112 132q-35 84-112 132T640-40Zm107.5-106q50.5-26 82.5-74-32-48-82.5-74T640-320q-57 0-107.5 26T450-220q32 48 82.5 74T640-120q57 0 107.5-26Zm-150-31.5Q580-195 580-220t17.5-42.5Q615-280 640-280t42.5 17.5Q700-245 700-220t-17.5 42.5Q665-160 640-160t-42.5-17.5Z"
      />
    </svg>
  );
}
