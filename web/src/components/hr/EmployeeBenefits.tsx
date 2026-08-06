"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { RowMenu } from "@/components/ui/RowMenu";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_DANGER_CLASS } from "@/components/ui/Dialog";
import { BENEFIT_UNIT_LABEL, type BenefitUnit } from "@/lib/payrollBenefits";

export type EmployeeBenefitRow = {
  id: string;
  benefit_id: string;
  benefitName: string;
  benefitUnit: BenefitUnit;
  /** The benefit's own default, for the "(default)" reading of a null amount. */
  benefitDefault: number | null;
  location_id: string;
  locationCode: string;
  amount: number | null;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
};

/**
 * What this person earns, where, and when.
 *
 * ONE ROW PER SHOP, which is the shape FileMaker's repeating field had and the
 * shape the measurements vindicated: Angelica Castellanos worked 359 DF01 shifts
 * and four DF02 ones, and only the DF02 four ever paid. "Earns it at one shop
 * and not the other" is the whole fact, so it is a row rather than a flag.
 *
 * The dates are inclusive and either may be blank. 033's exclusion constraint
 * refuses two rows covering the same day for one (person, benefit, shop), so
 * "$12 through June, $15 from July" is expressible and "$12 and also $15" is
 * not — the database decides, and a clash comes back as a plain error here.
 *
 * REMOVING one is for a mistake. To stop somebody earning a benefit, set an end
 * date: the accrual is derived from these rows, so a delete rewrites what every
 * unfrozen period thinks it owes, while an end date leaves the history alone.
 */
export function EmployeeBenefits({
  rows,
  editable,
}: {
  rows: EmployeeBenefitRow[];
  editable: boolean;
}) {
  const columns: DataColumn<EmployeeBenefitRow>[] = [
    {
      key: "benefit",
      label: "Benefit",
      width: 200,
      pinned: true,
      sortValue: (r) => r.benefitName,
      render: (r) => (
        <span>
          {r.benefitName}
          <span className="ml-2 text-[12px] text-muted">
            {BENEFIT_UNIT_LABEL[r.benefitUnit].toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: "shop",
      label: "Shop",
      width: 90,
      sortValue: (r) => r.locationCode,
      render: (r) => r.locationCode,
    },
    {
      key: "amount",
      label: "Amount",
      width: 130,
      sortValue: (r) => r.amount ?? r.benefitDefault ?? -1,
      render: (r) =>
        editable ? (
          <InlineValue
            table="employee_benefits"
            id={r.id}
            column="amount"
            kind="number"
            value={r.amount}
            // Blank is not zero: it means "whatever the benefit says", so that
            // changing the default still moves everyone who never differed.
            placeholder={r.benefitDefault === null ? "none" : `${r.benefitDefault.toFixed(2)}`}
            format={(v) => `$${Number(v).toFixed(2)}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {r.amount === null
              ? r.benefitDefault === null
                ? "—"
                : `$${r.benefitDefault.toFixed(2)}`
              : `$${r.amount.toFixed(2)}`}
          </span>
        ),
    },
    {
      key: "from",
      label: "From",
      width: 150,
      sortValue: (r) => r.starts_on ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="employee_benefits"
            id={r.id}
            column="starts_on"
            kind="date"
            value={r.starts_on}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.starts_on ?? "—"}</span>
        ),
    },
    {
      key: "until",
      label: "Until",
      width: 150,
      sortValue: (r) => r.ends_on ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="employee_benefits"
            id={r.id}
            column="ends_on"
            kind="date"
            value={r.ends_on}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.ends_on ?? "—"}</span>
        ),
    },
    {
      key: "notes",
      label: "Note",
      width: 240,
      hideWhenCompact: true,
      sortValue: (r) => r.notes ?? "",
      render: (r) =>
        editable ? (
          <InlineValue table="employee_benefits" id={r.id} column="notes" value={r.notes} />
        ) : (
          <span className="text-muted">{r.notes ?? "—"}</span>
        ),
    },
    ...(editable
      ? [
          {
            key: "menu",
            label: "",
            width: 60,
            render: (r: EmployeeBenefitRow) => <RemoveBenefit row={r} />,
          } as DataColumn<EmployeeBenefitRow>,
        ]
      : []),
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="rf.employeeBenefits.v1"
      columnChooser
      compactBelow={1100}
      empty={<p className="text-sm text-muted">This person earns no flat benefits.</p>}
    />
  );
}

function RemoveBenefit({ row }: { row: EmployeeBenefitRow }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function remove() {
    setFailed(null);
    startTransition(async () => {
      // .select() its own result — the `order_guide_entries` lesson. With no
      // matching policy Postgres deletes zero rows and PostgREST returns NO
      // error, so a bare delete reports a cheerful success.
      const { data, error } = await supabase
        .from("employee_benefits")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error || (data ?? []).length === 0) {
        setFailed(error?.message ?? "Nothing was removed.");
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <RowMenu
        label={`Actions for ${row.benefitName} at ${row.locationCode}`}
        items={[{ label: "Remove…", onSelect: () => setConfirming(true) }]}
      />
      {confirming && (
        <Dialog
          title="Remove this benefit"
          onClose={() => !pending && setConfirming(false)}
          busy={pending}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className={DIALOG_DANGER_CLASS}
              >
                {pending ? "Removing…" : "Remove"}
              </button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <p className="max-w-[60ch]">
              Removes <strong>{row.benefitName}</strong> at{" "}
              <strong>{row.locationCode}</strong> entirely, as though it had never
              been given.
            </p>
            <p className="max-w-[60ch] text-muted">
              Accruals are worked out from this row every time payroll is read, so
              removing it changes what every pay period that has NOT been
              finalized thinks is owed — including past ones. If the person simply
              stopped earning it, set an <strong>Until</strong> date instead: that
              leaves the history intact.
            </p>
            <p className="max-w-[60ch] text-muted">
              Already-finalized periods keep their frozen figures either way.
            </p>
            {failed && <p className="text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
