"use client";

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
 * Which fortnight, and what state it's in.
 *
 * IT CARRIED THREE COMMANDS UNTIL 2026-09-12 — New pay period, Recalculate…
 * and Close pay period… — which are rows of the title row's Actions menu now,
 * with the list's two. The row itself stays, because the PICKER is the screen's
 * scope and belongs above the shifts it chooses.
 *
 * Hoisted out of `TimesheetsList`'s filter row (Mark, 2026-08-06) to make a
 * split that was never about tidiness: the controls below act on the SHIFTS —
 * search them, group them, add one — while these acted on the PERIOD. THAT
 * SPLIT SURVIVES AS THE MENU'S TWO GROUPS rather than as two rows of buttons;
 * see `TimesheetCommandMenu`, which cites this note for where its rule comes
 * from.
 *
 * The picker is also what the deleted pay-period LIST was for. 178 periods is
 * more than a menu wants, which is why `PickList` grows a find box past eight
 * options — you type a date rather than scroll a calendar.
 */
export function PeriodBar({
  periods,
  periodId,
  status,
}: {
  periods: PeriodOption[];
  periodId: string | null;
  /** The chosen period's status, for the chip beside the picker. */
  status: PayPeriodStatus | null;
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

    </div>
  );
}
