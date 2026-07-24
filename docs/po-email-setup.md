# PO email sending — setup

The compose card posts the reviewed email + rendered PO PDF to the
`send-po-email` edge function (`supabase/functions/send-po-email/`). The
function is **provider-generalized** (2026-07-24): each org — or an individual
location — declares HOW its mail goes out.

- **What to use** lives in settings jsonb (design rule 2), resolved
  location-over-org: `locations.settings.email_provider` ??
  `orgs.settings.email_provider`:

  ```json
  { "kind": "gmail",
    "secret_ref": "DONUTFRIEND",
    "from": "Donut Friend <info@donutfriend.com>",
    "reply_to": "optional@donutfriend.com" }
  ```

  Supported kinds: `gmail` (Gmail API over HTTPS — sent POs land in that
  mailbox's **Sent folder** and thread with rep replies) and `resend`.

- **Credentials** live in Supabase Edge Function secrets, never in the DB
  (settings are readable by every org member). One secret per credential set,
  named `EMAIL_CREDS_<secret_ref>`:

  - gmail: `{"client_id":"…","client_secret":"…","refresh_token":"…"}`
  - resend: `{"api_key":"re_…"}`

  A location with its own mailbox = its own `email_provider` (different
  `secret_ref`) + its own secret. Rotating credentials = updating one secret.

Until setup is done, Send fails with a clear error naming the missing piece;
"Use Mail app" in the compose card remains the working path.

## Donut Friend: Gmail setup (one-time, ~20 min)

### 1. Google Cloud OAuth client

1. [console.cloud.google.com](https://console.cloud.google.com) — signed in as
   your Workspace admin account → New project, name e.g. `restaurantfriend`.
2. **APIs & Services → Library** → search "Gmail API" → Enable.
3. **APIs & Services → OAuth consent screen** → User type **Internal** (this
   is the important one — Internal apps skip Google verification and their
   refresh tokens don't expire the way external "testing" apps' do). App name
   `restaurantfriend`, your email for the contacts, Save.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   type **Web application**, name `po-email`. Under Authorized redirect URIs
   add exactly: `https://developers.google.com/oauthplayground`
   → Create. Copy the **client ID** and **client secret**.

### 2. Mint the refresh token (OAuth Playground)

1. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
2. Gear icon (top right) → check **Use your own OAuth credentials** → paste
   the client ID + secret.
3. Left panel, Step 1: scroll to **Gmail API v1** → tick
   `https://www.googleapis.com/auth/gmail.send` → Authorize APIs.
4. Sign in as **the mailbox that should send POs** (info@donutfriend.com) and
   approve. (The From address must be this mailbox or one of its "Send mail
   as" aliases, or Gmail rewrites the header.)
5. Step 2: **Exchange authorization code for tokens** → copy the
   **Refresh token**.

### 3. Supabase secret

Dashboard → Edge Functions → Secrets → add:

    EMAIL_CREDS_DONUTFRIEND = {"client_id":"…","client_secret":"…","refresh_token":"…"}

### 4. Deploy the function

Either paste `supabase/functions/send-po-email/index.ts` into
Dashboard → Edge Functions → Deploy new function (name it exactly
`send-po-email`), or from the repo root:

```bash
npx supabase login
```

```bash
npx supabase functions deploy send-po-email --project-ref kltxioacvneshbyhxtaj
```

### 5. Point the org at it

SQL editor:

```sql
update orgs set settings = jsonb_set(settings, '{email_provider}',
  '{"kind":"gmail","secret_ref":"DONUTFRIEND","from":"Donut Friend <info@donutfriend.com>"}');
```

### 6. Verify

Open a draft email-PO → Email PO… → edit To to your own address → Send.
Check: the mail arrives with the PDF attached, it appears in
info@donutfriend.com's **Sent** folder, and the PO flips to Sent · email with
`emailed to … · gmail <id>` in `sent_notes`.

## Email content templates (separate from transport)

`orgs.settings.po_email` still owns the CONTENT defaults: `cc` (already
info@donutfriend.com), and optional `subject` / `body` templates with
placeholders `{po_number}` `{vendor_name}` `{location_name}` `{location_code}`
`{order_date}` `{delivery_date}` `{account_number}` `{rep_name}` `{rep_first}`
`{rep_first_comma}` `{account_line}` `{delivery_line}`.

## Resend (alternative kind, for reference)

Account → verify domain DNS → API key →
`EMAIL_CREDS_<ref> = {"api_key":"re_…"}` → `email_provider.kind = "resend"`.
Sent copies are NOT in any mailbox (only the cc), which is why Gmail was
chosen for Donut Friend.
