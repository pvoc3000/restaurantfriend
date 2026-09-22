"use client";

import { InlineValue } from "@/components/catalog/InlineValue";
import { PERCENT_SCALE, percentLabel } from "@/lib/percent";

/**
 * A SETTINGS NUMBER TYPED AND READ AS A PERCENTAGE, stored as a fraction.
 *
 * IT EXISTS FOR THE CLIENT BOUNDARY, not for the styling. `InlineValue`'s
 * `scale` and `format` are FUNCTIONS, and `SpecialOrderSettings` is a SERVER
 * component — so passing them from there is the one thing React refuses:
 *
 *     Functions cannot be passed directly to Client Components unless you
 *     explicitly expose it by marking it with "use server".
 *
 * (Mark, 2026-09-22, opening the org settings page after the rush-fee rate
 * became percent-facing.) `tsc` cannot see it and the dev build compiles, so it
 * arrives as a runtime error on the page itself. `OrderTotals` does the same
 * thing and always worked, for the reason that is easy to miss: it is a CLIENT
 * component, so its `scale={PERCENT_SCALE}` never crosses a boundary.
 *
 * So the functions are named on this side of the line and only serialisable
 * props cross it. `PERCENT_SCALE` is the same pair the order's own rate cells
 * use, so 35 means one thing in both places — `lib/percent` holds it and the
 * reasoning.
 */
export function PercentSetting({
  orgId,
  path,
  value,
  settings,
  label,
}: {
  orgId: string;
  /** The key inside `orgs.settings`, as a path — the shape `cell` uses. */
  path: string[];
  value: number | null;
  /** The whole jsonb document, which `InlineValue` edits one key of. */
  settings: Record<string, unknown>;
  label: string;
}) {
  return (
    <InlineValue
      table="orgs"
      id={orgId}
      column={path[path.length - 1]}
      value={value}
      jsonColumn="settings"
      jsonPath={path}
      jsonDocument={settings}
      kind="number"
      align="right"
      ariaLabel={label}
      scale={PERCENT_SCALE}
      format={percentLabel}
    />
  );
}
