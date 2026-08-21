/**
 * HOW FAR ALONG AN ORDER IS — the list's row progress bar (Mark, 2026-08-20).
 *
 * Pure and fixture-tested. Nothing here touches the database or the DOM.
 *
 * ---------------------------------------------------------------------------
 * SIX STAGES, AND THEY ARE MARK'S, not the seven the stage columns print.
 *
 * The seven date columns are not a ladder: measured over the 8,321 real orders,
 * only **32%** fill a clean prefix and **68%** have a later stamp before an
 * earlier one. Two of the seven cause nearly all of it — `delivery_scheduled_at`
 * is filled on 11% of orders because 82% are pickups (of 6,846 pickups, NINE
 * ever booked a delivery), and `order_scheduled_at` on 23%.
 *
 * Mark's six drops the delivery booking and folds scheduling into printing, and
 * that is measurably a ladder: **88.6% prefix-clean**. It is what a bar can
 * honestly be drawn over.
 *
 * TWO THINGS HE WAS OFFERED AND DECLINED, recorded because they will look like
 * oversights to the next reader:
 *
 *   · **Stage 6 is printed AND scheduled, not OR.** `order_printed_at` is 64%,
 *     `order_scheduled_at` 23%, both 22.7% — so 41% of orders that WERE printed
 *     sit at 5 of 6 permanently. That is deliberate: production scheduling is
 *     the real last step, and an order that was printed but never scheduled has
 *     not finished.
 *   · **There is no Receipt stage**, though `receipt_sent_at` is filled on
 *     58.4% of orders. The ladder ends where the kitchen's work does.
 *
 * ---------------------------------------------------------------------------
 * STAGE ONE IS "LEAD" AND IS ALWAYS DONE. An order that exists has reached it,
 * so the bar never renders as an empty track — a row with nothing stamped still
 * shows a sliver, which reads as "started" where zero reads as "broken".
 *
 * ---------------------------------------------------------------------------
 * THE STATUS SETS A FLOOR, AND THE DATES CAN ONLY PUSH IT FURTHER (Mark,
 * 2026-08-20: "once an order is set to 'order', then it should jump to stage
 * 5").
 *
 * That is not a new rule — it is the app's own vocabulary, already written down
 * in `STATUS_HINT` and now believed by the bar:
 *
 *     lead     "gathering information"                    → rung 1
 *     quote    "quote prepared or sent, awaiting approval" → rung 2
 *     invoice  "Square invoice sent, awaiting payment"     → rung 4
 *     order    "PAID — printing and scheduling remain"     → rung 5
 *
 * The status is the record's own claim about where it has got to; the dates are
 * how it got there. When they disagree the status wins, because plenty of real
 * orders reach a rung without ever stamping it: 925 orders at status `order`
 * have no quote date and 770 have no payment date — wholesale and standing
 * orders, billed weekly, which never pass through a quote at all. Measured, the
 * floor moves **1,501 of the 6,664 committed orders (23%)** off a bar that made
 * finished work look unfinished.
 *
 * THE FLOOR FILLS THE TICKS TOO, not just the count. If it only raised the
 * number, the strip would show gaps while the bar said five — and a list whose
 * two readings of one fact disagree is worse than either alone.
 */

import {
  STAGES,
  stageState,
  DEFAULT_ATTENTION,
  type AttentionOrder,
  type AttentionThresholds,
  type StageState,
} from "./specialOrders";

export type ProgressTick = {
  key: string;
  label: string;
  state: StageState;
};

export type OrderProgress = {
  /** How many of the six are done, 1..6 — never 0; see the header. */
  done: number;
  total: number;
  /** `done / total`, 0.1666…1. */
  fraction: number;
  ticks: ProgressTick[];
  /**
   * What the row's wash says, and the three cases are Mark's:
   *   · `progress` — the yellow→green ramp;
   *   · `flagged`  — FULL WIDTH and red, whatever the stages say, because a
   *     flagged order is not a progress question;
   *   · `none`     — cancelled. No bar at all, and the row greys out. An order
   *     that was called off is not partly done, it is not happening.
   */
  tone: "progress" | "flagged" | "none";
};

/** The ladder. `stages` names which of `STAGES` each rung reads. */
const LADDER: { key: string; label: string; stages: string[] }[] = [
  { key: "lead", label: "Lead", stages: [] },
  { key: "quote_sent", label: "Quote sent", stages: ["quote_sent"] },
  { key: "quote_returned", label: "Quote returned", stages: ["quote_returned"] },
  { key: "invoice_sent", label: "Invoice sent", stages: ["invoice_sent"] },
  { key: "invoice_paid", label: "Invoice paid", stages: ["invoice_paid"] },
  // The one compound rung. Both stamps, per Mark — see the header.
  { key: "made", label: "Printed & scheduled", stages: ["order_printed", "order_scheduled"] },
];

/** The labels, in order — the list's footer key. */
export const PROGRESS_LABELS = LADDER.map((l) => l.label);

/**
 * How many rungs a status asserts on its own, from `STATUS_HINT`. See the
 * header. Anything unrecognised claims nothing and leaves the dates to speak.
 */
const STATUS_FLOOR: Record<string, number> = {
  lead: 1,
  quote: 2,
  invoice: 4,
  order: 5,
};

/**
 * The state of one rung.
 *
 * It DELEGATES to `stageState` rather than re-deciding, which is what keeps the
 * strip and the seven stage columns from ever disagreeing about the same order.
 * A compound rung takes the WORSE of its two — done only when both are done,
 * and overdue if either is, because the rung is not finished until both are.
 */
function rungState(
  order: AttentionOrder,
  keys: string[],
  today: string,
  thresholds: AttentionThresholds
): StageState {
  if (keys.length === 0) return "done"; // Lead: the order exists.
  const states = keys.map((k) => {
    const stage = STAGES.find((s) => s.key === k);
    return stage ? stageState(order, stage, today, thresholds) : null;
  });
  if (states.every((s) => s === "done")) return "done";
  if (states.includes("overdue")) return "overdue";
  if (states.includes("waiting")) return "waiting";
  return null;
}

export function orderProgress(
  order: AttentionOrder & { status?: string | null; flag_reason?: string | null },
  today: string,
  thresholds: AttentionThresholds = DEFAULT_ATTENTION
): OrderProgress {
  const floor = STATUS_FLOOR[order.status ?? ""] ?? 1;
  const ticks = LADDER.map((rung, i) => ({
    key: rung.key,
    label: rung.label,
    // The floor fills the tick, not just the count — see the header.
    state: i < floor ? ("done" as const) : rungState(order, rung.stages, today, thresholds),
  }));
  // Counted from the TICKS, so the strip and the wash cannot disagree.
  const done = ticks.filter((t) => t.state === "done").length;
  const total = LADDER.length;

  // Cancelled beats flagged: an order called off is not an open problem, and
  // 705 of the real orders are cancelled while a flag is cleared as soon as it
  // is dealt with.
  const tone: OrderProgress["tone"] =
    order.status === "cancelled" ? "none" : order.flag_reason ? "flagged" : "progress";

  return { done, total, fraction: done / total, ticks, tone };
}

/* ==========================================================================
 * THE COLOUR
 * ========================================================================== */

/** The app's own tokens: `--rf-yellow-500` and `--rf-green-500`. */
const YELLOW: [number, number, number] = [255, 212, 0];
const GREEN: [number, number, number] = [74, 156, 63];
const RED: [number, number, number] = [210, 0, 0];

/**
 * WHY 20% AND NOT A TAILWIND CLASS. The wash is a computed FRACTION of the row,
 * so it has to be an inline gradient — there is no set of utilities that covers
 * a hundred widths. 20% is Mark's number, measured against the muted greys in
 * the row rather than chosen: the alpha at which the ramp still reads across
 * fifty rows without the date and total columns starting to struggle.
 */
export const WASH_ALPHA = 0.2;

/** Yellow at the first rung, green at the last, mixed in between. */
export function progressColor(fraction: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, fraction));
  return [0, 1, 2].map((i) => Math.round(YELLOW[i] + (GREEN[i] - YELLOW[i]) * t)) as [
    number,
    number,
    number,
  ];
}

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

/**
 * WHERE EACH RUNG'S BAR STOPS, snapped to a column rule (Mark, 2026-08-20: "can
 * the length of the progress bar always land on a border between columns? …It
 * looks a bit off when a column is partially colored").
 *
 * A bar ending mid-cell reads as a rendering fault rather than as a
 * measurement — the eye takes a vertical rule as the edge of a thing, and a
 * wash that stops just short of one looks like it failed to reach it.
 *
 * THE SNAP IS NEAREST-BOUNDARY, FORCED STRICTLY INCREASING, and the second half
 * is what makes it safe. Nearest alone can send two adjacent rungs to the same
 * rule whenever a column is wide — the customer column is the widest here — and
 * then 2 of 6 and 3 of 6 draw identically, which is worse than landing
 * mid-cell: the bar stops distinguishing the thing it exists to show. Walking
 * the rungs in order and refusing a stop that is not past the last one costs
 * nothing and cannot collapse.
 *
 * IT RETURNS null WHEN IT CANNOT, rather than snapping badly. With fewer rules
 * than rungs — a reader who has hidden the table down to five columns —
 * "strictly increasing" is unsatisfiable, and the honest answer is the
 * unsnapped fraction.
 *
 * The last rung always takes the last boundary, which is the table's own right
 * edge, so a finished order fills the row exactly.
 */
export function snapStops(total: number, boundaries: number[]): number[] | null {
  const rules = boundaries.filter((b) => b > 0 && b <= 1);
  if (rules.length < total) return null;

  const stops: number[] = [];
  let from = 0; // the index of the first rule still available
  for (let rung = 1; rung <= total; rung++) {
    // The last rung is the table's right edge, always.
    if (rung === total) {
      stops.push(rules[rules.length - 1]);
      break;
    }
    const want = rung / total;
    // Leave enough rules behind for the rungs that follow, or the tail has
    // nowhere to go and the run stops being increasing.
    const last = rules.length - (total - rung);
    let best = from;
    for (let i = from; i <= last; i++) {
      if (Math.abs(rules[i] - want) < Math.abs(rules[best] - want)) best = i;
    }
    stops.push(rules[best]);
    from = best + 1;
  }
  return stops;
}

/**
 * The row's background, as TWO layers on one element: the 3px edge rule at the
 * bottom and the wash above it. Both are painted on the ROW, so both span its
 * full width — anchoring either to a cell makes it as wide as that column,
 * which is exactly how the first mockup came out wrong.
 *
 * Returns null when there should be no bar at all, so the caller can hand
 * `undefined` to the table and leave the row untouched.
 */
export function progressRowStyle(
  p: OrderProgress,
  /** The column rules, from `DataTable`'s `rowStyle` layout. Omit to fill to
   *  the raw fraction — which is what happens when there are too few rules. */
  boundaries: number[] = []
): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
} | null {
  if (p.tone === "none") return null;

  const solid = p.tone === "flagged" ? RED : progressColor(p.fraction);
  const snapped = snapStops(p.total, boundaries);
  // The COLOUR still runs off the true fraction — only the LENGTH snaps, so
  // the ramp stays even across the six rungs however the columns are dragged.
  const width = snapped ? snapped[p.done - 1] : p.fraction;
  const stop = p.tone === "flagged" ? "100%" : `${(width * 100).toFixed(3)}%`;
  const wash = rgba(solid, p.tone === "flagged" ? 0.15 : WASH_ALPHA);

  return {
    backgroundImage: [
      `linear-gradient(to right, ${rgba(solid, 1)} ${stop}, rgba(0,0,0,0.05) ${stop})`,
      `linear-gradient(to right, ${wash} ${stop}, transparent ${stop})`,
    ].join(", "),
    backgroundSize: "100% 3px, 100% 100%",
    backgroundPosition: "left bottom, left top",
    backgroundRepeat: "no-repeat",
  };
}
