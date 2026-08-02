/**
 * The one box above a purchase order's lines (Mark, 2026-08-02: "combine the
 * two boxes above the datatable into one box to further declutter").
 *
 * It used to be two stacked frames — the Process card and a line bar — which
 * between them cost 148px of chrome and two borders to say things that are all
 * about the same order. One box, two rows:
 *
 *   row 1  what this order IS, left · Delivery and Status, RIGHT
 *   row 2  everything you can DO to it, right
 *
 * Right-aligning both is Mark's call and it holds up: the statement is what you
 * read down the left margin, and the controls all end at the same edge as the
 * table's own right-hand columns beneath them.
 *
 * Presentational only, and shared rather than duplicated, because the box has
 * TWO owners: `ProcessPo` renders it when a purchaser opens the order (it holds
 * the Delivery control and the send buttons in its own state, so the frame has
 * to live inside it), and `PurchaseOrderDetail` renders it directly for
 * everyone else — `processing` is null below purchaser+, and staff still need
 * the counts, the delivery date and a way to reach receiving. One layout, two
 * callers; the alternative was the same flex row written twice, which is how
 * the two frames it replaces drifted apart in the first place.
 */
export function OrderBar({
  statement,
  trailing,
  actionGroups,
  footer,
}: {
  /** Left of row 1: what the order is — counts, the process mode. */
  statement?: React.ReactNode;
  /** Right of row 1: Delivery and Status. */
  trailing?: React.ReactNode;
  /**
   * Row 2, right-aligned, one entry per GROUP (Mark, 2026-08-02): what you add
   * to the order · what you send to the vendor · what you do when it comes
   * back. Buttons inside a group sit `gap-2` (8px) apart and the groups
   * `gap-x-8` (32px) — settled by eye over three tries (Mark, 2026-08-02): 16px
   * read as arithmetic rather than a boundary, 64px pushed the groups so far
   * apart they stopped reading as one row of commands. 4× the inner gap is the
   * ratio that says "these belong together, those don't". The VERTICAL gap
   * stays small: 32px between groups that have wrapped onto separate lines
   * would read as three separate rows rather than one wrapped one.
   *
   * An empty group is dropped rather than rendered, or it would spend its gap
   * saying nothing (a staff view has no Add item).
   */
  actionGroups?: React.ReactNode[];
  /** Under both rows: a sent note, an error. */
  footer?: React.ReactNode;
}) {
  const groups = (actionGroups ?? []).filter(Boolean);
  return (
    <div className="space-y-3 border border-ink bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">{statement}</span>
        {/* ml-auto, not justify-between: with nothing on the left (a staff
            view of an order with no counts yet) the trailing group still has
            to sit at the right edge rather than sliding over to the left. */}
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {trailing}
        </span>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
          {groups.map((group, i) => (
            <span key={i} className="flex flex-wrap items-center gap-2">
              {group}
            </span>
          ))}
        </div>
      )}

      {footer}
    </div>
  );
}
