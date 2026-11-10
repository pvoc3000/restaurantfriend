// The batch log as a sheet of paper — Preview Batch Log… (Mark, 2026-11-09).
//
// Staff print a log, walk the kitchen with it, and write On hand and Made in by
// hand. So the sheet carries what the screen knows BEFORE the work (each
// batch's element and its par) and leaves boxes for the two figures the work
// produces.
//
// THE ORDER IS THE SCREEN'S DEFAULT ONE, so the paper and the list a person
// later types it into walk the same way: banded by element type (an untyped
// batch last, as "No type"), then by element name, then by the schedule's own
// sort and the batch label — `BatchItemsTable`'s comparator with its default
// grouping ("type") and sort ("element", ascending). It does NOT follow a
// reader's remembered grouping: the list's ⋯ has no table of batches to read
// one from, and two routes to one document should print the same page.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describeAmount } from "./productionBatches";
import { scheduleLabel } from "./production";

/** One batch, as the sheet needs it. */
export type BatchSheetLine = {
  id: string;
  element_name: string;
  element_type: string | null;
  batch_label: string | null;
  sort: number | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
};

/** A run of lines under one element-type band. */
export type BatchSheetGroup = { type: string; lines: BatchSheetLine[] };

export type BatchSheetData = {
  orgName: string;
  kitchenCode: string;
  logDate: string;
  /** The schedule's label ("Donut"), or null for a FileMaker log, which has none. */
  schedule: string | null;
  note: string | null;
  /** The org's calendar day the sheet was made, for the masthead. */
  printedOn: string;
  groups: BatchSheetGroup[];
};

/** The band an untyped batch falls under — the Type picker's own words. */
export const NO_TYPE = "No type";

/**
 * The lines in the screen's default order, cut into element-type bands.
 *
 * Pure, so the fixtures can hold it to the screen's rules: an untyped batch
 * sinks LAST rather than sorting first under the empty string, and two batches
 * of one element keep the schedule's order (numbered batches first) before
 * falling back to their labels.
 */
export function batchSheetGroups(lines: BatchSheetLine[]): BatchSheetGroup[] {
  const typeKey = (l: BatchSheetLine) => l.element_type ?? "￿";
  const sorted = [...lines].sort((a, b) => {
    const at = typeKey(a), bt = typeKey(b);
    if (at !== bt) return at < bt ? -1 : 1;
    if (a.element_name !== b.element_name) return a.element_name < b.element_name ? -1 : 1;
    const as = a.sort ?? Number.MAX_SAFE_INTEGER;
    const bs = b.sort ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    const al = a.batch_label ?? "", bl = b.batch_label ?? "";
    return al < bl ? -1 : al > bl ? 1 : 0;
  });
  const groups: BatchSheetGroup[] = [];
  for (const line of sorted) {
    const type = line.element_type ?? NO_TYPE;
    const last = groups[groups.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else groups.push({ type, lines: [line] });
  }
  return groups;
}

/** "Glaze — Chocolate": the element, and the batch's own label when it has one. */
export function batchSheetName(line: BatchSheetLine): string {
  const label = line.batch_label?.trim();
  return label ? `${line.element_name} — ${label}` : line.element_name;
}

/** The par as the screen states it, or an empty string where none was set —
 *  an em dash in a column of figures somebody is copying reads as a value. */
export function batchSheetPar(line: BatchSheetLine): string {
  const text = describeAmount(line.par_count, line.par_size, line.par_unit);
  return text === "—" ? "" : text;
}

/**
 * Everything the sheet prints, fetched at the click — the list's ⋯ has only
 * the log's id in hand, and the detail page's rows carry the screen's own
 * filters, so both routes read the log fresh and print the same page.
 *
 * `printedOn` comes from the CALLER, who knows the org's day; a client
 * `toISOString()` is UTC and dates an evening print to tomorrow.
 */
export async function fetchBatchSheet(
  supabase: SupabaseClient,
  logId: string,
  printedOn: string
): Promise<BatchSheetData> {
  const [logResult, batchResult, orgResult] = await Promise.all([
    supabase
      .from("production_batch_logs")
      .select("id, log_date, schedule, note, locations ( code )")
      .eq("id", logId)
      .maybeSingle(),
    supabase
      .from("production_batches")
      .select(
        `id, batch_label, sort, par_count, par_size, par_unit,
         production_elements ( name, element_type )`
      )
      .eq("log_id", logId),
    supabase.from("orgs").select("name").limit(1).maybeSingle(),
  ]);
  if (logResult.error) throw new Error(logResult.error.message);
  if (!logResult.data) throw new Error("This batch log could not be found.");
  if (batchResult.error) throw new Error(batchResult.error.message);

  const log = logResult.data;
  const location = log.locations as unknown as { code: string } | null;
  const lines: BatchSheetLine[] = (batchResult.data ?? []).map((b) => {
    const element = b.production_elements as unknown as
      | { name: string; element_type: string | null }
      | null;
    return {
      id: b.id as string,
      element_name: element?.name ?? "—",
      element_type: element?.element_type ?? null,
      batch_label: (b.batch_label ?? null) as string | null,
      sort: num(b.sort),
      par_count: num(b.par_count),
      par_size: num(b.par_size),
      par_unit: (b.par_unit ?? null) as string | null,
    };
  });

  return {
    orgName: ((orgResult.data?.name as string | undefined) ?? "").trim(),
    kitchenCode: location?.code ?? "—",
    logDate: log.log_date as string,
    schedule: log.schedule ? scheduleLabel(log.schedule as string) : null,
    note: ((log.note as string | null) ?? "").trim() || null,
    printedOn,
    groups: batchSheetGroups(lines),
  };
}

/** The file a preview falls back to downloading as: "2026-11-09 DF01 batch log.pdf". */
export function batchSheetFileName(data: Pick<BatchSheetData, "logDate" | "kitchenCode">): string {
  return `${data.logDate} ${data.kitchenCode} batch log.pdf`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
