"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
import {
  InventoryItemChooser,
  type ChosenItem,
} from "@/components/catalog/InventoryItemChooser";
import {
  hasNote,
  requestRequiresNote,
  type RequestStatus,
} from "@/lib/purchaseRequests";

type Exit = "ordered" | "dismissed";

/**
 * A request's two exits, its way back, and its item link.
 *
 * WHY THESE ARE DIALOGS AND NOT AN INLINE STATUS PICK. Dismissing has to write
 * the status and the reason in ONE statement, because 059's
 * `purchase_requests_reason_when_dismissed` refuses the row otherwise — and a
 * `PickList` in a cell can only write its own column, so it would hand the
 * person a raw `23514` from Postgres with no way to answer it. That is the one
 * refusal `InlineValue` cannot explain (the `special_orders_status_iff_order`
 * trap), and the dialog exists to ask the question BEFORE the write rather than
 * to apologise after it.
 *
 * The commands are gated on role, not merely allowed to fail: below purchaser+
 * an update matches no policy, changes zero rows and returns NO error, so an
 * offered command would look like it worked. The row count below is the
 * backstop for a stale session, not the gate.
 */
export function RequestActions({
  id,
  status,
  itemId,
  itemName,
  userId,
  canResolve,
  isAuthor,
  label,
}: {
  id: string;
  status: RequestStatus;
  itemId: string | null;
  itemName: string | null;
  userId: string;
  canResolve: boolean;
  /** Did this person file it? 059 lets them fix or withdraw it while it's open. */
  isAuthor: boolean;
  /** What this menu is for, for screen readers. */
  label: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [exit, setExit] = useState<Exit | null>(null);
  const [linking, setLinking] = useState(false);
  const [item, setItem] = useState<ChosenItem | null>(
    itemId && itemName ? { id: itemId, name: itemName } : null
  );
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const open = status === "open";
  /** An author may withdraw their own OPEN request — 059's `preq_author_update`. */
  const mayWithdraw = open && isAuthor && !canResolve;

  /**
   * The two ways a refusal arrives, which are NOT the same and were measured
   * on the harness rather than assumed:
   *
   *   · A policy's USING clause excluding the row — an author reaching for a
   *     request somebody has already resolved — matches ZERO ROWS and returns
   *     NO ERROR. PostgREST reports a cheerful success, which is why every
   *     write here counts what it changed.
   *   · A WITH CHECK refusal — an author trying to mark their own request
   *     ordered — RAISES, 42501, in Postgres's own words ("new row violates
   *     row-level security policy for table ..."). True, and not a sentence to
   *     put in front of somebody who just pressed a button.
   *
   * Neither should ever be reachable: the menu doesn't offer a command the
   * person can't run. Both are the backstop for a stale session — a role
   * changed, or somebody else resolved the row while this page sat open.
   */
  function report(error: { code?: string; message: string } | null, rows: number) {
    if (error) {
      setFailed(
        error.code === "23514"
          ? "A dismissal has to say why."
          : error.code === "42501"
            ? "Not allowed — only whoever does the ordering can answer a request."
            : error.message
      );
      return false;
    }
    if (!rows) {
      setFailed("Nothing changed — someone else may have answered this already.");
      return false;
    }
    return true;
  }

  function write(patch: Record<string, unknown>, done: () => void) {
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("purchase_requests")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (!report(error, data?.length ?? 0)) return;
      done();
      router.refresh();
    });
  }

  function commitExit() {
    if (!exit) return;
    if (requestRequiresNote(exit) && !hasNote(note)) return;
    write(
      {
        status: exit,
        // The whole outcome in one statement. Split across two and a failure
        // between them leaves a row that is resolved and says nothing about it.
        resolution_note: note.trim() || null,
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      },
      () => {
        setExit(null);
        setNote("");
      }
    );
  }

  function reopen() {
    // All four together, or the row reads `open` while still claiming it was
    // resolved by somebody on Tuesday.
    write(
      {
        status: "open",
        resolution_note: null,
        resolved_at: null,
        resolved_by: null,
      },
      () => {}
    );
  }

  const items: RowMenuItem[] = [];
  if (canResolve && open) {
    items.push({
      label: "Mark ordered…",
      hint: "It's on an order — say where, if you like",
      onSelect: () => {
        setNote("");
        setExit("ordered");
      },
    });
  }
  if (canResolve || mayWithdraw) {
    if (open) {
      items.push({
        label: mayWithdraw ? "Withdraw…" : "Dismiss…",
        hint: mayWithdraw ? "Take it back off the queue" : "We're not buying it — say why",
        onSelect: () => {
          setNote("");
          setExit("dismissed");
        },
        danger: true,
      });
    }
  }
  if (canResolve && !open) {
    items.push({
      label: "Reopen",
      hint: "Put it back on the queue",
      onSelect: reopen,
    });
  }
  if (canResolve || (open && isAuthor)) {
    items.push({
      label: itemId ? "Change item…" : "Link an item…",
      hint: "Which catalog item this turned out to be",
      onSelect: () => setLinking(true),
    });
  }

  if (!items.length) return null;

  return (
    <>
      <RowMenu items={items} label={label} />

      {failed && !exit && !linking ? (
        <p className="mt-1 text-xs text-accent">{failed}</p>
      ) : null}

      {exit && (
        <Dialog
          title={
            exit === "ordered"
              ? "Mark ordered"
              : mayWithdraw
                ? "Withdraw this request"
                : "Dismiss this request"
          }
          onClose={() => {
            if (!pending) {
              setExit(null);
              setFailed(null);
            }
          }}
          busy={pending}
          onSubmit={() => {
            if (!pending && (!requestRequiresNote(exit) || hasNote(note))) commitExit();
          }}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setExit(null);
                  setFailed(null);
                }}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitExit}
                disabled={pending || (requestRequiresNote(exit) && !hasNote(note))}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending
                  ? "Saving…"
                  : exit === "ordered"
                    ? "Mark ordered"
                    : mayWithdraw
                      ? "Withdraw"
                      : "Dismiss"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">{label.replace(/^Actions for /, "")}</p>

            <Field
              label={exit === "ordered" ? "Note (optional)" : "Why"}
              required={requestRequiresNote(exit)}
            >
              <textarea
                value={note}
                rows={3}
                autoFocus
                disabled={pending}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  exit === "ordered"
                    ? "On Tuesday's Sysco order"
                    : mayWithdraw
                      ? "Duplicate — already asked"
                      : "We're switching brands, don't reorder"
                }
                className="w-full border border-ink bg-white px-2 py-1 text-sm outline-none focus:border-2"
              />
            </Field>

            {/* Said here rather than discovered at the write: 059 requires it,
                and being told after pressing the button is how people learn to
                distrust the button. */}
            {requestRequiresNote(exit) && !hasNote(note) ? (
              <p className="text-xs text-subtle">
                A dismissal is the only record of a request that disappeared, so
                it has to say something.
              </p>
            ) : null}

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}

      {linking && (
        <Dialog
          title={itemId ? "Change the item" : "Link an item"}
          onClose={() => {
            if (!pending) {
              setLinking(false);
              setFailed(null);
            }
          }}
          busy={pending}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setLinking(false);
                  setFailed(null);
                }}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  write({ inventory_item_id: item?.id ?? null }, () =>
                    setLinking(false)
                  )
                }
                disabled={pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Saving…" : item ? "Link" : "Leave unlinked"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">
              A request is the sentence somebody wrote; this is which catalog
              item it turned out to be. Plenty never resolve to one.
            </p>
            <InventoryItemChooser value={item} onPick={setItem} autoFocus />
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
