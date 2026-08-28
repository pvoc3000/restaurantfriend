"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { formatCost, type Cost } from "@/lib/productionCost";
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
  const m = margin(cost.cost, price.price);

  // GAPS GROUP: four tracks are TWO PAIRS, and only the middle gap is a change
  // of subject. A uniform 24px reads as four unrelated columns once the values
  // are boxed — so the second LABEL of each row takes another 24px on its left,
  // and the pairs separate without a fifth track that `Row`'s two children
  // could not flow into.
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] items-center gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[minmax(8rem,auto)_1fr_minmax(8rem,auto)_1fr] sm:[&>*:nth-child(4n+3)]:pl-6">
      {/* THE SOURCE ORDER INTERLEAVES THE TWO COLUMNS, which is not the order
          you read (Mark, 2026-08-13). The grid is four tracks — label, value,
          label, value — and flows by ROW, so a pair written here lands side by
          side. Reading DOWN, that gives what he asked for:

            Type      Price tier        what the thing IS, left;
            Cut       Price class       what it is worth, right.
            Finish    Price
            Size      Cost
            Trays of  Margin
            Notes

          So the pairs below are (left, right), and moving one field means
          moving its opposite number too or everything after it shifts by one.
          Below `sm` the grid collapses to two tracks and this reads as one
          column in source order, which is why the interleave has to stay
          sensible read straight through as well. */}
      <Pick label="Type" item={item} column="item_type" value={item.item_type} options={vocab.types} editable={editable} />
      <Pick label="Price tier" item={item} column="price_tier" value={item.price_tier} options={vocab.tiers} editable={editable} />
      <Pick label="Cut" item={item} column="subtype" value={item.subtype} options={vocab.subtypes} editable={editable} />
      <Pick label="Price class" item={item} column="price_class" value={item.price_class} options={vocab.classes} editable={editable} />
      <Pick label="Finish" item={item} column="finish" value={item.finish} options={vocab.finishes} editable={editable} />

      {/* NO "where this price came from" line under the value (Mark,
          2026-08-13: "From the grid — Regular Tier 5 … can be removed"). It
          restated the two fields sitting directly beside it — Price class and
          Price tier are in this same block — and the one case it could tell you
          something the fields cannot, a per-shop override, reads as a bare
          number either way. */}
      <Row label="Price">
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>
          {price.price === null ? "—" : `$${price.price.toFixed(2)}`}
        </span>
      </Row>

      <Pick label="Size" item={item} column="size" value={item.size} options={vocab.sizes} editable={editable} />

      {/* NO "7 not priced: Simple Syrup, Corn Syrup …" line either (Mark, same
          day). The `≥` on the figure already says the cost is a lower bound,
          and the What-it-costs table below this block names every component
          including the unpriced ones — with a row each rather than four of
          them and "and 4 more". `unresolvedSummary` still serves the lists,
          where there is no breakdown to fall back on. */}
      <Row label="Cost">
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>{formatCost(cost)}</span>
      </Row>

      <Row label="Trays of">
        {/* Mark, 2026-08-07: the printed schedule's counting strip reads this.
            Six for everything today; per item so it needn't stay that way. */}
        {editable ? (
          <InlineValue
            boxed={BOXED_FIELDS}
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
          <InlineValue
            boxed={BOXED_FIELDS}
            table="production_items"
            id={item.id}
            column="notes"
            value={item.notes}
          />
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
          boxed={BOXED_FIELDS}
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
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
