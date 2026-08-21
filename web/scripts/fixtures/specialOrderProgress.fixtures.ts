// The list's row progress bar: six rungs, and the two special cases.
//
// The shapes here are real ones out of the 8,321 migrated orders — including
// the wholesale order that skips quoting entirely, which is the case that makes
// "how many are done" and "which are done" say different things.

import { test, eq, ok, no } from "./harness";
import {
  PROGRESS_LABELS,
  WASH_ALPHA,
  orderProgress,
  progressChecklist,
  progressColor,
  progressRowStyle,
  snapStops,
} from "../../src/lib/specialOrderProgress";

const TODAY = "2026-08-20";

/**
 * An order with nothing stamped, far enough out that nothing is overdue.
 *
 * `status: "lead"` deliberately, so these cases isolate the LADDER from the
 * status floor — a lead asserts one rung, which is the same rung the order's
 * existence already asserts. The floor's own cases below set the status
 * explicitly.
 */
const base = {
  kind: "order",
  status: "lead",
  fulfillment: "pickup",
  event_date: "2026-12-01",
  flag_reason: null,
  quote_sent_at: null,
  quote_returned_at: null,
  invoice_sent_at: null,
  invoice_paid_at: null,
  delivery_scheduled_at: null,
  order_scheduled_at: null,
  order_printed_at: null,
} as never;

const order = (patch: Record<string, unknown>) =>
  orderProgress({ ...(base as object), ...patch } as never, TODAY);

/* -- the ladder ----------------------------------------------------------- */

test("six rungs, and Lead is the first", () => {
  eq(PROGRESS_LABELS.length, 6);
  eq(PROGRESS_LABELS[0], "Lead");
  eq(PROGRESS_LABELS[5], "Printed & scheduled");
});

test("an order with nothing stamped is 1 of 6, never 0", () => {
  // The bar never renders as an empty track: an order that EXISTS has reached
  // stage one, and a sliver reads as "started" where zero reads as "broken".
  const p = order({});
  eq(p.done, 1);
  eq(p.total, 6);
  ok(p.fraction > 0, "a fraction to draw");
});

test("each stamp advances it by one", () => {
  eq(order({ quote_sent_at: "2026-08-01" }).done, 2);
  eq(order({ quote_sent_at: "2026-08-01", quote_returned_at: "2026-08-02" }).done, 3);
  eq(
    order({
      quote_sent_at: "2026-08-01",
      quote_returned_at: "2026-08-02",
      invoice_sent_at: "2026-08-03",
      invoice_paid_at: "2026-08-04",
    }).done,
    5
  );
});

test("the last rung needs BOTH stamps — printed alone is not done", () => {
  // Mark's call, and the consequence is deliberate: `order_printed_at` is
  // filled on 64% of real orders and `order_scheduled_at` on 23%, so 41% of
  // printed orders sit at 5 of 6. Production scheduling is the real last step.
  const printed = order({
    quote_sent_at: "a", quote_returned_at: "a", invoice_sent_at: "a", invoice_paid_at: "a",
    order_printed_at: "2026-08-05",
  });
  eq(printed.done, 5);
  eq(printed.ticks[5].state, null);

  const both = order({
    quote_sent_at: "a", quote_returned_at: "a", invoice_sent_at: "a", invoice_paid_at: "a",
    order_printed_at: "2026-08-05", order_scheduled_at: "2026-08-05",
  });
  eq(both.done, 6);
  eq(both.fraction, 1);
});

test("a wholesale order that never gets quoted still counts what IS done", () => {
  // Cafe Knotted's real shape: billed weekly, so no quote is ever sent or
  // returned. The bar is a COUNT and the strip is WHICH — they do not
  // contradict each other, and about 11% of orders look like this.
  const p = order({
    invoice_sent_at: "a", invoice_paid_at: "a",
    order_printed_at: "a", order_scheduled_at: "a",
  });
  eq(p.done, 4);
  eq(p.ticks.map((t) => (t.state === "done" ? 1 : 0)).join(""), "100111");
});

/* -- the status floor ----------------------------------------------------- */

test("status `order` jumps to rung 5, stamps or no stamps", () => {
  // `STATUS_HINT.order` is "paid — printing and scheduling remain", so the
  // status already says this; the bar just believes it now.
  const p = order({ status: "order" });
  eq(p.done, 5);
  eq(p.ticks.map((t) => (t.state === "done" ? 1 : 0)).join(""), "111110");
});

test("the floor fills the TICKS, not only the count", () => {
  // If it raised the number alone, the strip would show gaps while the wash
  // said five — two readings of one fact, disagreeing.
  const p = order({ status: "order" });
  eq(p.done, p.ticks.filter((t) => t.state === "done").length);
});

test("every rung of the status ladder sets its own floor", () => {
  eq(order({ status: "lead" }).done, 1);
  eq(order({ status: "quote" }).done, 2);      // sent, awaiting approval
  eq(order({ status: "invoice" }).done, 4);    // sent, awaiting payment
  eq(order({ status: "order" }).done, 5);      // paid
});

test("the dates can push PAST the floor but never below it", () => {
  const past = order({
    status: "order",
    quote_sent_at: "a", quote_returned_at: "a", invoice_sent_at: "a", invoice_paid_at: "a",
    order_printed_at: "a", order_scheduled_at: "a",
  });
  eq(past.done, 6, "the last rung is still earned by its stamps");

  // A wholesale order with no quote at all — 925 real ones look like this.
  const below = order({ status: "order", invoice_sent_at: "a" });
  eq(below.done, 5, "the floor holds");
});

/* -- the two special cases ------------------------------------------------ */

test("a cancelled order gets NO bar, whatever it had reached", () => {
  const p = order({ status: "cancelled", quote_sent_at: "a", invoice_sent_at: "a" });
  eq(p.tone, "none");
  eq(progressRowStyle(p), null, "no style at all, so the row is left untouched");
});

test("a flagged order is FULL WIDTH and red, whatever its stages say", () => {
  const p = order({ flag_reason: "Wrong letters — remake" });
  eq(p.tone, "flagged");
  const style = progressRowStyle(p)!;
  ok(style.backgroundImage.includes("210, 0, 0"), "red");
  ok(style.backgroundImage.includes("100%"), "full width");
  // …and it does not pretend the stages are done.
  eq(p.done, 1);
});

test("cancelled beats flagged", () => {
  // 705 real orders are cancelled; a flag is cleared as soon as it is dealt
  // with. An order called off is not an open problem.
  eq(order({ status: "cancelled", flag_reason: "something" }).tone, "none");
});

/* -- the colour ----------------------------------------------------------- */

test("the ramp runs yellow to green", () => {
  eq(progressColor(0), [255, 212, 0]);
  eq(progressColor(1), [74, 156, 63]);
  const mid = progressColor(0.5);
  ok(mid[0] < 255 && mid[0] > 74, "red channel falls");
  ok(mid[1] < 212 && mid[1] > 156, "green channel falls toward the green");
});

test("the wash is 20% and the fill stops at the fraction", () => {
  eq(WASH_ALPHA, 0.2);
  const p = order({ quote_sent_at: "a", quote_returned_at: "a" }); // 3 of 6
  const style = progressRowStyle(p)!;
  ok(style.backgroundImage.includes("0.2"), "20% alpha");
  ok(style.backgroundImage.includes("50.000%"), "half way");
  // Two layers: the edge rule and the wash, both on the row.
  eq(style.backgroundSize, "100% 3px, 100% 100%");
  eq(style.backgroundPosition, "left bottom, left top");
});

/* -- the states the strip shows ------------------------------------------- */

test("a rung that is somebody else's move reads as waiting, not overdue", () => {
  const p = order({ quote_sent_at: "2026-08-01" });
  eq(p.ticks[2].state, "waiting", "quote returned");
});

test("an event that has passed makes the FIRST undone rung overdue", () => {
  const p = orderProgress(
    { ...(base as object), event_date: "2026-08-01" } as never,
    TODAY
  );
  eq(p.ticks[1].state, "overdue", "quote sent");
  no(p.ticks.some((t) => t.state === "waiting"), "nothing is merely waiting once it is late");
});

/* -- only the first blocked rung is coloured ------------------------------ */

test("one red, not a wall of them", () => {
  // `stageState` judges each rung alone, so a past event calls every undone one
  // overdue — the strip used to read `done · OVERDUE · — · OVERDUE · — ·
  // OVERDUE`, which says three things are late when the quote is the blocker
  // and the rest have not come up.
  const p = orderProgress({ ...(base as object), event_date: "2026-08-01" } as never, TODAY);
  eq(p.ticks.map((t) => t.state ?? "-").join(" "), "done overdue - - - -");
});

test("the colour moves along as the blocker is cleared", () => {
  const p = orderProgress(
    { ...(base as object), status: "quote", event_date: "2026-08-01", quote_sent_at: "a" } as never,
    TODAY
  );
  eq(p.ticks.map((t) => t.state ?? "-").join(" "), "done done overdue - - -");
});

test("a DONE rung after the blocker is never demoted", () => {
  // It is a fact rather than a prediction — and `done` is counted from these
  // ticks, so greying one would also shorten the bar.
  const p = orderProgress(
    { ...(base as object), event_date: "2026-08-01", invoice_sent_at: "a" } as never,
    TODAY
  );
  eq(p.ticks.map((t) => t.state ?? "-").join(" "), "done overdue - done - -");
  eq(p.done, 2, "the bar still counts it");
});

test("waiting blocks the rest as surely as overdue does", () => {
  const p = orderProgress(
    { ...(base as object), quote_sent_at: "a", invoice_sent_at: "a" } as never,
    TODAY
  );
  eq(p.ticks[2].state, "waiting", "quote returned");
  no(
    p.ticks.slice(3).some((t) => t.state === "waiting" || t.state === "overdue"),
    "nothing downstream is coloured"
  );
});

test("the tooltip therefore carries at most one reason", () => {
  const lines = progressChecklist(
    orderProgress({ ...(base as object), event_date: "2026-08-01" } as never, TODAY)
  ).split("\n");
  eq(lines.filter((l) => l.includes("—")).length, 1);
});

/* -- snapping the bar to a column rule ------------------------------------ */

/** The real list at a 1440 window: nine columns, cumulative fractions. */
const NINE = [0.093, 0.186, 0.265, 0.351, 0.503, 0.629, 0.723, 0.792, 1];

test("every stop lands exactly on a column rule", () => {
  const stops = snapStops(6, NINE)!;
  eq(stops.length, 6);
  for (const stop of stops) ok(NINE.includes(stop), `${stop} is a rule`);
});

test("the stops strictly increase, so no two rungs draw alike", () => {
  // Nearest-boundary ALONE can send two rungs to the same wide column's rule —
  // and then 2 of 6 and 3 of 6 are indistinguishable, which is worse than
  // landing mid-cell.
  const stops = snapStops(6, NINE)!;
  for (let i = 1; i < stops.length; i++) ok(stops[i] > stops[i - 1], `${stops[i]} > ${stops[i - 1]}`);
});

test("a wide column cannot swallow two rungs", () => {
  // One column occupying half the table: nearest would put rungs 2, 3 and 4 on
  // the same rule.
  const lopsided = [0.08, 0.16, 0.66, 0.74, 0.82, 0.9, 1];
  const stops = snapStops(6, lopsided)!;
  for (let i = 1; i < stops.length; i++) ok(stops[i] > stops[i - 1], "still increasing");
});

test("the last rung is the table's right edge, so a finished order fills the row", () => {
  eq(snapStops(6, NINE)![5], 1);
});

test("too few rules to be increasing → null, and the raw fraction is used", () => {
  // A reader who has hidden the table down to five columns. Snapping badly is
  // worse than not snapping.
  eq(snapStops(6, [0.2, 0.4, 0.6, 0.8, 1]), null);
  const p = order({ quote_sent_at: "a", quote_returned_at: "a" }); // 3 of 6
  const style = progressRowStyle(p, [0.2, 0.4, 0.6, 0.8, 1])!;
  ok(style.backgroundImage.includes("50.000%"), "falls back to the fraction");
});

test("exactly as many rules as rungs is enough", () => {
  eq(snapStops(6, [0.2, 0.35, 0.5, 0.65, 0.8, 1])!.length, 6);
});

test("the LENGTH snaps but the COLOUR does not", () => {
  // The ramp stays even across the six rungs however the columns are dragged —
  // otherwise a wide column would also skew the hue.
  const p = order({ quote_sent_at: "a" }); // 2 of 6
  const snappedStyle = progressRowStyle(p, NINE)!;
  const rawStyle = progressRowStyle(p, [])!;
  const hue = (css: string) => css.slice(css.indexOf("rgba("), css.indexOf(")") + 1);
  eq(hue(snappedStyle.backgroundImage), hue(rawStyle.backgroundImage));
});

test("a flagged row is the full width whether or not it can snap", () => {
  const p = order({ flag_reason: "x" });
  ok(progressRowStyle(p, NINE)!.backgroundImage.includes("100%"));
  ok(progressRowStyle(p, [])!.backgroundImage.includes("100%"));
});

/* -- the tooltip ---------------------------------------------------------- */

const CHECKED = "\u2611\uFE0E";
const EMPTY = "\u2610\uFE0E";

test("the tooltip is a checklist, one line per rung", () => {
  const lines = progressChecklist(order({ status: "order" })).split("\n");
  eq(lines.length, 6);
  eq(lines[0], `${CHECKED} Lead`);
  eq(lines[4], `${CHECKED} Invoice paid`);
  eq(lines[5], `${EMPTY} Printed & scheduled`);
});

test("a rung that is merely not due yet says nothing after its label", () => {
  // Six rungs would otherwise carry four "not yet"s, which is the noise this
  // replaced.
  const lines = progressChecklist(order({})).split("\n");
  eq(lines[1], `${EMPTY} Quote sent`);
  no(lines.some((l) => l.includes("—")), "no dashes on a quiet row");
});

test("the two states a box cannot carry are said in words", () => {
  const waiting = progressChecklist(order({ quote_sent_at: "a" })).split("\n");
  eq(waiting[2], `${EMPTY} Quote returned — waiting on them`);

  const late = progressChecklist(
    orderProgress({ ...(base as object), event_date: "2026-08-01" } as never, TODAY)
  ).split("\n");
  eq(late[1], `${EMPTY} Quote sent — overdue`);
});

test("both boxes carry the text variation selector", () => {
  // `☑` has an emoji presentation and `☐` does not, so without U+FE0E Apple
  // renders a colour box beside a plain outline one — mismatched down the
  // column. The order guide's ♥/★ pair carries the same selector.
  const all = progressChecklist(order({ quote_sent_at: "a" }));
  ok(all.includes("\u2611\uFE0E"), "checked");
  ok(all.includes("\u2610\uFE0E"), "empty");
});
