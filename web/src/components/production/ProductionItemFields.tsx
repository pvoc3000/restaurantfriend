"use client";

import Link from "next/link";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";
import { formatMargin, margin, type ResolvedPrice } from "@/lib/productionPrice";

export type ItemFieldsData = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  price_class: string | null;
  price_tier: string | null;
  tally_box_size: number;
  notes: string | null;
  base_element_id: string | null;
  baseName: string | null;
};

export type Vocabularies = {
  types: string[];
  subtypes: string[];
  finishes: string[];
  sizes: string[];
  classes: string[];
  tiers: string[];
};

/**
 * The item's own fields, and the two derived figures FileMaker froze.
 *
 * Cost and price are READ-ONLY here and that is the screen's point: both are
 * resolved on every load — cost through the BOM and out into purchasing, price
 * through the grid — so there is nowhere to type either. FMP stored `costEach`,
 * `costProfitRetail` and `costToPriceRatio` on this record and they rot; rows
 * still carry figures derived from 2022 ingredient prices.
 *
 * The taxonomy is four PickLists over what already exists, `allowNew`, because
 * decision 4 makes these operational vocabularies rather than free text — they
 * are what the position guides group by — while a kitchen still invents a cut
 * faster than a migration can be written.
 */
export function ProductionItemFields({
  item,
  cost,
  price,
  vocab,
  editable,
}: {
  item: ItemFieldsData;
  cost: Cost;
  price: ResolvedPrice;
  vocab: Vocabularies;
  editable: boolean;
}) {
  const gaps = unresolvedSummary(cost);
  const m = margin(cost.cost, price.price);

  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[minmax(8rem,auto)_1fr_minmax(8rem,auto)_1fr]">
      <Pick label="Type" item={item} column="item_type" value={item.item_type} options={vocab.types} editable={editable} />
      <Pick label="Cut" item={item} column="subtype" value={item.subtype} options={vocab.subtypes} editable={editable} />
      <Pick label="Size" item={item} column="size" value={item.size} options={vocab.sizes} editable={editable} />
      <Pick label="Finish" item={item} column="finish" value={item.finish} options={vocab.finishes} editable={editable} />

      <Row label="Dough">
        {item.base_element_id ? (
          <Link href={`/elements/${item.base_element_id}`} className={`${READ_ONLY_VALUE} hover:underline`}>
            {item.baseName ?? "Linked element"}
          </Link>
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>
            None — this item has no dough cost.
          </span>
        )}
      </Row>

      <Row label="Trays of">
        {/* Mark, 2026-08-07: the printed schedule's counting strip reads this.
            Six for everything today; per item so it needn't stay that way. */}
        {editable ? (
          <InlineValue
            table="production_items"
            id={item.id}
            column="tally_box_size"
            kind="number"
            nullable={false}
            value={item.tally_box_size}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{item.tally_box_size}</span>
        )}
      </Row>

      <Pick label="Price class" item={item} column="price_class" value={item.price_class} options={vocab.classes} editable={editable} />
      <Pick label="Price tier" item={item} column="price_tier" value={item.price_tier} options={vocab.tiers} editable={editable} />

      <Row label="Cost">
        <span className="flex flex-col items-start">
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>{formatCost(cost)}</span>
          {gaps ? (
            <span className={`${READ_ONLY_VALUE} text-[13px] text-mark`}>{gaps}</span>
          ) : null}
        </span>
      </Row>

      <Row label="Price">
        <span className="flex flex-col items-start">
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {price.price === null ? "—" : `$${price.price.toFixed(2)}`}
          </span>
          <span className={`${READ_ONLY_VALUE} text-[13px] text-muted`}>
            {price.source === "item"
              ? "Set for this shop on this item"
              : price.source === "location"
                ? "This shop's grid price"
                : price.source === "org"
                  ? <>From the <Link href="/price-grid" className="underline">grid</Link>{price.cell ? ` — ${price.cell.price_class} ${price.cell.price_tier}` : ""}</>
                  : "No price — this item has no class or tier"}
          </span>
        </span>
      </Row>

      <Row label="Margin">
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>
          {/* An upper bound whenever the cost is one: a margin computed against
              a lower-bound cost cannot be tighter than the cost is. */}
          {cost.unresolved.length && m !== null ? "≤ " : ""}
          {formatMargin(m)}
        </span>
      </Row>

      <Row label="Notes">
        {editable ? (
          <InlineValue table="production_items" id={item.id} column="notes" value={item.notes} />
        ) : (
          <span className={READ_ONLY_VALUE}>{item.notes ?? "—"}</span>
        )}
      </Row>
    </dl>
  );
}

function Pick({
  label,
  item,
  column,
  value,
  options,
  editable,
}: {
  label: string;
  item: ItemFieldsData;
  column: string;
  value: string | null;
  options: string[];
  editable: boolean;
}) {
  return (
    <Row label={label}>
      {editable ? (
        <InlineValue
          table="production_items"
          id={item.id}
          column={column}
          kind="pick"
          allowNew
          value={value}
          options={options.map((o) => ({ value: o, label: o }))}
        />
      ) : (
        <span className={READ_ONLY_VALUE}>{value ?? "—"}</span>
      )}
    </Row>
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
