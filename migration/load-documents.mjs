/**
 * Load FileMaker's Documents table — 73 records — into `org_documents` (094)
 * and file each exported document under it.
 *
 * Source: `../../FMP Export/Operations/Documents/Documents.mer` and the files
 * in `…/fmpdocs/`, which FileMaker named `{shop}_{category}_{title}_{version}_
 * {original}` — the record's own fields, so each file is matched to its
 * record by that exact prefix (`lib/orgDocuments.exportPrefix`, restated here
 * because a loader cannot import from `web/`). A record with several files
 * under one prefix (the 4-up and single ice cream signs share every field)
 * is told apart by DISAMBIGUATE below. Nine records have no file on disk.
 *
 * Idempotent on `(org_id, legacy_id)`; a file is uploaded only where the
 * record has none. Dry run by default.
 *
 *   node --env-file=.env load-documents.mjs
 *   node --env-file=.env load-documents.mjs --apply
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "org-documents";
const DIR = path.resolve("../../FMP Export/Operations/Documents");
const MER = path.join(DIR, "Documents.mer");
const DOCS = path.join(DIR, "fmpdocs");

// Two records share every prefix field; the description says which is which.
const DISAMBIGUATE = {
  "ALL_Signs_Ice Cream Display Signs_02_": (desc, file) =>
    /4up/i.test(desc) ? /4up/i.test(file) : !/4up/i.test(file),
};

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
const usDate = (s) => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const text = (s) => (s ? s.replace(/\x0b/g, "\n").trim() || null : null);
const mime = (f) => (/\.png$/i.test(f) ? "image/png" : /\.jpe?g$/i.test(f) ? "image/jpeg" : "application/pdf");

const rows = parseMer(fs.readFileSync(MER, "utf8"));
const files = fs.readdirSync(DOCS).filter((f) => !f.startsWith("."));
console.log(`${rows.length} records, ${files.length} files`);

const { data: orgs } = await db.from("orgs").select("id").limit(1);
const orgId = orgs[0].id;
const { data: locations } = await db.from("locations").select("id, code").eq("org_id", orgId);
const locByCode = new Map(locations.map((l) => [l.code, l.id]));

const claimed = new Set();
const plan = [];
for (const r of rows) {
  const code = r.Document_Location_txt;
  const locationId = code && code !== "ALL" ? locByCode.get(code) ?? null : null;
  if (code && code !== "ALL" && !locationId) console.log(`  ? unknown shop ${code} on "${r.Document_Title_txt}" — loading as ALL`);
  const prefix = `${locationId ? code : "ALL"}_${r.Document_Category_txt}_${r.Document_Title_txt}_${r.Document_Version_txt}_`;
  let matches = files.filter((f) => f.startsWith(prefix) && !claimed.has(f));
  const dis = DISAMBIGUATE[prefix];
  if (dis) matches = matches.filter((f) => dis(r.Document_Description_txt, f));
  if (matches.length > 1) throw new Error(`ambiguous: "${prefix}" → ${matches.join(" | ")}`);
  const file = matches[0] ?? null;
  if (file) claimed.add(file);
  plan.push({
    legacy_id: r.PrimaryKey, org_id: orgId, location_id: locationId,
    title: r.Document_Title_txt, version: r.Document_Version_txt || null,
    category: r.Document_Category_txt || null, description: text(r.Document_Description_txt),
    notes: text(r.Document_Notes_txt), submitted_by: r.Document_SubmittedBy_txt || null,
    added_on: usDate(r.Document_Added_date), source_payload: r, _file: file,
  });
}
const unclaimed = files.filter((f) => !claimed.has(f));
for (const p of plan) console.log(`${p._file ? "+" : " "} ${(p.category ?? "").padEnd(18)} ${p.title} [${p.version}] ${p._file ? "→ " + p._file : "(no file)"}`);
console.log(`${plan.length} to load, ${plan.filter((p) => p._file).length} with a file, ${plan.filter((p) => !p._file).length} without`);
if (unclaimed.length) console.log("UNCLAIMED FILES:", unclaimed);
if (!APPLY) { console.log("\n(dry run — nothing written. Re-run with --apply)"); process.exit(0); }

let filed = 0;
for (const p of plan) {
  const { _file, ...row } = p;
  const { data, error } = await db.from("org_documents").upsert(row, { onConflict: "org_id,legacy_id" }).select("id").single();
  if (error) throw new Error(`${p.title}: ${error.message}`);
  if (!_file) continue;
  const { count } = await db.from("org_document_files").select("id", { count: "exact", head: true }).eq("document_id", data.id);
  if (count > 0) continue;
  const bytes = fs.readFileSync(path.join(DOCS, _file));
  const ext = path.extname(_file).toLowerCase() || ".pdf";
  const key = `${orgId}/${data.id}/${crypto.randomUUID()}${ext}`;
  const up = await db.storage.from(BUCKET).upload(key, bytes, { contentType: mime(_file) });
  if (up.error) throw new Error(`${_file}: ${up.error.message}`);
  // The ORIGINAL name, without FileMaker's export prefix — that is what the
  // record already says, and what a person expects to see in a download.
  const original = _file.slice(_file.indexOf(`_${p.version ?? ""}_`) + (`_${p.version ?? ""}_`).length);
  const ins = await db.from("org_document_files").insert({
    org_id: orgId, document_id: data.id, storage_path: key, file_name: original,
    content_type: mime(_file), byte_size: bytes.length,
  }).select("id");
  if (ins.error) throw new Error(`${_file}: ${ins.error.message}`);
  filed++;
}
console.log(`loaded ${plan.length} documents, filed ${filed} files`);
