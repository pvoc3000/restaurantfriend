import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { addDays } from "@/lib/productionBatches";
import { BatchLogsIndex, type BatchLogRow } from "@/components/production/BatchLogsIndex";
import { GenerateBatches } from "@/components/production/GenerateBatches";

/**
 * The batch logs — the MASTER records, one per kitchen per day.
 *
 * A LOG is the document — a date, who generated it, a status — and a BATCH is
 * its item: one making of an element. Migrations 044 and 045.
 *
 * The round has no days in it (Mark, 2026-08-09): the staff have a couple of
 * days and choose the order, so a log carries the date it was generated and its
 * items carry no date at all.
 *
 * SCOPED TO THE WORKING KITCHEN, which is the OPPOSITE of `/schedules` on
 * purpose. A schedule's kitchen makes FOR several shops, so scoping that list
 * to one shop would hide half of what DF01 is making — but a batch is made AT a
 * kitchen and belongs to it, so the shop you are standing in is the right
 * default (design rule 3).
 */
export default async function BatchLogsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canLogBatch(session.membership.role);
  const today = guideToday(session.orgSettings.timezone ?? serverTimeZone()).date;
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">Pick a location to see its batch logs.</p>;
  }

  // A window rather than the whole history: a log is worked within a few days
  // of being made, and this table grows by a row a day forever.
  const from = addDays(today, -60);
  const to = addDays(today, 21);

  const [{ data: logs, error }, { data: members }] = await Promise.all([
    supabase
      .from("production_batch_logs")
      // One string literal, never a concatenation: Supabase types the result
      // from the select's literal type, and `"a" + "b"` widens to `string`.
      //
      // The items come back as an embed rather than a second query — a log is
      // asked "how far through are you", and that is two numbers, not rows.
      .select(
        `id, log_date, location_id, status, generated_by, generated_at,
         printed_at, note,
         production_batches ( id, status )`
      )
      .eq("location_id", active.id)
      .gte("log_date", from)
      .lte("log_date", to)
      .order("log_date", { ascending: false }),
    supabase.from("org_members").select("user_id, display_name"),
  ]);

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load the batch logs: {error.message}
        {/production_batch_logs/.test(error.message)
          ? " — migration 045 has not been applied yet."
          : ""}
      </p>
    );
  }

  const memberById = new Map(
    (members ?? []).map((m) => [m.user_id as string, (m.display_name ?? null) as string | null])
  );
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: BatchLogRow[] = (logs ?? []).map((l) => {
    const items = (l.production_batches ?? []) as unknown as { status: string }[];
    return {
      id: l.id as string,
      log_date: l.log_date as string,
      kitchenCode: codeById.get(l.location_id as string) ?? "—",
      status: (l.status ?? "open") as string,
      generatedByName: l.generated_by
        ? memberById.get(l.generated_by as string) ?? null
        : null,
      generated_at: (l.generated_at ?? null) as string | null,
      printed_at: (l.printed_at ?? null) as string | null,
      note: (l.note ?? null) as string | null,
      batches: items.length,
      // DONE is complete OR skipped — a batch somebody decided not to make is
      // dealt with, and counting it as outstanding would leave every log
      // permanently unfinished.
      done: items.filter((b) => b.status === "complete" || b.status === "skipped").length,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Batch Logs
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {active.code} · {rows.length} {rows.length === 1 ? "log" : "logs"}
          </p>
        </div>
        {editable ? (
          <GenerateBatches
            locations={session.activeLocations.map((l) => ({
              id: l.id,
              code: l.code,
              name: l.name,
            }))}
            defaultLocationId={active.id}
            today={today}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="max-w-[80ch] text-sm text-muted">
          No batch logs at {active.code}{" "}yet. Generating one turns that
          kitchen&rsquo;s weekly round into a batch to do per element — what
          needs making, in no particular order — and anything off the round is
          logged by hand on the log itself.
        </p>
      ) : (
        <BatchLogsIndex rows={rows} />
      )}
    </div>
  );
}
