"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

// Client-side Supabase client (browser only). Used by the login form.
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
