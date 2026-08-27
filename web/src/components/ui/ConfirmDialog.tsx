"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  clearConfirmHandler,
  setConfirmHandler,
  type ConfirmAsk,
  type ConfirmOutcome,
  type ConfirmRequest,
} from "@/lib/confirm";
import { Checkbox } from "./Checkbox";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS, DIALOG_DANGER_CLASS } from "./Dialog";

/**
 * THE confirm, in the app's own skin (Mark, 2026-08-10: the browser's dialog
 * "takes me out of the app experience and makes me remember we're just a web
 * page").
 *
 * This file is the PANEL. Callers never touch it — they call `confirmDialog`
 * from `lib/confirm`, which is component-free for a Fast Refresh reason spelled
 * out there.
 *
 * It is a PROMISE, because `window.confirm` is the one browser API that blocks
 * the main thread and nothing else can. That single difference is what every
 * call site had to absorb: `if (!window.confirm(msg)) return;` becomes
 * `if (!(await confirmDialog({...}))) return;`, and the enclosing handler
 * becomes async where it wasn't. Everything else about a call site is unchanged.
 *
 * ONE provider in the (app) layout owns the panel. Done per component, each of
 * the ~28 callers would carry its own open flag, its own pending-action state
 * and its own copy of the markup — the drift this app keeps paying for (see
 * `ui/Dialog`'s own note: it exists because three hand-rolled copies had each
 * learned a different subset of the same lessons).
 *
 * What it deliberately keeps from the browser's version: Escape and clicking
 * away both mean NO, and the promise resolves false rather than hanging.
 *
 * What it deliberately changes: **Enter does not commit a destructive confirm.**
 * The browser's dialog defaults to OK, so a stray Enter deletes; here the
 * DANGER tone focuses Cancel instead and passes no `onSubmit`, which is
 * `ui/Dialog`'s documented rule ("a stray Enter is exactly the keystroke you
 * cannot take back"). A non-destructive confirm still commits on Enter and
 * focuses its commit, so the ordinary case costs no extra keystroke.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // The pending question's resolver. A ref rather than state: settling it is
  // not a render, and reading it from a stale closure would strand the caller.
  const resolve = useRef<((outcome: ConfirmOutcome) => void) | null>(null);

  const settle = useCallback((outcome: ConfirmOutcome) => {
    const pending = resolve.current;
    resolve.current = null;
    setRequest(null);
    pending?.(outcome);
  }, []);

  const ask = useCallback<ConfirmAsk>((next) => {
    // A second question while one is open answers the first NO rather than
    // leaving its caller awaiting a promise that can never settle. It should
    // not happen — the first dialog covers the screen — but an awaited promise
    // that never resolves is a hang with no symptom, so it is closed off here.
    resolve.current?.({ ok: false, option: false });
    setRequest(next);
    return new Promise<ConfirmOutcome>((r) => {
      resolve.current = r;
    });
  }, []);

  // Registered in an ordinary effect, not a layout one: every confirm in the
  // app is asked from an event handler, which cannot run before the tree has
  // mounted, and `useLayoutEffect` would warn on the server for no gain.
  useEffect(() => {
    setConfirmHandler(ask);
    return () => clearConfirmHandler(ask);
  }, [ask]);

  return (
    <>
      {children}
      {request && <ConfirmPanel request={request} onSettle={settle} />}
    </>
  );
}

function ConfirmPanel({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (outcome: ConfirmOutcome) => void;
}) {
  const danger = request.tone === "danger";
  // Ticked unless the caller says otherwise — this is an offer the reader may
  // refuse, not a question they must answer. Local state, discarded with the
  // panel: a declined option is not a preference, it is an answer about today.
  const [option, setOption] = useState(request.option?.defaultChecked ?? true);
  const commit = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);

  // Focus follows the safe answer: Cancel on a destructive confirm, so both
  // Enter and Space land on "no". See the note above.
  useEffect(() => {
    (danger ? cancel : commit).current?.focus();
  }, [danger]);

  return (
    <Dialog
      title={request.title}
      onClose={() => onSettle({ ok: false, option: false })}
      width="max-w-lg"
      // A destructive confirm gets no Enter-to-commit, deliberately.
      onSubmit={danger ? undefined : () => onSettle({ ok: true, option })}
      footer={
        <>
          <button
            ref={cancel}
            type="button"
            className={DIALOG_CANCEL_CLASS}
            onClick={() => onSettle({ ok: false, option: false })}
          >
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={commit}
            type="button"
            className={danger ? DIALOG_DANGER_CLASS : DIALOG_COMMIT_CLASS}
            onClick={() => onSettle({ ok: true, option })}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </>
      }
    >
      {request.body || request.option ? (
        <div className="space-y-3 text-[14px] leading-relaxed text-body">
          {/* Blank line = paragraph; a single newline stays a line break, which
              is what keeps the "· " lists these messages were written with. */}
          {request.body?.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}

          {/* LAST, under whatever is unresolved: the caveats are what you read
              to decide, and this is what happens once you have. */}
          {/* `children`, not a wrapping <label>: this control is a BUTTON, so a
              label around it would neither toggle it nor be valid markup. */}
          {request.option && (
            <div className="pt-1">
              <Checkbox checked={option} onChange={setOption}>
                {request.option.label}
              </Checkbox>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
