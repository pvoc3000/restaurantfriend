"use client";

import Link from "next/link";
import { useRef } from "react";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { useExactViewportHeight } from "@/lib/tableHead";
import { useWideLayout } from "@/lib/useWideLayout";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  scaleColumns,
  scaleWidth,
  bakersPercent,
  type ScaleColumn,
} from "@/lib/production";
import { convert } from "@/lib/units";
import { unresolvedSummary, type Cost } from "@/lib/productionCost";
import { RecipeScaleCell } from "./RecipeScaleCell";
import { ScaleAutoBox, HideOnPrint, DeleteRecipeRow } from "./RecipeRowControls";
import { RecipeStepImage } from "./RecipeStepImage";
import { AddRecipeRow } from "./AddRecipeRow";

export type SheetLine = {
  id: string;
  label: string | null;
  qty: number | null;
  unit: string | null;
  note: string | null;
  sort: number | null;
  elementId: string | null;
  elementName: string | null;
  /** Migration 041 — the AUTO switch and the strip it guards. */
  scaleAuto: boolean;
  scaleAmounts: (number | null)[] | null;
  scaleUnits: (string | null)[] | null;
  hideOnPrint: boolean;
  /** What this line contributes to the batch, live. */
  cost: Cost;
};

export type SheetStep = {
  id: string;
  sort: number | null;
  body: string;
  imagePath: string | null;
  imageName: string | null;
  /** A short-lived signed URL, minted server-side beside the query. */
  imageUrl: string | null;
};

export type SheetVersion = {
  id: string;
  org_id: string;
  version_label: string;
  is_master: boolean;
  is_active: boolean;
  author: string | null;
  description: string | null;
  note: string | null;
  testing_notes: string | null;
  yield_amount: number | null;
  yield_unit: string | null;
  /* NO `mixer_size` / `prep_time`. Both are per BATCH SIZE and are rows on the
     Recipe tab; the version columns still hold FileMaker's single value and
     nothing reads them (Mark, 2026-08-08). */
  shelf_life: string | null;
  storage: string | null;
  tools: string | null;
  scale_labels: string[] | null;
  scale_multipliers: number[] | null;
  created_at: string | null;
  updated_at: string | null;
  /** FileMaker's own `_ModificationTimestamp`, parked in `source_payload` by
   *  `backfill-recipe-created.mjs`. For a migrated version it is the only true
   *  answer to "when did this recipe last change" — `updated_at` is when the
   *  migration ran. */
  fmp_modified_at: string | null;
  /** Migration 042 — which batch size this recipe is costed at. Null = base. */
  cost_column: number | null;
  lines: SheetLine[];
  steps: SheetStep[];
  batchCost: Cost;
};

/* Column widths, in the order FileMaker sets them out. Fixed pixels rather than
   the app's usual fluid weights: this is a DOCUMENT with a variable number of
   columns, not a list of records, and a batch size that squeezes to 60px as a
   version grows a fifth one is unreadable. The table takes at least the sum and
   scrolls sideways inside its own box if the window is narrower — never the
   page. */
const W_SORT = 56;
const W_AUTO = 56;
const W_SCALE = 118;
const W_ITEM = 200;
const W_NOTE = 170;
const W_COST = 72;
const W_HIDE = 48;
const W_TRASH = 40;
/* The trailing "add a batch size" slot. Narrow on purpose — it holds a name and
   nothing else until it becomes a real column, and a full-width empty column at
   the end of every row costs more than the affordance is worth. */
const W_SPARE = 72;

/**
 * One version of a recipe, set the way FileMaker set it and — since 2026-08-08
 * — editable in place.
 *
 * EVERY BATCH SIZE IS ON SCREEN AT ONCE (Mark). It used to be a `TabPicker` over
 * the columns, one at a time, which reads fine and is the wrong shape for the
 * job: scaling a recipe is a COMPARISON, and the sheet in the binder has always
 * shown four columns side by side so a baker can find the one that matches the
 * bowl in front of them.
 *
 * Above them sit the two rows that make the columns mean something — the
 * multiplier each column is the base times, and the name of the batch it makes.
 * Both are editable, and neither had any editor at all before: 036 loaded the
 * strip and no screen could touch it.
 *
 * The per-row AUTO switch is the interesting control and its own component
 * explains itself. In one line: on, the columns to its right are computed
 * (decision 3, still the default and still right for 3,350 of FMP's 5,260
 * ingredient lines); off, they are typed, which is what the other 1,910 need
 * and what this model could not express until 041.
 */
export function RecipeVersionSheet({
  version,
  editable,
}: {
  version: SheetVersion;
  editable: boolean;
}) {
  const columns = scaleColumns(version.scale_labels, version.scale_multipliers);
  const baseColumn: ScaleColumn | null = columns[0] ?? null;
  const baseIndex = baseColumn?.index ?? 0;
  const base = baseColumn?.multiplier ?? 1;
  const width = scaleWidth(columns);

  const percents = bakersPercent(
    version.lines.map((l) => ({ qty: l.qty, unit: l.unit })),
    convert
  );

  // One trailing slot so a batch size can be ADDED — FileMaker's own layout
  // leaves a blank box at the end of both header rows for exactly this. Capped
  // at 8, which is the repetition count 036's check constraint enforces.
  const spare = editable && width < 8 ? width : null;
  const headerSlots: (ScaleColumn | null)[] = [...columns, ...(spare === null ? [] : [null])];

  const tableWidth =
    W_SORT +
    W_AUTO +
    columns.length * W_SCALE +
    (spare === null ? 0 : W_SPARE) +
    W_ITEM +
    W_NOTE +
    W_COST +
    W_HIDE +
    W_TRASH;

  const lastLineSort = version.lines.reduce<number | null>(
    (a, l) => (l.sort === null ? a : Math.max(a ?? 0, l.sort)),
    null
  );
  const lastStepSort = version.steps.reduce<number | null>(
    (a, s) => (s.sort === null ? a : Math.max(a ?? 0, s.sort)),
    null
  );

  // BOTH LISTS ON SCREEN AT ONCE (Mark, 2026-08-08). A recipe is read as two
  // documents together — what goes in, and what you do with it — and a
  // seventy-row ingredient grid pushed the procedure a page and a half down.
  // So they split the window and scroll their own rows, the Info tab's
  // arrangement applied to the tab it was really needed on.
  //
  // Ingredients take the larger share: they are the list you look back at
  // between steps, and they are the one with a horizontal axis to spare.
  const frame = useRef<HTMLDivElement>(null);
  const wide = useWideLayout();
  useExactViewportHeight(frame, wide, 520);

  return (
    <div ref={frame} className="flex flex-col gap-8 overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Ingredients                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex min-h-0 basis-0 grow-[1.35] flex-col gap-3">
        <SectionHeading count={version.lines.length}>Ingredients</SectionHeading>

        {/* One scroller for BOTH axes, which is what the sticky header needs:
            `position: sticky` resolves against the nearest scroll container, so
            a separate horizontal wrapper would pin the labels to a box that
            never scrolls vertically. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table
            className="w-full table-fixed border-collapse text-[14px]"
            style={{ minWidth: tableWidth }}
          >
            <colgroup>
              <col style={{ width: W_SORT }} />
              <col style={{ width: W_ITEM }} />
              <col style={{ width: W_SCALE }} />
              <col style={{ width: W_AUTO }} />
              {headerSlots.slice(1).map((column, i) => (
                <col key={i} style={{ width: column ? W_SCALE : W_SPARE }} />
              ))}
              <col style={{ width: W_NOTE }} />
              <col style={{ width: W_COST }} />
              <col style={{ width: W_HIDE }} />
              <col style={{ width: W_TRASH }} />
            </colgroup>

            <thead>
              {/* The multiplier strip. Nothing over the base column — it is what
                  the others are a multiple OF — and nothing over `%`, which is
                  a share rather than a scale. */}
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-white">
                <th />
                <th />
                <th />
                {/* The multiplier sign sits over the AUTO column (Mark,
                    2026-08-08), which is the column it belongs to: the boxes
                    beneath it are what decide whether the numbers to its right
                    are the base times these figures. Left where it was, over the
                    base amount, it labelled the one column no multiplier
                    applies to. */}
                <th className="px-2 pb-1 text-center text-[12px] font-semibold text-subtle">×</th>
                {headerSlots.slice(1).map((column, i) => (
                  <th key={`m${i}`} className="px-2 pb-1">
                    {column && !column.isPercent && editable ? (
                      <InlineValue
                        table="production_recipe_versions"
                        id={version.id}
                        column="scale_multipliers"
                        kind="number"
                        // LEFT, not right. Right-aligned it sat against the
                        // next column's batch name and read as belonging to
                        // that one — measured 37px from the wrong label and
                        // 111px from its own.
                        placeholder="×"
                        value={column.multiplier}
                        arrayColumn="scale_multipliers"
                        arrayIndex={column.index}
                        arrayStrip={version.scale_multipliers}
                        arrayWidth={width}
                      />
                    ) : column && !column.isPercent ? (
                      <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                        ×{column.multiplier}
                      </span>
                    ) : null}
                  </th>
                ))}
                <th colSpan={5} />
              </tr>

              {/* The batch names — what each column MAKES, and the reason the
                  labels are content rather than a fixed ×½/×¾/×1 ladder. */}
              {/* STACKED STICKY OFFSETS. The three header rows scroll as one, so
                  each is pinned below the last: 26px is the multiplier row's own
                  height (12px text over `pb-1`) and 62 is that plus the batch
                  names'. Measured, not guessed — and stable, because both rows
                  are fixed type at fixed padding. */}
              <tr className="[&>th]:sticky [&>th]:top-[26px] [&>th]:z-20 [&>th]:bg-white">
                <th />
                <th />
                {/* The base column, then the AUTO column's own empty cell, then
                    the rest — the switch sits BETWEEN the first two amount
                    columns, which is what it governs, so every header row has
                    to step over it. */}
                <ScaleLabelCell
                  version={version}
                  column={headerSlots[0] ?? null}
                  index={headerSlots[0]?.index ?? spare ?? 0}
                  width={width}
                  editable={editable}
                />
                <th />
                {headerSlots.slice(1).map((column, i) => (
                  <ScaleLabelCell
                    key={`l${i}`}
                    version={version}
                    column={column}
                    /* The spare trailing slot writes the first free index. */
                    index={column?.index ?? spare ?? 0}
                    width={width}
                    editable={editable}
                  />
                ))}
                <th colSpan={5} />
              </tr>

              <tr className="text-[11px] uppercase tracking-[0.12em] text-ink [&>th]:sticky [&>th]:top-[62px] [&>th]:z-20 [&>th]:border-b-2 [&>th]:border-ink [&>th]:bg-white">
                <th className="px-2 py-2 text-left">Sort</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th />
                <th className="px-2 py-2 text-center">Auto</th>
                {headerSlots.slice(1).map((_, i) => (
                  <th key={`h${i}`} />
                ))}
                <th className="px-3 py-2 text-left">Note</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-2 py-2 text-center">Hide</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {version.lines.map((line, i) => (
                <tr
                  key={line.id}
                  className={`align-baseline hover:bg-neutral-50 ${
                    line.hideOnPrint ? "text-muted" : ""
                  }`}
                >
                  <td className="px-2 py-2">
                    {editable ? (
                      <InlineValue
                        table="production_recipe_lines"
                        id={line.id}
                        column="sort"
                        kind="number"
                        align="right"
                        placeholder=""
                        value={line.sort}
                      />
                    ) : (
                      <span className={`${READ_ONLY_VALUE} tabular-nums text-subtle`}>
                        {line.sort ?? ""}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <ItemCell line={line} editable={editable} />
                  </td>

                  {baseColumn ? (
                    <td className="px-2 py-2">
                      <RecipeScaleCell
                        line={line}
                        column={baseColumn}
                        base={base}
                        baseIndex={baseIndex}
                        width={width}
                        editable={editable}
                        percent={percents[i]}
                      />
                    </td>
                  ) : (
                    <td className="px-2 py-2" />
                  )}

                  <td className="px-2 py-2 text-center">
                    <ScaleAutoBox
                      line={line}
                      columns={columns}
                      base={base}
                      baseIndex={baseIndex}
                      percent={percents[i]}
                      editable={editable}
                    />
                  </td>

                  {headerSlots.slice(1).map((column, c) =>
                    column ? (
                      <td key={column.index} className="px-2 py-2">
                        <RecipeScaleCell
                          line={line}
                          column={column}
                          base={base}
                          baseIndex={baseIndex}
                          width={width}
                          editable={editable}
                          percent={percents[i]}
                        />
                      </td>
                    ) : (
                      <td key={`spare${c}`} />
                    )
                  )}

                  <td className="px-3 py-2 text-[13px] text-muted">
                    {editable ? (
                      <InlineValue
                        table="production_recipe_lines"
                        id={line.id}
                        column="note"
                        value={line.note}
                        placeholder=""
                      />
                    ) : (
                      <span className={READ_ONLY_VALUE}>{line.note ?? ""}</span>
                    )}
                  </td>

                  <td
                    className="px-3 py-2 text-right tabular-nums"
                    title={unresolvedSummary(line.cost) ?? undefined}
                  >
                    {line.cost.cost === null ? (
                      line.elementId ? (
                        <span className="text-mark">—</span>
                      ) : (
                        ""
                      )
                    ) : (
                      `$${line.cost.cost.toFixed(2)}`
                    )}
                  </td>

                  <td className="px-2 py-2 text-center">
                    <span className="flex justify-center">
                      <HideOnPrint id={line.id} hidden={line.hideOnPrint} editable={editable} />
                    </span>
                  </td>

                  <td className="px-1 py-2 text-center">
                    {editable ? (
                      <DeleteRecipeRow
                        table="production_recipe_lines"
                        id={line.id}
                        what={`"${line.elementName ?? line.label ?? "this line"}"`}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {version.lines.length === 0 ? (
          <p className="shrink-0 text-[13px] text-muted">No ingredients on this version.</p>
        ) : null}

        {editable ? (
          <AddRecipeRow
            table="production_recipe_lines"
            versionId={version.id}
            orgId={version.org_id}
            lastSort={lastLineSort}
            what="ingredient"
            placeholder="Name the ingredient — link it to an element on the row"
          />
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Procedure                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex min-h-0 basis-0 grow flex-col gap-3">
        <SectionHeading count={version.steps.length}>Procedure</SectionHeading>

        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-[14px]">
          <colgroup>
            <col style={{ width: W_SORT }} />
            <col />
            <col style={{ width: 180 }} />
            <col style={{ width: W_TRASH }} />
          </colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.12em] text-ink [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:border-b-2 [&>th]:border-ink [&>th]:bg-white">
              <th className="px-2 py-2 text-left">Sort</th>
              <th className="px-3 py-2 text-left">Step</th>
              <th className="px-3 py-2 text-left">Picture</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {version.steps.map((step) => (
              <tr key={step.id} className="align-top hover:bg-neutral-50">
                <td className="px-2 py-2">
                  {editable ? (
                    <InlineValue
                      table="production_recipe_steps"
                      id={step.id}
                      column="sort"
                      kind="number"
                      align="right"
                      placeholder=""
                      value={step.sort}
                    />
                  ) : (
                    <span className={`${READ_ONLY_VALUE} tabular-nums text-subtle`}>
                      {step.sort ?? ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <InlineValue
                      table="production_recipe_steps"
                      id={step.id}
                      column="body"
                      value={step.body}
                      multiline
                      // NOT NULL in 036 — a step with no words is not a step,
                      // and asking for one beats bouncing a Postgres
                      // null-violation back at whoever cleared the box.
                      nullable={false}
                    />
                  ) : (
                    <span className={`${READ_ONLY_VALUE} whitespace-pre-wrap`}>{step.body}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <RecipeStepImage
                    stepId={step.id}
                    orgId={version.org_id}
                    versionId={version.id}
                    url={step.imageUrl}
                    path={step.imagePath}
                    name={step.imageName}
                    editable={editable}
                  />
                </td>
                <td className="px-1 py-2 text-center">
                  {editable ? (
                    <DeleteRecipeRow
                      table="production_recipe_steps"
                      id={step.id}
                      what="this step"
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {version.steps.length === 0 ? (
          <p className="shrink-0 text-[13px] text-muted">No procedure on this version.</p>
        ) : null}

        {editable ? (
          <AddRecipeRow
            table="production_recipe_steps"
            versionId={version.id}
            orgId={version.org_id}
            lastSort={lastStepSort}
            what="step"
            placeholder="What happens next"
          />
        ) : null}
      </section>

    </div>
  );
}

/**
 * The name of one batch size, over the column it names.
 *
 * The trailing SPARE cell is how a version grows a column: type a name into it
 * and the next render has one more. Clearing a name is how one goes away —
 * `scaleColumns` drops an unlabelled slot, which is why every column carries the
 * slot it came from rather than its position on screen.
 */
function ScaleLabelCell({
  version,
  column,
  index,
  width,
  editable,
}: {
  version: SheetVersion;
  column: ScaleColumn | null;
  index: number;
  width: number;
  editable: boolean;
}) {
  return (
    <th className="px-2 pb-2 text-left">
      {editable ? (
        <InlineValue
          table="production_recipe_versions"
          id={version.id}
          column="scale_labels"
          value={column?.label ?? null}
          placeholder={column ? "—" : "+"}
          className="font-semibold uppercase tracking-[0.06em]"
          arrayColumn="scale_labels"
          arrayIndex={index}
          arrayStrip={version.scale_labels}
          arrayWidth={Math.max(width, index + 1)}
          // The two strips are read in step by `scaleColumns`, so a new label
          // needs its multiplier slot to exist as well — otherwise the arrays
          // are different lengths and the version's own check constraint
          // refuses the write.
          alsoUpdate={() =>
            column ? null : { scale_multipliers: padTo(version.scale_multipliers, index + 1) }
          }
        />
      ) : (
        <span className={`${READ_ONLY_VALUE} font-semibold uppercase tracking-[0.06em]`}>
          {column?.label ?? ""}
        </span>
      )}
    </th>
  );
}

function padTo(strip: number[] | null, width: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < width; i++) out.push(strip?.[i] ?? null);
  return out;
}

/**
 * What the line IS — the element it names, with FMP's `columnName_t` override
 * under it.
 *
 * A line with no element is a real state and not a gap: 1,459 of FileMaker's
 * own ingredient lines are a name and an amount with nothing behind them
 * ("pinch of salt"), which is why 036 made `element_id` nullable. Those cost
 * nothing and say so in the Cost column.
 */
function ItemCell({ line, editable }: { line: SheetLine; editable: boolean }) {
  if (!line.elementId) {
    return editable ? (
      <InlineValue
        table="production_recipe_lines"
        id={line.id}
        column="label"
        value={line.label}
        placeholder="—"
      />
    ) : (
      <span className={`${READ_ONLY_VALUE} text-muted`}>{line.label ?? "—"}</span>
    );
  }

  return (
    <span className="flex flex-col items-start">
      <Link href={`/elements/${line.elementId}`} className="px-1 hover:underline">
        {line.elementName ?? line.label}
      </Link>
      {editable ? (
        // FMP's `columnName_t`. NOT what prints — the element's own name is,
        // here and on the sheet, because this override goes stale when a
        // version is copied (Banana Cake Donut v10 still calls its bananas
        // "Coffee"). It is kept and editable because it is real stored data and
        // somebody may have meant it; it just doesn't get to name the line.
        <span className="w-full text-[12px] text-subtle">
          <InlineValue
            table="production_recipe_lines"
            id={line.id}
            column="label"
            value={line.label}
            placeholder="also called…"
          />
        </span>
      ) : line.label && line.label !== line.elementName ? (
        <span className={`${READ_ONLY_VALUE} text-[12px] text-subtle`}>{line.label}</span>
      ) : null}
    </span>
  );
}
