// request-password-reset — the only unauthenticated write path in the app that
// sends mail to an existing person.
//
// `/login` had no way back for somebody who forgot their password (Mark,
// 2026-08-29). Supabase's own `resetPasswordForEmail` would have been one line
// and is the wrong line here: it sends through Supabase's built-in mailer, from
// a supabase.co address, on a handful-per-hour free quota — where every other
// message this app sends goes out as the org, through `_shared/email.ts`. A
// password reset is the LAST message you want arriving from somewhere the
// recipient does not recognise.
//
// ---------------------------------------------------------------------------
// THE ANSWER IS ALWAYS THE SAME
//
// 052 and 057's rule, and the whole security property of this endpoint: the
// reply does not say whether the address has an account. Not in its body, not
// in its status, and — because the throttle records unknown addresses too —
// not in how long it takes on the second attempt either. An endpoint that
// answers differently is an account enumerator with a friendly face.
//
// It also NEVER RAISES for anything the caller could control. Every refusal is
// the same 200.
//
// ---------------------------------------------------------------------------
// A BANNED ACCOUNT GETS NOTHING
//
// Revoking access bans the auth user (4c) rather than deleting it, so a
// revoked person still has a row `generateLink` would happily mint against.
// Access removed is not a password to be reset, so they are skipped — silently,
// like every other case.
//
// Secrets: APP_URL, and the EMAIL_CREDS_* the rest of the layer uses.
// Needs migration 074.

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  resolveTransport,
  sendMail,
  TransportError,
  type ProviderConfig,
} from "../_shared/email.ts";

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

/** Per address, per hour. Three is enough for somebody whose mail is slow. */
const PER_EMAIL_HOURLY = 3;
/** And across the whole org, so the shared Gmail quota cannot be drained. */
const GLOBAL_HOURLY = 30;

/** The one answer, whatever happened. */
const SAME_ANSWER = {
  ok: true,
  message:
    "If that address has an account, a link to set a new password is on its way.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { email } = await req.json().catch(() => ({}));
    const address = typeof email === "string" ? email.trim().toLowerCase() : "";

    // A malformed address is the ONE thing worth saying out loud: it is about
    // what the person typed, not about who exists.
    if (address === "" || !address.includes("@")) {
      return json(400, { error: "that does not look like an email address" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const sourceIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const record = async (sent: boolean, detail: string) => {
      await admin.from("password_reset_requests").insert({
        email: address,
        sent,
        detail,
        source_ip: sourceIp,
      });
    };

    // ---- the throttle, before anything else ------------------------------
    // Counted for unknown addresses too — see the header. Both counts come
    // back head-only, so this is two index probes.
    const [{ count: mine }, { count: everyone }] = await Promise.all([
      admin
        .from("password_reset_requests")
        .select("*", { count: "exact", head: true })
        .eq("email", address)
        .gte("requested_at", since),
      admin
        .from("password_reset_requests")
        .select("*", { count: "exact", head: true })
        .gte("requested_at", since),
    ]);

    if ((mine ?? 0) >= PER_EMAIL_HOURLY || (everyone ?? 0) >= GLOBAL_HOURLY) {
      await record(false, "throttled");
      return json(200, SAME_ANSWER);
    }

    // ---- who is this? ----------------------------------------------------
    // Paged, because `listUsers` defaults to 50 and an org that outgrew one
    // page would start reporting real accounts as unknown.
    let user: { id: string; email?: string; banned_until?: string } | null = null;
    for (let page = 1; page <= 20 && !user; page += 1) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const batch = data?.users ?? [];
      user =
        (batch.find((u) => (u.email ?? "").toLowerCase() === address) as
          | typeof user
          | undefined) ?? null;
      if (batch.length < 200) break;
    }

    if (!user) {
      await record(false, "no account");
      return json(200, SAME_ANSWER);
    }

    const banned =
      typeof user.banned_until === "string" &&
      new Date(user.banned_until).getTime() > Date.now();
    if (banned) {
      await record(false, "access revoked");
      return json(200, SAME_ANSWER);
    }

    const appUrl = Deno.env.get("APP_URL");
    if (!appUrl) {
      await record(false, "APP_URL is not set");
      // A 500 here, not the uniform answer: this is OUR misconfiguration and
      // it reveals nothing about the address.
      return json(500, {
        error:
          "secret APP_URL is not set (Edge Functions → Secrets) — the reset " +
          "link has nowhere to point. See docs/po-email-setup.md",
      });
    }

    // ---- mint it ---------------------------------------------------------
    const generated = await admin.auth.admin.generateLink({
      type: "recovery",
      email: address,
    });
    const hashedToken = generated.data?.properties?.hashed_token;
    if (generated.error || !hashedToken) {
      await record(false, generated.error?.message ?? "no token came back");
      return json(200, SAME_ANSWER);
    }

    // `/welcome` is the app's own set-a-password page and already verifies a
    // `token_hash` of a named type. The name greets them; only the token
    // carries any authority.
    const link =
      `${appUrl.replace(/\/$/, "")}/welcome` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;

    // ---- send it, as the org --------------------------------------------
    // One org for years (spec §0), and this call is pre-auth so there is no
    // membership to read a tier from — the org's own provider, or the app's
    // default sender behind it.
    const { data: org } = await admin
      .from("orgs")
      .select("name, settings")
      .limit(1)
      .maybeSingle();

    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const billing = (settings.billing ?? {}) as Record<string, unknown>;

    const transport = resolveTransport({
      orgProvider: settings.email_provider as ProviderConfig | undefined,
      orgName: org?.name ?? undefined,
      replyToFallbacks: [billing.email as string | undefined],
    });

    const orgName = org?.name ?? "Restaurant Friend";
    try {
      await sendMail(transport, {
        to: address,
        subject: `Set a new ${orgName} password`,
        text: [
          `Somebody asked to reset the password for this ${orgName} account.`,
          "",
          "Open this link to choose a new one. It works once:",
          link,
          "",
          "If that wasn't you, nothing has changed and you can ignore this.",
        ].join("\n"),
      });
    } catch (e) {
      await record(false, `send failed: ${(e as Error).message}`);
      // STILL the uniform answer. A send failure the caller can see is a way
      // to learn the address exists.
      return json(200, SAME_ANSWER);
    }

    await record(true, "sent");
    return json(200, SAME_ANSWER);
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: (e as Error).message });
  }
});
