"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatTypedDate, parseTypedDate } from "@/lib/dateInput";
import { monthStart } from "@/lib/dateRange";
import { todayInTimeZone } from "@/lib/today";
import { useAnchoredPanel } from "@/lib/anchoredPanel";
import { CalendarGrid } from "@/components/ui/CalendarGrid";
import { BOXED_FIELD, BOXED_FIELD_BORDER } from "@/components/ui/fieldMetrics";
import { MacTitleBar } from "@/components/ui/MacTitleBar";

/**
 * The calendar affordance, drawn rather than borrowed: Safari renders no icon
 * on a date input at all, and Chrome's lives inside the field where it can't be
 * styled to match anything. Square, hairline, `currentColor` — the house idiom,
 * and the same call as the Columns eye (an icon earns its place where a word
 * would read as a label).
 */
export function CalendarIcon() {
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

/** A day button under the calendar — `ui/RangePicker`'s preset dress, raised
 *  in the Mac look. */
const PANEL_BUTTON =
  "mac-control inline-flex h-8 items-center whitespace-nowrap border border-ink bg-white px-3 any-pointer-coarse:h-11 any-pointer-coarse:px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink disabled:opacity-35";

/**
 * A date box you can TYPE INTO, PASTE INTO, or pick from a calendar.
 *
 * One control everywhere, so a date behaves the same on all fifty-odd fields
 * rather than by remembering at each call site. Extracted from
 * `catalog/InlineValue` when the new-employee form needed a date that isn't an
 * edit-in-place cell.
 *
 * ------------------------------------------------------------------------
 * THE BOX IS TEXT, AND THE CALENDAR IS OURS.
 *
 * Mark, 2026-09-01: "All fields using the calendar picker should still allow
 * the user to enter the date directly rather than rely on the calendar picker
 * UI. Sometimes it's faster to type the date or even paste the date than fumble
 * around with the picker." So the box is `type="text"`, parsed by
 * `lib/dateInput` (which is where the accepted formats and the refusals are
 * written down, and fixture-tested).
 *
 * THE CALENDAR ICON OPENS `ui/CalendarGrid` IN AN ANCHORED PANEL — the range
 * picker's own month grid (Mark, 2026-09-10: "roll our own date picker control
 * so it matches rangepicker"). It replaced a native `<input type="date">` kept
 * at 1px only so `showPicker()` could open the BROWSER's calendar, and that
 * hidden input was the source of every date bug this component has had: Safari
 * painted TODAY into an empty one, so a null read as a delivery that had
 * already happened (three attempts to style it away, 2026-08-02); and iPad
 * Safari would not open a picker for an input it could not see, while the
 * `try` swallowed the refusal, so tapping the icon did nothing and said nothing
 * (2026-09-10). Our panel looks the same on the desk and the iPad, matches the
 * range filters, and has no engine to argue with.
 *
 * One tap picks and closes. Today and Clear sit under the grid (Clear only when
 * the field may be empty and is not). `max` greys out every later day. Arrow
 * keys walk the grid from the date already chosen; Escape closes and returns
 * focus to the calendar button. Today is the DEVICE's calendar day, read when
 * the panel opens — this component is told no organisation timezone, and a shop
 * iPad's own clock is the shop's.
 *
 * ------------------------------------------------------------------------
 * WHEN IT COMMITS, AND WHY NOT ON EVERY KEYSTROKE.
 *
 * On BLUR and on Enter, not on change. `9/1/2026` passes through `9`, `9/`,
 * `9/1` — all unreadable — on its way to being a date, and a control that
 * committed as you typed would either write nonsense or fight the caret. A date
 * picked from the calendar commits immediately, because it is finished the
 * moment it exists.
 *
 * UNREADABLE TEXT REVERTS AND WRITES NOTHING. `lib/dateInput` returns three
 * answers rather than two for exactly this: an EMPTY box is somebody clearing
 * the field, which writes null, where a typo must leave the stored date alone —
 * writing null for it would erase the very date being corrected.
 *
 * The draft is re-seeded from the prop whenever the prop moves (adjusting state
 * during render, React's own documented pattern), so a `router.refresh()` after
 * a save, or a pick, lands in the box without an effect.
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
   * iOS Safari zooms the whole page on focus. `title` is the order guide's day
   * — a date that says which walk you are looking at (Mark, 2026-08-25) — in
   * the Mac look: a raised 36px box at 16px type, at the title row's right.
   *
   * The POINT of the prop is that the customer-facing form does not get to
   * hand-roll its own date input. Everything in this file is a bug a second
   * implementation would reintroduce.
   */
  variant?: "cell" | "field" | "title";
  /** Wear a bounding box in the `cell` dress — see `PickList`'s own `boxed`. */
  boxed?: boolean;
  /**
   * The latest date offered, as `YYYY-MM-DD` — later days are greyed out in the
   * calendar.
   *
   * A hint and never a guarantee: the value can still be typed, so whoever
   * reads the date validates it too (the order guide's `parseGuideDate` does).
   */
  max?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => formatTypedDate(value));
  // Adjusting state during render when the PROP moves — React's documented
  // alternative to a sync effect, and what the `set-state-in-effect` lint
  // wants. Without it a saved value would never reach the box.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setText(formatTypedDate(value));
  }

  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [today, setToday] = useState("");

  const empty = value === null || value === "";
  const current = empty ? null : value;
  const field = variant === "field";
  const title = variant === "title";

  const close = useCallback(() => setOpen(false), []);
  const box = useAnchoredPanel({
    open,
    triggerRef: buttonRef,
    panelRef,
    align: "right",
    onClose: close,
  });

  const openPanel = () => {
    // Read when opening, never at render: a server render would read the
    // SERVER's day, and the markup would disagree with the client's.
    const now = todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setToday(now);
    setMonth(monthStart(current ?? now));
    setOpen(true);
  };

  /** A date from the calendar — finished the moment it exists. */
  const pick = (next: string | null) => {
    setText(formatTypedDate(next));
    if (next !== current) onChange(next);
    close();
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
    if (next !== current) onChange(next);
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
          ? "rf-typed flex h-12 w-full items-center gap-2 border border-ink px-3 focus-within:border-2"
          : title
            ? // THE MAC LOOK (Mark, 2026-09-10: "make the date picker macos
              // style") — the filter row's raised box, `RangePicker`'s dress.
              "rf-press inline-flex h-9 items-center gap-2 border border-ink bg-white px-2"
          : `items-center gap-1 px-1 py-0.5 hover:bg-neutral-100 ${
              boxed
                ? // A BOX MEANS THE SHARED FIELD DRESS, not just a border: one
                  // height and the width of its track, so a date lines up with
                  // the text cell above it instead of sitting 72px short in a
                  // box of its own size. `flex` rather than `inline-flex` is
                  // what lets `w-full` mean the column.
                  // `rf-typed`: a solid border, 2px on hover (mac-look.css).
                  `rf-typed flex ${BOXED_FIELD_BORDER} ${BOXED_FIELD}`
                : "inline-flex"
            }`
      }
    >
      <span
        className={
          field
            ? "relative flex h-full flex-1 items-center"
            : title
              ? "relative inline-flex h-full w-28 items-center"
            : boxed
              ? // FILLS THE BOX, and `min-w-0` is what lets it SHRINK.
                // `h-6`, not `h-full`: the box is a MINIMUM height, so there is
                // no definite height for a percentage to resolve against — the
                // wrapper's `items-center` does the centring.
                "relative flex h-6 min-w-0 flex-1 items-center"
              : "relative inline-flex h-6 w-28 items-center"
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
          // is most typed on. The calendar is the fast path there; this is the
          // one for a keyboard and for a paste.
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
              // When that undoes typing, the key is used: a dialog around the
              // field must not close on the same press.
              if (text !== formatTypedDate(value)) e.preventDefault();
              setText(formatTypedDate(value));
            }
          }}
          className={`rf-date bg-transparent tabular-nums outline-none placeholder:text-faint disabled:opacity-35 ${
            field || title ? "h-full text-[16px]" : "h-6"
          } ${field || title || boxed ? "w-full" : "w-28"} ${className}`}
        />
      </span>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={`Choose ${ariaLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Choose a date"
        onClick={() => (open ? close() : openPanel())}
        className="shrink-0 text-muted hover:text-ink disabled:opacity-35"
      >
        <CalendarIcon />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Choose ${ariaLabel}`}
            // Anchored to the calendar button's right edge (`align: "right"`)
            // and shifted left by its own width — `ColumnsMenu`'s placement —
            // so it opens under the field rather than off past its end.
            style={{ top: box.top, left: box.left, transform: "translateX(-100%)" }}
            // Layout only — the colours are stated here, not inherited:
            // `position: fixed` moves the box and not its place in the DOM, so
            // a field sitting in a black band would otherwise paint white type
            // into this panel (the Generate-POs lesson).
            // A Mac window (Mark, 2026-09-10): `ui/TimePicker`'s frame, hard
            // shadow and ruled title bar. The close box closes without a pick.
            className="fixed z-[70] border-2 border-ink bg-white text-ink whitespace-normal shadow-[4px_4px_0_0_#000]"
          >
            <MacTitleBar
              title={ariaLabel.charAt(0).toUpperCase() + ariaLabel.slice(1)}
              onClose={close}
            />
            <div className="p-3">
              <CalendarGrid
                month={month}
                today={today}
                painted={current ? { from: current, to: current } : null}
                onMonth={setMonth}
                onTap={pick}
                isDisabled={max ? (iso) => iso > max : undefined}
                autoFocusIso={current ?? today}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => pick(today)}
                  disabled={!!max && today > max}
                  className={PANEL_BUTTON}
                >
                  Today
                </button>
                {!required && current && (
                  <button type="button" onClick={() => pick(null)} className={PANEL_BUTTON}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
