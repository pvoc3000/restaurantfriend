import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph, loadItemGraph } from "@/lib/productionQueries";
import { itemCost, costContext } from "@/lib/productionCost";
import { resolveItemPrice, margin } from "@/lib/productionPrice";
import {
  ProductionItemsList,
  type ProductionItemRow,
} from "@/components/production/ProductionItemsList";
import { parseFilterSearch, type RawSearchParams } from "@/lib/filterMenus";
import { NewProductionItem } from "@/components/production/NewProductionItem";

/**
 * The menu — production brief decision 4's operational taxonomy, and the
 * cost-versus-price figures FileMaker computed once and froze.
 *
 * Both sides are derived here, on every load: cost through the BOM and out into
 * purchasing (decision 11), price through the org grid and its overrides
 * (decision 10).
 */
export default async function ProductionItemsPage({
  searchParams,
}: {
  // The filter menus and the search box ride in the URL — raw, because which
  // values are real depends on the vocabulary the columns actually hold.
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const locationId = session.activeLocation?.id ?? null;
  // The WORKING shop, and its labour rate: both are costing inputs (Mark,
  // 2026-08-12, "each location has its own vendor item and labor costs") — a
  // price override beats the catalog price, and a recipe's prep time is hours
  // until this shop's rate turns it into money.
  const costs = costContext(session.activeLocation);

  const { graph, error } = await loadProductionGraph(supabase);
  if (error) return <LoadError message={error} />;

  const { graph: items, error: itemError } = await loadItemGraph(supabase);
  if (itemError) return <LoadError message={itemError} />;

  const rows: ProductionItemRow[] = items!.items.map((i) => {
    const cost = itemCost(i, graph!.byId, costs);
    const resolved = resolveItemPrice(
      i,
      locationId,
      items!.grid,
      items!.gridOverrides,
      items!.overridesByItem.get(i.id) ?? []
    );
    return {
      id: i.id,
      name: i.name,
      item_type: i.item_type,
      subtype: i.subtype,
      finish: i.finish,
      size: i.size,
      price_class: i.price_class,
      price_tier: i.price_tier,
      is_active: i.is_active,
      componentCount: i.elements.length,
      cost,
      price: resolved.price,
      priceSource: resolved.source,
      margin: margin(cost.cost, resolved.price),
    };
  });

  // The six vocabularies, off the rows already loaded — 037 keeps all of them
  // as free text with a PickList over what exists, so the options ARE the data.
  const vocab = (pick: (r: ProductionItemRow) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Items
          </h1>
          <p className="text-sm text-muted">The items we make and sell.</p>
        </div>
        {editable ? (
          <NewProductionItem
            orgId={session.membership.org_id}
            types={vocab((r) => r.item_type)}
            subtypes={vocab((r) => r.subtype)}
            finishes={vocab((r) => r.finish)}
            sizes={vocab((r) => r.size)}
            priceClasses={vocab((r) => r.price_class)}
            priceTiers={vocab((r) => r.price_tier)}
            existing={rows.map((r) =>
              [r.name, r.size, r.item_type, r.subtype]
                .map((v) => (v ?? "").trim().toLowerCase())
                .join("|")
            )}
          />
        ) : null}
      </div>
      <ProductionItemsList
        rows={rows}
        editable={editable}
        initialFilters={params}
        initialSearch={parseFilterSearch(params)}
      />
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <p className="text-sm text-accent">
      Could not load the menu: {message}
      {/production_item|production_price|production_batch/.test(message)
        ? " — migration 037 has not been applied yet."
        : ""}
    </p>
  );
}
