import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { loadProductionGraph } from "@/lib/productionQueries";
import { elementCost, costContext } from "@/lib/productionCost";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ElementFields } from "@/components/production/ElementFields";
import { ElementNameCell } from "@/components/production/ElementNameCell";
import { ElementLocationRows } from "@/components/production/ElementLocationRows";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { BATCH_STATUS_LABEL, batchDate, describeAmount } from "@/lib/productionBatches";
import { elementTypeVocabulary, type ElementKind } from "@/lib/production";
import { ElementActions } from "@/components/production/ElementActions";
import { canEditPage } from "@/lib/pageAccess";

/**
 * One element: what it is, what it costs today, where its recipes are, and what
 * each shop keeps on hand.
 */
export async function ElementDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canEditPage(session.membership.role, "/elements");
  // The WORKING shop, and its labour rate: both are costing inputs (Mark,
  // 2026-08-12, "each location has its own vendor item and labor costs") — a
  // price override beats the catalog price, and a recipe's prep time is hours
  // until this shop's rate turns it into money.
  const costs = costContext(session.activeLocation);

  const [{ data: element, error }, { graph }, { data: recipes }, { data: locations }, { data: types }] =
    await Promise.all([
      supabase
        .from("production_elements")
        .select(
          `id, name, kind, element_type, schedule_class, manual_cost, manual_cost_unit,
           notes, is_active, inventory_item_id, inventory_items ( id, name ),
           production_element_location_costs ( location_id, cost )`
        )
        .eq("id", id)
        .maybeSingle(),
      loadProductionGraph(supabase),
      supabase
        .from("production_recipes")
        .select(
          `id, name, recipe_type, is_active,
           production_recipe_versions ( id, version_label, is_master, is_active )`
        )
        .eq("element_id", id)
        .order("name"),
      supabase
        .from("production_element_locations")
        .select(
          `id, location_id, par_by_weekday, stock_count, stock_size, stock_unit,
           is_active, notes, on_weekly_log, weekly_sort, weekly_amount, weekly_unit`
        )
        .eq("element_id", id),
      // The TYPE menu is the recipe types, not the element types in use —
      // `elementTypeVocabulary` says why.
      supabase.from("production_recipes").select("recipe_type").not("recipe_type", "is", null),
    ]);

  // The last ten times this was made — what `production_batches_element_idx`
  // exists for. Fetched after the wave above rather than inside it: it needs
  // nothing from the others, but folding it in would make a table that does not
  // exist yet (044) able to take the whole record down with it.
  const { data: recentBatches, error: batchError } = await supabase
    .from("production_batches")
    .select(
      `id, log_id, batch_number, batch_label, status, location_id,
       yield_count, yield_size, yield_unit,
       production_batch_logs!inner ( log_date )`
    )
    .eq("element_id", id)
    // The date is the LOG's since 045 — an item has none of its own.
    .order("log_date", { ascending: false, referencedTable: "production_batch_logs" })
    .limit(10);

  // Every location, not just the active ones — a batch made at a shop that has
  // since closed should still say which shop (design rule 3's look-up half).
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this element: {error.message}
        {/production_/.test(error.message) ? " — migration 036 has not been applied yet." : ""}
      </p>
    );
  }
  if (!element) notFound();

  const node = graph?.byId.get(id) ?? null;
  const cost = node
    ? elementCost(node, graph!.byId, costs)
    : { cost: null, unit: null, unresolved: [] };

  const inventory = Array.isArray(element.inventory_items)
    ? element.inventory_items[0]
    : element.inventory_items;

  const typeVocabulary = elementTypeVocabulary(
    (types ?? []).map((t) => t.recipe_type as string | null)
  );

  const trail = parseTrail(rawParams, { href: "/elements", label: "Elements" });

  return (
    <div className="space-y-16">
      <div className="space-y-6">
        <Breadcrumbs
          trail={trail}
          current={element.name as string}
          trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
        />

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* The name is the record's own, so it is edited where you read it —
              `PlanDetail`'s title. The cell writes through its own statement so
              that renaming onto an existing element says so in words; see
              `ElementNameCell` for why that is not `InlineValue`'s own update. */}
          <h1 className="min-w-0 text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {editable ? (
              <ElementNameCell id={id} name={element.name as string} />
            ) : (
              (element.name as string)
            )}
          </h1>
          {!element.is_active ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
          ) : null}
        </div>

        <ElementFields
          element={{
            id,
            name: element.name as string,
            kind: element.kind as ElementKind,
            element_type: (element.element_type ?? null) as string | null,
            schedule_class: (element.schedule_class ?? null) as string | null,
            manual_cost: element.manual_cost === null ? null : Number(element.manual_cost),
            manual_cost_unit: (element.manual_cost_unit ?? null) as string | null,
            notes: (element.notes ?? null) as string | null,
            inventory_item_id: (element.inventory_item_id ?? null) as string | null,
            inventoryName: (inventory?.name ?? null) as string | null,
          }}
          cost={cost}
          types={typeVocabulary}
          editable={editable}
        />
      </div>

      <section className="space-y-2">
        <SectionHeading count={(recipes ?? []).length}>Recipes</SectionHeading>
        {(recipes ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">
            {element.kind === "made"
              ? "No recipe yet — a made element costs nothing until it has one."
              : "None. Only a made element is described by a recipe."}
          </p>
        ) : (
          <ul className="space-y-1">
            {(recipes ?? []).map((r) => {
              const versions = (r.production_recipe_versions ?? []) as {
                id: string;
                version_label: string;
                is_master: boolean;
              }[];
              const master = versions.find((v) => v.is_master);
              return (
                <li key={r.id as string} className="text-[14px]">
                  <Link href={`/recipes/${r.id as string}`} className="font-medium hover:underline">
                    {r.name as string}
                  </Link>
                  <span className="ml-3 text-[13px] text-muted">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                    {master ? ` · master v${master.version_label}` : " · no master"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ElementLocationRows
        elementId={id}
        // MANUAL ONLY (migration 050). A made element costs what its recipe
        // costs and a purchased one what the vendor charges — both already vary
        // by shop through their own overrides, so a third answer here would be
        // a fourth place to state a price.
        manual={
          element.kind === "manual"
            ? {
                base: element.manual_cost === null ? null : Number(element.manual_cost),
                unit: (element.manual_cost_unit ?? null) as string | null,
                costs: ((element.production_element_location_costs ?? []) as {
                  location_id: string;
                  cost: number | string;
                }[]).map((c) => ({ location_id: c.location_id, cost: Number(c.cost) })),
              }
            : undefined
        }
        rows={(locations ?? []).map((l) => ({
          id: l.id as string,
          location_id: l.location_id as string,
          par_by_weekday: (l.par_by_weekday ?? null) as number[] | null,
          notes: (l.notes ?? null) as string | null,
          on_weekly_log: (l.on_weekly_log ?? false) as boolean,
          weekly_sort: (l.weekly_sort ?? null) as number | null,
          weekly_amount: (l.weekly_amount ?? null) as number | null,
          weekly_unit: (l.weekly_unit ?? null) as string | null,
          stock_count: l.stock_count === null ? null : Number(l.stock_count),
          stock_size: l.stock_size === null ? null : Number(l.stock_size),
          stock_unit: (l.stock_unit ?? null) as string | null,
          is_active: (l.is_active ?? true) as boolean,
        }))}
        locations={session.activeLocations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
        }))}
        orgId={session.membership.org_id}
        editable={editable}
      />

      <section className="space-y-2">
        <SectionHeading count={recentBatches?.length ?? 0}>Recent batches</SectionHeading>
        {batchError ? (
          // Not swallowed: an empty list asserts this has never been made.
          <p className="text-[13px] text-accent">
            The batch log could not be read: {batchError.message}
            {/production_batches/.test(batchError.message)
              ? " — migration 044 has not been applied yet."
              : ""}
          </p>
        ) : (recentBatches ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">
            Never logged. A batch appears here once somebody records making this
            — generated from the weekly schedule, or logged by hand.
          </p>
        ) : (
          <ul className="divide-y divide-hairline border border-hairline text-[13px]">
            {(recentBatches ?? []).map((b) => (
              <li key={b.id as string} className="flex flex-wrap items-baseline gap-3 px-3 py-2">
                <Link
                  // The LOG, not the batch: a batch has no route of its own,
                  // and this linked a batch id at the log's path — a 404 that
                  // predates the split.
                  href={`/batch-logs/${b.log_id as string}`}
                  className="w-24 shrink-0 font-medium hover:underline"
                >
                  {batchDate(
                    (b.production_batch_logs as unknown as { log_date: string } | null)
                      ?.log_date ?? ""
                  )}
                </Link>
                <span className="w-16 text-muted">
                  {codeById.get(b.location_id as string) ?? "—"}
                </span>
                {b.batch_label ? (
                  <span className="text-muted">#{b.batch_label as string}</span>
                ) : null}
                <span className="tabular-nums">
                  {describeAmount(
                    b.yield_count === null ? null : Number(b.yield_count),
                    b.yield_size === null ? null : Number(b.yield_size),
                    (b.yield_unit ?? null) as string | null
                  )}
                </span>
                <span className="ml-auto text-muted">
                  {BATCH_STATUS_LABEL[b.status as keyof typeof BATCH_STATUS_LABEL] ??
                    (b.status as string)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- the end of the record --------------------------------------- */}
      {/* Bottom LEFT, after everything — the placement Mark settled on for the
          employee record in 2026-08-02 after trying it beside the name, under
          the record book and bottom right. You pass what the element costs,
          what it is made into and what has been made from it before you reach
          the one control that destroys it. */}
      {editable ? (
        <div className="flex justify-start pt-4">
          <ElementActions
            elementId={id}
            name={element.name as string}
            isActive={(element.is_active ?? true) as boolean}
            variant="button"
            afterDelete={{ href: "/elements" }}
          />
        </div>
      ) : null}
    </div>
  );
}
