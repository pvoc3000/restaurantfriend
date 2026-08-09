"use client";

import { useMemo, useState } from "react";

import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { PAY_PERIOD_STATUS_LABEL, type PayPeriodStatus } from "@/lib/payPeriods";
import {
  REASON_LABEL,
  proposeOvertime,
  type OvertimeReason,
  type ShiftProposal,
  type Split,
} from "@/lib/overtime";
import { MEAL_CODE_LABEL, assessWorkday, type BreakFinding } from "@/lib/breakRules";
import { toBreakShift } from "@/lib/payrollWorksheet";
import { allocateTips, type PoolResult } from "@/lib/tipPool";
import {
  ShiftBenefits,
  ShiftPremium,
  ShiftTips,
  type PremiumRow,
  type ShiftBenefitLine,
} from "./ShiftDecisions";
import { AdjudicateOvertime } from "./AdjudicateOvertime";
import { NewTimesheet } from "./NewTimesheet";
import {
  OT_DECISION_LABEL,
  effectiveExclusion,
  formatDecimalHours,
  otDisagreements,
  workedHours,
  type OtDecision,
} from "@/lib/timesheets";

// v3: the hours columns were reordered to Worked · Regular · OT · Double ·
// Break (Mark, 2026-08-05). The key covers widths, visibility AND ORDER, and a
// stored order outranks the declared one — so without the bump anyone who
// already had this table would keep the previous arrangement and see no change.
const WIDTHS_STORAGE_KEY = "rf.timesheets.columnWidths.v3";

export type TimesheetRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_excludes_tips: boolean;
  location_code: string | null;
  /** Needed as well as the code: the tip pool and the premium are keyed by id. */
  location_id: string | null;
  workday: string;
  business_date: string;
  workweek_start: string;
  clock_in: string | null;
  clock_out: string | null;
  source_hours_regular: number | null;
  source_hours_overtime: number | null;
  source_hours_double_ot: number | null;
  source_hours_paid: number | null;
  source_break_minutes: number | null;
  hours_regular: number | null;
  hours_overtime: number | null;
  hours_double_ot: number | null;
  ot_decision: OtDecision;
  ot_reason: string | null;
  unpaid_break_minutes: number | null;
  sick_hours: number | null;
  exclude_tips: boolean | null;
  stitched: boolean;
  kind: "shift" | "adjustment";
  position: string | null;
  employee_note: string | null;
  manager_note: string | null;
  source: string;
  source_payload: Record<string, unknown> | null;
};

export type PeriodOption = {
  id: string;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
};

/**
 * Does the recompute differ from what the row currently SAYS?
 *
 * Note this compares against `hours_*` (the DECISION), not `source_hours_*`.
 * Those are two different questions and the screen asks both: the source-vs-
 * decided pair is history ("someone changed this"), while this one is the live
 * queue ("someone should look at this"). A row already adjudicated to disagree
 * with its source must not keep appearing here.
 *
 * Same one-cent tolerance as `compareToSource`, and for the same measured
 * reason — see lib/overtime's EPSILON.
 */
const REVIEW_EPSILON = 0.015;
function differsFromDecided(
  p: ShiftProposal,
  r: { hours_regular: number | null; hours_overtime: number | null; hours_double_ot: number | null }
): boolean {
  return (
    Math.abs(p.regular - (r.hours_regular ?? 0)) >= REVIEW_EPSILON ||
    Math.abs(p.overtime - (r.hours_overtime ?? 0)) >= REVIEW_EPSILON ||
    Math.abs(p.double_ot - (r.hours_double_ot ?? 0)) >= REVIEW_EPSILON
  );
}

type SortKey = "employee" | "workday" | "in" | "worked" | "regular" | "ot" | "location";
type Grouping = "none" | "employee" | "workday" | "location";
type Review = "all" | "needs_review";

/**
 * The label a grouping puts on its band, and the value it orders runs by.
 *
 * THE GROUP IS ALWAYS THE PRIMARY SORT (Mark, 2026-08-05: "grouping by workday
 * and shop should also have a black header band"). `DataTable` bands a run of
 * like-labelled rows, so it can only band what the order already groups —
 * before this, picking Day while the sort was still Employee produced no band
 * at all and grouping looked broken.
 *
 * Making the group the primary sort and the chosen column the sort WITHIN each
 * run is what a grouped report actually is, and it means every grouping bands,
 * always. `DataGroup.sortKey` is deliberately not passed for the same reason.
 */
const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: TimesheetRow) => string> = {
  employee: (r) => r.employee_name,
  workday: (r) => r.workday,
  location: (r) => r.location_code ?? "No shop",
};

/**
 * A fortnight of shifts.
 *
 * Scoped to ONE pay period and never to "everything": there are 44,721 rows in
 * this table and the question is always about a particular fortnight. The
 * picker is the screen's primary control, which is why it leads the filter row.
 *
 * NO `/timesheets/[id]` ROUTE, deliberately. A shift is a row, not a record,
 * and a second screen would be a second place to edit a timesheet — the
 * receiving-screen mistake in reverse. What a detail screen would have shown
 * lives in the row's expansion instead.
 */
export function TimesheetsList({
  rows,
  period,
  canWrite,
  timeZone,
  waiverEmployeeIds,
  employees,
  locations,
  orgId,
  premiums,
  pools,
  benefitNotes,
}: {
  rows: TimesheetRow[];
  /** The fortnight these rows are from, chosen on the bar above. */
  period: PeriodOption | null;
  canWrite: boolean;
  /** The org's zone. Punches are instants; reading one back needs a zone, and
   *  the SERVER's is not it — a host in UTC would show every shift shifted. */
  timeZone: string;
  /** Who has a signed meal-break waiver on file. It changes the ANSWER, not the
   *  presentation: a waived meal on a six-hour day owes nothing at all. */
  waiverEmployeeIds: string[];
  /** The roster, for adding a shift by hand. */
  employees: { id: string; name: string }[];
  locations: { id: string; code: string }[];
  orgId: string;
  /** Premium decisions already on file, keyed `employee|workday|kind`. */
  premiums: Record<string, PremiumRow>;
  /** Each shop-day's reported and corrected figure, keyed `location|date`. */
  pools: Record<string, { reported_cents: number | null; corrected_cents: number | null }>;
  /** Timesheet id → one line per benefit, already worded by the server. */
  benefitNotes: Record<string, ShiftBenefitLine[]>;
}) {
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("employee");
  const [review, setReview] = useState<Review>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "employee",
    dir: "asc",
  });

  // The picker that chose it lives on `PeriodBar` above this list (Mark,
  // 2026-08-06) — these filters act on the shifts, that bar acts on the period.
  // What's still needed here is which period it IS, for the read-only rule and
  // for the shift a `NewTimesheet` would land in.

  /**
   * THE rule (decision 8), and it must agree with `isPayPeriodEditable` and
   * with 028's write policies. Below it, every cell renders as plain text
   * rather than offering a write the database will silently refuse — an update
   * against a closed period matches zero rows and PostgREST returns NO error,
   * so an offered-but-dead edit would look like it worked.
   */
  const editable =
    canWrite && period !== null && (period.status === "open" || period.status === "review");

  /**
   * The recompute, over the WHOLE fortnight — never over the filtered set.
   * Overtime is a property of an employee's workweek, so hiding half a week
   * behind a search box would change the answer for the half still showing.
   * Measured at 63ms for all 44,721 rows, so a fortnight is free.
   */
  const proposals = useMemo(
    () =>
      proposeOvertime(
        rows
          .map((r) => {
            const hours = workedHours(r);
            return hours === null
              ? null
              : {
                  id: r.id,
                  employee_id: r.employee_id,
                  workday: r.workday,
                  workweek_start: r.workweek_start,
                  hours,
                  // Which shift carries the day's overtime depends on this.
                  // See `ShiftHours.starts_at`.
                  starts_at: r.clock_in,
                };
          })
          // An unfinished shift has no hours to classify. Feeding it 0 would
          // quietly tell the seventh-day rule that a day was worked.
          .filter((x): x is NonNullable<typeof x> => x !== null)
      ),
    [rows]
  );

  /** Where the recompute differs from what the row currently SAYS. */
  const needsReview = useMemo(() => {
    const out = new Set<string>();
    for (const r of rows) {
      const p = proposals.get(r.id);
      if (!p) continue;
      if (differsFromDecided(p, r)) out.add(r.id);
    }
    return out;
  }, [rows, proposals]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = review === "needs_review" ? rows.filter((r) => needsReview.has(r.id)) : rows;
    if (!q) return base;
    return base.filter((r) =>
      `${r.employee_name} ${r.workday} ${r.location_code ?? ""} ${r.position ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search, review, needsReview]);

  const sorted = useMemo(() => {
    const value = (r: TimesheetRow): string | number => {
      switch (sort.key) {
        case "employee": return r.employee_name;
        case "workday": return r.workday;
        case "in": return r.clock_in ?? "";
        case "worked": return workedHours(r) ?? -1;
        case "regular": return r.hours_regular ?? -1;
        case "ot": return r.hours_overtime ?? -1;
        case "location": return r.location_code ?? "";
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    const groupOf = grouping === "none" ? null : GROUP_LABEL[grouping];
    return [...shown].sort((a, b) => {
      // The group leads, ALWAYS ascending — the runs are a table of contents,
      // not the thing you sorted, and flipping a column shouldn't reverse the
      // employee list. Inside a run the chosen column decides.
      if (groupOf) {
        const ag = groupOf(a), bg = groupOf(b);
        if (ag !== bg) return ag < bg ? -1 : 1;
      }
      const av = value(a), bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Tiebreaks always read ascending whichever way the primary points —
      // lib/tableSort's rule. Within one person, chronological.
      if (a.workday !== b.workday) return a.workday < b.workday ? -1 : 1;
      return (a.clock_in ?? "") < (b.clock_in ?? "") ? -1 : 1;
    });
  }, [shown, sort, grouping]);

  /**
   * The meal-break findings, derived here exactly as the worksheet derives them.
   *
   * Surfaced on THIS screen because it is where you are looking when you ask
   * whether a break was missed (Mark, 2026-08-05: "missed break not flagged by
   * app"). It was only ever on the pay-period worksheet's Breaks tab, which is
   * where the DECISION still gets recorded — this is a flag, not a second place
   * to decide, the same split receiving and PO detail already keep.
   *
   * Assessed per (employee, workday) because that is the grain the California
   * one-per-day cap works at, then marked on every shift of that day.
   */
  const breakFindings = useMemo(() => {
    const days = new Map<string, TimesheetRow[]>();
    for (const r of rows) {
      const key = `${r.employee_id}|${r.workday}`;
      const list = days.get(key);
      if (list) list.push(r);
      else days.set(key, [r]);
    }
    const out = new Map<string, BreakFinding>();
    for (const [key, dayRows] of days) {
      const [employee_id] = key.split("|");
      const found = assessWorkday(dayRows.map(toBreakShift), {
        hasMealWaiver: waiverEmployeeIds.includes(employee_id),
      });
      if (found.length === 0) continue;
      for (const r of dayRows) out.set(r.id, found[0]);
    }
    return out;
  }, [rows, waiverEmployeeIds]);

  const totals = useMemo(() => {
    let regular = 0, ot = 0, dot = 0, sick = 0, worked = 0, unfinished = 0, disagreeing = 0;
    for (const r of sorted) {
      regular += r.hours_regular ?? 0;
      ot += r.hours_overtime ?? 0;
      dot += r.hours_double_ot ?? 0;
      sick += r.sick_hours ?? 0;
      const w = workedHours(r);
      if (w === null) unfinished += 1;
      else worked += w;
      if (otDisagreements(r).length) disagreeing += 1;
    }
    return { regular, ot, dot, sick, worked, unfinished, disagreeing };
  }, [sorted]);

  /**
   * How many shifts each employee-workday holds — the premium control says so,
   * because one hour per workday is the statutory cap and a control that looks
   * per-shift would otherwise read as one premium per shift.
   */
  const shiftsPerWorkday = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.employee_id}|${r.workday}`;
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    return n;
  }, [rows]);

  /**
   * Each shop-day's pool, divided.
   *
   * Computed over the WHOLE period rather than the filtered set, for the same
   * reason the overtime recompute is: the rate is pooled dollars ÷ everyone's
   * tip hours, so hiding half a shop-day behind a search box would change the
   * share shown for the half still on screen.
   */
  const dayPools = useMemo(() => {
    const days = new Map<string, TimesheetRow[]>();
    for (const r of rows) {
      if (!r.location_id) continue;
      const k = `${r.location_id}|${r.business_date}`;
      const list = days.get(k);
      if (list) list.push(r);
      else days.set(k, [r]);
    }
    const out = new Map<string, { result: PoolResult | null; reported: number | null; corrected: number | null }>();
    for (const [k, dayRows] of days) {
      const pool = pools[k];
      const effective = pool ? (pool.corrected_cents ?? pool.reported_cents) : null;
      out.set(k, {
        reported: pool?.reported_cents ?? null,
        corrected: pool?.corrected_cents ?? null,
        result:
          effective === null
            ? null
            : allocateTips(
                effective,
                dayRows.map((r) => ({
                  id: r.id,
                  // Tip hours are hours WORKED. Sick hours are a separate
                  // column and never enter this sum.
                  hours: workedHours(r) ?? 0,
                  excludeShift: r.exclude_tips,
                  excludePerson: r.employee_excludes_tips,
                }))
              ),
      });
    }
    return out;
  }, [rows, pools]);

  /** Distinct (employee, workday) pairs owing a meal finding, among what's shown. */
  const mealDays = useMemo(() => {
    const days = new Set<string>();
    for (const r of sorted) {
      if (breakFindings.has(r.id)) days.add(`${r.employee_id}|${r.workday}`);
    }
    return days.size;
  }, [sorted, breakFindings]);

  /**
   * The run's hours, on a closing row beneath it (Mark, 2026-08-05: "subtotals
   * should be trailing the data… and the values should align with their
   * columns"). Keyed by column, so each figure lands under the column it sums
   * and stays there when a column is hidden or dragged.
   *
   * No `sortKey`: the group is already the primary sort, so every grouping bands
   * whatever column you then sort within it by.
   */
  const group: DataGroup<TimesheetRow> | undefined =
    grouping === "none"
      ? undefined
      : {
          label: GROUP_LABEL[grouping],
          summary: (run) => {
            let regular = 0, ot = 0, dot = 0, worked = 0, brk = 0, sick = 0;
            for (const r of run) {
              regular += r.hours_regular ?? 0;
              ot += r.hours_overtime ?? 0;
              dot += r.hours_double_ot ?? 0;
              worked += workedHours(r) ?? 0;
              brk += (r.unpaid_break_minutes ?? 0) / 60;
              sick += r.sick_hours ?? 0;
            }
            const n = (v: number) => v.toFixed(2);
            return {
              // The leftmost cell says what is being totalled. Without it the
              // row is six numbers with no subject.
              employee: <span className="text-muted">{run.length === 1 ? "1 shift" : `${run.length} shifts`}</span>,
              worked: n(worked),
              regular: n(regular),
              ot: n(ot),
              dot: n(dot),
              break: n(brk),
              // Only when there is any — a column of 0.00 down every group
              // reads as a figure someone should check.
              ...(sick > 0 ? { sick: n(sick) } : {}),
            };
          },
        };

  /**
   * Our recomputed figure for one field, but ONLY where it disagrees with the
   * row and only past the same epsilon the review queue uses. A `≠` on every
   * cent of rounding drift would be 9.9% of rows — see `lib/overtime`'s EPSILON,
   * which is a measurement rather than a taste.
   */
  function proposedFor(r: TimesheetRow, field: keyof Split): number | null {
    if (!needsReview.has(r.id)) return null;
    const p = proposals.get(r.id);
    if (!p) return null;
    const stored =
      field === "regular" ? r.hours_regular : field === "overtime" ? r.hours_overtime : r.hours_double_ot;
    return Math.abs(p[field] - (stored ?? 0)) >= REVIEW_EPSILON ? p[field] : null;
  }

  /** `10:07pm` from an instant, read back in the org's zone. */
  const clock = (iso: string | null) =>
    iso === null
      ? "—"
      : new Date(iso).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        });

  const columns: DataColumn<TimesheetRow>[] = [
    {
      key: "employee",
      label: "Employee",
      width: 196,
      pinned: true,
      sortValue: (r) => r.employee_name,
      render: (r) => (
        <span className="flex items-center gap-2">
          <span>{r.employee_name}</span>
          {r.kind === "adjustment" && (
            <span className="border border-ink bg-mark-fill px-1 text-[10px] uppercase tracking-[0.06em]">
              adj
            </span>
          )}
        </span>
      ),
    },
    {
      key: "workday",
      label: "Workday",
      width: 126,
      sortValue: (r) => r.workday,
      render: (r) => <span className="tabular-nums">{r.workday}</span>,
    },
    {
      key: "location",
      label: "Shop",
      width: 78,
      hideWhenCompact: true,
      sortValue: (r) => r.location_code ?? "",
      render: (r) => <span className="text-muted">{r.location_code ?? "—"}</span>,
    },
    {
      // The role worked, which on a Homebase import is its `Role` column with
      // FileMaker's numbering stripped ("01 Overnight Baker" → "Overnight
      // Baker"). It lived only in the row's expansion until Mark asked for it
      // beside Shop (2026-08-05) — two shifts on one day at one shop are told
      // apart by what the person was doing.
      key: "position",
      label: "Shift",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.position ?? "",
      render: (r) =>
        r.position ? <span>{r.position}</span> : <span className="text-faint">—</span>,
    },
    {
      key: "in",
      label: "In → Out",
      width: 168,
      sortValue: (r) => r.clock_in ?? "",
      render: (r) => (
        <span className="tabular-nums">
          {clock(r.clock_in)} <span className="text-faint">→</span>{" "}
          {r.clock_out ? (
            clock(r.clock_out)
          ) : (
            // An unfinished shift is a real state (184 in the history), and the
            // honest rendering is a gap you can see rather than a zero.
            <span className="bg-mark-fill px-1">no clock-out</span>
          )}
        </span>
      ),
    },
    // WORKED · REGULAR · OT · DOUBLE · BREAK (Mark, 2026-08-05, revising the
    // order he gave earlier the same day). The total leads and the three
    // figures that make it up follow, so the eye reads the answer and then its
    // parts; Break, which is what was deducted to reach Worked rather than a
    // part of it, sits last.
    {
      key: "worked",
      label: "Worked",
      width: 112,
      sortValue: (r) => workedHours(r) ?? -1,
      // DECIMAL, not a 5:13 clock reading, even though a clock reads more
      // naturally for a shift. Regular + OT + Double must visibly SUM to this,
      // and "5:13" beside "5.22" reads as two different numbers when it is one.
      render: (r) => (
        <span className="tabular-nums">{formatDecimalHours(workedHours(r))}</span>
      ),
    },
    {
      key: "regular",
      label: "Regular",
      width: 112,
      sortValue: (r) => r.hours_regular ?? -1,
      render: (r) => (
        <HoursCell
          row={r}
          column="hours_regular"
          value={r.hours_regular}
          editable={editable}
          proposed={proposedFor(r, "regular")}
        />
      ),
    },
    {
      key: "ot",
      label: "OT",
      width: 84,
      sortValue: (r) => r.hours_overtime ?? -1,
      render: (r) => (
        <HoursCell
          row={r}
          column="hours_overtime"
          value={r.hours_overtime}
          editable={editable}
          proposed={proposedFor(r, "overtime")}
          day={proposals.get(r.id) ?? null}
          // Why there is overtime at all. `proposeOvertime` already names its
          // reasons — they were only ever shown after you opened a row AND the
          // recompute disagreed, which is the rarest case rather than the
          // ordinary one (Mark, 2026-08-05: "can tool tips over overtime field
          // explain why there's overtime?").
          reasons={proposals.get(r.id)?.reasons ?? []}
        />
      ),
    },
    {
      key: "dot",
      label: "Double",
      width: 98,
      hideWhenCompact: true,
      sortValue: (r) => r.hours_double_ot ?? -1,
      render: (r) => (
        <HoursCell
          row={r}
          column="hours_double_ot"
          value={r.hours_double_ot}
          editable={editable}
          proposed={proposedFor(r, "double_ot")}
          day={proposals.get(r.id) ?? null}
          reasons={proposals.get(r.id)?.reasons ?? []}
        />
      ),
    },
    {
      key: "break",
      label: "Break",
      width: 124,
      sortValue: (r) => r.unpaid_break_minutes ?? -1,
      render: (r) => <BreakCell row={r} editable={editable} finding={breakFindings.get(r.id) ?? null} />,
    },
    {
      key: "sick",
      label: "Sick",
      width: 82,
      hideWhenCompact: true,
      sortValue: (r) => r.sick_hours ?? -1,
      render: (r) => <HoursCell row={r} column="sick_hours" value={r.sick_hours} editable={editable} />,
    },
    {
      key: "tips",
      label: "Tips",
      width: 100,
      hideWhenCompact: true,
      sortValue: (r) => String(r.exclude_tips),
      render: (r) => <TipsCell row={r} editable={editable} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <TextInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search this pay period"
          aria-label="Search timesheets"
          clearLabel="Clear the search"
          className="w-64"
        />

        <div className="space-y-1.5">
          <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
            Overtime
          </span>
          <TabPicker
            ariaLabel="Overtime review"
            value={review}
            onChange={setReview}
            options={[
              { key: "all", label: "All", count: rows.length },
              // Always shown, count and all — "Needs review 0" is the answer you
              // came for, where an absent tab only says the screen forgot to
              // offer it. The PO list's roll-up convention.
              { key: "needs_review", label: "Needs review", count: needsReview.size },
            ]}
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">
            Group by
          </span>
          <TabPicker
            ariaLabel="Group by"
            value={grouping}
            onChange={setGrouping}
            options={[
              { key: "employee", label: "Employee" },
              { key: "workday", label: "Day" },
              { key: "location", label: "Shop" },
              { key: "none", label: "None" },
            ]}
          />
        </div>

        {/* Right-aligned in the filter row — the NewEmployee template, which is
            how every create in this app is reached. ALWAYS RENDERED, disabled
            when the period is closed rather than hidden (Mark, 2026-08-05): a
            control that vanishes can't be told from a feature that doesn't
            exist, and the filter row shouldn't change width as you page between
            periods. The reason is already in words directly below. */}
        <div className="ml-auto">
          <NewTimesheet
            employees={employees}
            locations={locations}
            orgId={orgId}
            timeZone={timeZone}
            period={period}
            disabled={!editable}
          />
        </div>
      </div>

      {/* The pay period in one line. Overtime is stated separately from regular
          because it is the number this module exists to get right. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-hairline py-2 text-sm">
        <span className="text-muted">
          {sorted.length === rows.length ? `${rows.length} shifts` : `${sorted.length} of ${rows.length} shifts`}
        </span>
        <span>Regular <strong className="tabular-nums">{totals.regular.toFixed(2)}</strong></span>
        <span>OT <strong className="tabular-nums">{totals.ot.toFixed(2)}</strong></span>
        <span>Double <strong className="tabular-nums">{totals.dot.toFixed(2)}</strong></span>
        {totals.sick > 0 && (
          <span className="text-muted">
            Sick <strong className="tabular-nums">{totals.sick.toFixed(2)}</strong>
            {/* Decision 7: recorded and reconciled, never exported — Gusto
                already pays it, and including it pays the person twice. */}
            <span className="ml-1 text-[12px]">(reconciliation only, not exported)</span>
          </span>
        )}
        {totals.unfinished > 0 && (
          <span className="bg-mark-fill px-2 text-ink">{totals.unfinished} with no clock-out</span>
        )}
        {totals.disagreeing > 0 && (
          <span className="bg-mark-fill px-2 text-ink">
            {totals.disagreeing} differ from what the source said
          </span>
        )}
        {/* Counted over the SHOWN rows, like everything else on this line, and
            counted per DAY rather than per shift — the premium is capped at one
            a day, so counting shifts would overstate what is owed. */}
        {mealDays > 0 && (
          <span className="bg-mark-fill px-2 text-ink">
            {mealDays} meal-break {mealDays === 1 ? "finding" : "findings"}
          </span>
        )}
      </div>

      {!editable && period && (
        <p className="text-sm text-muted">
          This period is {PAY_PERIOD_STATUS_LABEL[period.status].toLowerCase()}, so these shifts are
          read-only. {period.status === "closed"
            ? "A correction becomes an adjustment in the current open period."
            : "Reopen the period to edit them."}
        </p>
      )}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        compactBelow={1280}
        group={group}
        sort={sort}
        onSortChange={(next) => setSort({ key: next.key as SortKey, dir: next.dir })}
        expand={{
          summary: (r) => {
            const marks: string[] = [];
            const d = otDisagreements(r);
            if (d.length) marks.push(`${d.length} differ${d.length === 1 ? "s" : ""} from source`);
            if (r.stitched) marks.push("stitched");
            if (needsReview.has(r.id)) marks.push("overtime differs from ours");
            const meal = breakFindings.get(r.id);
            if (meal) marks.push(MEAL_CODE_LABEL[meal.code].toLowerCase());
            if (r.source_payload?.local_time_ambiguity) marks.push("ambiguous clock time");
            if (r.employee_note || r.manager_note) marks.push("note");
            return marks.length ? <span className="text-mark">{marks.join(" · ")}</span> : null;
          },
          render: (r) => (
            <ShiftDetail
              row={r}
              editable={editable}
              proposal={needsReview.has(r.id) ? (proposals.get(r.id) ?? null) : null}
              finding={breakFindings.get(r.id) ?? null}
              dayShifts={shiftsPerWorkday.get(`${r.employee_id}|${r.workday}`) ?? 1}
              premium={premiums[`${r.employee_id}|${r.workday}|meal`] ?? null}
              pool={r.location_id ? (dayPools.get(`${r.location_id}|${r.business_date}`) ?? null) : null}
              orgId={orgId}
              benefitLines={benefitNotes[r.id] ?? []}
            />
          ),
        }}
        empty={
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "No shifts in this pay period."
              : "No shifts match that search."}
          </p>
        }
      />
    </div>
  );
}

/**
 * One of the decided-hours cells, carrying up to three things.
 *
 * The cell answers three different questions and they must not be conflated:
 *
 *   1. Does this differ from what the SOURCE said? Yellow fill — history, and
 *      the thing decision 2 exists to keep visible.
 *   2. Does OUR recompute disagree with what the row says? A `≠` chip naming
 *      both figures. This is the one that was invisible in the grid until
 *      2026-08-05: it lived behind the Needs-review tab and the row expansion,
 *      so a fortnight looked settled while the app privately disagreed with
 *      fifteen rows of it (Mark: "should be obvious when app recommends
 *      something different for a particular time sheet. Need a way to flag").
 *   3. WHY there is overtime at all — the reasons `proposeOvertime` already
 *      names, on the cells that carry the hours they explain.
 *
 * All of it is YELLOW and none of it is red. A disagreement is not an error; it
 * is work for a human, which is the distinction the receiving screen's markers
 * already draw.
 */
function HoursCell({
  row,
  column,
  value,
  editable,
  reasons = [],
  proposed = null,
  day = null,
}: {
  row: TimesheetRow;
  column: "hours_regular" | "hours_overtime" | "hours_double_ot" | "sick_hours";
  value: number | null;
  editable: boolean;
  reasons?: OvertimeReason[];
  /** Our recomputed figure for THIS field, when it disagrees with the row. */
  proposed?: number | null;
  /** The workday this shift sits in — what every daily reason is about. */
  day?: { day_hours: number; day_shifts: number } | null;
}) {
  const differs =
    column !== "sick_hours" &&
    otDisagreements(row).some(
      (d) =>
        (d.field === "regular" && column === "hours_regular") ||
        (d.field === "overtime" && column === "hours_overtime") ||
        (d.field === "double_ot" && column === "hours_double_ot")
    );

  const body = editable ? (
    // TWO DECIMALS, so a column of figures reads as one. `InlineValue` shows
    // the raw stored value at rest, which put "0" beside "4.53" down the OT
    // column while the read-only branch below already said "0.00". `format` is
    // display-only — clicking the cell still hands you the raw number to edit,
    // which is what you want in a box you type arithmetic into.
    <InlineValue
      table="timesheets"
      id={row.id}
      column={column}
      kind="number"
      value={value}
      format={(v) => Number(v).toFixed(2)}
    />
  ) : (
    <span className={`${READ_ONLY_VALUE} tabular-nums`}>
      {value === null ? "—" : value.toFixed(2)}
    </span>
  );

  // Only on a cell that actually carries overtime — "over 8 hours in the day"
  // hovering over a regular-hours cell explains nothing about that cell.
  //
  // It NAMES THE DAY'S OWN TOTAL, because overtime belongs to the workday and
  // not to the shift carrying it: a five-hour shift can correctly be told "over
  // 8 hours in the day" when it is the one that ran past the eighth hour, and
  // read on a single row that looks like the app contradicting itself. Saying
  // "16.70h across 2 shifts" is what lets the sentence be checked.
  const why =
    reasons.length > 0 && column !== "hours_regular" && column !== "sick_hours" && (value ?? 0) > 0
      ? `Overtime because: ${reasons.map((r) => REASON_LABEL[r]).join("; ")}.` +
        (day && day.day_shifts > 1
          ? ` That day totals ${day.day_hours.toFixed(2)}h across ${day.day_shifts} shifts.`
          : day
            ? ` That day totals ${day.day_hours.toFixed(2)}h.`
            : "")
      : null;

  return (
    <span className={`flex items-center gap-1 ${differs ? "bg-mark-fill px-1" : ""}`}>
      <span className={why ? "underline decoration-mark decoration-dotted underline-offset-4" : ""} title={why ?? undefined}>
        {body}
      </span>
      {proposed !== null && (
        <span
          className="shrink-0 cursor-help bg-mark-fill px-1 text-[11px] tabular-nums"
          title={`This says ${(value ?? 0).toFixed(2)}; recomputing from the punches gives ${proposed.toFixed(2)}.${
            reasons.length ? ` ${reasons.map((r) => REASON_LABEL[r]).join("; ")}.` : ""
          } Open the row to adopt or keep it.`}
        >
          ≠ {proposed.toFixed(2)}
        </span>
      )}
    </span>
  );
}

/**
 * The unpaid meal, IN HOURS (Mark, 2026-08-05: "break times should be in
 * fractions of an hour instead of minutes to fit with hours worked").
 *
 * The column is `unpaid_break_minutes` and stays minutes — it is what both
 * sources send and what 028 declares. `InlineValue`'s `scale` converts at both
 * ends, so the cell reads 0.50 and accepts 0.50 while the database keeps 30.
 *
 * It also carries the meal-break FINDING, which is why this is a cell of its own
 * rather than another `HoursCell`: the break column is where you look when you
 * ask whether a break was missed, and until now the answer lived on another
 * screen entirely.
 */
function BreakCell({
  row,
  editable,
  finding,
}: {
  row: TimesheetRow;
  editable: boolean;
  finding: BreakFinding | null;
}) {
  const hours = row.unpaid_break_minutes === null ? null : row.unpaid_break_minutes / 60;

  return (
    <span className="flex items-center gap-1">
      {editable ? (
        <InlineValue
          table="timesheets"
          id={row.id}
          column="unpaid_break_minutes"
          kind="number"
          value={row.unpaid_break_minutes}
          scale={{ toShown: (m) => Math.round((m / 60) * 100) / 100, toStored: (h) => Math.round(h * 60) }}
          format={(v) => Number(v).toFixed(2)}
        />
      ) : (
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>
          {hours === null ? "—" : hours.toFixed(2)}
        </span>
      )}
      {finding && (
        <span
          className="shrink-0 cursor-help bg-mark-fill px-1 text-[11px]"
          title={`${MEAL_CODE_LABEL[finding.code]}. ${finding.detail}${
            finding.waivable ? " A signed meal-break waiver would cover this day." : ""
          } Record the decision on the pay period's worksheet.`}
        >
          meal
        </span>
      )}
    </span>
  );
}

/**
 * The tri-state (decision 4). A PickList with three options, never a checkbox —
 * a checkbox cannot say the third thing, and the third thing ("included despite
 * the default") is the whole reason the column is nullable.
 */
function TipsCell({ row, editable }: { row: TimesheetRow; editable: boolean }) {
  const effective = effectiveExclusion(row.exclude_tips, row.employee_excludes_tips);
  const label =
    row.exclude_tips === null
      ? effective
        ? "Excluded (person)"
        : "In pool"
      : row.exclude_tips
        ? "Excluded"
        : "In pool (override)";

  if (!editable) return <span className={`${READ_ONLY_VALUE} text-muted`}>{label}</span>;

  return (
    <InlineValue
      table="timesheets"
      id={row.id}
      column="exclude_tips"
      kind="pick"
      value={row.exclude_tips === null ? "" : String(row.exclude_tips)}
      options={[
        { value: "", label: row.employee_excludes_tips ? "Inherit — excluded" : "Inherit — in pool" },
        { value: "true", label: "Excluded from this shift" },
        { value: "false", label: "In the pool despite the default" },
      ]}
    />
  );
}

/**
 * What a `/timesheets/[id]` route would have shown: the raw source row, the
 * stitch provenance, and the OT disagreement in full.
 */
function ShiftDetail({
  row,
  editable,
  proposal,
  finding,
  dayShifts,
  premium,
  pool,
  orgId,
  benefitLines,
}: {
  row: TimesheetRow;
  editable: boolean;
  /** Non-null only when the recompute disagrees with the stored decision. */
  proposal: ShiftProposal | null;
  /** The day's meal finding, if it owes one. Derived, never stored. */
  finding: BreakFinding | null;
  /** Shifts on this employee-workday — what the premium covers. */
  dayShifts: number;
  /** The decision already on file for this workday's meal, if any. */
  premium: PremiumRow | null;
  /** This shop-day's pool and its division. */
  pool: { result: PoolResult | null; reported: number | null; corrected: number | null } | null;
  orgId: string;
  /** What each benefit did with this shift, INCLUDING the ones that paid
   *  nothing. Computed on the server — see `payrollBenefits.explainShift`. */
  benefitLines: ShiftBenefitLine[];
}) {
  const disagreements = otDisagreements(row);
  const payload = row.source_payload ?? {};
  const raw = (k: string) => {
    const v = payload[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <div className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">What the source said</h3>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-subtle">Source</dt>
          <dd>{raw("import_source") ?? row.source}</dd>
          <dt className="text-subtle">Clock in</dt>
          <dd className="tabular-nums">{raw("time_in") ?? "—"}</dd>
          <dt className="text-subtle">Clock out</dt>
          <dd className="tabular-nums">{raw("time_out") ?? "—"}</dd>
          <dt className="text-subtle">Dates</dt>
          <dd className="tabular-nums">
            {raw("date_start") ?? "—"}
            {raw("date_end") && raw("date_end") !== raw("date_start") ? ` → ${raw("date_end")}` : ""}
          </dd>
          {raw("break_start") && (
            <>
              <dt className="text-subtle">Break</dt>
              <dd className="tabular-nums">
                {raw("break_start")} → {raw("break_end") ?? "?"}
                {raw("break_type") ? ` · ${raw("break_type")}` : ""}
              </dd>
            </>
          )}
          <dt className="text-subtle">Hours</dt>
          <dd className="tabular-nums">
            {(row.source_hours_regular ?? 0).toFixed(2)} reg ·{" "}
            {(row.source_hours_overtime ?? 0).toFixed(2)} OT ·{" "}
            {(row.source_hours_double_ot ?? 0).toFixed(2)} dbl
          </dd>
          {raw("timesheet_error") && (
            <>
              <dt className="text-subtle">FMP flagged</dt>
              {/* FileMaker's own derived break-violation calc, carried along
                  unaltered. Decision 3 says a violation is DERIVED and never
                  stored, so this is not a column — it is the reference that
                  phase 5's breakRules.ts gets checked against. */}
              <dd className="text-mark">{raw("timesheet_error")}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">What we decided</h3>
        {disagreements.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing differs from the source. {OT_DECISION_LABEL[row.ot_decision]}.
          </p>
        ) : (
          <div className="space-y-2">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-sm">
              {disagreements.map((d) => (
                <div key={d.field} className="contents">
                  <dt className="text-subtle">{d.label}</dt>
                  <dd className="tabular-nums">
                    <span className="text-muted">{d.source.toFixed(2)}</span>
                    <span className="mx-1 text-faint">→</span>
                    <span className="bg-mark-fill px-1">{d.decided.toFixed(2)}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">{OT_DECISION_LABEL[row.ot_decision]}.</p>
          </div>
        )}
        {row.ot_reason && <p className="text-sm">{row.ot_reason}</p>}
        {proposal && (
          <AdjudicateOvertime
            timesheetId={row.id}
            decided={{
              regular: row.hours_regular ?? 0,
              overtime: row.hours_overtime ?? 0,
              double_ot: row.hours_double_ot ?? 0,
            } as Split}
            proposal={proposal}
            editable={editable}
            currentDecision={OT_DECISION_LABEL[row.ot_decision].toLowerCase()}
          />
        )}
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-subtle">Workweek</dt>
          <dd className="tabular-nums">{row.workweek_start}</dd>
          <dt className="text-subtle">Tip pool day</dt>
          <dd className="tabular-nums">{row.business_date}</dd>
          {row.position && (
            <>
              <dt className="text-subtle">Position</dt>
              <dd>{row.position}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">Notes</h3>
        {/* The finding used to be restated here, with a line sending you to the
            pay-period worksheet to decide it. Both are gone: the Meal premium
            block below states it AND decides it, and saying the same thing
            twice in one expansion is how a reader learns to skim one of them. */}
        {row.stitched && (
          <p className="text-sm text-mark">
            Reassembled from segments a source split at midnight.
          </p>
        )}
        {typeof payload.local_time_ambiguity === "string" && (
          <p className="text-sm text-mark">
            This punch&rsquo;s local time is {String(payload.local_time_ambiguity)} — the clock
            {payload.local_time_ambiguity === "ambiguous"
              ? " read the same hour twice that night, so the shift is an hour longer or shorter depending which is meant."
              : " skipped that hour entirely, so the punch was moved forward."}
          </p>
        )}
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-subtle">Employee</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="timesheets"
                id={row.id}
                column="employee_note"
                value={row.employee_note}
                placeholder="—"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{row.employee_note ?? "—"}</span>
            )}
          </dd>
          <dt className="text-subtle">Manager</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="timesheets"
                id={row.id}
                column="manager_note"
                value={row.manager_note}
                placeholder="—"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{row.manager_note ?? "—"}</span>
            )}
          </dd>
        </dl>
      </div>

      {/* THE TWO DECISIONS THAT USED TO LIVE ON THE PAY-PERIOD WORKSHEET.
          They are here because this is where the evidence is (Mark,
          2026-08-05): the punches, the recorded meal and the day's hours are
          all above them, where on the worksheet a finding was a name, a date
          and a sentence you had to leave the screen to check.

          Five children in a three-column grid flow onto a second row by
          themselves — there is no second layout to keep in step. */}
      <ShiftPremium
        employeeId={row.employee_id}
        locationId={row.location_id}
        workday={row.workday}
        dayShifts={dayShifts}
        finding={finding}
        existing={premium}
        editable={editable}
        orgId={orgId}
      />

      <ShiftTips
        locationId={row.location_id}
        locationCode={row.location_code}
        businessDate={row.business_date}
        reportedCents={pool?.reported ?? null}
        correctedCents={pool?.corrected ?? null}
        result={pool?.result ?? null}
        tipHours={pool?.result?.allocations.find((a) => a.id === row.id)?.tipHours ?? 0}
        allocationCents={pool?.result?.allocations.find((a) => a.id === row.id)?.cents ?? null}
        excluded={effectiveExclusion(row.exclude_tips, row.employee_excludes_tips)}
        editable={editable}
      />

      {/* Read-only, and last: the two above are decisions to make, this is an
          answer to read. */}
      <ShiftBenefits lines={benefitLines} locationCode={row.location_code} />
    </div>
  );
}
