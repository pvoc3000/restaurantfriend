/**
 * The night's packet, assembled from the committed schedules.
 *
 * Client-safe on purpose, exactly like `lib/poProcessing`: the list's selection
 * bar and the schedule record both print, and one implementation means the two
 * can't drift. RLS applies at click time, so this can read nothing its caller
 * couldn't.
 *
 * ---------------------------------------------------------------------------
 * SEVEN DOCUMENTS, ONE DATASET (decision 5)
 *
 * FMP ran seven generator dialogs a night — the Skip/Continue gauntlet — each
 * producing its own stored artifact. Only ONE of those is a record: the premade
 * schedule, at item grain. The three tray guides and the three element sheets
 * carry no information of their own; they are the same lines re-cut, so they
 * are computed here at print time and never stored.
 *
 * That is also what makes "including special orders" true BY CONSTRUCTION
 * rather than by a flag: a kitchen's guides sum every schedule live in that
 * kitchen that night, whatever produced it.
 *
 * A FIXED number of queries regardless of how many nights are selected —
 * `fetchPoDocData`'s discipline, and the reason a fortnight's reprint costs the
 * same as one day's.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  elementDemand,
  type ElementDemand,
  type ItemDemandSource,
  type ScheduleLine,
} from "./productionSchedule";
import type { CostElement, CostLine } from "./productionCost";

export type PacketSchedule = {
  id: string;
  date: string;
  sellsCode: string;
  kitchenCode: string;
  source: string;
  title: string | null;
  generatedAt: string | null;
  generatedByName: string | null;
  printedAt: string | null;
  note: string | null;
  lines: ScheduleLine[];
};

/** One kitchen's night — every shop it serves, rolled together. */
export type PacketKitchen = {
  key: string;
  date: string;
  kitchenCode: string;
  /** The shops this kitchen is filling that night, for the header. */
  shopCodes: string[];
  lines: ScheduleLine[];
  /** Dough and components the night takes out of the catalog. */
  demand: ElementDemand[];
  /** Elements on the AB rhythm for this kitchen and weekday. */
  ab: SheetElement[];
  /** Elements on the WEEKLY rhythm. */
  weekly: SheetElement[];
};

/** A line on an element sheet — a batch to make, from the standing rhythm. */
export type SheetElement = {
  id: string;
  name: string;
  elementType: string | null;
  shift: string | null;
  batchLabel: string | null;
  sort: number | null;
  amount: number | null;
  unit: string | null;
  /** The stock-up par at this kitchen: count x size unit. */
  stock: string | null;
  note: string | null;
  isExcluded: boolean;
};

export type PacketData = {
  orgName: string;
  printedOn: string;
  schedules: PacketSchedule[];
  kitchens: PacketKitchen[];
};

/** PostgREST caps a select at 1,000 rows and says nothing about it. */
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  orderBy: string,
  filter?: (q: ReturnType<SupabaseClient["from"]>) => unknown
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).order(orderBy).range(from, from + 999);
    if (filter) q = filter(q as never) as typeof q;
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** ISO date -> ISO weekday, 1 = Monday. Never through `new Date(iso)` local. */
function isoWeekday(iso: string): number {
  const jsDay = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return ((jsDay + 6) % 7) + 1;
}

export async function fetchPacketData(
  supabase: SupabaseClient,
  scheduleIds: string[]
): Promise<PacketData> {
  if (scheduleIds.length === 0) {
    return { orgName: "", printedOn: today(), schedules: [], kitchens: [] };
  }

  const [{ data: org }, { data: scheduleRows, error: schedErr }] = await Promise.all([
    supabase.from("orgs").select("name").limit(1).maybeSingle(),
    supabase
      .from("production_schedules")
      // One string literal, never a concatenation — Supabase types the result
      // from the select's literal type and `"a" + "b"` widens to `string`.
      .select(
        `id, schedule_date, location_id, kitchen_location_id, source, title,
         generated_at, generated_by, printed_at, note`
      )
      .in("id", scheduleIds),
  ]);
  if (schedErr) throw new Error(`schedules: ${schedErr.message}`);
  const schedules = scheduleRows ?? [];
  if (schedules.length === 0) throw new Error("Those schedules could not be read.");

  const locationIds = [
    ...new Set(schedules.flatMap((s) => [s.location_id as string, s.kitchen_location_id as string])),
  ];
  const weekdays = [...new Set(schedules.map((s) => isoWeekday(s.schedule_date as string)))];
  const kitchenIds = [...new Set(schedules.map((s) => s.kitchen_location_id as string))];

  const [lines, locations, members, elementDays, elementLocs] = await Promise.all([
    fetchAll<Record<string, unknown>>(
      supabase,
      "production_schedule_items",
      `id, schedule_id, item_id, item_name, item_type, subtype, finish, size,
       tally_box_size, tray_capacity, tray_number, par, made, leftover, sort`,
      "id",
      (q) => (q as never as { in: (c: string, v: string[]) => unknown }).in("schedule_id", scheduleIds)
    ),
    supabase.from("locations").select("id, code").in("id", locationIds).then((r) => r.data ?? []),
    supabase.from("org_members").select("user_id, display_name").then((r) => r.data ?? []),
    fetchAll<Record<string, unknown>>(
      supabase,
      "production_element_days",
      `id, element_id, location_id, weekday, shift, batch_label, sort,
       batch_amount, batch_unit, is_excluded, note`,
      "id",
      (q) =>
        (q as never as { in: (c: string, v: (string | number)[]) => { in: (c: string, v: (string | number)[]) => unknown } })
          .in("location_id", kitchenIds)
          .in("weekday", weekdays)
    ),
    supabase
      .from("production_element_locations")
      .select("element_id, location_id, stock_count, stock_size, stock_unit")
      .in("location_id", kitchenIds)
      .then((r) => r.data ?? []),
  ]);

  const itemIds = [...new Set(lines.map((l) => l.item_id as string))];

  // The BOM, for element demand. Two queries, both bounded by the night's own
  // item list rather than by the whole catalog.
  const [items, edges, elements] = await Promise.all([
    itemIds.length
      ? supabase
          .from("production_items")
          .select("id, item_type, subtype, size, base_element_id")
          .in("id", itemIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    itemIds.length
      ? fetchAll<Record<string, unknown>>(
          supabase,
          "production_item_elements",
          "id, item_id, element_id, qty, unit, sort",
          "id",
          (q) => (q as never as { in: (c: string, v: string[]) => unknown }).in("item_id", itemIds)
        )
      : Promise.resolve([]),
    fetchAll<Record<string, unknown>>(
      supabase,
      "production_elements",
      "id, name, element_type, schedule_class, kind, manual_cost, manual_cost_unit",
      "name"
    ),
  ]);

  /* -- indexes ------------------------------------------------------------ */

  const codeById = new Map(locations.map((l) => [l.id as string, l.code as string]));
  const nameByUser = new Map(
    members.map((m) => [m.user_id as string, (m.display_name ?? null) as string | null])
  );
  const elementById = new Map<string, CostElement>(
    elements.map((e) => [
      e.id as string,
      {
        id: e.id as string,
        name: e.name as string,
        kind: (e.kind ?? "made") as CostElement["kind"],
        manual_cost: (e.manual_cost ?? null) as number | null,
        manual_cost_unit: (e.manual_cost_unit ?? null) as string | null,
      },
    ])
  );
  const elementMeta = new Map(
    elements.map((e) => [
      e.id as string,
      {
        name: e.name as string,
        elementType: (e.element_type ?? null) as string | null,
        scheduleClass: String(e.schedule_class ?? "").toUpperCase(),
      },
    ])
  );

  const edgesByItem = new Map<string, CostLine[]>();
  for (const e of edges) {
    const id = e.item_id as string;
    if (!edgesByItem.has(id)) edgesByItem.set(id, []);
    edgesByItem.get(id)!.push({
      id: e.id as string,
      label: null,
      qty: (e.qty ?? null) as number | null,
      unit: (e.unit ?? null) as string | null,
      element_id: (e.element_id ?? null) as string | null,
    });
  }
  const itemById = new Map<string, ItemDemandSource>(
    items.map((i) => [
      i.id as string,
      { id: i.id as string, elements: edgesByItem.get(i.id as string) ?? [] },
    ])
  );

  const stockByPair = new Map(
    elementLocs.map((r) => [
      `${r.element_id}|${r.location_id}`,
      stockLabel(r.stock_count as number | null, r.stock_size as number | null, r.stock_unit as string | null),
    ])
  );

  const linesBySchedule = new Map<string, ScheduleLine[]>();
  for (const l of lines) {
    const id = l.schedule_id as string;
    if (!linesBySchedule.has(id)) linesBySchedule.set(id, []);
    linesBySchedule.get(id)!.push({
      id: l.id as string,
      item_id: l.item_id as string,
      item_name: l.item_name as string,
      item_type: (l.item_type ?? null) as string | null,
      subtype: (l.subtype ?? null) as string | null,
      finish: (l.finish ?? null) as string | null,
      size: (l.size ?? null) as string | null,
      tally_box_size: Number(l.tally_box_size ?? 6),
      tray_capacity: Number(l.tray_capacity ?? 24),
      tray_number: (l.tray_number ?? null) as string | null,
      par: Number(l.par) || 0,
      made: (l.made ?? null) as number | null,
      leftover: (l.leftover ?? null) as number | null,
    });
  }

  /* -- the documents ------------------------------------------------------ */

  const packetSchedules: PacketSchedule[] = schedules
    .map((s) => ({
      id: s.id as string,
      date: s.schedule_date as string,
      sellsCode: codeById.get(s.location_id as string) ?? "—",
      kitchenCode: codeById.get(s.kitchen_location_id as string) ?? "—",
      source: (s.source ?? "plan") as string,
      title: (s.title ?? null) as string | null,
      generatedAt: (s.generated_at ?? null) as string | null,
      generatedByName: s.generated_by ? nameByUser.get(s.generated_by as string) ?? null : null,
      printedAt: (s.printed_at ?? null) as string | null,
      note: (s.note ?? null) as string | null,
      lines: linesBySchedule.get(s.id as string) ?? [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sellsCode.localeCompare(b.sellsCode));

  // A kitchen's night: every selected schedule it makes, whatever shop each is
  // for and whatever produced it. This is where "including special orders"
  // stops being a claim and becomes the shape of the data.
  const kitchens = new Map<string, PacketKitchen>();
  for (const s of packetSchedules) {
    const key = `${s.date}|${s.kitchenCode}`;
    let k = kitchens.get(key);
    if (!k) {
      k = {
        key,
        date: s.date,
        kitchenCode: s.kitchenCode,
        shopCodes: [],
        lines: [],
        demand: [],
        ab: [],
        weekly: [],
      };
      kitchens.set(key, k);
    }
    if (!k.shopCodes.includes(s.sellsCode)) k.shopCodes.push(s.sellsCode);
    k.lines.push(...s.lines);
  }

  const kitchenIdByCode = new Map(locations.map((l) => [l.code as string, l.id as string]));
  for (const k of kitchens.values()) {
    k.shopCodes.sort();
    k.demand = elementDemand(k.lines, itemById, elementById);

    const kitchenId = kitchenIdByCode.get(k.kitchenCode);
    const weekday = isoWeekday(k.date);
    const rhythm = elementDays
      .filter((d) => d.location_id === kitchenId && Number(d.weekday) === weekday)
      .map((d): SheetElement & { scheduleClass: string } => {
        const meta = elementMeta.get(d.element_id as string);
        return {
          id: d.id as string,
          name: meta?.name ?? "(unknown element)",
          elementType: meta?.elementType ?? null,
          scheduleClass: meta?.scheduleClass ?? "",
          shift: (d.shift ?? null) as string | null,
          batchLabel: (d.batch_label ?? null) as string | null,
          sort: (d.sort ?? null) as number | null,
          amount: (d.batch_amount ?? null) as number | null,
          unit: (d.batch_unit ?? null) as string | null,
          stock: stockByPair.get(`${d.element_id}|${kitchenId}`) ?? null,
          note: (d.note ?? null) as string | null,
          isExcluded: Boolean(d.is_excluded),
        };
      })
      // An excluded batch is on the rhythm and skipped today — it must not
      // print, but the row stays in the catalog so "we stopped doing this" and
      // "we never did" remain different facts.
      .filter((e) => !e.isExcluded)
      .sort(
        (a, b) =>
          (a.sort ?? 9999) - (b.sort ?? 9999) ||
          (a.batchLabel ?? "").localeCompare(b.batchLabel ?? "") ||
          a.name.localeCompare(b.name)
      );

    k.ab = rhythm.filter((e) => e.scheduleClass === "AB");
    k.weekly = rhythm.filter((e) => e.scheduleClass === "WEEKLY");
  }

  return {
    orgName: (org?.name as string) ?? "",
    // The date belongs to the PRINT, not to the night — a packet reprinted a
    // week later says so.
    printedOn: today(),
    schedules: packetSchedules,
    kitchens: [...kitchens.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.kitchenCode.localeCompare(b.kitchenCode)
    ),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "6 × 1.5 GAL", "10 BAGS", or null when nothing was recorded. */
function stockLabel(count: number | null, size: number | null, unit: string | null): string | null {
  if (count === null && size === null && !unit) return null;
  const trim = (n: number) => String(Number(n));
  if (count !== null && size !== null) return `${trim(count)} × ${trim(size)}${unit ? ` ${unit}` : ""}`;
  if (count !== null) return `${trim(count)}${unit ? ` ${unit}` : ""}`;
  return unit ?? null;
}

/**
 * Stamp the print. Separate from generation on purpose (decision 5 — "generated
 * 8/6 by Leo, printed 8/7" is on the real document), and it is the LAST print
 * that matters rather than a count, because reprinting is free and what the
 * list needs to answer is whether paper exists in the kitchen at all.
 */
export async function stampPrinted(
  supabase: SupabaseClient,
  scheduleIds: string[]
): Promise<string | null> {
  // THROUGH THE DEFINER, one call per schedule, not an `.in()` update.
  //
  // `production_schedules`' UPDATE policy is purchaser+, and printing the
  // night's packet is the same closing routine the counts are entered in — so
  // a supervisor pressing Print would have matched zero rows and got NO error
  // back (Mark, 2026-08-09). Migration 044's `mark_schedule_printed` stamps
  // `printed_at`/`printed_by` and can reach nothing else on the schedule.
  //
  // A loop rather than one statement because a definer function takes one row;
  // a packet is rarely more than a handful of nights, and the alternative is an
  // array-argument function whose only job is a loop in a different language.
  // It stops at the first refusal, which is the honest report: they will all
  // fail the same way.
  for (const id of scheduleIds) {
    const { error } = await supabase.rpc("mark_schedule_printed", { p_schedule_id: id });
    if (error) return error.message;
  }
  return null;
}
