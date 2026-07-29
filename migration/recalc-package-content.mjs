#!/usr/bin/env node
/**
 * Restaurant Friend — restate every vendor item's package_content from its pack.
 *
 * `package_content` is the pack expressed in the inventory item's base unit, and
 * it is what the ordering math divides by: count mode's suggested quantity, the
 * guide's unit price, and (since 2026-07-29) the par restated in packages. The
 * pack structure beside it — pack_count × pack_size pack_unit — was restored
 * from the raw FMP export field-by-field by migration 010 and backfill-pack.mjs,
 * so where the two disagree the PACK is the trustworthy side and the content is
 * what the original load got wrong.
 *
 * It got it wrong in one specific way: a factor-of-16 lbs/oz confusion. A
 * "1 × 5 lbs" bag on a `lbs` item stores 80 — five pounds written in ounces —
 * and a "1 × 2.2 lbs" tub on an `oz` item stores 2.2, the same error inverted.
 *
 * Only rows whose pack CAN be converted into the base unit are touched. Where
 * the pack names a unit in a different family — a 12 × 16 oz case on an item
 * counted in `ea` — no arithmetic can settle it (the missing fact is "one bottle
 * is one each"), so the row is skipped and left for a human. /cleanup's
 * "package content doesn't match the pack" check is what surfaces those.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env recalc-package-content.mjs            # dry run
 *     node --env-file=.env recalc-package-content.mjs --apply    # write
 *
 * --apply writes a before/after JSON beside the script first. There is no
 * history trigger on package_content (only price and par have one), so that
 * file is the only record of the old values — though every one of them is
 * re-derivable from the pack, which is the whole premise.
 *
 * Idempotent: a second --apply reports 0 changes.
 *
 * The conversion table lives in web/src/lib/units.ts and is NOT duplicated here
 * — the script bundles it at run time, so there is one definition of what an
 * ounce is. That requires the web/ node_modules (esbuild); the script says so
 * and exits if it can't.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../web');
const APPLY = process.argv.includes('--apply');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env recalc-package-content.mjs'
  );
  process.exit(1);
}

// Bundle the app's own derivedPackContent so the arithmetic can't drift from
// what the screens do.
const BUNDLE = resolve(HERE, '.catalog-bundle.mjs');
if (!existsSync(resolve(WEB, 'node_modules'))) {
  console.error(`No web/node_modules at ${WEB} — run npm install in web/ first.`);
  process.exit(1);
}
const UNITS_BUNDLE = resolve(HERE, '.units-bundle.mjs');
for (const [src, out] of [
  ['src/lib/catalog.ts', BUNDLE],
  ['src/lib/units.ts', UNITS_BUNDLE],
]) {
  execFileSync(
    'npx',
    ['esbuild', src, '--bundle', '--format=esm', '--platform=node',
     `--outfile=${out}`, '--log-level=error'],
    { cwd: WEB, stdio: 'inherit' }
  );
}
const { derivedPackContent } = await import(BUNDLE);
const { unitFamily } = await import(UNITS_BUNDLE);
rmSync(BUNDLE, { force: true });
rmSync(UNITS_BUNDLE, { force: true });

const db = createClient(url, key, { auth: { persistSession: false } });

/** Equal allowing for float wobble and the column's numeric(10,3) rounding. */
const near = (a, b) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.001);

let vendorItems = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('vendor_items')
    .select(
      'id, package_content, pack_count, pack_size, pack_unit, is_active, ' +
        'inventory_items!inner ( name, base_unit ), vendors ( name )'
    )
    .range(from, from + 999);
  if (error) throw error;
  vendorItems = vendorItems.concat(data);
  if (data.length < 1000) break;
}

const plan = [];
const skipped = { notDerivable: 0, alreadyRight: 0, noPackUnit: [] };
for (const vi of vendorItems) {
  const baseUnit = vi.inventory_items?.base_unit;
  if (!baseUnit) continue;

  /**
   * A missing pack_unit is NOT the base unit, whatever derivedPackContent's
   * display-oriented `?? baseUnit` fallback assumes. UNFI's rice milk is
   * "8 x 64" with no unit on a `lbs` item: its siblings are 12 x 32 oz holding
   * 24 lbs, so those are 64-OUNCE cartons and the honest answer is 32 lbs, not
   * the 512 the fallback produces. Writing that would be 16x high, and worse,
   * it would then agree with its own pack and the cleanup check would go quiet
   * on it.
   *
   * The one case where a missing unit is safe is a COUNT base unit: "1 x 24" on
   * an `ea` item is 24 each however you read it, because the multiplication is
   * unit-free. Everything else is a guess and gets left alone.
   */
  const packUnit = vi.pack_unit?.trim();
  if (!packUnit && unitFamily(baseUnit) !== 'count') {
    if (vi.pack_size !== null && vi.pack_size !== undefined) {
      skipped.noPackUnit.push({
        item: vi.inventory_items.name,
        vendor: vi.vendors?.name ?? null,
        pack: `${Number(vi.pack_count ?? 1)} x ${Number(vi.pack_size)} (no unit)`,
        base_unit: baseUnit,
        content: vi.package_content === null ? null : Number(vi.package_content),
        would_have_written: derivedPackContent(vi, baseUnit),
      });
    }
    continue;
  }

  const derived = derivedPackContent(vi, baseUnit);
  if (derived === null) {
    skipped.notDerivable++;
    continue;
  }
  const before = vi.package_content === null ? null : Number(vi.package_content);
  if (before !== null && near(before, derived)) {
    skipped.alreadyRight++;
    continue;
  }
  plan.push({
    id: vi.id,
    item: vi.inventory_items.name,
    vendor: vi.vendors?.name ?? null,
    is_active: vi.is_active,
    base_unit: baseUnit,
    pack: `${Number(vi.pack_count ?? 1)} x ${Number(vi.pack_size)} ${vi.pack_unit ?? baseUnit}`,
    before,
    after: derived,
  });
}

console.log(`vendor items scanned      ${vendorItems.length}`);
console.log(`  already correct         ${skipped.alreadyRight}`);
console.log(`  pack can't convert      ${skipped.notDerivable}  (left for a human)`);
console.log(`  pack has NO unit        ${skipped.noPackUnit.length}  (measure item — won't guess)`);
console.log(`  to change               ${plan.length}`);
console.log(`     filled from null     ${plan.filter((p) => p.before === null).length}`);
console.log(`     overwritten          ${plan.filter((p) => p.before !== null).length}\n`);

for (const p of plan) {
  console.log(
    `  ${p.is_active ? 'active  ' : 'INACTIVE'} ${String(p.item).slice(0, 28).padEnd(29)}` +
      ` ${String(p.vendor ?? '').slice(0, 18).padEnd(19)} ${p.pack.padEnd(14)}` +
      ` base=${p.base_unit.padEnd(4)} ${p.before === null ? 'null' : p.before} -> ${Number(p.after.toFixed(3))}`
  );
}

if (skipped.noPackUnit.length > 0) {
  console.log(`\n=== SKIPPED: pack has no unit and the item is measured, not counted ===`);
  console.log(`    Fix pack_unit on these, then re-run. Set it and the Recalc button`);
  console.log(`    on the vendor item page will offer the right number.`);
  for (const s of skipped.noPackUnit)
    console.log(
      `  ${String(s.item).slice(0, 28).padEnd(29)} ${String(s.vendor ?? '').slice(0, 18).padEnd(19)}` +
        ` ${s.pack.padEnd(18)} base=${s.base_unit.padEnd(4)} content=${s.content}` +
        `  (would have written ${s.would_have_written})`
    );
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Re-run with --apply to write.`);
  process.exit(0);
}
if (plan.length === 0) {
  console.log(`\nNothing to do.`);
  process.exit(0);
}

const stamp = process.env.BACKUP_STAMP ?? 'latest';
const backup = resolve(HERE, `package_content-before-${stamp}.json`);
writeFileSync(backup, JSON.stringify({ target: url, rows: plan.length, plan }, null, 2));
console.log(`\nbefore/after written to ${backup}`);

let updated = 0;
const failed = [];
for (const p of plan) {
  const { error } = await db
    .from('vendor_items')
    .update({ package_content: p.after })
    .eq('id', p.id);
  if (error) failed.push({ ...p, error: error.message });
  else updated++;
}
console.log(`updated ${updated} / ${plan.length}`);
for (const f of failed) console.log(`  FAILED ${f.item} (${f.vendor}): ${f.error}`);

// Read every touched row back rather than trusting the write.
let verified = 0;
const mismatched = [];
for (const p of plan) {
  const { data, error } = await db
    .from('vendor_items')
    .select('package_content')
    .eq('id', p.id)
    .single();
  if (error) {
    mismatched.push({ ...p, got: `read error: ${error.message}` });
    continue;
  }
  const got = Number(data.package_content);
  if (near(got, p.after)) verified++;
  else mismatched.push({ ...p, got });
}
console.log(`verified ${verified} / ${plan.length}`);
for (const m of mismatched) console.log(`  MISMATCH ${m.item}: expected ${m.after}, got ${m.got}`);
process.exit(failed.length || mismatched.length ? 1 : 0);
