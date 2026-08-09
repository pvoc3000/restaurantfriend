import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph, loadItemGraph } from "@/lib/productionQueries";
import { itemCost, lineCost, matchYield, versionBatchCost, formatCost } from "@/lib/productionCost";
import { resolveItemPrice } from "@/lib/productionPrice";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { ProductionItemFields } from "@/components/production/ProductionItemFields";
import { ProductionItemLocations } from "@/components/production/ProductionItemLocations";
import { ProductionItemHistory } from "@/components/production/ProductionItemHistory";
import { historyWindow, type HistoryLine } from "@/lib/productionHistory";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";

/**
 * One item: what it is, what it is made of, what that costs, and what each shop
 * charges for it.
 *
 * The cost BREAKDOWN is the part FileMaker never had. It stored one frozen
 * `costEach` per item, so a figure that looked wrong told you nothing about
 * why. Here every contributor is a row, and the ones that could not be priced
 * say so on their own line rather than being quietly left out of a total.
 */
export async function ProductionItemDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const locationId = session.activeLocation?.id ?? null;

  const { graph, error } = await loadProductionGraph(supabase);
  if (error) return <LoadError message={error} />;

  // "Today" from the ORG's timezone, never the server's — a UTC host rolls the
  // date at 5pm local, which would drop the newest night off the fortnight
  // every evening, exactly when somebody is counting it.
  const fortnight = historyWindow(
    guideToday(session.orgSettings.timezone ?? serverTimeZone()).date
  );

  const elementNames = new Map([...graph!.byId].map(([eid, e]) => [eid, e.name]));
  const [
    { graph: items, error: itemError },
    { data: row, error: rowError },
    { data: historyRows, error: historyError },
  ] = await Promise.all([
    loadItemGraph(supabase, elementNames),
    supabase
      .from("production_items")
      .select("id, name, notes, is_active, tally_box_size")
      .eq("id", id)
      .maybeSingle(),
    // 040 built `production_schedule_items_item_idx` for exactly this query and
    // said so: "phase 5's two-week history on the Item screen, joined to the
    // parent's date".
    supabase
      .from("v_production_schedule_lines")
      .select("schedule_date, location_id, par, made, leftover, sold")
      .eq("item_id", id)
      .gte("schedule_date", fortnight.from)
      .lte("schedule_date", fortnight.to),
  ]);
  if (itemError || rowError) return <LoadError message={itemError ?? rowError!.message} />;
  if (!row) notFound();

  // The history is NOT folded into the page's own error: a fortnight that can't
  // be read must not blank an otherwise perfectly good item record. It isn't
  // swallowed either — an empty grid asserts that nothing was made for two
  // weeks, which is the one claim that block exists to make (018's pattern).
  const history = {
    lines: (historyRows ?? []) as HistoryLine[],
    error: historyError
      ? `The last two weeks could not be read: ${historyError.message}` +
        (/counted_at|sold|v_production_schedule_lines/.test(historyError.message)
          ? " — migration 044 has not been applied yet."
          : "")
      : null,
  };

  const item = items!.items.find((i) => i.id === id);
  if (!item) notFound();

  const cost = itemCost(item, graph!.byId, items!.yields, locationId);
  const price = resolveItemPrice(
    item, locationId, items!.grid, items!.gridOverrides,
    items!.overridesByItem.get(id) ?? []
  );

  /* -- the breakdown, one row per contributor ------------------------------ */

  const rule = matchYield(item, items!.yields);
  const base = item.base_element_id ? graph!.byId.get(item.base_element_id) ?? null : null;
  const baseBatch = base?.master
    ? versionBatchCost(base.master, graph!.byId, locationId, new Set([base.id]))
    : null;
  const doughCost =
    baseBatch?.cost !== null && baseBatch !== null && rule?.portion_of_batch
      ? baseBatch.cost * Number(rule.portion_of_batch) * Number(rule.size_factor ?? 1)
      : null;

  const componentRows = item.elements.map((line) => ({
    line,
    name: line.element_id ? elementNames.get(line.element_id) ?? "—" : line.label ?? "—",
    cost: lineCost(line, graph!.byId, locationId),
  }));

  // Vocabularies: whatever the catalog already uses, so the pickers offer the
  // real words before offering to invent one.
  const vocab = {
    types: distinct(items!.items.map((i) => i.item_type)),
    subtypes: distinct(items!.items.map((i) => i.subtype)),
    finishes: distinct(items!.items.map((i) => i.finish)),
    sizes: distinct(items!.items.map((i) => i.size)),
    classes: distinct(items!.grid.map((g) => g.price_class)),
    tiers: distinct(items!.grid.map((g) => g.price_tier)),
  };

  const trail = parseTrail(rawParams, { href: "/production-items", label: "Items" });

  return (
    <div className="space-y-16">
      <div className="space-y-6">
        <Breadcrumbs
          trail={trail}
          current={row.name as string}
          trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
        />

        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              {row.name as string}
            </h1>
            {!row.is_active ? (
              <span className="text-[12px] uppercase tracking-[0.12em] text-muted">Inactive</span>
            ) : null}
          </div>
          {/* The taxonomy under the name, because the name alone is ambiguous
              by design (038) — this is what tells four "Angry Samoa" apart. */}
          <p className="text-[13px] text-muted">
            {[item.size, item.item_type, item.subtype, item.finish].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        <ProductionItemFields
          item={{
            id,
            name: row.name as string,
            item_type: item.item_type,
            subtype: item.subtype,
            finish: item.finish,
            size: item.size,
            price_class: item.price_class,
            price_tier: item.price_tier,
            tally_box_size: Number(row.tally_box_size ?? 6),
            notes: (row.notes ?? null) as string | null,
            base_element_id: item.base_element_id,
            baseName: item.baseName,
          }}
          cost={cost}
          price={price}
          vocab={vocab}
          editable={editable}
        />
      </div>

      <section className="space-y-2">
        <SectionHeading count={componentRows.length + (base ? 1 : 0)}>
          What it costs
        </SectionHeading>
        <table className="w-full max-w-[70ch] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-3 py-2 text-left">Component</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {base ? (
              <tr className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <Link href={`/elements/${base.id}`} className="hover:underline">
                    {base.name}
                  </Link>
                  <span className="block text-[12px] text-subtle">the dough</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {rule?.portion_of_batch
                    ? `${fraction(Number(rule.portion_of_batch) * Number(rule.size_factor ?? 1))} of a batch`
                    : <span className="text-mark">no yield rule</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {doughCost === null ? <span className="text-mark">—</span> : `$${doughCost.toFixed(4)}`}
                </td>
              </tr>
            ) : null}
            {componentRows.map(({ line, name, cost: c }) => (
              <tr key={line.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  {line.element_id ? (
                    <Link href={`/elements/${line.element_id}`} className="hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="text-muted">{name}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {line.qty === null ? "—" : `${line.qty} ${line.unit ?? ""}`.trim()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.cost === null ? <span className="text-mark">—</span> : `$${c.cost.toFixed(4)}`}
                </td>
              </tr>
            ))}
            <tr className="border-t border-ink font-medium">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCost(cost)}</td>
            </tr>
          </tbody>
        </table>
        {componentRows.length === 0 && !base ? (
          <p className="text-[13px] text-muted">
            Nothing recorded — this item has no dough and no components, so it
            costs nothing until one is added.
          </p>
        ) : null}
      </section>

      <ProductionItemLocations
        itemId={id}
        pars={await loadPars(supabase, id)}
        locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
        gridPrice={price.cell?.price ?? null}
        editable={editable}
      />

      <ProductionItemHistory
        lines={history.lines}
        dates={fortnight.dates}
        unavailable={history.error}
      />
    </div>
  );
}

async function loadPars(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string
) {
  const { data } = await supabase
    .from("production_item_locations")
    .select("id, location_id, par_by_weekday, price_override")
    .eq("item_id", itemId);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    location_id: r.location_id as string,
    par_by_weekday: (r.par_by_weekday ?? null) as number[] | null,
    price_override: r.price_override === null ? null : Number(r.price_override),
  }));
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

/** 0.00294 → "1/340", which is how a baker states it. */
function fraction(value: number): string {
  if (!value) return "—";
  const denominator = Math.round(1 / value);
  return denominator > 1 ? `1/${denominator}` : String(Math.round(value * 100) / 100);
}

function LoadError({ message }: { message: string }) {
  return (
    <p className="text-sm text-accent">
      Could not load this item: {message}
      {/production_item|production_price|production_batch/.test(message)
        ? " — migration 037 has not been applied yet."
        : ""}
    </p>
  );
}
