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
 *
 * THE HEIGHT IS OWNED HERE TOO, and that is the point of the `size` prop (Mark,
 * 2026-08-09: "the search bar is used throughout the app and should look and
 * behave the same across all modules"). It used to be the CALLER's job — nearly
 * every one wrote `h-9 … text-sm` by hand — so a field only matched its
 * neighbours if whoever added it remembered to copy the incantation. The
 * production module's search boxes didn't, and stood several pixels shorter
 * than the TabPicker beside them; so did the reminders field and the PO compose
 * header. A default nobody has to remember is the only version of this that
 * stays true. Callers pass WIDTH and nothing else.
 *
 * `h-9` is the app's field height — `TabPicker`'s cells and `PickList`'s
 * `variant="field"` box are the same, which is what makes a filter row read as
 * one band rather than as three controls that happen to be adjacent.
 */
const SIZE_CLASS = {
  /** The app's field height: filter rows, dialog forms, every search box. */
  md: "h-9 text-sm",
  /** A dense row inside a table expansion, where 36px is more than it can give. */
  sm: "h-8 text-[13px]",
} as const;

export function TextInput({
  value,
  onValueChange,
  clearLabel = "Clear this field",
  size = "md",
  className = "",
  ...rest
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "className" | "size"> & {
  value: string;
  /** Called for typing AND for the clear button, which passes "". */
  onValueChange: (next: string) => void;
  /** What the ✕ empties, for screen readers: "Clear the search", say. */
  clearLabel?: string;
  /** Height and type size. Leave it alone unless the row genuinely can't fit. */
  size?: keyof typeof SIZE_CLASS;
  /**
   * WIDTH, and nothing else. Height, type size, padding and the rule are set
   * here — a height passed through this string is a coin toss, because Tailwind
   * resolves competing utilities by stylesheet order rather than by the order
   * they appear in a class attribute.
   */
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Showing it on HOVER as well as on focus (Mark, 2026-08-09: "make it one by
  // showing the x on mouse hover"). It was focus-only, which made clearing a
  // field you were merely pointing at a two-step move — click in, wait for the
  // ✕ to appear, then click the ✕ — for a control whose whole reason to exist
  // is that it saves a gesture. At rest a field with nothing in it still shows
  // nothing, so a screen of empty filters is still a screen of plain boxes.
  const showClear = (focused || hovered) && value !== "";

  return (
    // The button is positioned against this, not against the input: an input
    // can't contain anything. Shrink-wraps, so the caller's width class on the
    // input still decides how wide the field is.
    //
    // The hover is tracked on the WRAPPER rather than on the input, so pointing
    // at the ✕ itself doesn't count as leaving the field and unmount the thing
    // you are reaching for.
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <input
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`border border-ink bg-white pl-3 pr-9 outline-none focus:border-2 ${SIZE_CLASS[size]} ${className}`}
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
