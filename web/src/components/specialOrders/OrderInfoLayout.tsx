"use client";

import { useRef, type ReactNode } from "react";
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
  // Gated on WIDTH, at the breakpoint the two columns appear. Stacked, a
  // measured height either clips the panes or hands an iPad four short boxes
  // inside a page that scrolls anyway.
  const wide = useViewportAtLeast(1280);
  // 420, not the 320 default: four panes sharing one screen, and below this the
  // page scrolling is the honest failure.
  useExactViewportHeight(frame, wide, 420);

  return (
    <div
      ref={frame}
      // `min-h-0` on the frame so the columns inside can give way to it, and
      // `min-w-0` on BOTH tracks and NOT behind a breakpoint — a flex item's
      // min-width defaults to min-content, so a long customer name or a wide
      // table would push the whole PAGE sideways rather than shrink.
      className="flex min-h-0 flex-col gap-10 xl:flex-row xl:gap-10"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-10">
        <div className="shrink-0">{topLeft}</div>
        <GrowingPane>{bottomLeft}</GrowingPane>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-10">
        <div className="shrink-0">{topRight}</div>
        <GrowingPane>{bottomRight}</GrowingPane>
      </div>
    </div>
  );
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
    <div ref={frame} className="flex min-h-0 flex-col gap-10 xl:flex-row xl:gap-10">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GrowingPane>{left}</GrowingPane>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GrowingPane>{right}</GrowingPane>
      </div>
    </div>
  );
}
