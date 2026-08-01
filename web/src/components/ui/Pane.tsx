/**
 * A framed column with a header band — the receiving screen's two halves, and
 * the frame for anything else that sits beside them.
 *
 * It exists because the two halves were hand-rolled twice and drifted, which is
 * the same story as `ui/Dialog`. The document side's band carried a filename, a
 * kind picker and two buttons and WRAPPED to a second row; the lines side's
 * carried three short things and didn't. Measured side by side with an invoice
 * open: 79px against 53px, with the two rules that should have read as one line
 * across the screen 26px apart (Mark, 2026-07-31 — "the header areas of the two
 * columns are different heights").
 *
 * So the band's height is FIXED and it does not wrap. Anything variable inside
 * it — a filename is the only thing that is — truncates, which is the better
 * behaviour anyway: a long name pushing the controls onto a second row moved
 * them every time you opened a different file.
 *
 * `overflow-hidden` on the frame is load-bearing, not tidiness. A PDF in an
 * `<object>` carries `min-height`, and when the pane is short (a tall invoice
 * band above it, a small window) the plugin painted 2px PAST the bottom border
 * and over it — its own grey chrome sitting where our black rule should be, so
 * one column's outline looked a different weight from the other's, and only
 * ever when a document was open (Mark, 2026-07-31). Floating panels are
 * unaffected: `PickList` and `RowMenu` portal to the body precisely so a scroll
 * pane can't clip them.
 */
export function Pane({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden border border-ink ${className}`}
    >
      {children}
    </div>
  );
}

/** The band across the top of a `Pane`. One row, always the same height. */
export function PaneHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-x-3 border-b border-ink px-3">
      {children}
    </div>
  );
}
