// Both values are public by design (the anon key is safe in the browser because
// every table is protected by RLS). They live in web/.env.local — see
// web/.env.local.example. Failing loudly here beats a confusing runtime error.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase env vars. Copy web/.env.local.example to web/.env.local " +
        "and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return { url, anonKey };
}
