import {
  PAY_PERIOD_STATUS_CLASS,
  PAY_PERIOD_STATUS_LABEL,
  type PayPeriodStatus,
} from "@/lib/payPeriods";

/**
 * The PO list's chip, exactly — same box, same type, same class vocabulary.
 *
 * It lived in `PayPeriodsList.tsx` and outlived that list (Mark, 2026-08-06):
 * the pay-period screens folded into Timesheets, and the chip is now read on the
 * period bar and in the export panel. A component two callers import out of a
 * deleted file's neighbour is a component that wants its own file.
 */
export function StatusChip({ status }: { status: PayPeriodStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PAY_PERIOD_STATUS_CLASS[status]}`}
    >
      {PAY_PERIOD_STATUS_LABEL[status]}
    </span>
  );
}
