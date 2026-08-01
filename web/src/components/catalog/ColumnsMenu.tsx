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
        onClick={() => setOpen((v) => !v)}
        title="Choose which columns this list shows"
        className="h-8 shrink-0 border border-ink bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        Columns
        {hiddenHere > 0 && ` · ${offered.length - hiddenHere}/${offered.length}`}
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
