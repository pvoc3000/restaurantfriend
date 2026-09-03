import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog, canEnterCounts } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { SchedulesList, type ScheduleRow } from "@/components/production/SchedulesList";
import type { SchedulePlan } from "@/lib/productionSchedule";
import { GenerateSchedules } from "@/components/production/GenerateSchedules";

/**
 * The committed days — production brief phase 4.
 *
 * A PLAN is what we propose to make; a SCHEDULE is what we landed on for a
 * particular date, at one shop, out of one kitchen. Decision 5: this is the
 * only record the night produces. The baker, fryer and decorator guides and the
 * element sheets are renderings of these same lines re-cut, computed at print
 * time and never stored.
 *
 * SCOPED TO THE WORKING KITCHEN (Mark, 2026-08-28), and on the KITCHEN rather
 * than the selling shop — which is what keeps decision 9 intact. A kitchen's
 * night is every schedule it makes FOR, so at DF01 this still carries the DF02
 * schedule DF01 actually bakes; what it stops carrying is a night DF01 has no
 * hand in. Scoping on the selling shop instead would have hidden exactly the
 * case the whole kitchen-on-plan design exists for.
 *
 * `production_schedules.kitchen_location_id` is NOT NULL (040), so unlike the
 * plans list this needs no fallback — every schedule already names its kitchen.
 * The Shop and Kitchen columns stay, so a row still says who it is for.
 */
export default async function SchedulesPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  // Generating a day is purchaser+; stamping a packet as printed is supervisor
  // and up (migration 044), because printing is part of the closing routine
  // rather than a catalog write.
  const editable = canWriteCatalog(session.membership.role);
  const countable = canEnterCounts(session.membership.role);
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;

  // A window rather than the whole history: a fortnight either side is the
  // question this screen answers ("what is tonight, what did we do last week"),
  // and the table grows by ~4 rows a day forever.
  const from = addDays(today, -28);
  const to = addDays(today, 28);

  // The kitchen this screen is about. Null only when the member has no active
  // location at all, which `InactiveLocationGate` already handles upstream —
  // the impossible-uuid keeps the query total rather than silently unscoped.
  const kitchen = session.activeLocation;
  const kitchenId = kitchen?.id ?? "00000000-0000-0000-0000-000000000000";

  const [{ data: schedules, error }, { data: lines, error: lineErr }, { data: planRows }] =
    await Promise.all([
    supabase
      .from("production_schedules")
      // One string literal, never a concatenation: Supabase types the result
      // from the select's literal type, and `"a" + "b"` widens to `string`,
      // which turns every field access into a GenericStringError.
      .select(
        `id, schedule_date, location_id, kitchen_location_id, source, title,
         generated_at, generated_by, printed_at, regeneration_count, note`
      )
      .gte("schedule_date", from)
      .lte("schedule_date", to)
      // In the DATABASE, not in the browser: the window is four weeks either
      // side of today and the rows carry no filter of their own, so narrowing
      // here is one less page of lines to roll up as well.
      .eq("kitchen_location_id", kitchenId)
      .order("schedule_date", { ascending: false }),
    supabase
      .from("production_schedule_items")
      .select("schedule_id, par, made, leftover")
      .limit(20000),
    // The From column names a plan schedule's PLAN. A whole-table read of a
    // handful of rows, and it has to be every plan rather than the active ones:
    // `plansInForce` decides that itself, and a schedule at a shop whose plan
    // has since been retired should still fail to match rather than silently
    // matching a different one.
    supabase
      .from("production_plans")
      .select("id, title, location_id, kitchen_location_id, is_active, starts_on, ends_on"),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load schedules: {error.message}
        {/production_schedule/.test(error.message)
          ? " — migration 040 has not been applied yet."
          : ""}
      </p>
    );
  }

  // Rolled up in JS rather than asked for per row: one query either way, and
  // the alternative is a count per schedule.
  const stats = new Map<string, { lines: number; par: number; counted: number }>();
  for (const l of lines ?? []) {
    const id = l.schedule_id as string;
    const s = stats.get(id) ?? { lines: 0, par: 0, counted: 0 };
    s.lines += 1;
    s.par += Number(l.par) || 0;
    if (l.made !== null || l.leftover !== null) s.counted += 1;
    stats.set(id, s);
  }

  // Every location, not just the active ones — a schedule at a shop that has
  // since closed should still say which shop (design rule 3).
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const plans: SchedulePlan[] = (planRows ?? []).map((p) => ({
    id: p.id as string,
    title: (p.title ?? "") as string,
    location_id: p.location_id as string,
    kitchen_location_id: (p.kitchen_location_id ?? null) as string | null,
    is_active: Boolean(p.is_active),
    starts_on: p.starts_on as string,
    ends_on: (p.ends_on ?? null) as string | null,
  }));

  const rows: ScheduleRow[] = (schedules ?? []).map((s) => {
    const stat = stats.get(s.id as string) ?? { lines: 0, par: 0, counted: 0 };
    return {
      id: s.id as string,
      schedule_date: s.schedule_date as string,
      sellsCode: codeById.get(s.location_id as string) ?? "—",
      kitchenCode: codeById.get(s.kitchen_location_id as string) ?? "—",
      source: (s.source ?? "plan") as string,
      title: (s.title ?? null) as string | null,
      // Kept on the row because `scheduleSourceLabel` matches on them, and the
      // list already holds the codes for display.
      location_id: s.location_id as string,
      kitchen_location_id: s.kitchen_location_id as string,
      generatedAt: (s.generated_at ?? null) as string | null,
      printedAt: (s.printed_at ?? null) as string | null,
      regenerations: (s.regeneration_count ?? 0) as number,
      note: (s.note ?? null) as string | null,
      lineCount: stat.lines,
      parTotal: stat.par,
      countedLines: stat.counted,
    };
  });

  return (
    <div className="space-y-6">
      {/* Under the title, `/plans`' shape and for its reason. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Schedules
          </h1>
          {/* The scope, stated rather than merely applied — the plans list's
              rule. A shorter list with no explanation reads as nights having
              gone missing. */}
          <p className="text-sm text-muted">
            Nights made at{" "}
            <span className="font-semibold text-ink">{kitchen?.code ?? "this shop"}</span>
            {" "}— including what this kitchen bakes for another shop. Switch
            shops to see another kitchen&rsquo;s.
          </p>
        </div>
      </div>

      {lineErr ? (
        // Not folded into the page's own error: a line-count failure must not
        // blank a readable list. But it isn't swallowed either — an empty Lines
        // column asserts that a night is empty, which is the one claim this
        // screen exists to make.
        <p className="text-sm text-accent">
          The line counts could not be read ({lineErr.message}), so Lines and Par
          are unreliable below.
        </p>
      ) : null}

      {/* The list renders even when empty — `/plans`' reasoning: the generate
          command lives in its control row now. */}
      {rows.length === 0 ? (
        <p className="max-w-[80ch] text-sm text-muted">
          Nothing for the {kitchen?.code ?? "this"} kitchen in the four weeks
          either side of {today}. A schedule is generated from the active plans
          for a date — one per shop per kitchen — and generating ahead is fine:
          par overrides written later are picked up whenever generation runs.
        </p>
      ) : null}

      <SchedulesList
        rows={rows}
        plans={plans}
        stampable={countable}
        today={today}
        action={
          editable && kitchen ? (
            <GenerateSchedules
              locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
              today={today}
              kitchenId={kitchen.id}
              kitchenCode={kitchen.code}
              // Every plan, not the active ones: `sellingShopsForKitchen`
              // decides that itself, and the dialog re-asks as the date range
              // moves.
              plans={plans}
            />
          ) : null
        }
      />
    </div>
  );
}

/** Plain string arithmetic — `new Date("2026-08-07")` is UTC midnight, which is
 *  the previous day west of Greenwich. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
