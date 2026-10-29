"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import { TextInput } from "@/components/ui/TextInput";
import { useFillViewportHeight, useViewportAtLeast } from "@/lib/tableHead";
import {
  answering,
  conversation,
  isWaiting,
  replyAddress,
  replyCc,
  replyDraft,
  splitQuoted,
  waitingFor,
  type OrderMessage,
} from "@/lib/orderEmail";

export type MailCheck = { checked_at: string | null; last_error: string | null } | null;

/**
 * THE ORDER'S EMAIL (migration 214, Mark, 2026-10-29: "Traci keeps missing
 * incoming special order emails").
 *
 * Every message `order-mail` could tie to this order, NEWEST FIRST (Mark,
 * 2026-10-29), beside a reply box. A message from
 * outside is WAITING until an email to the customer follows it or somebody
 * presses No reply needed — opening this tab clears nothing, because reading
 * a question is not answering it.
 *
 * The mailbox is checked every five minutes; Check for email does it now.
 *
 * The history is a pane that ends at the foot of the window. REPLY opens the
 * compose box beside it, on the right (above it on a narrow window), the way
 * Mail.app's Reply does (Mark, 2026-10-29): To is whoever wrote the message
 * being answered, Cc everyone else it went to, and the box holds that message
 * quoted under two empty lines with the caret at the top. Sending, or Cancel,
 * puts the box away; the sent reply is then the newest message in the pane.
 */
export function OrderEmails({
  orderId,
  messages,
  contactEmail,
  mailboxes,
  canWrite,
  check,
  timeZone,
  nowMs,
}: {
  orderId: string;
  messages: OrderMessage[];
  contactEmail: string | null;
  /** The shop's own addresses, which a reply never copies. */
  mailboxes: string[];
  canWrite: boolean;
  check: MailCheck;
  timeZone: string;
  /** The server's clock, so the wait reads the same before and after hydration. */
  nowMs: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"check" | "send" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const thread = conversation(messages);
  const waiting = thread.filter(isWaiting);
  const answered = answering(thread);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [body, setBody] = useState("");
  // The quote the box opened with, so Send can tell a reply from an untouched one.
  const [draft, setDraft] = useState("");
  const typed = body.endsWith(draft) ? body.slice(0, body.length - draft.length) : body;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Side by side, the reply box ends at the window's foot like the history
  // beside it, so Send is never below the fold. Stacked, it keeps its rows.
  const sideBySide = useViewportAtLeast(1024);
  useFillViewportHeight(bodyRef, composing && sideBySide, 160);

  const historyRef = useRef<HTMLDivElement>(null);
  useFillViewportHeight(historyRef, thread.length > 0, 320);
  const newestId = thread[thread.length - 1]?.id;
  // A new message arrives at the top, so that is where the pane goes back to.
  useLayoutEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = 0;
  }, [newestId]);

  // The caret at the very top, above the quote, the moment the box opens.
  useEffect(() => {
    const el = bodyRef.current;
    if (!composing || !el) return;
    el.focus();
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
  }, [composing]);

  function startReply() {
    const address = replyAddress(thread, contactEmail);
    const quote = replyDraft(answered, timeZone);
    setTo(address);
    setCc(replyCc(answered, address, mailboxes));
    setBody(quote);
    setDraft(quote);
    setError(null);
    setWarning(null);
    setComposing(true);
  }

  async function cancelReply() {
    if (typed.trim() && !(await confirmDialog({
        title: "Discard this reply?",
        body: "What you typed will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep Writing",
        tone: "danger",
      }))) {
      return;
    }
    setComposing(false);
  }

  const replyButton =
    canWrite && !composing ? (
      <button type="button" className={BUTTON_CLASS} onClick={startReply} disabled={pending}>
        Reply
      </button>
    ) : null;

  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  function run(kind: "check" | "send" | "dismiss", work: () => Promise<void>) {
    setError(null);
    setWarning(null);
    setBusy(kind);
    start(async () => {
      try {
        await work();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  const checkNow = () =>
    run("check", async () => {
      const { data, error: e } = await createClient().functions.invoke("order-mail", { body: { mode: "check" } });
      if (e) throw new Error(await functionError(e));
      if (data?.error) throw new Error(data.error);
    });

  const dismiss = () =>
    run("dismiss", async () => {
      const { error: e } = await createClient().rpc("dismiss_special_order_messages", { p_order: orderId });
      if (e) throw new Error(e.message);
    });

  const send = () =>
    run("send", async () => {
      const { data, error: e } = await createClient().functions.invoke("order-mail", {
        body: { mode: "reply", order_id: orderId, answering: answered?.id ?? null, to, cc, body },
      });
      if (e) throw new Error(await functionError(e));
      if (data?.error) throw new Error(data.error);
      if (data?.warning) setWarning(data.warning);
      setComposing(false);
    });

  async function openFile(messageId: string, partId: string) {
    setError(null);
    const { data, error: e } = await createClient().functions.invoke("order-mail", {
      body: { mode: "attachment", message_id: messageId, part_id: partId },
    });
    if (e || data?.error) {
      setError(e ? await functionError(e) : data.error);
      return;
    }
    const bytes = Uint8Array.from(atob(data.base64 as string), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: data.mime_type as string }));
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename as string;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <section className="space-y-4">
      <SectionHeading count={thread.length}>Email</SectionHeading>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <button type="button" className={BUTTON_CLASS} onClick={checkNow} disabled={pending}>
          {busy === "check" ? "Checking…" : "Check for email"}
        </button>
        <span>
          {check?.checked_at ? `Checked ${when(check.checked_at)}` : "The mailbox has not been checked yet."}
        </span>
        {waiting.length === 0 && replyButton ? <span className="flex flex-1 justify-end">{replyButton}</span> : null}
      </div>
      {check?.last_error ? (
        <p className="text-[13px] text-accent">The last check failed: {check.last_error}</p>
      ) : null}

      {waiting.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-mark-fill px-3 py-2 text-[14px] text-ink">
          <span>
            <strong>Waiting for a reply</strong> · {waitingFor(waiting[0].sent_at, nowMs)}
          </span>
          {canWrite ? (
            <span className="flex flex-wrap items-center gap-2">
              {replyButton}
              <button type="button" className={BUTTON_CLASS} onClick={dismiss} disabled={pending}>
                {busy === "dismiss" ? "Clearing…" : "No reply needed"}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className={`grid items-start gap-4 ${composing ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
        {canWrite && composing ? (
          <div className="space-y-2 border-2 border-ink bg-white p-3 shadow-[4px_4px_0_0_#000] lg:order-2">
            <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
              <label className="contents">
                <span className="text-xs uppercase tracking-[0.12em] text-subtle">To</span>
                <TextInput value={to} onValueChange={setTo} clearLabel="Clear To" className="w-full" disabled={pending} />
              </label>
              <label className="contents">
                <span className="text-xs uppercase tracking-[0.12em] text-subtle">Cc</span>
                <TextInput value={cc} onValueChange={setCc} clearLabel="Clear Cc" className="w-full" disabled={pending} />
              </label>
              <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">Reply</span>
              <textarea
                ref={bodyRef}
                value={body}
                rows={14}
                disabled={pending}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && to.trim() && typed.trim()) send();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    void cancelReply();
                  }
                }}
                aria-label="Reply"
                className={FORM_FIELD_DRESS}
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {answered?.subject ? (
                <span className="mr-auto text-[12px] text-subtle">In the conversation “{answered.subject}”</span>
              ) : null}
              <button type="button" className={BUTTON_CLASS} onClick={() => void cancelReply()} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                onClick={send}
                disabled={pending || !to.trim() || !typed.trim()}
              >
                {busy === "send" ? "Sending…" : "Send reply"}
              </button>
            </div>
          </div>
        ) : null}

        <div ref={historyRef} className="overflow-y-auto overflow-x-hidden border border-ink">
          {thread.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">No email about this order has come in or gone out.</p>
          ) : (
            <ol className="space-y-4 bg-neutral-100 p-4">
              {[...thread].reverse().map((m) => (
                <Message key={m.id} message={m} when={when(m.sent_at)} onOpenFile={openFile} />
              ))}
            </ol>
          )}
        </div>
      </div>

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {warning ? <p className="text-[13px] text-accent">{warning}</p> : null}
    </section>
  );
}

function Message({
  message: m,
  when,
  onOpenFile,
}: {
  message: OrderMessage;
  when: string;
  onOpenFile: (messageId: string, partId: string) => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { main, quoted } = splitQuoted(m.body_text ?? m.snippet);
  const waiting = isWaiting(m);
  return (
    <li className={`border border-ink bg-white p-4 ${waiting ? "border-l-[6px]" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
        <span className={m.direction === "in" ? "font-semibold text-ink" : "text-muted"}>
          {m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address}
          {m.to_addresses ? <span className="font-normal text-subtle"> → {m.to_addresses}</span> : null}
        </span>
        <span className="text-subtle">
          {waiting ? <span className="mr-2 bg-mark-fill px-1 text-[11px] font-bold text-ink">Waiting</span> : null}
          {when}
        </span>
      </div>
      {m.subject ? <p className="mt-0.5 text-[12px] text-subtle">{m.subject}</p> : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{main || "(no text)"}</p>
      {quoted ? (
        showQuoted ? (
          <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-hairline pl-2 text-[13px] text-muted">
            {quoted}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowQuoted(true)}
            className="mt-1 text-[12px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Show earlier messages
          </button>
        )
      ) : null}
      {m.attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <button
              key={a.part_id}
              type="button"
              onClick={() => onOpenFile(m.id, a.part_id)}
              className="border border-hairline px-2 py-1 text-[12px] hover:bg-neutral-100"
            >
              {a.filename}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** A function's own error message, which `functions.invoke` hides inside the
 *  response of a non-2xx answer. */
async function functionError(e: unknown): Promise<string> {
  const context = (e as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const data = await context.json();
      if (data?.error) return String(data.error);
    } catch {
      // fall through to the generic message
    }
  }
  return e instanceof Error ? e.message : String(e);
}
