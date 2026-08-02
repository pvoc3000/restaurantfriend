"use client";

import type { ReactNode } from "react";

/**
 * The X-in-a-box, modernised. FileMaker used a boxed checkbox for every piece
 * of state in the system, and that directness is worth keeping: a black-ruled
 * square, filled solid black with a ✓ when set. Replaces every raw
 * `<input type="checkbox">`.
 */
export function Checkbox({
  checked,
  onChange,
  disabled = false,
  label,
  children,
  size = 22,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name; use `children` for a visible label instead. */
  label?: string;
  children?: ReactNode;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      // A LABELLED checkbox is a line of text and stays inline; a BARE one is a
      // control that owns its space and goes block-level (Mark, 2026-08-02: in
      // a PO's line table the box "doesn't align with the item type").
      //
      // The difference is the line box. An inline-level box sits on the
      // baseline of a line whose height comes from the CELL's strut, not from
      // the box — so in a table cell (`vertical-align: middle` centres the
      // LINE, not the control) an 18px box rode 3px high on a 74px row, and
      // `vertical-align: middle` on the button only moved it 2px the other way.
      // Block-level removes the line box entirely: the cell's content becomes
      // the control, and centring the content centres it exactly. Measured at
      // 662 against a cell midpoint of 662, on rows of every height.
      className={`cursor-pointer items-center gap-3 text-left disabled:cursor-default disabled:opacity-35 ${
        children ? "inline-flex" : "flex"
      }`}
    >
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: size * 0.6 }}
        className={`inline-flex shrink-0 items-center justify-center border-[1.5px] border-ink leading-none text-white transition-colors ${
          checked ? "bg-ink" : "bg-white"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}
