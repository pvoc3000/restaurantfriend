# migration/ — FMP → Supabase loader

One-time (rerunnable) loader for the FileMaker catalog + PO history.

## What's here

| File | What it is |
|---|---|
| `load.mjs` | The loader. Reads transformed JSON, writes to Supabase via service_role. |
| `field-map.md` | Complete FMP field → schema column map, including everything deliberately dropped. |
| `.env` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. **Never committed** (gitignored). |

The transformed data itself lives **outside the repo** in `../../FMP Export/transformed/`
(11 JSON files) because it contains vendor account numbers — the repo is public.

## Running it

```bash
cd migration
npm install
node --env-file=.env load.mjs
```

- Takes a few minutes (≈105k PO line items load in batches of 500).
- The script **refuses to run** if vendors already exist. To start over:
  `node --env-file=.env load.mjs --wipe` — deletes all migrated rows for the org
  (catalog + PO history + any guide entries), then reloads. Don't use `--wipe`
  after real orders have been placed in the new system.
- It finishes by printing sanity counts next to the expected numbers.

## After loading

Work through `Catalog-Audit.xlsx` (in the DF Operations folder) — the FIX FIRST
sheet lists the ~465 active item/location rows whose ordering math needs a human:
missing default vendor items, missing package contents, unparseable pars.
Fix them in the web admin.
