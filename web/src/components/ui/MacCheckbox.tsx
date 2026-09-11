"use client";

import { useId, type ReactNode } from "react";

/**
 * THE CLASSIC MAC CHECKBOX (Mark, 2026-09-10, with system.css's `field-row`
 * markup as the reference): a real `<input type="checkbox">` beside a real
 * `<label>`, the box drawn by `.mac-checkbox` in `styles/mac-look.css` — a 1px
 * black square, a grey X corner to corner when checked, a 2px edge on hover
 * and while the press is held.
 *
 * A NATIVE INPUT, where `ui/Checkbox` is a `button role="checkbox"`: the label
 * is the whole hit target for free, Space toggles it, and a screen reader gets
 * the element it expects. The input is transparent over the drawn box rather
 * than `display: none`, so it stays focusable.
 *
 * So far only the location record wears it — the `.mac-page` experiment.
 * Everywhere else is still `ui/Checkbox`.
 *
 * `size="lg"` is a 24px box in a 36px row (Mark, 2026-09-10, for the record's
 * Active field): a checkbox that stands in a column of 36px fields rather than
 * in a row of days. The box was 36px first, then 28, and read as larger than
 * the field.
 */
export function MacCheckbox({
  checked,
  onChange,
  disabled = false,
  size = "md",
  children,
  className = "",
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: "md" | "lg";
  /** The visible label, and the input's accessible name. */
  children: ReactNode;
  /** Classes on the row — the label inherits its colour. */
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`mac-checkbox ${size === "lg" ? "mac-checkbox-lg" : ""} ${className}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <label htmlFor={id}>{children}</label>
    </div>
  );
}
