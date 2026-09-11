/**
 * TYPING A TIME — the parse behind `ui/TimePicker`'s entry field.
 *
 * Mark, 2026-09-10: "make sure to have a field at the bottom of it where the
 * user can enter a time directly." `lib/dateInput`'s job for a time of day, and
 * its shape for the same reason: pure — no DOM, no React — so it is compiled
 * into the Node fixture run.
 *
 * ------------------------------------------------------------------------
 * WHAT IT ACCEPTS.
 *
 * WITH AM/PM, the hour is 1–12: `9pm`, `9 PM`, `9:30p`, `9:30 p.m.`, `930p`.
 * WITHOUT, the hour is 24-hour: `21:30`, `2130`, `9:30` (morning), `0:15`.
 * Plus `noon` and `midnight`, which are how people say the two times the
 * twelve-hour clock makes ambiguous.
 *
 * NO GUESSING THE HALF OF THE DAY. `9:30` with no suffix is 09:30, never "the
 * PM one because it's a closing time". A picker that read the column it sat in
 * would be right on the hours block and silently wrong in the next place it is
 * used; one stated rule is the one that stays right.
 *
 * `12am` is 00:00 and `12pm` is 12:00 — the convention every clock uses and the
 * one most often got backwards.
 *
 * ------------------------------------------------------------------------
 * THREE ANSWERS, NOT TWO, `lib/dateInput`'s reason: an EMPTY box is somebody
 * clearing the time, which writes null, where unreadable text is a typo, and
 * writing null for it would erase the time they were correcting.
 */

export type TypedTime =
  | { status: "empty" }
  | { status: "time"; hhmm: string }
  | { status: "invalid" };

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:MM`, or null when the parts are not a time of day. */
function compose24(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** A twelve-hour hour (1–12) and a half of the day, as a 24-hour hour. */
function to24(hour12: number, meridiem: Meridiem): number | null {
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (meridiem === "am") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export type Meridiem = "am" | "pm";

export function parseTypedTime(raw: string): TypedTime {
  // Spaces and dots are formatting, never meaning: "9:30 p.m." is "9:30pm".
  const text = raw.trim().toLowerCase().replace(/[\s.]/g, "");
  if (text === "") return { status: "empty" };
  if (text === "noon") return { status: "time", hhmm: "12:00" };
  if (text === "midnight") return { status: "time", hhmm: "00:00" };

  // `9`, `9:30`, `09:30`, with an optional am/pm.
  // `930`, `0930`, `2130` — digits only, the last two are the minute.
  const colon = /^(\d{1,2})(?::(\d{2}))?(a|am|p|pm)?$/.exec(text);
  const compact = colon ? null : /^(\d{3,4})(a|am|p|pm)?$/.exec(text);
  if (!colon && !compact) return { status: "invalid" };

  let hour: number;
  let minute: number;
  let suffix: string | undefined;
  if (colon) {
    hour = Number(colon[1]);
    minute = colon[2] === undefined ? 0 : Number(colon[2]);
    suffix = colon[3];
  } else {
    const digits = compact![1];
    hour = Number(digits.slice(0, -2));
    minute = Number(digits.slice(-2));
    suffix = compact![2];
  }

  let hour24: number | null = hour;
  if (suffix) {
    hour24 = to24(hour, suffix.startsWith("a") ? "am" : "pm");
    if (hour24 === null) return { status: "invalid" };
  }
  const hhmm = compose24(hour24, minute);
  return hhmm === null ? { status: "invalid" } : { status: "time", hhmm };
}

/**
 * The three parts a picker shows, from a stored value.
 *
 * Accepts `HH:MM:SS` too — what a Postgres `time` column reads back. Null when
 * there is no time or it cannot be read.
 */
export function timeParts(
  value: string | null
): { hour12: number; minute: number; meridiem: Meridiem } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (compose24(hour, minute) === null) return null;
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    minute,
    meridiem: hour < 12 ? "am" : "pm",
  };
}

/** The inverse of `timeParts`: `HH:MM`, or null for parts that are not a time. */
export function composeTime(hour12: number, minute: number, meridiem: Meridiem): string | null {
  const hour = to24(hour12, meridiem);
  return hour === null ? null : compose24(hour, minute);
}

/** `10:00:00` → `10:00 AM`; null or unreadable → "". What the field shows. */
export function formatTypedTime(value: string | null): string {
  const parts = timeParts(value);
  if (!parts) return "";
  return `${parts.hour12}:${pad(parts.minute)} ${parts.meridiem.toUpperCase()}`;
}
