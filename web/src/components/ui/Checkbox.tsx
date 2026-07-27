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
      className="inline-flex cursor-pointer items-center gap-3 text-left disabled:cursor-default disabled:opacity-35"
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
