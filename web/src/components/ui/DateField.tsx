"use client";

import { useRef } from "react";

/**
 * The calendar affordance, drawn rather than borrowed: Safari renders no icon
 * on a date input at all, and Chrome's lives inside the field where it can't be
 * styled to match anything. Square, hairline, `currentColor` — the house idiom,
 * and the same call as the Columns eye (an icon earns its place where a word
 * would read as a label).
 */
function CalendarIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <rect x="1.5" y="3" width="13" height="11.5" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

/**
 * A date box that always shows its calendar (Mark, 2026-08-02: "always include
 * a calendar picker for any date field"). One control, so a date is a picker by
 * construction rather than by remembering at each call site.
 *
 * Extracted from `catalog/InlineValue` when the new-employee form needed a date
 * that isn't an edit-in-place cell. It has to be shared and not copied, because
 * everything below is a bug that a second implementation would reintroduce —
 * and a CREATE form is the worst place for it, since its date starts empty.
 *
 * AN EMPTY DATE INPUT IS NEVER SHOWN, because Safari paints TODAY'S DATE into
 * one. Its internal edit fields render the current date as a ghost whenever
 * the value is "", so a null column reads as a delivery that already happened;
 * the value really is empty, so the database, the DOM value and Chrome are all
 * correct and only the paint lies. That took three reports to pin down (Mark,
 * 2026-08-02), and two earlier attempts failed because they were fixes to OTHER
 * things — a React drift guard, then autoComplete="off" — and a third failed
 * because `color: transparent` on `::-webkit-datetime-edit` does not reach
 * WebKit's per-segment sub-pseudo-elements.
 *
 * So this does not try to style WebKit's internals at all. When there is no
 * value the input is still THERE — `showPicker()` throws on an element that
 * isn't rendered, and it must stay focusable and keyboard-reachable — but it is
 * transparent and laid over a blank of our own. Nothing WebKit paints can be
 * seen, whatever it decides to paint, in any version.
 *
 * VERIFY ANY CHANGE HERE IN BOTH ENGINES. This class of bug is invisible in one.
 */
export function DateField({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  className = "",
}: {
  /** An ISO yyyy-mm-dd, or null for no date. */
  value: string | null;
  /** Fires on CHANGE, not on blur: a date input emits "" until the whole date
   *  is valid, so a change event IS a finished value — there is no half-typed
   *  state to protect and nothing to confirm. */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const empty = value === null || value === "";

  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    // Needs transient activation, which a click is. Not every engine has it.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    /* px-1 py-0.5 is the resting BUTTON's padding, not a field's: these sit in
       a dl beside text cells, and a date indented 8px while the note beside it
       is indented 4px is exactly the misalignment Mark caught on `sent_via`.
       No border (Mark: "I don't like the bounding box on the date fields, but I
       like the calendar icon") — the hover wash is what says the value takes an
       edit. */
    <span className="inline-flex items-center gap-1 px-1 py-0.5 hover:bg-neutral-100">
      {/* One fixed width in both states, so the glyph doesn't move when a date
          lands and the two rows of a dl line up with each other. */}
      <span className="relative inline-flex h-6 w-28 items-center">
        <input
          ref={ref}
          type="date"
          value={empty ? "" : value}
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          // Nothing here is a form field in the sense a browser means, so it
          // should neither be autofilled nor restored from history.
          autoComplete="off"
          // Clicking the blank opens the picker: with the field invisible there
          // is nothing to aim a caret at, and the indicator that would normally
          // do this is hidden (Chrome) or absent (Safari).
          onClick={empty ? openPicker : undefined}
          onChange={(e) => onChange(e.target.value || null)}
          className={`rf-date h-6 w-28 bg-transparent tabular-nums outline-none disabled:opacity-35 ${
            empty ? "absolute inset-0 cursor-pointer opacity-0" : ""
          } ${className}`}
        />
      </span>
      {/* Ours, not the engine's — Safari draws no indicator and Chrome's sits
          inside the field where it can't be made to match anything. */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Choose ${ariaLabel}`}
        title="Choose a date"
        onClick={openPicker}
        className="shrink-0 text-muted hover:text-ink disabled:opacity-35"
      >
        <CalendarIcon />
      </button>
    </span>
  );
}
