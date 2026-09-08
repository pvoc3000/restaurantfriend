// device-session — a shared iPad's two pre-session calls: who may unlock it,
// and an unlock.
//
// Why (Mark, 2026-09-08): staff share one iPad, and without something
// proactive the next person keeps working in whoever's account is open. The
// iPad is REGISTERED to the org (migration 097); a person picks their name and
// enters a four-digit PIN; this function verifies it and mints a magic-link
// token that the app spends exactly the way /welcome spends an invitation —
// so the result is a REAL session for that person and every `created_by` in
// the schema keeps meaning what it says.
//
// ---------------------------------------------------------------------------
// THERE IS NO CALLER HERE
//
// Both actions arrive from a Next server action carrying only the anon key
// (`apikey` + `Authorization: Bearer <anon>`), which is what satisfies the
// platform's default `verify_jwt` — the same posture as
// `request-password-reset`. This function must NEVER call `getUser()`: there
// is nobody to get. The credential is the DEVICE SECRET in the body, minted
// by `registerThisDevice` and held in an httpOnly cookie on the iPad; it is
// hashed here and the hash is what the database compares. (If the project
// ever moves from the JWT-shaped anon key to a publishable key, verify_jwt
// will refuse these calls and this function needs `--no-verify-jwt`, the way
// `qbo-oauth` is deployed.)
//
// ---------------------------------------------------------------------------
// THE DATABASE DECIDES, AND SAYS ONE WORD
//
// `attempt_pin_unlock` (097) takes the device hash, the picked id and the PIN,
// and answers bad_device | locked | wrong | ok — the throttle, the attempt
// record and the bcrypt comparison all happen inside it under an advisory
// lock. This function never sees a hash and cannot be raced. An unknown id
// and a wrong PIN both come back `wrong`.
//
// Only on `ok` does the admin API come into it: the user is resolved BY ID
// (`getUserById` — which is also the ban check, since revoking access bans
// the auth user rather than deleting it) and the magic link is minted against
// THAT email. Never `generateLink` against an address that did not come from
// the id: a magiclink for an unknown address can create a user.
//
// Needs migration 097. Deploy with the default JWT verification.

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

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const PIN_RE = /^[0-9]{4}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const secret = typeof body.secret === "string" ? body.secret : "";

    if (action !== "members" && action !== "unlock") {
      return json(400, { error: "unknown action" });
    }
    if (!SECRET_RE.test(secret)) {
      // Shaped wrong, not merely unknown: the cookie is corrupt or somebody is
      // poking. Either way, not a device.
      return json(401, { error: "unknown device" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const secretHash = await sha256Hex(secret);

    // ---- members ---------------------------------------------------------
    if (action === "members") {
      // The device row first: its name goes on the lock screen, and its
      // absence is how an unknown or forgotten device is told apart from a
      // live one whose org simply holds no PINs yet.
      const { data: device } = await admin
        .from("registered_devices")
        .select("name")
        .eq("secret_hash", secretHash)
        .is("revoked_at", null)
        .maybeSingle();
      if (!device) return json(401, { error: "unknown device" });

      const { data, error } = await admin.rpc("device_members", {
        p_secret_hash: secretHash,
      });
      if (error) return json(500, { error: error.message });
      const members = (data ?? []) as { user_id: string; name: string }[];
      return json(200, { members, device: { name: device.name } });
    }

    // ---- unlock ----------------------------------------------------------
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    const sourceIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    if (!/^[0-9a-f-]{36}$/.test(userId) || !PIN_RE.test(pin)) {
      // A malformed request is about what was SENT, not about who exists.
      return json(400, { error: "missing user_id or pin" });
    }

    const { data: attempt, error: attemptError } = await admin.rpc(
      "attempt_pin_unlock",
      {
        p_secret_hash: secretHash,
        p_user: userId,
        p_pin: pin,
        p_ip: sourceIp,
      }
    );
    if (attemptError) return json(500, { error: attemptError.message });

    const row = (attempt ?? [])[0] as
      | { result: string; retry_after_seconds: number | null }
      | undefined;
    const result = row?.result ?? "wrong";

    if (result === "bad_device") return json(401, { error: "unknown device" });
    if (result === "locked") {
      return json(200, {
        ok: false,
        reason: "locked",
        retry_after_seconds: row?.retry_after_seconds ?? 60,
      });
    }
    if (result !== "ok") return json(200, { ok: false, reason: "wrong" });

    // ---- the PIN was right; is the person still allowed in? --------------
    const { data: found, error: userError } =
      await admin.auth.admin.getUserById(userId);
    const user = found?.user;
    if (userError || !user?.email) {
      return json(200, { ok: false, reason: "wrong" });
    }
    const bannedUntil = (user as { banned_until?: string }).banned_until;
    const banned =
      typeof bannedUntil === "string" &&
      new Date(bannedUntil).getTime() > Date.now();
    if (banned) return json(200, { ok: false, reason: "wrong" });

    const generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    const hashedToken = generated.data?.properties?.hashed_token;
    if (generated.error || !hashedToken) {
      return json(500, {
        error: generated.error?.message ?? "no token came back",
      });
    }

    return json(200, { ok: true, token_hash: hashedToken });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
