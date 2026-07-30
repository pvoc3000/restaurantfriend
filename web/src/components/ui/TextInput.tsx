"use client";

import { useRef, useState } from "react";

/**
 * The standard boxed text field — and the only one with a CLEAR button (Mark,
 * 2026-07-30). A small ✕ inside the field at the right, which appears only
 * while the field has focus and holds something, and empties it in one tap.
 *
 * WHERE IT BELONGS, and where it deliberately doesn't. The rule is: wide fields
 * holding free text — every search box, and the email compose header. Those are
 * the fields you retype rather than edit, where "select all, delete" is three
 * gestures on a tablet and one on a keyboard.
 *
 * Not on:
 * - **Numeric boxes** (guide on-hand/order, cleanup's pack and price editors,
 *   the PO add-item quantity). They're 4–10 characters wide, so the button
 *   would take a third of the field, and on the guide EMPTY AND ZERO MEAN
 *   DIFFERENT THINGS — a one-tap route to "untouched" sitting beside the
 *   stepper is a trap, not a convenience.
 * - **`type="date"`**. The browser already draws its own picker at the right
 *   edge and we'd be stacking a second control on top of it.
 * - **`InlineValue` cell editors**. They save ON BLUR, so a clear is one stray
 *   tap away from writing null to the record; the cells are also table-column
 *   narrow. Clicking in and typing over already replaces the value there.
 * - **The login form.** Two fields you fill once, one of them a password.
 *
 * The box itself is unchanged from what every field already used (the design
 * system's TextInput: black rule, thickening to 2px on focus, never coloured).
 * Horizontal padding is owned here so the text can never run under the button
 * — and it's reserved whether or not the button is showing, so focusing a field
 * doesn't reflow what you're reading.
 */
export function TextInput({
  value,
  onValueChange,
  clearLabel = "Clear this field",
  className = "",
  ...rest
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "className"> & {
  value: string;
  /** Called for typing AND for the clear button, which passes "". */
  onValueChange: (next: string) => void;
  /** What the ✕ empties, for screen readers: "Clear the search", say. */
  clearLabel?: string;
  /** Width and any per-field extras. Padding and the rule are set here. */
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Mark's call: you tap into the field to make it appear. At rest the field
  // stays a plain box, so a screen of filters isn't a row of ✕s. An empty
  // field shows nothing either — a button that would do nothing.
  const showClear = focused && value !== "";

  return (
    // The button is positioned against this, not against the input: an input
    // can't contain anything. Shrink-wraps, so the caller's width class on the
    // input still decides how wide the field is.
    <span className="relative inline-flex">
      <input
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`border border-ink bg-white pl-3 pr-9 outline-none focus:border-2 ${className}`}
        {...rest}
      />
      {showClear && (
        <button
          type="button"
          // preventDefault on mousedown is what makes this work at all: without
          // it the field blurs the instant you press, the button unmounts, and
          // the click lands on nothing. Focus never leaves the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onValueChange("");
            // Belt and braces — if a blur did slip through, you're still in the
            // field and can type the next term straight away.
            ref.current?.focus();
          }}
          // Out of the tab order: Tab should go to the next filter, not to a
          // button you can only want when you're already pointing at the field.
          tabIndex={-1}
          aria-label={clearLabel}
          title={clearLabel}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[13px] leading-none text-muted hover:text-ink"
        >
          ✕
        </button>
      )}
    </span>
  );
}
