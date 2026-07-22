# web — restaurantfriend power tool

Next.js (App Router) + TypeScript + Tailwind + Supabase. Build-sequence step 2:
auth, location context, vendor list.

## Setup

```bash
cp .env.local.example .env.local   # then paste the anon key
npm install
npm run dev                        # http://localhost:3000
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` comes from Supabase Studio → Settings → API
(project `kltxioacvneshbyhxtaj`), key **anon / public**. The `service_role` key
never belongs in this folder — it bypasses RLS.

## Layout

| Path | What it is |
| --- | --- |
| `src/proxy.ts` | Next 16 middleware: refreshes the Supabase session, redirects signed-out users to `/login` |
| `src/lib/supabase/{client,server}.ts` | Browser and server Supabase clients (anon key; every query runs under RLS) |
| `src/lib/session.ts` | `getAppSession()` — user, `org_members` row, org locations, active location |
| `src/app/login/page.tsx` | Email/password sign-in |
| `src/app/(app)/` | Signed-in routes; the layout renders the header (user + location switcher) |
| `src/app/actions.ts` | Server actions: sign out, persist `org_members.last_active_location_id` |
| `src/app/(app)/vendors/page.tsx` | Vendor list with the active location's account / minimum / order days |

## Safari and stale CSS in dev

If a style change shows up over HMR but disappears the moment you reload,
Safari is serving a cached stylesheet. In dev the CSS chunk has a **stable**
filename derived from the source path (`src_app_globals_<id>.css`) whose
contents change on every edit; Chrome revalidates it each load, Safari happily
reuses its cached copy. The symptom is confusing because the markup is correct
and only the newest utility classes appear to do nothing.

Fix while working: **Develop → Disable Caches** in Safari, or hard-reload with
`⌘⌥R`. Not an issue in production — `next build` emits content-hashed CSS
(`<hash>.css`), so a changed stylesheet is always a new URL.
