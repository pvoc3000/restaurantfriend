"use client";

import { useRef, useState } from "react";
import { formatTypedDate, parseTypedDate } from "@/lib/dateInput";
import { BOXED_FIELD, BOXED_FIELD_BORDER } from "@/components/ui/fieldMetrics";

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
 * A date box you can TYPE INTO, PASTE INTO, or pick from a calendar.
 *
 * One control everywhere, so a date behaves the same on all fifty-odd fields
 * rather than by remembering at each call site. Extracted from
 * `catalog/InlineValue` when the new-employee form needed a date that isn't an
 * edit-in-place cell.
 *
 * ------------------------------------------------------------------------
 * THE VISIBLE BOX IS TEXT; THE NATIVE DATE INPUT IS STILL HERE, HIDDEN.
 *
 * Mark, 2026-09-01: "All fields using the calendar picker should still allow
 * the user to enter the date directly rather than rely on the calendar picker
 * UI. Sometimes it's faster to type the date or even paste the date than fumble
 * around with the picker."
 *
 * A native `<input type="date">` cannot be pasted into in ANY engine — there is
 * no text in it to replace, only three spin fields — and this component made
 * the typing half worse than the platform: an empty one was `opacity-0` over a
 * blank with `onClick` opening the picker, so on the commonest case of all, a
 * date not yet set, there was nowhere to put a caret.
 *
 * So the box is `type="text"`, parsed by `lib/dateInput` (which is where the
 * accepted formats and the refusals are written down, and fixture-tested), and
 * the native input survives at 1px, transparent and untabbable, for one job:
 * `showPicker()` throws on an element that is not RENDERED, and the calendar
 * button is worth keeping — on a tablet it is the fast way, which is the half
 * of Mark's sentence that was already true.
 *
 * WHAT THIS RETIRES. Everything the previous version was mostly about: Safari
 * paints TODAY into an empty date input, so a null column read as a delivery
 * that had already happened, and no amount of styling reaches WebKit's
 * per-segment sub-pseudo-elements (three attempts, 2026-08-02). A text box
 * paints what it is given. The hidden input can paint whatever it likes at 1px.
 *
 * ------------------------------------------------------------------------
 * WHEN IT COMMITS, AND WHY NOT ON EVERY KEYSTROKE.
 *
 * On BLUR and on Enter, not on change. `9/1/2026` passes through `9`, `9/`,
 * `9/1` — all unreadable — on its way to being a date, and a control that
 * committed as you typed would either write nonsense or fight the caret. The
 * native input's own change still commits immediately, because a value picked
 * from a calendar is finished the moment it exists.
 *
 * UNREADABLE TEXT REVERTS AND WRITES NOTHING. `lib/dateInput` returns three
 * answers rather than two for exactly this: an EMPTY box is somebody clearing
 * the field, which writes null, where a typo must leave the stored date alone —
 * writing null for it would erase the very date being corrected.
 *
 * The draft is re-seeded from the prop whenever the prop moves (adjusting state
 * during render, React's own documented pattern), so a `router.refresh()` after
 * a save, or the picker, lands in the box without an effect.
 */
export function DateField({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  className = "",
  variant = "cell",
  boxed = false,
  max,
}: {
  /** An ISO yyyy-mm-dd, or null for no date. */
  value: string | null;
  /**
   * Fires with a FINISHED value: a real date, or null for a cleared field.
   *
   * Never fires for text that could not be read — see the header.
   */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel: string;
  className?: string;
  /**
   * WHICH DRESS, not which behaviour — `PickList`'s own prop and its own
   * reasoning, because this is the same problem it already solved.
   *
   * `cell` (the default) is the dense edit-in-place box that lives in a detail
   * screen's `dl`: button padding, no border, a hover wash. `field` is a
   * standalone bordered box for a FORM — 48px tall and 16px type, which is the
   * public inquiry page's dress and, for the type, the threshold below which
   * iOS Safari zooms the whole page on focus. `title` is `cell` at heading
   * scale, for a date that is part of a screen's IDENTITY rather than one of
   * its fields — the order guide's day, which sits beside the `h1` and says
   * which walk you are looking at (Mark, 2026-08-25).
   *
   * The POINT of the prop is that the customer-facing form does not get to
   * hand-roll its own date input. Everything in this file is a bug a second
   * implementation would reintroduce.
   */
  variant?: "cell" | "field" | "title";
  /** Wear a bounding box in the `cell` dress — see `PickList`'s own `boxed`. */
  boxed?: boolean;
  /**
   * The latest date offered, as `YYYY-MM-DD` — forwarded to the hidden input,
   * so the native picker greys out everything after it.
   *
   * A hint and never a guarantee: the attribute is advisory in every engine and
   * the value can still be typed, so whoever reads the date validates it too
   * (the order guide's `parseGuideDate` does).
   */
  max?: string;
}) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => formatTypedDate(value));
  // Adjusting state during render when the PROP moves — React's documented
  // alternative to a sync effect, and what the `set-state-in-effect` lint
  // wants. Without it a saved value would never reach the box.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setText(formatTypedDate(value));
  }

  const empty = value === null || value === "";
  const field = variant === "field";
  const title = variant === "title";

  const openPicker = () => {
    const el = nativeRef.current;
    if (!el) return;
    // Needs transient activation, which a click is. Not every engine has it.
    try {
      el.showPicker();
    } catch {
      // No picker to open — the text box is the fallback and is already there.
    }
  };

  /** Read the box. Commits a date, commits a clear, or puts the value back. */
  const commit = () => {
    const parsed = parseTypedDate(text);
    if (parsed.status === "invalid") {
      setText(formatTypedDate(value));
      return;
    }
    const next = parsed.status === "empty" ? null : parsed.iso;
    // Normalise what is shown even when nothing moved, so `9/1/26` settles to
    // `09/01/2026` rather than sitting there looking half-typed.
    setText(formatTypedDate(next));
    if (next !== (value ?? null)) onChange(next);
  };

  return (
    /* px-1 py-0.5 is the resting BUTTON's padding, not a field's: these sit in
       a dl beside text cells, and a date indented 8px while the note beside it
       is indented 4px is exactly the misalignment Mark caught on `sent_via`.
       No border BY DEFAULT (Mark: "I don't like the bounding box on the date
       fields, but I like the calendar icon") — the hover wash is what says the
       value takes an edit. `boxed` is opt-in and belongs to the caller: a
       screen that boxes every editable field has to box these too, or a date
       is the one cell on the page that reads as read-only. */
    <span
      className={
        field
          ? "flex h-12 w-full items-center gap-2 border border-ink px-3 focus-within:border-2"
          : `items-center px-1 py-0.5 hover:bg-neutral-100 ${
              title ? "gap-2" : "gap-1"
            } ${
              boxed && !title
                ? // A BOX MEANS THE SHARED FIELD DRESS, not just a border: one
                  // height and the width of its track, so a date lines up with
                  // the text cell above it instead of sitting 72px short in a
                  // box of its own size. `flex` rather than `inline-flex` is
                  // what lets `w-full` mean the column.
                  `flex ${BOXED_FIELD_BORDER} ${BOXED_FIELD}`
                : "inline-flex"
            }`
      }
    >
      <span
        className={
          field
            ? "relative flex h-full flex-1 items-center"
            : boxed && !title
              ? // FILLS THE BOX, and `min-w-0` is what lets it SHRINK.
                // `h-6`, not `h-full`: the box is a MINIMUM height, so there is
                // no definite height for a percentage to resolve against — the
                // wrapper's `items-center` does the centring.
                "relative flex h-6 min-w-0 flex-1 items-center"
              : `relative inline-flex items-center ${title ? "h-9" : "h-6"} ${
                  title ? "w-[9.5rem]" : "w-28"
                }`
        }
      >
        <input
          type="text"
          value={text}
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          // A date is not something a browser should offer to fill in or
          // restore from history.
          autoComplete="off"
          // NOT `inputMode="numeric"`: iOS renders that as a digits-only pad
          // with no `/`, which would make the field unusable on the device this
          // is most typed on. The calendar button is the fast path there; this
          // is the one for a keyboard and for a paste.
          // THE PLACEHOLDER IS WHY `collapseWhenEmpty` IS GONE. That prop
          // existed because an empty date input was INVISIBLE, so reserving
          // 112px for one rendered as a calendar glyph floating alone in a
          // 176px chip. An empty text box says "mm/dd/yyyy" and reads as the
          // field it is; collapsing it to 16px would instead make the paperwork
          // chip's expiry the one date in the app you cannot type into.
          placeholder="mm/dd/yyyy"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              // Put back what is stored — the same escape `InlineValue` gives.
              setText(formatTypedDate(value));
            }
          }}
          className={`rf-date bg-transparent tabular-nums outline-none placeholder:text-faint disabled:opacity-35 ${
            field ? "h-full text-[16px]" : title ? "h-9 text-[20px]" : "h-6"
          } ${
            field || (boxed && !title)
              ? "w-full"
              : title
                ? "w-[9.5rem]"
                : "w-28"
          } ${className}`}
        />
        {/* THE NATIVE INPUT, KEPT ONLY TO BE OPENED. 1px and transparent rather
            than `hidden` or `display:none`, because `showPicker()` throws on an
            element that is not rendered — that distinction is the whole of the
            care here, and it is the same one the previous version turned on.
            Untabbable and aria-hidden: the text box above is the control, and
            two focus stops for one field would be a worse keyboard than the one
            this replaces. */}
        <input
          ref={nativeRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={empty ? "" : (value as string)}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            // Picked from the calendar, so it is finished the moment it exists.
            const next = e.target.value || null;
            setText(formatTypedDate(next));
            if (next !== (value ?? null)) onChange(next);
          }}
          className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
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
