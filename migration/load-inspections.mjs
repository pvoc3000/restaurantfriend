/**
 * Load FileMaker's InspectionLog — 13 records — into `inspections` (093), and
 * file each hardcopy in the facility-photos bucket owned by its record.
 *
 * Source: `../../FMP Export/Facilities/inspectionlog.mer` (a full-table .mer,
 * 16 columns) and `../../FMP Export/Facilities/inspection logs/*.pdf`, which
 * Mark exported by hand — a .mer carries a container's FILENAME and never its
 * contents, so the documents came out one at a time and are matched here BY
 * DATE, from a table typed below. Twelve of the thirteen visits have one; the
 * newest (2026-07-06, DF02) has none on disk.
 *
 * Idempotent on `(org_id, legacy_id)` — a re-run updates the row and files
 * the document only if the record has none yet, so running it twice cannot
 * double a report. Dry run by default.
 *
 *   node --env-file=.env load-inspections.mjs
 *   node --env-file=.env load-inspections.mjs --apply
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "facility-photos";
const DIR = path.resolve("../../FMP Export/Facilities");
const MER = path.join(DIR, "inspectionlog.mer");
const DOCS = path.join(DIR, "inspection logs");

// Which file is which visit. Matched by DATE off the filenames (yymmdd,
// mm.dd.yy, m.d.yy) and checked by eye against the shop: "3534 W Sunset" is
// DF03, "543 S Broadway" is DF02. The 3/18/2024 DF02 visit's report is dated
// 240320 in its filename — the day it was scanned, two days after the visit.
const DOC_FOR = {
  "2022-11-09": "DF03 221109.pdf",
  "2022-11-16": "DF03 221116.pdf",
  "2023-02-24": "DONUT FRIEND FOIR DATED 2.24.23.pdf",
  "2023-03-22": "DF03 230322.pdf",
  "2023-08-01": "08.01.23 - 3534 W Sunset Blvd - Creamo.pdf",
  "2024-03-06": "DONUT FRIEND FOIR DATED 240306.pdf",
  "2024-03-18": "DONUT FRIEND_543 S BROADWAY_240320.pdf",
  "2024-07-02": "24.07.02 - 3534 W Sunset Blvd - Creamo.pdf",
  "2024-09-11": "Donut Friend 240911.pdf",
  "2024-12-06": "DONUT FRIEND_543 S BROADWAY_241206.pdf",
  "2025-07-29": "DONUT FRIEND_543 S BROADWAY_250729.pdf",
  "2026-04-22": "DONUT FRIEND_4.22.26_001.pdf",
};

/** FileMaker merge = CSV with quoted embedded newlines and CR line ends. */
function parseMer(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const usDate = (s) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
// FileMaker's vertical tab is a line break.
const text = (s) => (s ? s.replace(/\x0b/g, "\n").trim() || null : null);

const rows = parseMer(fs.readFileSync(MER, "utf8"));
console.log(`${rows.length} records in the export`);

const { data: orgs } = await db.from("orgs").select("id").limit(1);
const orgId = orgs[0].id;
const { data: locations } = await db.from("locations").select("id, code").eq("org_id", orgId);
const locByCode = new Map(locations.map((l) => [l.code, l.id]));

const plan = [];
for (const r of rows) {
  const code = r["_LocationID.text"];
  const date = usDate(r.InspectionDate);
  const locationId = locByCode.get(code);
  if (!locationId || !date) { console.log(`SKIP ${r["_InspectionID.text"]}: location ${code} / date ${r.InspectionDate}`); continue; }
  const doc = DOC_FOR[date] ?? null;
  if (doc && !fs.existsSync(path.join(DOCS, doc))) throw new Error(`missing document ${doc}`);
  plan.push({
    legacy_id: r["_InspectionID.text"],
    org_id: orgId,
    location_id: locationId,
    inspected_on: date,
    inspection_type: r.InspectionType || "Health",
    score: r.InspectionScore || null,
    violations: text(r.Violations),
    violations_corrected: text(r.Violations_Corrected),
    source_payload: r,
    _doc: doc,
    _code: code,
  });
}
for (const p of plan) console.log(`${p._code} ${p.inspected_on} score ${p.score} ${p._doc ? "+ " + p._doc : "(no document)"}`);
console.log(`${plan.length} to load, ${plan.filter((p) => p._doc).length} with a report`);
if (!APPLY) { console.log("\n(dry run — nothing written. Re-run with --apply)"); process.exit(0); }

let filed = 0;
for (const p of plan) {
  const { _doc, _code, ...row } = p;
  const { data, error } = await db.from("inspections").upsert(row, { onConflict: "org_id,legacy_id" }).select("id").single();
  if (error) throw new Error(`${p.legacy_id}: ${error.message}`);
  if (!_doc) continue;
  const { count } = await db.from("facility_photos").select("id", { count: "exact", head: true }).eq("inspection_id", data.id);
  if (count > 0) continue;
  const bytes = fs.readFileSync(path.join(DOCS, _doc));
  const key = `${orgId}/${data.id}/${crypto.randomUUID()}.pdf`;
  const up = await db.storage.from(BUCKET).upload(key, bytes, { contentType: "application/pdf" });
  if (up.error) throw new Error(`${_doc}: ${up.error.message}`);
  const ins = await db.from("facility_photos").insert({
    org_id: orgId, inspection_id: data.id, storage_path: key, file_name: _doc,
    content_type: "application/pdf", byte_size: bytes.length,
  }).select("id");
  if (ins.error) throw new Error(`${_doc}: ${ins.error.message}`);
  filed++;
}
console.log(`loaded ${plan.length} inspections, filed ${filed} reports`);
