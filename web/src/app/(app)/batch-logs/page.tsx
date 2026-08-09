import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { addDays } from "@/lib/productionBatches";
import { BatchLogsList, type BatchRow } from "@/components/production/BatchLogsList";
import { GenerateBatches } from "@/components/production/GenerateBatches";
import { NewBatch } from "@/components/production/NewBatch";

/**
 * The batch log — production brief phase 5, element actuals.
 *
 * One row per making of an element: what the weekly schedule asked for, what
 * came out, who made it. Migration 044.
 *
 * SCOPED TO THE WORKING KITCHEN, and that is the OPPOSITE of `/schedules` on
 * purpose. A schedule's kitchen makes FOR several shops, so scoping that list
 * to one shop would hide half of what DF01 is making — but a batch is made AT a
 * kitchen and belongs to it, so the shop you are standing in is the right
 * default (design rule 3). The list still says which kitchen on every row, and
 * the picker on the location screen is how you look at another one.
 */
export default async function BatchLogsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canLogBatch(session.membership.role);
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">Pick a location to see its batch log.</p>;
  }

  // A fortnight either side. A batch log is worked within its own week, and the
  // window is what keeps this from growing by ~150 rows a week forever.
  const from = addDays(today, -14);
  const to = addDays(today, 21);

  const [{ data: batches, error }, { data: employees }, { data: members }] =
    await Promise.all([
      supabase
        .from("production_batches")
        // One string literal, never a concatenation: Supabase types the result
        // from the select's literal type, and `"a" + "b"` widens to `string`.
        .select(
          `id, log_id, batch_number, element_id, location_id, is_generated,
           batch_label, sort, status, operator_employee_id, created_by,
           recipe_version_label, batch_amount, batch_unit,
           par_count, par_size, par_unit,
           on_hand_count, on_hand_size, on_hand_unit,
           yield_count, yield_size, yield_unit, notes, photo_path,
           production_elements ( name, element_type ),
           production_batch_logs!inner ( log_date, status )`
        )
        .eq("location_id", active.id)
        .gte("production_batch_logs.log_date", from)
        .lte("production_batch_logs.log_date", to),
      // The roster, through 044's definer — `employees` READ is owner/admin only
      // (020), so a supervisor cannot select that table at all. Two columns.
      supabase.rpc("production_operators", { p_location_id: active.id }),
      // Who ENTERED each record, which is a different person from who made it —
      // FileMaker's list carries both and so does this.
      supabase.from("org_members").select("user_id, display_name"),
    ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load the batch log: {error.message}
        {/production_batches/.test(error.message)
          ? " — migration 044 has not been applied yet."
          : ""}
      </p>
    );
  }

  const nameById = new Map(
    ((employees ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name])
  );
  const memberById = new Map(
    (members ?? []).map((m) => [m.user_id as string, (m.display_name ?? null) as string | null])
  );
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: BatchRow[] = (batches ?? []).map((b) => {
    const element = b.production_elements as unknown as
      | { name: string; element_type: string | null }
      | null;
    const log = b.production_batch_logs as unknown as
      | { log_date: string; status: string }
      | null;
    return {
      id: b.id as string,
      // THE DATE COMES FROM THE LOG. There is no date on an item any more —
      // migration 045 moved it up, so "the date the batch log was generated" is
      // structurally true rather than a convention (Mark, 2026-08-09).
      logDate: log?.log_date ?? "",
      logStatus: (log?.status ?? "open") as string,
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
      createdByName: b.created_by
        ? memberById.get(b.created_by as string) ?? null
        : null,
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
      // A row generation produced, rather than one somebody logged by hand.
      // The list marks the hand-logged ones so a number with no round behind it
      // explains itself.
      generated: (b.is_generated ?? false) as boolean,
      notes: (b.notes ?? null) as string | null,
      hasPhoto: b.photo_path !== null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Batch Log
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {active.code} · {rows.length} {rows.length === 1 ? "batch" : "batches"}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <NewBatch
              orgId={session.membership.org_id}
              locationId={active.id}
              locationCode={active.code}
              today={today}
            />
            <GenerateBatches
              locations={session.activeLocations.map((l) => ({
                id: l.id,
                code: l.code,
                name: l.name,
              }))}
              defaultLocationId={active.id}
              today={today}
            />
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="max-w-[80ch] text-sm text-muted">
          Nothing logged at {active.code} in the three weeks either side of{" "}
          {today}. Generating a day turns that kitchen&rsquo;s weekly round into
          one batch to do per element — what needs making, in no particular
          order — and anything off the round is logged by hand.
        </p>
      ) : (
        <BatchLogsList rows={rows} editable={editable} />
      )}
    </div>
  );
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
