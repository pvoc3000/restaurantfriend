/**
 * Flat payroll benefits — the commuter allowance, and whatever comes after it.
 *
 * A benefit is a fixed number of dollars a person earns for working a
 * qualifying shift at a qualifying shop. It is not a wage and not derived from
 * one: $12 because somebody decided $12. That is why dollars may live here at
 * all when decision 1 forbids storing a rate — see migration 033's header.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DERIVES RATHER THAN READING A STAMP
 *
 * FileMaker stamped a dollar figure onto each timesheet at import, and the
 * stamp has holes. Casildo Herrera worked seven consecutive DF02 overnights in
 * July 2024 unstamped; two currently-configured people, one of them active,
 * were never stamped at all. Nothing surfaced any of it, because a stamped
 * number cannot explain itself — a zero sitting in a column looks exactly like
 * a person who wasn't entitled.
 *
 * So the accrual is derived, which is decision 3's posture (`lib/breakRules`
 * derives a violation and never stores one), and `explainShift` below is the
 * half that a stamp could never have: it says WHY a shift earned nothing.
 *
 * What derivation costs is stability — an entitlement corrected in September
 * would restate July's dollars. That is paid for by the freeze: at export
 * `freeze_pay_period` snapshots every accrual into `timesheet_benefits`, and
 * `mergeFrozen` makes the snapshot win. Decision 10's argument for freezing the
 * tip allocations, reaching a second table.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not read or write the database, and it does not know what a pay
 * period is — `per_period` means "once across the shifts you handed me", and
 * scoping the input is the caller's job.
 *
 * And there is NO per-hour or percentage unit, now or ever. A percentage would
 * be a percentage of wages, which needs a rate, which decision 1 forbids
 * storing. If one is ever wanted, that is a conversation about decision 1 and
 * not a new branch in `computeAccruals`.
 */

import { compareByStart } from "./overtime";

export type BenefitUnit = "per_shift" | "per_workday" | "per_period";

export const BENEFIT_UNIT_LABEL: Record<BenefitUnit, string> = {
  per_shift: "Per shift",
  per_workday: "Per day",
  per_period: "Per pay period",
};

/** What each unit means, for the picker — the per_workday caveat especially. */
export const BENEFIT_UNIT_HINT: Record<BenefitUnit, string> = {
  per_shift: "Once for every qualifying shift",
  per_workday: "Once a day, even if they worked two shops",
  per_period: "Once in the whole pay period",
};

export type PayrollBenefit = {
  id: string;
  code: string;
  name: string;
  /** The Gusto column its dollars land in. See `EARNING_COLUMNS` in gustoExport. */
  gusto_column: string;
  unit: BenefitUnit;
  default_amount: number | null;
  is_active: boolean;
};

export type BenefitEntitlement = {
  id: string;
  employee_id: string;
  benefit_id: string;
  /** NOT NULL in the schema: one row per shop is what makes "earns at DF02 and
   *  not DF01" the first-class fact it turned out to be. */
  location_id: string;
  /** null = the benefit's `default_amount`. Design rule 6's override → base. */
  amount: number | null;
  /** INCLUSIVE at both ends; null = unbounded. Tested against `workday`. */
  starts_on: string | null;
  ends_on: string | null;
};

export type BenefitShift = {
  id: string;
  employee_id: string;
  location_id: string | null;
  workday: string;
  clock_in: string | null;
  clock_out: string | null;
};

export type BenefitAccrual = {
  timesheet_id: string;
  benefit_id: string;
  employee_id: string;
  /** The shift's workday. Carried so `explainShift` can say WHICH other shift
   *  took a `per_workday` benefit without being handed the whole period. */
  workday: string;
  /** Dollars. */
  amount: number;
  /** Which entitlement paid it. Null on a row that exists only as a snapshot. */
  entitlement_id: string | null;
};

/** The little a frozen row needs looking up, since the snapshot stores neither. */
export type AccrualContext = { employee_id: string; workday: string };

/** Two decimal places, matching numeric(10,2), and never -0. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100 + 0;
}

/* -------------------------------------------------------------------------- */
/* Qualification                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A real worked shift: both punches and a shop.
 *
 * PUNCH-BASED, NOT HOURS-BASED, and that is the choice worth defending. A flat
 * allowance pays for showing up, so a quarter-hour shift earns it in full while
 * a nine-hour PTO adjustment earns nothing — you didn't commute to it. It also
 * matches what FileMaker actually did: of 6,249 zero-hour rows, 3 were ever
 * stamped, which is the rounding error on "never".
 *
 * `kind = 'adjustment'` rows have no punches by construction (028), so this
 * excludes them without needing to know the column exists.
 */
export function isAccruableShift(s: BenefitShift): boolean {
  return Boolean(s.clock_in && s.clock_out && s.location_id);
}

/** Inclusive at both ends; a null bound is unbounded. */
function coversDay(e: BenefitEntitlement, workday: string): boolean {
  if (e.starts_on && workday < e.starts_on) return false;
  if (e.ends_on && workday > e.ends_on) return false;
  return true;
}

/**
 * The entitlement covering this (employee, benefit, shop) on this day.
 *
 * At most one can match: 033's exclusion constraint is what guarantees it, so
 * this is a lookup rather than a choice between candidates.
 */
export function entitlementOn(
  entitlements: readonly BenefitEntitlement[],
  employee_id: string,
  benefit_id: string,
  location_id: string,
  workday: string
): BenefitEntitlement | null {
  for (const e of entitlements) {
    if (
      e.employee_id === employee_id &&
      e.benefit_id === benefit_id &&
      e.location_id === location_id &&
      coversDay(e, workday)
    ) {
      return e;
    }
  }
  return null;
}

/** The entitlement's own amount, else the benefit's default, else nothing. */
export function benefitAmount(b: PayrollBenefit, e: BenefitEntitlement): number {
  return e.amount ?? b.default_amount ?? 0;
}

/* -------------------------------------------------------------------------- */
/* The accruals                                                                */
/* -------------------------------------------------------------------------- */

type Qualifying = { shift: BenefitShift; entitlement: BenefitEntitlement; amount: number };

/**
 * Compute what each shift earns.
 *
 * Deterministic: the answer does not depend on the order the shifts arrive in.
 * That is not a nicety — PostgREST returns rows in whatever order it likes
 * unless asked, and a `per_workday` benefit has to choose ONE shift out of a
 * day. The choice is chronological, using `lib/overtime`'s own comparator.
 */
export function computeAccruals(
  shifts: readonly BenefitShift[],
  benefits: readonly PayrollBenefit[],
  entitlements: readonly BenefitEntitlement[]
): BenefitAccrual[] {
  const out: BenefitAccrual[] = [];

  for (const benefit of benefits) {
    if (!benefit.is_active) continue;

    // Everything this benefit could pay for, before the unit's cap applies.
    const qualifying: Qualifying[] = [];
    for (const shift of shifts) {
      if (!isAccruableShift(shift)) continue;
      const entitlement = entitlementOn(
        entitlements,
        shift.employee_id,
        benefit.id,
        // isAccruableShift has already established this is non-null.
        shift.location_id as string,
        shift.workday
      );
      if (!entitlement) continue;
      const amount = benefitAmount(benefit, entitlement);
      // A zero-dollar entitlement is a configuration that pays nothing. Emitting
      // a $0 row would put an empty line in front of somebody and imply a
      // decision nobody made.
      if (amount <= 0) continue;
      qualifying.push({ shift, entitlement, amount });
    }

    // The cap. `per_shift` has none; the other two keep the chronologically
    // first shift of their group and drop the rest — the same "first" the
    // overtime pour uses, so a day's benefit and a day's overtime cannot
    // disagree about which shift came first.
    const kept =
      benefit.unit === "per_shift"
        ? qualifying
        : firstPerGroup(qualifying, (q) =>
            benefit.unit === "per_workday"
              ? `${q.shift.employee_id}|${q.shift.workday}`
              : q.shift.employee_id
          );

    for (const q of kept) {
      out.push({
        timesheet_id: q.shift.id,
        benefit_id: benefit.id,
        employee_id: q.shift.employee_id,
        workday: q.shift.workday,
        amount: round2(q.amount),
        entitlement_id: q.entitlement.id,
      });
    }
  }

  return out;
}

/** One per group — the earliest shift, ties broken by id. */
function firstPerGroup(rows: readonly Qualifying[], key: (q: Qualifying) => string): Qualifying[] {
  const best = new Map<string, Qualifying>();
  for (const q of rows) {
    const k = key(q);
    const current = best.get(k);
    if (!current || compareByStart(startable(q), startable(current)) < 0) best.set(k, q);
  }
  return [...best.values()];
}

function startable(q: Qualifying) {
  return { id: q.shift.id, starts_at: q.shift.clock_in };
}

/* -------------------------------------------------------------------------- */
/* The snapshot                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Fold the frozen accruals over the derived ones, FROZEN WINNING.
 *
 * This is backwards from how tips are handled, and deliberately.
 * `ExportTimesheets` prefers its recompute over `timesheets.tip_allocation`,
 * which is harmless
 * because every input to the tip allocator is gated on the period being
 * editable — the recompute reproduces the snapshot exactly. Entitlements carry
 * NO such gate (033 argues why), so a benefit's inputs really can move under a
 * closed period, and only the snapshot can say what was paid.
 *
 * A frozen row with no derived twin SURVIVES: it is money that went out, and
 * the entitlement it came from may since have been corrected away.
 */
export function mergeFrozen(
  derived: readonly BenefitAccrual[],
  frozen: readonly { timesheet_id: string; benefit_id: string; amount: number }[],
  context: ReadonlyMap<string, AccrualContext>
): BenefitAccrual[] {
  const key = (t: string, b: string) => `${t}|${b}`;
  const out = new Map<string, BenefitAccrual>();

  for (const d of derived) out.set(key(d.timesheet_id, d.benefit_id), d);

  for (const f of frozen) {
    const k = key(f.timesheet_id, f.benefit_id);
    const twin = out.get(k);
    const ctx = context.get(f.timesheet_id);
    out.set(k, {
      timesheet_id: f.timesheet_id,
      benefit_id: f.benefit_id,
      employee_id: twin?.employee_id ?? ctx?.employee_id ?? "",
      workday: twin?.workday ?? ctx?.workday ?? "",
      amount: round2(f.amount),
      // A snapshot records the money, not the rule that produced it — and the
      // entitlement it came from may since have been corrected away, which is
      // the whole reason the snapshot outranks the recompute.
      entitlement_id: twin?.entitlement_id ?? null,
    });
  }

  return [...out.values()];
}

/* -------------------------------------------------------------------------- */
/* Rolling up                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * employee id → Gusto column → dollars.
 *
 * Two benefits pointed at the SAME column sum into it, which is what a column
 * named `reimbursement` has to do; two pointed at different columns stay apart.
 * Rounding happens once, here, rather than per accrual.
 */
export function earningsByEmployee(
  accruals: readonly BenefitAccrual[],
  benefits: readonly PayrollBenefit[]
): Map<string, Record<string, number>> {
  const columnOf = new Map(benefits.map((b) => [b.id, b.gusto_column]));
  const out = new Map<string, Record<string, number>>();

  for (const a of accruals) {
    const column = columnOf.get(a.benefit_id);
    if (!column) continue;
    const row = out.get(a.employee_id) ?? {};
    row[column] = (row[column] ?? 0) + a.amount;
    out.set(a.employee_id, row);
  }

  for (const row of out.values()) {
    for (const column of Object.keys(row)) row[column] = round2(row[column]);
  }
  return out;
}

/** Total dollars per person, across every benefit — for the worksheet. */
export function totalByEmployee(accruals: readonly BenefitAccrual[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of accruals) out.set(a.employee_id, (out.get(a.employee_id) ?? 0) + a.amount);
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

/** Total dollars, per Gusto column — for the export summary bar. */
export function totalByBenefit(accruals: readonly BenefitAccrual[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of accruals) out.set(a.benefit_id, (out.get(a.benefit_id) ?? 0) + a.amount);
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Explaining a shift                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What each benefit did with this shift, INCLUDING the ones that paid nothing.
 *
 * This is the half FileMaker's stamp could not have. A row of shifts where some
 * carry $12 and the rest carry nothing is unreadable — you cannot tell a person
 * who isn't entitled from a day the script skipped, which is exactly why nobody
 * found Casildo Herrera's fourteen missing days for two years.
 *
 * A benefit the person has no entitlement to ANYWHERE is left out entirely: the
 * note is meant to explain a benefit that nearly applied, not to list every
 * benefit the org offers against every shift.
 */
export type ShiftBenefitNote =
  | { state: "accrued"; benefit: PayrollBenefit; amount: number }
  | { state: "covered_elsewhere"; benefit: PayrollBenefit; timesheet_id: string }
  | { state: "not_entitled_here"; benefit: PayrollBenefit; locationIds: string[] }
  | { state: "not_worked"; benefit: PayrollBenefit };

export function explainShift(
  shift: BenefitShift,
  accruals: readonly BenefitAccrual[],
  benefits: readonly PayrollBenefit[],
  entitlements: readonly BenefitEntitlement[]
): ShiftBenefitNote[] {
  const notes: ShiftBenefitNote[] = [];

  for (const benefit of benefits) {
    if (!benefit.is_active) continue;

    const mine = entitlements.filter(
      (e) => e.employee_id === shift.employee_id && e.benefit_id === benefit.id
    );
    if (mine.length === 0) continue;

    const accrued = accruals.find(
      (a) => a.timesheet_id === shift.id && a.benefit_id === benefit.id
    );
    if (accrued) {
      notes.push({ state: "accrued", benefit, amount: accrued.amount });
      continue;
    }

    if (!isAccruableShift(shift)) {
      notes.push({ state: "not_worked", benefit });
      continue;
    }

    const here = entitlementOn(
      entitlements,
      shift.employee_id,
      benefit.id,
      shift.location_id as string,
      shift.workday
    );
    if (!here) {
      notes.push({
        state: "not_entitled_here",
        benefit,
        // Every shop they DO earn it at, so the sentence can name the
        // difference rather than merely deny this one.
        locationIds: [...new Set(mine.filter((e) => coversDay(e, shift.workday)).map((e) => e.location_id))],
      });
      continue;
    }

    // Entitled, worked, and still no accrual — the cap took it, so another
    // shift in the same group carries the money. The group is the unit's own:
    // a per_workday sibling must be on THIS day, or the note would point at an
    // unrelated shift a fortnight away.
    const sibling = accruals.find(
      (a) =>
        a.benefit_id === benefit.id &&
        a.employee_id === shift.employee_id &&
        (benefit.unit !== "per_workday" || a.workday === shift.workday)
    );
    notes.push({
      state: "covered_elsewhere",
      benefit,
      timesheet_id: sibling?.timesheet_id ?? "",
    });
  }

  return notes;
}
