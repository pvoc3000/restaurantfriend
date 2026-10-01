"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import type { PickOption } from "@/components/ui/PickList";
import { OpenRecordLink } from "@/components/ui/OpenRecordLink";
import {
  ELEMENT_KIND_OPTIONS,
  SCHEDULE_CLASS_OPTIONS,
  scheduleLabel,
  elementKindLabel,
  type ElementKind,
} from "@/lib/production";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";
import Link from "next/link";

/**
 * The element's own fields, inline-editable — `ItemFields` / `VendorFields`'
 * shape.
 *
 * No role gate on the cells, matching those two: the write is tried and RLS
 * answers below purchaser+, with the error shown beside the field rather than
 * the control vanishing. What IS gated is whether the cell is an editor at all,
 * because a cell that offers a write the database will silently swallow is
 * worse than plain text (the timesheets lesson).
 *
 * The cost row is READ-ONLY on purpose and it is the point of the screen: it
 * is derived every time this page loads, from prices that may have moved since
 * yesterday. There is nowhere to type it, which is decision 11 made visible.
 */
export function ElementFields({
  element,
  cost,
  types,
  editable,
  itemOptions,
}: {
  element: {
    id: string;
    name: string;
    kind: ElementKind;
    is_active: boolean;
    element_type: string | null;
    schedule_class: string | null;
    manual_cost: number | null;
    manual_cost_unit: string | null;
    notes: string | null;
    inventory_item_id: string | null;
    inventoryName: string | null;
  };
  cost: Cost;
  types: string[];
  editable: boolean;
  /** Every inventory item, for the Inventory item picklist. Empty when the
   *  row is not an editor. */
  itemOptions: PickOption[];
}) {
  const gaps = unresolvedSummary(cost);

  return (
    <dl className="grid max-w-[min(28rem,max(17rem,25%))] grid-cols-[minmax(7rem,auto)_1fr] items-center gap-x-4 gap-y-3 text-[14px]">
      {/* ACTIVE FIRST (Mark, 2026-09-30), a switch — `ActiveToggle`'s record
          dress, so it is not mistaken for a selection box. Inactive takes the
          element off every batch log, picker and recipe sheet. */}
      <Row label="Active">
        <ActiveToggle
          table="production_elements"
          id={element.id}
          active={element.is_active}
          label="Active"
          control="switch"
          readOnly={!editable}
        />
      </Row>

      <Row label="Kind">
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="production_elements"
            id={element.id}
            column="kind"
            kind="pick"
            nullable={false}
            value={element.kind}
            options={ELEMENT_KIND_OPTIONS}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{elementKindLabel(element.kind)}</span>
        )}
      </Row>

      <Row label="Type">
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="production_elements"
            id={element.id}
            column="element_type"
            kind="pick"
            allowNew
            value={element.element_type}
            options={types.map((t) => ({ value: t, label: t }))}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{element.element_type ?? "—"}</span>
        )}
      </Row>

      {/* Which batch log the element is generated on — a closed list since
          153, so no `allowNew`. See SCHEDULE_CLASSES. */}
      <Row label="Schedule">
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="production_elements"
            id={element.id}
            column="schedule_class"
            kind="pick"
            ariaLabel="Schedule"
            value={element.schedule_class}
            options={SCHEDULE_CLASS_OPTIONS}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{scheduleLabel(element.schedule_class)}</span>
        )}
      </Row>

      {/* Only the kind that uses it. A manual cost sitting on a purchased
          element would be a second answer to "what does this cost", which is
          the disease decision 2 exists to cure. */}
      {element.kind === "manual" ? (
        <Row label="Set cost">
          {/* A COMPOSITE ROW HAS NO TRACK TO FILL, so each half gets its own
              definite-width wrapper — a boxed field's `w-full` has nothing to
              resolve against in a shrink-to-fit row and two of them would each
              demand the whole width. `items-center`, not `items-baseline`:
              boxes align by their edges, not by the text inside them. */}
          <span className="flex items-center gap-2">
            <span className="block w-28">
              {editable ? (
                <InlineValue
                  boxed={BOXED_FIELDS}
                  table="production_elements"
                  id={element.id}
                  column="manual_cost"
                  kind="number"
                  value={element.manual_cost}
                  format={(v) => `$${Number(v).toFixed(2)}`}
                />
              ) : (
                <span className={READ_ONLY_VALUE}>
                  {element.manual_cost === null ? "—" : `$${element.manual_cost.toFixed(2)}`}
                </span>
              )}
            </span>
            <span className="text-subtle">per</span>
            <span className="block w-28">
              {editable ? (
                <InlineValue
                  boxed={BOXED_FIELDS}
                  table="production_elements"
                  id={element.id}
                  column="manual_cost_unit"
                  value={element.manual_cost_unit}
                />
              ) : (
                <span className={READ_ONLY_VALUE}>{element.manual_cost_unit ?? "—"}</span>
              )}
            </span>
          </span>
        </Row>
      ) : null}

      {/* A PURCHASED element costs nothing until it resolves to an inventory
          item, and until 2026-08-13 this row could only SAY so — there was no
          writer for `production_elements.inventory_item_id` anywhere in the
          app, so 76 active elements were permanently uncosted and the Uncosted
          tier listed problems you could not act on (Mark: "this is something
          the user needs to be able to do on our own").

          A PICKLIST since 2026-10-01 (Mark: "do the same for the production
          element record", after the vendor item's), where a Link… button used
          to grow a search box underneath. The options are the vendor item
          record's, from `lib/inventoryItemOptions`, so the two cannot drift.

          CLEARABLE, unlike the vendor item's, because "none of these" is a
          real answer here. Several of the 76 are cleaning duties and FileMaker
          metadata rows ("Fryer - replace filter", "Total Base") that were
          typed `purchased` at migration and should never resolve to an
          ingredient — for those the honest fix is the Kind field above, not a
          link. The "no cost" line stays under an empty field, because an empty
          box alone does not say what it costs you. The arrow past the field's
          right edge opens the item, outside the column so the field is as
          wide as the rest (Mark, 2026-10-01). */}
      {element.kind === "purchased" ? (
        <Row label="Inventory item">
          {editable ? (
            <span className="flex flex-col items-start gap-1">
              <span className="relative w-full">
                <InlineValue
                  kind="pick"
                  boxed={BOXED_FIELDS}
                  table="production_elements"
                  id={element.id}
                  column="inventory_item_id"
                  ariaLabel="Inventory item"
                  value={element.inventory_item_id}
                  options={itemOptions}
                  clearLabel="Not linked"
                  activateTable="inventory_items"
                />
                {element.inventory_item_id ? (
                  <OpenRecordLink
                    href={`/items/${element.inventory_item_id}`}
                    label="Open the inventory item"
                  />
                ) : null}
              </span>
              {element.inventory_item_id ? null : (
                <span className="text-[13px] text-muted">
                  Not linked — this element has no cost until it is.
                </span>
              )}
            </span>
          ) : element.inventory_item_id ? (
            <Link
              href={`/items/${element.inventory_item_id}`}
              className={`${READ_ONLY_VALUE} hover:underline`}
            >
              {element.inventoryName ?? "Linked item"}
            </Link>
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              Not linked — this element has no cost until it is.
            </span>
          )}
        </Row>
      ) : null}

      <Row label="Cost today">
        {/* The gaps note takes its own line — see RecipeVersionSheet for why,
            including why this is a wrapper rather than `block` on the spans. */}
        <span className="flex flex-col items-start">
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {formatCost(cost)}
            {cost.unit ? <span className="text-subtle"> / {cost.unit}</span> : null}
          </span>
          {gaps ? (
            <span className={`${READ_ONLY_VALUE} box-decoration-clone bg-mark-fill text-[13px]`}>
              {gaps}
            </span>
          ) : null}
        </span>
      </Row>

      <Row label="Notes">
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
            table="production_elements"
            id={element.id}
            column="notes"
            value={element.notes}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{element.notes ?? "—"}</span>
        )}
      </Row>
    </dl>
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
