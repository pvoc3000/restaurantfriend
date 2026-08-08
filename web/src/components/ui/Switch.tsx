"use client";

/**
 * The app's switch, and the only one: black when on, and off is the EXACT
 * inverse — white track, black knob (Mark, 2026-07-25). A switch is never
 * tinted to say what it does; its label does that.
 *
 * Presentational only. It owns no write, no optimism and no error state,
 * because the two things that use it disagree about all three: `ActiveToggle`
 * writes `is_active` on any table and reverts on failure, while the recipe
 * sheet's AUTO switch writes four columns at once and has to freeze the
 * computed values on the way past.
 *
 * Extracted 2026-08-08, when the recipe grid became the second caller. The
 * alternative was a second 46×26 rounded box with its own idea of what the knob
 * does, which is the `ui/Dialog` story exactly.
 */
export function Switch({
  on,
  onToggle,
  disabled = false,
  ariaLabel,
  size = "md",
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  ariaLabel: string;
  /** "sm" for a dense grid row, where the full-size box is taller than the
   *  text beside it. */
  size?: "sm" | "md";
}) {
  const track = size === "sm" ? "h-[20px] w-[36px]" : "h-[26px] w-[46px]";
  const knob = size === "sm" ? "h-[14px] w-[14px]" : "h-[18px] w-[18px]";
  const travel = size === "sm" ? "translate-x-[18px]" : "translate-x-[22px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors disabled:opacity-35 ${track} ${
        on ? "bg-ink" : "bg-white"
      }`}
    >
      <span
        className={`inline-block transform rounded-full transition-transform ${knob} ${
          on ? `${travel} bg-white` : "translate-x-[2px] bg-ink"
        }`}
      />
    </button>
  );
}
