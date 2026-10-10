import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/**
 * A Supabase client with the ANON key and NO session — for a route handler
 * that answers somebody who is not signed in and never will be (a calendar app
 * fetching `/calendar-feed/[token]`).
 *
 * `lib/supabase/server` is bound to the request's cookies and would attach
 * whatever session they hold; this one cannot. It is the same public key the
 * browser carries, so it reaches only what `anon` has been granted by name:
 * definer functions, never a table.
 */
export function createAnonClient() {
  const { url, anonKey } = supabaseEnv();
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
