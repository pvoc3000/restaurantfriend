import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { DerivedDay, type DayRow, type OverrideItem } from "@/components/production/DerivedDay";

/**
 * The day BEFORE it is committed — production brief decision 6.
 *
 * FMP bumped Saturday's pars for a holiday by generating Saturday days early
 * and then defending the document: an exists-check, an overwrite warning, and a
 * "locked" flag that silently won. The document was doing double duty as a place
 * to store intent about a future date.
 *
 * This screen is that intent, on its own. It shows what generation WOULD write
 * for a shop on a date — the union of the active plans, folded with whatever
 * overrides are already recorded — and lets you write more. There is nothing to
 * clobber, and generating ahead composes with it instead of racing it.
 *
 * The pars come from `production_day(location, date)`, the same function the
 * generator calls. One implementation, two callers: this screen cannot promise
 * a number the generator would then not write.
 */
export default async function ProductionDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const params = await searchParams;

  if (!session.activeLocation) {
    return <p className="text-sm text-muted">Pick a shop to work out its day.</p>;
  }
  const working = session.activeLocation;

  // Today comes from the ORG's timezone, never `current_date` in the database:
  // generation happens at closing, which is 9pm Pacific and tomorrow in UTC.
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;
  const date = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : today;
  const locationId =
    typeof params.location === "string" &&
    session.activeLocations.some((l) => l.id === params.location)
      ? params.location
      : working.id;

  const [{ data: day, error }, { data: catalog }, { data: existing }] = await Promise.all([
    supabase.rpc("production_day", { p_location_id: locationId, p_date: date }),
    supabase
      .from("production_items")
      .select("id, name, item_type, subtype, finish, size")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("production_schedules")
      .select("id, kitchen_location_id")
      .eq("location_id", locationId)
      .eq("schedule_date", date),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not work out that day: {error.message}
        {/production_day|function/.test(error.message)
          ? " — migration 040 has not been applied yet."
          : ""}
      </p>
    );
  }

  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: DayRow[] = ((day ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: r.item_id as string,
    itemName: (r.item_name ?? "—") as string,
    itemType: (r.item_type ?? null) as string | null,
    subtype: (r.subtype ?? null) as string | null,
    finish: (r.finish ?? null) as string | null,
    size: (r.size ?? null) as string | null,
    kitchenCode: codeById.get(r.kitchen_location_id as string) ?? "—",
    trayNumber: (r.tray_number ?? null) as string | null,
    plannedPar: r.planned_par === null ? null : Number(r.planned_par),
    overridePar: r.override_par === null ? null : Number(r.override_par),
    par: Number(r.par) || 0,
    parSource: (r.par_source ?? "plan") as string,
    overrideNote: (r.override_note ?? null) as string | null,
    planCount: Number(r.plan_count) || 0,
    kitchenAssumed: Boolean(r.kitchen_assumed),
    kitchenSplit: Boolean(r.kitchen_split),
    isSuppressed: Boolean(r.is_suppressed),
    hiddenReason: (r.hidden_reason ?? null) as string | null,
  }));

  const onDay = new Set(rows.map((r) => r.itemId));
  const addable: OverrideItem[] = (catalog ?? [])
    .filter((i) => !onDay.has(i.id as string))
    .map((i) => ({
      id: i.id as string,
      name: i.name as string,
      detail:
        [i.item_type, i.subtype, i.finish, i.size].filter(Boolean).join(" · ") || "—",
    }));

  const committed = ((existing ?? []) as Record<string, unknown>[]).map((s) => ({
    id: s.id as string,
    kitchenCode: codeById.get(s.kitchen_location_id as string) ?? "—",
  }));

  return (
    <DerivedDay
      key={`${locationId}:${date}`}
      orgId={session.membership.org_id}
      locationId={locationId}
      locationCode={codeById.get(locationId) ?? "—"}
      locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
      date={date}
      today={today}
      rows={rows}
      addable={addable}
      committed={committed}
      editable={editable}
    />
  );
}
