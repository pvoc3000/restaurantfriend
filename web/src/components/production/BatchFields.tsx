"use client";

import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
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
};

/**
 * One batch's editable fields — FileMaker's INFO tab.
 *
 * ONE component for two homes: the detail pane pinned under the batch log, and
 * `/batches/[id]` on its own. That is the whole reason it exists as a piece —
 * two field sets over one table drift, and the second one never behaves quite
 * like the first (the `ui/Dialog` story).
 *
 * Laid out the way FileMaker lays it out, because the shape carries meaning:
 * what the round ASKED for and what the kitchen KEEPS sit above what was
 * actually there and what came out, so the two measurements read against the
 * two claims rather than against each other.
 */
export function BatchFields({
  row,
  orgId,
  operators,
  versions,
  editable,
}: {
  row: BatchFieldsRow;
  orgId: string;
  operators: PickOption[];
  /** The element's own recipe versions. Empty when it has none. */
  versions: PickOption[];
  editable: boolean;
}) {
  return (
    <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
      {/* -- what it is ---------------------------------------------------- */}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="Status">
          {editable ? (
            <InlineValue
              table="production_batches" id={row.id} column="status" kind="pick"
              nullable={false} options={BATCH_STATUS_OPTIONS}
              value={row.status} ariaLabel="Batch status"
            />
          ) : (
            <span className={READ_ONLY_VALUE}>
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
            {row.generated ? "" : " · by hand"}
          </span>
        </Field>

        <Field label="Order">
          {editable ? (
            <InlineValue
              table="production_batches" id={row.id} column="batch_label"
              value={row.batch_label} ariaLabel="Which batch of the day"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>{row.batch_label ?? "—"}</span>
          )}
        </Field>

        <Field label="Prepared by">
          {editable ? (
            <InlineValue
              table="production_batches" id={row.id} column="operator_employee_id" kind="pick"
              options={operators} value={row.operator_employee_id}
              ariaLabel="Who made this batch"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {operators.find((o) => o.value === row.operator_employee_id)?.label ?? "—"}
            </span>
          )}
        </Field>

        <Field label="Recipe version">
          {editable && versions.length > 0 ? (
            <BatchVersionCell
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
              table="production_batches" id={row.id} column="scale_label"
              value={row.scale_label} ariaLabel="Which batch size was run"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>{row.scale_label ?? "—"}</span>
          )}
        </Field>
      </dl>

      {/* -- the four amounts ---------------------------------------------- */}
      <dl className="grid gap-x-6 gap-y-3 text-sm">
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

      {/* -- notes and the photograph -------------------------------------- */}
      <div className="space-y-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Notes
          </dt>
          <dd className="mt-0.5">
            {editable ? (
              <InlineValue
                table="production_batches" id={row.id} column="notes" multiline
                value={row.notes} ariaLabel="Notes on this batch"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-muted">{row.notes ?? "—"}</p>
            )}
          </dd>
        </div>
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
    <span className="flex flex-wrap items-baseline gap-1">
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_count`} kind="number"
        value={count} ariaLabel={`${what} count`}
      />
      <span className="text-subtle">×</span>
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_size`} kind="number"
        value={size} ariaLabel={`${what} size`}
      />
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_unit`}
        value={unit} ariaLabel={`${what} unit`}
      />
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
