"use client";

// Asking the question. The PANEL that answers it is
// `components/ui/ConfirmDialog.tsx`; this half is deliberately component-free.
//
// The split is not tidiness. Fast Refresh does a FULL PAGE RELOAD whenever a
// file that exports a React component is also imported by something outside the
// React tree — and `useAttachmentActions` is a plain hook module that asks a
// confirm, so keeping these functions beside the provider made every edit to
// any of ~20 files reload the whole app. Next says so in as many words in the
// console ("Consider migrating the non-React component export to a separate
// file"). That is worse here than it sounds: a full reload also wipes
// `lib/scrollMemory`, whose whole point is surviving navigation, so the two
// features would have quietly fought each other all day in dev.

export type ConfirmRequest = {
  /**
   * The question, in the black title bar. Short — this is the sentence a
   * `window.confirm` message opened with ("Close 3 orders?").
   */
  title: string;
  /**
   * Everything the reader needs before answering: what is about to happen, what
   * is unresolved, what cannot be undone. Blank lines separate paragraphs and
   * single newlines are kept, so the `· ` lists these messages already carried
   * survive the move verbatim.
   */
  body?: string;
  /** Defaults to a bare "Confirm"; name the act instead where you can. */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * `danger` for anything that destroys or discards — the accent commit, and
   * Enter refuses to fire it. Default otherwise, which is the black commit.
   */
  tone?: "default" | "danger";
};

export type ConfirmAsk = (request: ConfirmRequest) => Promise<boolean>;

/** Set by `ConfirmProvider` on mount. See `confirmDialog`. */
let live: ConfirmAsk | null = null;

/** Called by `ConfirmProvider` on mount, so `confirmDialog` has somewhere to go. */
export function setConfirmHandler(ask: ConfirmAsk) {
  live = ask;
}

/** Cleanup, and only of its OWN registration — a provider being torn down after
 *  its replacement mounted must not unregister the replacement. */
export function clearConfirmHandler(ask: ConfirmAsk) {
  if (live === ask) live = null;
}

/**
 * Ask the question, and resolve true only if the reader takes the commit —
 * Escape, the ✕, clicking away and Cancel all resolve false.
 *
 * This is the one entry point; there is no hook twin, because a confirm is
 * asked from an EVENT HANDLER rather than during render, so a hook would buy
 * nothing and cost a line in every component that asks. Call it exactly where
 * `window.confirm` used to sit:
 *
 * ```ts
 * if (!(await confirmDialog({ title: "Delete 3 lines?", tone: "danger" }))) return;
 * ```
 */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  if (live) return live(request);
  // No provider — outside the (app) layout, or a render this beat. Ask the
  // browser rather than returning false (which would silently skip the action)
  // or true (which would silently take it).
  const text = [request.title, request.body].filter(Boolean).join("\n\n");
  return Promise.resolve(window.confirm(text));
}

/**
 * Split a `window.confirm`-shaped message into the panel's two parts: the
 * question becomes the title, everything after the first blank line the body.
 *
 * These messages were all written as one string with `\n\n` between paragraphs,
 * and they are carefully worded — they name what is unresolved, what cannot be
 * undone, how many rows carry received quantities. Re-typing 28 of them into
 * title/body pairs by hand is exactly where a wrong warning would get attached
 * to the wrong action, so the split is done here instead and each message moves
 * verbatim. Spread it:
 *
 * ```ts
 * await confirmDialog({ ...splitConfirmMessage(message), tone: "danger" })
 * ```
 */
export function splitConfirmMessage(message: string): { title: string; body?: string } {
  const [title, ...rest] = message.split(/\n\s*\n/);
  const body = rest.join("\n\n").trim();
  return body ? { title: title.trim(), body } : { title: title.trim() };
}
