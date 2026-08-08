"use client";

import Link from "next/link";
import { useState } from "react";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TabPicker } from "@/components/ui/TabPicker";
import { scaleColumns, scaledAmount, percentOfBatch } from "@/lib/production";
import { convert } from "@/lib/units";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";

export type SheetLine = {
  id: string;
  label: string | null;
  qty: number | null;
  unit: string | null;
  note: string | null;
  sort: number | null;
  elementId: string | null;
  elementName: string | null;
  /** What this line contributes to the batch, live. */
  cost: Cost;
};

export type SheetVersion = {
  id: string;
  version_label: string;
  is_master: boolean;
  is_active: boolean;
  author: string | null;
  description: string | null;
  note: string | null;
  testing_notes: string | null;
  yield_amount: number | null;
  yield_unit: string | null;
  mixer_size: string | null;
  prep_time: string | null;
  shelf_life: string | null;
  storage: string | null;
  tools: string | null;
  scale_labels: string[] | null;
  scale_multipliers: number[] | null;
  lines: SheetLine[];
  steps: { id: string; sort: number | null; body: string }[];
  batchCost: Cost;
};

/**
 * One version of a recipe, set the way a baker reads it: ingredients on the
 * left with a column per scale, procedure underneath.
 *
 * THE SCALE COLUMNS ARE COMPUTED HERE, which is decision 3 and the single
 * biggest structural change from FileMaker. FMP stored an amount per column —
 * four numbers per line, hand-maintained — and 96.4% of them turn out to be a
 * strict multiple of the base once the unit changing as the number grows
 * (170 g → 1.7 kg at ×10) is accounted for. Storing one amount and multiplying
 * means a corrected ingredient corrects every column at once, which is exactly
 * what the old sheet could not do.
 */
export function RecipeVersionSheet({
  version,
  editable,
}: {
  version: SheetVersion;
  editable: boolean;
}) {
  const columns = scaleColumns(version.scale_labels, version.scale_multipliers);
  const base = columns[0]?.multiplier ?? 1;
  const percents = percentOfBatch(
    version.lines.map((l) => ({ qty: l.qty, unit: l.unit })),
    convert
  );

  // Which column the sheet is being read at. Every column is derived, so this
  // is a VIEW control and lives with the table — never in a command bar.
  const [column, setColumn] = useState(0);
  const active = columns[column] ?? columns[0] ?? null;
  const scale = active ? active.multiplier / (base || 1) : 1;

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[minmax(7rem,auto)_1fr_minmax(7rem,auto)_1fr]">
        <Fact label="Yield">
          {editable ? (
            <span className="flex items-baseline gap-1">
              <InlineValue
                table="production_recipe_versions"
                id={version.id}
                column="yield_amount"
                kind="number"
                value={version.yield_amount}
              />
              <InlineValue
                table="production_recipe_versions"
                id={version.id}
                column="yield_unit"
                value={version.yield_unit}
              />
            </span>
          ) : (
            <span className={READ_ONLY_VALUE}>
              {version.yield_amount === null
                ? "—"
                : `${version.yield_amount} ${version.yield_unit ?? ""}`.trim()}
            </span>
          )}
        </Fact>
        <Fact label="Mixer">
          <Editable
            id={version.id}
            column="mixer_size"
            value={version.mixer_size}
            editable={editable}
          />
        </Fact>
        <Fact label="Prep time">
          <Editable id={version.id} column="prep_time" value={version.prep_time} editable={editable} />
        </Fact>
        <Fact label="Shelf life">
          <Editable id={version.id} column="shelf_life" value={version.shelf_life} editable={editable} />
        </Fact>
        <Fact label="Storage">
          <Editable id={version.id} column="storage" value={version.storage} editable={editable} />
        </Fact>
        <Fact label="Tools">
          <Editable id={version.id} column="tools" value={version.tools} editable={editable} />
        </Fact>
        <Fact label="Author">
          <Editable id={version.id} column="author" value={version.author} editable={editable} />
        </Fact>
        <Fact label="Batch cost">
          {/* The gaps note goes on its OWN LINE, never beside the figure. Set
              inline it read "≥ $7.385 not priced" — the count's first digit
              runs straight onto the cents, and a reader sees $7.385.
              A WRAPPER, not `block` on the spans: READ_ONLY_VALUE carries
              `inline-block`, and Tailwind resolves competing display utilities
              by STYLESHEET order rather than class-string order, so appending
              `block` silently loses. That is the same trap MENU_ITEM_CLASS
              carries no display for. */}
          <span className="flex flex-col items-start">
            <span className={`${READ_ONLY_VALUE} tabular-nums`}>
              {formatCost(version.batchCost)}
            </span>
            {unresolvedSummary(version.batchCost) ? (
              <span className={`${READ_ONLY_VALUE} text-[13px] text-mark`}>
                {unresolvedSummary(version.batchCost)}
              </span>
            ) : null}
          </span>
        </Fact>
      </dl>

      {version.description ? (
        <p className="max-w-[80ch] text-[14px] text-muted">{version.description}</p>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[16px] font-bold uppercase tracking-[0.08em]">
            Ingredients
            <span className="ml-2 text-[12px] font-semibold text-subtle">
              {version.lines.length}
            </span>
          </h3>
          {columns.length > 1 ? (
            <TabPicker
              ariaLabel="Scale"
              size="sm"
              value={String(column)}
              onChange={(v) => setColumn(Number(v))}
              options={columns.map((c, i) => ({ key: String(i), label: c.label }))}
            />
          ) : null}
        </div>

        <table className="w-full table-fixed border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em] text-ink">
              <th className="w-[42%] px-3 py-2 text-left">Ingredient</th>
              <th className="w-[16%] px-3 py-2 text-right">
                {active ? active.label : "Amount"}
              </th>
              <th className="w-[10%] px-3 py-2 text-right">%</th>
              <th className="w-[14%] px-3 py-2 text-right">Cost</th>
              <th className="w-[18%] px-3 py-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {version.lines.map((line, i) => (
              <tr key={line.id} className="align-baseline hover:bg-neutral-50">
                <td className="px-3 py-2">
                  {line.elementId ? (
                    <Link href={`/elements/${line.elementId}`} className="hover:underline">
                      {line.elementName ?? line.label}
                    </Link>
                  ) : (
                    // A note-shaped line: "pinch of salt". 222 came over from
                    // FMP with a name and no link, and they are not errors.
                    <span className="text-muted">{line.label ?? "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {active
                    ? scaledAmount(line.qty, line.unit, active, base)
                    : line.qty === null
                      ? ""
                      : `${line.qty} ${line.unit ?? ""}`.trim()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {percents[i] === null ? "" : `${percents[i]!.toFixed(1)}%`}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  title={unresolvedSummary(line.cost) ?? undefined}
                >
                  {line.cost.cost === null
                    ? line.elementId
                      ? <span className="text-mark">—</span>
                      : ""
                    : `$${(line.cost.cost * scale).toFixed(2)}`}
                </td>
                <td className="px-3 py-2 text-[13px] text-muted">{line.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {version.lines.length === 0 ? (
          <p className="text-[13px] text-muted">No ingredients on this version.</p>
        ) : null}
      </section>

      {version.steps.length ? (
        <section className="space-y-3">
          <h3 className="text-[16px] font-bold uppercase tracking-[0.08em]">
            Procedure
            <span className="ml-2 text-[12px] font-semibold text-subtle">
              {version.steps.length}
            </span>
          </h3>
          <ol className="max-w-[80ch] space-y-2 text-[14px]">
            {version.steps.map((s, i) => (
              <li key={s.id} className="flex gap-3">
                <span className="w-6 shrink-0 text-right tabular-nums text-subtle">{i + 1}.</span>
                <span className="whitespace-pre-wrap">{s.body}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {version.testing_notes || version.note ? (
        <section className="space-y-2">
          <h3 className="text-[16px] font-bold uppercase tracking-[0.08em]">Notes</h3>
          {version.note ? (
            <p className="max-w-[80ch] whitespace-pre-wrap text-[14px]">{version.note}</p>
          ) : null}
          {version.testing_notes ? (
            <p className="max-w-[80ch] whitespace-pre-wrap text-[14px] text-muted">
              {version.testing_notes}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Editable({
  id,
  column,
  value,
  editable,
}: {
  id: string;
  column: string;
  value: string | null;
  editable: boolean;
}) {
  return editable ? (
    <InlineValue table="production_recipe_versions" id={id} column={column} value={value} />
  ) : (
    <span className={READ_ONLY_VALUE}>{value ?? "—"}</span>
  );
}
