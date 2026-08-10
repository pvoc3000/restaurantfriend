import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canLogBatch } from "@/lib/roles";
import { guideToday, serverTimeZone } from "@/lib/orderGuide";
import { addDays } from "@/lib/productionBatches";
import { batchLogRangeStart, parseBatchLogRange } from "@/lib/batchLogFilters";
import { BatchLogsIndex, type BatchLogRow } from "@/components/production/BatchLogsIndex";
import { GenerateBatches } from "@/components/production/GenerateBatches";

/** One page of the window, swept until it runs out. See the call site. */
async function fetchLogs(
  supabase: SupabaseClient,
  locationId: string,
  from: string | null,
  to: string
) {
  const PAGE = 1000;
  const out: Record<string, unknown>[] = [];
  for (let start = 0; ; start += PAGE) {
    // One string literal, never a concatenation: Supabase types the result from
    // the select's literal type, and `"a" + "b"` widens to `string`.
    //
    // The items come back as an embed rather than a second query — a log is
    // asked "how far through are you", and that is two numbers, not rows.
    let query = supabase
      .from("production_batch_logs")
      .select(
        `id, log_date, location_id, status, generated_by, generated_at,
         printed_at, note,
         production_batches ( id, status )`
      )
      .eq("location_id", locationId)
      .lte("log_date", to)
      // Ordered, and not only for display: a `.range()` sweep with no ORDER BY
      // returns rows in whatever order Postgres likes, so pages overlap and
      // rows go missing (the timesheets-audit lesson). `id` breaks the tie,
      // because two kitchens can share a date and `log_date` alone is not a
      // total order.
      .order("log_date", { ascending: false })
      .order("id")
      .range(start, start + PAGE - 1);
    if (from) query = query.gte("log_date", from);

    const { data, error } = await query;
    if (error) return { data: null, error };
    out.push(...data);
    if (data.length < PAGE) return { data: out, error: null };
  }
}

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
export default async function BatchLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const range = parseBatchLogRange(rawParams.range);
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canLogBatch(session.membership.role);
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = guideToday(timeZone).date;
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">Pick a location to see its batch logs.</p>;
  }

  // The window's BACK edge is the reader's (lib/batchLogFilters). Its FORWARD
  // edge is not, and stays fixed: generation is allowed to run ahead of time
  // (040's rule), so a log dated next week is real work you must be able to
  // reach — but nothing is ever generated a year out, so there is no window to
  // choose. A range chip that moved both edges would let you hide tomorrow's
  // log by asking for less history, which is two questions on one control.
  const from = batchLogRangeStart(range, timeZone);
  const to = addDays(today, 21);

  const [{ data: logs, error }, { data: members }] = await Promise.all([
    // POSTGREST RETURNS AT MOST 1,000 ROWS AND SAYS NOTHING ABOUT IT, and All
    // time is already 609 rows the day 046 lands. A single select would start
    // silently dropping the oldest kitchen-days somewhere in 2027 — with the
    // list looking complete, which is how this trap always presents.
    fetchLogs(supabase, active.id, from, to),
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
            locationId={active.id}
            locationCode={active.code}
            today={today}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        // TWO DIFFERENT SENTENCES, because they are two different facts. With a
        // window in force an empty list usually means "not in these 90 days",
        // and telling somebody their kitchen has never made anything — over six
        // years of history sitting one chip away — would be plainly false.
        <div className="max-w-[80ch] space-y-3">
          {range === "all" ? (
            <p className="text-sm text-muted">
              No batch logs at {active.code}{" "}yet. Generating one turns that
              kitchen&rsquo;s weekly round into a batch to do per element — what
              needs making, in no particular order — and anything off the round
              is logged by hand on the log itself.
            </p>
          ) : (
            <p className="text-sm text-muted">
              No batch logs at {active.code} in this window.
            </p>
          )}
          <BatchLogsIndex rows={rows} range={range} params={rawParams} />
        </div>
      ) : (
        <BatchLogsIndex rows={rows} range={range} params={rawParams} />
      )}
    </div>
  );
}
