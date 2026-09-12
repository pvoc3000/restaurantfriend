import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { loadProductionGraph, loadItemGraph, loadElementOptions } from "@/lib/productionQueries";
import { itemCost, lineCost, costContext } from "@/lib/productionCost";
import { resolveItemPrice } from "@/lib/productionPrice";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { ProductionItemFields } from "@/components/production/ProductionItemFields";
import { ItemComponents } from "@/components/production/ItemComponents";
import { ProductionItemLocations } from "@/components/production/ProductionItemLocations";
import { ProductionItemHistory } from "@/components/production/ProductionItemHistory";
import { historyWindow, type HistoryLine } from "@/lib/productionHistory";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { canEditPage } from "@/lib/pageAccess";
import { SectionNav } from "@/components/ui/SectionNav";
import {
  PRODUCTION_ITEM_TABS,
  PRODUCTION_ITEM_TAB_LABEL,
  parseProductionItemTab,
  productionItemTabHref,
} from "@/lib/productionItems";

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
  const editable = canEditPage(session.membership.role, "/production-items");
  const locationId = session.activeLocation?.id ?? null;
  // The WORKING shop, and its labour rate: both are costing inputs (Mark,
  // 2026-08-12, "each location has its own vendor item and labor costs") — a
  // price override beats the catalog price, and a recipe's prep time is hours
  // until this shop's rate turns it into money.
  const costs = costContext(session.activeLocation);

  // WHICH TAB, and therefore WHAT TO FETCH — the inventory item record's
  // split. Info stops paying for the Add picker's vocabulary and the
  // fortnight; Costs stops paying for the pars; History stops paying for both
  // of the others.
  //
  // The two GRAPH loads stay unconditional and that is deliberate rather than
  // unfinished: `loadItemGraph` is what resolves the taxonomy line under the
  // title, which sits ABOVE the tabs and so is on every one of them, and
  // `loadProductionGraph` answers both Info's cost figure and the whole of
  // Costs. Gating it would buy one tab of three a saving in exchange for
  // making `cost` nullable everywhere it is read.
  const tab = parseProductionItemTab(rawParams.tab);
  const wantsInfo = tab === "info";
  const wantsCosts = tab === "costs";
  const wantsHistory = tab === "history";

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
    { options: elementOptions },
  ] = await Promise.all([
    loadItemGraph(supabase),
    supabase
      .from("production_items")
      .select("id, name, notes, is_active, tally_box_size")
      .eq("id", id)
      .maybeSingle(),
    // 040 built `production_schedule_items_item_idx` for exactly this query and
    // said so: "phase 5's two-week history on the Item screen, joined to the
    // parent's date".
    wantsHistory
      ? supabase
          .from("v_production_schedule_lines")
          .select("schedule_date, location_id, par, made, leftover, sold")
          .eq("item_id", id)
          .gte("schedule_date", fortnight.from)
          .lte("schedule_date", fortnight.to)
      : { data: null, error: null },
    // The Add picker's vocabulary. Active elements only — see the helper for
    // why the costing graph beside it can't answer this.
    wantsCosts ? loadElementOptions(supabase) : { options: [] },
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

  const cost = itemCost(item, graph!.byId, costs);
  const price = resolveItemPrice(
    item, locationId, items!.grid, items!.gridOverrides,
    items!.overridesByItem.get(id) ?? []
  );

  /* -- the breakdown, one row per contributor ------------------------------ */

  // BY `sort`, then by name. The loader sweeps this table ordered by `id`, so
  // until now the breakdown's row order was the order uuids happened to fall
  // in — invisible while nothing could add a row, and arbitrary the moment
  // something can. 037 indexes `(item_id, sort)` for exactly this.
  const componentRows = item.elements
    .map((line) => ({
      line,
      name: line.element_id ? elementNames.get(line.element_id) ?? "—" : line.label ?? "—",
      cost: lineCost(line, graph!.byId, costs),
    }))
    .sort(
      (a, b) =>
        (a.line.sort ?? Number.MAX_SAFE_INTEGER) - (b.line.sort ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
    );

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

  const tabOptions = PRODUCTION_ITEM_TABS.map((t) => ({
    key: t,
    label: PRODUCTION_ITEM_TAB_LABEL[t],
    href: productionItemTabHref(id, t, rawParams),
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <Breadcrumbs
          trail={trail}
          current={row.name as string}
          trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
        />

        {/* The identity block, ABOVE the split and indented to the content
            column — the inventory item record's shape, copied rather than
            re-derived. `lg:ml-48` = the sidebar's `lg:w-40` + the row's
            `lg:gap-8`; THE THREE VALUES ARE COUPLED. */}
        <div className="space-y-1 lg:ml-48">
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
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* Two renderings of one control, WRAPPED rather than switched with a
            responsive `display` utility — Tailwind resolves competing
            utilities by stylesheet order, so a `hidden` passed in `className`
            cannot be relied on to beat the component's own `flex`. */}
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this record" value={tab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which part of this record"
            value={tab}
            items={tabOptions}
          />
        </div>

        {/* space-y-16, matching the other records: with only 8px inside each
            block, the gap BETWEEN them is what says where one ends. */}
        <div className="min-w-0 flex-1 space-y-16">
          {wantsInfo && (
            <>
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
                }}
                cost={cost}
                price={price}
                vocab={vocab}
                editable={editable}
              />

              {/* DEFAULT PARS SITS WITH THE FIELDS (Mark, 2026-09-12: "Info —
                  upper two columns and default pars area"). Both are what the
                  item IS rather than what it costs or what it did, and the
                  fields above are themselves two label/value columns, which
                  is the "upper two columns" his wording names.

                  THE 2026-09-08 TWO-COLUMN GRID IS GONE with it. That
                  arrangement existed because What it costs, Default pars and
                  Last two weeks were three short blocks stacked down a 1,300px
                  page; with one block per tab there is nothing left to stack,
                  and each now has the content column to itself. */}
              <ProductionItemLocations
                itemId={id}
                orgId={session.membership.org_id}
                pars={await loadPars(supabase, id)}
                locations={session.activeLocations.map((l) => ({
                  id: l.id,
                  code: l.code,
                  name: l.name,
                }))}
                gridPrice={price.cell?.price ?? null}
                editable={editable}
              />
            </>
          )}

          {wantsCosts && (
            <ItemComponents
              itemId={id}
              orgId={session.membership.org_id}
              rows={componentRows.map(({ line, name, cost: c }) => ({
                id: line.id,
                elementId: line.element_id,
                name,
                qty: line.qty,
                unit: line.unit,
                cost: c.cost,
                sort: line.sort ?? null,
              }))}
              total={cost}
              options={elementOptions}
              editable={editable}
            />
          )}

          {wantsHistory && (
            <ProductionItemHistory
              lines={history.lines}
              dates={fortnight.dates}
              unavailable={history.error}
            />
          )}
        </div>
      </div>
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
