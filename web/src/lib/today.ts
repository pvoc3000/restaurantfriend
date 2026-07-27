// "What day is it" — in the ORG's timezone, never the host's.
//
// This lives on its own because more than one screen needs it and the two must
// not drift: the order guide derives the guide date and weekday from it
// (orgs.settings.timezone, migration 007 — without it a UTC host rolls the
// guide date at 5pm local), and the PO list's Today window has exactly the same
// exposure. A "Today" filter computed in UTC starts showing tomorrow's date
// mid-afternoon Pacific and hides the orders you just generated.

/** The host's zone, as the fallback when the org hasn't set one. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Today's calendar date in `timeZone`, as YYYY-MM-DD (what Postgres `date` wants). */
export function todayInTimeZone(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is the shape we need.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * `days` before that calendar date, same format. Done as UTC midnight
 * arithmetic on the already-localised date, so no second timezone conversion
 * can creep in and shift it back.
 */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
