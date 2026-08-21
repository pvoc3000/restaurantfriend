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
  const ticks = LADDER.map((rung) => ({
    key: rung.key,
    label: rung.label,
    state: rungState(order, rung.stages, today, thresholds),
  }));
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
 * The row's background, as TWO layers on one element: the 3px edge rule at the
 * bottom and the wash above it. Both are painted on the ROW, so both span its
 * full width — anchoring either to a cell makes it as wide as that column,
 * which is exactly how the first mockup came out wrong.
 *
 * Returns null when there should be no bar at all, so the caller can hand
 * `undefined` to the table and leave the row untouched.
 */
export function progressRowStyle(p: OrderProgress): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
} | null {
  if (p.tone === "none") return null;

  const solid = p.tone === "flagged" ? RED : progressColor(p.fraction);
  const stop = p.tone === "flagged" ? "100%" : `${(p.fraction * 100).toFixed(3)}%`;
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
