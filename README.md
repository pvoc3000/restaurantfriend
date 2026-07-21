# restaurantfriend

Multi-location restaurant operations platform. First module: **Purchasing**
(order guides → purchase orders → receiving). Replaces the FileMaker Pro
"DF Operations" solution, module by module.

**Stack:** Supabase (Postgres + Auth + Storage + Edge Functions) · Web app
(Next.js — power tool / admin) · SwiftUI iPad/iPhone app (floor tool, phase 5).

**Design rules** (see `docs/` for full specs):
- Multi-tenant-ready: `org_id` on every table, org-scoped RLS, zero hardcoded
  business specifics (templates and terminology live in `orgs.settings`).
- Location context: users work "logged into" a location; per-location settings.
- The order guide is a **view**, never a cached table.

---

## 1. Repo layout

```
supabase/migrations/   numbered SQL migrations (001_initial_schema.sql = start here)
docs/                  specs (Purchasing spec, master plan)
web/                   Next.js app (coming next)
migration/             FMP → Postgres import scripts (coming soon)
```

## 2. First-time git setup (run once, in Terminal)

```bash
cd "/Users/mark/Developer/Claude/DF Operations/restaurantfriend"
git init
git add .
git commit -m "Initial schema + docs"
git branch -M main
git remote add origin https://github.com/pvoc3000/restaurantfriend.git
git push -u origin main
```

(If git asks who you are first:
`git config --global user.name "Mark Trombino"` and
`git config --global user.email "trombino@mac.com"`.)

## 3. Apply the schema to Supabase (5 minutes)

1. Open your project: https://supabase.com/dashboard → project `kltxioacvneshbyhxtaj`
2. Left sidebar → **SQL Editor** → **New query**
3. Open `supabase/migrations/001_initial_schema.sql` in VS Code, select all,
   copy, paste into the SQL editor.
4. Click **Run**. You should see "Success. No rows returned."
5. Sidebar → **Table Editor**: you'll see all 19 tables; `orgs` has one row
   (Donut Friend) and `locations` has six (DF01…EVENT).

If anything errors, copy the error text back to me — do not retry with edits.

## 4. Create your login (once)

1. Studio sidebar → **Authentication** → **Users** → **Add user** →
   email `trombino@mac.com` + a password (save it in your password manager).
2. SQL Editor → new query → run:

```sql
insert into org_members (org_id, user_id, role, display_name)
select o.id, u.id, 'owner', 'Mark'
from orgs o, auth.users u
where o.name = 'Donut Friend' and u.email = 'trombino@mac.com';
```

That row is what the RLS policies key off — it makes you an owner of the org.

## 5. What happens next

1. **Web skeleton** — Next.js app in `web/` with login, location switcher, and
   the vendor list as the first live screen.
2. **Migration dry run** — you export a few FMP tables as CSV (exact
   instructions provided per table), scripts load them into Supabase.
3. **Web catalog admin** → clean migrated data → **web order guide** → real
   Monday orders → SwiftUI app.

## Security notes

- Never commit secrets. `.env*` files are gitignored; keys live there and in
  your password manager only.
- The `service_role` key (Studio → Settings → API) bypasses all row security —
  it is for server-side migration scripts only. Never paste it into chat,
  never put it in the web app.
