"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Email/password sign-in. The browser client writes the auth cookies; the
// middleware then sees the session and lets us into the app.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm border-2 border-ink bg-white"
      >
        {/* The wordmark as the card's black title bar — there is no logo, and
            none should be drawn. */}
        <h1 className="bg-ink px-6 py-4 text-[15px] font-bold uppercase tracking-[0.06em] text-white">
          Restaurant Friend
        </h1>

        <div className="space-y-5 p-6">
          <label className="block space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full border border-ink px-3 outline-none focus:border-2"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Password
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full border border-ink px-3 outline-none focus:border-2"
            />
          </label>

          {error && <p className="text-sm text-accent">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="h-11 w-full bg-ink text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
