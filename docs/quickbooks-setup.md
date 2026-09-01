# QuickBooks Online — setup

What to click, what to paste, and what each failure looks like. `docs/square-setup.md`'s
shape. The design and its reasoning are in migration `081_accounting_connections.sql`
and `supabase/functions/_shared/qbo.ts`; this file is the procedure.

**What the connection is for:** approved vendor bills go to QuickBooks as
**Bills**, so they are on the books and can be paid there. QuickBooks records
only — no QuickBooks Payments merchant account, no Intuit-sent email. The app
keeps sending its own documents from specialorders@ and info@.

---

## 1. The Intuit app (once)

1. Sign in at **developer.intuit.com** with the Intuit account that owns the
   QuickBooks company. No separate signup.
2. **Create an app** → **QuickBooks Online and Payments**. Name it
   `restaurantfriend`.
3. Scope: **`com.intuit.quickbooks.accounting`** and nothing else.
   `com.intuit.quickbooks.payment` is the merchant-account scope and this
   integration deliberately does not take it.
4. Left menu → **Keys & credentials**, under **Development Settings** for
   sandbox (**Production Settings** later). Copy the **Client ID** and
   **Client Secret**.
5. Same page → **Redirect URIs** → **Add URI**:

   ```
   https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/qbo-oauth
   ```

   Intuit matches this **byte-for-byte**. A trailing slash is a different URI.
6. Your sandbox company already exists: profile menu → **Sandbox**. Sign into it
   at `sandbox.qbo.intuit.com` to check that pushes land. You do not need its
   Company ID — the app learns the realm from the callback.

### Production keys, later

A form, not a review: an app-assessment questionnaire (legal, technical,
security) plus Host Domain and three URLs. Mandatory since January 2026, all
three point at the settings screen:

| Field | Value |
| --- | --- |
| Host Domain | `restaurantfriend.vercel.app` |
| Launch URL | `https://restaurantfriend.vercel.app/settings` |
| Disconnect URL | `https://restaurantfriend.vercel.app/settings?quickbooks=disconnected` |
| Reconnect URL | `https://restaurantfriend.vercel.app/settings?quickbooks=reconnect` |

The Disconnect URL is only a **hint** — Intuit sends people there from
QuickBooks' own My Apps menu, carrying no auth and no realm. The authoritative
detection is the `invalid_grant` path, which sets `status = 'disconnected'` and
puts the sentence in `last_error`.

---

## 2. The secret

One secret, the static half of the credential. The rotating half cannot live
here — see below.

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj QBO_CREDS='{"client_id":"PASTE","client_secret":"PASTE"}'
```

One line, exactly those two keys. `readQboCreds` strips C0 control characters
before parsing, so a newline glued to a pasted value is survivable — but a
truncated secret still fails at Intuit with `invalid_client`, which is reported
by name.

**Sandbox and production keys are different.** Switching environment means
setting `QBO_CREDS` again with that environment's pair, and reconnecting.

---

## 3. The migration and the deploys

Migration **081** first — the screen selects columns it creates, so a deploy in
front of it renders an error instead of a settings block. Run it in the SQL
editor; its verify block is at the bottom.

```bash
npx supabase functions deploy qbo-oauth --no-verify-jwt --project-ref kltxioacvneshbyhxtaj
```

```bash
npx supabase functions deploy qbo-sync --project-ref kltxioacvneshbyhxtaj
```

**`--no-verify-jwt` on `qbo-oauth` is not optional and is the first in this
project.** Every other public function here is reached through
`supabase.functions.invoke`, which sends the anon key, so the default
`verify_jwt` is satisfied. Intuit's callback is a top-level browser navigation
with no header to attach: with verification on it is refused with a 401 before
a line of the function runs, and the symptom is "authorize works, the app never
connects", with nothing in the logs.

**`_shared/qbo.ts` is compiled in at deploy time**, so any change to it means
redeploying **both**. The deployed copy of whichever you forget keeps running
the old code.

---

## 4. Connecting

Settings → **Accounting** → pick **Sandbox** → **Connect to QuickBooks**.
Owner and manager only, because 001's `org_update` names that pair.

You are sent to Intuit, you pick the company, and you come back to
`/settings?quickbooks=connected`. The block then shows the company name — which
is fetched live, so it is proof the connection works rather than proof a row was
written.

Then **Load from QuickBooks** and choose the **expense account** bills post to.
Every bill is sent as one line at its total against that account.

---

## Where the credential lives, and why it is split

This is the one place this app puts a credential in the database, and the
reason is specific: **a QBO refresh token rotates.** The token endpoint returns
a new one and invalidates the old, so whatever comes back must be stored — and
an edge function cannot rewrite its own secret.

- **Static half** (client id + secret) → edge secret `QBO_CREDS`, exactly like
  `EMAIL_CREDS_*`.
- **Rotating half** (refresh + access token) → `accounting_connections`, which
  has RLS on and **zero policies**. Invisible to every authenticated user;
  written only by the edge functions under `service_role`.

The screen learns anything at all through `accounting_connection_status()`,
which names its return columns and never includes a token.

Do not read this as licence to put the next credential in a table. The test is
whether it rotates, and only this one does.

---

## Failures, and what each one means

| What you see | What it is |
| --- | --- |
| `?quickbooks=error&reason=expired` | The connection link was already used or is older than ten minutes. Press Connect again. |
| `?quickbooks=error&reason=exchange_failed` | Intuit refused the code. Usually `QBO_CREDS` holds the other environment's keys. |
| `?quickbooks=error&reason=incomplete` | Intuit came back without a code, state or realm. Press Connect again. |
| A 401 from `qbo-oauth` | It was deployed without `--no-verify-jwt`. Redeploy with the flag. |
| "QuickBooks refused the app credentials" | `QBO_CREDS` is wrong for this environment — sandbox keys do not work against production. |
| "QuickBooks no longer accepts this connection" | `invalid_grant`: disconnected at Intuit, or 100 days unused. Reconnect. |
| "QuickBooks issued a new sign-in token and it could not be saved" | The rotation landed at Intuit and not here. The old token is already dead; reconnect. |
| Settings shows the block but no company name | The row exists and the API call failed. `last_error` says why. |

**A connection dies after 100 days without being used.** The settings block
prints the date. Reconnect is the cure and it is always on screen.

---

## Probes

*Probe, don't read a status line — this project's notes have been wrong in both
directions about whether a migration was applied.*

Migration 081, from a service_role script or the SQL editor:

```sql
select count(*) from pg_policy where polrelid = 'public.accounting_connections'::regclass;
```

**0**, deliberately. A `1` means somebody added a SELECT policy and a live
refresh token is now one PostgREST call from a manager's browser.

```sql
select count(*) from pg_proc where proname in
  ('begin_accounting_connection','accounting_connection_status','record_accounting_push');
```

**3** — never more. A changed argument list creates an overload and leaves the
old body live beside it.

The functions, with no session at all:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/qbo-oauth
```

Expect **302** to `/settings?quickbooks=error&reason=incomplete`. A **401** means
the JWT flag was lost on the last deploy.

```bash
curl -s -X POST https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/qbo-sync -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' -d '{"mode":"meta"}'
```

Expect `{"error":"not signed in"}` — which proves the code ran and the
`_shared/qbo.ts` import resolved.
