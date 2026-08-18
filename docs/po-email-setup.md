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

## Special orders send as a DIFFERENT mailbox

Decision 12 of `docs/special-orders-brief.md`: a quote, invoice or receipt goes
out **as specialorders@donutfriend.com**, not as info@. That needs its own
credential, because **a Gmail refresh token can only send as its own mailbox
or one of that mailbox's configured "Send mail as" aliases** — the info@ token
cannot send as specialorders@, and Gmail does not refuse the attempt, it
silently REWRITES the From. That failure looks exactly like success until a
customer replies to the wrong address.

Two ways round it, and the second is less work if it fits:

1. **A second credential set.** Repeat the Gmail dance above signed in as
   specialorders@, then

   ```bash
   npx supabase secrets set EMAIL_CREDS_SPECIALORDERS='{"client_id":"…","client_secret":"…","refresh_token":"…"}'
   ```

   and set `orgs.settings.special_orders.email_provider`:

   ```json
   { "kind": "gmail",
     "secret_ref": "SPECIALORDERS",
     "from": "Donut Friend <specialorders@donutfriend.com>",
     "reply_to": "specialorders@donutfriend.com" }
   ```

2. **An alias on info@.** If specialorders@ is already a "Send mail as" address
   on the info@ mailbox (Gmail → Settings → Accounts), the EXISTING
   `EMAIL_CREDS_DONUTFRIEND` credential can send as it. Then the config above
   is the same but `"secret_ref": "DONUTFRIEND"` and no new secret is needed.
   Sent mail lands in info@'s Sent folder rather than specialorders@'s, which
   is the trade.

**Resolution order for a special order is org-module → org → app default.**
There is deliberately NO location tier: a purchase order belongs to a shop and
may reasonably come from that shop's mailbox, but a customer's quote is the
ORG's letter and which shop they collect from does not change who wrote to
them.

### The rest of `orgs.settings.special_orders`

Beyond migration 051's numbers and terms, phase 3 reads:

| key | what it is |
| --- | --- |
| `email_provider` | the transport above |
| `reply_to` | the address printed on every document, and where replies go |
| `document_phone` | the phone on the documents' masthead — the real quote prints the special-orders line, not the billing one |
| `document_name` | overrides the masthead name; defaults to the ORG name (a customer document carries the trade name, where a PO's Bill-to carries the legal entity) |
| `email_cc` | Cc on every document email — the shop's own copy |
| `approval_cc` | who is Cc'd on an approval confirmation; falls back to `reply_to` |
| `email` | per-document `{subject, body}` overrides, keyed `quote` / `invoice` / `receipt` / `order` / `statement` |

Template placeholders: `{number}` `{title}` `{title_suffix}` `{first_name}`
`{full_name}` `{event_date}` `{event_time}` `{event_time_clause}` `{location}`
`{total}` `{balance}` `{paid}` `{subtotal}` `{approve_url}` `{approve_line}`.
An unknown placeholder is **left in the text rather than blanked**, so a typo
shows up in the compose card where somebody can fix it.

### Deploy

```bash
npx supabase functions deploy send-special-order-email --project-ref kltxioacvneshbyhxtaj
npx supabase functions deploy approve-quote --project-ref kltxioacvneshbyhxtaj
npx supabase functions deploy send-po-email --project-ref kltxioacvneshbyhxtaj
```

**All three, and `send-po-email` is not a typo.** The provider layer moved into
`supabase/functions/_shared/email.ts` so the two senders share one MIME builder
and one OAuth refresh; `_shared` is compiled into each function at deploy time,
so an edit there reaches a function only when that function is redeployed. The
deployed copy keeps running until then — nothing breaks, it just does not get
the change (including the threading headers).

`approve-quote` is called by an anonymous customer, so it runs with the ANON
key like any public call. It needs no new secret: it reads
`SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects, and its authority is the
token, checked in SQL before it touches anything.
