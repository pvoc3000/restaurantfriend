// ============================================================================
// invite-member — give a person access to the app, or take it away.
//
// This replaces the FMP ADMIN tab, where an admin typed a username and a
// PLAIN-TEXT password into two fields on the employee record and picked a user
// level from a 1–5 radio. Everyone who could open an employee could read
// everyone's credentials, and the meaning of the levels lived only in script
// logic.
//
// Here nothing about a credential is ever stored or transmitted by us: the
// Supabase admin API mints a one-time invite link, we mail it through the
// org's own sender, and the person sets their own password on /welcome.
//
// SIBLING COPY. The provider layer below (Mail, buildMime, sendViaResend,
// sendViaGmail, SENDERS, and the tier resolution in the handler) is copied
// from `send-po-email/index.ts`. There is no _shared folder, and introducing
// one would couple two independently deployed functions — one of them already
// smoke-tested against production Gmail — for a single reuse. If you change
// the MIME builder or add a provider, change BOTH files.
//
// ONE DIFFERENCE in the copy, deliberate: `Mail.attachment` is optional here,
// and `buildMime` emits a plain text/plain message when it's absent. An invite
// carries a link, not a document. (The with-attachment path must stay
// byte-identical to send-po-email's — the fixtures pin both.)
//
// TWO CLIENTS, and the split is the security design:
//   - the CALLER's client (their JWT) does every read, so RLS decides what
//     they can see. Fetching the employee through it is itself the gate.
//   - a SERVICE client does only what the admin API requires — mint a link,
//     ban/unban — plus the two writes that follow from it.
// The explicit owner/admin check exists to produce a readable error rather
// than a silent empty result.
//
// Secrets: the EMAIL_CREDS_* the PO sender already uses, plus APP_URL (where
// /welcome lives). Platform config, not org config — a deploy URL is not
// business terminology.
// ============================================================================

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
// Providers — see the sibling-copy note above.
// ---------------------------------------------------------------------------

type Mail = {
  from: string;
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** Absent for an invite; present for a PO. */
  attachment?: { filename: string; base64: string };
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
 * Non-ASCII headers need RFC 2047 — and each encoded-word maxes at 75 chars,
 * so long subjects are chunked into adjacent words folded across lines.
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

/**
 * With an attachment: one multipart/mixed message, byte-identical to
 * send-po-email's. Without one: a plain text/plain message, because a
 * multipart wrapper around a single text part is a mail client's problem for
 * no reason.
 */
function buildMime(mail: Mail): string {
  const common = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : null,
    mail.replyTo ? `Reply-To: ${mail.replyTo}` : null,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (!mail.attachment) {
    return [
      ...common,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      fold(base64FromUtf8(mail.text)),
      "",
    ].join("\r\n");
  }

  const boundary = "rf-po-boundary";
  return [
    ...common,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
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
// Invite templates. In orgs.settings per design rule 2 — the old system
// hardcoded "The Donut Friend Team" into a script and we don't.
// ---------------------------------------------------------------------------

const DEFAULT_SUBJECT = "Your {org} account";
const DEFAULT_BODY = `Hi {first_name},

You've been given access to the {org} app as {role_label}.

Set your password and sign in here:
{invite_url}

This link works once. If it's expired by the time you get to it, ask a manager to send another.`;

function fill(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);
}

/** What an invite may set. 'owner' is deliberately not assignable here. */
const ASSIGNABLE = ["admin", "purchaser", "supervisor", "staff"];

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action, employee_id, email, role } = await req.json();

    if (action !== "invite" && action !== "revoke") {
      return json(400, { error: 'action must be "invite" or "revoke"' });
    }
    if (!employee_id) return json(400, { error: "missing employee_id" });
    if (action === "invite" && !ASSIGNABLE.includes(role)) {
      return json(400, {
        error: `role must be one of: ${ASSIGNABLE.join(", ")}`,
      });
    }

    // --- the caller, and what RLS lets them see --------------------------
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    // employees is owner/admin-only under RLS (020), so a purchaser or staff
    // caller gets no row here and never reaches the role check below.
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, org_id, first_name, last_name, email, user_id")
      .eq("id", employee_id)
      .maybeSingle();
    if (employeeError) return json(400, { error: employeeError.message });
    if (!employee) return json(404, { error: "employee not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", employee.org_id)
      .maybeSingle();
    if (!member || !["owner", "admin"].includes(member.role)) {
      return json(403, {
        error: "manager role required to change who can use the app",
      });
    }

    // --- the service client: the admin API, and the writes that follow ----
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // ---------------------------------------------------------------------
    // REVOKE
    // ---------------------------------------------------------------------
    if (action === "revoke") {
      if (!employee.user_id) {
        return json(400, { error: "this employee has no app access" });
      }
      const userId = employee.user_id as string;

      // Membership FIRST: it is what every RLS policy in the schema reads, so
      // deleting it shuts the door even if the ban call below fails.
      const { error: memberError } = await admin
        .from("org_members")
        .delete()
        .eq("user_id", userId)
        .eq("org_id", employee.org_id);
      if (memberError) return json(400, { error: memberError.message });

      // Ban, never DELETE the auth user: 001's audit columns
      // (price_history.changed_by and friends) reference auth.users with no
      // cascade, so a delete would be refused for anyone who ever changed a
      // price — and the history should keep its author regardless.
      const { error: banError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });

      const { error: linkError } = await admin
        .from("employees")
        .update({ user_id: null })
        .eq("id", employee.id);

      const problems = [
        banError ? `the account could not be disabled: ${banError.message}` : null,
        linkError ? `the employee link could not be cleared: ${linkError.message}` : null,
      ].filter(Boolean);

      return json(200, {
        status: "revoked",
        user_id: userId,
        // Membership is gone either way, so this is a warning and not an error.
        warning: problems.length ? problems.join("; ") : undefined,
      });
    }

    // ---------------------------------------------------------------------
    // INVITE
    // ---------------------------------------------------------------------
    const address = String(email ?? employee.email ?? "").trim();
    if (!address) {
      return json(400, {
        error:
          "no email address — fill in the employee's email, or type one in the invite",
      });
    }

    const appUrl = Deno.env.get("APP_URL");
    if (!appUrl) {
      return json(500, {
        error:
          "secret APP_URL is not set (Edge Functions → Secrets) — the invite " +
          "link has nowhere to point. See docs/po-email-setup.md",
      });
    }

    // Mint the link. `invite` creates the auth user; if the address already has
    // one — a previous revoke, or a second employee record — that errors, and
    // a magic link does the same job for an account that already exists.
    let status: "invited" | "reinvited" = "invited";
    let linkType: "invite" | "magiclink" = "invite";
    let generated = await admin.auth.admin.generateLink({
      type: "invite",
      email: address,
    });

    if (generated.error) {
      const alreadyExists =
        generated.error.status === 422 ||
        /already been registered|already exists/i.test(generated.error.message);
      if (!alreadyExists) {
        return json(400, { error: generated.error.message });
      }
      // An account that was revoked is BANNED; lift it or the link signs them
      // in to a wall.
      const { data: existing } = await admin.auth.admin.listUsers();
      const found = existing?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === address.toLowerCase()
      );
      if (found) {
        await admin.auth.admin.updateUserById(found.id, { ban_duration: "none" });
      }
      status = "reinvited";
      linkType = "magiclink";
      generated = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: address,
      });
      if (generated.error) return json(400, { error: generated.error.message });
    }

    const invitedUser = generated.data?.user;
    const hashedToken = generated.data?.properties?.hashed_token;
    if (!invitedUser || !hashedToken) {
      return json(500, { error: "the invite link came back incomplete" });
    }

    // Membership. On conflict update ONLY invited_at — a re-send must never
    // silently reset the role of someone who is already using the app; role
    // changes are their own explicit edit on the employee screen.
    const { error: upsertError } = await admin
      .from("org_members")
      .upsert(
        {
          org_id: employee.org_id,
          user_id: invitedUser.id,
          role,
          invited_at: new Date().toISOString(),
        },
        { onConflict: "org_id,user_id", ignoreDuplicates: false }
      )
      .select("user_id");
    if (upsertError) return json(400, { error: upsertError.message });

    // Link the employee record, unless it already points somewhere else.
    if (employee.user_id && employee.user_id !== invitedUser.id) {
      return json(409, {
        error:
          "this employee is already linked to a different account — remove " +
          "their access first",
      });
    }
    if (!employee.user_id) {
      const { error: linkError } = await admin
        .from("employees")
        .update({ user_id: invitedUser.id })
        .eq("id", employee.id);
      if (linkError) return json(400, { error: linkError.message });
    }

    // --- send it, through the org's own sender ---------------------------
    // Org tier only: an invite is to the ORG, and no location is in scope.
    const { data: org } = await supabase
      .from("orgs")
      .select("name, settings")
      .eq("id", employee.org_id)
      .maybeSingle();
    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      invite_email?: { subject?: string; body?: string };
      po_email?: { cc?: string; reply_to?: string };
      billing?: { email?: string };
    };

    let cfg: ProviderConfig;
    let creds: unknown;
    const explicit = orgSettings.email_provider;
    if (explicit) {
      if (!explicit.kind || !explicit.from || !explicit.secret_ref) {
        return json(400, {
          error:
            'email_provider config is incomplete — needs {"kind","secret_ref","from"}. ' +
            "See docs/po-email-setup.md",
        });
      }
      const rawCreds = Deno.env.get(`EMAIL_CREDS_${explicit.secret_ref}`);
      if (!rawCreds) {
        return json(500, {
          error: `secret EMAIL_CREDS_${explicit.secret_ref} is not set (Edge Functions → Secrets)`,
        });
      }
      cfg = explicit;
      creds = JSON.parse(rawCreds);
    } else {
      const rawDefault = Deno.env.get("EMAIL_CREDS_DEFAULT");
      if (!rawDefault) {
        return json(500, {
          error:
            "no email_provider configured for this org, and the app's default " +
            "sender (secret EMAIL_CREDS_DEFAULT) is not set. " +
            "See docs/po-email-setup.md",
        });
      }
      const dflt = JSON.parse(rawDefault) as ProviderConfig & { from?: string };
      if (!dflt.from) {
        return json(500, {
          error: 'EMAIL_CREDS_DEFAULT is missing "from" (e.g. "{org} <po@yourdomain>")',
        });
      }
      cfg = {
        kind: dflt.kind ?? "resend",
        from: dflt.from.replace("{org}", org?.name ?? "Operations"),
        // A reply to an invite is a question for the org, not for the platform.
        reply_to:
          orgSettings.po_email?.reply_to ??
          orgSettings.po_email?.cc ??
          orgSettings.billing?.email,
      };
      creds = dflt;
    }

    const sender = SENDERS[cfg.kind!];
    if (!sender) {
      return json(400, {
        error: `unknown email_provider.kind "${cfg.kind}" — expected one of: ${Object.keys(SENDERS).join(", ")}`,
      });
    }

    // The link points at OUR page, not at Supabase's verify endpoint: /welcome
    // is where the password gets set, and it deliberately doesn't spend the
    // token until the form is submitted (mail scanners follow links).
    const inviteUrl =
      `${appUrl.replace(/\/$/, "")}/welcome` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=${linkType}`;

    const ROLE_LABEL: Record<string, string> = {
      admin: "a manager",
      purchaser: "a purchaser",
      supervisor: "a supervisor",
      staff: "staff",
    };
    const values = {
      first_name: (employee.first_name as string) ?? "there",
      org: org?.name ?? "the app",
      role_label: ROLE_LABEL[role] ?? role,
      invite_url: inviteUrl,
    };

    const providerId = await sender(creds, {
      from: cfg.from!,
      to: address,
      replyTo: cfg.reply_to || undefined,
      subject: fill(orgSettings.invite_email?.subject ?? DEFAULT_SUBJECT, values),
      text: fill(orgSettings.invite_email?.body ?? DEFAULT_BODY, values),
    });

    return json(200, {
      status,
      user_id: invitedUser.id,
      email: address,
      provider_id: providerId,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
