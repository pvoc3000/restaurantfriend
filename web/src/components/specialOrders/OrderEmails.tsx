"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import { MenuButton } from "@/components/ui/MenuButton";
import { TextInput } from "@/components/ui/TextInput";
import { useFillViewportHeight, useViewportAtLeast } from "@/lib/tableHead";
import {
  answering,
  conversation,
  insertBlock,
  isWaiting,
  removeBlock,
  replyAddress,
  replyCc,
  replyDraft,
  reSubject,
  splitQuoted,
  waitingFor,
  type OrderMessage,
} from "@/lib/orderEmail";
import { ccWithContacts, DOCUMENT_LABEL, type DocumentKind } from "@/lib/specialOrderDocs";
import { bindQuoteSnapshot, quoteSnapshot, sendSpecialOrderEmail } from "@/lib/specialOrderSend";
import { afterDocumentSent, type Consequence, type WorkflowOrder } from "@/lib/orderWorkflow";
import { fileForMail, prepareDocument, type PreparedDocument } from "./orderDocumentDraft";
import { WorkflowOffer } from "./WorkflowOffer";

export type MailCheck = { checked_at: string | null; last_error: string | null } | null;

/** What the Email tab needs to send the order's own documents — the props
 *  `SendDocument` had, for the compose window that lived there until
 *  2026-10-29. Null on an order that has no documents (a template). */
export type OrderEmailDocuments = {
  orgId: string;
  workflow: WorkflowOrder;
  orgSettings: Record<string, unknown>;
  /** The org's today, for the snapshot and the stamps. */
  today: string;
  /** What the order still lacks for its receipt; attaching one asks first. */
  receiptGaps: string[];
};

/** The Email tab's own files ceiling — `order-mail`'s MAX_ATTACHMENT_BYTES. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const SEND_KINDS: DocumentKind[] = ["quote", "receipt", "order"];

/**
 * THE ORDER'S EMAIL (migration 214, Mark, 2026-10-29: "Traci keeps missing
 * incoming special order emails").
 *
 * Every message `order-mail` could tie to this order, NEWEST FIRST (Mark,
 * 2026-10-29). A message from outside is WAITING until an email to the
 * customer follows it or somebody presses No reply needed — opening this tab
 * clears nothing, because reading a question is not answering it.
 *
 * The mailbox is checked every five minutes; Check for email does it now.
 *
 * ONE COMPOSE BOX FOR EVERY EMAIL ABOUT THE ORDER (Mark, 2026-10-29: "we now
 * have two different ways to send emails … we could combine these into one
 * clean workflow"). REPLY opens it the way Mail.app's Reply does: To is whoever
 * wrote the message being answered, Cc everyone else it went to, and the box
 * holds that message quoted with the caret at the top. ATTACH adds the order's
 * Quote or Receipt — its paragraph goes in below what was typed and above the
 * quote, its PDF shows under the box, and Send then goes through
 * `send-special-order-email`, which stamps the order, files the copy and binds
 * a quote's approval link exactly as the old Send… window did — or any files
 * (Other…). Actions ▸ Send… opens this box with that document attached; a
 * kitchen order arrives with To and Cc empty, because it is not the customer's.
 * Nothing is quoted unless the email answers one. The shop's standing Cc is
 * not added here (Mark: "drop the cc's … what we've built is better now").
 */
export function OrderEmails({
  orderId,
  messages,
  contactEmail,
  mailboxes,
  defaultSubject,
  documents = null,
  startReplying = false,
  startSending,
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
  /** The order's conversation subject, for a message that answers nobody. */
  defaultSubject: string;
  documents?: OrderEmailDocuments | null;
  /** Open the reply on arrival — the Orders list's Reply to email. */
  startReplying?: boolean;
  /** `send=quote.<n>` from Actions ▸ Send…: open with that document attached.
   *  The number makes a second choice of the same document a new request. */
  startSending?: string;
  canWrite: boolean;
  check: MailCheck;
  timeZone: string;
  /** The server's clock, so the wait reads the same before and after hydration. */
  nowMs: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"check" | "send" | "dismiss" | "attach" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  const thread = conversation(messages);
  const waiting = thread.filter(isWaiting);
  const answered = answering(thread);

  const [composing, setComposing] = useState(false);
  /** The message this email answers; null for one that starts fresh. */
  const [replyingTo, setReplyingTo] = useState<OrderMessage | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  /** The quoted history the box opened with ("" when it answers nobody). */
  const [quote, setQuote] = useState("");
  /** The text as it opened, so Cancel knows whether anything would be lost. */
  const [opened, setOpened] = useState("");
  const [doc, setDoc] = useState<PreparedDocument | null>(null);
  /** The document's paragraph as it went in, so detaching can take it out. */
  const [docBlock, setDocBlock] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const typed = quote && body.endsWith(quote) ? body.slice(0, body.length - quote.length) : body;
  const canSend = !!to.trim() && (doc !== null || files.length > 0 || typed.trim() !== "");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Side by side and with no document, the box ends at the window's foot like
  // the history beside it, so Send is never below the fold. With a document
  // its preview follows the box, and the page scrolls to it.
  const sideBySide = useViewportAtLeast(1024);
  useFillViewportHeight(bodyRef, composing && sideBySide && !doc, 160);

  const historyRef = useRef<HTMLDivElement>(null);
  useFillViewportHeight(historyRef, thread.length > 0, 320);
  const newestId = thread[thread.length - 1]?.id;
  // A new message arrives at the top, so that is where the pane goes back to.
  useLayoutEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = 0;
  }, [newestId]);

  // The caret at the very top the moment the box opens.
  useEffect(() => {
    const el = bodyRef.current;
    if (!composing || !el) return;
    el.focus();
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
  }, [composing]);

  function release(d: PreparedDocument | null) {
    if (d) URL.revokeObjectURL(d.url);
  }

  function open(next: {
    replyingTo: OrderMessage | null;
    to: string;
    cc: string;
    subject: string;
    body: string;
    quote: string;
    doc?: PreparedDocument | null;
    block?: string;
  }) {
    release(doc);
    setReplyingTo(next.replyingTo);
    setTo(next.to);
    setCc(next.cc);
    setSubject(next.subject);
    setBody(next.body);
    setQuote(next.quote);
    setOpened(next.body);
    setDoc(next.doc ?? null);
    setDocBlock(next.block ?? "");
    setFiles([]);
    setError(null);
    setWarning(null);
    setSentNote(null);
    setComposing(true);
  }

  function close() {
    release(doc);
    setDoc(null);
    setDocBlock("");
    setFiles([]);
    setComposing(false);
  }

  /** Reply: to the newest message from outside (or the newest at all). */
  function startReply() {
    const address = replyAddress(thread, contactEmail);
    const draft = replyDraft(answered, timeZone);
    open({
      replyingTo: answered,
      to: address,
      cc: replyCc(answered, address, mailboxes),
      subject: answered ? reSubject(answered.subject) : defaultSubject,
      body: draft,
      quote: draft,
    });
  }

  async function receiptGoAhead(kind: DocumentKind): Promise<boolean> {
    const gaps = documents?.receiptGaps ?? [];
    return (
      kind !== "receipt" ||
      gaps.length === 0 ||
      confirmDialog({
        title: "Send a receipt for an incomplete order?",
        body: `This order isn’t complete:\n${gaps.map((g) => `· ${g}`).join("\n")}`,
        confirmLabel: "Attach Anyway",
      })
    );
  }

  async function prepare(kind: DocumentKind): Promise<PreparedDocument | null> {
    if (!documents) return null;
    if (!(await receiptGoAhead(kind))) return null;
    setBusy("attach");
    setError(null);
    try {
      return await prepareDocument(createClient(), {
        orderId,
        orgId: documents.orgId,
        kind,
        orgSettings: documents.orgSettings,
        today: documents.today,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  /**
   * A document with the box closed (Actions ▸ Send…). A kitchen order is a new
   * message with To and Cc left for the sender (Mark: "This would almost never
   * get used"). A customer's document answers their waiting email when there
   * is one, quoting it; otherwise it starts fresh in the order's conversation.
   */
  async function startDocument(kind: DocumentKind) {
    const d = await prepare(kind);
    if (!d) return;
    if (kind === "order") {
      open({ replyingTo: null, to: "", cc: "", subject: d.email.subject, body: d.email.body, quote: "", doc: d, block: d.email.body });
      return;
    }
    if (waiting.length > 0 && answered) {
      const address = replyAddress(thread, contactEmail);
      const draft = replyDraft(answered, timeZone);
      open({
        replyingTo: answered,
        to: address,
        cc: replyCc(answered, address, mailboxes),
        subject: reSubject(answered.subject),
        body: insertBlock(draft, draft, d.email.body),
        quote: draft,
        doc: d,
        block: d.email.body,
      });
      return;
    }
    open({
      replyingTo: null,
      to: d.email.to,
      // The contact when they are someone else; never the shop's own copy.
      cc: ccWithContacts(d.email.to, "", [d.order.contact_email]),
      subject: d.email.subject,
      body: d.email.body,
      quote: "",
      doc: d,
      block: d.email.body,
    });
  }

  /** Attach ▸ Quote / Receipt with the box open: one document at a time. */
  async function attachDocument(kind: DocumentKind) {
    const d = await prepare(kind);
    if (!d) return;
    const without = doc ? removeBlock(body, docBlock) : body;
    release(doc);
    setDoc(d);
    setDocBlock(d.email.body);
    setBody(insertBlock(without, quote, d.email.body));
    if (!replyingTo && !subject.trim()) setSubject(d.email.subject);
  }

  function detachDocument() {
    if (!doc) return;
    setBody(removeBlock(body, docBlock));
    release(doc);
    setDoc(null);
    setDocBlock("");
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const next = [...files, ...Array.from(list)];
    const bytes = next.reduce((n, f) => n + f.size, 0);
    if (bytes > MAX_FILE_BYTES) {
      setError(`Those files come to ${(bytes / 1048576).toFixed(1)} MB — one email can carry ${MAX_FILE_BYTES / 1048576} MB from here.`);
      return;
    }
    setError(null);
    setFiles(next);
  }

  async function cancel() {
    const dirty = body !== opened || files.length > 0;
    if (
      dirty &&
      !(await confirmDialog({
        title: "Discard this email?",
        body: "What you typed will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep Writing",
        tone: "danger",
      }))
    ) {
      return;
    }
    close();
  }

  // Arriving from Reply to email (`reply=1`) or Actions ▸ Send… (`send=…`):
  // act once, then take the word off the address so a refresh or Back does
  // not do it again.
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (!canWrite) return;
    const request = startSending ? `send:${startSending}` : startReplying ? "reply" : null;
    if (!request || arrived.current === request) return;
    arrived.current = request;
    const url = new URL(window.location.href);
    url.searchParams.delete("reply");
    url.searchParams.delete("send");
    window.history.replaceState(window.history.state, "", url);
    // After this render, as a click's handler would run: a request, not state
    // derived from props.
    queueMicrotask(() => {
      if (startSending) {
        const kind = startSending.split(".")[0] as DocumentKind;
        if (!SEND_KINDS.includes(kind)) return;
        if (composing && kind !== "order") void attachDocument(kind);
        else void startDocument(kind);
      } else {
        startReply();
      }
    });
    // Once per request; the handlers read the messages as they render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startReplying, startSending, canWrite]);

  const replyButton =
    canWrite && !composing ? (
      <button type="button" className={BUTTON_CLASS} onClick={startReply} disabled={pending || busy !== null}>
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
      const supabase = createClient();
      const mailFiles = await Promise.all(files.map(fileForMail));
      const answeringId = replyingTo?.id ?? null;

      if (doc && documents) {
        // Decision 17: the snapshot is written BEFORE the send. A live link
        // nobody has been given is harmless; a link the customer HAS that says
        // the quote does not exist is not.
        if (doc.token) {
          await bindQuoteSnapshot(supabase, doc.token, quoteSnapshot(doc.order, doc.org, documents.today));
        }
        const result = await sendSpecialOrderEmail(supabase, {
          orderId,
          kind: doc.kind as "quote" | "receipt" | "order",
          to,
          cc,
          subject,
          body,
          blob: doc.blob,
          filename: doc.filename,
          quoteToken: doc.token,
          answering: doc.kind === "order" ? null : answeringId,
          files: mailFiles,
        });
        // Into the history now, and answering what it answers, rather than at
        // the next check. A failure here is only a delay.
        if (result.id?.startsWith("gmail ")) {
          await supabase.functions.invoke("order-mail", { body: { mode: "record", order_id: orderId, ref: result.id } });
        }
        const kind = doc.kind;
        if (result.warning) setWarning(result.warning);
        setSentNote(`${DOCUMENT_LABEL[kind]} sent to ${to}`);
        close();
        const consequences = afterDocumentSent(documents.workflow, kind, documents.today);
        if (consequences.length > 0) setOffer(consequences);
        return;
      }

      const { data, error: e } = await supabase.functions.invoke("order-mail", {
        body: { mode: "reply", order_id: orderId, answering: answeringId, to, cc, subject, body, files: mailFiles },
      });
      if (e) throw new Error(await functionError(e));
      if (data?.error) throw new Error(data.error);
      if (data?.warning) setWarning(data.warning);
      close();
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

  const working = pending || busy !== null;
  const attachItems = [
    ...(documents
      ? (["quote", "receipt"] as const).map((k) => ({
          label: DOCUMENT_LABEL[k].replace(/\b\w/g, (c) => c.toUpperCase()),
          onSelect: () => void attachDocument(k),
          disabled: working,
        }))
      : []),
    { label: "Other…", onSelect: () => fileRef.current?.click(), disabled: working },
  ];

  return (
    <section className="space-y-4">
      <SectionHeading count={thread.length}>Email</SectionHeading>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <button type="button" className={BUTTON_CLASS} onClick={checkNow} disabled={working}>
          {busy === "check" ? "Checking…" : "Check for email"}
        </button>
        <span>
          {check?.checked_at ? `Checked ${when(check.checked_at)}` : "The mailbox has not been checked yet."}
        </span>
        {busy === "attach" ? <span>Preparing the document…</span> : null}
        {sentNote ? <span className="text-[var(--rf-green-600)]">{sentNote}</span> : null}
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
              <button type="button" className={BUTTON_CLASS} onClick={dismiss} disabled={working}>
                {busy === "dismiss" ? "Clearing…" : "No reply needed"}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className={`grid items-start gap-4 ${composing ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
        {canWrite && composing ? (
          <div className="space-y-4 lg:order-2">
            <div className="space-y-2 border-2 border-ink bg-white p-3 shadow-[4px_4px_0_0_#000]">
              <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
                <label className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">To</span>
                  <TextInput value={to} onValueChange={setTo} clearLabel="Clear To" className="w-full" disabled={working} />
                </label>
                <label className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">Cc</span>
                  <TextInput value={cc} onValueChange={setCc} clearLabel="Clear Cc" className="w-full" disabled={working} />
                </label>
                <label className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">Subject</span>
                  <TextInput
                    value={subject}
                    onValueChange={setSubject}
                    clearLabel="Clear Subject"
                    className="w-full"
                    disabled={working}
                  />
                </label>
                <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">Message</span>
                <textarea
                  ref={bodyRef}
                  value={body}
                  rows={14}
                  disabled={working}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) send();
                    if (e.key === "Escape") {
                      e.preventDefault();
                      void cancel();
                    }
                  }}
                  aria-label="Message"
                  className={FORM_FIELD_DRESS}
                />
              </div>

              {/* WHAT GOES WITH IT: the order's document (one) and any files. */}
              <div className="flex flex-wrap items-center gap-2 pl-[4.5rem]">
                <MenuButton
                  label="Attach a document"
                  trigger={busy === "attach" ? "Preparing…" : "Attach"}
                  triggerClassName={BUTTON_CLASS}
                  caret
                  disabled={working}
                  items={attachItems}
                />
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {doc ? <FileChip name={doc.filename} onRemove={detachDocument} disabled={working} /> : null}
                {files.map((f, i) => (
                  <FileChip
                    key={`${f.name}-${i}`}
                    name={f.name}
                    disabled={working}
                    onRemove={() => setFiles(files.filter((_, j) => j !== i))}
                  />
                ))}
              </div>

              {/* The conversation's name wraps in its own space; the two buttons stay a pair. */}
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 break-words text-[12px] text-subtle">
                  {replyingTo?.subject ? `In the conversation “${replyingTo.subject}”` : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <button type="button" className={BUTTON_CLASS} onClick={() => void cancel()} disabled={working}>
                    Cancel
                  </button>
                  <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={send} disabled={working || !canSend}>
                    {busy === "send" ? "Sending…" : replyingTo ? "Send reply" : "Send"}
                  </button>
                </span>
              </div>
              {error ? <p className="text-[13px] text-accent">{error}</p> : null}
            </div>

            {/* THE DOCUMENT AS IT WILL GO (Mark: "keep the pdf preview … under
                the compose box … only visible if there's a document"). */}
            {doc ? (
              <div className="border border-ink">
                <div className="flex items-center gap-3 border-b border-ink px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">Attached: {doc.filename}</span>
                  <a href={doc.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                    Open in a new tab
                  </a>
                </div>
                <object data={doc.url} type="application/pdf" aria-label={`Preview of ${doc.filename}`} className="h-[80vh] w-full">
                  <div className="flex h-40 items-center justify-center p-4 text-center text-xs text-subtle">
                    This browser can’t show the PDF here — open it in a new tab.
                  </div>
                </object>
              </div>
            ) : null}
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

      {error && !composing ? <p className="text-[13px] text-accent">{error}</p> : null}
      {warning ? <p className="text-[13px] text-accent">{warning}</p> : null}

      {offer ? <WorkflowOffer orderId={orderId} consequences={offer} onClose={() => setOffer(null)} /> : null}
    </section>
  );
}

/** One attached file, with its ✕. */
function FileChip({ name, onRemove, disabled }: { name: string; onRemove: () => void; disabled: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 border border-hairline px-2 py-1 text-[12px]">
      <span className="min-w-0 truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${name}`}
        className="px-1 text-subtle hover:bg-neutral-100 hover:text-ink"
      >
        ✕
      </button>
    </span>
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
