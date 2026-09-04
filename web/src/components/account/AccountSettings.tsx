"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setDisplayName } from "@/app/actions";
import { READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { createClient } from "@/lib/supabase/client";

/**
 * A member's OWN settings — what the masthead's gear opens since 2026-09-04
 * (Mark: the gear "should be user settings, not org settings"). Everything
 * here is about the person signed in, which is why the screen is ungoverned
 * in `lib/pageAccess`: there is no role for whom your own name is off limits.
 *
 * Two writes, each through the one door that already existed for it. The
 * name goes through `set_my_member_profile` (002/073) — RLS filters rows and
 * a self-update policy on org_members would also hand you your own `role` —
 * via the `setDisplayName` server action, so the masthead re-renders with it.
 * The password goes through Supabase Auth's own `updateUser`, which is what
 * /welcome uses to set the first one; a signed-in session may change its own
 * password without a token, and the app never sees it.
 *
 * The rest is read: the email is the login, the role is the manager's to
 * change (on the employee record's Admin tab), and the shops come from 073's
 * grid, where "All shops" is what an empty grid means.
 */
export function AccountSettings({
  displayName,
  email,
  roleLabel,
  shops,
}: {
  displayName: string | null;
  email: string;
  roleLabel: string;
  /** Codes of the shops this member may work at; null means unrestricted. */
  shops: string[] | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(displayName ?? "");
  const [naming, startNaming] = useTransition();
  const [nameError, setNameError] = useState<string | null>(null);
  const nameChanged = name.trim() !== (displayName ?? "");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [changing, setChanging] = useState(false);
  const [passwordNote, setPasswordNote] = useState<{ text: string; tone: "ok" | "error" } | null>(
    null
  );

  function saveName() {
    setNameError(null);
    startNaming(async () => {
      try {
        await setDisplayName(name);
        router.refresh();
      } catch (e) {
        setNameError((e as Error).message);
      }
    });
  }

  async function changePassword() {
    setPasswordNote(null);
    if (password.length < 8) {
      setPasswordNote({ text: "At least 8 characters.", tone: "error" });
      return;
    }
    if (password !== confirm) {
      setPasswordNote({ text: "The two passwords don’t match.", tone: "error" });
      return;
    }
    setChanging(true);
    const { error } = await supabase.auth.updateUser({ password });
    setChanging(false);
    if (error) {
      setPasswordNote({ text: error.message, tone: "error" });
      return;
    }
    setPassword("");
    setConfirm("");
    setPasswordNote({ text: "Password changed.", tone: "ok" });
  }

  const INPUT = "h-9 w-full border border-ink px-3 text-sm outline-none focus:border-2";

  return (
    <div className="space-y-12">
      <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
        <dt className="text-subtle">Name</dt>
        <dd className="flex items-center gap-3">
          <TextInput
            value={name}
            onValueChange={setName}
            fullWidth
            aria-label="Your name"
            placeholder={email}
          />
          <button
            type="button"
            disabled={!nameChanged || naming}
            onClick={saveName}
            className={`${BUTTON_CLASS} shrink-0`}
          >
            {naming ? "Saving…" : "Save"}
          </button>
        </dd>
        {nameError && (
          <>
            <dt />
            <dd className="text-accent">{nameError}</dd>
          </>
        )}

        <dt className="text-subtle">Email</dt>
        <dd>
          <span className={READ_ONLY_VALUE}>{email}</span>
        </dd>

        <dt className="text-subtle">Role</dt>
        <dd>
          <span className={READ_ONLY_VALUE}>{roleLabel}</span>
        </dd>

        <dt className="text-subtle">Works at</dt>
        <dd>
          <span className={READ_ONLY_VALUE}>{shops === null ? "All shops" : shops.join(" · ")}</span>
        </dd>
      </dl>

      <section className="space-y-4">
        <h2 className="text-[16px] font-bold uppercase tracking-[0.08em]">Change password</h2>
        <div className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <label htmlFor="account-password" className="text-subtle">
            New password
          </label>
          <input
            id="account-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
          <label htmlFor="account-confirm" className="text-subtle">
            Again
          </label>
          <input
            id="account-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT}
          />
          <span />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={changing || password === ""}
              onClick={() => void changePassword()}
              className={BUTTON_CLASS}
            >
              {changing ? "Changing…" : "Change password"}
            </button>
            {passwordNote && (
              <span className={passwordNote.tone === "error" ? "text-accent" : "text-muted"}>
                {passwordNote.text}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
