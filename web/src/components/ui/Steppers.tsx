"use client";

/**
 * FMP's stacked pair, and the reason it is a pair rather than a number box: a
 * par moves by whole boxes, so the gesture that changes it should too.
 *
 * NO BORDER (Mark, 2026-08-08). A box around a 7px glyph spends most of its
 * width on the box, and two of them stacked read as a control you have to
 * decipher. Bare arrows can be half again as large in the same space, which is
 * what makes the pair legible at a glance — the glyph IS the affordance, and it
 * darkens on hover like every other quiet control here.
 *
 * SHARED SINCE 2026-10-26, when the schedule's Par column took the plan's
 * pair (Mark). It was private to `PlanMatrix` until then.
 */
export function Steppers({
  onUp,
  onDown,
  disabled,
  labelUp,
  labelDown,
}: {
  onUp: () => void;
  onDown: () => void;
  disabled: boolean;
  labelUp: string;
  labelDown: string;
}) {
  const cell =
    "flex h-3 w-4 items-center justify-center text-[11px] leading-none text-subtle transition-colors hover:text-ink disabled:opacity-30";
  return (
    <span className="flex shrink-0 flex-col">
      <button type="button" onClick={onUp} disabled={disabled} aria-label={labelUp} className={cell}>
        ▲
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disabled}
        aria-label={labelDown}
        className={cell}
      >
        ▼
      </button>
    </span>
  );
}
