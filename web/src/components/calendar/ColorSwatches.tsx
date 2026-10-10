"use client";

import { CALENDAR_PALETTE, type CalendarColor } from "@/lib/calendarColors";

/**
 * THE CALENDAR'S COLOUR PICKER — the palette as a row of swatches.
 *
 * One of N, all of them visible, answered once: `ui/Radio`'s job, drawn as
 * dots because the answer IS a colour and a word list of twelve colour names
 * is the slow way to choose one. A real `radiogroup` of native radios, so the
 * arrow keys move the choice and a screen reader says each colour's name.
 *
 * `allowDefault` adds a first, empty swatch for "no colour of its own" — an
 * entry or a subscribed calendar that wears its layer's colour. `value` null
 * is that state.
 */
export function ColorSwatches({
  value,
  onChange,
  ariaLabel,
  name,
  allowDefault = false,
  defaultLabel = "Layer colour",
  disabled = false,
}: {
  value: CalendarColor | null;
  onChange: (next: CalendarColor | null) => void;
  ariaLabel: string;
  /** Shared by the group's radios; unique on the page. */
  name: string;
  allowDefault?: boolean;
  defaultLabel?: string;
  disabled?: boolean;
}) {
  const ring = "peer-checked:ring-2 peer-checked:ring-ink peer-checked:ring-offset-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ink";
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-3">
      {allowDefault && (
        <label className="relative cursor-pointer" title={defaultLabel}>
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value === null}
            disabled={disabled}
            onChange={() => onChange(null)}
          />
          <span
            className={`block h-6 rounded-full border border-ink bg-white px-2 text-[11px] font-medium leading-[22px] text-ink ${ring}`}
          >
            {defaultLabel}
          </span>
        </label>
      )}
      {CALENDAR_PALETTE.map((c) => (
        <label key={c.key} className="relative cursor-pointer" title={c.label}>
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value === c.key}
            disabled={disabled}
            onChange={() => onChange(c.key)}
          />
          <span aria-hidden className={`block h-6 w-6 rounded-full ${c.swatch} ${ring}`} />
          <span className="sr-only">{c.label}</span>
        </label>
      ))}
    </div>
  );
}
