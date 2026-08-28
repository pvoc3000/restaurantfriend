"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { formatWorkdayStart } from "@/lib/workday";

/**
 * The payroll settings that live on the person.
 *
 * FOUR OF THESE HAD NO UI WRITER ANYWHERE until this block, and the fifth —
 * the organization's own employee number — was queried and never shown. `gusto_id` and
 * `primary_wage_type` arrived only in 031's backfill, `homebase_id` only when
 * the importer links an unmatched name, and `excludes_tips` only from SQL —
 * while `exportReadiness` has been reporting "N people have no payroll id" and "N
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
  workdayStartsAt,
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
  /** Migration 061 — null means midnight, which is most people. */
  workdayStartsAt: string | null;
  /** Every job title already in use, so the picker offers rather than invents. */
  wageTypes: string[];
  editable: boolean;
}) {
  // THE SAME TRACK THE EMPLOYMENT BLOCK ABOVE IT USES. Two field blocks
  // stacked on one tab with different left and right edges read as
  // misalignment the moment the values are boxed — which is half of what this
  // convention makes visible.
  return (
    <dl className="grid max-w-md grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
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
      <dt className="text-subtle">Organization ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="employees"
            id={employeeId}
            column="legacy_id"
            kind="number"
            value={legacyId}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{legacyId ?? "—"}</span>
        )}
      </dd>

      <dt className="text-subtle">Primary job</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="employees"
            id={employeeId}
            column="primary_wage_type"
            kind="pick"
            allowNew
            value={primaryWageType}
            options={wageTypes.map((w) => ({ value: w, label: w }))}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{primaryWageType ?? "—"}</span>
        )}
      </dd>

      <dt className="text-subtle">Payroll ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="employees"
            id={employeeId}
            column="gusto_id"
            value={gustoId}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{gustoId ?? "—"}</span>
        )}
      </dd>

      <dt className="text-subtle">Time Clock ID</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="employees"
            id={employeeId}
            column="homebase_id"
            value={homebaseId}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{homebaseId ?? "—"}</span>
        )}
      </dd>

      {/* WHEN THIS PERSON'S OVERTIME DAY BEGINS (migration 061).

          The only field on this block whose ABSENCE means something, which is
          why the placeholder says "midnight" rather than sitting empty — an
          empty box reads as something nobody got round to filling in, and this
          one is a real answer and the right one for almost everybody.

          It is on the payroll block rather than with Position because it is not
          a description of the job: it is the 24-hour window California daily
          overtime is counted over, and it changes what this person is paid. */}
      <dt className="self-start pt-2 text-subtle">Workday starts</dt>
      <dd>
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="employees"
            id={employeeId}
            column="workday_starts_at"
            kind="time"
            value={workdayStartsAt}
            ariaLabel="Workday starts"
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {formatWorkdayStart(workdayStartsAt) ?? "midnight"}
          </span>
        )}
        <p className="max-w-[52ch] pt-0.5 text-[12px] leading-snug text-muted">
          {workdayStartsAt
            ? `Their day runs ${formatWorkdayStart(workdayStartsAt)} to ${formatWorkdayStart(workdayStartsAt)}, so one overnight is one workday instead of two dates. Applies to shifts imported from now on.`
            : "Midnight. Set an afternoon time for someone whose shift crosses midnight — an overnight baker — so a night's work counts as one day rather than stacking onto the calendar date."}
        </p>
      </dd>

      <dt className="text-subtle">Tips</dt>
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
