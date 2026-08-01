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
        // 38px square around a 30px glyph: the button has to grow with the
        // icon or the hover wash sits on the artwork instead of around it.
        className={`grid h-[38px] w-[38px] shrink-0 place-items-center transition-colors hover:bg-neutral-100 hover:text-ink ${
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
 *
 * **30px at wght 300** (Mark, 2026-07-31 — it shipped at 20/400). The weight is
 * a DIFFERENT PATH, not a stroke-width: Material ships each weight as its own
 * outline, so changing it means fetching the `wght300` artwork. Bigger and
 * lighter is also the pair that works — 30px at 400 would have been the
 * heaviest mark on the screen, sitting a few pixels above a 2px header rule.
 * The optical size stays 24 (a 960-unit grid), which is the one built for
 * reading at this size.
 */
function ColumnsIcon() {
  return (
    <svg width="30" height="30" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="currentColor"
        d="M212.31-140Q182-140 161-161q-21-21-21-51.31v-535.38Q140-778 161-799q21-21 51.31-21h535.38Q778-820 799-799q21 21 21 51.31V-427q-14.39-7.92-29.39-14.61-15-6.7-30.61-11.77v-151.24H510v157.78q-32.92 10.92-62.15 29.8-29.23 18.89-54.39 45.12H200v159.61q0 5.39 3.46 8.85t8.85 3.46h86.61q8.7 16.61 17.58 31.42 8.89 14.81 18.81 28.58h-123ZM200-431.92h250v-172.7H200v172.7Zm0-232.69h560v-83.08q0-5.39-3.46-8.85t-8.85-3.46H212.31q-5.39 0-8.85 3.46t-3.46 8.85v83.08ZM480-480Zm0 0Zm0 0Zm0 0ZM642.69-64.62q-82.15 0-151.65-42.8-69.5-42.81-105.65-116.43 36.15-73.61 105.65-116.42t151.65-42.81q82.16 0 151.66 42.81Q863.84-297.46 900-223.85q-36.16 73.62-105.65 116.43-69.5 42.8-151.66 42.8ZM748.85-151q49.92-26.39 82.69-72.85-32.77-46.46-82.69-72.84-49.93-26.39-106.16-26.39t-106.15 26.39q-49.92 26.38-82.69 72.84 32.77 46.46 82.69 72.85 49.92 26.38 106.15 26.38 56.23 0 106.16-26.38Zm-141.54-37.46q-14.62-14.62-14.62-35.39 0-20.77 14.62-35.38 14.61-14.62 35.38-14.62 20.77 0 35.39 14.62 14.61 14.61 14.61 35.38 0 20.77-14.61 35.39-14.62 14.61-35.39 14.61-20.77 0-35.38-14.61Z"
      />
    </svg>
  );
}
