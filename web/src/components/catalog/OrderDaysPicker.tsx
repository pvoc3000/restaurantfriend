"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ISO weekdays, 1 = Monday … 7 = Sunday (CLAUDE.md).
const DAYS = [
  { weekday: 1, label: "M" },
  { weekday: 2, label: "T" },
  { weekday: 3, label: "W" },
  { weekday: 4, label: "T" },
  { weekday: 5, label: "F" },
  { weekday: 6, label: "S" },
  { weekday: 7, label: "S" },
];

/** One plan row, as far as this control cares. */
export type PlanRow = {
  id: string;
  item_location_id: string;
  weekday: number;
  vendor_item_id: string | null;
  par_qty: number | null;
};

/**
 * The item's ordering days at one location — FMP's item-level order days.
 *
 * A day is "on" when the item-location has any plan row for it, because a plan
 * row IS the statement "we order this here on this day" (spec §4.1). Clearing
 * every day is the move Mark relies on: the item stays in the catalog and stays
 * orderable in the moment, but drops out of the day-to-day guide instead of
 * being deactivated.
 *
 * The finer control is the favorites grid behind the row's disclosure — this
 * picker is the coarse switch, that one chooses vendor items per day.
 */
export function OrderDaysPicker({
  itemLocationId,
  orgId,
  rows,
}: {
  itemLocationId: string;
  orgId: string;
  rows: PlanRow[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byDay = new Map<number, PlanRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.weekday) ?? [];
    list.push(row);
    byDay.set(row.weekday, list);
  }

  function toggle(weekday: number) {
    const existing = byDay.get(weekday) ?? [];
    setError(null);

    if (existing.length > 0) {
      // par_qty lives on the plan row, so clearing a day throws away that day's
      // par overrides. Cheap to warn, expensive to discover later.
      const withPars = existing.filter((r) => r.par_qty !== null).length;
      if (
        withPars > 0 &&
        !window.confirm(
          `Clearing this day removes ${existing.length} favorite${
            existing.length === 1 ? "" : "s"
          }, including ${withPars} with a per-line par. Continue?`
        )
      ) {
        return;
      }

      startTransition(async () => {
        const { error } = await supabase
          .from("order_guide_plan_days")
          .delete()
          .in(
            "id",
            existing.map((r) => r.id)
          );
        if (error) setError(error.message);
        else router.refresh();
      });
      return;
    }

    // Turning a day ON needs a vendor item, and this control doesn't say which.
    // A null vendor_item_id means "inherit the item-location's default", which
    // v_order_guide resolves via coalesce — so the day works immediately and
    // the favorites grid can refine it later.
    startTransition(async () => {
      const { error } = await supabase.from("order_guide_plan_days").insert({
        org_id: orgId,
        item_location_id: itemLocationId,
        weekday,
        vendor_item_id: null,
      });
      if (error) setError(error.message);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      {DAYS.map((day) => {
        const lines = byDay.get(day.weekday) ?? [];
        const on = lines.length > 0;
        return (
          <button
            key={day.weekday}
            type="button"
            aria-pressed={on}
            aria-label={`Order day ${day.weekday}`}
            disabled={pending}
            onClick={() => toggle(day.weekday)}
            // The count includes plan rows the favorites grid hides (a
            // deactivated vendor), so an "on" day never looks empty by mistake.
            title={
              on
                ? `${lines.length} favorite${lines.length === 1 ? "" : "s"} on this day`
                : "Not ordered on this day"
            }
            className={`rounded px-1 text-xs tabular-nums disabled:opacity-50 ${
              on
                ? "bg-neutral-900 text-white"
                : "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
            }`}
          >
            {day.label}
          </button>
        );
      })}
      {error && <span className="ml-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}
