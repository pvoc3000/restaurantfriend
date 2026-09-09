import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { PlanMatrix } from "@/components/production/PlanMatrix";
import {
  overlappingPlans,
  planMigrationHint,
  planRange,
  REVIEW_DEFAULTS_PARAM,
  type PlanSummary,
} from "@/lib/productionPlans";
import { canEditPage } from "@/lib/pageAccess";

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
  const editable = canEditPage(session.membership.role, "/plans");

  const [{ data: plan, error }, { data: allPlans }, { data: trays }, { data: items }] =
    await Promise.all([
      supabase
        .from("production_plans")
        .select("id, title, location_id, kitchen_by_weekday, starts_on, ends_on, is_active, notes")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("production_plans")
        .select("id, title, location_id, kitchen_by_weekday, starts_on, ends_on, is_active"),
      supabase
        .from("production_plan_trays")
        .select("id, tray_number, band, sort")
        .eq("plan_id", id),
      supabase
        .from("production_items")
        // `tally_box_size` is what the par steppers step BY (037) — a box of
        // this item, so an item that trays in twelves steps by twelve. The
        // taxonomy is what the `type` grouping sorts and bands by.
        // NO ACTIVE FILTER (Mark, 2026-08-15). A retired donut still belongs on
        // screen when you are looking for it — `PickList` sinks it under its own
        // heading, so what you reach for first is unchanged.
        .select("id, name, item_type, subtype, finish, size, tally_box_size, is_active")
        .order("name"),
    ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this plan: {error.message}
        {planMigrationHint(error.message)}
      </p>
    );
  }
  if (!plan) notFound();

  const trayIds = (trays ?? []).map((t) => t.id as string);
  const { data: slots, error: slotsError } = trayIds.length
    ? await supabase
        .from("production_plan_tray_items")
        .select("id, tray_id, weekday, item_id, par")
        .in("tray_id", trayIds)
    : {
        data: [] as {
          id: string;
          tray_id: string;
          weekday: number;
          item_id: string;
          par: number | null;
        }[],
        error: null,
      };

  // A missing column must SAY SO. This select carries `par` (043), and without
  // the column PostgREST returns an error and no rows — which `slots ?? []`
  // would render as a plan with nothing on it. An empty matrix is a claim about
  // the menu, and it would be a false one; 018's pattern is to print the
  // Postgres error instead and let the reader see the real cause.
  if (slotsError) {
    return (
      <p className="text-sm text-accent">
        Could not load this plan&rsquo;s trays: {slotsError.message}
        {planMigrationHint(slotsError.message)}
      </p>
    );
  }

  // The item DEFAULTS at the shop this plan SELLS at — the seed for a new
  // slot's par (migration 043), and nothing else: no screen reads this at
  // generation any more.
  //
  // Fetched up front rather than at click time for three reasons: it is at most
  // one row per item per shop (~105 for DF01), bounded by construction and well
  // under PostgREST's silent 1,000-row cap, so no pagination; a click-time
  // lookup would put a network round trip between the pick and the insert on a
  // screen whose whole character is "picking IS the edit"; and having the map on
  // the client lets the item picker show the default BEFORE you choose it.
  //
  // It cannot join the Promise.all above — it needs `plan.location_id`.
  const { data: defaults } = await supabase
    .from("production_item_locations")
    .select("item_id, par_by_weekday")
    .eq("location_id", plan.location_id as string)
    .not("par_by_weekday", "is", null);

  // `session.locations` to LOOK UP a code (so a plan at a closed shop still
  // renders its name), `activeLocations` to ENUMERATE — design rule 3.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const locationOptions = session.activeLocations.map((l) => ({
    value: l.id,
    label: l.code,
    hint: l.name,
  }));
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
          {/* The title is the record's own name, so it is edited where you read
              it. NOT NULL, so clearing it asks for a value instead of handing
              back a raw Postgres null-violation. */}
          <h1 className="min-w-0 text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {editable ? (
              // The title keeps the underline — see `catalog/ItemFields`.
              <InlineValue
                table="production_plans"
                id={id}
                column="title"
                nullable={false}
                value={plan.title as string}
                ariaLabel="Plan title"
                // The browser reset sets `button { text-transform: none }`, so
                // the h1's `uppercase` does NOT reach the cell inside it.
                className="uppercase"
              />
            ) : (
              (plan.title as string)
            )}
          </h1>
          {/* THE DATES BESIDE THE NAME (Mark, 2026-09-09), in parentheses and
              with no label — a plan is identified by what it is called AND when
              it runs, and "Fall 2026 - DF02" alone does not say which autumn.
              It is a rendering of `starts_on`/`ends_on`, which are edited two
              rows below; putting a second editor here would be two answers to
              one question. */}
          <span className="text-[13px] text-muted">
            (
            {planRange({
              starts_on: plan.starts_on as string,
              ends_on: (plan.ends_on ?? null) as string | null,
            })}
            )
          </span>
          {!plan.is_active ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
          ) : null}
        </div>

        <dl className="grid max-w-[min(46rem,max(32rem,50%))] grid-cols-[minmax(7rem,auto)_1fr] items-center gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[minmax(7rem,auto)_1fr_minmax(7rem,auto)_1fr] sm:[&>*:nth-child(4n+3)]:pl-6">
          {/* Both shops are CHOSEN from a list — a known vocabulary is never
              typed. Enumerating over ACTIVE locations only (design rule 3): a
              closed shop is not one you can plan a menu for. */}
          <Row label="Sells at">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="production_plans"
                id={id}
                column="location_id"
                kind="pick"
                nullable={false}
                value={plan.location_id as string}
                options={locationOptions}
                ariaLabel="Sells at"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {codeById.get(plan.location_id as string) ?? "—"}
              </span>
            )}
          </Row>
          {/* MADE AT IS A SIGNPOST, NOT A FIELD (Mark, 2026-09-09: "it's
              unclear what the kitchen picker is doing … we put back 'Made At'
              but with text that says 'Set Below.'").

              101 moved the kitchen onto the seven day columns and took this row
              out of the block with it, which left the record silent about
              where anything is made — so a reader met `MON DF01 ⌄` in the
              header with nothing having told them DF01 was a KITCHEN. The row
              is back, in the slot beside Sells at, saying where the answer
              lives and that there is one per day.

              IT STAYS READ-ONLY, and that is the whole point of it. An editor
              here would be the single "Made at" 101 deliberately dropped — one
              field claiming to answer a question that now has seven answers,
              which is 016's `nextDeliveryDate` trap. `READ_ONLY_VALUE` gives it
              the editable cells' own padding so the column does not kink. */}
          <Row label="Made at">
            <span className={`${READ_ONLY_VALUE} text-muted`}>Set below, per day.</span>
          </Row>
          <Row label="Starts">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
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
                boxed={BOXED_FIELDS}
                table="production_plans" id={id} column="ends_on"
                kind="date" value={(plan.ends_on ?? null) as string | null}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{(plan.ends_on as string) ?? "—"}</span>
            )}
          </Row>
          <Row label="Notes">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS}
                table="production_plans"
                id={id}
                column="notes"
                value={(plan.notes ?? null) as string | null}
              />
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
            par: s.par === null || s.par === undefined ? null : Number(s.par),
          }))}
          // A plain object, never a Map: two different Maps both stringify to
          // "{}" (gustoExport's lesson), and a Map does not survive the RSC
          // boundary anyway.
          defaultPars={Object.fromEntries(
            (defaults ?? []).map((d) => [
              d.item_id as string,
              ((d.par_by_weekday ?? []) as (number | string | null)[]).map((v) =>
                v === null ? null : Number(v)
              ),
            ])
          )}
          items={(items ?? []).map((i) => ({
            id: i.id as string,
            name: i.name as string,
            // The taxonomy as a hint, because the name alone is ambiguous by
            // design (038) — four donuts are called "Angry Samoa".
            taxonomy: [i.size, i.item_type, i.subtype].filter(Boolean).join(" · "),
            inactive: i.is_active === false,
            tally_box_size: Number(i.tally_box_size ?? 6),
            item_type: (i.item_type ?? null) as string | null,
            subtype: (i.subtype ?? null) as string | null,
            finish: (i.finish ?? null) as string | null,
          }))}
          bands={bands}
          // WHICH KITCHEN BAKES EACH DAY (101) — seven ISO slots, edited in the
          // matrix's own column headers, where the single "Made at" field used
          // to be a row in the block above. One answer per day and no second
          // field claiming to say the same thing.
          kitchenByWeekday={(plan.kitchen_by_weekday ?? null) as (string | null)[] | null}
          kitchenOptions={locationOptions}
          locationId={plan.location_id as string}
          locationCode={codeById.get(plan.location_id as string) ?? "this shop"}
          // Set by a duplicate: the new plan opens offering each shop's own
          // default beside every par that disagrees with it.
          reviewDefaults={rawParams[REVIEW_DEFAULTS_PARAM] === "review"}
          editable={editable}
        />
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
