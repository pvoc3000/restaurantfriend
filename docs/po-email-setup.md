# PO email sending — setup

The compose card posts the reviewed email + rendered PO PDF to the
`send-po-email` edge function (`supabase/functions/send-po-email/`).
Resolution is three-tier (2026-07-24):

1. `locations.settings.email_provider` — a location with its own way to send
2. `orgs.settings.email_provider` — an org with its own way to send
3. **the app's own sender** — the Bill.com model: the platform sends on the
   org's behalf; orgs supply nothing but addresses.

**Donut Friend uses tier 2: an org-level `gmail` config** (2026-07-24 —
Resend + InMotion DNS was abandoned mid-setup). The app-default section below
is kept for future orgs.

Until setup is done, Send fails with a clear error naming the missing piece;
"Use Mail app" in the compose card remains the working path.

## The app default (Resend) — Donut Friend's path

One self-contained secret. Dashboard → Edge Functions → Secrets:

    EMAIL_CREDS_DEFAULT = {"kind":"resend","api_key":"re_…","from":"{org} <po@YOURDOMAIN>"}

- `{org}` becomes the org's name, so vendors see "Donut Friend <po@…>".
- **Reply-To is derived automatically** from the org's own addresses
  (`po_email.reply_to` → `po_email.cc` → `billing.email`) — vendor replies go
  to info@donutfriend.com, never to the platform address.

### Try it today (no domain, ~5 min)

1. Create a [resend.com](https://resend.com) account (free: 100 emails/day).
2. API Keys → create → copy.
3. Set the secret with Resend's sandbox sender:
   `{"kind":"resend","api_key":"re_…","from":"{org} <onboarding@resend.dev>"}`
   — sandbox mail can ONLY be delivered to your own Resend account email,
   which is exactly what a first test wants.
4. Deploy the function (below), open a draft email-PO, set To to your own
   address, Send. Check the PDF arrives and the PO flips to Sent · email with
   `emailed to … · resend <id>` in sent_notes.

### Go live (one-time)

Resend → Domains → add a domain you own (donutfriend.com works today; a
dedicated app domain also works later) → add the 2–3 DNS records it shows →
once Verified, update `from` in the secret to that domain, e.g.
`"{org} <po@donutfriend.com>"`. Nothing else changes.

### Deploy the function

Either paste `supabase/functions/send-po-email/index.ts` into
Dashboard → Edge Functions → Deploy new function (name it exactly
`send-po-email`), or from the repo root:

```bash
npx supabase login
```

```bash
npx supabase functions deploy send-po-email --project-ref kltxioacvneshbyhxtaj
```

## Org/location override: bring-your-own provider

An org (or a single location) that wants mail out of its own account sets

```json
{ "kind": "gmail" | "resend",
  "secret_ref": "DONUTFRIEND",
  "from": "Donut Friend <info@donutfriend.com>",
  "reply_to": "optional@…" }
```

in `orgs.settings.email_provider` (or `locations.settings.email_provider`),
plus a matching secret `EMAIL_CREDS_<secret_ref>`:

- resend: `{"api_key":"re_…"}`
- gmail: `{"client_id":"…","client_secret":"…","refresh_token":"…"}`

### Gmail credentials, if ever wanted (kept for reference)

Gmail's advantage: sent POs land in that mailbox's **Sent folder** and thread
with rep replies. Its cost: a Google Cloud OAuth dance.

1. console.cloud.google.com → New project → enable **Gmail API**.
2. OAuth consent screen → User type **Internal** (skips verification;
   refresh tokens don't expire like external "testing" apps).
3. Credentials → OAuth client ID → **Web application** → authorized redirect
   URI exactly `https://developers.google.com/oauthplayground` → copy client
   id + secret.
4. [OAuth Playground](https://developers.google.com/oauthplayground) → gear →
   "Use your own OAuth credentials" → paste both → Step 1: authorize scope
   `https://www.googleapis.com/auth/gmail.send` signed in as the sending
   mailbox → Step 2: exchange for tokens → copy the **refresh token**.
5. NB the `from` must be that mailbox or one of its "Send mail as" aliases,
   or Gmail rewrites the header.

## Email content templates (separate from transport)

`orgs.settings.po_email` owns the CONTENT defaults: `cc` (already
info@donutfriend.com — doubles as the org's sent-copy when using the app
default sender), and optional `subject` / `body` templates with placeholders
`{po_number}` `{vendor_name}` `{location_name}` `{location_code}`
`{order_date}` `{delivery_date}` `{account_number}` `{rep_name}` `{rep_first}`
`{rep_first_comma}` `{account_line}` `{delivery_line}`.

## The invite mail rides the same transport

`invite-member` (HR — giving someone access to the app) sends through this same
provider layer and the same `EMAIL_CREDS_*` secrets, so **nothing here needs
setting up twice**. Two differences worth knowing:

- **Org tier only.** A purchase order belongs to a location, so its transport
  resolves location → org → app default. An invitation belongs to the ORG —
  there's no location in scope — so it resolves org → app default. Donut
  Friend's org-level Gmail override covers it already.
- **One new secret, `APP_URL`** — where `/welcome` lives, e.g.
  `supabase secrets set APP_URL=https://app.example.com`. Platform config, not
  org config: a deploy URL isn't business terminology. Without it the function
  refuses to send rather than mailing out a link to nowhere.

Content templates live in `orgs.settings.invite_email` (`subject` / `body`,
same shape as `po_email`), with placeholders `{first_name}` `{org}`
`{role_label}` `{invite_url}`. Generic English is built into the function, so
this is optional.

Deploy: `supabase functions deploy invite-member`.

---

# Special orders: sending as specialorders@ — a walkthrough

> **DONE for Donut Friend** (Mark, 2026-08-19, Path A). specialorders@ has its
> own OAuth refresh token in `EMAIL_CREDS_SPECIALORDERS`, the org points at it,
> and quotes have gone out and been approved. **Nothing below needs doing
> again** — it is kept as the recipe for the next mailbox or the next org, and
> as the place to look when something stops working.

The problem this solves: with no module-level provider configured, a quote
sends as **info@donutfriend.com** — it falls through to the org's. Nothing is
broken; the From is just wrong, and the customer's reply lands in the wrong
inbox.

Fifteen minutes if you need the OAuth dance, two if you don't.

---

## Step 1 — which kind of thing is specialorders@?

Open the Google Admin console (admin.google.com) → **Directory → Users**, and
search for `specialorders`.

- **It appears as a USER** → you have a real mailbox. Either path works;
  **Path A** is better (sent mail lands in that mailbox's own Sent folder).
- **It does NOT appear** → check **Directory → Groups**, or open info@'s Gmail
  → Settings → **Accounts** → "Send mail as". If specialorders@ is listed
  there, take **Path B** — you are done in two minutes.
- **Neither** → specialorders@ does not exist yet. Create it as an alias of
  info@ (Admin → Users → info@ → "Add alternate email"), wait a few minutes,
  then take **Path B**.

If you are not sure, take Path B first. It is quick, it is reversible, and if
it turns out to be wrong the send fails loudly rather than quietly.

---

## Path A — specialorders@ has its own mailbox (~15 min)

You are producing one thing: a **refresh token** that belongs to
specialorders@. The Google Cloud project from the info@ setup is reused, so
there is nothing to create there.

### A1. Get the OAuth client id and secret you already have

console.cloud.google.com → make sure the project selector at the top says
**project 765339329273** (the one the info@ credential was made in) → **APIs &
Services → Credentials** → under "OAuth 2.0 Client IDs", open the Web
application client → copy the **Client ID** and **Client secret**.

If the client's **Authorised redirect URIs** does not already list

```
https://developers.google.com/oauthplayground
```

add it and press Save. (It will be there from the info@ setup.)

### A2. Mint the refresh token AS specialorders@

**Sign out of every Google account first, or sign in to specialorders@ in a
private window.** This is the step that goes wrong: the playground authorises
whichever account is signed in, and if that is info@ you get a second info@
token that looks perfectly valid and sends as the wrong address.

1. Open <https://developers.google.com/oauthplayground>
2. Gear icon (top right) → tick **Use your own OAuth credentials** → paste the
   Client ID and Client secret from A1.
3. In the left-hand list, ignore the categories and paste this into the box
   labelled "Input your own scopes":

   ```
   https://www.googleapis.com/auth/gmail.send
   ```

4. Click **Authorize APIs**. Sign in **as specialorders@donutfriend.com** and
   accept. Check the account shown on the consent screen before you accept.
5. Back in the playground, click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** — the long string starting `1//`. This is the
   only thing you need from this page, and it does not expire.

### A3. Store it as a Supabase secret

In a terminal, from the repo root. Substitute the three values; keep the single
quotes so the shell does not eat anything.

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj EMAIL_CREDS_SPECIALORDERS='{"client_id":"PASTE_CLIENT_ID","client_secret":"PASTE_CLIENT_SECRET","refresh_token":"PASTE_REFRESH_TOKEN"}'
```

Check it landed (this lists names and digests, never values):

```bash
npx supabase secrets list --project-ref kltxioacvneshbyhxtaj
```

### A4. Point the app at it

Supabase dashboard → **SQL Editor** → run:

```sql
update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders,email_provider}',
         '{"kind":"gmail",
           "secret_ref":"SPECIALORDERS",
           "from":"Donut Friend <specialorders@donutfriend.com>",
           "reply_to":"specialorders@donutfriend.com"}'::jsonb,
         true
       )
 where id = '5803adf6-0afa-4a54-b049-91411f36c79f';
```

`jsonb_set` with the path `{special_orders,email_provider}` adds ONE key inside
the settings that are already there — it does not replace the terms, the rush
fee or the thresholds. Skip to **Step 2**.

---

## Path B — specialorders@ is an alias on info@ (~2 min)

No new secret and no OAuth: the existing `EMAIL_CREDS_DONUTFRIEND` credential
can send as any address configured under info@'s "Send mail as".

Supabase dashboard → **SQL Editor** → run:

```sql
update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders,email_provider}',
         '{"kind":"gmail",
           "secret_ref":"DONUTFRIEND",
           "from":"Donut Friend <specialorders@donutfriend.com>",
           "reply_to":"specialorders@donutfriend.com"}'::jsonb,
         true
       )
 where id = '5803adf6-0afa-4a54-b049-91411f36c79f';
```

**The one difference from Path A**, and it is worth knowing before you choose:
sent quotes land in **info@'s** Sent folder, not specialorders@'s. Replies
still go to specialorders@ because Reply-To says so. If you want the paper
trail in specialorders@ itself, use Path A.

---

## Step 2 — the documents' contact line (optional, 1 min)

The masthead on every quote, invoice and receipt prints a phone and an email.
It currently prints the BILLING pair — `(213) 908-2743 / info@donutfriend.com`
— where FileMaker's own quotes print the special-orders line.

The EMAIL half is already fixed by Step 1: the documents read the `reply_to`
out of `email_provider`, so a configured mailbox names itself. The PHONE has no
such source, because nothing about sending mail knows a phone number:

```sql
update orgs
   set settings = jsonb_set(settings, '{special_orders,document_phone}',
                            '"213 995 6191"'::jsonb, true)
 where id = '5803adf6-0afa-4a54-b049-91411f36c79f';
```

(Note the doubled quotes: a bare JSON string still needs to be valid JSON.)

---

## Step 2b — where the approval link points (required once; DONE)

The quote carries a link to `/q/{token}`, and it has to be an address the
CUSTOMER can open. Two things make that true, and both are needed:

**1. The web app knows its own public address.** `web/.env.local`:

```
NEXT_PUBLIC_APP_URL=https://restaurantfriend.vercel.app
```

Restart the dev server after adding it — Next inlines `NEXT_PUBLIC_*` at build
time, so an already-running server keeps the old value. Set the same variable
in Vercel (Project → Settings → Environment Variables, all environments) so a
preview deployment does not mint preview-host links.

In production the browser's origin is already the deployment, so this is
belt-and-braces there. **In development it is required**: without it the compose
card refuses to open a quote rather than producing a draft whose link works
only on your laptop. That refusal is the fix for a real one that went out
(2026-08-17).

Keep it equal to the `APP_URL` edge-function secret. The send compares them and
refuses a mismatch, naming the address it expected — so a wrong value costs you
one refused send, not one dead link in a customer's inbox.

**2. `/q/` is actually deployed.** The public route and its `proxy.ts` exemption
ship together, so a deployment that predates them answers **307 → /login**,
which is a different broken link. (That is now merged to `main` and live —
kept here because it is the check to run after any deploy that touches
`proxy.ts`.) Check it with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://restaurantfriend.vercel.app/q/probeprobeprobe
```

**200** means the route is live. **307** means the deployment predates it.

---

## Step 3 — prove it, with a real send to yourself

Nothing about email can be trusted until a message actually arrives, because
**Gmail does not refuse a `From` it is not authorised for — it silently
rewrites it.** A misconfigured send looks exactly like a working one from
inside the app. So:

1. Open any special order in the app → the command bar at the bottom →
   leave the picker on **Quote** → **Email…**
2. Replace **To** with your own address. Leave everything else.
3. **Send.**

Then check four things, in this order:

| Check | Where | What it means if it's wrong |
| --- | --- | --- |
| The From reads `specialorders@donutfriend.com` | the received mail | Gmail rewrote it — the credential does not own that address. Path A, or add the alias. |
| It landed in specialorders@'s **Sent** folder | Gmail | You are on Path B. Expected. |
| The quote PDF is attached and reads correctly | the received mail | — |
| The approval link opens the quote | tap it on your phone | See below if it says the link isn't valid |

Then, still on that order:

- the **Quote sent** date on the Info tab has filled itself in;
- the **Documents** tab now holds a `Quote sent` PDF — the exact file that went
  out;
- the **History** on the Notes tab has a line naming the recipient and the
  provider message id.

Tap the link, type a name, tick the box, approve. The order's **Quote
approved** date fills in, a `Signed quote` PDF appears on the Documents tab,
and a confirmation arrives. That is the whole loop.

**Afterwards:** the test send stamped a real order. Clear `quote_sent_at` and
`quote_returned_at` on the Info tab and delete the two documents from the
Documents tab, or do the test on a throwaway order you delete after.

---

## When it goes wrong

| What you see | What it is |
| --- | --- |
| `secret EMAIL_CREDS_SPECIALORDERS is not set` | A3 didn't run, or the name is misspelled. `supabase secrets list` shows the real name. |
| `Gmail auth failed: invalid_grant` | The refresh token is wrong, or it was minted against a different client id than the one in the same secret. Redo A2 — the two must come from the same OAuth client. |
| `Gmail refused the send: Precondition check failed` | The Gmail API is not enabled **in project 765339329273**. Enable it there; the error is about the project, not the account. |
| `email_provider config is incomplete` | The JSON in A4/Path B is missing `kind`, `secret_ref` or `from`. |
| `secret EMAIL_CREDS_… is not valid JSON` | A stray line break got into the value — pasting a ~100-character refresh token does this. Re-run A3 (the send now strips control characters, so this should be rare). |
| `Bad control character in string literal in JSON at position …` | The same thing, from a function deployed before 2026-08-17. Redeploy the three functions. |
| Mail arrives, but from info@ | Gmail rewrote the From. The credential does not own specialorders@ — Path A, or add the "Send mail as" alias. |
| The approval link says "this link isn't valid" | The token has no document behind it, which is what a compose card that was **cancelled** leaves. Send the quote properly and use the link from that email. |
| The approval link goes to a sign-in page | `/q/` is not deployed yet — see Step 2b's `curl`. |
| `this quote's approval link points at http://localhost:3000` | `NEXT_PUBLIC_APP_URL` is unset or the dev server was not restarted. Nothing was sent. |
| The compose card refuses to open a quote | Same cause, caught earlier. The message names the variable. |
| The approval link says "this quote has been revised" | You sent the quote again. Only the newest link works, by design. |

---

## Reference: everything under `orgs.settings.special_orders`

Set by migration 051: `horizon_days`, `rush_cutoff_business_days`,
`rush_minimum`, `rush_rate`, `attention_*`, `invoice_footer`, `terms`.

Read by phase 3:

| key | what it does |
| --- | --- |
| `email_provider` | the transport — Step 1 |
| `reply_to` | the address printed on documents. **Optional**: with it unset the documents read `email_provider.reply_to`, so a configured mailbox already names itself. Set this only to publish an address you do NOT send from |
| `document_phone` | the phone on the masthead — Step 2 |
| `document_name` | overrides the masthead name; defaults to the ORG name, because a customer document carries the trade name where a PO's Bill-to carries the legal entity |
| `email_cc` | Cc on every document email — the shop's own copy |
| `approval_cc` | who is Cc'd on an approval confirmation; falls back to `reply_to` |
| `email` | per-document `{subject, body}` overrides, keyed `quote` / `invoice` / `receipt` / `order` / `statement` |

Template placeholders: `{number}` `{title}` `{title_suffix}` `{first_name}`
`{full_name}` `{event_date}` `{event_time}` `{event_time_clause}` `{location}`
`{total}` `{balance}` `{paid}` `{subtotal}` `{approve_url}` `{approve_line}`.
An unknown placeholder is **left in the text rather than blanked**, so a typo
shows up in the compose card where somebody can fix it.

**Resolution order for a special order is module → org → app default.** There
is deliberately no location tier: a purchase order belongs to a shop and may
reasonably come from that shop's mailbox, but a customer's quote is the ORG's
letter, and which shop they collect from does not change who wrote to them.

---

## Reference: redeploying

```bash
npx supabase functions deploy send-special-order-email --project-ref kltxioacvneshbyhxtaj
npx supabase functions deploy approve-quote --project-ref kltxioacvneshbyhxtaj
npx supabase functions deploy send-po-email --project-ref kltxioacvneshbyhxtaj
```

All three were deployed 2026-08-17 and **none of them needs redeploying for
anything in this document** — secrets and settings are read at call time, so
Step 1 takes effect on the next send.

`send-po-email` is in that list and it is not a typo: the provider layer lives
in `supabase/functions/_shared/email.ts`, which is compiled into each function
when THAT function is deployed. Edit the shared file and all three need
redeploying, or the ones you skipped keep running the old copy.
