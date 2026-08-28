"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "./fieldLook";

/**
 * A `time` column, shown the way a person writes one.
 *
 * Postgres hands `event_time` back as `10:00:00`, and that is nobody's pickup
 * time — FileMaker printed "after 10:00 AM" on the quote this customer
 * received, and the list already renders "10:00 AM". A plain `InlineValue`
 * showed the raw column, so the record and the list disagreed about the same
 * field.
 *
 * IT IS A CLIENT COMPONENT BECAUSE OF `format`, and that is the whole reason
 * the file exists. `InlineValue`'s `format` is a FUNCTION, and passing one from
 * a server component throws "Functions cannot be passed directly to Client
 * Components" at runtime — TypeScript and lint both pass on it (CLAUDE.md names
 * this as a bug only rendering catches). The order record is a server
 * component, so the cell it needs has to be one of these.
 *
 * Editing still accepts anything Postgres can parse — "9am", "14:30", "2:30
 * PM" — because `format` is display-only and never touches what is typed.
 */
export function TimeCell({
  id,
  column,
  value,
  label,
  canWrite,
  /**
   * AN EMPTY TIME SHOWS NOTHING (Mark, 2026-08-28: "remove the example text in
   * time fields when the field is blank — it makes it look filled when it's
   * not").
   *
   * It used to default to "10:30 AM", and "9:00 AM" on Ready by. Muted grey in
   * a bare cell reads as a hint; muted grey INSIDE A BOX reads as a value
   * somebody typed and the app has greyed out — which on a pickup time is a
   * claim about when the customer is coming. The box is what changed it, so
   * the example goes.
   *
   * `""` and not undefined: `InlineValue` renders a non-breaking space for an
   * empty placeholder, which keeps the line box — without it the button has no
   * height to click, and here it would be an empty 32px box with nothing to
   * aim at.
   */
  placeholder = "",
  boxed = BOXED_FIELDS,
}: {
  id: string;
  column: string;
  value: string | null;
  label: string;
  canWrite: boolean;
  placeholder?: string;
  boxed?: boolean;
}) {
  if (!canWrite) {
    return <span className={READ_ONLY_VALUE}>{formatClock(value) ?? "—"}</span>;
  }
  return (
    <InlineValue
      table="special_orders"
      id={id}
      column={column}
      value={value}
      ariaLabel={label}
      placeholder={placeholder}
      boxed={boxed}
      format={(v) => formatClock(String(v)) ?? String(v)}
    />
  );
}

/**
 * `10:00:00` → `10:00 AM`. Returns null for an empty value so the caller can
 * choose its own em dash, and returns the input UNTOUCHED when it doesn't look
 * like a time — a column somebody has typed prose into should show the prose,
 * not a mangled guess at it.
 */
export function formatClock(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return value;
  const hour = Number(m[1]);
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${m[2]} ${suffix}`;
}
