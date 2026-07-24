# PO email sending — setup

The compose card posts the reviewed email + rendered PO PDF to the
`send-po-email` edge function (`supabase/functions/send-po-email/`).
Resolution is three-tier (2026-07-24):

1. `locations.settings.email_provider` — a location with its own way to send
2. `orgs.settings.email_provider` — an org with its own way to send
3. **the app's own sender** — the Bill.com model: the platform sends on the
   org's behalf; orgs supply nothing but addresses. This is the default and
   what Donut Friend uses.

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
