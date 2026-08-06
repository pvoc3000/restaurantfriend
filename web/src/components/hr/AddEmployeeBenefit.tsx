"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BENEFIT_UNIT_LABEL, type BenefitUnit } from "@/lib/payrollBenefits";

export type BenefitOption = {
  id: string;
  name: string;
  unit: BenefitUnit;
  default_amount: number | null;
};

/**
 * Give somebody a benefit at a shop.
 *
 * `AddShopSection`'s template, and it STAYS OPEN after each add, clearing only
 * the shop — because the shape of this task is FileMaker's own: six of the
 * thirteen configured people earn the commuter benefit at two shops, and adding
 * the second immediately after the first is the normal way to enter one.
 */
export function AddEmployeeBenefit({
  employeeId,
  orgId,
  benefits,
  locations,
}: {
  employeeId: string;
  orgId: string;
  benefits: BenefitOption[];
  /** ACTIVE shops only — this enumerates somewhere to give a benefit, and a
   *  closed shop is not one (design rule 3). */
  locations: { id: string; code: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [benefitId, setBenefitId] = useState(benefits[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [startsOn, setStartsOn] = useState<string | null>(null);
  const [endsOn, setEndsOn] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const benefit = benefits.find((b) => b.id === benefitId) ?? null;
  const amountValue = amount.trim() === "" ? null : Number(amount);
  const amountOk = amountValue === null || (Number.isFinite(amountValue) && amountValue >= 0);
  const ready = benefitId !== "" && locationId !== "" && amountOk;

  function close() {
    if (pending) return;
    setOpen(false);
    setLocationId("");
    setAmount("");
    setStartsOn(null);
    setEndsOn(null);
    setFailed(null);
    setAdded(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    const code = locations.find((l) => l.id === locationId)?.code ?? "";
    startTransition(async () => {
      // `org_id` EXPLICITLY — design rule 1, and the `NewPayPeriod` lesson: a
      // WITH CHECK runs before the NOT NULL constraint, so omitting it reports
      // "new row violates row-level security policy" and sends you hunting
      // through roles for a missing column.
      const { error } = await supabase.from("employee_benefits").insert({
        org_id: orgId,
        employee_id: employeeId,
        benefit_id: benefitId,
        location_id: locationId,
        amount: amountValue,
        starts_on: startsOn,
        ends_on: endsOn,
      });
      if (error) {
        setFailed(
          // 23P01 is an exclusion violation — 033's no-overlap constraint. The
          // raw text names a constraint nobody outside the migration has read.
          error.code === "23P01"
            ? `${benefit?.name ?? "That benefit"} already covers some of those dates at ${code}. End the existing one first, or narrow these dates.`
            : error.message
        );
        return;
      }
      setLocationId("");
      setAdded(`${benefit?.name ?? "Benefit"} at ${code}`);
      router.refresh();
    });
  }

  if (benefits.length === 0) {
    return (
      <p className="text-sm text-muted">
        No active payroll benefits are configured yet — set one up under HR →
        Payroll Benefits first.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        Give a benefit
      </button>

      {open && (
        <Dialog
          title="Give a payroll benefit"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Done
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Give it"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Field label="Benefit" required>
                <PickList
                  value={benefitId}
                  options={benefits.map((b) => ({
                    value: b.id,
                    label: b.name,
                    hint: `${BENEFIT_UNIT_LABEL[b.unit].toLowerCase()}${
                      b.default_amount === null ? "" : ` · $${b.default_amount.toFixed(2)}`
                    }`,
                  }))}
                  variant="field"
                  ariaLabel="Benefit"
                  onPick={setBenefitId}
                  className="w-64"
                />
              </Field>
              <Field label="Shop" required>
                <PickList
                  value={locationId || null}
                  options={locations.map((l) => ({ value: l.id, label: l.code }))}
                  variant="field"
                  placeholder="choose"
                  ariaLabel="Shop"
                  onPick={setLocationId}
                  className="w-36"
                />
              </Field>
              <Field label="Amount">
                <TextInput
                  value={amount}
                  onValueChange={setAmount}
                  inputMode="decimal"
                  aria-label="Amount"
                  placeholder={
                    benefit?.default_amount === null || benefit === null
                      ? "none"
                      : benefit.default_amount.toFixed(2)
                  }
                  className="h-9 w-28 text-sm"
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Field label="From">
                <DateField value={startsOn} onChange={setStartsOn} ariaLabel="Earns it from" />
              </Field>
              <Field label="Until">
                <DateField value={endsOn} onChange={setEndsOn} ariaLabel="Earns it until" />
              </Field>
            </div>

            <p className="max-w-[60ch] text-sm text-muted">
              One row per shop — that is how somebody earns a benefit at one shop
              and not the other. Leave the amount blank to use the benefit&rsquo;s
              own default, so changing that default later still moves everyone who
              never differed from it. Both dates are inclusive and either may be
              blank; blank means unbounded.
            </p>

            {added && !failed && (
              <p className="border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
                Added <strong>{added}</strong>. Add another shop, or Done.
              </p>
            )}
            {!amountOk && <p className="text-sm text-accent">Enter dollars, e.g. 12.00</p>}
            {failed && <p className="max-w-[60ch] text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
