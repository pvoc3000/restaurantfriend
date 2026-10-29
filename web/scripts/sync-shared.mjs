// `npm run sync-shared` — copy the pure modules an edge function needs out of
// `web/src/lib` into `supabase/functions/_shared/generated/`.
//
// WHY A COPY AND NOT A TWIN. The journal-entry builder (`lib/salesPosting`)
// has to balance to the cent, and `qbo-sync` says in so many words that a
// hand-written Deno twin of it is the trap to avoid. The nightly run
// (`sales-nightly`) needs it server-side, so it gets the SAME file: copied
// byte for byte, with only the extensionless relative imports given the `.ts`
// Deno insists on, and a header saying where to edit it.
//
// `--check` writes nothing and exits non-zero if any copy differs from what
// this would write. `npm run fixtures` runs it first, so an edit to the source
// that was never copied fails the suite instead of drifting silently.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const out = resolve(web, "../supabase/functions/_shared/generated");

/** Every module copied, by its name under `web/src/lib`. Each one's relative
 *  imports must be in this list too, or Deno will not find them. */
const MODULES = ["quickbooks", "salesPosting"];

function generate(name) {
  const source = readFileSync(join(web, "src/lib", `${name}.ts`), "utf8");
  const body = source.replace(
    /(from\s+["'])\.\/([A-Za-z0-9_]+)(["'])/g,
    (whole, open, mod, close) => {
      if (!MODULES.includes(mod)) {
        throw new Error(`${name}.ts imports ./${mod}, which is not copied — add it to MODULES in sync-shared.mjs`);
      }
      return `${open}./${mod}.ts${close}`;
    }
  );
  if (/from\s+["']@\//.test(body)) {
    throw new Error(`${name}.ts imports through @/ — a module copied to Deno may only import its neighbors`);
  }
  return (
    `// GENERATED from web/src/lib/${name}.ts by web/scripts/sync-shared.mjs.\n` +
    `// DO NOT EDIT — edit the source, then run \`npm run sync-shared\` in web/.\n\n` +
    body
  );
}

const check = process.argv.includes("--check");
const stale = [];
if (!check) mkdirSync(out, { recursive: true });

for (const name of MODULES) {
  const file = join(out, `${name}.ts`);
  const want = generate(name);
  if (check) {
    const have = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (have !== want) stale.push(`supabase/functions/_shared/generated/${name}.ts`);
  } else {
    writeFileSync(file, want);
  }
}

if (check && stale.length) {
  console.error(
    `✗ out of date with web/src/lib — run \`npm run sync-shared\` in web/ and redeploy sales-nightly:\n  ${stale.join("\n  ")}`
  );
  process.exit(1);
}
if (!check) console.log(`copied ${MODULES.length} modules to supabase/functions/_shared/generated/`);
