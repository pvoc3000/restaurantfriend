/**
 * Tip pooling, per shop per business day.
 *
 * Mark's rule, in his words: *"add up all tips for that location for that day,
 * divide it by all the (non-excluded) hours worked at that location for that
 * day, and the result is a dollar amount for every tip hour worked."*
 *
 *     tip_rate   = pooled_tips ÷ Σ non-excluded tip hours
 *     allocation = that person's tip hours × tip_rate
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING IS INTEGER CENTS, AND THAT IS THE WHOLE DESIGN
 *
 * The allocations must sum to the pool EXACTLY, or the shop pays out more or
 * less than Square collected — every day, forever. Floating point cannot
 * promise that; integers can. So the pool arrives in cents, the arithmetic
 * stays in cents, and the rounding is done explicitly rather than left to
 * `toFixed`.
 *
 * The rule for the remainder is stated rather than incidental: give each person
 * their floor, then hand the leftover cents out one at a time to the largest
 * fractional remainders, ties broken by MORE tip hours and then by id ascending.
 * The deterministic tiebreak is not fussiness — it is what makes a re-run
 * reproduce the frozen snapshot exactly, which is what decision 10 rests on.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS A TIP HOUR
 *
 * Hours WORKED — clock to clock minus the unpaid meal. Overtime hours count
 * (you were on the floor). Sick hours do not (you weren't). The whole shop
 * shares, back of house included: the overnight baker is in the pool, confirmed
 * explicitly.
 */

import { effectiveExclusion } from "./timesheets";

export type TipShift = {
  id: string;
  /** Hours worked. Sick hours must NOT be included — see the header. */
  hours: number;
  /** `timesheets.exclude_tips` — the tri-state. */
  excludeShift: boolean | null;
  /** `employees.excludes_tips` — the durable person-level flag. */
  excludePerson: boolean;
};

export type Allocation = {
  id: string;
  tipHours: number;
  cents: number;
};

export type PoolResult = {
  /** Dollars-per-hour × 100,000, so the rate itself keeps its precision. */
  rateMillicents: number;
  /** Cents that had to be handed out beyond everyone's floor. Shown on screen. */
  residualCents: number;
  /** Who got the residual cents, in the order they were given. For the screen. */
  residualTo: string[];
  allocations: Allocation[];
  /** Non-excluded hours the rate was computed over. */
  totalTipHours: number;
  /** Cents that could not be allocated because nobody was eligible. */
  unallocatedCents: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Divide one day's pooled tips at one shop.
 *
 * `pooledCents` is GROSS — not net of Square's processing fee, because
 * California doesn't let the fee come out of tips.
 */
export function allocateTips(pooledCents: number, shifts: readonly TipShift[]): PoolResult {
  const eligible = shifts.filter(
    (s) => s.hours > 0 && !effectiveExclusion(s.excludeShift, s.excludePerson)
  );

  const totalTipHours = round2(eligible.reduce((n, s) => n + s.hours, 0));

  if (pooledCents <= 0 || totalTipHours <= 0) {
    // Nobody eligible, or nothing to share. Saying so explicitly — with the
    // money named as unallocated — beats returning zeros that look like a
    // successful division of nothing.
    return {
      rateMillicents: 0,
      residualCents: 0,
      residualTo: [],
      allocations: eligible.map((s) => ({ id: s.id, tipHours: round2(s.hours), cents: 0 })),
      totalTipHours,
      unallocatedCents: pooledCents > 0 ? pooledCents : 0,
    };
  }

  // The rate, kept at higher precision than a cent so the figure on screen is
  // the one the arithmetic actually used.
  const rateMillicents = Math.round((pooledCents * 1000) / totalTipHours);

  // Everyone's floor, and what they were owed beyond it.
  const rows = eligible.map((s) => {
    const exact = (pooledCents * s.hours) / totalTipHours;
    const floor = Math.floor(exact);
    return { id: s.id, hours: s.hours, floor, remainder: exact - floor };
  });

  const distributed = rows.reduce((n, r) => n + r.floor, 0);
  const shortfall = pooledCents - distributed;

  // Largest fractional remainder first; ties to MORE tip hours; then id
  // ascending. Every step of that is deterministic, which is what lets a re-run
  // reproduce a frozen snapshot rather than merely resemble it.
  const order = [...rows].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (b.hours !== a.hours) return b.hours - a.hours;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const extra = new Map<string, number>();
  const residualTo: string[] = [];
  for (let i = 0; i < shortfall && i < order.length; i++) {
    extra.set(order[i].id, (extra.get(order[i].id) ?? 0) + 1);
    residualTo.push(order[i].id);
  }

  const allocations: Allocation[] = rows.map((r) => ({
    id: r.id,
    tipHours: round2(r.hours),
    cents: r.floor + (extra.get(r.id) ?? 0),
  }));

  return {
    rateMillicents,
    residualCents: shortfall,
    residualTo,
    allocations,
    totalTipHours,
    unallocatedCents: 0,
  };
}

/** The rate as a readable "$1.234 / hour". */
export function formatRate(rateMillicents: number): string {
  return `$${(rateMillicents / 100000).toFixed(3)}`;
}

/** Cents as "$12.34". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Dollars typed by a human → integer cents.
 *
 * What this buys over `Math.round(parseFloat(v) * 100)` is REFUSAL, not
 * precision. (I first wrote that the naive version mis-reads 4.35 because it is
 * 4.3499999… in binary — it does compute 434.99999999999994, but `Math.round`
 * rescues it, and for every two-decimal input the two agree. Checked before
 * shipping the claim.)
 *
 * The real difference is at the edges. `parseFloat("2.675")` happily becomes
 * 268 cents, silently inventing a figure the person did not type and breaking
 * the one promise this module makes — that the allocations sum to the pool the
 * shop actually collected. `parseFloat("12 dollars")` becomes 1200. This
 * returns null for both, so the screen can say so.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (trimmed === "") return null;
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  if (whole === "" && frac === "") return null;
  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0");
  return sign ? -cents : cents;
}
