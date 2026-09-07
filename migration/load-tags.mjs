/**
 * Load FileMaker's DisplaySigns table — 86 records — into `display_tags` (095)
 * and file each exported background under it, one per size.
 *
 * Source: `../../FMP Export/Operations/Tags/tags.mer` and the images in
 * `~/Desktop/fmpdocs/` (or `--dir <path>`), which FileMaker named
 * `{Title}_{2x3.5|2x8|2x10}_{original}` — so a file is matched to its record
 * by TITLE and SIZE. Two records share the title "The Jelly Sound" and two
 * file sets exist for it; the k-th record with a title (in .mer order) takes
 * the k-th file per size (by name) and the assignment is printed.
 *
 * The donut link is `production_items.legacy_id = 'PI:' + DonutID`, verbatim
 * (ids are zero-padded: "PI:09"). Five records carry a DonutID that resolves
 * to nothing — they load UNLINKED and are named. A record whose title shares
 * no word with the item it points at is flagged too (one "Jelly Sound" points
 * at Lemon At Work).
 *
 * PDF backgrounds (22 files) are rasterised at 300 dpi with poppler's
 * `pdftoppm` — page 1 only; some carry a stray letter-size page 2 — and the
 * PNG is what goes up. The app itself refuses a PDF, so this is the only
 * route one ever takes.
 *
 * Idempotent on `(org_id, legacy_id)` for the record and `(tag_id, size)` for
 * the file. Dry run by default.
 *
 *   node --env-file=.env load-tags.mjs
 *   node --env-file=.env load-tags.mjs --apply [--dir ~/Desktop/fmpdocs]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const dirArg = process.argv.indexOf("--dir");
const DIR = path.resolve(
  (dirArg > -1 ? process.argv[dirArg + 1] : "~/Desktop/fmpdocs").replace(/^~/, os.homedir())
);
const MER = path.resolve("../../FMP Export/Operations/Tags/tags.mer");
const BUCKET = "display-tags";
const SIZES = ["2x3.5", "2x8", "2x10"];
const PDFTOPPM = ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"].find((p) => fs.existsSync(p));

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseMer(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const text = (s) => (s ? s.replace(/\x0b/g, "\n").trim() || null : null);
// "1/1/2023 5:20:51 PM" → an ISO instant. FileMaker's clock is the shop's
// (Pacific); the offset is read from the org's timezone so the day is right.
function usTimestamp(s, timeZone) {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[7] === "PM") h += 12;
  const wall = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6]));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(wall)).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return new Date(wall - (asLocal - wall)).toISOString();
}
const mime = (f) => (/\.png$/i.test(f) ? "image/png" : /\.jpe?g$/i.test(f) ? "image/jpeg" : "application/pdf");
const words = (s) => new Set((s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and"].includes(w)));

const rows = parseMer(fs.readFileSync(MER, "utf8"));
const files = fs.readdirSync(DIR).filter((f) => !f.startsWith("."));
console.log(`${rows.length} records, ${files.length} files in ${DIR}`);

const { data: orgs } = await db.from("orgs").select("id, settings").limit(1);
const orgId = orgs[0].id;
const timeZone = orgs[0].settings?.timezone ?? "America/Los_Angeles";
const { data: items } = await db.from("production_items").select("id, name, legacy_id").eq("org_id", orgId);
const itemByLegacy = new Map(items.map((i) => [i.legacy_id, i]));

// Files by title → size → sorted names.
const bySize = new Map();
const unparsed = [];
for (const f of files) {
  const m = f.match(/^(.*)_(2x3\.5|2x8|2x10)_(.*)$/);
  if (!m) { unparsed.push(f); continue; }
  const [, title, size] = m;
  if (!bySize.has(title)) bySize.set(title, new Map());
  const s = bySize.get(title);
  s.set(size, [...(s.get(size) ?? []), f].sort());
}
if (unparsed.length) console.log("UNPARSED FILE NAMES:", unparsed);

const seenTitle = new Map();
const claimed = new Set();
const plan = [];
let linked = 0;
for (const r of rows) {
  const title = r.Title.trim();
  const k = seenTitle.get(title) ?? 0;
  seenTitle.set(title, k + 1);
  const item = r.DonutID ? itemByLegacy.get(`PI:${r.DonutID}`) ?? null : null;
  if (r.DonutID && !item) console.log(`  ? "${title}" — DonutID ${r.DonutID} resolves to no production item; loading unlinked`);
  if (!r.DonutID) console.log(`  ? "${title}" — no DonutID; loading unlinked`);
  if (item) {
    linked++;
    const shared = [...words(title)].some((w) => words(item.name).has(w));
    if (!shared) console.log(`  ! "${title}" — DonutID ${r.DonutID} is "${item.name}"; check the link on the record`);
  }
  const slots = {};
  for (const size of SIZES) {
    const list = bySize.get(title)?.get(size) ?? [];
    const f = list[k] ?? null;
    if (f) { slots[size] = f; claimed.add(f); }
  }
  if (k > 0) console.log(`  = "${title}" #${k + 1} (DonutID ${r.DonutID}) takes ${Object.values(slots).join(" | ") || "nothing"}`);
  plan.push({
    row: {
      org_id: orgId, legacy_id: r.PrimaryKey, title, description: text(r.Description),
      production_item_id: item?.id ?? null, source: "filemaker", source_payload: r,
      created_at: usTimestamp(r.CreationTimestamp, timeZone) ?? undefined,
      updated_at: usTimestamp(r.ModificationTimestamp, timeZone) ?? undefined,
    },
    slots, item,
  });
}
for (const [title, sizes] of bySize) {
  for (const [size, list] of sizes) {
    const n = seenTitle.get(title) ?? 0;
    if (list.length > n) throw new Error(`"${title}" has ${list.length} ${size} files for ${n} record(s)`);
  }
}
const unclaimed = files.filter((f) => !claimed.has(f) && !unparsed.includes(f));
const pdfCount = plan.reduce((n, p) => n + Object.values(p.slots).filter((f) => /\.pdf$/i.test(f)).length, 0);
for (const p of plan) {
  const marks = SIZES.map((s) => `${s.replace("2x", "")} ${p.slots[s] ? (/\.pdf$/i.test(p.slots[s]) ? "✓(pdf)" : "✓") : "—"}`).join("  ");
  console.log(`${Object.keys(p.slots).length ? "+" : " "} ${p.row.title.padEnd(30)} [${p.item ? "item ✓" : "unlinked"}]  ${marks}`);
}
console.log(`${plan.length} records, ${linked} linked, ${plan.length - linked} unlinked; ${claimed.size} files claimed, ${unclaimed.length} unclaimed, ${pdfCount} to rasterise`);
if (unclaimed.length) console.log("UNCLAIMED FILES:", unclaimed);
if (!APPLY) { console.log("\n(dry run — nothing written. Re-run with --apply)"); process.exit(0); }
if (pdfCount > 0 && !PDFTOPPM) throw new Error("pdftoppm not found — `brew install poppler`");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tags-"));
let filed = 0;
for (const p of plan) {
  const { data, error } = await db.from("display_tags").upsert(p.row, { onConflict: "org_id,legacy_id" }).select("id").single();
  if (error) throw new Error(`${p.row.title}: ${error.message}`);
  for (const size of SIZES) {
    const f = p.slots[size];
    if (!f) continue;
    const { count } = await db.from("display_tag_images").select("id", { count: "exact", head: true }).eq("tag_id", data.id).eq("size", size);
    if (count > 0) continue;
    let bytes, ext, contentType, original = f.slice(f.indexOf(`_${size}_`) + `_${size}_`.length);
    if (/\.pdf$/i.test(f)) {
      const out = path.join(scratch, crypto.randomUUID());
      execFileSync(PDFTOPPM, ["-r", "300", "-png", "-f", "1", "-l", "1", "-singlefile", path.join(DIR, f), out]);
      bytes = fs.readFileSync(`${out}.png`); ext = ".png"; contentType = "image/png";
      original = original.replace(/\.pdf$/i, ".png");
    } else {
      bytes = fs.readFileSync(path.join(DIR, f)); ext = path.extname(f).toLowerCase(); contentType = mime(f);
    }
    const key = `${orgId}/${data.id}/${crypto.randomUUID()}${ext}`;
    const up = await db.storage.from(BUCKET).upload(key, bytes, { contentType });
    if (up.error) throw new Error(`${f}: ${up.error.message}`);
    const ins = await db.from("display_tag_images").insert({
      org_id: orgId, tag_id: data.id, size, storage_path: key, file_name: original, content_type: contentType, byte_size: bytes.length,
    }).select("id");
    if (ins.error) throw new Error(`${f}: ${ins.error.message}`);
    filed++;
  }
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(`loaded ${plan.length} tags, filed ${filed} backgrounds`);
