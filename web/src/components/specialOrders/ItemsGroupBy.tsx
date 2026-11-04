"use client";

import { useEffect, useState } from "react";

import { PickList } from "@/components/ui/PickList";
import {
  GROUP_LINES_EVENT,
  isLineGrouping,
  LINE_GROUPINGS,
  LINES_GROUPED_EVENT,
  type LineGrouping,
} from "@/lib/specialOrderLines";

/**
 * THE ITEMS TAB'S GROUP BY, IN THE RECORD'S HEADER to the left of Actions
 * (Mark, 2026-11-04), shown only on that tab. `OrderLines` still owns the
 * grouping and writes it; this asks, and shows what the table reports back.
 */
export function ItemsGroupBy({ saved }: { saved: string | null }) {
  const [value, setValue] = useState<LineGrouping>(isLineGrouping(saved) ? saved : "none");

  useEffect(() => {
    const onGrouped = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail;
      if (isLineGrouping(next)) setValue(next);
    };
    window.addEventListener(LINES_GROUPED_EVENT, onGrouped);
    return () => window.removeEventListener(LINES_GROUPED_EVENT, onGrouped);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-[0.12em] text-subtle">Group by</span>
      <PickList
        variant="field"
        fit
        ariaLabel="Group items by"
        value={value}
        onPick={(next) => {
          if (!isLineGrouping(next)) return;
          setValue(next);
          window.dispatchEvent(new CustomEvent(GROUP_LINES_EVENT, { detail: next }));
        }}
        options={LINE_GROUPINGS}
      />
    </div>
  );
}
