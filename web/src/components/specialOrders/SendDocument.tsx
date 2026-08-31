"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/MenuButton";
import { TextInput } from "@/components/ui/TextInput";
import {
  DOCUMENT_LABEL,
  buildDocumentEmail,
  documentFileName,
  fetchOrderDocData,
  type DocumentKind,
  type EmailParts,
  type OrderDocData,
  type DocOrg,
} from "@/lib/specialOrderDocs";
import {
  approvalUrl,
  bindQuoteSnapshot,
  mintQuoteToken,
  quoteSnapshot,
  resolveAppBase,
  sendSpecialOrderEmail,
} from "@/lib/specialOrderSend";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";
import {
  DOCUMENT_STAMPS,
  afterDocumentSent,
  type Consequence,
  type WorkflowOrder,
} from "@/lib/orderWorkflow";
import { WorkflowOffer } from "./WorkflowOffer";

/**
 * PRODUCE AND SEND — decision 11's four documents and decision 12's compose
 * card, as one control on the order's command bar.
 *
 * THREE VERBS, EACH ONE A MENU OF THE FOUR DOCUMENTS (Mark, 2026-08-19:
 * "Delete the document selection picklist, then make Preview, Download, and
 * Email… picklist buttons… Same functionality, one less button").
 *
 * FileMaker's bottom row carried a separate Preview and Email for each document
 * and it was nine cells wide. The first cut here was a `PickList` of documents
 * beside the three verbs — four cells — and it had the thing wrong that a menu
 * gets right: the picker held STATE. You chose Invoice, pressed Preview, came
 * back a minute later and the bar still said Invoice, so the next Email went to
 * whatever you had been looking at rather than to what you meant. Two steps,
 * and a wrong one is silent.
 *
 * Folding the documents INTO each verb makes the whole act one gesture and
 * leaves nothing selected afterwards: press Preview, pick Quote, and that is
 * the sentence. `ui/MenuButton` and not a `PickList` for exactly that reason —
 * a PickList chooses a value that STAYS chosen and shows which; these are verbs
 * that happen once.
 *
 * `kind` survives as state because the compose DIALOG needs to know which
 * document it is sending — its title, its templates, its filename — but it is
 * now set by the act that opens the dialog rather than by a separate control.
 *
 * The renderer and the document components load on FIRST CLICK, not with the
 * page — @react-pdf is heavy and most visits to an order never produce
 * anything.
 *
 * THE POPUP GOTCHA, paid for once already on PO detail: a `window.open` after
 * an `await` is silently blocked. The window is opened SYNCHRONOUSLY in the
 * click handler and navigated to the blob later.
 */
export function SendDocument({
  orderId,
  orgId,
  number,
  canWrite,
  /** Enough of the order for `lib/orderWorkflow` to reason about what a sent
   *  document implies. */
  workflow,
  /** `orgs.settings`, for the email templates (design rule 2). */
  orgSettings,
  /** Today in the org's timezone — the snapshot records when the quote went
   *  out, and a browser's own idea of today is the browser's timezone. */
  today,
}: {
  workflow: WorkflowOrder;
  orderId: string;
  orgId: string;
  number: string;
  canWrite: boolean;
  orgSettings: Record<string, unknown>;
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [kind, setKind] = useState<DocumentKind>("quote");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const [compose, setCompose] = useState<EmailParts | null>(null);
  // Everything the open dialog is holding: the exact blob it previews and will
  // send, the assembled document behind it, and — for a quote — the token whose
  // link is already sitting in the body.
  const [pending, setPending] = useState<{
    order: OrderDocData;
    org: DocOrg;
    blob: Blob;
    url: string;
    filename: string;
    token: string | null;
  } | null>(null);
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  if (!canWrite) return null;

  function closeCompose() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setCompose(null);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function render(k: DocumentKind) {
    const [{ pdf }, docs, data] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./pdf/SpecialOrderPdfs"),
      fetchOrderDocData(supabase, [orderId]),
    ]);
    if (data.orders.length === 0) throw new Error("Order not found");
    const order = data.orders[0];
    const blob = await pdf(docs.documentElement(k, [order], data.org)).toBlob();
    return { blob, order, org: data.org };
  }

  const preview = (k: DocumentKind) => {
    // Before any await, while the click gesture still counts. The menu closes
    // synchronously in `MenuButton`'s own handler, so this is still inside the
    // gesture that opened the document — see the popup gotcha above.
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { blob, order } = await render(k);
        showBlob(win, blob, documentFileName(k, order.number, order.event_date ?? today));
      } catch (e) {
        win?.close();
        throw e;
      }
    });
  };

  /**
   * DOWNLOADING STAMPS THE DATE, silently, exactly as emailing does (Mark,
   * 2026-08-21). Downloading is how a document gets printed, and a printed
   * quote is a sent quote — so the two routes out of this card record the same
   * fact the same way, and only PREVIEW leaves no trace, because previewing is
   * how you check the wording before you commit to either.
   *
   * The stamp is skipped when the date is already there: a second copy printed
   * next week is not a second send, and overwriting would move the date the
   * customer's own copy was dated.
   */
  const download = (k: DocumentKind) =>
    run("download", async () => {
      const { blob, order } = await render(k);
      downloadBlob(blob, documentFileName(k, order.number, order.event_date ?? today));

      const column = DOCUMENT_STAMPS[k];
      if (column && !workflow[column]) {
        const { data } = await supabase
          .from("special_orders")
          .update({ [column]: today })
          .eq("id", orderId)
          .select("id");
        // Silent on refusal, deliberately: the document IS downloaded and is
        // on somebody's disk. Failing the download after the fact because a
        // bookkeeping write did not land would be reporting the wrong thing.
        if (data?.length) router.refresh();
      }
      propose(k);
    });

  /** What a document going out implies for the ladder — asked once, after it
   *  has gone. An empty answer opens nothing. */
  function propose(k: DocumentKind) {
    const cs = afterDocumentSent(workflow, k, today);
    if (cs.length > 0) setOffer(cs);
  }

  /**
   * Open the compose dialog: render the attachment ONCE so the preview pane
   * shows the exact document Send will transmit, and — for a quote — mint the
   * approval token FIRST, so the link is a real URL in a body the human can
   * read and edit before it goes anywhere.
   */
  const openCompose = (k: DocumentKind) =>
    run("compose", async () => {
      // Recorded FIRST, because everything the dialog renders reads it — the
      // title, the templates, the sent note — and it is no longer set by a
      // control the reader can see.
      setKind(k);
      const { blob, order, org } = await render(k);

      // THE LINK IS RESOLVED BEFORE THE TOKEN IS MINTED. If the deployment's
      // address is unknown there is no usable link, and refusing here costs
      // nothing — where refusing after the mint would leave an orphan token
      // behind every attempt, and refusing at SEND would waste an email
      // somebody had already written.
      let token: string | null = null;
      let link = "";
      if (k === "quote") {
        const resolved = resolveAppBase(window.location.origin);
        if ("error" in resolved) throw new Error(resolved.error);
        token = await mintQuoteToken(supabase, { orderId, orgId });
        link = approvalUrl(token, resolved.base);
      }
      setSentNote(null);
      setCompose(
        buildDocumentEmail(k, order, orgSettings, {
          approve_url: link,
          // The whole paragraph, so a template that omits `{approve_line}`
          // simply doesn't offer the link rather than printing a bare URL in
          // the middle of a sentence.
          approve_line: link
            ? `\nYou can review and approve it here — no printing or scanning needed:\n${link}\n`
            : "",
        })
      );
      setPending({
        order,
        org,
        blob,
        url: URL.createObjectURL(blob),
        filename: documentFileName(k, order.number, order.event_date ?? today),
        token,
      });
    });

  const send = () =>
    run("send", async () => {
      if (!compose || !pending) return;

      // Decision 17: the snapshot is written BEFORE the send. A live link
      // nobody has been given is harmless; a link the customer HAS that says
      // the quote does not exist is not. See `bindQuoteSnapshot`.
      if (pending.token) {
        await bindQuoteSnapshot(
          supabase,
          pending.token,
          quoteSnapshot(pending.order, pending.org, today)
        );
      }

      const { warning } = await sendSpecialOrderEmail(supabase, {
        orderId,
        kind,
        to: compose.to,
        cc: compose.cc,
        subject: compose.subject,
        body: compose.body,
        blob: pending.blob,
        filename: pending.filename,
        quoteToken: pending.token,
      });
      const to = compose.to;
      closeCompose();
      setSentNote(`${DOCUMENT_LABEL[kind]} sent to ${to}${warning ? ` — ${warning}` : ""}`);
      router.refresh();
      // The edge function has already stamped the stage date (its own
      // STAGE_COLUMN map), so what is left to ask about is the LADDER.
      propose(kind);
    });

  /**
   * The four documents, in the order the workflow produces them — quote before
   * invoice before receipt, and the kitchen order last because it is the one
   * that never leaves the building.
   *
   * The hints are what tell them apart at the moment of choosing. Without them
   * "Invoice" and "Receipt" are two words for the same page, which is nearly
   * true: they ARE one layout at two moments, and the hint is the moment.
   */
  const DOCUMENTS: { kind: DocumentKind; hint: string }[] = [
    { kind: "quote", hint: "with the terms and the approval link" },
    { kind: "invoice", hint: "payments and the balance due" },
    { kind: "receipt", hint: "the invoice, settled" },
    { kind: "order", hint: "no prices; grouped by size" },
  ];

  /** One verb's menu: the same four documents, each doing that verb. */
  const menu = (act: (k: DocumentKind) => void) =>
    DOCUMENTS.map((d) => ({
      label: DOCUMENT_LABEL[d.kind],
      hint: d.hint,
      onSelect: () => act(d.kind),
    }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {/* THE VERB IS THE LABEL AND IT NEVER CHANGES. A menu button is not a
            picker: nothing stays selected, so the bar reads the same before and
            after, and a document chosen an hour ago cannot be sent by mistake.
            Busy states are per verb, so rendering a preview does not make the
            other two look broken — but all three disable, because they share
            one renderer and one `busy`. */}
        <MenuButton
          label="Preview which document"
          trigger={busy === "preview" ? "Rendering…" : "Preview"}
          triggerClassName={BUTTON_CLASS}
          caret
          disabled={busy !== null}
          items={menu(preview)}
        />
        <MenuButton
          label="Download which document"
          trigger={busy === "download" ? "Rendering…" : "Download"}
          triggerClassName={BUTTON_CLASS}
          caret
          disabled={busy !== null}
          items={menu(download)}
        />
        <MenuButton
          label="Email which document"
          trigger={busy === "compose" ? "Loading…" : "Email…"}
          triggerClassName={BUTTON_CLASS}
          caret
          disabled={busy !== null}
          items={menu(openCompose)}
        />

        {sentNote && <p className="text-[13px] text-[var(--rf-green-600)]">{sentNote}</p>}
        {error && !compose && <p className="text-[13px] text-accent">{error}</p>}
      </div>

      {compose && pending && (
        <Dialog
          title={`Email ${DOCUMENT_LABEL[kind].toLowerCase()} #${number}`}
          ariaLabel={`Email the ${DOCUMENT_LABEL[kind].toLowerCase()} for order ${number}`}
          onClose={closeCompose}
          busy={busy !== null}
          width="max-w-5xl"
          top="pt-[4vh]"
          // A DEFINITE height, not the cap: this panel's point is a big pane to
          // look at, and shrink-wrapped it would be the preview's own floor.
          height="h-[88vh]"
          bodyClassName="grid min-h-0 gap-4 p-6 md:grid-cols-2 md:grid-rows-1"
          footer={
            <>
              <span className="mr-auto text-xs text-subtle">
                Attached: {pending.filename} — the document shown here is what sends
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={closeCompose}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              {/* BLACK, the endorsed panel-commit exception: a panel exists to
                  produce ONE outcome, so its footer is a two-weight decision
                  rather than a row of peers. */}
              <button
                type="button"
                disabled={busy !== null || !compose.to.trim()}
                onClick={send}
                className={DIALOG_COMMIT_CLASS}
                title={
                  compose.to.trim()
                    ? "Send now — the date stamps itself and the log writes itself"
                    : "Add a recipient first"
                }
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
              {(
                [
                  ["To", "to"],
                  ["Cc", "cc"],
                  ["Subject", "subject"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">{label}</span>
                  <TextInput
                    value={compose[field]}
                    disabled={busy !== null}
                    onValueChange={(next) => setCompose({ ...compose, [field]: next })}
                    clearLabel={`Clear ${label}`}
                    className="w-full"
                  />
                </label>
              ))}
              <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">
                Body
              </span>
              <textarea
                value={compose.body}
                rows={12}
                disabled={busy !== null}
                onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                className={FORM_FIELD_DRESS}
              />
            </div>

            {pending.token && (
              <p className="text-[12px] text-muted">
                The approval link in this message is live until a newer quote is
                sent, and the customer’s typed name is filed as a signed quote.
              </p>
            )}

            {/* A send failure must surface INSIDE the dialog — the bar's own
                error line is behind the overlay. */}
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>

          <object
            data={pending.url}
            type="application/pdf"
            aria-label={`Preview of ${pending.filename}`}
            className="h-[26rem] w-full border border-ink md:h-full md:min-h-[26rem]"
          >
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-subtle">
              This browser can&apos;t preview PDFs inline — use Preview to open it
              in its own tab.
            </div>
          </object>
        </Dialog>
      )}

      {/* Asked AFTER the document has gone, and only about the ladder — the
          date is already recorded by then, by the edge function on the email
          path and by `download` on the other. */}
      {offer && (
        <WorkflowOffer
          orderId={orderId}
          consequences={offer}
          onClose={() => setOffer(null)}
        />
      )}
    </>
  );
}
