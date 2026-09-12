"use client";

import { useId, type ReactNode } from "react";

/**
 * THE APP'S ONE CHECKBOX — and, since 2026-09-11, its one on/off control
 * (Mark: "merge checkbox and maccheckbox, then replace any switches in the app
 * with it. probably size lg"). `ui/MacCheckbox` and `ui/Switch` are gone.
 *
 * The classic Mac checkbox (system.css's `field-row` markup): a real
 * `<input type="checkbox">` beside a real `<label>`, the box drawn by
 * `.mac-checkbox` in `styles/mac-look.css` — a 1px black square, a grey X
 * corner to corner when checked, a 2px edge on hover and while held. A NATIVE
 * INPUT, where the old Checkbox was a `button role="checkbox"`: the label is the
 * whole hit target for free, Space toggles it, and a screen reader gets the
 * element it expects. The input sits transparent over the drawn box rather than
 * `display: none`, so it stays focusable.
 *
 * `children` is the visible label; `label` is the accessible name for a box
 * that has none (a table's selection column), and wins over the children where
 * both are given.
 *
 * `size="lg"` is a 24px box in a row a button tall (36px) — what every former
 * switch uses, and the location record's Active field. `md` is 16px.
 *
 * A BARE box is block-level, which is the old Checkbox's measured rule: an
 * inline box rides on a line box and sits high in a table cell.
 *
 * `className` goes on the ROW. `mac-checkbox-fill` makes the label take the
 * row's full width, for a menu row that must be clickable edge to edge
 * (`ui/PickSet`).
 */
export function Checkbox({
  checked,
  onChange,
  disabled = false,
  label,
  children,
  size = "md",
  className = "",
  title,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name; use `children` for a visible label instead. */
  label?: string;
  children?: ReactNode;
  size?: "md" | "lg";
  className?: string;
  /** A hover tooltip on the whole row, for a box whose visible label is too
   *  short to say what the mode DOES. Never the only place a reason lives — an
   *  iPad has no hover. */
  title?: string;
}) {
  const id = useId();
  const bare = children === undefined || children === null || children === false;
  return (
    <span
      className={`mac-checkbox ${size === "lg" ? "mac-checkbox-lg" : ""} ${
        bare ? "mac-checkbox-bare" : ""
      } ${className}`}
      title={title}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <label htmlFor={id}>{children}</label>
    </span>
  );
}
