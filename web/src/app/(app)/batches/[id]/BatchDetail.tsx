import { notFound } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch, canWriteCatalog } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { batchDate, yieldAgainstPar } from "@/lib/productionBatches";
import { BATCH_PHOTO_BUCKET, BATCH_PHOTO_TTL_SECONDS } from "@/lib/batchPhotos";
import { BatchActions } from "@/components/production/BatchActions";
import { BatchFields } from "@/components/production/BatchFields";

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

      {/* THE SAME FIELDS the batch log's pinned pane renders. One component for
          two homes: two field sets over one table drift, and the second never
          behaves quite like the first. */}
      <BatchFields
        row={{
          id,
          batch_number: batch.batch_number as string,
          element_name: element?.name ?? "—",
          element_id: element?.id ?? null,
          batch_label: (batch.batch_label ?? null) as string | null,
          status: (batch.status ?? "to_do") as string,
          operator_employee_id: (batch.operator_employee_id ?? null) as string | null,
          recipe_version_id: (batch.recipe_version_id ?? null) as string | null,
          recipe_version_label: (batch.recipe_version_label ?? null) as string | null,
          scale_label: (batch.scale_label ?? null) as string | null,
          batch_amount: num(batch.batch_amount),
          batch_unit: (batch.batch_unit ?? null) as string | null,
          par_count: amounts.par_count,
          par_size: amounts.par_size,
          par_unit: amounts.par_unit,
          on_hand_count: num(batch.on_hand_count),
          on_hand_size: num(batch.on_hand_size),
          on_hand_unit: (batch.on_hand_unit ?? null) as string | null,
          yield_count: amounts.yield_count,
          yield_size: amounts.yield_size,
          yield_unit: amounts.yield_unit,
          notes: (batch.notes ?? null) as string | null,
          photo_path: (batch.photo_path ?? null) as string | null,
          photo_name: (batch.photo_name ?? null) as string | null,
          photoUrl,
          generated: (batch.is_generated ?? false) as boolean,
        }}
        orgId={batch.org_id as string}
        operators={operatorOptions}
        versions={versionOptions}
        editable={editable}
      />

      {verdict !== "unknown" ? (
        <p className={`text-sm ${verdict === "at" ? "text-muted" : "text-mark"}`}>
          {verdict === "at"
            ? "This batch made its par."
            : verdict === "over"
              ? "This batch came out over par."
              : "This batch came out under par."}
        </p>
      ) : null}

      <p className="text-sm text-muted">
        {batch.costed_at === null
          ? "Not costed."
          : `Cost ${Number(batch.cost_unresolved) > 0 ? "at least " : ""}$${Number(
              batch.unit_cost ?? 0
            ).toFixed(2)}.`}
      </p>

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

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
