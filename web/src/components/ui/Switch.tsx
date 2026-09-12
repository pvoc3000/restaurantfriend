"use client";

import { useId, type ReactNode } from "react";

/**
 * A SWITCH, IN THE CLASSIC MAC IDIOM (Mark, 2026-09-11: "let's try to build our
 * own mac styled switch. I have a feeling this is going to come up a lot").
 *
 * WHY IT EXISTS, which is the thing to understand before reaching for it or
 * replacing it: `ui/Switch` was DELETED on 2026-09-11 when every switch in the
 * app became a `ui/Checkbox size="lg"` — and within a day the Active column on
 * `/vendors` had come to read as a row-SELECTION box, because selection
 * checkboxes became the norm on three lists in the same two days. A checkbox
 * had ended up meaning two unrelated things: "this row is ticked", which is
 * transient and about your intent, and "this record is live", which is durable
 * and about the record. This is the second meaning taking its own shape back.
 *
 * SO USE IT FOR A RECORD'S OWN STATE — a durable property of the row you are
 * looking at — and keep `ui/Checkbox` for a selection, for a list of options,
 * and for a form's yes/no. If a screen has both, they must not look alike.
 *
 * The dress is `.mac-switch` in `styles/mac-look.css`: a flat track with a
 * RAISED thumb — the sunken well was tried and dropped, the thumb's drop kept.
 * The note there says why, and carries the geometry, which has no slack in it.
 * Two cues carry the state, the thumb's POSITION and the track's GROUND,
 * because down a long column position alone is a 16px difference. Neither is
 * colour, so the app's rule that colour means record STATE is untouched.
 *
 * A REAL `<input type="checkbox">` carrying `role="switch"`, sitting transparent
 * over the drawn track rather than `display: none`, so it keeps its place in
 * the tab order and the label is the hit target — `ui/Checkbox`'s arrangement,
 * and this is deliberately its sibling in every respect but the dress.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  children,
  className = "",
  title,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name; use `children` for a visible label instead. */
  label?: string;
  children?: ReactNode;
  /** Goes on the ROW, like `ui/Checkbox`'s. */
  className?: string;
  /** A hover tooltip on the row, for a switch whose visible label is too short
   *  to say what the mode does. Never the only place a reason lives — an iPad
   *  has no hover. */
  title?: string;
}) {
  const id = useId();
  const bare = children === undefined || children === null || children === false;
  return (
    <span
      className={`mac-switch ${bare ? "mac-switch-bare" : ""} ${className}`}
      title={title}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <label htmlFor={id}>{children}</label>
    </span>
  );
}
