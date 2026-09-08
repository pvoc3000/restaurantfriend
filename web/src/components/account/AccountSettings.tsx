"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setDisplayName, signOut } from "@/app/actions";
import { READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PIN_LENGTH, isValidPin } from "@/lib/sharedDevice";
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
 *
 * THE PIN (2026-09-08) is the third write, through `set_my_pin` (097) — four
 * digits for unlocking a shared iPad. And it is why `pinSession` is here: a
 * session minted BY a PIN may change neither the password nor the PIN, or a
 * four-digit PIN is a route to both. Those blocks say so and point at /login.
 */
export function AccountSettings({
  displayName,
  email,
  roleLabel,
  shops,
  pinSetAt,
  pinSession,
  registeredDevice,
}: {
  displayName: string | null;
  email: string;
  roleLabel: string;
  /** Codes of the shops this member may work at; null means unrestricted. */
  shops: string[] | null;
  /** When the PIN was last set, or null for none. */
  pinSetAt: string | null;
  /** This session came from a PIN, so it may not change a credential. */
  pinSession: boolean;
  /** This browser is a registered shared iPad: the masthead says Switch user, so Sign out lives here. */
  registeredDevice: boolean;
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

  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [settingPin, setSettingPin] = useState(false);
  const [pinNote, setPinNote] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [pinSet, setPinSet] = useState<string | null>(pinSetAt);

  async function savePin() {
    setPinNote(null);
    if (!isValidPin(pin)) {
      setPinNote({ text: `A PIN is exactly ${PIN_LENGTH} digits.`, tone: "error" });
      return;
    }
    if (pin !== pinAgain) {
      setPinNote({ text: "The two PINs don’t match.", tone: "error" });
      return;
    }
    setSettingPin(true);
    const { error } = await supabase.rpc("set_my_pin", { p_pin: pin });
    setSettingPin(false);
    if (error) {
      setPinNote({ text: error.message, tone: "error" });
      return;
    }
    setPin("");
    setPinAgain("");
    setPinSet(new Date().toISOString());
    setPinNote({ text: pinSet ? "PIN changed." : "PIN set.", tone: "ok" });
  }

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
        <h2 className="text-[16px] font-bold uppercase tracking-[0.08em]">PIN for shared iPads</h2>
        {pinSession ? (
          <p className="max-w-xl text-sm text-muted">
            {pinSet ? "A PIN is set." : "No PIN is set."}{" "}
            <a href="/login" className="underline hover:text-ink">
              Sign in with your password
            </a>{" "}
            to change it.
          </p>
        ) : (
          <div className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
            <span className="text-subtle">Status</span>
            <span className={READ_ONLY_VALUE}>
              {pinSet ? `Set on ${pinSet.slice(0, 10)}` : "Not set"}
            </span>
            <label htmlFor="account-pin" className="text-subtle">
              {pinSet ? "New PIN" : "PIN"}
            </label>
            <input
              id="account-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH))}
              className={`${INPUT} tracking-[0.4em]`}
            />
            <label htmlFor="account-pin-again" className="text-subtle">
              Again
            </label>
            <input
              id="account-pin-again"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_LENGTH}
              pattern="[0-9]*"
              value={pinAgain}
              onChange={(e) =>
                setPinAgain(e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH))
              }
              className={`${INPUT} tracking-[0.4em]`}
            />
            <span />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={settingPin || pin === ""}
                onClick={() => void savePin()}
                className={BUTTON_CLASS}
              >
                {settingPin ? "Saving…" : pinSet ? "Change PIN" : "Set PIN"}
              </button>
              {pinNote && (
                <span className={pinNote.tone === "error" ? "text-accent" : "text-muted"}>
                  {pinNote.text}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-[16px] font-bold uppercase tracking-[0.08em]">Change password</h2>
        {pinSession ? (
          <p className="max-w-xl text-sm text-muted">
            <a href="/login" className="underline hover:text-ink">
              Sign in with your password
            </a>{" "}
            to change it — a PIN can’t.
          </p>
        ) : (
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
        )}
      </section>

      {registeredDevice && (
        <section className="space-y-4">
          <h2 className="text-[16px] font-bold uppercase tracking-[0.08em]">Sign out</h2>
          {/* The masthead reads Switch user on a shared iPad, which locks the
              device rather than signing out. This is the real thing, for
              anyone who means it — the device stays registered either way. */}
          <form action={signOut}>
            <button type="submit" className={BUTTON_CLASS}>
              Sign out
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
