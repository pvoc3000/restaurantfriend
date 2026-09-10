"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import type { PickOption } from "@/components/ui/PickList";
import { BATCH_STATUS_LABEL, BATCH_STATUS_OPTIONS, describeAmount } from "@/lib/productionBatches";
import { BatchPhoto } from "@/components/production/BatchPhoto";
import { BatchVersionCell } from "@/components/production/BatchVersionCell";

/** Everything the editable pane needs about one batch. */
export type BatchFieldsRow = {
  id: string;
  batch_number: string;
  element_name: string;
  element_id: string | null;
  batch_label: string | null;
  status: string;
  operator_employee_id: string | null;
  recipe_version_id: string | null;
  recipe_version_label: string | null;
  /**
   * The element's MASTER version, for the Recipe tab to fall back to.
   *
   * A fallback and never a substitute: a batch that names a version is read
   * against THAT one, because making the master current must not rewrite what
   * last month's batch says it followed. Only a batch with no version at all —
   * anything logged by hand — borrows the master.
   */
  masterVersionId: string | null;
  scale_label: string | null;
  batch_amount: number | null;
  batch_unit: string | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
  on_hand_count: number | null;
  on_hand_size: number | null;
  on_hand_unit: string | null;
  yield_count: number | null;
  yield_size: number | null;
  yield_unit: string | null;
  notes: string | null;
  photo_path: string | null;
  photo_name: string | null;
  photoUrl: string | null;
  generated: boolean;
  /** From FileMaker (046) — see `BatchRow.migrated`. */
  migrated: boolean;
};

/**
 * One batch's editable fields — FileMaker's INFO tab.
 *
 * It has ONE home — the detail pane pinned under the batch log — and is its own
 * component anyway, because the pane is already carrying a table, a header and
 * two commands, and a hundred lines of `dl` inside it would bury all four.
 *
 * Laid out the way FileMaker lays it out, because the shape carries meaning:
 * what the round ASKED for and what the kitchen KEEPS sit above what was
 * actually there and what came out, so the two measurements read against the
 * two claims rather than against each other.
 *
 * TWO BY TWO since 2026-09-09 (Mark): identity fields | the four amounts, then
 * notes | photograph. It was FMP's three columns — fields, photo over notes,
 * the element's HISTORY — until the history got a tab of its own in the pane
 * and the amounts got a column back.
 */
export function BatchFields({
  row,
  orgId,
  operators,
  versions,
  editable,
  fill = false,
  scaleLabels = [],
}: {
  row: BatchFieldsRow;
  orgId: string;
  operators: PickOption[];
  /** The element's own recipe versions. Empty when it has none. */
  versions: PickOption[];
  editable: boolean;
  /**
   * Take the pane's height and let each COLUMN scroll itself, rather than
   * sitting at content height inside one scroller.
   *
   * Only above `lg`, where the pane is pinned and has a definite height to
   * divide. Stacked, the three columns are one on top of another and the tab
   * scrolls as a whole — giving them a share of a height there would hand an
   * iPad three ~150px boxes inside a scrolling page.
   */
  fill?: boolean;
  /** The batch sizes the batch's recipe version has — the Scale picker's
   *  options. `allowNew` on top, since a size typed by hand is a real answer. */
  scaleLabels?: string[];
}) {
  return (
    // TWO BY TWO (Mark, 2026-09-09): what the batch IS on the left — status,
    // number, order, who made it, which recipe — and the four AMOUNTS on the
    // right, with the notes under the first and the photograph under the
    // second. Two `dl`s rather than one four-track grid, so a long name in one
    // column cannot push the other's rows out of step. `sm`, not `lg`: a
    // portrait iPad is a tablet too and has the width for two columns.
    //
    // The history had a third track here until it got its own tab
    // (2026-09-09); `fill` is kept for the desk's per-column scrolling.
    <div
      className={`grid gap-x-8 gap-y-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] ${
        fill ? "min-h-0 flex-1" : ""
      }`}
    >
      <dl
        className={`flex flex-col gap-3 text-sm ${
          fill ? "min-h-0 overflow-y-auto pr-1" : ""
        }`}
      >
        <Field label="Status">
          {editable ? (
            // Uppercase on the CONTROL — a wrapper's `text-transform` never
            // reaches a button (the reset sets it to none).
            <InlineValue
              boxed={BOXED_FIELDS} table="production_batches" id={row.id} column="status" kind="pick"
              nullable={false} options={BATCH_STATUS_OPTIONS}
              value={row.status} className="uppercase" ariaLabel="Batch status"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} uppercase`}>
              {BATCH_STATUS_LABEL[row.status as keyof typeof BATCH_STATUS_LABEL] ?? row.status}
            </span>
          )}
        </Field>

        <Field label="Batch">
          {/* The number is the batch's IDENTITY — 044 mints it from a sequence
              and it is unique per org. Read-only for the reason a PO number is:
              editing it would make the record claim to be a different one. */}
          <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
            {row.batch_number}
            {row.generated || row.migrated ? "" : " · by hand"}
          </span>
        </Field>

        <Field label="Order">
          {editable ? (
            <InlineValue
              boxed={BOXED_FIELDS} table="production_batches" id={row.id} column="batch_label"
              value={row.batch_label} ariaLabel="Which batch of the day"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>{row.batch_label ?? "—"}</span>
          )}
        </Field>

        <Field label="Prepared by">
          {editable ? (
            <InlineValue
              boxed={BOXED_FIELDS} table="production_batches" id={row.id} column="operator_employee_id" kind="pick"
              options={operators} value={row.operator_employee_id}
              ariaLabel="Who made this batch"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {operators.find((o) => o.value === row.operator_employee_id)?.label ?? "—"}
            </span>
          )}
        </Field>

        {/* VERSION AND SCALE ON ONE LINE (Mark, 2026-09-09: "It should be
            specified what size batch was made. Display it in line with recipe
            version") — FileMaker's own row. The scale is `scale_label`, which
            044 created and nothing had ever written; its options are the
            version's own batch sizes, with a typed size allowed. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recipe version">
            {editable && versions.length > 0 ? (
              <BatchVersionCell
                boxed={BOXED_FIELDS}
                batchId={row.id}
                value={row.recipe_version_id}
                options={versions}
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} text-muted`}>
                {row.recipe_version_label ?? "—"}
              </span>
            )}
          </Field>
          <Field label="Scale">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS} table="production_batches" id={row.id} column="scale_label" kind="pick"
                allowNew options={scaleLabels.map((l) => ({ value: l, label: l }))}
                value={row.scale_label} ariaLabel="Which batch size was made"
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} text-muted`}>{row.scale_label ?? "—"}</span>
            )}
          </Field>
        </div>
      </dl>

      <dl
        className={`flex flex-col gap-3 text-sm ${
          fill ? "min-h-0 overflow-y-auto pr-1" : ""
        }`}
      >
        <Field label="Asked for">
          <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
            {describeAmount(row.batch_amount, null, row.batch_unit)}
          </span>
        </Field>
        <Field label="Par">
          <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
            {describeAmount(row.par_count, row.par_size, row.par_unit)}
          </span>
        </Field>
        <Field label="On hand before">
          <Triple row={row} prefix="on_hand" editable={editable} />
        </Field>
        <Field label="Made">
          <Triple row={row} prefix="yield" editable={editable} />
        </Field>
      </dl>

      <dl className="text-sm">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Notes
          </dt>
          <dd className="mt-0.5">
            {editable ? (
              <InlineValue
                boxed={BOXED_FIELDS} table="production_batches" id={row.id} column="notes" multiline
                value={row.notes} ariaLabel="Notes on this batch"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-muted">{row.notes ?? "—"}</p>
            )}
          </dd>
      </dl>

      <div className={fill ? "min-h-0 overflow-y-auto pr-1" : ""}>
        <BatchPhoto
          batchId={row.id}
          orgId={orgId}
          url={row.photoUrl}
          path={row.photo_path}
          name={row.photo_name}
          editable={editable}
        />
      </div>
    </div>
  );
}

/**
 * A count × size unit trio.
 *
 * Three cells because that is what the amount IS — "3 × 1.5 gal" — which is
 * exactly how FileMaker's own detail lays it out (# CONTAINERS × AMOUNT IN
 * CONTAINER), and only the pair can be multiplied. The LIST states the same
 * amount on one line and read-only; editing lives here and nowhere else.
 */
function Triple({
  row,
  prefix,
  editable,
}: {
  row: BatchFieldsRow;
  prefix: "on_hand" | "yield";
  editable: boolean;
}) {
  const count = prefix === "on_hand" ? row.on_hand_count : row.yield_count;
  const size = prefix === "on_hand" ? row.on_hand_size : row.yield_size;
  const unit = prefix === "on_hand" ? row.on_hand_unit : row.yield_unit;
  const what = prefix === "on_hand" ? "On hand" : "Made";

  if (!editable) {
    return (
      <span className={`${READ_ONLY_VALUE} tabular-nums`}>
        {describeAmount(count, size, unit)}
      </span>
    );
  }
  return (
    // NO WRAP: a count, an × and a size are one reading, and broken over three
    // lines they read as three empty fields.
    // Each cell is WIDTH-BOXED: a boxed field is `w-full`, and three of them
    // in a shrink-to-fit row have nothing to resolve that against, so they
    // would either squash to ragged widths or wrap one per line. `items-center`
    // rather than `items-baseline` — boxes line up by their edges.
    <span className="flex items-center gap-1">
      <span className="block w-14 shrink-0">
        <InlineValue
          boxed={BOXED_FIELDS}
          table="production_batches" id={row.id} column={`${prefix}_count`} kind="number"
          value={count} ariaLabel={`${what} count`}
        />
      </span>
      <span className="shrink-0 text-subtle">×</span>
      <span className="block w-16 shrink-0">
        <InlineValue
          boxed={BOXED_FIELDS}
          table="production_batches" id={row.id} column={`${prefix}_size`} kind="number"
          value={size} ariaLabel={`${what} size`}
        />
      </span>
      <span className="block w-16 shrink-0">
        <InlineValue
          boxed={BOXED_FIELDS}
          table="production_batches" id={row.id} column={`${prefix}_unit`}
          value={unit} ariaLabel={`${what} unit`}
        />
      </span>
    </span>
  );
}

/**
 * A LABEL BESIDE ITS VALUE, not over it — FileMaker's own arrangement, and here
 * it is load-bearing rather than cosmetic.
 *
 * Stacked in two columns, each field got ~145px, which is narrower than a
 * `Triple` — so "3 × 1.5 gal" wrapped to three lines and the two amounts that
 * matter most read as six stray em dashes. Beside its label each field has the
 * column's full width, the pane is ten short rows instead of five tall ones,
 * and it fits the fixed height without scrolling.
 */
/**
 * LABEL OVER FIELD (Mark, 2026-09-09: "try putting the label above the fields
 * on the info tab"), the way the Notes block has always been set. Two tracks —
 * label beside value — spent 7.5rem of every row on a word, which in a pane
 * split into two columns left the value ~200px; stacked, the value has the
 * whole column and the label costs a 14px line.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0">{children}</dd>
    </div>
  );
}
