// THE PROVIDER LAYER — one implementation, two senders.
//
// It was `send-po-email`'s alone until special orders needed to send AS A
// DIFFERENT MAILBOX (decision 12: quotes go out as specialorders@, not info@).
// A second copy would have been the `ui/Dialog` story in Deno: two MIME
// builders, two OAuth refreshes, and eventually two different answers to
// "what does a long non-ASCII subject look like on the wire".
//
// Files under `_shared/` are not deployed as functions themselves — the
// underscore is Supabase's own convention — so this is imported by both.
// **Changing it means redeploying BOTH functions**; the deployed copy of one
// keeps running until you do.
//
// WHAT LIVES WHERE (Mark, 2026-07-24: "every org, or even every location,
// should have its own way to send"):
//   - WHAT to use lives in settings jsonb (design rule 2):
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
// unreliable on this edge runtime. Bonus over any SMTP relay: the sent mail
// lands in that mailbox's Sent folder and threads with the reply.
// NB the From must be the authorized mailbox or one of its configured
// "Send mail as" aliases, or Gmail rewrites it.


export type Mail = {
  /** Set by `sendMail` from the resolved transport — callers never pass it,
   *  because WHO the mail is from is the transport's decision, not the
   *  message's. */
  from?: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  /**
   * OPTIONAL, because not every message this layer sends carries a document.
   * A purchase order and a quote always do; an approval CONFIRMATION does not,
   * and an earlier cut of that attached a one-line placeholder file rather than
   * teach the MIME builder to leave the part out — which put a mystery
   * `approval.txt` in a customer's inbox.
   */
  attachment?: { filename: string; base64: string };
  /**
   * Decision 12: threading, done properly.
   *
   * FileMaker pasted the inbound SUBJECT into the reply so Mail.app would group
   * them (`Email_Token`, Mark: "1000% certain there's a better way"). There is —
   * `In-Reply-To` and `References` are what every client actually threads on.
   * Absent on anything that did not begin as an inquiry, which is the normal
   * case, so a null must produce NO header rather than an empty one.
   */
  inReplyTo?: string;
  references?: string;
};

export type ProviderConfig = {
  kind?: string;
  secret_ref?: string;
  from?: string;
  reply_to?: string;
};

async function sendViaResend(
  creds: { api_key?: string },
  mail: Mail & { from: string }
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
      headers: mail.inReplyTo
        ? { "In-Reply-To": mail.inReplyTo, References: mail.references ?? mail.inReplyTo }
        : undefined,
      attachments: mail.attachment
        ? [{ filename: mail.attachment.filename, content: mail.attachment.base64 }]
        : undefined,
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
function buildMime(mail: Mail & { from: string }): string {
  const boundary = "rf-po-boundary";
  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : null,
    mail.replyTo ? `Reply-To: ${mail.replyTo}` : null,
    `Subject: ${encodeHeader(mail.subject)}`,
    mail.inReplyTo ? `In-Reply-To: ${mail.inReplyTo}` : null,
    mail.references ? `References: ${mail.references}` : null,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);

  // With nothing to attach it is an ORDINARY text message rather than a
  // one-part multipart — some clients render the latter as an empty body with
  // a mysterious attachment, which is the opposite of what a confirmation
  // should look like.
  if (!mail.attachment) {
    return [
      ...headers.filter((h) => !String(h).startsWith("Content-Type: multipart")),
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      fold(base64FromUtf8(mail.text)),
      "",
    ].join("\r\n");
  }

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
  mail: Mail & { from: string }
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

/** A mail whose sender has been resolved — what the providers actually take. */
type ResolvedMail = Mail & { from: string };

export const SENDERS: Record<
  string,
  // deno-lint-ignore no-explicit-any
  (creds: any, mail: ResolvedMail) => Promise<string>
> = {
  resend: sendViaResend,
  gmail: sendViaGmail,
};


/* ==========================================================================
 * TRANSPORT RESOLUTION
 * ==========================================================================
 *
 * Three tiers, in the order Mark settled on 2026-07-24 after reconsidering
 * ("sending emails is something the app provides" — the Bill.com model):
 *
 *   an EXPLICIT config, from wherever the caller says to look
 *     → the ORG's config
 *     → the app's own default sender (`EMAIL_CREDS_DEFAULT`)
 *
 * The first tier is a parameter rather than a fixed path because the two
 * callers look in different places: a purchase order asks the LOCATION first
 * (a shop may have its own mailbox), and a special order asks
 * `settings.special_orders.email_provider` first, because quotes go out as
 * specialorders@ and the info@ credential cannot send as a different account.
 */

export type ResolvedTransport = { cfg: ProviderConfig; creds: unknown };

/** A refusal the caller should hand back verbatim — every one of these names
 *  the exact thing that is missing, because "email failed" sends somebody to
 *  read logs they do not have. */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Read a credential secret.
 *
 * **IT STRIPS CONTROL CHARACTERS BEFORE PARSING, and that is a repair rather
 * than a guess.** Setting one of these means pasting a ~100-character OAuth
 * refresh token into a shell or a dashboard field, and a token that arrives
 * with a newline stuck to its end produces
 *
 *   Bad control character in string literal in JSON at position 262
 *
 * which names neither the secret nor the cause, and reaches whoever pressed
 * Send as the whole explanation of why the email did not go. (Real, Mark
 * 2026-08-17, on the specialorders@ credential; position 262 is the tail of
 * the refresh token in a Google credential set, which is how it was found.)
 *
 * Nothing in these secrets can legitimately contain a control character — they
 * hold OAuth tokens, an API key and a display name — so removing them cannot
 * destroy a real value. And it cannot hide a genuinely broken one either: a
 * token that was TRUNCATED rather than merely wrapped still fails, at the
 * provider, with `invalid_grant`, which says what is wrong.
 */
function readCreds(name: string): unknown {
  const raw = Deno.env.get(name);
  if (!raw) {
    throw new TransportError(
      `secret ${name} is not set (Edge Functions → Secrets)`,
      500
    );
  }
  // C0 controls only: a literal newline, tab or carriage return that got into
  // the value. An escaped `\n` is two ordinary characters and survives.
  // deno-lint-ignore no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F]/g, "");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new TransportError(
      `secret ${name} is not valid JSON (${e instanceof Error ? e.message : String(e)}). ` +
        'It should read {"client_id":"…","client_secret":"…","refresh_token":"…"} for ' +
        'gmail, or {"api_key":"re_…"} for resend, on ONE line. ' +
        "See docs/po-email-setup.md.",
      500
    );
  }
}

export function resolveTransport(args: {
  /** The tier-1 config, already read out of wherever this caller looks. */
  explicit?: ProviderConfig | null;
  /** The org-level config — tier 2. */
  orgProvider?: ProviderConfig | null;
  orgName?: string | null;
  /** Where a reply should land when the APP's own sender is used: the platform
   *  address is send-only, so a vendor or customer replying must reach the org.
   *  Tried in order, first non-empty wins. */
  replyToFallbacks?: (string | null | undefined)[];
}): ResolvedTransport {
  const explicit = args.explicit ?? args.orgProvider ?? null;

  if (explicit) {
    if (!explicit.kind || !explicit.from || !explicit.secret_ref) {
      throw new TransportError(
        'email_provider config is incomplete — needs {"kind","secret_ref","from"}. ' +
          "See docs/po-email-setup.md",
        400
      );
    }
    return {
      cfg: explicit,
      creds: readCreds(`EMAIL_CREDS_${explicit.secret_ref}`),
    };
  }

  if (!Deno.env.get("EMAIL_CREDS_DEFAULT")) {
    throw new TransportError(
      "no email_provider configured for this org, and the app's default sender " +
        "(secret EMAIL_CREDS_DEFAULT) is not set. See docs/po-email-setup.md",
      500
    );
  }
  const dflt = readCreds("EMAIL_CREDS_DEFAULT") as ProviderConfig & { from?: string };
  if (!dflt.from) {
    throw new TransportError(
      'EMAIL_CREDS_DEFAULT is missing "from" (e.g. "{org} <po@yourdomain>")',
      500
    );
  }
  return {
    cfg: {
      kind: dflt.kind ?? "resend",
      from: dflt.from.replace("{org}", args.orgName ?? "Orders"),
      reply_to: (args.replyToFallbacks ?? []).find((v) => v && v.trim()) ?? undefined,
    },
    creds: dflt,
  };
}

/** Look the sender up and send, with a readable error for an unknown kind. */
export async function sendMail(
  transport: ResolvedTransport,
  mail: Mail
): Promise<string> {
  const sender = SENDERS[transport.cfg.kind!];
  if (!sender) {
    throw new TransportError(
      `unknown email_provider.kind "${transport.cfg.kind}" — expected one of: ${Object.keys(
        SENDERS
      ).join(", ")}`,
      400
    );
  }
  return await sender(transport.creds, {
    ...mail,
    from: transport.cfg.from!,
    replyTo: mail.replyTo ?? transport.cfg.reply_to ?? undefined,
  });
}
