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

### What goes up with a document

A pushed **bill** carries whatever is filed on it as an **invoice** — a
two-page scan is two documents and both go. A pushed **customer invoice**
carries the invoice sheet, rendered at push time off the same component the
customer's emailed copy comes from.

Three things worth knowing, all measured against the sandbox rather than read:

- **A second upload makes a second copy.** QuickBooks has no upsert for
  attachments, so what has gone up is recorded on the document's own
  `external_ref` and a re-push skips it. A bill's scan never changes, so it is
  left alone; the customer sheet is re-rendered from live figures, so the old
  one is deleted and replaced.
- **A refused file comes back HTTP 200** with the fault inside the response
  item. It is reported as a warning beside the push, never as a failure — by
  then the money is already on the books.
- **QuickBooks will not take WebP**, though the app's own Attach button offers
  it. A photographed invoice saved as WebP files fine here and is refused
  there, in a sentence saying so. Every document on file today is a PDF.

### If somebody edits a bill inside QuickBooks

Nothing breaks. An update carries the version we last saw, so a document changed
in QuickBooks since it was last sent from here is refused the first time —
QuickBooks calls it a stale object and words it as *"You and <a colleague> were
working on this at the same time"*. The push re-reads the current version and
sends again, **once**, and says so afterwards: *"This had been changed in
QuickBooks since it was last sent from here… Your update was applied on top of
that change."*

Worth reading when you see it, because it means exactly that — your figures
have just overwritten somebody's edit. Only ever once, and only on an update: a
new document cannot be stale, and retrying one that failed for another reason
is how you write it twice.

### Switching sandbox → production

Everything QuickBooks-specific is forgotten when you connect to a **different
company**, and only then — reconnecting the same one (an expired token, a
revoke at Intuit) keeps mappings that are still correct.

What goes: the expense account, invoice item and tax code; every vendor's
per-shop account, Location, Class and QuickBooks vendor; every customer's
mapping; and the QuickBooks id, version and attachment ids on every bill and
customer invoice already pushed.

**That last part is the one to understand.** An id means nothing in another
company file. Left in place, a pushed bill still reads as "already in
QuickBooks", so pressing Update would try to overwrite whatever document
happens to carry that id in your real books, and the bill itself would never be
created there. Cleared, it reads as never pushed — which is the truth — and the
first push creates it properly.

So after switching you re-choose the account, item and tax code, re-map the
vendors and customers, and push each bill once. Nothing is destroyed here that
was not a pointer into the sandbox.

**Sandbox and production keys are different.** Switching environment means
setting `QBO_CREDS` again with that environment's pair, and reconnecting.

---

## 3. The migrations and the deploys

Five, **in order**, each with its verify block at the bottom of its own file:

| | what it adds | if it is missing |
|---|---|---|
| **081** | the connection table, its three functions, `vendors`/`customers.external_ref`, `special_orders.synced_at` | the settings block renders a Postgres error instead of a screen |
| **082** | `vendors.expense_account_ref/_name` | nothing — **superseded by 083** and now read by nobody; kept because it ran |
| **083** | six QBO columns on `vendor_locations` — account, location, class | the per-shop pickers on the vendor record are absent |
| **084** | `accounting_connections.tax_code_ref/_name` | a taxable customer invoice cannot be pushed |
| **085** | widens `accounting_connection_status()` to return 084's two columns | **084 with no 085 is the worst state**: the tax code saves, reports success, and reads back as unset — see below |

**Run 081 before deploying anything** — the screen selects columns it creates,
so a deploy in front of it renders an error instead of a settings block.

**084 and 085 belong together.** 084 alone is silently half-applied: the write
goes through `qbo-sync`, which sees the column, so Settings saves the tax code
and says so — while every reader in the app goes through
`accounting_connection_status()`, which 084 did not widen, so the picker goes
back to reading *"Choose a tax code"* and the first taxable order refuses with
*"No QuickBooks tax code is set. Choose one in Settings → Accounting"*, naming
the screen where you just set it. If you see that sentence, 085 has not run.

A zero-tax order will not show it: a push only needs a tax code when something
on the order is taxable, so a wholesale invoice goes through either way.

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

Then choose the **expense account** bills post to. Every bill is sent as one
line at its total against that account.

---

## 5. Which account a vendor posts to

The account in Settings is the **default**. Each vendor may override it on its
own record — **Vendors → the vendor → QuickBooks** — which is how BakeMark's
bills reach `Cost of Goods Sold:Baker Items COGs` while Vesta's reach
`Cost of Goods Sold:Produce Items COGs`. Empty means "use the default", and the
field says which level answered so an inherited account is never mistaken for a
chosen one.

Sub-accounts are listed by their **fully qualified name**, grouped under their
parent. That is not cosmetic: QuickBooks' `Name` for a sub-account is the leaf
only, so a picker built on it shows "Baker Items COGs" with no parent and no way
to tell two children of different parents apart — which is how a bill posts to
the wrong account.

The same block maps the vendor to its **QuickBooks vendor**. Bills cannot be
sent until that is set, and the app never creates one: inventing master data
from a sync is how duplicate name lists happen, and QuickBooks enforces a
globally unique `DisplayName` (error 6240).

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
