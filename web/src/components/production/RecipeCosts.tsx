"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { defaultColumn, type CostColumnFigures } from "@/lib/recipeCosts";
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
  matrix,
  laborRate,
  locationCode,
  editable,
  onChoose,
}: {
  version: SheetVersion;
  /** Computed by the caller, which also owns the chosen column — the Batch cost
   *  fact at the top of the screen reads the same figure, and a second matrix
   *  computed here would be a second answer waiting to disagree. */
  matrix: CostColumnFigures[];
  /** The working shop's hourly rate — labour is a fact about who is making it. */
  laborRate: number | null;
  locationCode: string | null;
  editable: boolean;
  onChoose: (index: number | null) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    const previous = version.cost_column;
    // The BASE column stores null rather than 0 — "nobody has chosen" and
    // "somebody chose the first one" are the same answer here, and null is the
    // one a fresh version already has.
    const next = index === matrix[0].column.index ? null : index;
    onChoose(next);
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("production_recipe_versions")
        .update({ cost_column: next })
        .eq("id", version.id)
        .select("id");
      if (e || !data?.length) {
        onChoose(previous);
        setError(e?.message ?? "not allowed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionHeading>Costs</SectionHeading>
        <span className="min-w-0 text-[14px] font-bold tabular-nums">
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
        {/* Narrow enough that four batch sizes fit beside the notes and versions
            column at 1280 — which is the width this screen is read at — and set
            to scroll inside its own box past that rather than pushing the page
            sideways. */}
        <table
          className="w-full table-fixed border-collapse text-[13px]"
          style={{ minWidth: 140 + matrix.length * 92 }}
        >
          <colgroup>
            <col style={{ width: 140 }} />
            {matrix.map((c) => (
              <col key={c.column.index} style={{ width: 92 }} />
            ))}
          </colgroup>
          <thead>
            {/* ONE HEADER ROW, and the radios live in it. They had a row of
                their own above the batch names, which put this table's black
                rule 26px below the Versions list's beside it — two blocks that
                should read as one band across the page, and didn't (Mark,
                2026-08-08). Inline, the rule lines up and the control sits on
                the name of the thing it selects, which is what you would aim
                at anyway. */}
            {/* `h-9` on every cell, matching the Versions list beside it: the
                two black rules have to read as one band across the page, and a
                14px radio in this row otherwise pushed this one 4px lower. */}
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em] text-ink">
              <th className="h-9 px-2 py-0 text-left align-middle">Variation</th>
              {matrix.map((c) => (
                <th key={c.column.index} className="h-9 px-2 py-0 text-right align-middle">
                  <span className="inline-flex items-center gap-1.5 leading-none">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={c.isDefault}
                      aria-label={`Cost this recipe at ${c.column.label}`}
                      disabled={!editable || pending}
                      onClick={() => choose(c.column.index)}
                      className={`inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink transition-colors disabled:opacity-35 ${
                        c.isDefault ? "bg-ink" : "bg-white"
                      }`}
                    >
                      {c.isDefault ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-white" />
                      ) : null}
                    </button>
                    <span className={c.isDefault ? "font-bold" : ""}>{c.column.label}</span>
                  </span>
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
  matrix: CostColumnFigures[];
  value: (c: CostColumnFigures) => string;
  hint?: (c: CostColumnFigures) => string | null;
  strong?: boolean;
  spaced?: boolean;
}) {
  return (
    <tr className={spaced ? "border-t border-hairline" : ""}>
      <td className={`px-2 py-2 text-[13px] ${strong ? "font-semibold" : "text-muted"}`}>{label}</td>
      {matrix.map((c) => (
        <td
          key={c.column.index}
          className={`px-2 py-2 text-right tabular-nums ${c.isDefault ? "bg-neutral-100" : ""} ${
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
