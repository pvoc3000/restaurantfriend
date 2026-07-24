# PO email sending — one-time setup

The web app's compose card posts the reviewed email + the rendered PO PDF to
the `send-po-email` edge function (`supabase/functions/send-po-email/`), which
sends through [Resend](https://resend.com) and marks the PO sent. Until these
steps are done, Send fails with a clear error and the "Use Mail app" button in
the compose card remains the working path.

## 1. Resend account + domain

1. Create a Resend account (free tier: 100 emails/day — plenty for ~11 POs/week).
2. Resend dashboard → **Domains** → Add `donutfriend.com`.
3. Add the DNS records Resend shows (SPF + DKIM, usually 3 records) at your DNS
   host, wait for "Verified".
4. **API Keys** → create one (sending access only) → copy it.

## 2. Supabase secret

Dashboard → **Edge Functions** → **Secrets** → add:

    RESEND_API_KEY = re_…

(`SUPABASE_URL` / `SUPABASE_ANON_KEY` are provided automatically.)

## 3. Deploy the function

Either paste `supabase/functions/send-po-email/index.ts` into
Dashboard → Edge Functions → Deploy new function (name it exactly
`send-po-email`), or from the repo root:

```bash
npx supabase login
```

```bash
npx supabase functions deploy send-po-email --project-ref kltxioacvneshbyhxtaj
```

## 4. From address (org setting, design rule 2)

SQL editor:

```sql
update orgs set settings = jsonb_set(
  settings, '{po_email,from}', '"Donut Friend <orders@donutfriend.com>"');
```

The mailbox part can be anything on the verified domain (it doesn't need to
exist as a real inbox); replies go to `po_email.reply_to` if you set it the
same way, otherwise to the From address. `po_email.cc` (already set to
info@donutfriend.com) is CC'd on every PO — that's your sent-copy record.

Optional, same pattern: `po_email.subject` and `po_email.body` override the
generic templates. Placeholders: `{po_number}` `{vendor_name}` `{location_name}`
`{location_code}` `{order_date}` `{delivery_date}` `{account_number}`
`{rep_name}` `{rep_first}` `{rep_first_comma}` `{account_line}`
`{delivery_line}`.

## 5. Verify

Open a draft email-PO → Email PO… → Send it to yourself first (edit To).
Check: the mail arrives with the PDF attached, and the PO flips to
Sent · email with an audit line in `sent_notes` (`emailed to … · resend <id>`).
