import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { batchDate } from "@/lib/productionBatches";
import { BatchItemsTable, type BatchRow } from "@/components/production/BatchItemsTable";
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
          `id, log_id, batch_number, element_id, location_id, is_generated,
           batch_label, sort, status, operator_employee_id, created_by,
           recipe_version_label, batch_amount, batch_unit,
           par_count, par_size, par_unit,
           on_hand_count, on_hand_size, on_hand_unit,
           yield_count, yield_size, yield_unit, notes, photo_path,
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
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const kitchenCode = codeById.get(log.location_id as string) ?? "—";
  const logDate = log.log_date as string;

  const rows: BatchRow[] = (batches ?? []).map((b) => {
    const element = b.production_elements as unknown as
      | { name: string; element_type: string | null }
      | null;
    return {
      id: b.id as string,
      logDate,
      logStatus: (log.status ?? "open") as string,
      batch_number: b.batch_number as string,
      element_name: element?.name ?? "—",
      element_type: element?.element_type ?? null,
      kitchenCode: codeById.get(b.location_id as string) ?? "—",
      batch_label: (b.batch_label ?? null) as string | null,
      sort: (b.sort ?? null) as number | null,
      status: (b.status ?? "to_do") as string,
      operatorName: b.operator_employee_id
        ? nameById.get(b.operator_employee_id as string) ?? null
        : null,
      createdByName: b.created_by ? memberById.get(b.created_by as string) ?? null : null,
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

  const done = rows.filter((r) => r.status === "complete" || r.status === "skipped").length;
  const generatedByName = log.generated_by
    ? memberById.get(log.generated_by as string) ?? null
    : null;

  const trail = parseTrail(rawParams, { href: "/batch-logs", label: "Batch Logs" });

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={`${batchDate(logDate)} · ${kitchenCode}`}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <header className="space-y-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {kitchenCode} — {batchDate(logDate)}
        </h1>
        <p className="text-sm text-muted">
          {rows.length === 0
            ? "Nothing on this log yet"
            : `${done} of ${rows.length} done`}
          {generatedByName ? ` · generated by ${generatedByName}` : ""}
        </p>
      </header>

      <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status">
          <span className={READ_ONLY_VALUE}>
            {log.status === "complete" ? "Complete" : "Open"}
          </span>
        </Field>
        <Field label="Generated">
          <span className={`${READ_ONLY_VALUE} text-muted`}>
            {log.generated_at ? String(log.generated_at).slice(0, 10) : "—"}
          </span>
        </Field>
        <Field label="Printed">
          {log.printed_at ? (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {String(log.printed_at).slice(0, 10)}
            </span>
          ) : (
            <span className={`${READ_ONLY_VALUE} text-mark`}>not printed</span>
          )}
        </Field>
        <Field label="Note">
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
        </Field>
      </dl>

      <BatchLogActions
        logId={id}
        status={(log.status ?? "open") as string}
        logDate={logDate}
        kitchenCode={kitchenCode}
        batches={rows.length}
        outstanding={rows.length - done}
        editable={editable}
      />

      {itemErr ? (
        // Not folded into the page's own error: a failed item read must not
        // blank a readable log. It isn't swallowed either — an empty table
        // asserts a log with nothing on it, which is a real claim.
        <p className="text-sm text-accent">
          The batches could not be read: {itemErr.message}
        </p>
      ) : (
        <BatchItemsTable
          rows={rows}
          editable={editable}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
