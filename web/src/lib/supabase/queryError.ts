import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { DEVICE_COOKIE } from "@/lib/sharedDevice";

/**
 * PostgREST's codes for a rejected sign-in token: PGRST301 (invalid or, on
 * older servers, expired) and PGRST303 (expired). Either means the session
 * went stale, not that the query was wrong.
 */
const STALE_SESSION_CODES = new Set(["PGRST301", "PGRST303"]);

/**
 * Rethrow a server-side query error so it reads as one.
 *
 * Throwing the PostgrestError itself — `if (error) throw error` — hands React
 * a plain object rather than an `Error`, and the dev overlay shows it as
 * `{code: ..., details: Null, hint: Null, message: ...}` with a stack that
 * starts inside React (2026-10-31: a sign-in left open overnight failed its
 * refresh, and the next page load's locations query got a 401).
 *
 * A stale sign-in is sent to sign in again, the same place `getAppSession`
 * sends a missing one: a registered iPad to its picker, anything else to the
 * password screen. Anything else becomes a real `Error` with the message and
 * code in it.
 */
export async function throwQueryError(error: PostgrestError): Promise<never> {
  if (STALE_SESSION_CODES.has(error.code)) {
    const jar = await cookies();
    redirect(jar.has(DEVICE_COOKIE) ? "/lock" : "/login");
  }
  throw new Error(`${error.message} (${error.code})`, { cause: error });
}
