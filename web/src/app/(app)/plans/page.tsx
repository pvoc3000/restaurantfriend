import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { PlansList, type PlanRow } from "@/components/production/PlansList";
import { planIsAtLocation } from "@/lib/productionPlans";
import { NewPlan } from "@/components/production/NewPlan";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";
import { canEditPage } from "@/lib/pageAccess";

/**
 * The plans — production brief decision 9.
 *
 * A plan is what we PROPOSE to make; a schedule (phase 4) is what we land on
 * for a day. Nothing migrated: FileMaker's 150 plans stay on disk and the first
 * plan here is built in this app's own editor.
 */
export default async function PlansPage({
  searchParams,
}: {
  // The search box, the tier and the sort ride in the URL, so the view survives
  // a trip into a plan and back.
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canEditPage(session.membership.role, "/plans");
  // The ORG's calendar day — what "current" and a new plan's first day both
  // mean. `guideToday` for the reason `lib/today` exists: a UTC day rolls at
  // 5pm here.
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;

  const [{ data: plans, error }, { data: trays }, { data: slots }] = await Promise.all([
    supabase
      .from("production_plans")
      .select("id, title, location_id, kitchen_location_id, starts_on, ends_on, is_active, notes")
      .order("starts_on", { ascending: false }),
    supabase.from("production_plan_trays").select("id, plan_id"),
    supabase.from("production_plan_tray_items").select("id, tray_id"),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load plans: {error.message}
        {/production_plan/.test(error.message) ? " — migration 039 has not been applied yet." : ""}
      </p>
    );
  }

  const planByTray = new Map((trays ?? []).map((t) => [t.id as string, t.plan_id as string]));
  const trayCount = new Map<string, number>();
  for (const t of trays ?? []) {
    const p = t.plan_id as string;
    trayCount.set(p, (trayCount.get(p) ?? 0) + 1);
  }
  const slotCount = new Map<string, number>();
  for (const s of slots ?? []) {
    const p = planByTray.get(s.tray_id as string);
    if (p) slotCount.set(p, (slotCount.get(p) ?? 0) + 1);
  }

  // Every location, not just active ones — a plan at a shop that has since
  // closed should still say which shop, not an em dash (design rule 3's
  // "look up a code by id" half).
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  /* --------------------------------------------------------------------------
   * SCOPED TO EITHER SHOP ON THE PLAN (Mark, 2026-09-09) — the working location
   * SELLS what it makes, or BAKES it.
   *
   * It was the KITCHEN alone from 2026-08-28, which is the right question for
   * the generate dialog (a run is aimed at a kitchen) and the wrong one here:
   * decision 9 makes a shop's menu the union of the plans that SELL there, so
   * DF02's own menu was invisible from DF02 whenever DF01 baked it.
   *
   * The rows themselves are untouched: both columns stay, so a plan DF01 bakes
   * for DF02 still says so. What changes is which plans are yours to read.
   * ------------------------------------------------------------------------ */
  const workingId = session.activeLocation?.id ?? null;
  const mine = workingId
    ? (plans ?? []).filter((p) =>
        planIsAtLocation(
          {
            location_id: p.location_id as string,
            kitchen_location_id: (p.kitchen_location_id ?? null) as string | null,
          },
          workingId
        )
      )
    : (plans ?? []);

  const rows: PlanRow[] = mine.map((p) => ({
    id: p.id as string,
    title: p.title as string,
    location_id: p.location_id as string,
    kitchen_location_id: (p.kitchen_location_id ?? null) as string | null,
    starts_on: p.starts_on as string,
    ends_on: (p.ends_on ?? null) as string | null,
    is_active: (p.is_active ?? true) as boolean,
    notes: (p.notes ?? null) as string | null,
    sellsCode: codeById.get(p.location_id as string) ?? "—",
    kitchenCode: p.kitchen_location_id
      ? codeById.get(p.kitchen_location_id as string) ?? "—"
      : null,
    trayCount: trayCount.get(p.id as string) ?? 0,
    slotCount: slotCount.get(p.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* THE LIST RENDERS EVEN WHEN EMPTY: it owns the heading and the create
          command now, so skipping it on an empty shop would leave no title and
          no way to make the first plan. */}
      <PlansList
        rows={rows}
        orgId={session.membership.org_id}
        editable={editable}
        today={today}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
        locationCode={session.activeLocation?.code ?? null}
        action={
          editable ? (
            <NewPlan
              orgId={session.membership.org_id}
              locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
              today={today}
            />
          ) : null
        }
      />
    </div>
  );
}
