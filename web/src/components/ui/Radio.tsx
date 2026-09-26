"use client";

import { useId, type ReactNode } from "react";

/**
 * THE APP'S RADIO BUTTONS — a one-of-N choice made ONCE, inside a form (Mark,
 * 2026-09-24, on Create Invoice's Square / QuickBooks: "i'm not liking the
 * tabpicker … I don't think a picklist is a great option either").
 *
 * WHICH ONE-OF-N CONTROL, then:
 *   · `ui/TabPicker` — a place you are or a view you switch between, and every
 *     filter. Tabs say "you are looking at this".
 *   · `ui/PickList` — a long or open vocabulary, where the options would not
 *     fit on screen.
 *   · `ui/Radio` — two to five options, all visible, a SETTING of the record
 *     being made, answered once. Radios say "this is what it will be".
 *
 * The classic Mac radio, `ui/Checkbox`'s partner drawn by `.mac-radio` in
 * `styles/mac-look.css`: native `<input type="radio">`s sharing a name, so the
 * arrow keys move the choice and a screen reader announces the group — the
 * group is a `radiogroup` named by `ariaLabel`. Horizontal by default (short
 * labels side by side, as Create Invoice has); `vertical` for options with
 * longer words.
 */
export function Radio<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  vertical = false,
  disabled = false,
  className = "",
}: {
  /** `after` sits beside the label, OUTSIDE it — a field that belongs to that
   *  option (New Payment's amounts). A label must not contain another input. */
  options: readonly { value: K; label: ReactNode; after?: ReactNode }[];
  value: K;
  onChange: (next: K) => void;
  /** Names the group for a screen reader — the caption above it, usually. */
  ariaLabel: string;
  vertical?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex ${vertical ? "flex-col gap-1" : "flex-wrap items-center gap-x-6 gap-y-1"} ${className}`}
    >
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        return (
          <span key={o.value} className="mac-radio text-[14px]">
            <input
              id={id}
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <label htmlFor={id}>{o.label}</label>
            {o.after ? <span className="ml-2 inline-flex flex-wrap items-center gap-2">{o.after}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
