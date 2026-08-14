/**
 * Make labour a component: point every recipe's "Prep Time" row at the Prep
 * Time ELEMENT, and seed that element's per-shop rate from
 * `locations.labor_rate`.
 *
 * Mark, 2026-08-13: "instead of having a single labor cost as part of the
 * location table, we make it an element that can be added to recipes as an
 * ingredient and production items as a component … Then we would need to
 * convert or swap the current Prep Time row in recipes to use the Prep Time
 * element instead."
 *
 * ---------------------------------------------------------------------------
 * ONE ROW ENDS UP DOING BOTH JOBS, which is why this is a conversion and not an
 * insertion. The "Prep Time" row already carries the hours and already prints
 * on the recipe sheet; all it gains is an `element_id`. Adding a SECOND line
 * for the cost would put the same fact in two places, which is the disease that
 * killed `base_element_id` a day earlier.
 *
 * IT DOES NOT TOUCH THE HOURS, and must not. All 31 versions carrying prep
 * hours have them TYPED PER COLUMN (041's AUTO switch off), which is how a
 * recipe says "half an hour at the test batch, 0.7 at x1". `laborResolver`
 * reads that strip through `columnCell`; rewriting or clearing it would scale
 * labour like flour, and 30 of the 31 would then be charged wrongly — one
 * billing 24 hours for a half-hour job.
 *
 * THE RATE IS SEEDED, NOT MOVED. `locations.labor_rate` is left in place: it is
 * the source this copies from, and deleting the source in the same breath as
 * the copy leaves nothing to check the copy against. Retire it once the rates
 * have been read in anger.
 *
 * Idempotent: a prep row that already points at an element is skipped, and the
 * rates upsert.
 *
 *   node --env-file=.env backfill-labor-elements.mjs          # dry run
 *   node --env-file=.env backfill-labor-elements.mjs --apply
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const LABOR_TYPE = "Labor";
/** The element the prep rows are pointed at. Mark created three typed `Labor`
 *  ("Prep Time", "Labor", "Expected Labor"); this is the one whose NAME matches
 *  what the rows are called, so the sheet reads the same after as before. */
const TARGET = "Prep Time";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function all(table, select, order = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table).select(select).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const [elements, locations, versions, lines] = await Promise.all([
  all("production_elements", "id, org_id, name, kind, element_type, manual_cost, manual_cost_unit"),
  all("locations", "id, org_id, code, labor_rate"),
  all("production_recipe_versions", "id, is_master"),
  all("production_recipe_lines", "id, version_id, label, qty, unit, element_id"),
]);

const labourElements = elements.filter(
  (e) => (e.element_type ?? "").trim().toLowerCase() === LABOR_TYPE.toLowerCase()
);
const target = labourElements.find((e) => e.name.trim() === TARGET);

console.log(`elements typed "${LABOR_TYPE}": ${labourElements.length}`);
for (const e of labourElements) {
  console.log(`   ${e.name.padEnd(16)} kind=${e.kind}  ${e.manual_cost ?? "—"} / ${e.manual_cost_unit ?? "—"}`);
}
if (!target) {
  console.error(`\nNo element named "${TARGET}" typed "${LABOR_TYPE}". Nothing to point rows at.`);
  process.exit(1);
}
if (target.kind !== "manual") {
  console.error(`\n"${TARGET}" is kind=${target.kind}; a labour element must be MANUAL to carry a rate.`);
  process.exit(1);
}
if ((target.manual_cost_unit ?? "").trim().toLowerCase() !== "hr") {
  console.error(
    `\n"${TARGET}" is priced per "${target.manual_cost_unit}". The rows carry HOURS, and ` +
      `lib/units has no time family — a line in "hr" against an element priced per anything ` +
      `else reports "incompatible units" and costs nothing.`
  );
  process.exit(1);
}

/* -- 1. the per-shop rates -------------------------------------------------- */

const rates = locations
  .filter((l) => l.labor_rate !== null)
  .map((l) => ({
    org_id: l.org_id,
    element_id: target.id,
    location_id: l.id,
    cost: Number(l.labor_rate),
    _code: l.code,
  }));

console.log(`\nrates to seed from locations.labor_rate: ${rates.length}`);
console.log(`   ${rates.map((r) => `${r._code}=$${r.cost}`).join("  ")}`);
const noRate = locations.filter((l) => l.labor_rate === null);
if (noRate.length) {
  console.log(`   no rate, so they fall back to the element's $${target.manual_cost}: ` +
    noRate.map((l) => l.code).join(", "));
}

/* -- 2. the prep rows ------------------------------------------------------- */

const masters = new Set(versions.filter((v) => v.is_master).map((v) => v.id));
const prep = lines.filter((l) => (l.label ?? "").trim().toLowerCase() === "prep time");
const toPoint = prep.filter((l) => !l.element_id && l.qty !== null);
const already = prep.filter((l) => l.element_id).length;
const noHours = prep.filter((l) => !l.element_id && l.qty === null);

console.log(`\n"Prep Time" rows: ${prep.length}   (${prep.filter((l) => masters.has(l.version_id)).length} on master versions)`);
console.log(`   already pointing at an element : ${already}`);
console.log(`   to convert                     : ${toPoint.length}`);
console.log(`   carrying NO hours, left alone  : ${noHours.length}`);

const units = new Map();
for (const l of toPoint) units.set(l.unit ?? "(none)", (units.get(l.unit ?? "(none)") ?? 0) + 1);
console.log(`   units on those rows            : ${[...units].map(([k, v]) => `${k}:${v}`).join("  ")}`);

// A row in anything but hours would cost nothing once it points at an hourly
// element — `convert` refuses across families, and there is no time family at
// all, so "min" simply cannot reach "hr".
const wrongUnit = toPoint.filter((l) => (l.unit ?? "").trim().toLowerCase() !== "hr");
if (wrongUnit.length) {
  console.log(`\n   ${wrongUnit.length} row(s) are NOT in "hr" and would report ` +
    `"incompatible units" — left alone:`);
  for (const l of wrongUnit.slice(0, 5)) console.log(`      line ${l.id} in "${l.unit}"`);
}
const convertible = toPoint.filter((l) => (l.unit ?? "").trim().toLowerCase() === "hr");

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Would seed ${rates.length} rates and convert ` +
    `${convertible.length} rows. Re-run with --apply.`);
  process.exit(0);
}

const { error: rateErr } = await supabase
  .from("production_element_location_costs")
  .upsert(rates.map(({ _code, ...r }) => r), { onConflict: "element_id,location_id" });
if (rateErr) throw new Error(`rates: ${rateErr.message}`);
console.log(`\nSEEDED ${rates.length} per-shop rates.`);

let done = 0;
for (const line of convertible) {
  // ONLY `element_id`. The hours, the unit and the typed per-column strip are
  // what the recipe says and this has no business rewriting any of them.
  const { data, error } = await supabase
    .from("production_recipe_lines")
    .update({ element_id: target.id })
    .eq("id", line.id)
    .select("id");
  if (error) throw new Error(`line ${line.id}: ${error.message}`);
  done += (data ?? []).length;
}
console.log(`CONVERTED ${done} prep rows to the "${TARGET}" element.`);
console.log(`\n\`locations.labor_rate\` is untouched — it is the source these came from.`);
