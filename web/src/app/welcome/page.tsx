"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Where an invited person lands: set a password, say what to call you, in.
 *
 * Outside the (app) group, like /login — no session, no nav, no location
 * context. `proxy.ts` exempts this path, because whoever arrives here has no
 * session at all until the form is submitted.
 *
 * **Nothing is verified on load, and that is the point.** The invite link
 * carries a ONE-TIME token, and mail scanners and link previewers follow URLs
 * in email as a matter of course — verifying in an effect would let a
 * corporate spam filter spend the invitation before the person ever clicked
 * it, and they'd arrive to an error. So the token is spent by the submit
 * handler, once, deliberately.
 */
export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <Welcome />
    </Suspense>
  );
}

function Welcome() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") === "magiclink" ? "magiclink" : "invite";

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those two passwords aren't the same.");
      return;
    }
    if (!tokenHash) {
      setError("This link is incomplete. Ask a manager to send another.");
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Spending the token signs them in — the browser client writes the auth
    // cookies, so the two calls after this are authenticated.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (verifyError) {
      setBusy(false);
      setError(
        "This invitation has expired or has already been used. Ask a manager to send another."
      );
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setBusy(false);
      setError(passwordError.message);
      return;
    }

    // migration 002's two-column definer function — the only way a member may
    // write their own row, since a self-update policy would also let them
    // change their own role. Setting the name is also what flips the App
    // access block on their employee record from "invited" to "signed in".
    const { error: profileError } = await supabase.rpc("set_my_member_profile", {
      p_display_name: displayName.trim(),
    });
    if (profileError) {
      // The account works; only the name didn't stick. Not worth blocking on.
      console.warn("could not set the display name", profileError.message);
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
        <h1 className="bg-ink px-6 py-4 text-[15px] font-bold uppercase tracking-[0.06em] text-white">
          Welcome
        </h1>

        <div className="space-y-5 p-6">
          <p className="text-sm text-muted">
            Choose a password and you&rsquo;re in.
          </p>

          <label className="block space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Your name
            </span>
            <input
              type="text"
              required
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full border border-ink px-3 outline-none focus:border-2"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
              Again
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-9 w-full border border-ink px-3 outline-none focus:border-2"
            />
          </label>

          {error && <p className="text-sm text-accent">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="h-11 w-full bg-ink text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {busy ? "Setting up…" : "Set my password"}
          </button>
        </div>
      </form>
    </div>
  );
}
