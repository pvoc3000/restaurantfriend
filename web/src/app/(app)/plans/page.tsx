import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { PlansList, type PlanRow } from "@/components/production/PlansList";
import { planKitchen } from "@/lib/productionPlans";
import { NewPlan } from "@/components/production/NewPlan";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";

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
  const editable = canWriteCatalog(session.membership.role);

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
   * SCOPED TO THE WORKING KITCHEN (Mark, 2026-08-28).
   *
   * A plan carries TWO shops and this list is filtered on the one that MAKES —
   * `planKitchen`, so a plan with no kitchen set falls back to its selling shop
   * rather than belonging to nobody and disappearing from every list.
   *
   * The rows themselves are untouched: both columns stay, so a plan DF01 bakes
   * for DF02 still says so. What changes is which plans are yours to read.
   * ------------------------------------------------------------------------ */
  const workingId = session.activeLocation?.id ?? null;
  const mine = workingId
    ? (plans ?? []).filter(
        (p) =>
          planKitchen({
            location_id: p.location_id as string,
            kitchen_location_id: (p.kitchen_location_id ?? null) as string | null,
          }) === workingId
      )
    : (plans ?? []);
  const hiddenElsewhere = (plans ?? []).length - mine.length;

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
      {/* The description sits UNDER THE TITLE in a `space-y-1` block, which is
          Facilities' shape and the one Mark prefers (2026-09-03) — as a sibling
          of the title ROW it inherited the page's `space-y-6` and sat 24px
          adrift of the heading it belongs to. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Plans
          </h1>
          {/* The scope is STATED, never merely applied. A shorter list with no
              explanation reads as plans having gone missing, and the count is
              what tells you the one you are hunting for is at another
              kitchen. */}
          <p className="text-sm text-muted">
            Plans made at{" "}
            <span className="font-semibold text-ink">
              {session.activeLocation?.code ?? "this shop"}
            </span>
            {hiddenElsewhere > 0
              ? ` — ${hiddenElsewhere} more ${
                  hiddenElsewhere === 1 ? "plan is" : "plans are"
                } made at another kitchen. Switch shops to see ${
                  hiddenElsewhere === 1 ? "it" : "them"
                }.`
              : "."}
          </p>
        </div>
        {editable ? (
          <NewPlan
            orgId={session.membership.org_id}
            locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
            today={guideToday(session.orgSettings.timezone ?? serverTimeZone()).date}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="max-w-[80ch] text-sm text-muted">
          No plans made here yet. A plan is a shop&rsquo;s display case over a
          stretch of time — which trays hold what, on which days. Several can be
          active at once, and their union is that shop&rsquo;s menu.
        </p>
      ) : (
        <PlansList
          rows={rows}
          orgId={session.membership.org_id}
          editable={editable}
          initialFilters={params}
          initialSearch={parseFilterSearch(params)}
        />
      )}
    </div>
  );
}
