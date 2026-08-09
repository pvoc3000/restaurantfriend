"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue } from "@/components/catalog/InlineValue";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { ROLE_LABEL, ROLE_OPTIONS, type Role } from "@/lib/roles";

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
  displayName,
  invitedAt,
}: {
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  orgId: string;
  /** The linked auth user, or null when this person has no access. */
  userId: string | null;
  role: Role | null;
  displayName: string | null;
  invitedAt: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(employeeEmail ?? "");
  const [inviteRole, setInviteRole] = useState<string>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
      !window.confirm(
        `Remove ${employeeName}'s access to the app?\n\n` +
          "They'll be signed out and won't be able to sign back in. Their " +
          "employee record and everything they've done stays."
      )
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
        <div className="flex flex-wrap items-baseline gap-4">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="py-0.5 text-subtle">Signs in as</dt>
            <dd>{displayName}</dd>
            <dt className="py-0.5 text-subtle">Role</dt>
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
                  table="org_members"
                  column="role"
                  value={role}
                  kind="pick"
                  nullable={false}
                  options={ROLE_OPTIONS}
                  match={{ org_id: orgId, user_id: userId ?? "" }}
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
                className="w-full"
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
