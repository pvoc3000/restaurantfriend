"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { clearSessionCookies, type CookieJar } from "@/lib/sessionCookies";
import {
  DEVICE_COOKIE,
  PIN_SESSION_COOKIE,
  isValidPin,
  parseDeviceCookie,
  serializeDeviceCookie,
} from "@/lib/sharedDevice";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * The shared iPad, server side. Everything a registered device does goes
 * through here rather than the browser, for one reason: the device secret and
 * the PIN-session mark live in httpOnly cookies, so a script on the page
 * cannot read either — and the magic-link token that establishes a session is
 * spent HERE, by the server client, so it never reaches the browser at all.
 *
 * Migration 097 is the schema; `device-session` is the edge function these
 * two pre-session calls (`members`, `unlock`) go through. Neither carries a
 * user — the anon key satisfies the platform's JWT check, and the device
 * secret in the body is the credential.
 */

async function isPinSession(jar: CookieJar): Promise<boolean> {
  return jar.get(PIN_SESSION_COOKIE)?.value === "1";
}

/**
 * Claim this browser for the org. Owner/admin, signed in with a PASSWORD —
 * a PIN session may not register a device, or a four-digit PIN is a route to
 * making more four-digit doors.
 *
 * The secret is minted here, its sha256 goes to the database, and the raw
 * value goes into an httpOnly cookie for a year. Server-set, so Safari's
 * seven-day cap on script-written cookies does not apply.
 */
export async function registerThisDevice(name: string): Promise<{ id: string }> {
  const jar = await cookies();
  if (await isPinSession(jar)) {
    throw new Error("Sign in with your password to register a device.");
  }
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("Give the device a name.");

  const secret = randomBytes(32).toString("hex");
  const secretHash = createHash("sha256").update(secret).digest("hex");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_device", {
    p_name: trimmed,
    p_secret_hash: secretHash,
  });
  if (error) throw new Error(error.message);
  const id = data as string;

  jar.set(DEVICE_COOKIE, serializeDeviceCookie({ id, secret }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });

  return { id };
}

/** Which device THIS browser is, if any — the id only, never the secret. */
export async function thisDeviceId(): Promise<string | null> {
  const jar = await cookies();
  return parseDeviceCookie(jar.get(DEVICE_COOKIE)?.value)?.id ?? null;
}

/**
 * Forget a device. Revokes it in the database (owner/admin) and, if it is the
 * one this browser holds, drops the cookie too so the next reopen lands on
 * /login rather than a lock screen that refuses everyone.
 */
export async function forgetDevice(id: string): Promise<void> {
  const jar = await cookies();
  if (await isPinSession(jar)) {
    throw new Error("Sign in with your password to forget a device.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revoke_registered_device", { p_id: id });
  if (error) throw new Error(error.message);
  if (Number(data ?? 0) === 0) {
    throw new Error("That device was not forgotten — it may not be yours to forget.");
  }
  const mine = parseDeviceCookie(jar.get(DEVICE_COOKIE)?.value);
  if (mine?.id === id) jar.delete(DEVICE_COOKIE);
}

/**
 * Lock: end THIS browser's session. `scope: "local"` is load-bearing —
 * supabase-js defaults to `global`, which revokes every refresh token the
 * user holds, so locking the shared iPad would sign the manager out of their
 * own phone.
 *
 * It does NOT `redirect()`. The caller does `window.location.assign("/lock")`
 * once this resolves, and that is not a stylistic choice: a server action
 * that signs out and redirects also makes Next re-render the page it was
 * called from, whose `getAppSession` now finds no user and throws a redirect
 * of its own — two navigations from one router state, and whichever lands
 * last wins. Measured 2026-09-09: the masthead's form happened to land on
 * /lock, the idle lock happened to land on /login. A hard navigation after
 * the action returns is one navigation, and it empties the client-side Maps
 * on the way, which the unlock already relies on.
 */
export async function lockDevice(): Promise<{ ok: true }> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const jar = await cookies();
  clearSessionCookies(jar);
  return { ok: true };
}

type FunctionCall =
  | { action: "members" }
  | { action: "unlock"; user_id: string; pin: string };

async function callDeviceSession(body: FunctionCall & { secret: string }) {
  const { url, anonKey } = supabaseEnv();
  const res = await fetch(`${url}/functions/v1/device-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export type LockMember = { user_id: string; name: string };

/**
 * Who this device may offer. `unknown` means the cookie names a device the
 * database no longer recognises (forgotten, or corrupt) — the lock page
 * treats that as "sign in with a password".
 */
export async function lockScreenMembers(): Promise<
  | { ok: true; members: LockMember[]; deviceName: string | null }
  | { ok: false; reason: "no_device" | "unknown" | "error" }
> {
  const jar = await cookies();
  const device = parseDeviceCookie(jar.get(DEVICE_COOKIE)?.value);
  if (!device) return { ok: false, reason: "no_device" };

  const { status, json } = await callDeviceSession({ action: "members", secret: device.secret });
  if (status === 401) return { ok: false, reason: "unknown" };
  if (status !== 200) return { ok: false, reason: "error" };
  const named = json.device as { name?: string } | undefined;
  return {
    ok: true,
    members: (json.members ?? []) as LockMember[],
    deviceName: named?.name ?? null,
  };
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "wrong" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number }
  | { ok: false; reason: "unknown_device" }
  | { ok: false; reason: "error"; message: string };

/**
 * The unlock. The edge function verifies the PIN (in Postgres, under an
 * advisory lock) and returns a magic-link `token_hash`; the SERVER client
 * spends it, which writes the auth cookies from inside this action — the
 * token is never in the browser. Then the previous person's session cookies
 * go, and the PIN-session mark is set so this session cannot change a
 * password or a PIN.
 *
 * The caller does a HARD navigation afterwards (`window.location.assign`),
 * which is what resets the client-side Maps in `scrollMemory`, `viewMemory`
 * and `navMemoryStore` — a soft navigation would carry them over.
 */
export async function unlockWithPin(userId: string, pin: string): Promise<UnlockResult> {
  if (!isValidPin(pin)) return { ok: false, reason: "wrong" };

  const jar = await cookies();
  const device = parseDeviceCookie(jar.get(DEVICE_COOKIE)?.value);
  if (!device) return { ok: false, reason: "unknown_device" };

  const { status, json } = await callDeviceSession({
    action: "unlock",
    secret: device.secret,
    user_id: userId,
    pin,
  });

  if (status === 401) return { ok: false, reason: "unknown_device" };
  if (status !== 200) {
    return { ok: false, reason: "error", message: String(json.error ?? `HTTP ${status}`) };
  }
  if (json.ok !== true) {
    if (json.reason === "locked") {
      return {
        ok: false,
        reason: "locked",
        retryAfterSeconds: Number(json.retry_after_seconds ?? 60),
      };
    }
    return { ok: false, reason: "wrong" };
  }

  const tokenHash = String(json.token_hash ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) return { ok: false, reason: "error", message: error.message };

  clearSessionCookies(jar);
  jar.set(PIN_SESSION_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return { ok: true };
}
