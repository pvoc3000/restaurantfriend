"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { ROLE_LABEL, ROLE_OPTIONS, type Role } from "@/lib/roles";
import { PIN_LENGTH, isValidPin } from "@/lib/sharedDevice";
import { LocationAccess } from "./LocationAccess";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * Who can sign in, as what — the block that replaces FMP's ADMIN tab.
 *
 * There, giving someone access meant typing a username and a plain-text
 * password into two fields on this record and choosing a level from a 1–5
 * radio. Here it is an invitation: the app mints a one-time link, mails it
 * through the org's own sender, and the person sets their own password. No
 * credential is ever stored, displayed, or known to whoever grants access.
 *
 * Three states, all derived from data the detail page already has:
 *
 *   none     no linked account — offer an invitation
 *   pending  linked, but no display name yet, so they've never completed
 *            /welcome — offer to re-send, or to withdraw
 *   active   they're using the app — their role is editable, access removable
 *
 * `display_name`-is-null as the pending signal is an inference rather than a
 * fact: /welcome is the only place it gets set, so it's reliable unless
 * someone later clears their own name. The cost of being wrong is a line that
 * says "hasn't signed in" about someone who has — visible and harmless. A real
 * `activated_at` can replace it if that ever happens.
 */
export function AppAccess({
  employeeId,
  employeeName,
  employeeEmail,
  orgId,
  userId,
  role,
  locations,
  allowedLocationIds,
  displayName,
  invitedAt,
  pinSetAt,
  pinSession,
}: {
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  orgId: string;
  /** The linked auth user, or null when this person has no access. */
  userId: string | null;
  role: Role | null;
  /** Active shops, for 073's access grid. */
  locations: { id: string; code: string; name: string }[];
  /** Which of them this member may work at. Empty = every one. */
  allowedLocationIds: string[];
  displayName: string | null;
  invitedAt: string | null;
  /** 097: when this member's PIN was set, or null for none. */
  pinSetAt: string | null;
  /** The viewer's OWN session came from a PIN, so it may not set anybody's. */
  pinSession: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(employeeEmail ?? "");
  const [inviteRole, setInviteRole] = useState<string>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The PIN row. `set_member_pin` (097) is owner/admin — the same gate this
  // screen is behind — and null CLEARS.
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSet, setPinSet] = useState<string | null>(pinSetAt);

  async function writePin(value: string | null) {
    setPinBusy(true);
    setPinError(null);
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_member_pin", {
      p_user: userId,
      p_pin: value,
    });
    setPinBusy(false);
    if (rpcError) {
      if (value === null) setError(rpcError.message);
      else setPinError(rpcError.message);
      return false;
    }
    setPinSet(value === null ? null : new Date().toISOString());
    return true;
  }

  async function savePin() {
    if (!isValidPin(pin)) {
      setPinError(`A PIN is exactly ${PIN_LENGTH} digits.`);
      return;
    }
    if (pin !== pinAgain) {
      setPinError("The two PINs don’t match.");
      return;
    }
    if (await writePin(pin)) {
      setPinOpen(false);
      setPin("");
      setPinAgain("");
      setNote(`${employeeName}'s PIN is set.`);
    }
  }

  async function clearPin() {
    if (
      !(await confirmDialog({
        title: `Clear ${employeeName}'s PIN?`,
        body: "They won’t be able to unlock a shared iPad until a new one is set.",
        confirmLabel: "Clear PIN",
        tone: "danger",
      }))
    ) {
      return;
    }
    if (await writePin(null)) setNote(`${employeeName}'s PIN is cleared.`);
  }

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNote(null);
    const { data, error: fnError } = await supabase.functions.invoke(
      "invite-member",
      { body }
    );
    setBusy(false);

    if (fnError) {
      // The function returns a readable message in the body; the SDK surfaces
      // only "non-2xx status code" unless we go and get it.
      let message = fnError.message;
      const res = (fnError as { context?: Response }).context;
      if (res) {
        try {
          const parsed = await res.json();
          if (parsed?.error) message = parsed.error;
        } catch {
          // Keep the SDK's message.
        }
      }
      setError(message);
      return null;
    }
    if (data?.error) {
      setError(data.error);
      return null;
    }
    if (data?.warning) setNote(data.warning);
    router.refresh();
    return data;
  }

  async function invite() {
    const result = await call({
      action: "invite",
      employee_id: employeeId,
      email: email.trim(),
      role: inviteRole,
    });
    if (result) {
      setOpen(false);
      setNote(
        result.status === "reinvited"
          ? `A fresh sign-in link is on its way to ${result.email}.`
          : `An invitation is on its way to ${result.email}.`
      );
    }
  }

  async function revoke() {
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Remove ${employeeName}'s access to the app?\n\n` +
          "They'll be signed out and won't be able to sign back in. Their " +
          "employee record and everything they've done stays."), confirmLabel: "Revoke access", tone: "danger" }))
    ) {
      return;
    }
    await call({ action: "revoke", employee_id: employeeId });
  }

  const state = !userId ? "none" : displayName ? "active" : "pending";
  const isOwner = role === "owner";

  const BUTTON =
    "h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35";
  const QUIET =
    "text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35";

  return (
    <div className="max-w-2xl space-y-3 border border-ink px-4 py-3">
      {state === "none" && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm text-muted">
            No access.
            {!employeeEmail && " There's no email address on this record yet."}
          </p>
          <button
            type="button"
            className={`${BUTTON} ml-auto`}
            disabled={busy}
            onClick={() => {
              setEmail(employeeEmail ?? "");
              setInviteRole("staff");
              setError(null);
              setOpen(true);
            }}
          >
            Invite&hellip;
          </button>
        </div>
      )}

      {state === "pending" && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm">
            <span className="text-muted">Invited</span>
            {invitedAt && (
              <span className="text-muted"> {invitedAt.slice(0, 10)}</span>
            )}
            <span className="text-muted"> as </span>
            {role ? ROLE_LABEL[role] : "—"}
            <span className="text-muted"> — hasn&rsquo;t signed in yet.</span>
          </p>
          <span className="ml-auto flex items-center gap-4">
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => {
                setEmail(employeeEmail ?? "");
                setInviteRole(role ?? "staff");
                setError(null);
                setOpen(true);
              }}
            >
              Re-send&hellip;
            </button>
            <button type="button" className={QUIET} disabled={busy} onClick={revoke}>
              Withdraw
            </button>
          </span>
        </div>
      )}

      {state === "active" && (
        <div className="flex flex-wrap items-start gap-4">
          {/* ONE TRACK FOR EVERY FIELD, the detail-field convention: the block
              defines the edges and each control fills them. Both pickers sized
              to their own words before this ("All shops", "Staff"), so a
              two-field column had two right edges and neither matched the
              other. `min-w-0 flex-1` is what lets the 1fr track actually be
              1fr — a flex item defaults to min-content, so without it the dl
              shrink-wraps its widest control and `w-full` inside resolves
              against that. */}
          <dl className="grid min-w-0 flex-1 grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
            <dt className="text-subtle">Signs in as</dt>
            <dd>{displayName}</dd>
            <dt className="text-subtle">Works at</dt>
            <dd>
              {/* 073's grid. Beside the role, because the two together are the
                  whole of what app access means: what you may do, and where. */}
              <LocationAccess
                orgId={orgId}
                userId={userId ?? ""}
                role={role}
                locations={locations}
                allowed={allowedLocationIds}
                editable={!isOwner}
              />
            </dd>
            <dt className="text-subtle">PIN</dt>
            <dd className="flex flex-wrap items-center gap-3">
              {/* Four digits for a shared iPad (097). Status only — the
                  hash never leaves Postgres — with set and clear beside it.
                  Withheld on a PIN session: a PIN may not mint PINs. */}
              <span>{pinSet ? `Set ${pinSet.slice(0, 10)}` : "Not set"}</span>
              {pinSession ? (
                <span className="text-xs text-subtle">Sign in with a password to change it.</span>
              ) : (
                <>
                  <button
                    type="button"
                    className={BUTTON}
                    disabled={busy || pinBusy}
                    onClick={() => {
                      setPin("");
                      setPinAgain("");
                      setPinError(null);
                      setPinOpen(true);
                    }}
                  >
                    {pinSet ? "Change PIN…" : "Set PIN…"}
                  </button>
                  {pinSet && (
                    <button type="button" className={QUIET} disabled={busy || pinBusy} onClick={clearPin}>
                      Clear
                    </button>
                  )}
                </>
              )}
            </dd>
            <dt className="text-subtle">Role</dt>
            <dd>
              {isOwner ? (
                // The owner is not editable from here, and that's deliberate
                // twice over. ROLE_OPTIONS doesn't offer 'owner' — so a picker
                // would render the raw stored value ("owner", lowercase, as
                // PickList does for anything off its list) — and demoting the
                // only owner is not something a personnel screen should make
                // one tap away. Ownership moves in the SQL editor.
                <span>{ROLE_LABEL.owner}</span>
              ) : (
                /* Writes org_members.role directly, under 001's members_write
                   policy — the same owner/admin gate this whole screen is
                   behind. Matched on the FULL primary key: org_members is
                   keyed (org_id, user_id) and has no `id` column at all. */
                <InlineValue
                  boxed={BOXED_FIELDS}
                  table="org_members"
                  column="role"
                  value={role}
                  kind="pick"
                  nullable={false}
                  options={ROLE_OPTIONS}
                  match={{ org_id: orgId, user_id: userId ?? "" }}
                  className="w-full"
                />
              )}
            </dd>
          </dl>
          {isOwner ? (
            <p className="ml-auto max-w-xs text-xs text-subtle">
              The owner&rsquo;s access can&rsquo;t be changed here — there would
              be no way back in.
            </p>
          ) : (
            <button
              type="button"
              className={`${QUIET} ml-auto`}
              disabled={busy}
              onClick={revoke}
            >
              Remove access
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-accent">{error}</p>}
      {note && <p className="text-sm text-muted">{note}</p>}

      {pinOpen && (
        <Dialog
          title={pinSet ? "Change the PIN" : "Set a PIN"}
          onClose={() => setPinOpen(false)}
          busy={pinBusy}
          width="max-w-sm"
          onSubmit={() => {
            if (!pinBusy && pin !== "" && pinAgain !== "") void savePin();
          }}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                disabled={pinBusy}
                onClick={() => setPinOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={pinBusy || pin === "" || pinAgain === ""}
                onClick={() => void savePin()}
              >
                {pinBusy ? "Saving…" : "Save PIN"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {employeeName} will unlock a shared iPad with these four digits. Tell them
              in person — it is not emailed.
            </p>
            {[
              { id: "member-pin", label: "PIN", value: pin, set: setPin },
              { id: "member-pin-again", label: "Again", value: pinAgain, set: setPinAgain },
            ].map((f) => (
              <div key={f.id} className="space-y-1.5">
                <label
                  htmlFor={f.id}
                  className="block text-[11px] uppercase tracking-[0.12em] text-subtle"
                >
                  {f.label}
                </label>
                <input
                  id={f.id}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_LENGTH}
                  pattern="[0-9]*"
                  value={f.value}
                  onChange={(e) =>
                    f.set(e.target.value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH))
                  }
                  className="h-9 w-full border border-ink px-3 text-sm tracking-[0.4em] outline-none focus:border-2"
                />
              </div>
            ))}
            {pinError && <p className="text-sm text-accent">{pinError}</p>}
          </div>
        </Dialog>
      )}

      {open && (
        <Dialog
          title={state === "pending" ? "Re-send the invitation" : "Invite to the app"}
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-lg"
          footer={
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={busy || email.trim() === ""}
                onClick={() => void invite()}
              >
                {busy ? "Sending…" : "Send invitation"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {employeeName} will get an email with a link to set their own
              password. The link works once.
            </p>
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
                Email
              </label>
              <TextInput
                value={email}
                onValueChange={setEmail}
                placeholder="name@example.com"
                aria-label="Email to invite"
                clearLabel="Clear the email"
                fullWidth
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
                Role
              </label>
              <PickList
                value={inviteRole}
                onPick={setInviteRole}
                variant="field"
                options={ROLE_OPTIONS}
                ariaLabel="Role for this person"
                className="w-full"
              />
            </div>
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
