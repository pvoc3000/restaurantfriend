"use client";

import { InlineValue } from "@/components/catalog/InlineValue";

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
    <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="py-0.5 text-subtle">Tax rate</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="locations"
            id={locationId}
            column="tax_rate"
            value={taxRate}
            kind="number"
            placeholder="none"
            // Stored as a FRACTION, shown as a percentage: 0.0975 is what
            // arithmetic wants and 9.75% is what the sign on the wall says.
            // Editing shows the raw value — and a number cell takes
            // arithmetic, so "9.75/100" is a legitimate way to type it.
            format={(v) => `${percent(Number(v))}%`}
          />
        ) : (
          <span className={taxRate === null ? "text-faint" : ""}>
            {taxRate === null ? "none" : `${percent(Number(taxRate))}%`}
          </span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Labor rate</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="locations"
            id={locationId}
            column="labor_rate"
            value={laborRate}
            kind="number"
            placeholder="none"
            format={(v) => `$${Number(v).toFixed(2)}/hr`}
          />
        ) : (
          <span className={laborRate === null ? "text-faint" : ""}>
            {laborRate === null ? "none" : `$${Number(laborRate).toFixed(2)}/hr`}
          </span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Registers</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="locations"
            id={locationId}
            column="register_count"
            value={registerCount}
            kind="number"
            placeholder="none"
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

/** 0.0975 → "9.75", 0.1 → "10". No trailing zeros to read past. */
function percent(fraction: number): string {
  return String(Number((fraction * 100).toFixed(4)));
}
