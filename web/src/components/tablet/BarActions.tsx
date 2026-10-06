"use client";

import { useBarActions } from "@/lib/tabletBarActions";
import { BAR_CELL, BAR_CELL_PRESSED } from "./barCell";
import { BarLabel } from "./BarLabel";

/**
 * A screen's own commands in the tablet bar (`lib/tabletBarActions`) — the
 * order guide's Next favorite and Next section. Absent when no screen has taken
 * the seat. A disabled command stays in place and dims (`BAR_CELL`'s own
 * `disabled:` state) rather than vanishing, so the bar never changes width as
 * the walk runs out of lines.
 *
 * Rendered twice by the bar, once per `side`: `leading` right after Home,
 * `trailing` at the right end.
 */
export function BarActions({ side }: { side: "leading" | "trailing" }) {
  const seated = useBarActions();
  const actions = (seated ?? []).filter((a) => (a.side ?? "trailing") === side);
  if (actions.length === 0) return null;

  return (
    <div className="flex items-center" role="group" aria-label="Screen commands">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className={action.pressed ? BAR_CELL_PRESSED : BAR_CELL}
          aria-pressed={action.pressed}
          // Named, so `IdleLock` can tell the Stay unlocked switch's own tap
          // from one that should turn it off.
          data-bar-action={action.key}
          disabled={action.disabled}
          title={action.title}
          // The CURRENT handler at the moment of the press — the seated object's
          // is refreshed in place on every publish.
          onClick={() => action.onClick()}
        >
          <BarLabel icon={action.icon} word={action.word} />
        </button>
      ))}
    </div>
  );
}
