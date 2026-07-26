"use client";

import type { CatalogItem } from "@/lib/catalog";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";

/**
 * The item master header: name, category, base unit, note, active. base_unit is
 * free text in the schema (lbs / oz / each / gal) and pars are expressed in it,
 * so changing it does NOT rescale existing pars — the hint says so out loud.
 */
export function ItemFields({ item }: { item: CatalogItem }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          <InlineValue
            table="inventory_items"
            id={item.id}
            column="name"
            value={item.name}
            placeholder="Untitled item"
            className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
          />
        </h1>
        <span className="flex items-center gap-2 text-sm text-muted">
          <ActiveToggle
            table="inventory_items"
            id={item.id}
            active={item.is_active}
            label="Item active in the catalog"
          />
          {item.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="py-0.5 text-subtle">Category</dt>
        <dd>
          <InlineValue
            table="inventory_items"
            id={item.id}
            column="category"
            value={item.category}
            placeholder="none"
          />
        </dd>

        <dt className="py-0.5 text-subtle">Base unit</dt>
        <dd>
          <InlineValue
            table="inventory_items"
            id={item.id}
            column="base_unit"
            value={item.base_unit}
          />
        </dd>

        <dt className="py-0.5 text-subtle">Note</dt>
        <dd>
          <InlineValue
            table="inventory_items"
            id={item.id}
            column="note"
            value={item.note}
            placeholder="none"
          />
        </dd>
      </dl>

      <p className="text-xs text-subtle">
        Pars and on-hand counts are in the base unit; order quantities are in
        packages of the chosen vendor item. Changing the base unit does not
        rescale existing pars or package contents — fix those by hand.
      </p>
    </div>
  );
}
