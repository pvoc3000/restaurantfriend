"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { PickList } from "@/components/ui/PickList";
import {
  PAY_PERIOD_STATUS_LABEL,
  formatPeriodRange,
  type PayPeriodStatus,
} from "@/lib/payPeriods";
import { StatusChip } from "./PayPeriodStatusChip";
import type { PeriodOption } from "./TimesheetsList";

/**
 * Which fortnight, what state it's in, and the commands that act on it.
 *
 * Hoisted out of `TimesheetsList`'s filter row (Mark, 2026-08-06), and that is
 * the point of the row rather than tidiness: the controls below act on the
 * SHIFTS — search them, group them, add one — while these act on the PERIOD.
 * Reading top to bottom the screen now goes "which fortnight → the shifts in it
 * → the file", which is the order the work happens in.
 *
 * The picker is also what the deleted pay-period LIST was for. 178 periods is
 * more than a menu wants, which is why `PickList` grows a find box past eight
 * options — you type a date rather than scroll a calendar.
 */
export function PeriodBar({
  periods,
  periodId,
  status,
  children,
}: {
  periods: PeriodOption[];
  periodId: string | null;
  /** The chosen period's status, for the chip beside the picker. */
  status: PayPeriodStatus | null;
  /** The commands, right-aligned. New pay period then Export timesheets — the
   *  ActionBar's rule that the primary cell is the one against the edge. */
  children?: ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="space-y-1.5">
        <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
          Pay period
        </span>
        <PickList
          variant="field"
          ariaLabel="Pay period"
          value={periodId ?? ""}
          onPick={(id) => router.push(`/timesheets?period=${id}`)}
          options={periods.map((p) => ({
            value: p.id,
            label: formatPeriodRange(p),
            hint: PAY_PERIOD_STATUS_LABEL[p.status],
          }))}
          className="w-64"
        />
      </label>

      {/* items-end on the row, so the chip sits on the picker's baseline rather
          than floating level with its caption. */}
      {status && (
        <span className="flex h-9 items-center">
          <StatusChip status={status} />
        </span>
      )}

      {children && (
        <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>
      )}
    </div>
  );
}
