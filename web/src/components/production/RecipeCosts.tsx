"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { recipeCostMatrix, defaultColumn, type CostLine } from "@/lib/recipeCosts";
import { scaleColumns } from "@/lib/production";
import type { SheetVersion } from "./RecipeVersionSheet";

/**
 * FileMaker's COSTS block: what this recipe comes to at every batch size it
 * knows how to make, and which of those is the answer when somebody asks what
 * the recipe costs.
 *
 * A MATRIX, not a `DataTable`. The table component is for a list of RECORDS and
 * this is one record with two axes — a row is a kind of figure and a column is
 * a batch size — which is the same call `/price-grid` made. Reading it as six
 * rows of (figure, batch, value) would lose the comparison the block exists for.
 *
 * THE COLUMN THAT MATTERS IS RARELY THE FIRST ONE. Ingredients scale and labour
 * does not, so the cost of one donut falls sharply as the batch grows —
 * FileMaker's own sheet reads $3.08 at the test batch against $0.61 at ×1. That
 * is the whole reason there is a radio row here rather than a single figure.
 */
export function RecipeCosts({
  version,
  laborRate,
  locationCode,
  editable,
}: {
  version: SheetVersion;
  /** The working shop's hourly rate — labour is a fact about who is making it. */
  laborRate: number | null;
  locationCode: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [chosen, setChosen] = useState<number | null>(version.cost_column);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const columns = scaleColumns(version.scale_labels, version.scale_multipliers);
  const matrix = recipeCostMatrix({
    columns,
    lines: version.lines as CostLine[],
    baseIngredientCost: version.batchCost.cost,
    laborRate,
    costColumn: chosen,
  });
  const headline = defaultColumn(matrix);

  if (matrix.length === 0) {
    return (
      <section className="space-y-3">
        <SectionHeading>Costs</SectionHeading>
        <p className="text-[13px] text-muted">
          This version has no batch sizes, so there is nothing to cost.
        </p>
      </section>
    );
  }

  function choose(index: number) {
    const previous = chosen;
    setChosen(index);
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("production_recipe_versions")
        // The BASE column stores null rather than 0 — "nobody has chosen" and
        // "somebody chose the first one" are the same answer here, and null is
        // the one a fresh version already has.
        .update({ cost_column: index === matrix[0].column.index ? null : index })
        .eq("id", version.id)
        .select("id");
      if (e || !data?.length) {
        setChosen(previous);
        setError(e?.message ?? "not allowed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionHeading>Costs</SectionHeading>
        <span className="text-[14px] font-bold tabular-nums">
          {headline?.costPer === null || headline === null
            ? "—"
            : `${money(headline.costPer)} per ${headline.yieldUnit ?? "unit"}`}
          <span className="ml-2 text-[12px] font-normal text-muted">
            at {headline?.column.label}
            {locationCode ? ` · ${locationCode}` : ""}
          </span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-[14px]" style={{ minWidth: 520 }}>
          <colgroup>
            <col style={{ width: 190 }} />
            {matrix.map((c) => (
              <col key={c.column.index} style={{ width: 110 }} />
            ))}
          </colgroup>
          <thead>
            {/* The radio row. It is the only INPUT in the block — everything
                below it is arithmetic — so it sits at the top where FileMaker
                puts it, above the names of the things it is choosing between. */}
            <tr>
              <th className="px-3 pb-1 text-right text-[10px] uppercase tracking-[0.12em] text-subtle">
                Cost at
              </th>
              {matrix.map((c) => (
                <th key={c.column.index} className="px-3 pb-1 text-center">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={c.isDefault}
                    aria-label={`Cost this recipe at ${c.column.label}`}
                    disabled={!editable || pending}
                    onClick={() => choose(c.column.index)}
                    className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-ink transition-colors disabled:opacity-35 ${
                      c.isDefault ? "bg-ink" : "bg-white"
                    }`}
                  >
                    {c.isDefault ? (
                      <span className="h-[6px] w-[6px] rounded-full bg-white" />
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em] text-ink">
              <th className="px-3 py-2 text-left">Variation</th>
              {matrix.map((c) => (
                <th
                  key={c.column.index}
                  className={`px-3 py-2 text-right ${c.isDefault ? "font-bold" : ""}`}
                >
                  {c.column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Ingredients" matrix={matrix} value={(c) => money(c.ingredients)} />
            <Row
              label="Labor"
              matrix={matrix}
              value={(c) => money(c.labor)}
              hint={(c) =>
                c.laborHours === null ? null : `${c.laborHours} hr${laborRate ? ` × $${laborRate}` : ""}`
              }
            />
            <Row label="Subtotal" matrix={matrix} value={(c) => money(c.subtotal)} strong />
            <Row
              label="Recipe yield"
              matrix={matrix}
              value={(c) => (c.yieldQty === null ? "—" : String(c.yieldQty))}
              hint={(c) => c.yieldUnit}
              spaced
            />
            <Row label="Cost per" matrix={matrix} value={(c) => money(c.costPer)} strong />
          </tbody>
        </table>
      </div>

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}

      {/* THE COSTED YIELD LIVES HERE AND NOWHERE ELSE (Mark, 2026-08-08, having
          the Info block state it beside a Recipe row that said something else).
          `production_recipe_versions.yield_amount` is what `lib/productionCost`
          divides a made element's batch by, so it is the number behind every
          figure the app quotes for this thing — and it is NOT the Expected
          Yield row above, which is per batch column and is what this matrix
          reads. On Raisied Donut v11 the two disagree, 30 against 34.
          Measured over all 493 versions: 284 agree, 71 differ and 137 have no
          row at all, and 19 of the 128 masters would move — some by 4×, one by
          14× — if costing were switched to the row. So they stay two numbers,
          and this is the one place the costing one is worth reading, which is
          why its editor moved here rather than being deleted with the others. */}
      <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          Costed yield
        </dt>
        <dd className="flex items-baseline gap-1">
          {editable ? (
            <>
              <InlineValue
                table="production_recipe_versions"
                id={version.id}
                column="yield_amount"
                kind="number"
                value={version.yield_amount}
                className="w-16"
              />
              <InlineValue
                table="production_recipe_versions"
                id={version.id}
                column="yield_unit"
                value={version.yield_unit}
                className="w-16"
              />
            </>
          ) : (
            <span className={READ_ONLY_VALUE}>
              {version.yield_amount === null
                ? "—"
                : `${version.yield_amount} ${version.yield_unit ?? ""}`.trim()}
            </span>
          )}
          <span className="text-[12px] text-muted">
            — what the rest of the app divides this batch by
          </span>
        </dd>
      </dl>

      {/* What the block is NOT saying, stated rather than left to be discovered.
          Both caveats are real and both would otherwise be found by someone
          comparing this to a figure elsewhere in the app and assuming one of
          them is broken. */}
      <p className="max-w-[70ch] text-[12px] text-muted">
        Ingredients are live from purchasing. Labour is the shop&rsquo;s hourly rate
        against this recipe&rsquo;s prep time
        {laborRate === null ? " — and this shop has no rate set, so it is left blank" : ""}.
        What an element costs elsewhere in the app is ingredients only, divided by
        the costed yield rather than by the yield row above.
      </p>
    </section>
  );
}

function Row({
  label,
  matrix,
  value,
  hint,
  strong = false,
  spaced = false,
}: {
  label: string;
  matrix: ReturnType<typeof recipeCostMatrix>;
  value: (c: ReturnType<typeof recipeCostMatrix>[number]) => string;
  hint?: (c: ReturnType<typeof recipeCostMatrix>[number]) => string | null;
  strong?: boolean;
  spaced?: boolean;
}) {
  return (
    <tr className={spaced ? "border-t border-hairline" : ""}>
      <td className={`px-3 py-2 text-[13px] ${strong ? "font-semibold" : "text-muted"}`}>{label}</td>
      {matrix.map((c) => (
        <td
          key={c.column.index}
          className={`px-3 py-2 text-right tabular-nums ${c.isDefault ? "bg-neutral-100" : ""} ${
            strong ? "font-semibold" : ""
          }`}
        >
          <span className={READ_ONLY_VALUE}>{value(c)}</span>
          {hint?.(c) ? (
            <span className="block text-[11px] font-normal text-subtle">{hint(c)}</span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}
