"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";

/**
 * The payroll settings that live on the person.
 *
 * FOUR OF THESE HAD NO UI WRITER ANYWHERE until this block, and the fifth —
 * the organization's own employee number — was queried and never shown. `gusto_id` and
 * `primary_wage_type` arrived only in 031's backfill, `homebase_id` only when
 * the importer links an unmatched name, and `excludes_tips` only from SQL —
 * while `exportReadiness` has been reporting "N people have no Gusto id" and "N
 * rows have no job title" on the export screen the whole time. A caveat you
 * cannot act on is how a caveat stops being read, which is the argument for
 * this block existing at all.
 *
 * NOTE WHAT IS NOT HERE, and must never be: a pay RATE. Decision 1 — this
 * module exports hours and tip dollars and computes no paycheck, so no wage rate
 * is stored anywhere in this schema. Gusto owns that. If a Rate field ever looks
 * like it belongs on this block, it doesn't.
 *
 * The LABELS are vendor-neutral (Mark, 2026-08-06): Payroll ID and Time Clock
 * ID, not Gusto and Homebase. The COLUMNS keep the vendor names, because
 * `gusto_id` and `homebase_id` are schema — every query, the export and 028's
 * partial unique indexes all name them — and design rule 2 is about not baking
 * a business into the app, which a label does and a column already hasn't.
 */
export function EmployeePayroll({
  employeeId,
  legacyId,
  gustoId,
  homebaseId,
  primaryWageType,
  excludesTips,
  wageTypes,
  editable,
}: {
  employeeId: string;
  /** `employees.legacy_id` — FileMaker's own Employee_ID. */
  legacyId: number | null;
  gustoId: string | null;
  homebaseId: string | null;
  primaryWageType: string | null;
  excludesTips: boolean;
  /** Every job title already in use, so the picker offers rather than invents. */
  wageTypes: string[];
  editable: boolean;
}) {
  return (
    <dl className="grid max-w-2xl grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
      {/* The org's own employee number. It is `legacy_id` in the schema and
          FileMaker's `Employee_ID` in origin — all 445 people have one, range
          1–736 — and until now the detail screen queried it only to tell the
          delete confirm that this person came from FileMaker.

          EDITABLE, because someone hired in the app has none and will want one.
          Two things follow from that: it is UNIQUE per org, so a clash comes
          back as a Postgres error in the cell; and the migration scripts join
          on it, so CHANGING an existing one breaks reconciliation against the
          FileMaker export. Neither is a reason to make it read-only — both are
          reasons not to change one idly. */}
      <dt className="py-0.5 text-subtle">Organization ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="employees"
            id={employeeId}
            column="legacy_id"
            kind="number"
            value={legacyId}
            placeholder="none"
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{legacyId ?? "—"}</span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Primary job</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="employees"
            id={employeeId}
            column="primary_wage_type"
            kind="pick"
            allowNew
            value={primaryWageType}
            placeholder="none"
            options={wageTypes.map((w) => ({ value: w, label: w }))}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{primaryWageType ?? "—"}</span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Payroll ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="employees"
            id={employeeId}
            column="gusto_id"
            value={gustoId}
            placeholder="none"
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{gustoId ?? "—"}</span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Time Clock ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            table="employees"
            id={employeeId}
            column="homebase_id"
            value={homebaseId}
            placeholder="none"
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{homebaseId ?? "—"}</span>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Tips</dt>
      <dd>
        <ExcludesTips employeeId={employeeId} value={excludesTips} editable={editable} />
      </dd>
    </dl>
  );
}

/**
 * `InlineValue` has no boolean kind and `ActiveToggle` is a switch hardcoded to
 * `is_active` in a table's leading column, so this is a `ui/Checkbox` — the
 * app's one checkbox — with the sentence it needs beside it.
 */
function ExcludesTips({
  employeeId,
  value,
  editable,
}: {
  employeeId: string;
  value: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(value);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function toggle(next: boolean) {
    if (!editable || pending) return;
    setOn(next);
    setFailed(null);
    startTransition(async () => {
      // .select() its own result: with no matching policy Postgres changes zero
      // rows and PostgREST returns NO error, so a bare update reports a cheerful
      // success and the checkbox stays where you put it.
      const { data, error } = await supabase
        .from("employees")
        .update({ excludes_tips: next })
        .eq("id", employeeId)
        .select("id");
      if (error || (data ?? []).length === 0) {
        setOn(!next);
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      {editable ? (
        <Checkbox checked={on} onChange={toggle} disabled={pending}>
          Excluded from the tip pool
        </Checkbox>
      ) : (
        <span className={READ_ONLY_VALUE}>
          {on ? "Excluded from the tip pool" : "In the tip pool"}
        </span>
      )}
      {failed && <p className="text-[12px] text-accent">{failed}</p>}
    </div>
  );
}
