import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr } from "@/lib/roles";
import { PageHeading } from "@/components/ui/PageHeading";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { AddPayrollBenefit } from "@/components/payroll/AddPayrollBenefit";
import {
  PayrollBenefitsList,
  type PayrollBenefitRow,
} from "@/components/payroll/PayrollBenefitsList";
import type { BenefitUnit } from "@/lib/payrollBenefits";

/**
 * The benefit catalog — what a flat allowance IS, before anybody earns one.
 *
 * A list with no detail route, the `/shop-sections` shape: one to five rows of
 * six columns, every one editable in place. The same argument `/timesheets`
 * used for having none — a benefit is a row, not a record.
 *
 * WHO earns it lives on the employee, under Payroll. That split is the point:
 * "we pay $12 a shift for parking" is org configuration and any member may read
 * it, while "Angelica earns it at DF02" is pay data and is owner/admin, which is
 * exactly how 033 sets the two tables' policies.
 */
export default async function PayrollBenefitsPage() {
  const session = await getAppSession();
  const supabase = await createClient();

  // The nav already hides this for anyone below admin, but that is a TIDINESS
  // rule and never the gate — RLS is. Someone arriving by URL gets a sentence
  // rather than an empty table that reads as "no benefits configured".
  if (!canReadHr(session.membership.role)) {
    return (
      <p className="max-w-[72ch] text-sm text-muted">
        Payroll benefits are visible to managers and owners.
        {/* "Payroll benefits" in the sentence where the heading says "Benefits"
            (Mark, 2026-08-06): the menu word is short because it sits under HR
            with Timesheets, and a lone sentence has no such neighbours to say
            which kind of benefit it means. */}
      </p>
    );
  }

  const [{ data: benefits, error }, { data: entitlements }] = await Promise.all([
    supabase
      .from("payroll_benefits")
      .select("id, code, name, gusto_column, unit, default_amount, is_active, notes")
      .order("sort_order")
      .order("name"),
    supabase.from("employee_benefits").select("benefit_id"),
  ]);

  if (error) {
    // Before 033 is applied this says "Could not find the table" rather than
    // rendering an empty list, which would read as "nothing configured yet" —
    // the same reason PO detail shows the Postgres error where its Paperwork
    // card would be.
    return (
      <p className="text-sm text-accent">
        Could not load payroll benefits: {error.message}
        {/payroll_benefits|employee_benefits/.test(error.message)
          ? " — migration 033 has not been applied yet."
          : ""}
      </p>
    );
  }

  const counts = new Map<string, number>();
  for (const e of entitlements ?? []) {
    const id = e.benefit_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const rows: PayrollBenefitRow[] = (benefits ?? []).map((b) => ({
    id: b.id as string,
    code: b.code as string,
    name: b.name as string,
    gusto_column: b.gusto_column as string,
    unit: b.unit as BenefitUnit,
    default_amount: b.default_amount === null ? null : Number(b.default_amount),
    is_active: (b.is_active ?? true) as boolean,
    notes: (b.notes ?? null) as string | null,
    entitlements: counts.get(b.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Org-wide, and the list does not filter, so there is nothing to count
          "of" — the total alone is the honest line. */}
      <PageHeading title="Benefits" total={rows.length} noun="benefits" />

      <PayrollBenefitsList rows={rows} editable={canReadHr(session.membership.role)} />

      <section className="space-y-2">
        <SectionHeading>Adding one</SectionHeading>
        <AddPayrollBenefit orgId={session.membership.org_id} />
      </section>
    </div>
  );
}
