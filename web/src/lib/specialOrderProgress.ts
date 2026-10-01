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
 * STAGE ONE IS "LEAD" AND IS ALWAYS DONE — an order that exists has reached it.
 * It is a TICK on the strip and it DRAWS NO BAR (Mark, 2026-08-21: "Stage 1
 * (leads) should have no visible progress bar. Stage 2 (quotes sent) should
 * have the first visible display of a progress bar.")
 *
 * This reverses the first cut, which drew a 1/6 sliver on the reasoning that
 * zero reads as "broken" where a sliver reads as "started". Using it settled it
 * the other way, and the argument is better: **being a lead is the starting
 * line, not progress**. Every order has reached it, so a mark that every row
 * carries distinguishes nothing — and on a list whose default view is full of
 * leads, a column of identical slivers is just noise with a colour.
 *
 * So the BAR measures the five rungs BEYOND the lead: nothing at rung 1, the
 * first visible length at rung 2, full at rung 6. The strip is unchanged and
 * still shows all six, because "which rungs are done" and "how far along" are
 * different questions and the tick answers the first.
 *
 * `fraction` IS THE BAR'S OWN LENGTH, not `done / total`. It is what the width
 * and the colour ramp are both computed from, so it means the thing it draws —
 * a field that said 1/6 while the bar drew nothing would be a trap. `done` and
 * `total` keep counting the whole six-rung ladder, which is what the checklist
 * reads.
 *
 * A FLAGGED LEAD STILL DRAWS, and after migration 058 that is the common case
 * rather than an edge: every inquiry from the public form arrives flagged, and
 * most arrive as nothing but a lead. Flagged is full-width red whatever the
 * stages say, so the "no bar at rung 1" rule is checked AFTER it — the other
 * order would make every new inquiry invisible, which is the exact opposite of
 * what flagging them is for.
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
 *
 * ---------------------------------------------------------------------------
 * ONLY THE FIRST BLOCKED RUNG IS COLOURED (Mark, 2026-08-20: "once we hit
 * either a red or yellow one, the ones after it should just be 'not yet'").
 *
 * `stageState` judges each rung on its own, so once an event is near or past it
 * calls EVERY undone rung overdue. An order with nothing stamped and the event
 * behind it came out
 *
 *     done · OVERDUE · — · OVERDUE · — · OVERDUE
 *
 * which reads as three separate things being late. They are not: the quote is
 * the blocker and the rest have not come up yet. A strip that paints them all
 * says nothing about WHERE the order is stuck, which is the one thing it is
 * there to say.
 *
 * So the first overdue-or-waiting rung keeps its colour and every later one
 * falls back to plain. **A `done` rung is never demoted** — it is a fact rather
 * than a prediction, and `done` is COUNTED from these ticks, so greying one
 * would also shorten the bar.
 */

import {
  STAGES,
  stageState,
  isPersonFlag,
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
  /**
   * THE BAR'S OWN LENGTH, `(done - 1) / (total - 1)` — 0 at the lead rung and 1
   * when everything is done. Deliberately NOT `done / total`: the lead draws
   * nothing, so a fraction counting it would not describe what is on screen.
   * The colour no longer reads it — see `progressColor`.
   */
  fraction: number;
  /**
   * THE BAR'S LENGTH, 0..1, which since 2026-09-16 is NOT `fraction` (Mark:
   * "make the steps of the bar 5 but the color of the bar 6"). The length
   * measures the SPECIAL ORDERS TEAM's work, which ends at Invoice paid —
   * printing and scheduling are the kitchen's, usually done from the generate
   * dialog — so four drawn steps (rungs 2–5) fill the row and rung 6 adds no
   * length. The colour is `progressColor`'s: a paid order is full width and
   * green, which is the kitchen's cue.
   */
  length: number;
  /**
   * HOW MANY OF THE FOUR DRAWN STEPS ARE FILLED, 0..4 — `length` in whole
   * steps, which is what the snapped bar indexes by.
   */
  steps: number;
  /**
   * A DELIVERY WITH NO DELIVERY SCHEDULED (Mark, 2026-09-30: "we should not
   * consider a delivery order that doesn't have delivery scheduled as
   * 'complete'. Those orders should still have an incomplete and yellow
   * progress bar").
   *
   * NOT A RUNG. 82% of orders are pickups and the ladder header explains why
   * the booking was left off it; adding a rung would move every pickup's bar.
   * So it is a HOLD instead: a delivery order that has climbed to paid stops
   * one step short of full until the courier is booked. Its COLOUR is
   * `ready`'s, below.
   */
  awaitingDelivery: boolean;
  /**
   * GREEN — the kitchen can take it. Paid (rung 5) and, for a delivery not
   * yet booked, also at status `order` (Mark, 2026-09-30: "for delivery
   * orders, when the order is paid for and its status is 'order' but delivery
   * hasn't been scheduled yet, make the progress bar background green"). So
   * the bar is short AND green: ready for the kitchen, not yet complete. An
   * unbooked delivery still at `invoice`, though paid, stays yellow.
   */
  ready: boolean;
  ticks: ProgressTick[];
  /**
   * What the row's wash says, and the three cases are Mark's:
   *   · `progress` — yellow, or green once ready to print and schedule;
   *   · `flagged`  — a PERSON's flag: FULL WIDTH and red, whatever the stages
   *     say, because a problem somebody recorded is not a progress question;
   *   · `notice`   — a SYSTEM flag (Mark, 2026-10-01): the bar keeps its
   *     length and turns red. The app is saying "act on this", not "something
   *     is wrong", so how far along the order is still worth reading;
   *   · `none`     — cancelled. No bar at all, and the row greys out. An order
   *     that was called off is not partly done, it is not happening.
   */
  tone: "progress" | "flagged" | "notice" | "none";
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
  let blocked = false;
  const ticks = LADDER.map((rung, i) => {
    // The floor fills the tick, not just the count — see the header.
    let state: StageState =
      i < floor ? "done" : rungState(order, rung.stages, today, thresholds);
    // Only the FIRST blocked rung is coloured; see the header. `done` is never
    // demoted — it is a fact, and the bar's length is counted from these.
    if (state === "overdue" || state === "waiting") {
      if (blocked) state = null;
      else blocked = true;
    }
    return { key: rung.key, label: rung.label, state };
  });
  // Counted from the TICKS, so the strip and the wash cannot disagree.
  const done = ticks.filter((t) => t.state === "done").length;
  const total = LADDER.length;

  /**
   * NOTHING BUT AN ORDER HAS PROGRESS (Mark, 2026-09-20: "suppress the special
   * order row progress bar backgrounds for both standing order and regular
   * order templates").
   *
   * A REGRESSION MIGRATION 112 INTRODUCED, and worth naming as one. A standing
   * order's status was NULL until that morning, so `STATUS_FLOOR` fell through
   * to 1 and `progressRowStyle`'s "the lead rung draws nothing" rule kept the
   * row clean by accident. Give it `invoice` — which is now the rung its DAYS
   * start at — and the floor is 4: two templates suddenly wore a wash most of
   * the way across the row, claiming a quote had been sent and an invoice
   * raised for an arrangement that has never been either.
   *
   * SO THE RULE IS ABOUT KIND, not about the accident of a null status. A
   * template and a standing order are SHAPES: the ladder is a thing an order
   * climbs, their stage dates are deliberately not copied to the days they
   * make, and there is no progress to report. `none` takes the strip with it,
   * which is the same falsehood one size smaller — a strip reading four of six
   * would be the wash's claim in miniature.
   *
   * Cancelled beats flagged, and both are beaten by this: an order called off
   * is not an open problem (705 of the real orders are cancelled while a flag
   * is cleared as soon as it is dealt with), and a shape is neither.
   */
  const tone: OrderProgress["tone"] =
    order.kind !== "order" || order.status === "cancelled"
      ? "none"
      : isPersonFlag(order)
        ? "flagged"
        : order.flag_reason
          ? "notice"
          : "progress";

  const awaitingDelivery =
    order.kind === "order" && order.fulfillment === "delivery" && !order.delivery_scheduled_at;
  const drawn = total - 2;
  // The hold: a full bar is one step short until the delivery is booked.
  const steps = Math.min(done - 1, awaitingDelivery ? drawn - 1 : drawn);
  return {
    done,
    total,
    fraction: (done - 1) / (total - 1),
    length: steps / drawn,
    steps,
    awaitingDelivery,
    ready: done >= READY_RUNG && (!awaitingDelivery || order.status === "order"),
    ticks,
    tone,
  };
}

/**
 * THE STRIP'S TOOLTIP, AS A CHECKLIST (Mark, 2026-08-20 — he drew it as
 * "<box with checkmark> Lead / <empty box> Quote Sent").
 *
 *     ☑ Lead
 *     ☑ Quote sent
 *     ☐ Quote returned — waiting on them
 *     ☐ Invoice sent — overdue
 *     ☐ Invoice paid
 *     ☐ Printed & scheduled
 *
 * It replaces `Lead: done / Quote sent: not yet`, which made you read the state
 * of every rung to find the ones that matter. A column of boxes is scanned, not
 * read, and the eye lands on the first empty one — which is the next thing to
 * do, and the only reason to open this tooltip.
 *
 * THE BOX IS TWO-STATE AND THE STRIP IS FOUR, so the two states a box cannot
 * carry are said in words after the label. A rung that is simply not due yet
 * says nothing at all: on a six-rung ladder most rows would otherwise carry
 * four "not yet"s, which is the noise this is replacing.
 *
 * BOTH GLYPHS CARRY U+FE0E. `☑` has an emoji presentation and `☐` does not, so
 * without the text selector Apple platforms render the checked box as a colour
 * emoji beside a plain outline one — mismatched sizes down the column. The
 * app's ♥/★ pair on the order guide carries the same selector for the same
 * reason.
 *
 * It is a native `title`, like every other tooltip in this app, and inherits
 * that: THERE IS NO HOVER ON AN IPAD, so this never shows there. That is
 * acceptable here and would not be if the tooltip were load-bearing — the
 * strip's own colours say done, overdue and waiting without it.
 */
export function progressChecklist(p: OrderProgress): string {
  return p.ticks
    .map((t) => {
      const box = t.state === "done" ? "\u2611\uFE0E" : "\u2610\uFE0E";
      const note =
        t.state === "overdue" ? " — overdue" : t.state === "waiting" ? " — waiting on them" : "";
      return `${box} ${t.label}${note}`;
    })
    .concat(p.awaitingDelivery ? ["\u2610\uFE0E Delivery scheduled"] : [])
    .join("\n");
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

/**
 * THREE COLOURS, NOT A RAMP (Mark, 2026-09-29: "keep flagged rows red, orders
 * that are ready to print and schedule green, and anything else yellow").
 *
 * The yellow→green ramp it replaces mixed the two by `fraction`, so most rows
 * were some shade of olive and none of them answered a question. Three solid
 * colours answer the one the list is read for — which orders the kitchen can
 * take now. The LENGTH is untouched: it still says how far along.
 *
 * GREEN FROM RUNG 5, Invoice paid — or the status floor of `order`, "PAID —
 * printing and scheduling remain", which is how wholesale orders get there
 * without a payment stamp. A printed-and-scheduled order stays green: it is
 * still the kitchen's. Red is decided by `progressRowStyle`, before this.
 */
export const READY_RUNG = 5;
export function progressColor(p: OrderProgress): [number, number, number] {
  // An unbooked delivery is green only once it is at `order` — see
  // `OrderProgress.ready`.
  return p.ready ? GREEN : YELLOW;
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
 * The last step always takes the last boundary, which is the table's own right
 * edge, so a finished order fills the row exactly.
 *
 * NOTE `total` IS THE NUMBER OF DRAWN STEPS, not the ladder's length. The lead
 * rung draws nothing and the last rung draws no further than paid (see
 * `OrderProgress.length`), so the caller passes FOUR for a six-rung ladder.
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

  // FLAGGED IS DECIDED FIRST, and the order matters more than it looks: after
  // migration 058 every inquiry from the public form arrives flagged AND as a
  // bare lead, so checking "no bar at rung 1" first would leave every new
  // inquiry unmarked — the precise opposite of what flagging it is for.
  //
  // A PERSON's flag fills the row. A SYSTEM flag (`notice`, Mark, 2026-10-01)
  // keeps the bar's own length and turns it red — but a bare lead draws
  // nothing, so a notice draws at least the first step: a red flag nobody can
  // see is no flag.
  const flagged = p.tone === "flagged";
  const notice = p.tone === "notice";

  // THE LEAD RUNG DRAWS NOTHING. Not a zero-width bar — no background at all,
  // so the row is left exactly as the table painted it and the 3px edge rule
  // does not appear either. See the header.
  if (!flagged && !notice && p.done <= 1) return null;
  const steps = notice ? Math.max(p.steps, 1) : p.steps;

  const solid = flagged || notice ? RED : progressColor(p);
  // FOUR drawn steps — rungs 2 to 5, the team's work (see `length`). Rung 2
  // is the first that draws and rung 6 draws no further than rung 5, so the
  // index is `steps - 1` (which also carries the unbooked-delivery hold).
  const drawn = p.total - 2;
  const snapped = snapStops(drawn, boundaries);
  // Only the LENGTH snaps; the colour is the rung, not where the rules fall.
  const width = snapped ? snapped[steps - 1] : steps / drawn;
  const stop = flagged ? "100%" : `${(width * 100).toFixed(3)}%`;
  const wash = rgba(solid, flagged || notice ? 0.15 : WASH_ALPHA);

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
