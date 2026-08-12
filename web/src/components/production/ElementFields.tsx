"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import {
  ELEMENT_KIND_OPTIONS,
  SCHEDULE_CLASS_OPTIONS,
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
}: {
  element: {
    id: string;
    name: string;
    kind: ElementKind;
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
}) {
  const gaps = unresolvedSummary(cost);

  return (
    <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-3 text-[14px]">
      <Row label="Kind">
        {editable ? (
          <InlineValue
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

      {/* Free text until 2026-08-11, which is how DAILY and Daily could both
          exist. `allowNew` because the catalog still holds AB and DONUT and a
          closed list would make them unenterable — see SCHEDULE_CLASS_OPTIONS
          for why the values are uppercase. */}
      <Row label="Schedule">
        {editable ? (
          <InlineValue
            table="production_elements"
            id={element.id}
            column="schedule_class"
            kind="pick"
            allowNew
            ariaLabel="Schedule"
            value={element.schedule_class}
            options={SCHEDULE_CLASS_OPTIONS}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{element.schedule_class ?? "—"}</span>
        )}
      </Row>

      {/* Only the kind that uses it. A manual cost sitting on a purchased
          element would be a second answer to "what does this cost", which is
          the disease decision 2 exists to cure. */}
      {element.kind === "manual" ? (
        <Row label="Set cost">
          <span className="flex items-baseline gap-2">
            {editable ? (
              <InlineValue
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
            <span className="text-subtle">per</span>
            {editable ? (
              <InlineValue
                table="production_elements"
                id={element.id}
                column="manual_cost_unit"
                value={element.manual_cost_unit}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{element.manual_cost_unit ?? "—"}</span>
            )}
          </span>
        </Row>
      ) : null}

      {element.kind === "purchased" ? (
        <Row label="Inventory item">
          {element.inventory_item_id ? (
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
            <span className={`${READ_ONLY_VALUE} text-[13px] text-mark`}>{gaps}</span>
          ) : null}
        </span>
      </Row>

      <Row label="Notes">
        {editable ? (
          <InlineValue
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
      <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
