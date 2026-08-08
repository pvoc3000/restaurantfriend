import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { PlanMatrix } from "@/components/production/PlanMatrix";
import { overlappingPlans, planRange, type PlanSummary } from "@/lib/productionPlans";

/**
 * One plan: what it is, and the tray × weekday matrix that IS the plan.
 *
 * The overlap warning sits at the top rather than beside a field, because it is
 * not a property of this plan — it is a fact about this shop's menu, and the
 * consequence (pars SUM at generation) belongs where you cannot miss it.
 */
export async function PlanDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);

  const [{ data: plan, error }, { data: allPlans }, { data: trays }, { data: items }] =
    await Promise.all([
      supabase
        .from("production_plans")
        .select("id, title, location_id, kitchen_location_id, starts_on, ends_on, is_active, notes")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("production_plans")
        .select("id, title, location_id, kitchen_location_id, starts_on, ends_on, is_active"),
      supabase
        .from("production_plan_trays")
        .select("id, tray_number, band, sort")
        .eq("plan_id", id),
      supabase
        .from("production_items")
        .select("id, name, item_type, subtype, size")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this plan: {error.message}
        {/production_plan/.test(error.message) ? " — migration 039 has not been applied yet." : ""}
      </p>
    );
  }
  if (!plan) notFound();

  const trayIds = (trays ?? []).map((t) => t.id as string);
  const { data: slots } = trayIds.length
    ? await supabase
        .from("production_plan_tray_items")
        .select("id, tray_id, weekday, item_id")
        .in("tray_id", trayIds)
    : { data: [] as { id: string; tray_id: string; weekday: number; item_id: string }[] };

  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const overlaps = overlappingPlans((allPlans ?? []) as PlanSummary[]).get(id) ?? [];

  // The band vocabulary already in use anywhere in this org, so the picker
  // offers the real words before offering to invent one.
  const { data: allTrays } = await supabase
    .from("production_plan_trays")
    .select("band")
    .not("band", "is", null);
  const bands = [...new Set((allTrays ?? []).map((t) => t.band as string))].sort();

  const trail = parseTrail(rawParams, { href: "/plans", label: "Plans" });

  return (
    <div className="space-y-10">
      <Breadcrumbs
        trail={trail}
        current={plan.title as string}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {plan.title as string}
          </h1>
          {!plan.is_active ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
          ) : null}
        </div>

        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[minmax(7rem,auto)_1fr_minmax(7rem,auto)_1fr]">
          <Row label="Sells at">
            <span className={READ_ONLY_VALUE}>
              {codeById.get(plan.location_id as string) ?? "—"}
            </span>
          </Row>
          <Row label="Made at">
            <span className={READ_ONLY_VALUE}>
              {plan.kitchen_location_id
                ? codeById.get(plan.kitchen_location_id as string) ?? "—"
                : <span className="text-mark">not set</span>}
            </span>
          </Row>
          <Row label="Starts">
            {editable ? (
              <InlineValue
                table="production_plans" id={id} column="starts_on"
                kind="date" nullable={false} value={plan.starts_on as string}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{plan.starts_on as string}</span>
            )}
          </Row>
          <Row label="Ends">
            {editable ? (
              <InlineValue
                table="production_plans" id={id} column="ends_on"
                kind="date" value={(plan.ends_on ?? null) as string | null}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{(plan.ends_on as string) ?? "—"}</span>
            )}
          </Row>
          <Row label="In force">
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {planRange({
                starts_on: plan.starts_on as string,
                ends_on: (plan.ends_on ?? null) as string | null,
              })}
            </span>
          </Row>
          <Row label="Notes">
            {editable ? (
              <InlineValue table="production_plans" id={id} column="notes" value={(plan.notes ?? null) as string | null} />
            ) : (
              <span className={READ_ONLY_VALUE}>{(plan.notes as string) ?? "—"}</span>
            )}
          </Row>
        </dl>

        {overlaps.length ? (
          // Yellow and never blocking: overlapping plans are decision 9's
          // FEATURE. What matters is that the reader knows pars will sum.
          <p className="max-w-[80ch] border-l-2 border-mark pl-3 text-[13px] text-muted">
            <span className="font-medium text-ink">
              Also active at this shop: {overlaps.join(", ")}.
            </span>{" "}
            That is allowed — a shop&rsquo;s menu is the union of its active
            plans. Where the same item appears on more than one, the pars will
            SUM when a schedule is generated.
          </p>
        ) : null}
      </div>

      <section className="space-y-3">
        <SectionHeading count={(trays ?? []).length}>Trays</SectionHeading>
        <p className="max-w-[80ch] text-[13px] text-muted">
          The display case: a row per tray, a column per day. An empty slot is
          information — it says that tray holds nothing that day.
        </p>
        <PlanMatrix
          planId={id}
          orgId={session.membership.org_id}
          trays={(trays ?? []).map((t) => ({
            id: t.id as string,
            tray_number: t.tray_number as string,
            band: (t.band ?? null) as string | null,
            sort: t.sort === null ? null : Number(t.sort),
          }))}
          slots={(slots ?? []).map((s) => ({
            id: s.id as string,
            tray_id: s.tray_id as string,
            weekday: Number(s.weekday),
            item_id: s.item_id as string,
          }))}
          items={(items ?? []).map((i) => ({
            id: i.id as string,
            name: i.name as string,
            // The taxonomy as a hint, because the name alone is ambiguous by
            // design (038) — four donuts are called "Angry Samoa".
            taxonomy: [i.size, i.item_type, i.subtype].filter(Boolean).join(" · "),
          }))}
          bands={bands}
          editable={editable}
        />
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
