/**
 * The one list splice behind every drag-to-reorder in the app: `dragKey` moved
 * next to an anchor. Pure, string keys, a `{before}|{after}` target, and an
 * unknown anchor is a no-op.
 *
 * Born as `movedColumnOrder` in `columnOrder.ts` and re-exported by `rowDrag`
 * under this name, with a note to rename it at source "the day a third caller
 * appears". The start page's widget grid (`tileDrag`, 2026-10-20) is that
 * caller. `columnOrder` keeps its old names as aliases, so DataTable and its
 * fixtures read as they did.
 */

/** Where a drag would land: before an item, or after one (the end). */
export type DropTarget = { before: string } | { after: string };

export function moveInOrder(order: readonly string[], dragKey: string, target: DropTarget): string[] {
  const without = order.filter((k) => k !== dragKey);
  const anchor = "before" in target ? target.before : target.after;
  const at = without.indexOf(anchor);
  if (at === -1) return [...order];
  without.splice("before" in target ? at : at + 1, 0, dragKey);
  return without;
}
