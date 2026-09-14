"use client";

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { qty } from "@/lib/catalog";
import { recipeHref } from "@/lib/recipes";

/** A production element that points at this inventory item. */
export type ItemElement = { id: string; name: string; is_active: boolean };

/** One ingredient line, on a recipe's MASTER version, that uses one of those
 *  elements. */
export type RecipeUseRow = {
  id: string;
  recipe_id: string;
  recipe_name: string;
  recipe_type: string | null;
  recipe_active: boolean;
  version_label: string;
  element_id: string;
  element_name: string;
  qty: number | null;
  unit: string | null;
  note: string | null;
};

/** One production item that takes one of those elements directly. */
export type ProductUseRow = {
  id: string;
  item_id: string;
  item_name: string;
  detail: string;
  item_active: boolean;
  element_id: string;
  element_name: string;
  qty: number | null;
  unit: string | null;
};

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

function amount(value: number | null, unit: string | null) {
  if (value === null) return <span className="text-faint">—</span>;
  return (
    <span className="tabular-nums text-body">
      {qty(value)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

function Inactive() {
  return <span className="ml-2 text-xs uppercase tracking-[0.12em] text-subtle">inactive</span>;
}

/**
 * Where this inventory item is USED (Mark, 2026-09-14). DIRECT uses only: the
 * recipes whose master version lists an element linked to this item, and the
 * production items that take such an element as a component. What those
 * recipes go on to make is one click further, on the recipe.
 *
 * MASTER VERSIONS ONLY — an old version keeps its lines, and forty versions of
 * one glaze would bury the list. The master is what costing and the printed
 * sheet read.
 */
export function ItemUses({
  elements,
  recipes,
  products,
  from,
}: {
  elements: ItemElement[];
  recipes: RecipeUseRow[];
  products: ProductUseRow[];
  from: Crumb;
}) {
  const elementLink = (id: string, name: string) => (
    <Link href={withFrom(`/elements/${id}`, from)} className={LINK}>
      {name}
    </Link>
  );

  if (elements.length === 0) {
    return (
      <div className="space-y-2">
        <SectionHeading>Recipes</SectionHeading>
        <p className="text-sm text-muted">No production element is linked to this item.</p>
      </div>
    );
  }

  const recipeColumns: DataColumn<RecipeUseRow>[] = [
    {
      key: "recipe",
      label: "Recipe",
      pinned: true,
      width: 260,
      wrap: true,
      sortValue: (r) => r.recipe_name,
      render: (r) => (
        <span>
          <Link
            href={withFrom(recipeHref(r.recipe_id, { tab: "ingredients" }), from)}
            className={LINK}
          >
            {r.recipe_name}
          </Link>
          {!r.recipe_active && <Inactive />}
        </span>
      ),
    },
    {
      key: "version",
      label: "Version",
      width: 90,
      sortValue: (r) => r.version_label,
      render: (r) => <span className="text-muted">v{r.version_label}</span>,
    },
    {
      key: "type",
      label: "Type",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.recipe_type,
      render: (r) => <span className="text-muted">{r.recipe_type ?? "—"}</span>,
    },
    {
      key: "element",
      label: "As",
      width: 200,
      wrap: true,
      sortValue: (r) => r.element_name,
      render: (r) => elementLink(r.element_id, r.element_name),
    },
    {
      key: "amount",
      label: "Amount",
      width: 120,
      align: "right",
      sortValue: (r) => r.qty,
      render: (r) => amount(r.qty, r.unit),
    },
    {
      key: "note",
      label: "Note",
      width: 200,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (r) => r.note,
      render: (r) => <span className="text-muted">{r.note ?? ""}</span>,
    },
  ];

  const productColumns: DataColumn<ProductUseRow>[] = [
    {
      key: "item",
      label: "Production item",
      pinned: true,
      width: 260,
      wrap: true,
      sortValue: (r) => r.item_name,
      render: (r) => (
        <span>
          <Link href={withFrom(`/production-items/${r.item_id}`, from)} className={LINK}>
            {r.item_name}
          </Link>
          {!r.item_active && <Inactive />}
        </span>
      ),
    },
    {
      key: "detail",
      label: "Kind",
      width: 250,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (r) => r.detail,
      render: (r) => <span className="text-muted">{r.detail || "—"}</span>,
    },
    {
      key: "element",
      label: "As",
      width: 200,
      wrap: true,
      sortValue: (r) => r.element_name,
      render: (r) => elementLink(r.element_id, r.element_name),
    },
    {
      key: "amount",
      label: "Amount",
      width: 120,
      align: "right",
      sortValue: (r) => r.qty,
      render: (r) => amount(r.qty, r.unit),
    },
  ];

  return (
    <div className="space-y-16">
      <DataTable
        rows={recipes}
        columns={recipeColumns}
        rowKey={(r) => r.id}
        storageKey="rf.itemRecipeUses.v1"
        defaultSort={{ key: "recipe", dir: "asc" }}
        compactBelow={1440}
        leading={
          <div className="space-y-1">
            <SectionHeading count={recipes.length}>Recipes</SectionHeading>
            <p className="text-xs text-subtle">
              As{" "}
              {elements.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ", "}
                  {elementLink(e.id, e.name)}
                </span>
              ))}
            </p>
          </div>
        }
        empty={<p className="text-sm text-muted">No recipe uses this item.</p>}
      />

      <DataTable
        rows={products}
        columns={productColumns}
        rowKey={(r) => r.id}
        storageKey="rf.itemProductUses.v1"
        defaultSort={{ key: "item", dir: "asc" }}
        compactBelow={1440}
        leading={<SectionHeading count={products.length}>Production items</SectionHeading>}
        empty={<p className="text-sm text-muted">No production item uses this item directly.</p>}
      />
    </div>
  );
}
