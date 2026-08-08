import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { loadProductionGraph, loadItemGraph } from "@/lib/productionQueries";
import { itemCost } from "@/lib/productionCost";
import { resolveItemPrice, margin } from "@/lib/productionPrice";
import {
  ProductionItemsList,
  type ProductionItemRow,
} from "@/components/production/ProductionItemsList";

/**
 * The menu — production brief decision 4's operational taxonomy, and the
 * cost-versus-price figures FileMaker computed once and froze.
 *
 * Both sides are derived here, on every load: cost through the BOM and out into
 * purchasing (decision 11), price through the org grid and its overrides
 * (decision 10).
 */
export default async function ProductionItemsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);
  const locationId = session.activeLocation?.id ?? null;

  const { graph, error } = await loadProductionGraph(supabase);
  if (error) return <LoadError message={error} />;

  const elementNames = new Map([...graph!.byId].map(([id, e]) => [id, e.name]));
  const { graph: items, error: itemError } = await loadItemGraph(supabase, elementNames);
  if (itemError) return <LoadError message={itemError} />;

  const rows: ProductionItemRow[] = items!.items.map((i) => {
    const cost = itemCost(i, graph!.byId, items!.yields, locationId);
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
      baseName: i.baseName,
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

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Items
      </h1>
      <ProductionItemsList rows={rows} editable={editable} />
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
