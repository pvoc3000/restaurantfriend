import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch, canWriteCatalog } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { batchDate } from "@/lib/productionBatches";
import { type BatchRow } from "@/components/production/BatchItemsTable";
import { BatchLogItems } from "@/components/production/BatchLogItems";
import { type BatchFieldsRow } from "@/components/production/BatchFields";
import { BATCH_PHOTO_BUCKET, BATCH_PHOTO_TTL_SECONDS } from "@/lib/batchPhotos";
import { BatchLogActions } from "@/components/production/BatchLogActions";
import { NewBatch } from "@/components/production/NewBatch";

/**
 * One batch log — the MASTER record, and its batches.
 *
 * Mark, 2026-08-09: "a batch log record is really just a date the log was
 * generated, who generated it, what the status is … basically a way to
 * associate batch logs together." So the header is four facts and the screen is
 * mostly the items, which is what somebody actually works.
 *
 * The items table is the same component the flat list used, because it IS the
 * same table — it simply arrives scoped to one log now.
 */
export async function BatchLogRecord({
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

  const { data: log, error } = await supabase
    .from("production_batch_logs")
    .select(
      `id, org_id, location_id, log_date, status, note,
       generated_by, generated_at, printed_by, printed_at`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this batch log: {error.message}
        {/production_batch_logs/.test(error.message)
          ? " — migration 045 has not been applied yet."
          : ""}
      </p>
    );
  }
  if (!log) notFound();

  const [{ data: batches, error: itemErr }, { data: employees }, { data: members }] =
    await Promise.all([
      supabase
        .from("production_batches")
        .select(
          `id, log_id, element_id, is_generated, batch_number,
           batch_label, sort, status, operator_employee_id,
           recipe_version_id, recipe_version_label, scale_label,
           batch_amount, batch_unit,
           par_count, par_size, par_unit,
           on_hand_count, on_hand_size, on_hand_unit,
           yield_count, yield_size, yield_unit, notes, photo_path, photo_name,
           production_elements ( name, element_type )`
        )
        .eq("log_id", id),
      // 044's definer — `employees` READ is owner/admin only (020), so this is
      // the only way a supervisor can name who made something.
      supabase.rpc("production_operators", { p_location_id: log.location_id as string }),
      supabase.from("org_members").select("user_id, display_name"),
    ]);

  const nameById = new Map(
    ((employees ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name])
  );
  const memberById = new Map(
    (members ?? []).map((m) => [m.user_id as string, (m.display_name ?? null) as string | null])
  );
  const operatorOptions = ((employees ?? []) as { id: string; name: string }[]).map((o) => ({
    value: o.id,
    label: o.name,
  }));
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const kitchenCode = codeById.get(log.location_id as string) ?? "—";
  const logDate = log.log_date as string;

  // Every photo signed in ONE round trip, not one per batch — `createSignedUrls`
  // is plural for exactly this, and a URL built to expire must not outlive the
  // page (018's rule).
  const photoPaths = (batches ?? [])
    .map((b) => b.photo_path as string | null)
    .filter((p): p is string => p !== null);
  const signedByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BATCH_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, BATCH_PHOTO_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }

  // The element's own recipe versions, for the pane's picker. One query for the
  // whole log rather than one per batch.
  const elementIds = [
    ...new Set((batches ?? []).map((b) => b.element_id as string).filter(Boolean)),
  ];
  const { data: versionRows } = elementIds.length
    ? await supabase
        .from("production_recipe_versions")
        .select("id, version_label, is_master, production_recipes!inner(element_id)")
        .in("production_recipes.element_id", elementIds)
        .order("version_sort", { nullsFirst: false })
    : { data: [] };

  const versionsByElement: Record<string, { value: string; label: string; hint?: string }[]> = {};
  for (const v of (versionRows ?? []) as unknown as {
    id: string;
    version_label: string;
    is_master: boolean;
    production_recipes: { element_id: string };
  }[]) {
    const key = v.production_recipes.element_id;
    (versionsByElement[key] ??= []).push({
      value: v.id,
      label: v.version_label,
      hint: v.is_master ? "master" : undefined,
    });
  }

  const fields: Record<string, BatchFieldsRow> = {};

  const rows: BatchRow[] = (batches ?? []).map((b) => {
    const element = b.production_elements as unknown as
      | { name: string; element_type: string | null }
      | null;
    return {
      id: b.id as string,
      element_name: element?.name ?? "—",
      element_type: element?.element_type ?? null,
      operatorName: b.operator_employee_id
        ? nameById.get(b.operator_employee_id as string) ?? null
        : null,
      batch_label: (b.batch_label ?? null) as string | null,
      sort: (b.sort ?? null) as number | null,
      status: (b.status ?? "to_do") as string,
      recipe_version_label: (b.recipe_version_label ?? null) as string | null,
      batch_amount: num(b.batch_amount),
      batch_unit: (b.batch_unit ?? null) as string | null,
      par_count: num(b.par_count),
      par_size: num(b.par_size),
      par_unit: (b.par_unit ?? null) as string | null,
      on_hand_count: num(b.on_hand_count),
      on_hand_size: num(b.on_hand_size),
      on_hand_unit: (b.on_hand_unit ?? null) as string | null,
      yield_count: num(b.yield_count),
      yield_size: num(b.yield_size),
      yield_unit: (b.yield_unit ?? null) as string | null,
      generated: (b.is_generated ?? false) as boolean,
      notes: (b.notes ?? null) as string | null,
      hasPhoto: b.photo_path !== null,
    };
  });

  for (const b of batches ?? []) {
    const element = b.production_elements as unknown as { name: string } | null;
    const path = (b.photo_path ?? null) as string | null;
    fields[b.id as string] = {
      id: b.id as string,
      batch_number: b.batch_number as string,
      element_name: element?.name ?? "—",
      element_id: (b.element_id ?? null) as string | null,
      batch_label: (b.batch_label ?? null) as string | null,
      status: (b.status ?? "to_do") as string,
      operator_employee_id: (b.operator_employee_id ?? null) as string | null,
      recipe_version_id: (b.recipe_version_id ?? null) as string | null,
      recipe_version_label: (b.recipe_version_label ?? null) as string | null,
      scale_label: (b.scale_label ?? null) as string | null,
      batch_amount: num(b.batch_amount),
      batch_unit: (b.batch_unit ?? null) as string | null,
      par_count: num(b.par_count),
      par_size: num(b.par_size),
      par_unit: (b.par_unit ?? null) as string | null,
      on_hand_count: num(b.on_hand_count),
      on_hand_size: num(b.on_hand_size),
      on_hand_unit: (b.on_hand_unit ?? null) as string | null,
      yield_count: num(b.yield_count),
      yield_size: num(b.yield_size),
      yield_unit: (b.yield_unit ?? null) as string | null,
      notes: (b.notes ?? null) as string | null,
      photo_path: path,
      photo_name: (b.photo_name ?? null) as string | null,
      photoUrl: path ? signedByPath.get(path) ?? null : null,
      generated: (b.is_generated ?? false) as boolean,
    };
  }

  const done = rows.filter((r) => r.status === "complete" || r.status === "skipped").length;
  const generatedByName = log.generated_by
    ? memberById.get(log.generated_by as string) ?? null
    : null;

  const trail = parseTrail(rawParams, { href: "/batch-logs", label: "Batch Logs" });

  return (
    <div className="space-y-4">
      <Breadcrumbs
        trail={trail}
        current={`${batchDate(logDate)} · ${kitchenCode}`}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <header className="flex flex-wrap items-baseline gap-x-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {kitchenCode} — {batchDate(logDate)}
        </h1>
        <p className="text-sm text-muted">
          {rows.length === 0 ? "Nothing on this log yet" : `${done} of ${rows.length} done`}
        </p>
      </header>

      {/* ONE STRIP, not a field grid plus an action row.
          The pane below is pinned to the window, so every pixel above it comes
          out of the table: the first cut spent 441px on chrome and left 279 for
          the list and the detail together, which is under the frame's own floor
          — so nothing pinned at all and the page scrolled. The log has four
          facts and two commands; they fit on a line. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-hairline py-2 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          {log.status === "complete" ? "Complete" : "Open"}
        </span>
        <span className="text-muted">
          Generated {log.generated_at ? String(log.generated_at).slice(0, 10) : "—"}
          {generatedByName ? ` by ${generatedByName}` : ""}
        </span>
        {log.printed_at ? (
          <span className="text-muted">Printed {String(log.printed_at).slice(0, 10)}</span>
        ) : (
          <span className="text-mark">not printed</span>
        )}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Note
          </span>
          {editable ? (
            <InlineValue
              table="production_batch_logs"
              id={id}
              column="note"
              value={(log.note ?? null) as string | null}
              ariaLabel="Note on this batch log"
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>{log.note ?? "—"}</span>
          )}
        </span>

        <span className="ml-auto">
          <BatchLogActions
            logId={id}
            status={(log.status ?? "open") as string}
            logDate={logDate}
            kitchenCode={kitchenCode}
            batches={rows.length}
            outstanding={rows.length - done}
            editable={editable}
          />
        </span>
      </div>

      {itemErr ? (
        // Not folded into the page's own error: a failed item read must not
        // blank a readable log. It isn't swallowed either — an empty table
        // asserts a log with nothing on it, which is a real claim.
        <p className="text-sm text-accent">
          The batches could not be read: {itemErr.message}
        </p>
      ) : (
        <BatchLogItems
          rows={rows}
          fields={fields}
          orgId={session.membership.org_id}
          operators={operatorOptions}
          versionsByElement={versionsByElement}
          locationId={log.location_id as string}
          editable={editable}
          removable={removable}
          add={
            editable ? (
              <NewBatch
                orgId={session.membership.org_id}
                logId={id}
                locationId={log.location_id as string}
                locationCode={kitchenCode}
                logDate={logDate}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
