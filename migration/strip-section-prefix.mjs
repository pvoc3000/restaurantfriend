#!/usr/bin/env node
/**
 * Restaurant Friend — drop FileMaker's leading number from shop section names.
 *
 * "09 Walk In Unknown" becomes "Walk In Unknown" (Mark, 2026-08-02), at DF01
 * and DF02 only.
 *
 * The number was FileMaker's way of ordering the walk inside a text field.
 * This schema has a real `sort_order` column and the order guide sorts by it,
 * so the prefix is duplication that has to be kept in step by hand — rename a
 * shelf's position and the name lies.
 *
 * WHAT IT WILL NOT DO, and why each guard is here:
 *
 *   - `display_name` is UNIQUE per location (migration 017) and it is the key
 *     the order guide GROUPS by. Two names that differ only by their prefix
 *     would collide into one row and the second update would be refused. The
 *     script detects collisions BEFORE writing anything and refuses the whole
 *     run — a half-applied rename is worse than none.
 *   - A name that is nothing but a number would be emptied. Also refused.
 *   - Locations other than DF01 and DF02 are never read or written.
 *
 * Run from the migration/ folder:
 *     node --env-file=.env strip-section-prefix.mjs            # dry run
 *     node --env-file=.env strip-section-prefix.mjs --apply    # write
 *
 * Idempotent: a second --apply finds no prefixes left and changes nothing.
 *
 * REVERSIBLE, but only by hand — the prefix was zero-padded from `sort_order`,
 * so `printf('%02d ', sort_order) || display_name` reconstructs it for the rows
 * whose prefix agreed with their sort order. The dry run prints any that
 * disagree; those are the ones you could not put back automatically.
 */
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const CODES = ['DF01', 'DF02'];

/** Digits at the very start, then whitespace. Anchored, so "R1 S2" is safe and
 *  a number in the middle of a name is never touched. */
const PREFIX = /^\s*(\d+)\s+/;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env strip-section-prefix.mjs'
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: locs, error: locError } = await db
  .from('locations')
  .select('id, code')
  .in('code', CODES);
if (locError) throw locError;
const codeById = new Map(locs.map((l) => [l.id, l.code]));

const { data: rows, error } = await db
  .from('shop_sections')
  .select('id, location_id, display_name, sort_order')
  .in('location_id', [...codeById.keys()])
  .order('sort_order');
if (error) throw error;

/** Items filed under each section, so a reported collision says what is at
 *  stake rather than just naming two strings. PAGINATED — PostgREST caps a
 *  page at 1000 and a truncated count reads as a real one. */
const itemCount = new Map();
for (const locId of codeById.keys()) {
  for (let from = 0; ; from += 1000) {
    const { data, error: countError } = await db
      .from('inventory_item_locations')
      .select('shop_section_id')
      .eq('location_id', locId)
      .not('shop_section_id', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (countError) throw countError;
    for (const row of data) {
      itemCount.set(row.shop_section_id, (itemCount.get(row.shop_section_id) ?? 0) + 1);
    }
    if (data.length < 1000) break;
  }
}
const items = (id) => itemCount.get(id) ?? 0;

let refuse = false;
const writes = [];
const merges = [];

for (const code of CODES) {
  const mine = rows.filter((r) => codeById.get(r.location_id) === code);
  const changed = [];
  const untouched = [];

  for (const r of mine) {
    const m = r.display_name.match(PREFIX);
    if (!m) {
      untouched.push(r);
      continue;
    }
    changed.push({ ...r, next: r.display_name.replace(PREFIX, '').trim(), prefix: m[1] });
  }

  // The name each row would END UP with — including the ones we aren't
  // touching, because a stripped name can just as easily collide with one that
  // never had a prefix.
  const after = new Map();
  for (const r of mine) {
    const next = r.display_name.replace(PREFIX, '').trim() || r.display_name;
    after.set(next, [...(after.get(next) ?? []), r]);
  }
  const collisions = [...after.entries()].filter(([, v]) => v.length > 1);
  const emptied = changed.filter((r) => r.next === '');
  const disagree = changed.filter((r) => Number(r.prefix) !== Number(r.sort_order));

  console.log(`\n=== ${code} — ${mine.length} sections ===`);
  console.log(`  would change        : ${changed.length}`);
  console.log(`  already unprefixed  : ${untouched.length}`);
  console.log(`  collisions          : ${collisions.length}`);
  console.log(`  emptied by the strip: ${emptied.length}`);
  console.log(`  prefix != sort_order: ${disagree.length}  (not reversible automatically)`);

  if (collisions.length) {
    console.log('  -- COLLISIONS, resolved by merging (display_name is unique per location):');
    for (const [next, from] of collisions) {
      // The survivor is the one holding the real WALK POSITION — the lowest
      // sort_order. 999 is the sentinel the unprefixed twins all carry, which
      // is the tell that they were added later and dumped at the end.
      //
      // Ties break on item count, which only DF01 needs: its pair is one shelf
      // typed twice with a double space, both at sort 39, 77 items against 1.
      const ranked = [...from].sort(
        (a, b) => Number(a.sort_order) - Number(b.sort_order) || items(b.id) - items(a.id)
      );
      const [survivor, ...losers] = ranked;
      if (from.length > 2) {
        refuse = true;
        console.log(`     !! "${next}" is a ${from.length}-way collision — not handled.`);
        continue;
      }
      console.log(`     "${next}"`);
      console.log(
        `        KEEP  "${survivor.display_name}"  sort=${survivor.sort_order}  ${items(survivor.id)} item(s)`
      );
      for (const l of losers) {
        console.log(
          `        MERGE "${l.display_name}"  sort=${l.sort_order}  ${items(l.id)} item(s)  -> then deleted`
        );
        merges.push({ code, survivor, loser: l, moving: items(l.id) });
      }
    }
  }
  if (emptied.length) {
    refuse = true;
    console.log('  !! these are nothing but a number:');
    for (const r of emptied) console.log(`     "${r.display_name}"`);
  }
  if (disagree.length) {
    console.log('  -- prefix disagrees with sort_order (first 10):');
    for (const r of disagree.slice(0, 10)) {
      console.log(`     sort=${r.sort_order} prefix=${r.prefix}  "${r.display_name}"`);
    }
  }

  console.log('  -- sample:');
  for (const r of changed.slice(0, 10)) console.log(`     "${r.display_name}"  ->  "${r.next}"`);
  if (untouched.length) {
    console.log('  -- left alone (first 10):');
    for (const r of untouched.slice(0, 10)) console.log(`     "${r.display_name}"`);
  }

  writes.push(...changed);
}

if (refuse) {
  console.error('\nREFUSING to write — resolve the problems above first. Nothing changed.');
  process.exit(1);
}

const moving = merges.reduce((n, m) => n + m.moving, 0);
console.log(
  `\n${merges.length} section(s) to merge (${moving} item-location(s) moved), ` +
    `then ${writes.length - merges.filter((m) => PREFIX.test(m.loser.display_name)).length} rename(s).`
);
if (!APPLY) {
  console.log('Dry run. Re-run with --apply to write.');
  process.exit(0);
}

// ---- 1. MERGE ------------------------------------------------------------
// Items FIRST, then the section. The FK is `on delete set null`, so deleting a
// section that still holds items doesn't fail — it quietly orphans them to
// "No section" on the order guide. Doing it in this order means a failure
// halfway leaves an empty duplicate section, which is visible and harmless.
const deleted = new Set();
for (const m of merges) {
  if (m.moving > 0) {
    const { error: moveError } = await db
      .from('inventory_item_locations')
      .update({ shop_section_id: m.survivor.id })
      .eq('shop_section_id', m.loser.id);
    if (moveError) {
      console.error(`\nFAILED moving items off "${m.loser.display_name}": ${moveError.message}`);
      process.exit(1);
    }
  }
  const { error: delError } = await db.from('shop_sections').delete().eq('id', m.loser.id);
  if (delError) {
    console.error(`\nFAILED deleting "${m.loser.display_name}": ${delError.message}`);
    process.exit(1);
  }
  deleted.add(m.loser.id);
  console.log(`  merged "${m.loser.display_name}" into "${m.survivor.display_name}" (${m.moving} item(s))`);
}

// ---- 2. RENAME -----------------------------------------------------------
let done = 0;
for (const r of writes) {
  if (deleted.has(r.id)) continue; // merged away a moment ago
  const { error: writeError } = await db
    .from('shop_sections')
    .update({ display_name: r.next })
    .eq('id', r.id);
  if (writeError) {
    console.error(`\nFAILED on "${r.display_name}" (${r.id}): ${writeError.message}`);
    console.error(`Stopped after ${done} successful renames.`);
    process.exit(1);
  }
  done += 1;
}
console.log(`Merged ${merges.length}, renamed ${done} shop sections.`);
