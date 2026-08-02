"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
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

  // Cosmetic, and passed in the link because this page has no session and so
  // can't read the org or the employee itself. Trimmed to a sane length: it
  // goes in a heading, and nothing is authorised by it.
  const org = (params.get("org") ?? "").trim().slice(0, 60);

  // Their name is NOT asked for (Mark, 2026-08-02: "we know their name
  // already. Let's keep it simple"). It rides the link from the employee
  // record and is written for them, so the only thing this page asks is the
  // one thing we genuinely can't know.
  const invitedName = (params.get("name") ?? "").trim().slice(0, 60);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Hydration guard, and it is the whole reason this page failed silently
   * (Mark, 2026-08-02: "nothing happens… the fields just clear").
   *
   * Until React hydrates, `onSubmit` isn't attached and the button is still a
   * plain `type="submit"` inside a plain form — so pressing it makes the
   * BROWSER submit natively. These inputs carry no `name`, so a native GET
   * rewrites the query string to nothing: `/welcome?`. The one-time token is
   * gone, the page reloads with empty fields, and not a line of our code ever
   * ran — which is exactly "no feedback, and the fields cleared".
   *
   * Disabled until mounted, the press does nothing instead of destroying the
   * invitation. (It also makes the sub-16.4 Safari case visible rather than
   * silent — see CLAUDE.md's browser floor: there the button simply never
   * enables, instead of eating the link.)
   */
  // `useSyncExternalStore` rather than an effect: the server snapshot is
  // false, the client snapshot is true, so this flips exactly when hydration
  // happens — and it doesn't trip the `set-state-in-effect` lint the way
  // `useEffect(() => setReady(true), [])` does. Same reason columnWidths reads
  // its store this way.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenHash) {
      setError(
        "This link is missing its token. That usually means it was opened, " +
          "reloaded or forwarded — ask a manager to send a fresh one."
      );
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords aren't the same.");
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
      // The likely cause first, then what the server actually said. A blanket
      // "expired or already used" reads as certainty and hides the real
      // reason, which is the last thing you want when someone is stuck on
      // their own invitation and you're not in the room.
      setError(
        `This invitation didn't work — it has probably expired or been used already. (${verifyError.message})`
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
    // change their own role.
    //
    // This MUST end up non-empty: a null display_name is what the App access
    // block reads as "invited, hasn't signed in", so leaving it blank would
    // report someone who is demonstrably using the app as still pending. The
    // name comes down the link; the email's local part is the fallback for a
    // link that predates that, or one an old client mangled.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const name = invitedName || (user?.email ?? "").split("@")[0] || "Member";

    const { error: profileError } = await supabase.rpc("set_my_member_profile", {
      p_display_name: name,
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
        {/* The ORG's name, not the product's — the person joining works at
            Donut Friend and has very likely never heard of Restaurant Friend.
            It comes down the link rather than being hardcoded (design rule 2);
            a plain "Welcome" is the fallback when it isn't there. */}
        <h1 className="bg-ink px-6 py-4 text-[15px] font-bold uppercase tracking-[0.06em] text-white">
          {org ? `Welcome to ${org}!` : "Welcome"}
        </h1>

        <div className="space-y-5 p-6">
          {/* Said on ARRIVAL, not on submit. Reading the parameter doesn't
              spend the token — only `verifyOtp` does — so this costs nothing
              and it's the difference between a page that looks normal and
              quietly can't work, and one that tells you straight away. */}
          {tokenHash ? (
            <p className="text-sm text-muted">
              Choose a password and you&rsquo;re in. You&rsquo;ll sign in with
              the email address this invitation was sent to.
            </p>
          ) : (
            <p className="text-sm text-accent">
              This link is missing its token, so it can&rsquo;t sign you in.
              Open the link from the email again — or ask a manager to send a
              fresh one.
            </p>
          )}

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

          {/* `!ready` is the hydration guard — see the note by its state.
              Pressing this before React has attached onSubmit would make the
              browser submit natively and strip the token out of the URL. */}
          <button
            type="submit"
            disabled={busy || !ready}
            className="h-11 w-full bg-ink text-[13px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {busy ? "Setting up…" : ready ? "Set my password" : "Loading…"}
          </button>
        </div>
      </form>
    </div>
  );
}
