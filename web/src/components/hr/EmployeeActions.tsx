"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";
import { EMPLOYEE_DOCS_BUCKET, DOCUMENT_KIND_LABEL } from "@/lib/employeeDocuments";
import {
  deleteWarnings,
  isSelf,
  type DeleteWarnings,
  type Employee,
} from "@/lib/employees";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/** The documents on file, read fresh when the dialog opens — the count AND the
 *  storage paths, which have to be captured before the row that holds them is
 *  deleted. */
type Docs = { paths: string[]; kinds: string[] };

/**
 * Deleting an employee, which until migration 023 the schema simply refused.
 *
 * **On the detail screen only — never on a roster row.** `VendorItemActions`
 * sits in both places because a vendor item is a catalog row; a delete beside
 * each of 445 people is a two-tap route to destroying someone by accident, and
 * you should be looking at the record you mean to remove.
 *
 * It is a LABELLED BUTTON where the rest of the app would reach for a `RowMenu`
 * — the one place that idiom is deliberately not followed. A bare ⋯ works in a
 * table, where it sits in a column of its own beside a short row; alone at the
 * end of a breadcrumb line on a wide screen it is a grey glyph a thousand
 * pixels from anything, and it failed the only test that matters (Mark,
 * 2026-08-02, having gone looking for it: "I don't see a button anywhere").
 *
 * The guard moved out of the schema and into this dialog when 023 opened the
 * policy, so the dialog has to earn it. It counts three things first — migrated
 * from FileMaker, has app access, has documents on file — says what each one
 * means, and defaults to **Deactivate** when any of them fired. Delete stays
 * reachable; it just stops being the easy thing to do by accident. That's the
 * `closeReadiness` posture: name what's unresolved and let the human through,
 * because a confirm that blocks on something you can't act on teaches people to
 * stop reading confirms.
 *
 * The exception is deleting YOURSELF, which isn't offered at all. See `isSelf`.
 */
export function EmployeeActions({
  employee,
  name,
  role,
  currentUserId,
  afterDelete = "refresh",
}: {
  employee: Pick<Employee, "id" | "legacy_id" | "user_id" | "status">;
  /** "Prentice, Ada" — what to call them in the dialog. */
  name: string;
  /** Their app-access role, where they have one, for the warning's wording. */
  role: Role | null;
  /** Who is doing this, for the self-delete refusal. */
  currentUserId: string;
  afterDelete?: "refresh" | { href: string };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [docs, setDocs] = useState<Docs | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const self = isSelf(employee, currentUserId);
  const warnings: DeleteWarnings | null =
    docs === null ? null : deleteWarnings(employee, docs.paths.length, eventCount ?? 0);

  async function openConfirm() {
    setConfirming(true);
    setDocs(null);
    setEventCount(null);
    setError(null);
    const [{ data }, { count }] = await Promise.all([
      supabase.from("employee_documents").select("storage_path, kind").eq("employee_id", employee.id),
      // 035 cascades, and this is the count that grows without anyone noticing —
      // a decade of warnings under a thousand shift ratings. HEAD count is fine
      // here: a missing table leaves it null, which reads as "none" and simply
      // doesn't warn, rather than blocking a delete that is otherwise fine.
      supabase
        .from("employee_events")
        .select("*", { count: "exact", head: true })
        .eq("employee_id", employee.id),
    ]);
    setDocs({
      paths: (data ?? []).map((d) => d.storage_path as string),
      kinds: (data ?? []).map((d) => d.kind as string),
    });
    setEventCount(count ?? 0);
  }

  async function deactivate() {
    setBusy("deactivate");
    setError(null);
    const { error } = await supabase
      .from("employees")
      .update({ status: "inactive" })
      .eq("id", employee.id);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  /**
   * The order here is the whole of the correctness, and no step is optional.
   *
   * 1. **Revoke app access first**, through the same edge function the App
   *    access block uses. That path already deletes the org_members row, BANS
   *    the auth user and nulls user_id — so we inherit its rules for free, the
   *    load-bearing one being that an auth user is never DELETED (001's audit
   *    columns reference auth.users with no cascade, and the history should keep
   *    its author). Skipping this would orphan the membership: org_members knows
   *    nothing about employees, so they'd keep signing in with no HR record.
   * 2. **Delete the row.** employee_documents cascades (021).
   * 3. **Remove the Storage objects.** They do NOT cascade — nothing FKs a file
   *    — so without this the bucket keeps invoices nobody can see or reach.
   *
   * 3 comes after 2, matching the app's existing rule (`delete = row then
   * object`): an orphan object is invisible and harmless, where rows pointing at
   * a file that's gone render broken on a record that still exists. That is the
   * opposite of the upload order, deliberately.
   */
  async function remove() {
    if (self || docs === null) return;
    setBusy("delete");
    setError(null);

    if (employee.user_id) {
      const { error: revokeError } = await supabase.functions.invoke(
        "invite-member",
        { body: { action: "revoke", employee_id: employee.id } }
      );
      if (revokeError) {
        setBusy(null);
        setError(
          `Their app access could not be revoked, so the record was left alone: ${revokeError.message}`
        );
        return;
      }
    }

    // `.select()` on a delete is not decoration — it is the only way to know the
    // delete HAPPENED. With no matching RLS policy Postgres removes zero rows
    // and PostgREST returns no error, so a bare `.delete()` reports a cheerful
    // success and leaves the person on the roster. That is the order_guide_entries
    // lesson, and it is live here: this table had NO delete policy at all until
    // migration 023, and 023 is applied by hand. Caught in the browser doing
    // exactly this — the screen navigated back to a roster that had grown by one.
    const { data: deleted, error: deleteError } = await supabase
      .from("employees")
      .delete()
      .eq("id", employee.id)
      .select("id");
    if (deleteError) {
      setBusy(null);
      setError(deleteError.message);
      return;
    }
    if (!deleted || deleted.length === 0) {
      setBusy(null);
      setError(
        "Nothing was deleted — the database refused it and said nothing. " +
          "This is what it looks like when migration 023 hasn't been applied yet; " +
          "their app access, if they had any, has already been revoked."
      );
      return;
    }

    // Best effort, and after the fact on purpose. If this fails the record is
    // already gone and there is nothing useful to say about it — an orphaned
    // object is invisible and harmless, and reporting it here would make a
    // finished delete look failed.
    if (docs.paths.length > 0) {
      await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove(docs.paths);
    }

    setBusy(null);
    setConfirming(false);
    if (afterDelete === "refresh") router.refresh();
    else router.push(afterDelete.href);
  }

  // Nothing at all on your own record (see `isSelf`). A permanently dead button
  // on one record in 446 is worse noise than none, and deactivating yourself is
  // still one tap away on the Status field a line below.
  if (self) return null;

  return (
    <>
      {/* A LABELLED BUTTON, not a ⋯ menu (Mark, 2026-08-02: "I don't see a
          button anywhere"). The menu's other item was Deactivate, which the
          confirm dialog already offers as "Deactivate instead" — and which the
          Status field on this very screen has always done — so the menu was
          hiding one command behind a glyph in order to present a choice that
          didn't need one.
          Bordered rather than filled, and NOT in the accent colour: this button
          only opens a confirm, and in this design system colour means record
          state. The red belongs on the commit inside the dialog, which is the
          keystroke that actually destroys something. */}
      <button
        type="button"
        onClick={() => void openConfirm()}
        disabled={busy !== null}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink hover:bg-ink hover:text-white disabled:opacity-35"
      >
        Delete employee
      </button>

      {confirming && (
        <Dialog
          title="Delete employee"
          onClose={() => setConfirming(false)}
          busy={busy !== null}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy !== null || docs === null}
                className={DIALOG_DANGER_CLASS}
              >
                {busy === "delete" ? "Deleting…" : "Delete anyway"}
              </button>
              {employee.status !== "inactive" && (
                <button
                  type="button"
                  onClick={() => void deactivate()}
                  disabled={busy !== null}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {busy === "deactivate" ? "Deactivating…" : "Deactivate instead"}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-ink">{name}</p>

          {warnings === null ? (
            <p className="mt-3 text-sm text-subtle">Checking what they carry…</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {warnings.any ? (
                <div className="space-y-2 border border-ink bg-mark-fill px-3 py-2 text-ink">
                  {warnings.migrated !== null && (
                    <p>
                      <span className="font-semibold">
                        Migrated from FileMaker (employee {warnings.migrated}).
                      </span>{" "}
                      Their events, ratings, reviews and timesheets all reference
                      that id, and none of those tables have been migrated yet —
                      so deleting now breaks records that aren&rsquo;t here to
                      complain.
                    </p>
                  )}
                  {warnings.hasAccess && (
                    <p>
                      <span className="font-semibold">
                        Has access to the app
                        {role ? ` as ${ROLE_LABEL[role]}` : ""}.
                      </span>{" "}
                      It will be revoked first — their sign-in stops working and
                      their account is disabled, but the account itself is kept,
                      so anything they recorded keeps its author.
                    </p>
                  )}
                  {warnings.documents > 0 && (
                    <p>
                      <span className="font-semibold">
                        {warnings.documents}{" "}
                        {warnings.documents === 1 ? "document" : "documents"} on
                        file
                      </span>
                      {docs && docs.kinds.length > 0 && (
                        <>
                          {" ("}
                          {[...new Set(docs.kinds)]
                            .map((k) => DOCUMENT_KIND_LABEL[k as keyof typeof DOCUMENT_KIND_LABEL] ?? k)
                            .join(", ")}
                          {")"}
                        </>
                      )}
                      . The files go with them, and those are the records
                      you&rsquo;re required to keep.
                    </p>
                  )}
                  {warnings.events > 0 && (
                    <p>
                      <span className="font-semibold">
                        {warnings.events.toLocaleString()}{" "}
                        {warnings.events === 1 ? "event" : "events"} on the record
                      </span>
                      . Shift ratings, notes, and any warnings or incident reports
                      — all of it goes with them, and a write-up is the record you
                      would most want to still have.
                    </p>
                  )}
                  <p>
                    Deactivating keeps the record and everything hanging off it,
                    and takes them off the roster&rsquo;s active list — which is
                    almost always what you want.
                  </p>
                </div>
              ) : (
                <p className="text-muted">
                  Nothing hangs off this record — no FileMaker history, no app
                  access, no documents on file, nothing on the record. Deleting it removes one row and
                  loses nothing.
                </p>
              )}

              {error && <p className="text-accent">{error}</p>}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
