/**
 * The two-week history of one production item — production brief phase 5.
 *
 * FileMaker's Donuts screen carried a fortnight of what was made and what came
 * back, and it is the one figure that tells you whether a par is right. No
 * history migrates (the fresh-start decision), so this fills from launch and is
 * empty until somebody counts a night.
 *
 * Everything here is pure. `sold` is NOT among it: that is defined once, in
 * SQL, by `v_production_schedule_lines`, and this module reads it rather than
 * recomputing it — one definition, and one place for a POS feed to land.
 */

/** One line of one night, as the view hands it over. */
export type HistoryLine = {
  schedule_date: string;
  location_id: string;
  par: number;
  made: number | null;
  leftover: number | null;
  sold: number | null;
};

/** One calendar day in the window, whether or not anything happened on it. */
export type HistoryDay = {
  date: string;
  /** Was this item on a schedule that day at all? */
  scheduled: boolean;
  /** Did somebody count it? DIFFERENT from `scheduled` — see below. */
  counted: boolean;
  /** How many shops carried it that day. Two shops on one night are ONE day. */
  shops: number;
  par: number;
  made: number | null;
  leftover: number | null;
  sold: number | null;
};

export type HistorySummary = {
  daysScheduled: number;
  /** The divisor every average below is over. Reported, never assumed. */
  daysCounted: number;
  made: number;
  leftover: number;
  sold: number;
  /** Mean sold per COUNTED night, or null when nothing has been counted. */
  soldPerNight: number | null;
};

/**
 * The `days` calendar dates ending on `today`, oldest first.
 *
 * String arithmetic through a UTC-anchored Date, never `new Date(iso)`: that
 * parses as UTC midnight, which is the PREVIOUS day everywhere west of
 * Greenwich, and would silently shift a shop's whole fortnight by one.
 */
export function historyWindow(
  today: string,
  days = 14
): { from: string; to: string; dates: string[] } {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(today, -i));
  return { from: dates[0], to: today, dates };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The window's lines folded onto its dates — DENSE, one slot per calendar day.
 *
 * The density is the point. A day with no schedule and a day that was scheduled
 * and never counted are DIFFERENT SENTENCES — "we didn't make it" against "we
 * made it and nobody wrote down what came back" — and a list built only from
 * the rows that exist can say neither, because both are absences.
 *
 * A day is ONE ROW however many shops carried the item, because a par of 18 at
 * each of two shops is 36 donuts on one Tuesday. That is the same rule the plan
 * matrix states about overlapping plans: pars SUM.
 *
 * `made`, `leftover` and `sold` stay NULL on a day nobody counted, rather than
 * summing to zero — a zero is a measurement, and "nobody looked" is not one.
 * Where SOME shops counted and others didn't, the total is over the ones that
 * did, which is the only honest reading available.
 */
export function bucketByDay(lines: HistoryLine[], dates: string[]): HistoryDay[] {
  const byDate = new Map<string, HistoryLine[]>();
  for (const l of lines) {
    const run = byDate.get(l.schedule_date);
    if (run) run.push(l);
    else byDate.set(l.schedule_date, [l]);
  }

  return dates.map((date) => {
    const run = byDate.get(date) ?? [];
    const counted = run.filter((l) => l.made !== null || l.leftover !== null);
    const sum = (pick: (l: HistoryLine) => number | null) =>
      counted.length === 0
        ? null
        : counted.reduce((n, l) => n + (pick(l) ?? 0), 0);

    return {
      date,
      scheduled: run.length > 0,
      counted: counted.length > 0,
      // The shops that CARRIED it, not the ones that counted — the question is
      // how widely it was on sale.
      shops: new Set(run.map((l) => l.location_id)).size,
      par: run.reduce((n, l) => n + (Number(l.par) || 0), 0),
      made: sum((l) => l.made),
      leftover: sum((l) => l.leftover),
      sold: sum((l) => l.sold),
    };
  });
}

/**
 * The window in one line.
 *
 * `soldPerNight` divides by the nights actually COUNTED, and `daysCounted` is
 * returned so the screen can say so. Dividing by the window length instead —
 * fourteen — turns five counted nights into a figure two-thirds too low that
 * looks entirely plausible, which is the same class of mistake as reporting a
 * lower-bound cost as though it were a number.
 */
export function summarise(days: HistoryDay[]): HistorySummary {
  const counted = days.filter((d) => d.counted);
  const total = (pick: (d: HistoryDay) => number | null) =>
    counted.reduce((n, d) => n + (pick(d) ?? 0), 0);

  const sold = total((d) => d.sold);
  return {
    daysScheduled: days.filter((d) => d.scheduled).length,
    daysCounted: counted.length,
    made: total((d) => d.made),
    leftover: total((d) => d.leftover),
    sold,
    soldPerNight: counted.length === 0 ? null : sold / counted.length,
  };
}

/** "Tue 8/12" — the packet's own date voice, one size down. */
export function historyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
