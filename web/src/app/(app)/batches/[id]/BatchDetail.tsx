import { notFound } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch, canWriteCatalog } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_OPTIONS,
  batchDate,
  describeAmount,
  yieldAgainstPar,
} from "@/lib/productionBatches";
import { BATCH_PHOTO_BUCKET, BATCH_PHOTO_TTL_SECONDS } from "@/lib/batchPhotos";
import { BatchPhoto } from "@/components/production/BatchPhoto";
import { BatchActions } from "@/components/production/BatchActions";
import { BatchVersionCell } from "@/components/production/BatchVersionCell";

/**
 * One batch — production brief decision 8, element actuals.
 *
 * The list edits what a baker changes twenty times a shift (status, yield).
 * This is for the three things that cannot live in a 56px row: the PHOTO, the
 * NOTES, and the recipe version and scale it was run at. `/items` against
 * `/items/[id]`, exactly.
 *
 * Four amounts sit on this record and they are four different facts, which the
 * layout says out loud rather than leaving to be inferred:
 *   what the round asked for · what this kitchen keeps on hand ·
 *   what was there before · what came out.
 */
export async function BatchDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canLogBatch(session.membership.role);
  // Deleting a batch is purchaser+ where editing one is supervisor+: correcting
  // a batch is editing it, and erasing the record that one happened is a
  // different act (044's policies).
  const removable = canWriteCatalog(session.membership.role);

  const { data: batch, error } = await supabase
    .from("production_batches")
    .select(
      `id, org_id, element_id, location_id, log_id, is_generated, batch_number,
       batch_label, sort, status, operator_employee_id, created_by,
       recipe_version_id, recipe_version_label, scale_index, scale_label,
       batch_amount, batch_unit, par_count, par_size, par_unit,
       on_hand_count, on_hand_size, on_hand_unit,
       yield_count, yield_size, yield_unit,
       unit_cost, cost_unresolved, costed_at, notes,
       photo_path, photo_name, created_at,
       production_elements ( id, name, element_type, kind ),
       production_batch_logs ( id, log_date, status )`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this batch: {error.message}
        {/production_batches/.test(error.message)
          ? " — migration 044 has not been applied yet."
          : ""}
      </p>
    );
  }
  if (!batch) notFound();

  const element = batch.production_elements as unknown as
    | { id: string; name: string; element_type: string | null; kind: string }
    | null;
  // THE DATE LIVES ON THE LOG since 045 — an item has none of its own, which is
  // what makes "the date the batch log was generated" true by construction.
  const log = batch.production_batch_logs as unknown as
    | { id: string; log_date: string; status: string }
    | null;
  const logDate = log?.log_date ?? "";

  const [{ data: operators }, { data: versions }, signed] = await Promise.all([
    // 044's definer — `employees` READ is owner/admin only (020), so this is
    // the only way a supervisor can name who made something. Two columns.
    supabase.rpc("production_operators", { p_location_id: batch.location_id as string }),
    element
      ? supabase
          .from("production_recipe_versions")
          .select("id, version_label, is_master, production_recipes!inner(element_id)")
          .eq("production_recipes.element_id", element.id)
          .order("version_sort", { nullsFirst: false })
      : Promise.resolve({ data: [] }),
    // Minted SERVER-side and built to expire: a URL that outlives the page is a
    // URL somebody can share by accident.
    batch.photo_path
      ? supabase.storage
          .from(BATCH_PHOTO_BUCKET)
          .createSignedUrl(batch.photo_path as string, BATCH_PHOTO_TTL_SECONDS)
      : Promise.resolve({ data: null }),
  ]);

  const photoUrl = (signed as { data: { signedUrl: string } | null }).data?.signedUrl ?? null;
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const kitchenCode = codeById.get(batch.location_id as string) ?? "—";

  const operatorOptions = ((operators ?? []) as { id: string; name: string }[]).map((o) => ({
    value: o.id,
    label: o.name,
  }));
  const versionOptions = ((versions ?? []) as { id: string; version_label: string; is_master: boolean }[]).map(
    (v) => ({
      value: v.id,
      label: v.version_label,
      hint: v.is_master ? "master" : undefined,
    })
  );

  const amounts = {
    par_count: num(batch.par_count),
    par_size: num(batch.par_size),
    par_unit: (batch.par_unit ?? null) as string | null,
    yield_count: num(batch.yield_count),
    yield_size: num(batch.yield_size),
    yield_unit: (batch.yield_unit ?? null) as string | null,
  };
  const verdict = yieldAgainstPar(amounts);

  const trail = parseTrail(rawParams, { href: "/batch-logs", label: "Batch Logs" });

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={`${element?.name ?? "Batch"} · ${batchDate(logDate)}`}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <header className="space-y-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {element?.name ?? "Batch"}
          {batch.batch_label ? (
            <span className="ml-3 text-muted">#{batch.batch_label}</span>
          ) : null}
        </h1>
        <p className="text-sm text-muted">
          {batchDate(logDate)} · made at{" "}
          <span className="font-medium text-ink">{kitchenCode}</span> · batch{" "}
          <span className="tabular-nums">{batch.batch_number as string}</span>
          {batch.is_generated ? "" : " · logged by hand"}
          {element ? (
            <>
              {" · "}
              <Link href={`/elements/${element.id}`} className="underline underline-offset-[3px]">
                the element
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Status">
          {editable ? (
            <InlineValue
              table="production_batches" id={id} column="status" kind="pick"
              nullable={false} options={BATCH_STATUS_OPTIONS}
              value={batch.status as string} ariaLabel="Batch status"
            />
          ) : (
            <span className={READ_ONLY_VALUE}>
              {BATCH_STATUS_LABEL[batch.status as keyof typeof BATCH_STATUS_LABEL] ??
                (batch.status as string)}
            </span>
          )}
        </Field>

        <Field label="Made by">
          {editable ? (
            <InlineValue
              table="production_batches" id={id} column="operator_employee_id" kind="pick"
              options={operatorOptions}
              value={(batch.operator_employee_id ?? null) as string | null}
              ariaLabel="Who made this batch"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {operatorOptions.find((o) => o.value === batch.operator_employee_id)?.label ?? "—"}
            </span>
          )}
        </Field>

        <Field label="Batch log">
          {/* READ-ONLY, and deliberately: the date is the LOG's, so an editable
              copy here would be a second answer to one question — 016's
              `nextDeliveryDate` trap. Move the batch by moving it to another
              log, not by retyping its date. */}
          <span className={`${READ_ONLY_VALUE} text-muted`}>
            {batchDate(logDate)}
            {log?.status === "complete" ? " · complete" : ""}
          </span>
        </Field>

        <Field label="Recipe version">
          {editable && versionOptions.length > 0 ? (
            // Its own client component, because writing the label alongside the
            // id needs `alsoUpdate` — a FUNCTION, which cannot cross a server
            // component's boundary. See BatchVersionCell.
            <BatchVersionCell
              batchId={id}
              value={(batch.recipe_version_id ?? null) as string | null}
              options={versionOptions}
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {(batch.recipe_version_label ?? "—") as string}
            </span>
          )}
        </Field>

        <Field label="Batch size run">
          {editable ? (
            <InlineValue
              table="production_batches" id={id} column="scale_label"
              value={(batch.scale_label ?? null) as string | null}
              ariaLabel="Which batch size was run"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {(batch.scale_label ?? "—") as string}
            </span>
          )}
        </Field>

        <Field label="Cost">
          {/* Decision 11's carve-out: costing derives live and a DOCUMENT
              snapshots. A null `costed_at` is a legible state — the Cost
              command beside the record writes it — where a zero would be a
              wrong number that looks right. */}
          <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
            {batch.costed_at === null
              ? "not costed"
              : `${Number(batch.cost_unresolved) > 0 ? "at least " : ""}$${Number(
                  batch.unit_cost ?? 0
                ).toFixed(2)}`}
          </span>
        </Field>
      </dl>

      <section className="space-y-3">
        <SectionHeading>The batch</SectionHeading>
        <p className="max-w-[80ch] text-[13px] text-muted">
          Four amounts, and they are four different facts. What the weekly
          round asked for; what this kitchen keeps on hand; what was there
          before you started; and what came out.
        </p>

        <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Asked for">
            <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
              {describeAmount(num(batch.batch_amount), null, batch.batch_unit as string | null)}
            </span>
          </Field>

          <Field label="Par">
            <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
              {describeAmount(amounts.par_count, amounts.par_size, amounts.par_unit)}
            </span>
          </Field>

          <Field label="On hand before">
            <Triple id={id} prefix="on_hand" editable={editable} row={batch} />
          </Field>

          <Field label="Yield">
            <div className="space-y-1">
              <Triple id={id} prefix="yield" editable={editable} row={batch} />
              {verdict !== "unknown" ? (
                <span
                  className={`block text-xs ${verdict === "at" ? "text-muted" : "text-mark"}`}
                >
                  {verdict === "at" ? "at par" : verdict === "over" ? "over par" : "under par"}
                </span>
              ) : null}
            </div>
          </Field>
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <SectionHeading>Notes</SectionHeading>
          {editable ? (
            <InlineValue
              table="production_batches" id={id} column="notes" multiline
              value={(batch.notes ?? null) as string | null} ariaLabel="Notes on this batch"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-muted">
              {(batch.notes ?? "—") as string}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <SectionHeading>Photo</SectionHeading>
          <BatchPhoto
            batchId={id}
            orgId={batch.org_id as string}
            url={photoUrl}
            path={(batch.photo_path ?? null) as string | null}
            name={(batch.photo_name ?? null) as string | null}
            editable={editable}
          />
        </section>
      </div>

      <BatchActions
        batchId={id}
        elementId={element?.id ?? null}
        locationId={batch.location_id as string}
        elementName={element?.name ?? "this element"}
        batchNumber={batch.batch_number as string}
        hasYield={amounts.yield_count !== null || amounts.yield_size !== null}
        photoPath={(batch.photo_path ?? null) as string | null}
        editable={editable}
        removable={removable}
      />
    </div>
  );
}

/** A count × size unit trio, the shape every amount on this record has. */
function Triple({
  id,
  prefix,
  editable,
  row,
}: {
  id: string;
  prefix: "on_hand" | "yield";
  editable: boolean;
  row: Record<string, unknown>;
}) {
  const count = num(row[`${prefix}_count`]);
  const size = num(row[`${prefix}_size`]);
  const unit = (row[`${prefix}_unit`] ?? null) as string | null;

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
        table="production_batches" id={id} column={`${prefix}_count`} kind="number"
        value={count} ariaLabel={`${prefix} count`}
      />
      <span className="text-subtle">×</span>
      <InlineValue
        table="production_batches" id={id} column={`${prefix}_size`} kind="number"
        value={size} ariaLabel={`${prefix} size`}
      />
      <InlineValue
        table="production_batches" id={id} column={`${prefix}_unit`}
        value={unit} ariaLabel={`${prefix} unit`}
      />
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
