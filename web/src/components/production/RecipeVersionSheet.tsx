"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { ingredientChoice, ingredientUpdate } from "@/lib/recipes";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { useExactViewportHeight } from "@/lib/tableHead";
import type { LaborCells } from "@/lib/productionCost";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  scaleColumns,
  scaleWidth,
  bakersPercent,
  type ScaleColumn,
} from "@/lib/production";
import { convert } from "@/lib/units";
import type { Cost } from "@/lib/productionCost";
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
/* THE NOTE IS THE ONLY FLEXIBLE COLUMN (Mark, 2026-08-11: "all the columns are
   fixed width it seems, which is fine, but the notes column width should be
   flexible"). Every other column holds something of known size — a number, a
   unit, a checkbox, a glyph — so widening them buys nothing, while a note is
   prose and can always use more. Its `<col>` therefore carries NO width at all:
   under `table-layout: fixed` the one column without one absorbs whatever is
   left over, and this is the MINIMUM the table reserves for it before the whole
   grid starts to scroll instead. */
const W_NOTE_MIN = 120;
const W_HIDE = 48;
const W_TRASH = 40;
/* The trailing "add a batch size" slot — a NARROW AFFORDANCE, not a column
   (Mark, 2026-08-11). It was a full 72px column slot, on the reasoning that it
   becomes one; but it is a column-sized hole in every row of the grid for
   something you press a handful of times in a recipe's life, and on a
   five-column version it was the sixth column's worth of width that pushed the
   table past the window.

   Pressing it CREATES the column with a name you then edit in place, rather
   than being an editor itself: an input in a 28px cell is not an input. Naming
   it is one tap later, in the real column, where there is room — and clearing
   that name removes the column again, because `scaleColumns` drops an
   unlabelled slot. So a mis-tap is one gesture from undone. */
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
    W_NOTE_MIN +
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
              {/* No width: the leftover lands here. See W_NOTE_MIN. */}
              <col />
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
                {/* Note · Hide · Trash — the three columns after the scale block, and
                    it MUST equal them. It read 5 against four trailing columns
                    until 2026-08-11 and nothing showed, because every column
                    was a fixed width and the two phantom ones simply took
                    slack off the end. The moment Note became the flexible
                    column, Note was what paid for them: 46px instead of 138.
                    A header row that over-spans invents columns. */}
                <th colSpan={3} />
              </tr>

              {/* THE BATCH NAMES ARE COLUMN TITLES (Mark, 2026-08-11: "can the
                  batch names be on the same horizontal plane as the column
                  titles?"). They were a row of their own between the
                  multipliers and Sort/Item/Auto/Note/Hide — three header rows
                  where two will do, and the names sitting a line above the
                  headings they are peers of. They ARE headings: "X2.5" names
                  its column exactly the way "Note" names its own.

                  So this row carries both, and every column is now labelled in
                  one place. It also gives the list back a row of height, which
                  is the point of the tab split above.

                  STACKED STICKY OFFSETS: two rows now, not three. 26px is the
                  multiplier row's own height (12px text over `pb-1`), measured
                  — and stable, because that row is fixed type at fixed
                  padding. */}
              <tr className="text-[11px] uppercase tracking-[0.12em] text-ink [&>th]:sticky [&>th]:top-[26px] [&>th]:z-20 [&>th]:border-b-2 [&>th]:border-ink [&>th]:bg-white">
                <th className="px-2 py-2 text-left">Sort</th>
                <th className="px-3 py-2 text-left">Item</th>
                {/* The base column, then the AUTO column's own cell, then the
                    rest — the switch sits BETWEEN the first two amount columns,
                    which is what it governs, so the row has to step over it. */}
                <ScaleLabelCell
                  version={version}
                  column={headerSlots[0] ?? null}
                  index={headerSlots[0]?.index ?? spare ?? 0}
                  width={width}
                  editable={editable}
                />
                <th className="px-2 py-2 text-center">Auto</th>
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
                <th className="px-3 py-2 text-left">Note</th>
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
                    <ItemCell line={line} editable={editable} options={elementOptions} />
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
            placeholder="Choose an element…"
            options={elementOptions}
          />
        ) : null}
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
      ) : null}

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
  // The spare slot is 28px of affordance, not a column. See W_SPARE.
  if (!column) {
    return editable ? (
      <th className="px-0 py-2 text-center">
        <AddScaleColumn version={version} index={index} width={width} />
      </th>
    ) : (
      <th />
    );
  }

  return (
    <th className="px-2 py-2 text-left">
      {editable ? (
        <InlineValue
          table="production_recipe_versions"
          id={version.id}
          column="scale_labels"
          value={column.label}
          placeholder="—"
          className="font-semibold uppercase tracking-[0.06em]"
          arrayColumn="scale_labels"
          arrayIndex={index}
          arrayStrip={version.scale_labels}
          arrayWidth={Math.max(width, index + 1)}
        />
      ) : (
        <span className={`${READ_ONLY_VALUE} font-semibold uppercase tracking-[0.06em]`}>
          {column.label}
        </span>
      )}
    </th>
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
