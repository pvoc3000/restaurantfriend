import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { SchedulesList, type ScheduleRow } from "@/components/production/SchedulesList";
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
 * Deliberately NOT location-scoped to the working shop. A kitchen's night is
 * every schedule it makes FOR — DF01 fills its own case and DF02's raised
 * donuts — so scoping to one shop would hide half of what DF01 is making. The
 * list filters by shop and by kitchen instead, and defaults to neither.
 */
export default async function SchedulesPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;

  // A window rather than the whole history: a fortnight either side is the
  // question this screen answers ("what is tonight, what did we do last week"),
  // and the table grows by ~4 rows a day forever.
  const from = addDays(today, -28);
  const to = addDays(today, 28);

  const [{ data: schedules, error }, { data: lines, error: lineErr }] = await Promise.all([
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
      .order("schedule_date", { ascending: false }),
    supabase
      .from("production_schedule_items")
      .select("schedule_id, par, made, leftover")
      .limit(20000),
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

  const rows: ScheduleRow[] = (schedules ?? []).map((s) => {
    const stat = stats.get(s.id as string) ?? { lines: 0, par: 0, counted: 0 };
    return {
      id: s.id as string,
      schedule_date: s.schedule_date as string,
      sellsCode: codeById.get(s.location_id as string) ?? "—",
      kitchenCode: codeById.get(s.kitchen_location_id as string) ?? "—",
      source: (s.source ?? "plan") as string,
      title: (s.title ?? null) as string | null,
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Schedules
        </h1>
        {editable ? (
          <GenerateSchedules
            locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
            today={today}
          />
        ) : null}
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

      {rows.length === 0 ? (
        <p className="max-w-[80ch] text-sm text-muted">
          Nothing scheduled in the four weeks either side of {today}. A schedule
          is generated from the active plans for a date — one per shop per
          kitchen — and generating ahead is fine: par overrides written later
          are picked up whenever generation runs.
        </p>
      ) : (
        <SchedulesList rows={rows} editable={editable} today={today} />
      )}
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
