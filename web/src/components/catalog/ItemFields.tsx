"use client";

import { useRouter } from "next/navigation";
import type { CatalogItem } from "@/lib/catalog";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { InlineValue, READ_ONLY_VALUE } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { BaseUnitEditor } from "./BaseUnitEditor";

/**
 * The item master header: name, category, base unit, note, active. base_unit is
 * chosen from a list (lbs / oz / each / gal / case) and pars are expressed in it,
 * so changing it does NOT rescale existing pars — the hint says so out loud.
 * It DOES rescale package contents, which are derivable; see BaseUnitEditor.
 */
export function ItemFields({
  item,
  categories,
  editable,
}: {
  item: CatalogItem;
  /** The Page Permissions sheet's cell for /items — false renders every
   *  field as a value and offers no switch, no base-unit change. */
  editable: boolean;
  /** Every category already in the catalog — the list you pick from. */
  categories: string[];
}) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {/* THE TITLE KEEPS THE UNDERLINE, and it is the one place on a record
          that does (Mark, 2026-08-28, having tried it boxed). A box is what
          tells a field from a label, and an `h1` is neither — it is the
          record's name at 28px with nothing beside it to be confused with,
          so the quietest possible "editable" is enough and a frame round a
          page heading is not what the boxes are for. */}
          <InlineValue
            readOnly={!editable}
            table="inventory_items"
            id={item.id}
            column="name"
            value={item.name}
            placeholder="Untitled item"
            className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
          />
        </h1>
        <span className="flex items-center gap-2 text-sm text-muted">
          {editable && (
            <ActiveToggle
              table="inventory_items"
              id={item.id}
              active={item.is_active}
              label="Item active in the catalog"
            />
          )}
          {item.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-subtle">Category</dt>
        <dd>
          {/* Pick from what the catalog already uses, but ADD is allowed: this
              vocabulary genuinely grows (a new line of merchandise), unlike the
              package tokens a vendor reads. Typing a name that already exists
              matches it rather than making a near-duplicate, which is how
              "COMMISSARY" and "Commissary" would otherwise both end up real. */}
          <InlineValue
            readOnly={!editable}
            table="inventory_items"
            id={item.id}
            column="category"
            value={item.category}
            boxed={BOXED_FIELDS}
            kind="pick"
            allowNew
            options={categories.map((c) => ({ value: c, label: c }))}
          />
        </dd>

        {/* Not an InlineValue (Mark, 2026-07-29). A one-column write here is
            what left "Sugar, Brown" with six oz-based package contents after
            the item moved to lbs: every content under an item is stated in its
            base unit, so changing the unit invalidates all of them. The shared
            editor recomputes the ones whose pack can answer for them and
            reports the ones that need a human. Same component the cleanup
            drawer uses, so the two can't drift. */}
        <dt className="text-subtle">Base unit</dt>
        <dd>
          {editable ? (
            <BaseUnitEditor
              key={`${item.id}:${item.base_unit}`}
              inventoryItemId={item.id}
              baseUnit={item.base_unit}
              onChanged={() => router.refresh()}
            />
          ) : (
            <span className={READ_ONLY_VALUE}>{item.base_unit}</span>
          )}
        </dd>

        <dt className="text-subtle">Note</dt>
        <dd>
          <InlineValue
            readOnly={!editable}
            table="inventory_items"
            id={item.id}
            column="note"
            value={item.note}
            boxed={BOXED_FIELDS}
          />
        </dd>
      </dl>

      {editable && (
      <p className="text-xs text-subtle">
        Pars and on-hand counts are in the base unit; order quantities are in
        packages of the chosen vendor item. Changing the base unit recomputes
        each package content whose pack can answer for it and reports the ones
        that can&apos;t. Pars are never rescaled — check them afterwards.
      </p>
      )}
    </div>
  );
}
