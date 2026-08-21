"use client";

/**
 * A time of day, entered with the browser's own control.
 *
 * WHY THIS EXISTS RATHER THAN A `TextInput`. The record screen's `TimeCell`
 * takes free text and lets Postgres parse it, which is right for an
 * edit-in-place cell on a value that is already set. A CREATE form is the other
 * case: the box starts empty, the value is required, and "10 30" or "half ten"
 * reaching the database as a `time` cast error is a refusal nobody can act on.
 * `type="time"` yields `HH:MM` or nothing, which is exactly the two outcomes a
 * required field wants.
 *
 * IT WEARS `ui/DateField`'S DRESS — no bounding box, the hover wash as the
 * affordance, and the engine's own clock glyph where the date field draws a
 * calendar. Mark asked for that on dates ("I don't like the bounding box on
 * the date fields, but I like the calendar icon"), and the two now sit SIDE BY
 * SIDE on the create form: a bordered time beside a borderless date reads as
 * one of them being broken.
 *
 * IT CARRIES NO EMPTY-STATE APPARATUS, unlike `ui/DateField`, and that is a
 * decision rather than an omission. DateField hides an empty input behind a
 * blank because WebKit paints TODAY'S DATE into one — a null column that reads
 * as a real value, which cost three failed fixes to find. An empty time input
 * renders its segments as placeholders instead, so there is nothing to hide.
 * If that ever turns out to be wrong on some engine, the cure is written out
 * in full next door.
 */
export function TimeField({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  className = "",
  variant = "cell",
}: {
  /** `HH:MM` or `HH:MM:SS` (what a Postgres `time` column reads back), or null. */
  value: string | null;
  /** Fires on CHANGE, not blur: a time input emits "" until the whole value is
   *  valid, so a change event IS a finished value — the same reason DateField
   *  does not wait either. */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel: string;
  className?: string;
  /**
   * `ui/DateField`'s prop, kept in step for that component's own reason: these
   * two sit SIDE BY SIDE, so a bordered time beside a borderless date reads as
   * one of them being broken. Whatever dress the date wears, this wears too.
   */
  variant?: "cell" | "field";
}) {
  const field = variant === "field";

  return (
    <span
      className={
        field
          ? "flex h-12 w-full items-center border border-ink px-3 focus-within:border-2"
          : "inline-flex items-center px-1 py-0.5 hover:bg-neutral-100"
      }
    >
      <input
        type="time"
        // `10:00:00` comes back from Postgres; the control wants `10:00`.
        // Passing the seconds through makes Chrome render a seconds segment
        // nobody asked for and Safari ignore the value entirely.
        value={value ? value.slice(0, 5) : ""}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value || null)}
        className={`bg-transparent tabular-nums outline-none disabled:opacity-35 ${
          field ? "h-full w-full text-[16px]" : "h-6"
        } ${className}`}
      />
    </span>
  );
}
