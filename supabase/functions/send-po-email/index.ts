// send-po-email — the PO email leg (spec §2 step 4), in-app version.
//
// The web app renders the §4.9 PDF client-side and posts it here (base64,
// ~6KB) with the human-reviewed to/cc/subject/body from the compose card.
// This function authenticates the caller, re-checks their role, sends through
// the org's (or location's) CONFIGURED provider, and stamps the PO sent with
// an audit note.
//
// Provider generalization (Mark, 2026-07-24: "every org, or even every
// location, should have its own way to send emails"):
//   - WHAT to use lives in settings jsonb (design rule 2), resolved
//     location-over-org:
//       locations.settings.email_provider ?? orgs.settings.email_provider
//       { "kind": "gmail" | "resend",
//         "secret_ref": "DONUTFRIEND",           // names the credential set
//         "from": "Donut Friend <info@donutfriend.com>",
//         "reply_to": "optional@..." }
//   - CREDENTIALS live in edge-function secrets (never in the DB — settings
//     are readable by every org member): one env var per credential set,
//       EMAIL_CREDS_<secret_ref> = JSON
//         gmail:  {"client_id":"…","client_secret":"…","refresh_token":"…"}
//         resend: {"api_key":"re_…"}
//   Setup click-by-click: docs/po-email-setup.md.
//
// Gmail sends via the Gmail HTTP API (users.messages.send) — raw SMTP is
// unreliable on this edge runtime. Bonus over any SMTP relay: the sent PO
// lands in that mailbox's Sent folder and threads with the rep's replies.
// NB the From must be the authorized mailbox or one of its configured
// "Send mail as" aliases, or Gmail rewrites it.
//
// Design rule 1: the Supabase client here carries the CALLER's JWT, so every
// query and the final status update flow through RLS exactly as they would
// from the browser. The explicit role check just gives a readable error.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Providers. Each takes its own credential shape and a fully-resolved mail,
// returns a provider message id for the audit note.
// ---------------------------------------------------------------------------

type Mail = {
  from: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  attachment: { filename: string; base64: string };
};

type ProviderConfig = {
  kind?: string;
  secret_ref?: string;
  from?: string;
  reply_to?: string;
};

async function sendViaResend(
  creds: { api_key?: string },
  mail: Mail
): Promise<string> {
  if (!creds.api_key) throw new Error("resend credentials are missing api_key");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      cc: mail.cc ? [mail.cc] : undefined,
      reply_to: mail.replyTo ?? undefined,
      subject: mail.subject,
      text: mail.text,
      attachments: [
        { filename: mail.attachment.filename, content: mail.attachment.base64 },
      ],
    }),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(`Resend refused the send: ${result?.message ?? res.statusText}`);
  }
  return `resend ${result.id}`;
}

// --- Gmail ---

function base64FromUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** RFC 2045 wants base64 bodies folded to ≤76-char lines. */
function fold(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/**
 * Non-ASCII headers (vendor names, item names in subjects) need RFC 2047 —
 * and each encoded-word maxes at 75 chars, so long subjects are chunked into
 * adjacent words folded across lines (decoders join them, dropping the fold).
 * Chunks split on CODE POINTS so a multi-byte character never tears.
 */
function encodeHeader(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const points = Array.from(value);
  const words: string[] = [];
  for (let i = 0; i < points.length; i += 10) {
    words.push(`=?UTF-8?B?${base64FromUtf8(points.slice(i, i + 10).join(""))}?=`);
  }
  return words.join("\r\n ");
}

/** One multipart/mixed message: plain-text body + the PDF. */
function buildMime(mail: Mail): string {
  const boundary = "rf-po-boundary";
  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : null,
    mail.replyTo ? `Reply-To: ${mail.replyTo}` : null,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  return [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    fold(base64FromUtf8(mail.text)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${mail.attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${mail.attachment.filename}"`,
    "",
    fold(mail.attachment.base64),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendViaGmail(
  creds: { client_id?: string; client_secret?: string; refresh_token?: string },
  mail: Mail
): Promise<string> {
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new Error(
      "gmail credentials need client_id, client_secret and refresh_token"
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(
      `Gmail auth failed: ${token?.error_description ?? token?.error ?? tokenRes.statusText}`
    );
  }

  // The API wants the whole RFC822 message base64url-encoded.
  const raw = base64FromUtf8(buildMime(mail))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  const result = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gmail refused the send: ${result?.error?.message ?? res.statusText}`
    );
  }
  return `gmail ${result.id}`;
}

const SENDERS: Record<
  string,
  // deno-lint-ignore no-explicit-any
  (creds: any, mail: Mail) => Promise<string>
> = {
  resend: sendViaResend,
  gmail: sendViaGmail,
};

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { po_id, to, cc, subject, body, pdf_base64, filename } =
      await req.json();

    if (!po_id || !to || !subject || !pdf_base64 || !filename) {
      return json(400, { error: "missing po_id, to, subject, pdf_base64 or filename" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select("id, po_number, org_id, location_id")
      .eq("id", po_id)
      .maybeSingle();
    if (poError) return json(400, { error: poError.message });
    if (!po) return json(404, { error: "purchase order not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", po.org_id)
      .maybeSingle();
    if (!member || !["owner", "admin", "purchaser"].includes(member.role)) {
      return json(403, { error: "purchaser role required to send purchase orders" });
    }

    // Transport config: the location's own provider wins over the org's.
    const [{ data: org }, { data: location }] = await Promise.all([
      supabase.from("orgs").select("settings").eq("id", po.org_id).maybeSingle(),
      supabase
        .from("locations")
        .select("settings")
        .eq("id", po.location_id)
        .maybeSingle(),
    ]);
    const cfg: ProviderConfig | undefined =
      (location?.settings as { email_provider?: ProviderConfig } | null)
        ?.email_provider ??
      (org?.settings as { email_provider?: ProviderConfig } | null)
        ?.email_provider;

    if (!cfg?.kind || !cfg.from || !cfg.secret_ref) {
      return json(400, {
        error:
          "email_provider is not configured — set orgs.settings.email_provider " +
          '(or a location override) to {"kind","secret_ref","from"}. ' +
          "See docs/po-email-setup.md",
      });
    }
    const sender = SENDERS[cfg.kind];
    if (!sender) {
      return json(400, {
        error: `unknown email_provider.kind "${cfg.kind}" — expected one of: ${Object.keys(SENDERS).join(", ")}`,
      });
    }
    const rawCreds = Deno.env.get(`EMAIL_CREDS_${cfg.secret_ref}`);
    if (!rawCreds) {
      return json(500, {
        error: `secret EMAIL_CREDS_${cfg.secret_ref} is not set (Edge Functions → Secrets)`,
      });
    }

    const providerId = await sender(JSON.parse(rawCreds), {
      from: cfg.from,
      to,
      cc: cc || undefined,
      replyTo: cfg.reply_to || undefined,
      subject,
      text: body ?? "",
      attachment: { filename, base64: pdf_base64 },
    });

    // The email is out — a failed bookkeeping write must not report failure.
    // sent_notes is the audit trail FMP never had.
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "sent",
        sent_via: "email",
        sent_notes: `emailed to ${to}${cc ? ` (cc ${cc})` : ""} · ${providerId}`,
      })
      .eq("id", po_id);

    return json(200, {
      id: providerId,
      warning: updateError
        ? `sent, but the PO could not be marked: ${updateError.message}`
        : undefined,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
