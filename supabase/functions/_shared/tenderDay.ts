/**
 * WHICH SHOP-DAY A SQUARE PAYMENT BELONGS TO — the rule, pure.
 *
 * A PAYMENT FOLLOWS THE DATE OF ITS SALE, NOT THE DATE IT WAS PROCESSED (Mark,
 * 2026-10-07). The two differ whenever a register takes payments OFFLINE: the
 * Sales cube dates the order when it was rung up, PaymentMethods dates the
 * payment when it reached Square. On 2026-10-06 the DF01 HP register was
 * offline from 5:20 PM to 9:07 PM and its 37 payments ($458.85) uploaded at
 * 6:35 AM the next morning, so that day's sales had no tender behind them and
 * the journal entry was refused, $458.85 apart.
 *
 * MEASURED before it was written (both shops, 2026-08-01 → 10-06, 134
 * shop-days, against `Sales.total_collected_amount`): by the payment's own
 * hour, 1 day off; by the order's reporting day, 0 — and the rule moved those
 * 37 payments and nothing else.
 *
 * No imports, so the fixture build can compile it (`tenderDay.fixtures.ts`).
 */

/**
 * How far either side of the window the sync reads. BEHIND, so a sync of one
 * day knows that a payment processed that morning belongs to an order from the
 * night before; AHEAD, so a sync of the night before finds it. Square holds an
 * offline payment for a day or so at most — a week is slack, and costs a few
 * thousand rows.
 */
export const TENDER_REACH_DAYS = 7;

/** Days per request. A fortnight of both shops is about 4,000 orders. */
export const TENDER_CHUNK_DAYS = 14;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `[from, to]` cut into consecutive pieces of at most `size` days. */
export function chunkDays(from: string, to: string, size: number): [string, string][] {
  const out: [string, string][] = [];
  for (let a = from; a <= to; a = addDays(a, size)) {
    const b = addDays(a, size - 1);
    out.push([a, b < to ? b : to]);
  }
  return out;
}

/**
 * The reporting day a raw local timestamp falls in. The cube writes LOCAL wall
 * time as if it were UTC, so subtracting the rollover in UTC gives the date
 * directly. Null when the timestamp cannot be read.
 */
export function hourReportingDay(rawLocal: unknown, rolloverHour: number): string | null {
  if (typeof rawLocal !== "string" || !rawLocal) return null;
  const t = new Date(rawLocal.endsWith("Z") ? rawLocal : `${rawLocal}Z`);
  if (Number.isNaN(t.getTime())) return null;
  t.setUTCHours(t.getUTCHours() - rolloverHour);
  return t.toISOString().slice(0, 10);
}

/**
 * Order → its reporting day, from Sales rows of (location, order, day).
 * An order Square reports on MORE THAN ONE day is left out, so its payments
 * keep their own date — none was seen in 17,740 orders, and guessing which
 * day would be worse than not moving it.
 */
export function orderDays(
  rows: readonly { loc: string; orderId: string; day: string }[]
): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const r of rows) {
    if (!r.loc || !r.orderId || !r.day) continue;
    const key = orderKey(r.loc, r.orderId);
    const had = seen.get(key);
    if (had === undefined) seen.set(key, r.day);
    else if (had !== r.day) seen.set(key, null);
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

export function orderKey(loc: string, orderId: string): string {
  return `${loc}|${orderId}`;
}

/**
 * The shop-day a tender row is counted on.
 *
 * A PAYMENT goes to its order's reporting day. Everything else stays on its
 * own date: a REFUND, because Square reports the return on the day it was
 * given and not on the day of the original sale; and a payment whose order
 * the Sales cube does not carry, because there is no sale to follow.
 */
export function tenderDay(input: {
  /** The payment's own reporting day, from `hourReportingDay`. */
  ownDay: string;
  /** `PaymentMethods.type` — PAYMENT or REFUND. */
  type: string;
  /** The order's reporting day, if Sales carries the order. */
  orderDay: string | undefined;
}): string {
  if (input.type !== "PAYMENT") return input.ownDay;
  return input.orderDay ?? input.ownDay;
}
