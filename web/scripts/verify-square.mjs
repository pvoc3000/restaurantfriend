// verify-square — prove the Square backfill against Mark's own dashboard.
//
// This is the acceptance test for the whole sync. It reads two "Sales summary"
// CSVs exported from the Square dashboard and diffs them against `daily_sales`
// cell by cell. A sync that agrees with the dashboard on every day of the year
// is a sync you can stop thinking about; one that agrees "roughly" is a source
// of arguments forever.
//
// CODE IS COMMITTED, DATA NEVER. Those CSVs are a year of a private business's
// revenue, so the paths are given on the command line and nothing is written
// into the repo.
//
// It imports the COMPILED `squareSalesCsv` out of .fixtures-build rather than
// keeping a second copy of the parser — `migration/transform-timesheets.mjs`'s
// arrangement, and for its reason: one implementation, fixture-tested, with the
// script refusing to run rather than silently using a stale one.
//
//   cd web && npm run fixtures       # once, to build
//   npm run verify:square -- \
//     --net  "$HOME/Downloads/… net sales.csv" \
//     --tips "$HOME/Downloads/… tips.csv" \
//     --through 2026-08-22
//
// Credentials come from migration/.env (service_role, local only) — the same
// file every other audit script here uses.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(here, "../.fixtures-build/src/lib/squareSalesCsv.js");

if (!existsSync(BUILD)) {
  console.error(
    "The compiled parser is missing. Run `npm run fixtures` in web/ first —\n" +
      "this script deliberately reads that build rather than keeping a second\n" +
      "copy of the CSV reader."
  );
  process.exit(1);
}

const { parseSquareSalesSummaryCsv, diffAgainstCsv, diffIsClean } = await import(BUILD);

// ---------------------------------------------------------------------------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const netPath = arg("net");
const tipsPath = arg("tips");
const through = arg("through");

if (!netPath && !tipsPath) {
  console.error("Give at least one of --net <csv> or --tips <csv>.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "Run with:  node --env-file=../migration/.env scripts/verify-square.mjs …"
  );
  process.exit(1);
}
const supabase = createClient(url, key);

// ---------------------------------------------------------------------------

const money = (cents) =>
  `${cents < 0 ? "-" : ""}$${Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * PostgREST caps a select at 1,000 rows and says nothing about it, so a
 * multi-year window MUST be paged — and the sweep must be ORDERED, or pages
 * overlap and rows go missing. Both lessons are already written down in
 * CLAUDE.md; this is the shape they imply.
 */
async function fetchAllSales() {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("business_date, net_sales_cents, tips_cents, locations(code)")
      .order("business_date")
      .order("location_id")
      .range(from, from + size - 1);

    if (error) {
      console.error(
        /daily_sales/.test(error.message)
          ? "daily_sales does not exist — migration 063 has not been applied yet."
          : error.message
      );
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < size) break;
  }

  // The whole-table-audit trap: if paging overlapped, distinct < fetched.
  const seen = new Set(rows.map((r) => `${r.locations?.code}|${r.business_date}`));
  if (seen.size !== rows.length) {
    console.error(
      `Paging returned ${rows.length} rows holding only ${seen.size} distinct ` +
        `(shop, date) pairs. The sweep overlapped — do not trust this run.`
    );
    process.exit(1);
  }

  return rows.map((r) => ({
    locationCode: r.locations?.code ?? "?",
    business_date: r.business_date,
    netSalesCents: r.net_sales_cents,
    tipsCents: r.tips_cents,
  }));
}

const cells = await fetchAllSales();
console.log(`Read ${cells.length} rows from daily_sales.\n`);

// Map "DF01 HP" → "DF01". A PARAMETER rather than a constant because the label
// is a Square dashboard string anyone with a login can rename.
const { data: locRows } = await supabase.from("locations").select("code");
const codes = (locRows ?? []).map((l) => l.code);
const codeForCsvLabel = (label) =>
  codes.find((c) => label.toUpperCase().startsWith(c.toUpperCase())) ?? null;

let failed = false;

for (const [what, path] of [
  ["Net sales", netPath],
  ["Tips", tipsPath],
]) {
  if (!path) continue;

  const csv = parseSquareSalesSummaryCsv(readFileSync(path, "utf8"));
  const diff = diffAgainstCsv(csv, cells, codeForCsvLabel, through ? { through } : {});

  const last = through && through < csv.dates[csv.dates.length - 1] ? through : csv.dates[csv.dates.length - 1];

  console.log(`── ${what} ${"─".repeat(Math.max(0, 60 - what.length))}`);
  console.log(`   file measure   : ${csv.measure}`);
  console.log(`   reporting day  : ${csv.reportingDay ?? "(not stated)"}`);
  console.log(`   window         : ${csv.dates[0]} … ${last}${through ? "   (--through)" : ""}`);
  console.log(`   shops in file  : ${csv.rows.map((r) => r.label).join(", ")}`);
  console.log(`   compared       : ${diff.compared} cells`);
  console.log(`   matched        : ${diff.matched}`);

  const report = (label, list, render) => {
    if (!list.length) return;
    failed = true;
    console.log(`\n   ${label} (${list.length}):`);
    for (const x of list.slice(0, 20)) console.log(`     ${render(x)}`);
    if (list.length > 20) console.log(`     … and ${list.length - 20} more`);
  };

  report("MISMATCHED", diff.mismatches, (m) =>
    `${m.code} ${m.date}  dashboard ${money(m.csvCents)}  ours ${money(m.dbCents)}  (${
      m.deltaCents > 0 ? "+" : ""
    }${money(m.deltaCents)})`
  );
  report("MISSING FROM daily_sales", diff.missingInDb, (m) =>
    `${m.code} ${m.date}  dashboard ${money(m.csvCents)}`
  );
  report("PRESENT HERE, ABSENT FROM THE EXPORT", diff.missingInCsv, (m) =>
    `${m.code} ${m.date}  ours ${money(m.dbCents)}`
  );
  report("UNMAPPED CSV LABELS", diff.unmappedLabels, (l) => l);
  report("TOTAL ROW DISAGREES — a Square location may be unmapped", diff.totalMismatches, (t) =>
    `${t.date}  dashboard total ${money(t.csvTotalCents)}  our shops sum to ${money(t.dbSumCents)}`
  );

  if (diffIsClean(diff)) console.log(`\n   ✓ every cell agrees, to the cent.`);
  console.log();
}

if (failed) {
  console.error("VERIFICATION FAILED — see above.");
  process.exit(1);
}
console.log("VERIFIED: the backfill matches the Square dashboard exactly.");
