"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { moveInOrder, renumber, useRowDrag, type DropTarget } from "@/lib/rowDrag";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { ingredientChoice, ingredientUpdate } from "@/lib/recipes";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { useExactViewportHeight } from "@/lib/tableHead";
import type { LaborCells } from "@/lib/productionCost";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import {
  scaleColumns,
  scaleWidth,
  bakersPercent,
  lineGrams,
  percentBasis,
  type ScaleColumn,
} from "@/lib/production";
import { convert } from "@/lib/units";
import type { Cost } from "@/lib/productionCost";
import { RecipeScaleCell } from "./RecipeScaleCell";
import { ScaleAutoBox, HideOnPrint, DeleteRecipeRow, PercentBase } from "./RecipeRowControls";
import { RecipeStepImage } from "./RecipeStepImage";

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
  /** Migration 221 — this line is the baker's-percentage 100%. */
  percentBase: boolean;
};

/** A row of the Ingredients table: the line, and what the sheet worked out for it. */
type IngredientRow = {
  line: SheetLine;
  /** Its share of the 100% line — `bakersPercent`. */
  percent: number | null;
  /** It IS the 100% line — the Base radio's state. */
  isBasis: boolean;
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
  /**
   * This version's labour, resolved per column on the SERVER (where the costing
   * graph lives) and passed as DATA — `laborCells`, not the closure itself. A
   * function cannot cross the server/client boundary, and nothing in the type
   * system or the linter catches it.
   */
  labor: LaborCells | null;
};

/* Column weights, in the order FileMaker sets them out. `DataTable` divides
   the window's width in these PROPORTIONS rather than holding them as pixels —
   until 2026-11-03 this was a hand-built table at fixed widths that scrolled
   sideways, on the reasoning that a batch size squeezed to 60px is unreadable.
   The trade now: the grid always fits, a batch size you don't need comes off
   from the Columns menu, and a dragged width is remembered. The Note keeps the
   largest share it had as the one flexible column (Mark, 2026-08-11). */
/* The ⠿ grip — a glyph, and a column only so it has somewhere to sit. Its
   handle reaches into the cell's padding (`-mx-2`): DataTable pads every cell
   12px a side, and a share small enough to look like a grip column measured
   18px at an 800px window — less than its own padding, so the glyph drew at
   nothing wide. */
const W_DRAG = 36;
/* The Procedure table's Sort — Ingredients has none since 2026-11-03. */
const W_SORT = 56;
const W_AUTO = 56;
const W_SCALE = 118;
const W_ITEM = 200;
const W_NOTE = 200;
const W_HIDE = 48;
/* Base, a 16px radio under a four-letter label — Hide's width, for the same reason. */
const W_BASE = 48;
const W_TRASH = 40;
/* The trailing "add a batch size" slot — a NARROW AFFORDANCE, not a column
   (Mark, 2026-08-11): a column-sized hole in every row for something pressed a
   handful of times in a recipe's life. Pressing it CREATES the column with a
   name you then edit in place; clearing that name removes it again, because
   `scaleColumns` drops an unlabelled slot. So a mis-tap is one gesture from
   undone. */
const W_SPARE = 28;

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
 * Each batch size's header carries what makes the column mean something — the
 * name of the batch it makes, and the multiplier it is the base times. Both are
 * editable, and neither had any editor at all before: 036 loaded the strip and
 * no screen could touch it.
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
  elementOptions,
  show,
}: {
  version: SheetVersion;
  editable: boolean;
  /** The element catalog, for naming an ingredient. Active elements only. */
  elementOptions: PickOption[];
  /**
   * Which of the two lists this render is. They were on ONE screen until
   * 2026-08-11 and are now a tab each (Mark: "it's a little crowded
   * vertically") — a seventy-row ingredient grid and a fifteen-step procedure
   * splitting one viewport left both of them short.
   *
   * A prop rather than two components: everything above them — the scale
   * columns, the base multiplier, the measured frame — is computed from the
   * same version, and two components would either compute it twice or need a
   * third to hold it.
   */
  show: "ingredients" | "procedure";
}) {
  const columns = scaleColumns(version.scale_labels, version.scale_multipliers);
  const baseColumn: ScaleColumn | null = columns[0] ?? null;
  const baseIndex = baseColumn?.index ?? 0;
  const base = baseColumn?.multiplier ?? 1;
  const width = scaleWidth(columns);

  // THE 100% LINE (221). Held here as well as in the rows, so the radio moves
  // on the tap and the whole % column re-reads with it, before the write lands.
  const [baseLineId, setBaseLineId] = useState<string | null>(
    () => version.lines.find((l) => l.percentBase)?.id ?? null
  );
  // DRAGGED ORDER, shown at once and dropped as soon as the server's order
  // changes under it — the refresh after the write, or anybody else's edit.
  // `ItemComponents`' arrangement.
  const router = useRouter();
  const supabase = createClient();
  const serverOrder = version.lines.map((l) => l.id).join(",");
  const [optimistic, setOptimistic] = useState<{ order: string[]; basedOn: string } | null>(
    null
  );
  const [dragError, setDragError] = useState<string | null>(null);
  const [, startDrop] = useTransition();
  const lines =
    optimistic && optimistic.basedOn === serverOrder
      ? optimistic.order
          .map((id) => version.lines.find((l) => l.id === id))
          .filter((l): l is SheetLine => l !== undefined)
      : version.lines;

  /**
   * A drop: renumber the WHOLE list in tens, write only what moved — `renumber`
   * owns both rules and says why. Tens, not 1..n, to stay in step with the add
   * dialogs, which write last-plus-ten. Each write `.select()`s its row: an update RLS filters to
   * nothing returns no error.
   */
  function dropLine(dragId: string, target: DropTarget) {
    const next = moveInOrder(
      lines.map((l) => l.id),
      dragId,
      target
    );
    const writes = renumber(next, new Map(lines.map((l) => [l.id, l.sort])), 10);
    if (writes.length === 0) return;
    setDragError(null);
    setOptimistic({ order: next, basedOn: serverOrder });
    startDrop(async () => {
      const results = await Promise.all(
        writes.map((w) =>
          supabase
            .from("production_recipe_lines")
            .update({ sort: w.sort })
            .eq("id", w.id)
            .select("id")
        )
      );
      const failed = results.find((r) => r.error || !r.data?.length);
      if (failed) {
        setOptimistic(null);
        setDragError(failed.error?.message ?? "The new order wasn't saved.");
      }
      router.refresh();
    });
  }

  // `data-row-key` is what DataTable puts on every row, and it IS the line id.
  const dragBody = useRef<HTMLDivElement>(null);
  const { dragging, startRowDrag, indicatorRef, chipRef } = useRowDrag({
    bodyRef: dragBody,
    onDrop: dropLine,
    rowAttribute: "data-row-key",
  });

  const percentLines = lines.map((l) => ({
    qty: l.qty,
    unit: l.unit,
    percentBase: l.id === baseLineId,
  }));
  const percents = bakersPercent(percentLines, convert);
  const basisAt = percentBasis(percentLines, convert);

  // One trailing slot so a batch size can be ADDED — FileMaker's own layout
  // leaves a blank box at the end of both header rows for exactly this. Capped
  // at 8, which is the repetition count 036's check constraint enforces.
  const spare = editable && width < 8 ? width : null;

  // A row is the line and what the sheet worked out for it: its share of
  // the 100% line, and whether it IS that line.
  const rows: IngredientRow[] = lines.map((line, i) => ({
    line,
    percent: percents[i],
    isBasis: i === basisAt,
  }));

  // EVERY COLUMN MOVES (Mark, 2026-11-03: unlock the base amount and Auto,
  // then "hiding and moving a column are two different things"). Column order
  // is the reader's view and nothing is calculated from it — every amount
  // reads its column's stored slot. Item is pinned, which only stops it being
  // hidden.
  const scaleColumn = (column: ScaleColumn, isBase = false): DataColumn<IngredientRow> => ({
    key: `scale:${column.index}`,
    // The batch name, for the Columns menu — the header shows its editor.
    label: column.label || "Batch",
    width: W_SCALE,
    header: (
      <ScaleHeader
        version={version}
        column={column}
        width={width}
        editable={editable}
        // The base column shows no multiplier: it is what the others are a
        // multiple OF. Nor does `%`, which is a share rather than a scale.
        multiplier={!isBase && !column.isPercent}
      />
    ),
    render: (r) => (
      <RecipeScaleCell
        line={r.line}
        column={column}
        base={base}
        baseIndex={baseIndex}
        width={width}
        editable={editable}
        percent={r.percent}
      />
    ),
  });

  // NO COLUMN SORTS: the line order IS the recipe (its stored Sort), and a
  // header click that re-ordered the screen would show an order the recipe
  // does not have. The special-order lines table is the same case.
  const tableColumns: DataColumn<IngredientRow>[] = [
    // THE ⠿ HANDLE (Mark, 2026-11-03: "can we add drag handles to reorder
    // rows?"). A small grip rather than the whole row: the handle has to be
    // `touch-none` to take a vertical drag, and across a full row that would
    // stop an iPad scrolling the table at all. No label, so it is a control
    // column — never hidden, never moved.
    ...(editable
      ? [
          {
            key: "drag",
            label: "",
            width: W_DRAG,
            render: (r: IngredientRow) => (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Reorder ${lineName(r.line)}`}
                title={`Drag to reorder ${lineName(r.line)}`}
                onPointerDown={(e) => startRowDrag(e, { id: r.line.id, label: lineName(r.line) })}
                className="-mx-2 block cursor-grab touch-none select-none text-center text-[13px] leading-none text-subtle hover:text-ink"
              >
                ⠿
              </span>
            ),
          } satisfies DataColumn<IngredientRow>,
        ]
      : []),
    // NO SORT COLUMN since 2026-11-03 (Mark: "is there any legit reason to keep
    // the sort column now?"). The ⠿ grip orders the lines and scrolls the table
    // when held at an edge, which was the one move a typed number still did
    // better. `sort` itself stays — it IS the order — and the add dialogs keep
    // writing last-plus-ten.
    {
      key: "item",
      label: "Item",
      width: W_ITEM,
      pinned: true,
      wrap: true,
      render: (r) => <ItemCell line={r.line} editable={editable} options={elementOptions} />,
    },
    ...(baseColumn ? [scaleColumn(baseColumn, true)] : []),
    {
      // BASE BESIDE THE BASE AMOUNT (Mark, 2026-11-03), left of Auto: it picks
      // which of these amounts the % column counts from.
      key: "base",
      label: "Base",
      width: W_BASE,
      render: (r) => (
        <span className="flex justify-center">
          <PercentBase
            versionId={version.id}
            lineId={r.line.id}
            previousId={baseLineId}
            checked={r.isBasis}
            // Only a weighable line can be the 100% — a radio on "2 ea" would
            // choose a base that blanks the column. The line already chosen
            // keeps its radio live whatever its unit became, so it can be
            // moved off.
            weighable={(lineGrams(r.line, convert) ?? 0) > 0}
            editable={editable}
            onPick={setBaseLineId}
          />
        </span>
      ),
    },
    {
      // Declared BETWEEN the first two amount columns, FileMaker's place for
      // it, because it governs the ones to its right. Movable since 2026-11-03.
      key: "auto",
      label: "Auto",
      width: W_AUTO,
      render: (r) => (
        <span className="flex justify-center">
          <ScaleAutoBox
            line={r.line}
            columns={columns}
            base={base}
            baseIndex={baseIndex}
            percent={r.percent}
            editable={editable}
          />
        </span>
      ),
    },
    ...columns.slice(1).map((c) => scaleColumn(c)),
    // One trailing slot so a batch size can be ADDED — FileMaker's own layout
    // leaves a blank box for exactly this. Capped at 8, the repetition count
    // 036's check constraint enforces. No label: a control column, kept out of
    // the Columns menu and never dragged.
    ...(spare === null
      ? []
      : [
          {
            key: "spare",
            label: "",
            width: W_SPARE,
            header: <AddScaleColumn version={version} index={spare} width={width} />,
            render: () => null,
          } satisfies DataColumn<IngredientRow>,
        ]),
    {
      key: "note",
      label: "Note",
      width: W_NOTE,
      wrap: true,
      render: (r) =>
        editable ? (
          <span className="text-[13px] text-muted">
            <InlineValue
              table="production_recipe_lines"
              id={r.line.id}
              column="note"
              value={r.line.note}
              placeholder=""
            />
          </span>
        ) : (
          <span className={`${READ_ONLY_VALUE} text-[13px] text-muted`}>{r.line.note ?? ""}</span>
        ),
    },
    {
      key: "hide",
      label: "Hide",
      width: W_HIDE,
      render: (r) => (
        <span className="flex justify-center">
          <HideOnPrint id={r.line.id} hidden={r.line.hideOnPrint} editable={editable} />
        </span>
      ),
    },
    {
      key: "trash",
      label: "",
      width: W_TRASH,
      render: (r) =>
        editable ? (
          <DeleteRecipeRow
            table="production_recipe_lines"
            id={r.line.id}
            what={`"${r.line.elementName ?? r.line.label ?? "this line"}"`}
          />
        ) : null,
    },
  ];


  // ONE LIST FILLS THE WINDOW. They shared it from 2026-08-08 until
  // 2026-08-11, when the crowding that arrangement was meant to cure came back
  // at half the height (Mark: "it's a little crowded vertically") — a
  // seventy-row grid and a fifteen-step procedure both want a screen, and
  // giving each half of one made neither readable. A tab each now, so whichever
  // you are reading gets all of it.
  //
  // The frame still fills the window exactly. The floor is small on purpose: it
  // is the fallback for a window too short to divide, not a target — a
  // generous floor makes the page
  // scroll on every laptop, which is the opposite of filling it.
  const frame = useRef<HTMLDivElement>(null);
  useExactViewportHeight(frame, true, 360);

  return (
    <div ref={frame} className="flex flex-col gap-10 overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Ingredients                                                         */}
      {/* ------------------------------------------------------------------ */}
      {show === "ingredients" ? (
      <section className="flex min-h-0 basis-0 grow flex-col gap-3">
        {/* A `DataTable` since 2026-11-03 (Mark: "is the ingredient table one
            of our datatables? It doesn't appear to be"). `scroll` + `fill`: the
            frame above is sized to the window, so the pane takes what is left
            and the column labels stay put while the lines scroll under them.
            The heading rides in the table's own strip, beside the Columns
            eye — the strip above a table carries that table's heading. */}
        <div ref={dragBody} className="min-h-0 flex-1">
        <DataTable
          leading={<SectionHeading count={version.lines.length}>Ingredients</SectionHeading>}
          columnChooser
          rows={rows}
          columns={tableColumns}
          rowKey={(r) => r.line.id}
          storageKey="recipe-ingredients"
          rowClassName={(r) =>
            `${r.line.hideOnPrint ? "text-muted" : ""} ${dragging?.id === r.line.id ? "opacity-40" : ""}`
          }
          scroll
          fill
          empty={<p className="text-[13px] text-muted">No ingredients on this version.</p>}
        />
        </div>
        {dragError ? <p className="shrink-0 text-[13px] text-accent">{dragError}</p> : null}

        {/* PORTALLED TO THE BODY, like `ItemComponents`' and for its reason: a
            `fixed` element inside the table would be clipped by any transformed
            ancestor. Positioned per move through refs, no re-render. */}
        {dragging
          ? createPortal(
              <>
                <div
                  ref={indicatorRef}
                  style={{ display: "none", left: dragging.tableLeft, width: dragging.tableWidth }}
                  className="pointer-events-none fixed z-50 h-0.5 bg-ink"
                />
                <div
                  ref={chipRef}
                  style={{
                    left: dragging.x,
                    top: dragging.y,
                    transform: dragging.touch
                      ? "translate(-50%, calc(-100% - 16px))"
                      : "translate(14px, 18px)",
                  }}
                  className="pointer-events-none fixed z-50 border border-ink bg-white px-2 py-1 text-[12px] font-medium"
                >
                  {dragging.label}
                </div>
              </>,
              document.body
            )
          : null}

        {/* No add row here: Add Ingredient… in the record's Actions menu opens
            a dialog (Mark, 2026-09-12). */}
      </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Procedure                                                           */}
      {/* ------------------------------------------------------------------ */}
      {show === "procedure" ? (
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

        {/* No add row here: Add Procedure… in the record's Actions menu opens a
            dialog (Mark, 2026-09-12). */}
      </section>
      ) : null}

    </div>
  );
}

/**
 * A batch size's column header: its NAME over its MULTIPLIER, both editable.
 *
 * These were two header rows until 2026-11-03 — a strip of multipliers above a
 * row of names — and became one cell each when the table moved onto
 * `DataTable`, which has a single header row. Stacked in the column they
 * describe, they still read as one fact ("X2.5, ×2.5") and the grid gives back
 * a row of height.
 *
 * The multiplier is LEFT-aligned under the name, not right: right-aligned it
 * sat against the next column's name and read as belonging to that one.
 */
function ScaleHeader({
  version,
  column,
  width,
  editable,
  multiplier,
}: {
  version: SheetVersion;
  column: ScaleColumn;
  width: number;
  editable: boolean;
  multiplier: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-ink">
      {editable ? (
        <InlineValue
          table="production_recipe_versions"
          id={version.id}
          column="scale_labels"
          value={column.label}
          placeholder="—"
          className="font-semibold uppercase tracking-[0.06em]"
          arrayColumn="scale_labels"
          arrayIndex={column.index}
          arrayStrip={version.scale_labels}
          arrayWidth={Math.max(width, column.index + 1)}
        />
      ) : (
        <span className={`${READ_ONLY_VALUE} font-semibold uppercase tracking-[0.06em]`}>
          {column.label}
        </span>
      )}
      {multiplier ? (
        editable ? (
          <span className="normal-case tracking-normal text-subtle">
            <InlineValue
              table="production_recipe_versions"
              id={version.id}
              column="scale_multipliers"
              kind="number"
              placeholder="×"
              value={column.multiplier}
              arrayColumn="scale_multipliers"
              arrayIndex={column.index}
              arrayStrip={version.scale_multipliers}
              arrayWidth={width}
            />
          </span>
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums normal-case tracking-normal text-subtle`}>
            ×{column.multiplier}
          </span>
        )
      ) : null}
    </span>
  );
}

/**
 * The narrow `+` at the end of the header — press it and the version grows a
 * batch size.
 *
 * IT WRITES BOTH STRIPS IN ONE STATEMENT. `scaleColumns` reads labels and
 * multipliers in step, and 036's check constraint refuses a version whose two
 * arrays are different lengths — so a label without its multiplier slot is a
 * write the database rejects.
 *
 * The new column is named "NEW" rather than left blank, because a blank one
 * would not exist: `scaleColumns` drops an unlabelled slot, so an empty label
 * writes a row nobody can see. Clearing that name in the real column is
 * therefore also how you REMOVE a batch size, which is what makes pressing this
 * by accident cost one gesture.
 */
function AddScaleColumn({
  version,
  index,
  width,
}: {
  version: SheetVersion;
  index: number;
  width: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pending}
      title="Add a batch size"
      aria-label="Add a batch size"
      onClick={() =>
        start(async () => {
          setError(null);
          const labels = padStrings(version.scale_labels, index + 1);
          labels[index] = "New";
          const { data, error: e } = await supabase
            .from("production_recipe_versions")
            .update({
              scale_labels: labels,
              scale_multipliers: padTo(version.scale_multipliers, Math.max(width, index + 1)),
            })
            .eq("id", version.id)
            .select("id");
          if (e) {
            setError(e.message);
            return;
          }
          if (!data?.length) {
            setError("not allowed");
            return;
          }
          router.refresh();
        })
      }
      className="px-1 text-[15px] leading-none text-subtle hover:text-ink disabled:opacity-35"
    >
      {error ? <span className="text-[11px] text-accent">!</span> : "+"}
    </button>
  );
}

function padStrings(strip: string[] | null, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < width; i++) out.push(strip?.[i] ?? "");
  return out;
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
 * A line with no element is a real state and not a gap: FileMaker has ingredient
 * lines that are a name and an amount with nothing behind them ("pinch of
 * salt"), which is why 036 made `element_id` nullable. Those cost nothing and
 * say so in the Cost column.
 *
 * BUT AN UNLINKED LINE MUST BE ABLE TO BECOME A LINKED ONE, and until
 * 2026-08-11 it could not: this cell was an `InlineValue` over `label`, so the
 * only thing you could change about a nameless line was its name. Nothing in
 * `web/src` wrote `element_id` at all, which made every line the app itself
 * added permanently uncosted. It is a `PickList` over the catalog now, the same
 * control the foot of the list uses, with the line's current free text carried
 * as the current value so choosing is a correction rather than a retype.
 */
function ItemCell({
  line,
  editable,
  options,
}: {
  line: SheetLine;
  editable: boolean;
  options: PickOption[];
}) {
  if (!line.elementId) {
    return editable ? (
      <LinkIngredient line={line} options={options} />
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

/**
 * The name cell on a line with no element — choose one from the catalog, or
 * keep calling it whatever you called it.
 *
 * The line's own free text is the PickList's CURRENT VALUE, which is what makes
 * this read as a correction rather than a fresh question: `PickList` always
 * lists a stored value it doesn't recognise, marked as current, above the
 * vocabulary. So a line reading "Scrap Dough" opens with "Scrap Dough" ticked
 * and every element underneath it.
 *
 * Not an `InlineValue kind="pick"`, which would be the obvious reach: that
 * writes ONE column, and the two answers here go to different ones —
 * `element_id` for a catalog element, `label` for a name that isn't one. Its
 * `onWrite` escape hatch could carry it, but the value it hands back is the
 * cell's column, so the branch would still live out here. This is small enough
 * to own its own write.
 */
function LinkIngredient({ line, options }: { line: SheetLine; options: PickOption[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const elementIds = useMemo(() => new Set(options.map((o) => o.value)), [options]);

  return (
    <span className="flex w-full flex-col items-start">
      <PickList
        value={line.label}
        options={options}
        activateTable="production_elements"
        allowNew
        clearable
        disabled={pending}
        placeholder="—"
        ariaLabel={`What line ${line.sort ?? ""} is`.trim()}
        onPick={(next) => {
          setError(null);
          start(async () => {
            const update = ingredientUpdate(ingredientChoice(next, elementIds));
            const { data, error: e } = await supabase
              .from("production_recipe_lines")
              .update(update)
              .eq("id", line.id)
              .select("id");
            if (e) {
              setError(e.message);
              return;
            }
            if (!data?.length) {
              setError("not allowed");
              return;
            }
            router.refresh();
          });
        }}
      />
      {error && <span className="px-1 text-[11px] text-accent">{error}</span>}
    </span>
  );
}

/** What a line is called, for the drag chip and the handle's name. */
function lineName(line: SheetLine): string {
  return line.elementName ?? line.label ?? "this line";
}
