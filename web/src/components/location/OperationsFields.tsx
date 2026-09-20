"use client";

import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { PERCENT_SCALE, percentLabel, toPercent } from "@/lib/percent";

/**
 * Tax rate, labor rate, register count.
 *
 * A client component for one reason: `InlineValue`'s `format` is a FUNCTION,
 * and functions can't be handed from a server component to a client one. Every
 * other `format` in the app is called from a `"use client"` table for the same
 * reason — this is the block that needed the boundary, so it's the block that
 * moved.
 */
export function OperationsFields({
  locationId,
  taxRate,
  laborRate,
  registerCount,
  editable,
}: {
  locationId: string;
  taxRate: number | null;
  laborRate: number | null;
  registerCount: number | null;
  editable: boolean;
}) {
  return (
    <dl className="grid max-w-md grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
      <dt className="text-subtle">Tax rate</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="locations"
            id={locationId}
            column="tax_rate"
            value={taxRate}
            kind="number"
            // Stored as a FRACTION, shown AND TYPED as a percentage: 0.0975 is
            // what arithmetic wants and 9.75% is what the sign on the wall
            // says. It came here with the special order's two rate cells
            // (Mark, 2026-09-20) because it is the same trap on the same
            // quantity — this is the column theirs is snapshotted FROM, so
            // leaving it in fractions would mean the two screens asking for
            // one number in two units.
            scale={PERCENT_SCALE}
            format={percentLabel}
          />
        ) : (
          <span className={taxRate === null ? "text-faint" : ""}>
            {taxRate === null ? "none" : percentLabel(toPercent(Number(taxRate)))}
          </span>
        )}
      </dd>

      <dt className="text-subtle">Labor rate</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="locations"
            id={locationId}
            column="labor_rate"
            value={laborRate}
            kind="number"
            format={(v) => `$${Number(v).toFixed(2)}/hr`}
          />
        ) : (
          <span className={laborRate === null ? "text-faint" : ""}>
            {laborRate === null ? "none" : `$${Number(laborRate).toFixed(2)}/hr`}
          </span>
        )}
      </dd>

      <dt className="text-subtle">Registers</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="locations"
            id={locationId}
            column="register_count"
            value={registerCount}
            kind="number"
          />
        ) : (
          <span className={registerCount === null ? "text-faint" : ""}>
            {registerCount ?? "none"}
          </span>
        )}
      </dd>
    </dl>
  );
}

