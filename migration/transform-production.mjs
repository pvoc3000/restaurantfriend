#!/usr/bin/env node
/**
 * Restaurant Friend — FMP Production catalog → production-catalog.json (036).
 *
 *   node transform-production.mjs           # dry run: the full report, nothing written
 *   node transform-production.mjs --write   # writes ../../FMP Export/transformed/
 *
 * FOUR source tables into six, because the merge is the point (brief decision
 * 2): `Production_Elements` and `Recipe_Items` are one component catalog built
 * twice, and only ONE process can catch a name collision between them before
 * the unique index does it halfway through a batch.
 *
 *   Production_Elements.mer  249 rows → production_elements
 *   Recipe_Items.mer         212 rows → production_elements (merged in)
 *   Production_Recipes.mer   493 rows → production_recipes + …_versions
 *   _recipelements.mer     8,175 rows → …_recipe_lines + …_recipe_steps
 *   _elementpars.mer          60 rows → production_element_locations
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY THROWN AWAY
 *
 * EVERY COST COLUMN. Recipe_Items alone has six (CostPerGram_c, CostPerOunce_c,
 * CostPerPound_c, CostPerServing…), all frozen at map time and some still
 * carrying their 1/30/2022 value in 2026. Migration 036 has no cost column to
 * put them in and that is decision 11 working as intended: cost resolves live
 * through purchasing. The ONE exception is a manual element's set cost, which
 * is an input rather than a cached answer.
 *
 * THE PER-COLUMN SCALED AMOUNTS. A recipe line stores its BASE amount only;
 * the rest are computed from the version's multipliers at render. That is a
 * measurement, not a preference — see `scaleReport` below, which reports the
 * dozen lines whose stored columns disagree with strict proportionality, so
 * the round-off is visible instead of silent. The raw strip is kept in
 * `source_payload` either way, so nothing is unrecoverable.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Production');
const OUT = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed',
  'production-catalog.json');
const APPLY = process.argv.includes('--write');

/** Between the repetitions of a FileMaker repeating field, once exported. */
const GS = String.fromCharCode(0x1d);
/** Between the lines of a multi-line text field. */
const VT = String.fromCharCode(0x0b);

/** FileMaker .mer is CSV with quoted fields and \r line endings. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Read a .mer with an ALLOW-LIST of candidate column names that fails loudly. */
function table(path, label, fields) {
  if (!existsSync(path)) {
    console.error(`No ${path} (override the folder with MER_DIR=)`);
    process.exit(1);
  }
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0].map((h) => h.trim());

  const positions = new Map();
  header.forEach((h, i) => {
    const k = h.toLowerCase();
    if (!positions.has(k)) positions.set(k, []);
    positions.get(k).push(i);
  });
  const repeated = [...positions].filter(([, ix]) => ix.length > 1);
  if (repeated.length) {
    console.error(`${label} has repeated column names, which a header-keyed parser drops silently:`);
    for (const [k, ix] of repeated) console.error(`  · "${k}" at positions ${ix.join(', ')}`);
    process.exit(1);
  }

  const F = {}, missing = [];
  for (const [key, { names, required = true }] of Object.entries(fields)) {
    const i = names.map((n) => positions.get(n.toLowerCase())?.[0]).find((v) => v !== undefined);
    if (i === undefined && required) missing.push(`${key} (tried ${names.join(', ')})`);
    F[key] = i;
  }
  if (missing.length) {
    console.error(`${label} is missing:`);
    for (const m of missing) console.error(`  · ${m}`);
    console.error(`\nColumns present: ${header.join(', ')}`);
    console.error('\nRefusing to guess. Re-export from FileMaker per the brief\'s export procedure.');
    process.exit(1);
  }
  return {
    rows: rows.slice(1),
    g: (row, k) => (F[k] === undefined ? '' : String(row[F[k]] ?? '').trim()),
  };
}

/** A repeating field's slots. */
const reps = (v) => String(v ?? '').split(GS).map((s) => s.trim());
/** Multi-line text arrives VT-separated; keep the lines, lose the control char. */
const text = (v) => {
  const s = String(v ?? '').split(VT).map((x) => x.trim()).filter(Boolean).join('\n').trim();
  return s === '' ? null : s;
};
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

const fatal = [];
const problems = [];
const note = (msg) => { if (problems.length < 4000) problems.push(msg); };

/* ========================================================================== */
/* 1. Elements — Production_Elements + Recipe_Items merged                     */
/* ========================================================================== */

const E = table(resolve(PROD, 'Production_Elements.mer'), 'Production_Elements.mer', {
  id: { names: ['_id_element_t'] },
  name: { names: ['name'] },
  type: { names: ['type'] },
  type_print: { names: ['type_forprint_c'] },
  schedule: { names: ['schedule'] },
  is_hidden: { names: ['isHidden'] },
  recipe_name: { names: ['recipeName_t'] },
  recipe_key: { names: ['_recipeKey_t'] },
  inventory_key: { names: ['_inventoryKey_t'] },
  cost_basis: { names: ['cost_basis_t'] },
  set_amount: { names: ['cost_setAmount_n'] },
  set_unit: { names: ['cost_setUnit_t'] },
  par_packed: { names: ['par'] },
  yield: { names: ['yield_n'] },
});

const I = table(resolve(PROD, 'Recipe_Items.mer'), 'Recipe_Items.mer', {
  key: { names: ['_PrimaryKey'] },
  name: { names: ['ItemName_text'] },
  kind: { names: ['VendorItemOrRecipe_text'] },
  vendor_item_key: { names: ['_VendorItemKey'] },
  recipe_key: { names: ['_RecipeKey'] },
  manual_cost: { names: ['CostPerServing_manual'] },
  manual_unit: { names: ['CostPerServingUnit_manual'] },
});

/**
 * "05 Topping" → { type: "Topping", sort: 5 }.
 *
 * FileMaker already computes this as `type_forprint_c`, so the source itself
 * agrees the number is presentation — we prefer its answer and fall back to
 * stripping, which is what catches the one row where the calc is empty.
 */
function splitType(raw, printed) {
  const m = /^\s*(\d+)\s+(.*)$/.exec(String(raw ?? ''));
  const stripped = m ? m[2].trim() : String(raw ?? '').trim();
  return {
    type: blank(printed) ?? blank(stripped),
    sort: m ? Number(m[1]) : null,
  };
}

/** A name reduced to what a duplicate check should consider the same thing. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const elements = [];          // the output rows
const elementByFmpId = new Map();   // FMP _id_element_t → our row
const elementByName = new Map();    // norm(name)        → our row
const typeCollisions = new Map();

/** Register a row, MERGING onto an existing name rather than loading both. */
function addElement(row, { mergeReport }) {
  const key = norm(row.name);
  const existing = elementByName.get(key);
  if (existing) {
    mergeReport(existing, row);
    // Fill anything the first copy lacked; never overwrite a real value.
    for (const k of ['element_type', 'type_sort', 'schedule_class', 'inventory_legacy_key',
                     'manual_cost', 'manual_cost_unit', 'notes']) {
      if (existing[k] === null || existing[k] === undefined) existing[k] = row[k] ?? null;
    }
    existing.merged_legacy_ids.push(row.legacy_id);
    return existing;
  }
  elements.push(row);
  elementByName.set(key, row);
  return row;
}

for (const r of E.rows) {
  const fmpId = E.g(r, 'id');
  if (!fmpId) { note(`Production_Elements row with no _id_element_t: "${E.g(r, 'name')}"`); continue; }
  const name = E.g(r, 'name');
  if (!name) { note(`Production_Elements ${fmpId} has no name`); continue; }

  const { type, sort } = splitType(E.g(r, 'type'), E.g(r, 'type_print'));
  if (type) {
    const seen = typeCollisions.get(norm(type));
    if (seen && seen.sort !== sort) {
      note(`type "${type}" appears with sort ${seen.sort} and ${sort} — sort order is ambiguous`);
    } else if (!seen) typeCollisions.set(norm(type), { type, sort });
  }

  const schedule = blank(E.g(r, 'schedule'));
  const row = {
    legacy_id: `E:${fmpId}`,
    merged_legacy_ids: [],
    name,
    // Provisional. The real answer needs the recipe pass (a made element is one
    // that HAS recipes) and the vendor-item pass, so it is settled below.
    kind: null,
    element_type: type,
    type_sort: sort,
    // FMP's HIDDEN schedule is not a rhythm, it is the absence of one, and
    // `isHidden` already says that.
    schedule_class: schedule === 'HIDDEN' || schedule === 'NONE' ? null : schedule,
    inventory_legacy_key: null,
    vendor_item_legacy_key: null,
    manual_cost: num(E.g(r, 'set_amount')),
    manual_cost_unit: blank(E.g(r, 'set_unit')),
    is_active: E.g(r, 'is_hidden') !== '1',
    notes: null,
    source: 'filemaker',
    source_payload: {
      fmp_element_id: fmpId,
      cost_basis: blank(E.g(r, 'cost_basis')),
      recipe_name: blank(E.g(r, 'recipe_name')),
      recipe_key: blank(E.g(r, 'recipe_key')),
      inventory_key: blank(E.g(r, 'inventory_key')),
      raw_type: blank(E.g(r, 'type')),
      raw_schedule: schedule,
      legacy_par_packed: reps(E.g(r, 'par_packed')).some(Boolean)
        ? reps(E.g(r, 'par_packed')) : undefined,
      yield: num(E.g(r, 'yield')),
    },
  };

  const stored = addElement(row, {
    mergeReport: (a, b) => note(
      `DUPLICATE element name "${b.name}" — FMP ${b.legacy_id} merged into ${a.legacy_id}`),
  });
  elementByFmpId.set(fmpId, stored);
}

/* -- Recipe_Items merge in ------------------------------------------------- */

const KIND_FROM_FMP = new Map([
  ['vendor item', 'purchased'],
  ['manual', 'manual'],
  ['recipe', 'made'],
]);

const elementByItemKey = new Map();   // Recipe_Items _PrimaryKey → our element row

/**
 * SIX ROWS IN THE INGREDIENT CATALOG THAT ARE NOT INGREDIENTS.
 *
 * FileMaker's "metadata as rows" disease goes deeper than the brief records: it
 * isn't only that Mixer Size and Expected Yield are recipe LINES, it's that
 * they have entries in the ingredient CATALOG for those lines to point at —
 * "Mixer Size", "Expected Yield", "Prep Time", "Total Liquid", "---" and one
 * with no name at all, every one typed "Vendor Item" with no vendor key.
 *
 * They must not become elements (a component called "Mixer Size" would sit in
 * the BOM forever), and they cannot merely be dropped either: 827 recipe lines
 * point at them, and those lines carry the name ONLY through this link — their
 * own `columnName_t` is empty. So the name is remembered and handed to the line
 * as its label, where the magic-row lifter picks it up.
 *
 * This was found by the audit downstream rather than by reading: the scale
 * report named "Mixer Size" as a line losing a hand-tweak, which is impossible
 * for a row the lifter had already removed.
 */
const PSEUDO_ITEM_NAMES = new Set(['mixer size', 'expected yield', 'prep time', 'total liquid']);
const pseudoItemNameByKey = new Map();   // key → the name to use as a label
const separatorItemKeys = new Set();

for (const r of I.rows) {
  const key = I.g(r, 'key');
  const name = I.g(r, 'name');
  if (!key) { note(`Recipe_Items row with no _PrimaryKey: "${name}"`); continue; }
  // FMP's own separator rows, which are data pretending to be presentation.
  if (!name || name === '---') { separatorItemKeys.add(key); continue; }
  if (PSEUDO_ITEM_NAMES.has(norm(name))) { pseudoItemNameByKey.set(key, name); continue; }

  const kind = KIND_FROM_FMP.get(norm(I.g(r, 'kind'))) ?? null;
  if (!kind) note(`Recipe_Items "${name}" has an unknown type "${I.g(r, 'kind')}"`);

  const existing = elementByName.get(norm(name));
  if (existing) {
    // The same component, catalogued in both tables. Take what Recipe_Items
    // knows and Production_Elements doesn't: the vendor mapping and the kind.
    existing.vendor_item_legacy_key ??= blank(I.g(r, 'vendor_item_key'));
    existing.manual_cost ??= num(I.g(r, 'manual_cost'));
    existing.manual_cost_unit ??= blank(I.g(r, 'manual_unit'));
    existing.source_payload.recipe_item_key = key;
    existing.source_payload.recipe_item_kind = blank(I.g(r, 'kind'));
    existing.kind ??= kind;
    elementByItemKey.set(key, existing);
    continue;
  }

  const row = {
    legacy_id: `I:${key}`,
    merged_legacy_ids: [],
    name,
    kind,
    element_type: null,
    type_sort: null,
    schedule_class: null,
    inventory_legacy_key: null,
    vendor_item_legacy_key: blank(I.g(r, 'vendor_item_key')),
    manual_cost: num(I.g(r, 'manual_cost')),
    manual_cost_unit: blank(I.g(r, 'manual_unit')),
    is_active: true,
    notes: null,
    source: 'filemaker',
    source_payload: { recipe_item_key: key, recipe_item_kind: blank(I.g(r, 'kind')) },
  };
  const stored = addElement(row, {
    mergeReport: (a, b) => note(
      `DUPLICATE ingredient name "${b.name}" — Recipe_Items ${b.legacy_id} merged into ${a.legacy_id}`),
  });
  elementByItemKey.set(key, stored);
}

/* ========================================================================== */
/* 2. Recipes — families, versions                                             */
/* ========================================================================== */

const R = table(resolve(PROD, 'Production_Recipes.mer'), 'Production_Recipes.mer', {
  key: { names: ['_PrimaryKey'] },
  element_id: { names: ['_ElementID'] },
  name: { names: ['Name_text'] },
  version: { names: ['Version_text'] },
  is_master: { names: ['isMaster_bool'] },
  is_active: { names: ['isActive_bool'] },
  author: { names: ['Author_text'] },
  description: { names: ['Description_text'] },
  note: { names: ['Note_text'] },
  testing: { names: ['TestingNotes_text'] },
  yield: { names: ['Yield'] },
  prep_time: { names: ['PrepTime_text'] },
  shelf_life: { names: ['ShelfLife_text'] },
  storage: { names: ['StorageInfo_text'] },
  tools: { names: ['Tools_text'] },
  type1: { names: ['Type1_text'] },
  type2: { names: ['Type2_text'] },
  type3: { names: ['Type3_text'] },
  flavor: { names: ['Flavor_text'] },
  multiplier: { names: ['Multiplier_number'] },
  variation: { names: ['Variation_text'] },
  version_name: { names: ['VersionName_text'] },
});

/** "v27a" / "10" → a sortable number. Letters break ties within a number. */
function versionSort(label) {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(String(label ?? '').trim());
  if (!m) return null;
  const base = Number(m[1]);
  const suffix = m[2] ? (m[2].toLowerCase().charCodeAt(0) - 96) / 100 : 0;
  return Number.isFinite(base) ? base + suffix : null;
}

// Pass 1: index every version by its own name and by any element id it names,
// so a family can be recognised from either direction.
const versionRows = [];
const elemIdByRecipeName = new Map();
for (const r of R.rows) {
  const eid = R.g(r, 'element_id');
  const name = R.g(r, 'name');
  if (eid && name) elemIdByRecipeName.set(norm(name), eid);
  versionRows.push(r);
}
// The element's own back-link, which covers recipes whose rows never name one.
const elemIdByBackLink = new Map();
for (const r of E.rows) {
  const rn = E.g(r, 'recipe_name');
  if (rn) elemIdByBackLink.set(norm(rn), E.g(r, 'id'));
}

const families = new Map();   // key → family row + its versions
const orphanFamilies = [];

for (const r of versionRows) {
  const name = R.g(r, 'name');
  if (!name) { note(`Production_Recipes ${R.g(r, 'key')} has no name — skipped`); continue; }
  const lc = norm(name);

  // Four ways to find the element, in order of how much they claim.
  let fmpElemId = R.g(r, 'element_id') || null;
  let via = fmpElemId ? '_ElementID' : null;
  if (!fmpElemId && elemIdByRecipeName.has(lc)) { fmpElemId = elemIdByRecipeName.get(lc); via = 'sibling version'; }
  if (!fmpElemId && elemIdByBackLink.has(lc)) { fmpElemId = elemIdByBackLink.get(lc); via = 'element.recipeName_t'; }

  let element = fmpElemId ? elementByFmpId.get(fmpElemId) : null;
  if (fmpElemId && !element) {
    note(`recipe "${name}" names element ${fmpElemId}, which does not exist — treated as unlinked`);
    fmpElemId = null; via = null;
  }
  // Last resort: an element with exactly this name.
  if (!element && elementByName.has(lc)) { element = elementByName.get(lc); via = 'element name == recipe name'; }

  const famKey = element ? `E:${element.legacy_id}` : `N:${lc}`;
  if (!families.has(famKey)) {
    families.set(famKey, {
      legacy_id: `RF:${famKey}`,
      name,
      element_legacy_id: element ? element.legacy_id : null,
      recipe_type: blank(R.g(r, 'type1')),
      is_active: false,           // true if any version is
      source: 'filemaker',
      via,
      versions: [],
    });
  }
  const fam = families.get(famKey);

  const label = blank(R.g(r, 'version')) ?? '1';
  const scaleLabels = reps(R.g(r, 'variation'));
  const scaleMults = reps(R.g(r, 'multiplier'));
  // Trim the trailing empties FileMaker pads every repeating field with, but
  // keep interior blanks — slot 0's blank multiplier MEANS x1 and dropping it
  // would shift every label off its column.
  let width = 0;
  for (let i = 0; i < Math.max(scaleLabels.length, scaleMults.length); i++) {
    if (blank(scaleLabels[i]) !== null || blank(scaleMults[i]) !== null) width = i + 1;
  }
  const labels = scaleLabels.slice(0, width).map((s) => blank(s));
  const mults = scaleMults.slice(0, width).map((s, i) => {
    const n = num(s);
    if (n !== null) return n;
    // Blank in the BASE slot is x1 — measured on all 493 versions. A blank
    // anywhere else is a column that was never set up; 1 is the honest reading
    // there too, and the label beside it is what the reader actually goes by.
    return i === 0 ? 1 : 1;
  });

  fam.versions.push({
    legacy_id: `RV:${R.g(r, 'key')}`,
    fmp_key: R.g(r, 'key'),
    version_label: label,
    version_sort: versionSort(label),
    fmp_master: R.g(r, 'is_master') === '1',
    is_active: R.g(r, 'is_active') === '1',
    author: blank(R.g(r, 'author')),
    description: text(R.g(r, 'description')),
    note: text(R.g(r, 'note')),
    testing_notes: text(R.g(r, 'testing')),
    yield_amount: num(R.g(r, 'yield')),
    yield_unit: null,          // filled from the magic rows below
    mixer_size: null,          // ditto
    prep_time: blank(R.g(r, 'prep_time')),
    shelf_life: blank(R.g(r, 'shelf_life')),
    storage: text(R.g(r, 'storage')),
    tools: text(R.g(r, 'tools')),
    scale_labels: labels,
    scale_multipliers: mults,
    source: 'filemaker',
    source_payload: {
      recipe_key: R.g(r, 'key'),
      type1: blank(R.g(r, 'type1')),
      type2: blank(R.g(r, 'type2')),
      type3: blank(R.g(r, 'type3')),
      flavor: blank(R.g(r, 'flavor')),
      version_name: blank(R.g(r, 'version_name')),
      fmp_element_id: R.g(r, 'element_id') || null,
    },
    lines: [],
    steps: [],
  });
  if (R.g(r, 'is_active') === '1') fam.is_active = true;
  fam.recipe_type ??= blank(R.g(r, 'type1'));
}

/* -- Elements for the orphaned families ------------------------------------ */
//
// `production_recipes.element_id` is NOT NULL (decision 3), so a family with no
// element needs one. FMP simply never wrote it down: 34 families, mostly the
// "Knotted – …" cream and custard series plus several "(old)" glazes. They land
// INACTIVE so they don't pollute the working catalog, and every one is named in
// the report so Mark can activate or delete them deliberately.

for (const [famKey, fam] of families) {
  if (fam.element_legacy_id) continue;
  const created = {
    legacy_id: `RE:${norm(fam.name)}`,
    merged_legacy_ids: [],
    name: fam.name,
    kind: 'made',
    element_type: fam.recipe_type,
    type_sort: null,
    schedule_class: null,
    inventory_legacy_key: null,
    vendor_item_legacy_key: null,
    manual_cost: null,
    manual_cost_unit: null,
    is_active: false,
    notes: 'Created at migration: this recipe had no element in FileMaker.',
    source: 'filemaker',
    source_payload: { created_for_orphan_recipe: fam.name },
  };
  const stored = addElement(created, {
    // If a name collides here the element already existed under that name, so
    // the family simply attaches to it — which is the outcome we wanted anyway.
    mergeReport: () => {},
  });
  fam.element_legacy_id = stored.legacy_id;
  fam.created_element = stored.legacy_id === created.legacy_id;
  orphanFamilies.push(fam);
}

/* -- Masters --------------------------------------------------------------- */
//
// The flag cannot be trusted: 103 families have exactly one, 6 have several and
// 64 have none. Decide, and report every family the flag didn't settle.

const masterReport = { flag: 0, severalFlags: 0, noFlag: 0 };
for (const fam of families.values()) {
  const flagged = fam.versions.filter((v) => v.fmp_master);
  const bySort = (a, b) => (b.version_sort ?? -1) - (a.version_sort ?? -1);
  let chosen;
  if (flagged.length === 1) { chosen = flagged[0]; masterReport.flag++; }
  else if (flagged.length > 1) {
    chosen = [...flagged].sort(bySort)[0];
    masterReport.severalFlags++;
    note(`"${fam.name}" flags ${flagged.length} masters (${flagged.map((v) => 'v' + v.version_label).join(', ')}) — took v${chosen.version_label}`);
  } else {
    const active = fam.versions.filter((v) => v.is_active);
    chosen = [...(active.length ? active : fam.versions)].sort(bySort)[0];
    masterReport.noFlag++;
  }
  for (const v of fam.versions) v.is_master = v === chosen;
}

/* ========================================================================== */
/* 3. Recipe lines + steps                                                     */
/* ========================================================================== */

const L = table(resolve(PROD, '_recipelements.mer'), '_recipelements.mer', {
  key: { names: ['_PrimaryKey'] },
  recipe_key: { names: ['_RecipeKey'] },
  item_key: { names: ['_ItemKey'] },
  element_type: { names: ['_ElementType'] },
  amount: { names: ['columnAmount_n'] },
  unit: { names: ['columnUnit_t'] },
  name: { names: ['columnName_t'] },
  note: { names: ['ItemNote'] },
  sort: { names: ['Sort_num'] },
  step: { names: ['Step_text'] },
  hide: { names: ['shouldHide_bool'] },
});

const versionByFmpKey = new Map();
for (const fam of families.values()) for (const v of fam.versions) versionByFmpKey.set(v.fmp_key, v);

/**
 * The three magic rows FileMaker kept as INGREDIENT LINES at sort 100–102.
 * They are metadata about the version and become columns on it.
 */
const MAGIC = new Map([
  ['mixer size', 'mixer_size'],
  ['expected yield', 'yield'],
  ['prep time', 'prep_time'],
]);

/** g/ml/each, for the proportionality audit only — never for a stored value. */
const FACTOR = {
  g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.3495, lb: 453.592, lbs: 453.592,
  ml: 1, l: 1000, qt: 946.353, gal: 3785.41, pt: 473.176,
  tsp: 4.92892, tbsp: 14.7868, cup: 236.588, ea: 1, each: 1, ct: 1, dozen: 12,
};

const counts = { ingredient: 0, procedure: 0, magic: 0, separator: 0, orphan: 0, empty: 0 };
const scaleReport = [];

for (const r of L.rows) {
  const version = versionByFmpKey.get(L.g(r, 'recipe_key'));
  if (!version) { counts.orphan++; note(`recipe line ${L.g(r, 'key')} points at no version`); continue; }

  const kind = norm(L.g(r, 'element_type'));   // FMP's own case drifted
  const sort = num(L.g(r, 'sort'));
  const amounts = reps(L.g(r, 'amount'));
  const units = reps(L.g(r, 'unit'));
  const names = reps(L.g(r, 'name'));
  const itemKey = L.g(r, 'item_key');
  const isSeparator = itemKey ? separatorItemKeys.has(itemKey) : false;
  // A pseudo-item lends the line its name; that is the only place the line's
  // own name lives, since `columnName_t` is empty on every one of them.
  const label = blank(names[0]) ?? (itemKey ? pseudoItemNameByKey.get(itemKey) ?? null : null);
  const isPseudo = itemKey ? pseudoItemNameByKey.has(itemKey) : false;
  const item = itemKey && !isSeparator && !isPseudo ? elementByItemKey.get(itemKey) : null;
  if (itemKey && !isSeparator && !isPseudo && !item) {
    note(`recipe line ${L.g(r, 'key')} names Recipe_Item ${itemKey}, which does not exist`);
  }

  if (kind === 'procedure') {
    const body = text(L.g(r, 'step'));
    if (!body) { counts.empty++; continue; }
    version.steps.push({
      legacy_id: `RS:${L.g(r, 'key')}`,
      sort: sort === null ? null : Math.round(sort),
      body,
      section: null,
    });
    counts.procedure++;
    continue;
  }

  // An ingredient. First: is it one of the magic metadata rows?
  const magic = label ? MAGIC.get(norm(label)) : null;
  if (magic) {
    const base = num(amounts[0]);
    const unit = blank(units[0]);
    if (magic === 'mixer_size') version.mixer_size ??= base === null ? null : `${base}${unit ? ' ' + unit : ''}`;
    else if (magic === 'yield') { version.yield_amount ??= base; version.yield_unit ??= unit; }
    else if (magic === 'prep_time') version.prep_time ??= base === null ? null : `${base}${unit ? ' ' + unit : ''}`;
    counts.magic++;
    continue;
  }

  // FMP's literal separator rows, which are presentation stored as data —
  // either pointing at one of the two separator Recipe_Items, or simply empty.
  if (isSeparator || (!item && !label && num(amounts[0]) === null)) { counts.separator++; continue; }

  const qty = num(amounts[0]);
  const unit = blank(units[0]);

  // AUDIT the discarded columns. A line whose stored strip disagrees with a
  // strict scaling of column 0 is losing a hand-tweak here, so say so — the raw
  // strip stays in source_payload either way, but a silent round-off is exactly
  // the kind of thing nobody discovers for a year.
  if (qty !== null) {
    const baseG = FACTOR[String(unit).toLowerCase()] ? qty * FACTOR[String(unit).toLowerCase()] : null;
    const m0 = version.scale_multipliers[0] ?? 1;
    if (baseG !== null && m0) {
      for (let i = 1; i < version.scale_multipliers.length; i++) {
        if (units[i] === '%') continue;
        const n = num(amounts[i]);
        const f = FACTOR[String(units[i] ?? '').toLowerCase()];
        if (n === null || !f) continue;
        const expect = (baseG / m0) * (version.scale_multipliers[i] ?? 1);
        const got = n * f;
        if (expect && Math.abs(expect - got) / expect > 0.02) {
          scaleReport.push(
            `${version.source_payload.type1 ?? ''} "${label ?? item?.name ?? '?'}" in ` +
            `${[...families.values()].find((f2) => f2.versions.includes(version))?.name} ` +
            `v${version.version_label}: column ${i} stores ${n}${units[i]}, ` +
            `scaling column 0 gives ${(expect / f).toFixed(2)}${units[i]}`);
          break;
        }
      }
    }
  }

  version.lines.push({
    legacy_id: `RL:${L.g(r, 'key')}`,
    element_legacy_id: item ? item.legacy_id : null,
    label,
    qty,
    unit,
    sort: sort === null ? null : Math.round(sort),
    section: null,
    note: text(L.g(r, 'note')),
    source_payload: {
      columns: amounts.some(Boolean) ? { amounts, units } : undefined,
      item_key: L.g(r, 'item_key') || undefined,
      hidden: L.g(r, 'hide') === '1' || undefined,
    },
  });
  counts.ingredient++;
}

/* ========================================================================== */
/* 4. Element pars, per location                                               */
/* ========================================================================== */

const P = table(resolve(PROD, '_elementpars.mer'), '_elementpars.mer', {
  key: { names: ['PrimaryKey'] },
  element_id: { names: ['element_id'] },
  location: { names: ['Location'] },
  par: { names: ['Par'] },
  yield: { names: ['Yield_c', 'Yield'] },
});

/**
 * "6x 1.5 GAL" → { count: 6, size: 1.5, unit: 'GAL' }
 * "10 BAGS"    → { count: 10, size: null, unit: 'BAGS' }
 * "8 ea."      → { count: 8,  size: null, unit: 'ea' }
 * "?"          → null, and the caller reports it.
 */
export function parseStockPar(raw) {
  const s = String(raw ?? '').trim().replace(/\.$/, '');
  if (!s || s === '?') return null;
  // count "x" size unit  — the "1x 22# tub" and "6x 1.5 GAL" forms
  let m = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:#\s*)?([A-Za-z.]+)?/i.exec(s);
  if (m) return { count: Number(m[1]), size: Number(m[2]), unit: blank(m[3]) };
  // count "x" unit — "1x 12 QT" already matched above; this is "2x Pans"
  m = /^(\d+(?:\.\d+)?)\s*x\s*([A-Za-z.]+)/i.exec(s);
  if (m) return { count: Number(m[1]), size: null, unit: blank(m[2]) };
  // count unit — "10 BAGS", "8 ea", "2 Pans", "22#"
  m = /^(\d+(?:\.\d+)?)\s*(?:#\s*)?([A-Za-z.]+)?$/i.exec(s);
  if (m) return { count: Number(m[1]), size: null, unit: blank(m[2]) };
  return null;
}

const elementLocations = [];
// 036 makes (element_id, location_id) unique, and MERGING DUPLICATE ELEMENTS
// CAN CREATE A COLLISION THAT DOES NOT EXIST IN THE SOURCE: FMP's two "Candied
// Peanuts" element rows each carry their own DF01 par, and once the two
// elements are one, so are their par rows. Found by replaying the real data
// through the real schema on the harness rather than by reading — the insert
// failed on row 471 of 530.
const elementLocationByPair = new Map();

for (const r of P.rows) {
  const element = elementByFmpId.get(P.g(r, 'element_id'));
  if (!element) {
    note(`_elementpars ${P.g(r, 'key')} names element ${P.g(r, 'element_id')}, which does not exist`);
    continue;
  }
  const code = blank(P.g(r, 'location'));
  if (!code) { note(`_elementpars ${P.g(r, 'key')} has no location`); continue; }

  const par = reps(P.g(r, 'par')).slice(0, 7).map((v) => num(v));
  const yld = reps(P.g(r, 'yield')).slice(0, 7).map((v) => num(v));
  while (par.length < 7) par.push(null);
  while (yld.length < 7) yld.push(null);

  const row = {
    legacy_id: `EL:${P.g(r, 'key')}`,
    element_legacy_id: element.legacy_id,
    location_code: code,
    par_by_weekday: par.some((v) => v !== null) ? par : null,
    yield_by_weekday: yld.some((v) => v !== null) ? yld : null,
    stock_count: null, stock_size: null, stock_unit: null,
  };

  const pair = `${element.legacy_id}|${code}`;
  const existing = elementLocationByPair.get(pair);
  if (existing) {
    // Fill what the first lacked; never overwrite a real value. Reported
    // whether or not the two agree, because a par is a number somebody chose.
    const differs = JSON.stringify(existing.par_by_weekday) !== JSON.stringify(row.par_by_weekday);
    existing.par_by_weekday ??= row.par_by_weekday;
    existing.yield_by_weekday ??= row.yield_by_weekday;
    note(`${element.name} @ ${code}: two par rows (${existing.legacy_id}, ${row.legacy_id})` +
      (differs ? ` — THEY DISAGREE, kept ${JSON.stringify(existing.par_by_weekday)}`
               : ' — identical, merged'));
    continue;
  }
  elementLocationByPair.set(pair, row);
  elementLocations.push(row);
}

// The free-text stock-up par lives on the ELEMENT in FMP (`currentPar_c` is a
// calculation of whichever location you are standing in), so it can only be
// attributed to a location we know. It goes onto every location row the element
// has; where it has none, it is reported rather than guessed at.
const unparsedPars = [];   // the text defeated the parser
const homelessPars = [];   // it parsed, but the element has no location row
for (const r of E.rows) {
  const element = elementByFmpId.get(E.g(r, 'id'));
  if (!element) continue;
  const raw = reps(E.g(r, 'par_packed')).find((v) => v && !/^\d+$/.test(v));
  if (!raw) continue;
  const parsed = parseStockPar(raw);
  if (!parsed) { unparsedPars.push(`${element.name}: "${raw}"`); continue; }
  const rows = elementLocations.filter((el) => el.element_legacy_id === element.legacy_id);
  if (!rows.length) {
    // Parsed fine, but FMP kept this par on the ELEMENT while `_elementpars`
    // has no row for it, so there is no shop to attribute it to. Inventing one
    // would put a par on a location that never agreed to it; the raw text stays
    // in the element's source_payload, so nothing is lost.
    homelessPars.push(`${element.name}: "${raw}"`);
    continue;
  }
  for (const el of rows) {
    el.stock_count ??= parsed.count;
    el.stock_size ??= parsed.size;
    el.stock_unit ??= parsed.unit;
  }
}

/* ========================================================================== */
/* 5. Settle `kind`                                                            */
/* ========================================================================== */
//
// Last, because it needs every pass: an element is `made` if a recipe family
// points at it, and otherwise the sources are consulted in order of how much
// each one actually claims.
//
// FMP's `cost_basis_t` is the most informative and its vocabulary needs
// reading rather than guessing (measured 2026-08-07):
//
//   Inventory 25 — ALL 25 carry an `_inventoryKey_t`. Bought in. → purchased
//   Recipes   35 — 33 name a recipe. Made from one. → made
//   Internal  68 — 45 name a recipe, 2 have an inventory key. "Internal" is
//                  FMP for "we make this ourselves" (Banana Ice Cream, Blue
//                  Glaze, Boysenberry Glaze). → made, NOT manual: reading it
//                  as a labor cost would put 68 zero-cost components into the
//                  BOM, which is worse than uncosted because it looks answered.
//   (blank)  121 — unclassified, and mostly not components at all: cleaning
//                  duties, bagging tasks, "Appliances - disinfect".

const familyByElement = new Map();
for (const fam of families.values()) {
  if (!familyByElement.has(fam.element_legacy_id)) familyByElement.set(fam.element_legacy_id, []);
  familyByElement.get(fam.element_legacy_id).push(fam);
}

for (const el of elements) {
  if (familyByElement.has(el.legacy_id)) { el.kind = 'made'; continue; }
  const basis = norm(el.source_payload?.cost_basis);
  if (basis === 'inventory') { el.kind = 'purchased'; continue; }
  if (basis === 'recipes' || basis === 'internal') { el.kind = 'made'; continue; }
  if (el.kind) continue;                                  // Recipe_Items said so
  if (el.vendor_item_legacy_key || el.source_payload?.inventory_key) { el.kind = 'purchased'; continue; }
  if (el.manual_cost !== null) { el.kind = 'manual'; continue; }
  // Nothing said. `manual` with no cost would claim a cost of zero;
  // `purchased` with no link is honestly uncosted and says so on screen.
  el.kind = 'purchased';
}

/* ========================================================================== */
/* 6. Report                                                                   */
/* ========================================================================== */

const versions = [...families.values()].flatMap((f) => f.versions);
const lines = versions.flatMap((v) => v.lines);
const steps = versions.flatMap((v) => v.steps);

console.log(`\n── ELEMENTS ──`);
console.log(`  ${E.rows.length} Production_Elements + ${I.rows.length} Recipe_Items → ${elements.length} elements`);
const byKind = new Map();
for (const el of elements) byKind.set(el.kind, (byKind.get(el.kind) ?? 0) + 1);
[...byKind].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    ${String(k).padEnd(10)} ${n}`));
console.log(`  ${elements.filter((e) => e.is_active).length} active, ${elements.filter((e) => !e.is_active).length} inactive`);
console.log(`  ${elements.filter((e) => e.vendor_item_legacy_key).length} carry a vendor-item key to resolve at load`);
console.log(`  ${elements.filter((e) => e.merged_legacy_ids.length).length} absorbed a duplicate`);
console.log(`  ${typeCollisions.size} distinct types`);

// What live costing will NOT be able to answer, and why — so the size of the
// catalog cleanup is visible on day one rather than discovered a screen at a
// time. A `purchased` element with no vendor key resolves to nothing; a `made`
// one with no recipe family has no lines to sum.
const uncosted = elements.filter((e) =>
  (e.kind === 'purchased' && !e.vendor_item_legacy_key && !e.source_payload?.inventory_key) ||
  (e.kind === 'made' && !familyByElement.has(e.legacy_id)) ||
  (e.kind === 'manual' && e.manual_cost === null));
console.log(`  ${uncosted.length} will resolve to NO cost (${uncosted.filter((e) => e.is_active).length} of them active)`);
const uncostedByType = new Map();
for (const e of uncosted.filter((x) => x.is_active)) {
  const k = e.element_type ?? '(none)';
  uncostedByType.set(k, (uncostedByType.get(k) ?? 0) + 1);
}
[...uncostedByType].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([t, n]) => console.log(`      ${String(t).padEnd(24)} ${n}`));

console.log(`\n── RECIPES ──`);
console.log(`  ${families.size} families, ${versions.length} versions (source: ${R.rows.length} rows)`);
console.log(`  master chosen by: FMP's flag ${masterReport.flag} · highest of several flags ${masterReport.severalFlags} · no flag at all ${masterReport.noFlag}`);
const viaCount = new Map();
for (const f of families.values()) viaCount.set(f.via ?? 'element created', (viaCount.get(f.via ?? 'element created') ?? 0) + 1);
[...viaCount].forEach(([v, n]) => console.log(`    linked via ${String(v).padEnd(26)} ${n}`));

if (orphanFamilies.length) {
  console.log(`\n── ${orphanFamilies.length} RECIPE FAMILIES HAD NO ELEMENT ──`);
  console.log(`  production_recipes.element_id is NOT NULL (decision 3), so an INACTIVE`);
  console.log(`  element was created for each. Activate or delete them deliberately:`);
  for (const f of orphanFamilies.slice(0, 40)) console.log(`    · ${f.name} (${f.versions.length} version${f.versions.length === 1 ? '' : 's'})`);
  if (orphanFamilies.length > 40) console.log(`    … and ${orphanFamilies.length - 40} more`);
}

console.log(`\n── RECIPE LINES ──`);
console.log(`  ${L.rows.length} source rows accounted for:`);
console.log(`    ${counts.ingredient} ingredient lines`);
console.log(`    ${counts.procedure} procedure steps`);
console.log(`    ${counts.magic} metadata rows lifted onto the version (mixer size / yield / prep time)`);
console.log(`    ${counts.separator} separators dropped`);
console.log(`    ${counts.empty} empty rows dropped`);
console.log(`    ${counts.orphan} orphans`);
const accounted = counts.ingredient + counts.procedure + counts.magic + counts.separator + counts.empty + counts.orphan;
if (accounted !== L.rows.length) fatal.push(`recipe lines: ${accounted} accounted for, ${L.rows.length} in the file`);
console.log(`  ${lines.filter((l) => !l.element_legacy_id).length} lines have no element (a note-shaped line: "pinch of salt")`);

if (scaleReport.length) {
  console.log(`\n── ${scaleReport.length} LINE(S) LOSE A HAND-TWEAKED SCALE COLUMN ──`);
  console.log(`  A line stores its BASE amount and the rest are computed, so these`);
  console.log(`  stored columns will render slightly differently. The raw strip is kept`);
  console.log(`  in source_payload, so nothing is unrecoverable:`);
  for (const s of scaleReport.slice(0, 25)) console.log(`    · ${s}`);
  if (scaleReport.length > 25) console.log(`    … and ${scaleReport.length - 25} more`);
}

console.log(`\n── ELEMENT PARS ──`);
console.log(`  ${P.rows.length} source rows → ${elementLocations.length} element-location rows`);
const byLoc = new Map();
for (const el of elementLocations) byLoc.set(el.location_code, (byLoc.get(el.location_code) ?? 0) + 1);
[...byLoc].forEach(([c, n]) => console.log(`    ${c}: ${n}`));
console.log(`  ${elementLocations.filter((e) => e.stock_count !== null).length} carry a parsed stock-up par`);
if (unparsedPars.length) {
  console.log(`\n  ${unparsedPars.length} free-text par(s) the parser REFUSED — left null rather than guessed:`);
  for (const u of unparsedPars.slice(0, 20)) console.log(`    · ${u}`);
  if (unparsedPars.length > 20) console.log(`    … and ${unparsedPars.length - 20} more`);
}
if (homelessPars.length) {
  console.log(`\n  ${homelessPars.length} par(s) parsed but have NO LOCATION ROW to sit on.`);
  console.log(`  FMP kept these on the element while _elementpars has no row for it, so`);
  console.log(`  there is no shop to attribute them to. The raw text is in the element's`);
  console.log(`  source_payload; set them per shop on the element screen.`);
  for (const u of homelessPars.slice(0, 12)) console.log(`    · ${u}`);
  if (homelessPars.length > 12) console.log(`    … and ${homelessPars.length - 12} more`);
}

/* -- identity -------------------------------------------------------------- */

console.log(`\n── IDENTITY ──`);
for (const [label, rows] of [
  ['elements', elements], ['families', [...families.values()]],
  ['versions', versions], ['lines', lines], ['steps', steps],
  ['element-locations', elementLocations],
]) {
  const ids = rows.map((r) => r.legacy_id);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const collisions = [...seen].filter(([, n]) => n > 1);
  console.log(`  ${String(label).padEnd(18)} ${String(rows.length).padStart(5)} rows, ${new Set(ids).size} distinct legacy_id`);
  if (collisions.length) {
    // Refuse the WHOLE run rather than letting the unique index reject batch 47
    // of 94 and leave the table half loaded.
    fatal.push(`${label}: ${collisions.length} legacy_id collisions, e.g. ${collisions.slice(0, 3).map(([id, n]) => `${id}x${n}`).join(', ')}`);
  }
}
// Every family must end with exactly one master, which is 036's partial index.
const badMasters = [...families.values()].filter((f) => f.versions.filter((v) => v.is_master).length !== 1);
if (badMasters.length) fatal.push(`${badMasters.length} families do not have exactly one master, e.g. ${badMasters.slice(0, 3).map((f) => f.name).join(', ')}`);
// element_id is NOT NULL.
const unlinked = [...families.values()].filter((f) => !f.element_legacy_id);
if (unlinked.length) fatal.push(`${unlinked.length} families still have no element`);

if (problems.length) {
  console.log(`\n── ${problems.length} NOTE(S) ──`);
  for (const p of problems.slice(0, 40)) console.log(`  · ${p}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

if (fatal.length) {
  console.error(`\n── REFUSING TO WRITE ──`);
  for (const f of fatal) console.error(`  x ${f}`);
  console.error('');
  process.exit(1);
}

/* ========================================================================== */
/* 7. Write                                                                    */
/* ========================================================================== */

const payload = {
  elements: elements.map(({ merged_legacy_ids, ...e }) => ({
    ...e,
    source_payload: { ...e.source_payload, merged_legacy_ids: merged_legacy_ids.length ? merged_legacy_ids : undefined },
  })),
  element_locations: elementLocations,
  recipes: [...families.values()].map((f) => ({
    legacy_id: f.legacy_id,
    name: f.name,
    element_legacy_id: f.element_legacy_id,
    recipe_type: f.recipe_type,
    is_active: f.is_active,
    source: 'filemaker',
    versions: f.versions.map(({ fmp_key, fmp_master, ...v }) => v),
  })),
};

console.log(`\n${payload.elements.length} elements · ${payload.element_locations.length} element-locations · ` +
  `${payload.recipes.length} recipes · ${versions.length} versions · ${lines.length} lines · ${steps.length} steps`);

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --write.\n`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nWrote ${OUT}\n`);
