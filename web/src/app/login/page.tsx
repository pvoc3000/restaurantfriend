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
  // The reset leg. `sent` is the uniform answer coming back — it says the same
  // thing whether or not the address has an account, which is the whole point
  // of the endpoint behind it.
  const [resetting, setResetting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

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

  /**
   * Ask for a link to set a new password.
   *
   * It reuses the EMAIL FIELD rather than opening a dialog with a second one:
   * somebody who has just failed to sign in has already typed their address,
   * and asking for it again is asking them to prove they know it twice.
   *
   * The answer it shows is deliberately the same either way. `request-password-
   * reset` never says whether an account exists and this must not either — a
   * screen that said "no such account" would undo the endpoint's care.
   */
  async function requestReset() {
    const address = email.trim();
    if (address === "" || !address.includes("@")) {
      setError("Type your email address first, then ask for a link.");
      return;
    }

    setResetting(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("request-password-reset", {
      body: { email: address },
    });
    setResetting(false);

    if (error) {
      setError(
        "That couldn't be sent just now. Try again in a minute, or ask a manager to invite you again."
      );
      return;
    }
    setSent(
      (data as { message?: string })?.message ??
        "If that address has an account, a link to set a new password is on its way."
    );
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
          {sent && <p className="text-sm">{sent}</p>}

          <button
            type="submit"
            disabled={busy}
            className="h-11 w-full border border-ink bg-white text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {/* Quiet, and BELOW the commit — it is the way out of a dead end, not
              a second thing to choose between. `type="button"`, or it would
              submit the form it sits inside. */}
          <button
            type="button"
            disabled={busy || resetting || sent !== null}
            onClick={() => void requestReset()}
            className="block w-full text-center text-[12px] uppercase tracking-[0.06em] text-muted underline hover:text-ink disabled:no-underline disabled:opacity-35"
          >
            {resetting ? "Sending…" : "Forgot your password?"}
          </button>
        </div>
      </form>
    </div>
  );
}
