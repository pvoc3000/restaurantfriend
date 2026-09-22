"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useExactViewportHeight, useViewportAtLeast } from "@/lib/tableHead";

/**
 * THE INFO TAB IS FOUR QUADRANTS, NOT A SCROLLING PAGE (Mark, 2026-08-17: the
 * column of stacked sections "just looks like a wall of text").
 *
 * FileMaker's EVENT INFO tab is the reference and its arrangement is the
 * argument: the facts you SET are up top where you read them once, and the two
 * panes that GROW — what else is booked that day, and the log — are underneath
 * where they can run as long as they like without pushing anything off screen.
 * A twelve-year order carries two hundred log entries; in a single column that
 * is the whole page.
 *
 *   Details            │  Customer
 *   ───────────────────┼──────────────────
 *   Also that day  ⇕   │  Completion dates
 *
 * ONE SECTION PER QUADRANT (Mark, 2026-08-17). The first cut stacked Customer
 * and Completion dates in the top right and put the log bottom right, which
 * made the right column 494px of a 588px frame and left the log fifty-four
 * pixels. Moving the LOG to the Notes tab is what freed a quadrant for the
 * dates, so each of the four now holds exactly one thing.
 *
 * IT IS TWO COLUMNS OF STACKED PANES rather than a literal 2×2 grid, which is
 * `RecipeInfo`'s shape and for its reason: a grid ties both bottom cells to one
 * row height, so a long log would stretch the empty "also that day" pane beside
 * it. Stacked, each column's LAST pane takes whatever that column has left, and
 * the two still end level because both columns end at the same measured height.
 *
 * The height is MEASURED (`useExactViewportHeight`), never a CSS constant —
 * what sits above varies with the masthead's wrapping and with how long the
 * title and the attention sentence run. Below `xl` the columns stack and the
 * page scrolls, which is the recipe record's rule and the receiving screen's:
 * nothing hidden, and no pane too short to read.
 *
 * AND THE SAME PROMISE HOLDS ON A SHORT WINDOW — see `useColumnFloor`, which
 * is the rest of "nothing hidden" and was missing until 2026-09-21.
 */
export function OrderInfoLayout({
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
}: {
  topLeft: ReactNode;
  topRight: ReactNode;
  bottomLeft: ReactNode;
  bottomRight: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const leftColumn = useRef<HTMLDivElement>(null);
  const rightColumn = useRef<HTMLDivElement>(null);
  // Gated on WIDTH, at the breakpoint the two columns appear. Stacked, a
  // measured height either clips the panes or hands an iPad four short boxes
  // inside a page that scrolls anyway.
  const wide = useViewportAtLeast(1280);
  // The floor is MEASURED FROM THE COLUMNS, not the 420 constant it used to be
  // — see `useColumnFloor`. Below this the page scrolling is the honest
  // failure; above it, nothing changes at all.
  const floor = useColumnFloor(leftColumn, rightColumn, wide);
  useExactViewportHeight(frame, wide, floor);

  return (
    <div
      ref={frame}
      // `min-h-0` on the frame so the columns inside can give way to it, and
      // `min-w-0` on BOTH tracks and NOT behind a breakpoint — a flex item's
      // min-width defaults to min-content, so a long customer name or a wide
      // table would push the whole PAGE sideways rather than shrink.
      // THE TAB IS FOUR COLUMNS, NOT TWO, and they are not all the same kind
      // of gap (Mark, 2026-08-28: "reduce the padding between columns 1 & 2,
      // and 3 & 4, and increase the padding between columns 2 & 3").
      //
      // Details and Customer are each a two-track grid, so what a reader sees
      // is four columns of fields. Three gaps separate them and only the
      // MIDDLE one is a change of subject — 1|2 and 3|4 are two halves of one
      // block. Every gap was 40px, so all three read alike and the tab looked
      // like four unrelated columns rather than two blocks of two.
      //
      // 96px in the middle (here), 24px inside each block (the grids' own
      // `gap-x-6`). The arithmetic is close to free: each block gives 32px to
      // the middle and takes 16px back from its own inner gap, so a field
      // loses about 8px and the grouping becomes legible.
      className="flex min-h-0 flex-col gap-10 xl:flex-row xl:gap-24"
    >
      <div ref={leftColumn} className="flex min-h-0 min-w-0 flex-1 flex-col gap-10 xl:gap-16">
        <div className="shrink-0">{topLeft}</div>
        <GrowingPane>{bottomLeft}</GrowingPane>
      </div>

      {/* 64px between the top and bottom blocks of both columns (Mark,
          2026-09-16: first Customer and Completion dates, then Details and
          Also that day to match). */}
      <div ref={rightColumn} className="flex min-h-0 min-w-0 flex-1 flex-col gap-10 xl:gap-16">
        <div className="shrink-0">{topRight}</div>
        <GrowingPane>{bottomRight}</GrowingPane>
      </div>
    </div>
  );
}

/** The shortest a growing pane is worth having: a heading and about three
 *  rows. Under this it shows a heading and a sliver, which is the state that
 *  reads as a broken screen rather than a full one. */
const MIN_PANE = 160;

/** What the frame asked for before any of this — four panes on one screen. The
 *  floor never goes BELOW it, so a tall window behaves exactly as it did. */
const FRAME_MIN = 420;

/**
 * HOW SHORT THE FRAME MAY BE, MEASURED FROM THE COLUMNS (Mark, 2026-09-21: on
 * a small screen "the completion dates are truncated but scrollable, and the
 * 'also that day' section is below the bottom of the screen and unreachable.
 * I think it's the scroll view's fault").
 *
 * He was right, and the mechanism is worth writing down because a flat 420
 * looks like it already handles a short window.
 *
 * MEASURED on the real record at 1400×620: the frame took its 420px floor, and
 * the LEFT column's head — Details, a `shrink-0` grid of sixteen fields — was
 * **528px on its own**. `flex-1 min-h-0` then resolves the pane below it to
 * **zero**, and a zero-height `overflow-y-auto` box does not spill: it CLIPS.
 * The content was laid out at y=860 in a document 796px tall, so scrolling to
 * the very bottom of the page still could not reach it. The right column's
 * head was 228px, so Completion dates got 128px of its 367px and showed the
 * truncated-but-scrollable half of the same bug. Two panes, one cause: the
 * frame promised a height it did not have to give.
 *
 * A measured frame is only honest while the fixed parts FIT IN IT, so the
 * floor is now what the columns actually need: each column's non-growing
 * children, their gaps, and a pane worth reading. The frame then overflows the
 * window and THE PAGE SCROLLS — which is what this layout already does below
 * `xl`, and is the same promise: nothing hidden, no pane too short to read.
 *
 * `scrollHeight` RATHER THAN A FLAT `MIN_PANE`, which is what keeps this from
 * forcing a scrollbar onto screens that never needed one. It reads the pane's
 * CONTENT while the box is the smaller of the two, and the box once the box is
 * bigger — so a pane asks for what it holds ("Nothing else is booked" is 86px,
 * not 160), capped at `MIN_PANE` when it holds more. That second case is also
 * why this converges rather than oscillating: once a pane is taller than its
 * content, `scrollHeight` is the box, and asking for the box you already have
 * changes nothing. Checked against every shape on the tab, including the empty
 * pane and the 367px date list.
 *
 * The observers watch the CHILDREN, not the columns. A column's own height is
 * pinned by the frame, so it does not change when Details grows a line — which
 * is exactly when the floor must be recomputed, and an inline edit does it.
 */
function useColumnFloor(
  left: RefObject<HTMLDivElement | null>,
  right: RefObject<HTMLDivElement | null>,
  enabled: boolean
): number {
  const [measured, setMeasured] = useState(FRAME_MIN);

  useLayoutEffect(() => {
    if (!enabled) return;
    const columns = [left.current, right.current].filter(Boolean) as HTMLElement[];

    const measure = () => {
      let needed = FRAME_MIN;
      for (const column of columns) {
        const children = Array.from(column.children) as HTMLElement[];
        const pane = children.pop();
        if (!pane) continue;
        const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
        const fixed = children.reduce(
          (total, child) => total + child.getBoundingClientRect().height + gap,
          0
        );
        needed = Math.max(needed, fixed + Math.min(pane.scrollHeight, MIN_PANE));
      }
      // The >1px guard the measured height uses, and for its reason: a
      // sub-pixel difference is the observer reading its own write.
      setMeasured((was) => (Math.abs(was - needed) > 1 ? needed : was));
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const column of columns) {
      for (const child of Array.from(column.children)) observer.observe(child);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [left, right, enabled]);

  // Not reset in the effect: a stale measurement is simply not returned while
  // the columns are stacked, and writing state from an effect body to say so
  // is the cascading render the lint rule is about.
  return enabled ? measured : FRAME_MIN;
}

/**
 * The pane at the foot of a column — it takes what the column has left and
 * SCROLLS ITS OWN CONTENT rather than the page.
 *
 * `overflow-y-auto` is the load-bearing part and leaving it off is what the
 * first version got wrong: `xl:flex-1` gave the pane a box, the log's two
 * hundred entries simply overflowed it, and the page ran to 1402px in a 900px
 * window — a measured frame with a scrolling page inside it, which is the
 * arrangement this layout exists to replace.
 *
 * `flex-initial` below `xl`, where the page scrolls and the pane should size
 * to its rows; `xl:flex-1` once there is a measured height to share out.
 */
function GrowingPane({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-initial flex-col overflow-y-auto pr-1 xl:flex-1">
      {children}
    </div>
  );
}


/**
 * TWO PANES SIDE BY SIDE — the Notes tab: the document notes beside the log.
 *
 * The same measured frame as the quadrants, and the same reason for pairing
 * these two: notes want WIDTH (they are paragraphs) and the log wants HEIGHT
 * (a twelve-year order carries two hundred entries). Neither fits under the
 * other, and both scroll their own rows rather than the page.
 */
export function OrderSplitLayout({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const wide = useViewportAtLeast(1280);
  useExactViewportHeight(frame, wide, 420);

  return (
    <div ref={frame} className="flex min-h-0 flex-col gap-10 xl:flex-row xl:gap-16">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GrowingPane>{left}</GrowingPane>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GrowingPane>{right}</GrowingPane>
      </div>
    </div>
  );
}
