/**
 * The night's paperwork, derived from the day's schedule lines.
 *
 * Production brief decision 5: the PREMADE SCHEDULE is the record — one line
 * per item, which `production_schedule_items` stores — and the baker, fryer and
 * decorator tray guides and the element sheets are RENDERINGS of those same
 * lines re-cut at different grains. They carry no information of their own,
 * which is why nothing here writes anything and why none of it is stored.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS TYPESCRIPT WHEN THE PARS ARE SQL
 *
 * Migration 040 computes the day's PARS in the database, because they become
 * records and a generator that inserted client-computed numbers would let a
 * stale tab write last week's arithmetic into a committed document.
 *
 * Element demand is the opposite case. Nothing writes it — there are no
 * element-grain schedule lines, deliberately (decision 5's one revisit point) —
 * so there is no second writer to drift from. And the arithmetic reaches
 * `productionCost`'s resolver and `lib/units`' conversion table, neither of
 * which has a SQL twin, and building one would be decision 2's disease in a new
 * form: two vocabularies for one number.
 *
 * ---------------------------------------------------------------------------
 * EVERY SHAPE BELOW WAS MEASURED OFF THE REAL 2026-08-07 DF02 PACKET
 * (`DF Operations Screenshots/desktop/Production/`), not inferred from the
 * schema. Where a number looks arbitrary it is because the paper says so.
 */

import {
  matchYield,
  versionBatchCost,
  elementCost,
  lineCost,
  type BatchYield,
  type CostElement,
  type CostLine,
  type Unresolved,
} from "./productionCost";

/* -------------------------------------------------------------------------- */
/* The line, as every renderer sees it                                         */
/* -------------------------------------------------------------------------- */

/**
 * A committed schedule line. The taxonomy is the line's own SNAPSHOT, never a
 * join back to `production_items` — 038 is named `item_name_is_not_identity`
 * for a reason, and a guide re-cut for last month has to group by last month's
 * answer.
 */
export type ScheduleLine = {
  id: string;
  item_id: string;
  item_name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  tally_box_size: number;
  /** How many fit on a baker's tray. A DIFFERENT number from the box size. */
  tray_capacity: number;
  tray_number: string | null;
  par: number;
  made: number | null;
  leftover: number | null;
};

/** What a schedule is FOR, which the packet's header states. */
export type ScheduleHeader = {
  id: string;
  schedule_date: string;
  locationCode: string;
  kitchenCode: string;
  source: string;
  title: string | null;
  generatedAt: string | null;
  generatedBy: string | null;
  printedAt: string | null;
};

/* -------------------------------------------------------------------------- */
/* The counting strip                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The premade schedule's tally strip is a FIXED 24 BOXES, independent of par.
 *
 * Measured on the real packet: exactly 888 boxes over 37 item rows, and
 * Bananaversary (par 15) gets the same 24 as Angry Samoa (par 18). It is a
 * counting grid you tick off as the trays come out, not a tally sized to the
 * order — so a renderer must draw all 24 and shade the ones the par covers.
 */
export const TALLY_BOXES = 24;

/**
 * How many boxes the par fills, and it is FLOOR rather than ceil.
 *
 * Measured: par 15 at a box size of 6 shades TWO boxes, not three; 9 shades
 * one; 20 shades three. The strip counts WHOLE boxes of six, and the remainder
 * is the part-tray nobody pre-prints a box for.
 */
export function tallyBoxes(par: number, boxSize: number): { boxes: number; filled: number } {
  const size = Number(boxSize) > 0 ? Number(boxSize) : 6;
  const filled = Math.max(0, Math.floor((Number(par) || 0) / size));
  return { boxes: TALLY_BOXES, filled: Math.min(filled, TALLY_BOXES) };
}

/* -------------------------------------------------------------------------- */
/* The tray ruler                                                              */
/* -------------------------------------------------------------------------- */

/**
 * THE BAKER AND FRYER GUIDES ARE NOT THE COUNTING STRIP, and reproducing one
 * from the other's rule would be wrong (brief, answered question 3).
 *
 * Their `1 2 3 … 25` strip is a ruler of TRAY NUMBERS with the count printed
 * inside each tray it fills: 60 bismarks at 24 to a tray reads 24 · 24 · 12
 * across cells 1, 2 and 3, and the rest of the ruler stays empty.
 */
export const TRAY_CELLS = 25;

/**
 * The fallback when a line carries no capacity of its own.
 *
 * 24 is MEASURED — and so is the fact that it is not universal. Rendering the
 * real 2026-08-07 DF02 night through these components and comparing it page for
 * page against FileMaker's own guide: every filled cell holds 24 (vanilla 54
 * reads 24 · 24 · 6, bismarks 60 read 24 · 24 · 12) EXCEPT the fritters, which
 * FileMaker trays 16 · 4 rather than as a single 20.
 *
 * That is why `production_items.tray_capacity` is a column (migration 040) and
 * this is only the default. A constant would have printed a fritter tray that
 * does not exist, while looking entirely plausible.
 */
export const TRAY_CAPACITY = 24;

/** [24, 24, 12] for 60 at a capacity of 24. Never longer than the ruler. */
export function trayRuler(total: number, capacity = TRAY_CAPACITY): number[] {
  const cap = Number(capacity) > 0 ? Number(capacity) : TRAY_CAPACITY;
  let left = Math.max(0, Number(total) || 0);
  const trays: number[] = [];
  while (left > 0 && trays.length < TRAY_CELLS) {
    const take = Math.min(cap, left);
    trays.push(take);
    left -= take;
  }
  return trays;
}

/* -------------------------------------------------------------------------- */
/* The roll-up                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which grain a document cuts the night at (decision 4 — the taxonomy is
 * operational, and these ARE what it is for):
 *
 *   subtype — the BAKER guide: what to cut.
 *   finish  — the FRYER guide: what to prep for decorating.
 *   item    — the DECORATOR guide, and the premade schedule's own rows.
 */
export type Grain = "subtype" | "finish" | "item";

export type RollRow = {
  key: string;
  /** What the row is called at this grain. */
  label: string;
  total: number;
  /**
   * The SMALLEST capacity among the lines in this run.
   *
   * A subtype row aggregates several items, which today always agree. Where
   * they don't, the smallest is the safe answer: a ruler drawn against the
   * larger one would show fewer trays than the kitchen will actually fill.
   */
  trayCapacity: number;
  /** Only at item grain, and only then is a tally strip meaningful. */
  lines: ScheduleLine[];
};

export type RollSubtype = {
  subtype: string;
  size: string;
  total: number;
  batches: BatchCount;
  rows: RollRow[];
};

export type RollSize = {
  size: string;
  total: number;
  subtypes: RollSubtype[];
};

export type RollType = {
  itemType: string;
  total: number;
  batches: BatchCount;
  sizes: RollSize[];
};

/** An unnamed value is its own group, and it is NOT dropped. The real packet
 *  prints an empty `()` block holding one donut, which is a catalog gap you
 *  want to see rather than a row to hide. */
const UNNAMED = "";
const name = (v: string | null | undefined) => (v ?? "").trim();

/**
 * TYPE → SIZE → SUBTYPE → rows, every level totalled, ordered the way the real
 * packet orders it: alphabetically, all the way down. NOT tray order — measured
 * on the 8/7 packet, whose types run CAKE · MOCHI · OLD FASHIONED · RAISED ·
 * SCRAP and whose subtypes and items are alphabetical within.
 */
export function rollUp(
  lines: ScheduleLine[],
  grain: Grain,
  yields: BatchYield[] = []
): RollType[] {
  const types = new Map<string, Map<string, Map<string, ScheduleLine[]>>>();

  for (const line of lines) {
    const t = name(line.item_type);
    const s = name(line.size);
    const st = name(line.subtype);
    if (!types.has(t)) types.set(t, new Map());
    const sizes = types.get(t)!;
    if (!sizes.has(s)) sizes.set(s, new Map());
    const subs = sizes.get(s)!;
    if (!subs.has(st)) subs.set(st, []);
    subs.get(st)!.push(line);
  }

  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  return [...types.entries()]
    .sort((a, b) => byName(a[0], b[0]))
    .map(([itemType, sizes]) => {
      const sizeRows: RollSize[] = [...sizes.entries()]
        .sort((a, b) => byName(a[0], b[0]))
        .map(([size, subs]) => {
          const subtypeRows: RollSubtype[] = [...subs.entries()]
            .sort((a, b) => byName(a[0], b[0]))
            .map(([subtype, group]) => ({
              subtype,
              size,
              total: sum(group),
              batches: batchCount(group, yields),
              rows: leafRows(group, grain),
            }));
          return {
            size,
            total: subtypeRows.reduce((n, s) => n + s.total, 0),
            subtypes: subtypeRows,
          };
        });

      // A type's batch figure is the SUM of its subtypes', which is what the
      // real packet prints: RAISED's 0.60 is Bismark 0.14 + Promise Ring 0.38 +
      // Bullseye 0.05 + Danish 0.03. Not a separate calculation — the same
      // numbers added up, so the page can never disagree with itself.
      const all = sizeRows.flatMap((s) => s.subtypes.map((x) => x.batches));
      return {
        itemType,
        total: sizeRows.reduce((n, s) => n + s.total, 0),
        batches: addBatches(all),
        sizes: sizeRows,
      };
    });
}

function sum(lines: ScheduleLine[]): number {
  return lines.reduce((n, l) => n + (Number(l.par) || 0), 0);
}

function leafRows(lines: ScheduleLine[], grain: Grain): RollRow[] {
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

  if (grain === "item") {
    // One row per LINE, not per item name: "Angry Samoa" is four different
    // donuts (038), and two of them can legitimately share a night.
    return lines
      .slice()
      .sort((a, b) => byName(a.item_name, b.item_name))
      .map((l) => ({
        key: l.id,
        label: l.item_name,
        total: Number(l.par) || 0,
        trayCapacity: capacityOf([l]),
        lines: [l],
      }));
  }

  const key = grain === "finish" ? (l: ScheduleLine) => name(l.finish) : (l: ScheduleLine) => name(l.subtype);
  const groups = new Map<string, ScheduleLine[]>();
  for (const l of lines) {
    const k = key(l);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  return [...groups.entries()]
    .sort((a, b) => byName(a[0], b[0]))
    .map(([label, group]) => ({
      key: label || UNNAMED,
      label,
      total: sum(group),
      trayCapacity: capacityOf(group),
      lines: group,
    }));
}

function capacityOf(lines: ScheduleLine[]): number {
  const caps = lines
    .map((l) => Number(l.tray_capacity))
    .filter((n) => Number.isFinite(n) && n > 0);
  return caps.length ? Math.min(...caps) : TRAY_CAPACITY;
}

/* -------------------------------------------------------------------------- */
/* Batch size                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How much dough a run of donuts takes, in BATCHES.
 *
 * `unresolved` carries the same weight it does in `Cost`: an item whose
 * (type, subtype, size) has no rule in `production_batch_yields` contributes
 * NOTHING and says so, rather than defaulting to zero and quietly making the
 * figure too small. A renderer prints "AT LEAST 0.60" when the list is
 * non-empty — the PDF says it in words, because @react-pdf's Helvetica is
 * WinAnsi and has no `≥` glyph (it renders as a stray "e").
 */
export type BatchCount = {
  batches: number | null;
  unresolved: Unresolved[];
};

export function batchCount(lines: ScheduleLine[], yields: BatchYield[]): BatchCount {
  let total = 0;
  let counted = 0;
  const unresolved: Unresolved[] = [];

  for (const line of lines) {
    const rule = matchYield(line, yields);
    if (!rule || rule.portion_of_batch === null) {
      unresolved.push({ elementId: null, name: line.item_name, reason: "no batch yield" });
      continue;
    }
    // Per LINE, then summed — not `groupTotal x rule`. Within one
    // (type, subtype, size) group the rule is the same for every line today, so
    // the two agree; doing it per line is what keeps them agreeing if a rule is
    // ever stated more narrowly.
    total += (Number(line.par) || 0) * Number(rule.portion_of_batch) * Number(rule.size_factor ?? 1);
    counted += 1;
  }

  return { batches: counted ? total : null, unresolved };
}

function addBatches(parts: BatchCount[]): BatchCount {
  const priced = parts.filter((p) => p.batches !== null);
  return {
    batches: priced.length ? priced.reduce((n, p) => n + (p.batches ?? 0), 0) : null,
    unresolved: parts.flatMap((p) => p.unresolved),
  };
}

/** "0.60", "1.05" — two places, the way the printed packet writes it. */
export function formatBatches(count: BatchCount): string {
  if (count.batches === null) return "";
  const n = count.batches.toFixed(2);
  return count.unresolved.length ? `AT LEAST ${n}` : n;
}

/* -------------------------------------------------------------------------- */
/* Element demand                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What the night takes out of the element catalog — the donut element sheet.
 *
 * The DOUGH comes from the item's `base_element_id` and its batch rule, in
 * batches. Everything else on the item comes from its BOM edges, in that
 * edge's own unit x the par.
 *
 * Note what this deliberately does NOT do: it never falls back to zero. An item
 * with no batch rule, or an edge with no quantity, lands in `unresolved` and
 * the sheet says so — the phase-2 lesson that a hundredfold dough error still
 * looks like a plausible ingredient cost, so a silently-too-small number is the
 * dangerous kind.
 */
export type ItemDemandSource = {
  id: string;
  item_type: string | null;
  subtype: string | null;
  size: string | null;
  base_element_id: string | null;
  /** The components besides the dough — `production_item_elements`. */
  elements: CostLine[];
};

export type ElementDemand = {
  elementId: string;
  name: string;
  /** Dough, in batches of the master recipe. Null when nothing resolved. */
  batches: number | null;
  /** Components, in the edge's own unit. Null when nothing resolved. */
  quantity: number | null;
  unit: string | null;
  unresolved: Unresolved[];
};

export function elementDemand(
  lines: ScheduleLine[],
  items: Map<string, ItemDemandSource>,
  byId: Map<string, CostElement>,
  yields: BatchYield[]
): ElementDemand[] {
  const out = new Map<string, ElementDemand>();

  const bucket = (elementId: string) => {
    let e = out.get(elementId);
    if (!e) {
      e = {
        elementId,
        name: byId.get(elementId)?.name ?? "(unknown element)",
        batches: null,
        quantity: null,
        unit: null,
        unresolved: [],
      };
      out.set(elementId, e);
    }
    return e;
  };

  for (const line of lines) {
    const par = Number(line.par) || 0;
    if (!par) continue;
    const item = items.get(line.item_id);
    if (!item) continue;

    if (item.base_element_id) {
      const e = bucket(item.base_element_id);
      const rule = matchYield(line, yields);
      if (!rule || rule.portion_of_batch === null) {
        e.unresolved.push({ elementId: item.base_element_id, name: line.item_name, reason: "no batch yield" });
      } else {
        e.batches = (e.batches ?? 0) + par * Number(rule.portion_of_batch) * Number(rule.size_factor ?? 1);
      }
    }

    for (const edge of item.elements) {
      if (!edge.element_id) continue;
      const e = bucket(edge.element_id);
      if (edge.qty === null || edge.qty === undefined) {
        // 176 of FMP's BOM edges carry no quantity — the dough's amount is
        // DERIVED, and a few others were simply never filled in. Either way it
        // is a hole to name, not a zero to add.
        e.unresolved.push({ elementId: edge.element_id, name: line.item_name, reason: "no quantity" });
        continue;
      }
      // Mixed units on one element would be a catalog problem, not an
      // arithmetic one: the first unit wins and the rest are reported.
      if (e.unit === null) e.unit = edge.unit;
      else if (edge.unit && e.unit !== edge.unit) {
        e.unresolved.push({ elementId: edge.element_id, name: line.item_name, reason: "incompatible units" });
        continue;
      }
      e.quantity = (e.quantity ?? 0) + Number(edge.qty) * par;
    }
  }

  return [...out.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * What a batch of this element costs today — the figure the element sheet
 * prints beside the demand. Delegates entirely; nothing about cost is
 * reimplemented here (decision 11, and the reason `productionCost` exists).
 */
export function elementBatchCost(
  element: CostElement,
  byId: Map<string, CostElement>,
  locationId: string | null
) {
  return element.master
    ? versionBatchCost(element.master, byId, locationId, new Set([element.id]))
    : elementCost(element, byId, locationId);
}

/** Re-exported so a renderer needs one import for a line's own cost. */
export { lineCost };

/* -------------------------------------------------------------------------- */
/* Headings                                                                    */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * "FRI 8/7/2026", the way the packet's own header writes it.
 *
 * Parsed from the ISO STRING rather than through `new Date(iso)`, which is UTC
 * midnight and reads as the previous day for everyone west of Greenwich — the
 * same trap `lib/productionPlans` documents for plan ranges.
 */
export function packetDate(iso: string): string {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_NAMES[dow]} ${m}/${d}/${y}`;
}

/** "DF02 PREMADE SCHEDULE" / "BAKER TRAY GUIDE (DF01)". */
export function totalDonuts(lines: ScheduleLine[]): number {
  return sum(lines);
}
