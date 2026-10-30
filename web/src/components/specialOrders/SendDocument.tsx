"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { MenuButton } from "@/components/ui/MenuButton";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { DOCUMENT_LABEL, documentFileName, type DocumentKind } from "@/lib/specialOrderDocs";
import { downloadBlob, openWindowNow, showBlob } from "@/lib/poProcessing";
import {
  DOCUMENT_STAMPS,
  afterDocumentSent,
  afterPaymentSettled,
  type Consequence,
  type WorkflowOrder,
} from "@/lib/orderWorkflow";
import { WorkflowOffer } from "./WorkflowOffer";
import { NewPaymentDialog } from "./NewPaymentDialog";
import { NewInvoiceDialog } from "./NewInvoiceDialog";
import type { OrderMoneyContext } from "./OrderPayments";
import { CreateInvoiceDialog } from "@/components/customerInvoices/CreateInvoiceDialog";
import { sendIntent, type InvoiceCandidate } from "@/lib/customerInvoices";
import { withFrom } from "@/lib/breadcrumbs";
import { renderOrderDocument } from "./renderOrderDocument";
import { confirmDialog } from "@/lib/confirm";

/**
 * PRODUCE AND SEND — decision 11's four documents, as one control on the
 * order's command bar.
 *
 * SEND… NO LONGER HAS A WINDOW OF ITS OWN (Mark, 2026-10-29: "we now have two
 * different ways to send emails … combine these into one clean workflow").
 * Send ▸ Quote, Receipt and Kitchen Order open the order's Email tab with the
 * document attached to its compose box (`OrderEmails`), which renders it,
 * mints a quote's link, shows the PDF and sends it through the same function
 * this window did. Send ▸ Invoice still goes through a customer invoice.
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
/** Counts Send… requests, so the same document chosen twice is two requests
 *  to the Email tab rather than one it has already acted on. */
let sendRequests = 0;

export function SendDocument({
  orderId,
  orgId,
  canWrite,
  /** Enough of the order for `lib/orderWorkflow` to reason about what a sent
   *  document implies. */
  workflow,
  /** Today in the org's timezone — the snapshot records when the quote went
   *  out, and a browser's own idea of today is the browser's timezone. */
  today,
  children,
  invoice = null,
  receiptGaps = [],
}: {
  /**
   * Render the three verbs as rows of an `ui/ActionMenu` instead of three
   * buttons (`OrderCommandMenu`, Mark, 2026-09-11). The dialogs, the busy and
   * sent lines and the workflow offer are still drawn here.
   */
  children?: (items: ActionMenuItem[]) => ReactNode;
  workflow: WorkflowOrder;
  orderId: string;
  orgId: string;
  number: string;
  canWrite: boolean;
  orgSettings: Record<string, unknown>;
  today: string;
  /**
   * WHAT THE ORDER STILL LACKS FOR ITS RECEIPT — `lib/receiptReadiness`, from
   * the record and its balance (Mark, 2026-10-20). Send ▸ Receipt and
   * Download ▸ Receipt ask before going ahead when it is not empty; Preview
   * never asks, because previewing commits to nothing.
   */
  receiptGaps?: string[];
  /**
   * SEND ▸ INVOICE GOES THROUGH A CUSTOMER INVOICE (Mark, 2026-09-23, for
   * every order: "the user chooses send invoice, the create invoice dialogue
   * appears … and the user is then taken to the send invoice screen"). With
   * this set, the Invoice row under Send opens `CreateInvoiceDialog` — or,
   * when a live invoice already bills the order, goes straight to that
   * invoice's Send. Preview and Download ▸ Invoice still render the order's
   * own paper.
   */
  invoice?: {
    liveInvoiceId: string | null;
    /** "Invoice 1001", for the Open row. */
    liveInvoiceLabel?: string | null;
    candidate: InvoiceCandidate;
    from: { href: string; label: string };
    /** NEW INVOICE… and NEW PAYMENT… in the Actions menu (Mark, 2026-09-25)
     *  — the Payments tab's two dialogs. Null for a cancelled order. */
    money?: OrderMoneyContext | null;
    /** The order's balance now, to ask Paid in full when cash clears it. */
    balance?: number;
  } | null;
}) {
  const router = useRouter();
  /** The dialog is open, and whether it goes on to Send (Send ▸ Invoice) or
   *  stops at the draft (Create Invoice…). */
  const [creatingInvoice, setCreatingInvoice] = useState<"send" | "draft" | null>(null);
  const [moneyOpen, setMoneyOpen] = useState<"invoice" | "payment" | null>(null);
  const [offerTitle, setOfferTitle] = useState<string | undefined>(undefined);
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<Consequence[] | null>(null);

  if (!canWrite) return children ? <>{children([])}</> : null;

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

  // Shared with `PushOrderToQuickBooks`, which attaches this same document to
  // the QuickBooks invoice — the customer's copy and QuickBooks' copy must be
  // the same paper, so they must come off the same renderer.
  const render = (k: DocumentKind) => renderOrderDocument(supabase, orderId, k, today);

  /**
   * THE INVOICE IS THE INVOICE'S (141). Once the order is on a live invoice,
   * Preview ▸ Invoice and Download ▸ Invoice are that invoice's own PDF — not
   * a second paper drawn from the order, which could say something different.
   * An order not yet invoiced keeps its own (a pro forma, in effect).
   */
  const renderFile = async (k: DocumentKind): Promise<{ blob: Blob; name: string; ofInvoice: boolean }> => {
    if (k === "invoice" && invoice?.liveInvoiceId) {
      const [{ renderInvoicePdf }, { invoiceFileName, invoiceNumberText }] = await Promise.all([
        import("@/components/customerInvoices/SendCustomerInvoice"),
        import("@/lib/customerInvoices"),
      ]);
      const { blob, view, terms } = await renderInvoicePdf(supabase, invoice.liveInvoiceId, today);
      return {
        blob,
        name: invoiceFileName(invoiceNumberText(view.invoice.number, terms, view.invoice.revision), view.invoice.issued_on),
        ofInvoice: true,
      };
    }
    const { blob, order } = await render(k);
    return { blob, name: documentFileName(k, order.number, order.event_date ?? today), ofInvoice: false };
  };

  const preview = (k: DocumentKind) => {
    // Before any await, while the click gesture still counts. The menu closes
    // synchronously in `MenuButton`'s own handler, so this is still inside the
    // gesture that opened the document — see the popup gotcha above.
    const win = openWindowNow();
    return run("preview", async () => {
      try {
        const { blob, name } = await renderFile(k);
        showBlob(win, blob, name);
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
  /**
   * AN INCOMPLETE ORDER'S RECEIPT ASKS FIRST (Mark, 2026-10-20). Both routes
   * out stamp `receipt_sent_at` — downloading is printing, and a printed
   * receipt is a sent one — so both ask. A complete order goes straight
   * through.
   */
  const receiptGoAhead = async (k: DocumentKind, verb: "Send" | "Download") =>
    k !== "receipt" ||
    receiptGaps.length === 0 ||
    confirmDialog({
      title: `${verb} a receipt for an incomplete order?`,
      body: `This order isn’t complete:\n${receiptGaps.map((g) => `· ${g}`).join("\n")}`,
      confirmLabel: `${verb} Anyway`,
    });

  const download = async (k: DocumentKind) => {
    if (!(await receiptGoAhead(k, "Download"))) return;
    return run("download", async () => {
      const { blob, name, ofInvoice } = await renderFile(k);
      downloadBlob(blob, name);

      // A customer invoice's own PDF is stamped by SENDING it (141), which
      // records the send on the invoice as well as the order.
      const column = ofInvoice ? null : DOCUMENT_STAMPS[k];
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
  };

  /** What a document going out implies for the ladder — asked once, after it
   *  has gone. An empty answer opens nothing. */
  function propose(k: DocumentKind) {
    const cs = afterDocumentSent(workflow, k, today);
    if (cs.length > 0) setOffer(cs);
  }

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

  /** Send, with Invoice routed through a customer invoice when one is wired. */
  const sendAct = async (k: DocumentKind) => {
    if (!(await receiptGoAhead(k, "Send"))) return;
    if (k !== "invoice" || !invoice) {
      // To the Email tab, with the document attached there. The number makes
      // choosing the same document twice a second request.
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "emails");
      url.searchParams.set("send", `${k}.${++sendRequests}`);
      router.push(`${url.pathname}${url.search}`);
      return;
    }
    if (invoice.liveInvoiceId) {
      router.push(withFrom(`/customer-invoices/${invoice.liveInvoiceId}?send=${sendIntent()}`, invoice.from));
      return;
    }
    setCreatingInvoice("send");
  };

  /** One verb's menu: the same four documents, each doing that verb. */
  const menu = (act: (k: DocumentKind) => void) =>
    DOCUMENTS.map((d) => ({
      label: DOCUMENT_LABEL[d.kind],
      hint: d.hint,
      onSelect: () => act(d.kind),
    }));

  /** The same three verbs as `ActionMenu` rows, each a submenu of the four
   *  documents. All disable together while one is rendering — one renderer,
   *  one `busy`. */
  const submenu = (act: (k: DocumentKind) => void): ActionMenuItem[] =>
    DOCUMENTS.map((d) => ({
      // Title Case inside the menu (Mark, 2026-09-11) — "Kitchen Order".
      label: DOCUMENT_LABEL[d.kind].replace(/\b\w/g, (c) => c.toUpperCase()),
      onSelect: () => act(d.kind),
      disabled: busy !== null,
    }));
  // THE VERB ALONE (Mark, 2026-09-22). Each of these opens a submenu naming the
  // document — Preview ▸ Quote — so the noun was said twice, and "Preview
  // Order ▸ Kitchen Order" was said twice and disagreed with itself. The
  // ellipsis stays on Send: it is the app's mark for a command that opens
  // something rather than acting on the spot.
  //
  // SEND, NOT EMAIL (Mark, 2026-09-22): "it works better with this new
  // workflow" — since the pay link, sending an invoice is how a customer gets
  // asked to pay, not only how a PDF reaches their inbox.
  const documentItems: ActionMenuItem[] = [
    { label: "Preview", items: submenu(preview) },
    { label: "Download", items: submenu(download) },
    { label: "Send…", items: submenu(sendAct) },
    // THE ORDER'S MONEY (Mark, 2026-09-25: New Payment replaces Create
    // Invoice… here, as it did on the Payments tab). The invoice billing its
    // balance, when there is one, is still a row away.
    ...(invoice?.liveInvoiceId
      ? [
          {
            label: `Open ${invoice.liveInvoiceLabel ?? "Invoice"}`,
            onSelect: () =>
              router.push(withFrom(`/customer-invoices/${invoice.liveInvoiceId}`, invoice.from)),
          },
        ]
      : []),
    ...(invoice?.money
      ? [
          {
            label: "New Invoice…",
            onSelect: () => setMoneyOpen("invoice"),
            disabled: busy !== null,
          },
          {
            label: "New Payment…",
            onSelect: () => setMoneyOpen("payment"),
            disabled: busy !== null,
          },
        ]
      : []),
  ];

  return (
    <>
      {children ? (
        <>
          {children(documentItems)}
          {busy && busy !== "send" ? (
            <p className="text-[13px] text-muted">Rendering…</p>
          ) : null}
          {error && <p className="max-w-sm text-right text-[13px] text-accent">{error}</p>}
        </>
      ) : (
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
          label="Send which document"
          trigger="Send…"
          triggerClassName={BUTTON_CLASS}
          caret
          disabled={busy !== null}
          items={menu(sendAct)}
        />

        {error && <p className="text-[13px] text-accent">{error}</p>}
      </div>
      )}

      {/* Asked AFTER the document has gone, and only about the ladder — the
          date is already recorded by then, by the edge function on the email
          path and by `download` on the other. */}
      {creatingInvoice && invoice && (
        <CreateInvoiceDialog
          candidates={[invoice.candidate]}
          orgId={orgId}
          today={today}
          onClose={() => setCreatingInvoice(null)}
          from={invoice.from}
          thenSend={creatingInvoice === "send"}
        />
      )}

      {moneyOpen === "invoice" && invoice?.money && (
        <NewInvoiceDialog
          orderId={orderId}
          orderNumber={invoice.money.orderNumber}
          total={invoice.money.total}
          unbilled={invoice.money.unbilled}
          hasCustomer={invoice.money.hasCustomer}
          noTaxRate={invoice.money.noTaxRate}
          defaultDepositRate={invoice.money.defaultDepositRate}
          from={invoice.money.from}
          onClose={() => setMoneyOpen(null)}
        />
      )}
      {moneyOpen === "payment" && invoice?.money && (
        <NewPaymentDialog
          orderId={orderId}
          orderNumber={invoice.money.orderNumber}
          openInvoices={invoice.money.openInvoices}
          today={today}
          onClose={() => setMoneyOpen(null)}
          onOrderPayment={(amount) => {
            // OrderPayments' rule: asked only when a payment on the order
            // clears it.
            if ((invoice.balance ?? Infinity) - amount <= 0.005) {
              const cs = afterPaymentSettled(workflow, today);
              if (cs.length > 0) {
                setOfferTitle("Paid in full");
                setOffer(cs);
              }
            }
          }}
        />
      )}

      {offer && (
        <WorkflowOffer
          orderId={orderId}
          consequences={offer}
          onClose={() => {
            setOffer(null);
            setOfferTitle(undefined);
          }}
          title={offerTitle}
        />
      )}
    </>
  );
}
