"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { EARNING_COLUMNS } from "@/lib/gustoExport";
import { BENEFIT_UNIT_HINT, BENEFIT_UNIT_LABEL, type BenefitUnit } from "@/lib/payrollBenefits";

/** `Overnight differential` → `overnight_differential`. */
function toCode(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * A new kind of benefit.
 *
 * `AddShopSection`'s template, including staying open after each add — a benefit
 * is rarer than a shelf, but the reason holds: this is the screen you visit when
 * payroll changes, and payroll changes tend to arrive in twos.
 *
 * The code is DERIVED from the name and shown read-only rather than typed. It is
 * what the backfill script and any future migration match on, so it wants to be
 * stable and lowercase, and asking for it separately invites a second name that
 * disagrees with the first.
 */
export function AddPayrollBenefit({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<BenefitUnit>("per_shift");
  const [column, setColumn] = useState<string>("custom_earning_commuter_benefit");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const code = toCode(name);
  // Empty is not zero: a blank amount means "no default", which is a real state
  // (every entitlement then carries its own figure). A typed non-number is not.
  const amountValue = amount.trim() === "" ? null : Number(amount);
  const amountOk = amountValue === null || (Number.isFinite(amountValue) && amountValue >= 0);
  const ready = code !== "" && column !== "" && amountOk;

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setAmount("");
    setUnit("per_shift");
    setColumn("custom_earning_commuter_benefit");
    setFailed(null);
    setAdded(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    const label = name.trim();
    startTransition(async () => {
      // `org_id` EXPLICITLY — design rule 1. No table defaults it, and a WITH
      // CHECK is evaluated before the NOT NULL constraint, so omitting it
      // reports "new row violates row-level security policy" and sends you off
      // to look at roles when the fault is a missing column.
      const { error } = await supabase.from("payroll_benefits").insert({
        org_id: orgId,
        code,
        name: label,
        gusto_column: column,
        unit,
        default_amount: amountValue,
      });
      if (error) {
        setFailed(
          error.code === "23505" ? `A benefit coded "${code}" already exists.` : error.message
        );
        return;
      }
      setName("");
      setAmount("");
      setAdded(label);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New benefit
      </button>

      {open && (
        <Dialog
          title="New payroll benefit"
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
                {pending ? "Adding…" : "Add benefit"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Name" required>
              <TextInput
                value={name}
                onValueChange={setName}
                aria-label="Benefit name"
                placeholder="Overnight differential"
                autoFocus
                className="h-9 w-full text-sm"
              />
            </Field>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Field label="Amount">
                <TextInput
                  value={amount}
                  onValueChange={setAmount}
                  inputMode="decimal"
                  aria-label="Default amount"
                  placeholder="12.00"
                  className="h-9 w-28 text-sm"
                />
              </Field>
              <Field label="How often" required>
                <PickList
                  value={unit}
                  options={(["per_shift", "per_workday", "per_period"] as BenefitUnit[]).map((u) => ({
                    value: u,
                    label: BENEFIT_UNIT_LABEL[u],
                    hint: BENEFIT_UNIT_HINT[u],
                  }))}
                  variant="field"
                  ariaLabel="How often"
                  onPick={(v) => setUnit(v as BenefitUnit)}
                  className="w-56"
                />
              </Field>
            </div>

            <Field label="Gusto column" required>
              <PickList
                value={column}
                options={EARNING_COLUMNS.map((c) => ({ value: c, label: c }))}
                variant="field"
                ariaLabel="Gusto column"
                onPick={setColumn}
                className="w-full"
              />
            </Field>

            <p className="max-w-[60ch] text-sm text-muted">
              The amount here is the default. An entitlement can override it per
              person and per shop, so leave it blank only if every person differs.
              The Gusto column is where the dollars land in the export file
              {code !== "" && (
                <>
                  {" "}
                  — this one will be coded <strong>{code}</strong>
                </>
              )}
              .
            </p>

            {added && !failed && (
              <p className="border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
                Added <strong>{added}</strong>. Give people the benefit on their
                own records, under Payroll.
              </p>
            )}
            {!amountOk && <p className="text-sm text-accent">Enter dollars, e.g. 12.00</p>}
            {failed && <p className="text-sm text-accent">{failed}</p>}
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
