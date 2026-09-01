"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TabPicker } from "@/components/ui/TabPicker";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { Pane, PaneHeader } from "@/components/ui/Pane";
import { BackToTop } from "@/components/ui/BackToTop";
import { useFillToBottom } from "@/lib/fillHeight";
import { useViewportAtLeast } from "@/lib/tableHead";
import {
  attachmentRejection,
  unfiledReadings,
  type AttachmentKind,
  type SignedAttachment,
} from "@/lib/attachments";
import { billsFromReadings, fileReadingsLabel } from "@/lib/invoices";
import { fileReadings } from "@/lib/invoiceFromExtraction";
import { matchInvoiceToOrder, matchesFromLinks } from "@/lib/invoiceMatch";
import type { OrderInvoice } from "@/lib/invoiceQueries";
import {
  canClose,
  closeReadiness,
  money,
  orderedTotal,
  receivedTotal,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  type PoLine,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import {
  fillable,
  latestRead,
  priceAction,
  receivingOrder,
  skuAction,
  type PriceAction,
} from "@/lib/receiving";
import { matchableSku, type InvoiceLine } from "@/lib/invoiceExtraction";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import {
  clampSplit,
  setReceivingLayout,
  setReceivingSplit,
  useReceivingLayout,
  useReceivingSplit,
} from "@/lib/receivingLayout";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { AddPoLines } from "./AddPoLines";
import { DocumentPane } from "./DocumentPane";
import { InvoiceSummary } from "./InvoiceSummary";
import { ReceivingRow } from "./ReceivingRow";
import { useAttachmentActions } from "./useAttachmentActions";
import { confirmDialog, confirmDialogWithOption, splitConfirmMessage } from "@/lib/confirm";

/**
 * Receiving a delivery: the invoice on one side, the order's lines on the
 * other, one row per line.
 *
 * This replaces "reconcile mode" — a toggle on the PO detail table (Mark,
 * 2026-07-31: "as it stands, I would never use this feature"). The engine was
 * fine; the room was wrong. Receiving is a distinct task with a distinct
 * posture — standing at a delivery, holding paper, comparing two documents —
 * and PO detail is a desk screen for editing a record. A dedicated surface
 * writes through exactly the same code; nothing about avoiding duplicate logic
 * required avoiding a duplicate VIEW.
 *
 * Nothing on this screen seeds state from server data, on purpose, so there is
 * no keying trap (CLAUDE.md's rule). The one exception is the document's signed
 * URL, which is held and keyed inside `DocumentPane` for reasons documented
 * there.
 */
export function Receiving({
  order,
  lines,
  locationCode,
  orgId,
  canReceive,
  attachments,
  attachmentError,
  linkedInvoices,
  closeHref,
}: {
  order: PurchaseOrder & { vendors: { id: string; name: string } | null };
  lines: PoLine[];
  locationCode: string;
  orgId: string;
  /** purchaser+. Below that the screen is readable and nothing writes. */
  canReceive: boolean;
  attachments: SignedAttachment[];
  attachmentError: string | null;
  /** Invoices FILED against this order (migration 025). Empty on every order
   *  that predates the Invoices module, which is what makes the fallback to
   *  `latestRead` below the ordinary path rather than a special case. */
  linkedInvoices: OrderInvoice[];
  /** Where the bar's Close goes: the order, carrying the trail that led here.
   *  Built on the server, which is the only side that has the query string. */
  closeHref: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("invoice");
  /** The line ids the last bulk receive filled — what Undo would put back. */
  const [lastBulk, setLastBulk] = useState<string[] | null>(null);
  /** The line being matched by hand, if the pick dialog is open. */
  const [matching, setMatching] = useState<PoLine | null>(null);

  const layout = useReceivingLayout();
  const split = useReceivingSplit();
  // Was `window.innerWidth >= 1280` read inside the measure callback; the hook
  // is the app's own part for the same question and re-renders when the tier
  // actually changes, where the old form only noticed on a resize event.
  const wideEnoughToSplit = useViewportAtLeast(1280);

  const {
    phase,
    busy: attachBusy,
    error: attachError,
    fileRef,
    upload,
    read,
    remove,
    reportError,
  } = useAttachmentActions({
    poId: order.id,
    orgId,
    // So an invoice attached at the delivery is filed as a record against this
    // order's vendor and matched to these lines — the same gesture as on PO
    // detail, which is the reason auto-filing lives in the hook and not in
    // either screen.
    order: {
      id: order.id,
      vendor_id: order.vendor_id,
      location_id: order.location_id,
      lines,
    },
  });

  const saving = pending || attachBusy;

  // Derived, never stored. Matching is pure and cheap — 20 lines against 20 —
  // so it happens on every render; nothing about a match is worth persisting,
  // and recomputing means an edited product ID re-matches immediately.
  const source = useMemo(() => latestRead(attachments), [attachments]);

  /**
   * What the paperwork on this order bills, joined into bills the way filing
   * would join them — one entry per invoice number, its pages unioned.
   *
   * Since filing moved to close (2026-09-01) this is the ordinary state of an
   * order being received: documents read, nothing recorded yet.
   */
  const bills = useMemo(() => billsFromReadings(attachments), [attachments]);

  /**
   * The pairing this screen reconciles against, in three tiers.
   *
   * A FILED invoice still wins, and it is better three ways at once: it honours
   * a manual match someone made standing at the delivery, it survives a re-read
   * of the document, and it sidesteps the duplicate-SKU problem entirely for
   * lines that are already decided. More than one invoice against one order is
   * the BACKORDER case and needs no special handling: each brings only the
   * lines that point at this order, so they concatenate without competing.
   * (Concatenating two ORDERS' lines would be wrong — see matchInvoiceToOrders
   * — but this is one order's worth of billing, arriving in instalments.)
   *
   * Below that, the READINGS, joined into bills and concatenated for the same
   * reason. This tier is what receiving normally runs on now, and it is why
   * `latestRead` alone is no longer enough: a delivery billed on two invoices
   * would otherwise reconcile against whichever was read last and report every
   * line of the other as never billed. Where the two bills name the same SKU
   * the matcher refuses to pair either rather than guessing — the same answer
   * a filed pair gives, since `matchesFromLinks` leaves a second link on one
   * order line unclaimed.
   *
   * `latestRead` remains the floor, and still earns its place: it is the only
   * tier that covers a document read under some other kind — a packing slip
   * somebody had read — which is not a bill and so never becomes one above.
   */
  const match = useMemo(() => {
    const filed = linkedInvoices.flatMap((i) => i.lines);
    if (filed.length > 0) return matchesFromLinks(lines, filed);
    const billed = bills.flatMap((b) => b.lines);
    if (billed.length > 0) return matchInvoiceToOrder(lines, billed);
    if (source?.extraction) return matchInvoiceToOrder(lines, source.extraction.lines);
    return null;
  }, [lines, source, linkedInvoices, bills]);

  /**
   * How many BILLS the rows below are reconciled against — what the band's
   * "n invoices on this order" chip counts.
   *
   * It has to name the tier `match` actually came from. Counting the filed
   * invoices unconditionally would say "1" on a delivery being reconciled
   * against two unfiled readings, which is the one case the chip exists for.
   */
  const billCount = linkedInvoices.some((i) => i.lines.length > 0)
    ? linkedInvoices.length
    : bills.length;

  /** Whether anything at all is billed — what the fill control's wording and
   *  `fillable`'s never-overwrite rule both turn on. */
  const hasBilling = linkedInvoices.some((i) => i.lines.length > 0) ||
    source?.extraction != null;
  const matchByLine = useMemo(
    () => new Map((match?.matches ?? []).map((m) => [m.line.id, m])),
    [match]
  );
  const rows = useMemo(() => receivingOrder(lines), [lines]);
  const toFill = useMemo(
    () => fillable(rows, matchByLine, hasBilling),
    [rows, matchByLine, hasBilling]
  );

  // `pickedId` falls through to the most recently read document, so an attach
  // that auto-reads moves the pane to the new invoice with no manual step.
  const shown =
    attachments.find((a) => a.id === pickedId) ?? source ?? attachments[0] ?? null;

  const ordered = orderedTotal(lines);
  const received = receivedTotal(lines);
  const stacked = layout === "stacked";

  async function write(
    run: () => PromiseLike<{ error: { message: string } | null }>,
    after?: () => void
  ) {
    setError(null);
    const { error: writeError } = await run();
    if (writeError) {
      setError(writeError.message);
      return false;
    }
    after?.();
    startTransition(() => router.refresh());
    return true;
  }

  /** A drop the zone refused. Reported through the attachment hook rather than
   *  this screen's own error state, so a refused drop reads identically here
   *  and on PO detail's Paperwork card — the same argument auto-read is in that
   *  hook for. */
  function rejectDrop(rejected: File[]) {
    reportError(attachmentRejection(rejected));
  }

  function setReceived(line: PoLine, value: number | null) {
    setLastBulk(null);
    void write(() =>
      supabase
        .from("purchase_order_items")
        .update({ qty_received: value })
        .eq("id", line.id)
    );
  }

  /**
   * The one receive control. It uses the invoice's quantities when an invoice
   * has been read and the ordered quantities when it hasn't, and it fills only
   * lines that have NO quantity recorded — a short case someone counted is a
   * measurement, and a bulk button must not overwrite one with a machine's
   * reading of a photograph.
   *
   * `Promise.all` rather than a sequential loop that aborts on the first error:
   * twenty sequential round trips to hosted Supabase is seconds of standing
   * there, and aborting halfway leaves you not knowing which lines landed. The
   * refresh runs either way, so the screen shows what actually happened.
   */
  async function receiveBulk() {
    if (toFill.length === 0) return;
    setError(null);
    const results = await Promise.all(
      toFill.map(({ line, qty }) =>
        supabase
          .from("purchase_order_items")
          .update({ qty_received: qty })
          .eq("id", line.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
    setLastBulk(
      toFill.filter((_, i) => !results[i].error).map(({ line }) => line.id)
    );
    startTransition(() => router.refresh());
  }

  /**
   * Put back exactly what the last bulk receive set, and nothing else.
   *
   * Deliberately not a general undo stack: this is the only action on the
   * screen that changes twenty rows on one tap, and it's the one people
   * hesitate over. Reverting one known batch by id is honest; anything broader
   * would have to guess what a person meant.
   */
  async function undoBulk() {
    if (!lastBulk?.length) return;
    setError(null);
    const { error: undoError } = await supabase
      .from("purchase_order_items")
      .update({ qty_received: null })
      .in("id", lastBulk);
    if (undoError) setError(undoError.message);
    setLastBulk(null);
    startTransition(() => router.refresh());
  }

  /** The two-stage price button. Stage 1 writes the order, stage 2 the catalog
   *  — or this location's override row, which is the price actually in force
   *  (design rule 6). The DB trigger writes price history; never log here. */
  function applyPrice(line: PoLine, action: PriceAction) {
    if (action.stage === "po") {
      void write(() =>
        supabase
          .from("purchase_order_items")
          .update({ unit_price: action.price })
          .eq("id", line.id)
      );
      return;
    }
    if (!line.vendor_items) return;
    if (action.hasOverride) {
      // Keyed (vendor_item_id, location_id) — the table has no surrogate id.
      void write(() =>
        supabase
          .from("vendor_item_location_prices")
          .update({ price: action.price })
          .eq("vendor_item_id", line.vendor_items!.id)
          .eq("location_id", order.location_id)
      );
      return;
    }
    void write(() =>
      supabase
        .from("vendor_items")
        .update({ price: action.price })
        .eq("id", line.vendor_items!.id)
    );
  }

  /**
   * Pair this line with an invoice line the matcher couldn't place, by taking
   * the vendor's item number onto the line.
   *
   * It writes `product_id` rather than recording the pairing somewhere, because
   * the pairing isn't the problem — the STALE SKU is. BakeMark billed 50021
   * against the 08779 we ordered under (and renumbered two other items on the
   * same invoice), so once the line carries 50021 the ordinary SKU join finds
   * it, survives a reload, and needs no column of its own. Editing a line's
   * product ID is already established policy on PO detail (Mark, 2026-07-28)
   * and deliberately isn't gated on status.
   */
  function matchTo(line: PoLine, invoice: InvoiceLine) {
    setMatching(null);
    // Either number will do. On an invoice that prints two identifier columns
    // the one we ordered under can be in either, so refusing the second here
    // would refuse the pairing on exactly the invoices that need it most.
    const sku = matchableSku(invoice);
    if (!sku) return;
    void write(() =>
      supabase.from("purchase_order_items").update({ product_id: sku }).eq("id", line.id)
    );
  }

  /**
   * Put the invoice's delivery date on the order.
   *
   * It writes `delivery_date` — the same column the vendor PDF prints in its
   * Delivery block and the PO list shows — rather than a received-date column
   * of its own (Mark, 2026-08-03, choosing that over a migration). So on an
   * order that was emailed, this can leave the record saying a different day
   * than the document the vendor holds. That's accepted: by the time you're
   * standing at the delivery, the day it actually came is the more useful of
   * the two answers, and it's the one every later reader wants.
   *
   * Which is exactly why nothing here happens on its own. The date is shown
   * with the date it would replace, and a person taps the arrow.
   */
  function takeDeliveryDate(date: string) {
    void write(() =>
      supabase.from("purchase_orders").update({ delivery_date: date }).eq("id", order.id)
    );
  }

  /** Stage 2: teach the CATALOG the vendor's new number, so the next order
   *  matches without anyone doing this again. */
  function adoptSku(line: PoLine) {
    if (!line.vendor_items || !line.product_id) return;
    void write(() =>
      supabase
        .from("vendor_items")
        .update({ product_id: line.product_id })
        .eq("id", line.vendor_items!.id)
    );
  }

  /**
   * Finalize: close the order, then LEAVE (Mark, 2026-08-03).
   *
   * Finalizing is the end of the task, and the screen it ends has nothing left
   * to say — every control on it is for a delivery you've just declared done.
   * Staying put made you press Close afterwards to get the same place, which is
   * two taps for one decision.
   *
   * `.select("id")` is not decoration. An update that matches no RLS policy
   * removes nothing and PostgREST returns NO error, so a bare update reports a
   * cheerful success — and now that success NAVIGATES, which would read as the
   * order having been closed. Same lesson as the employee delete: make the
   * write tell you what it actually did.
   */
  async function close() {
    // The paperwork this close can turn into a bill.
    //
    // Read FIRST, because the confirm is composed out of it twice: it decides
    // whether the tick box appears, and it tells `closeReadiness` not to name
    // a gap that box is about to settle.
    const unfiled = unfiledReadings(attachments);
    const caveats = closeReadiness(
      lines,
      attachments.length,
      order.location_id,
      linkedInvoices.length,
      // What the tick box below is about to offer, so the confirm doesn't name
      // a gap it is closing in the same breath.
      unfiled.length
    );
    const message =
      `Close ${order.po_number}?` +
      (caveats.length > 0
        ? `\n\nStill unresolved:\n· ${caveats.join("\n· ")}\n\nClosing anyway is fine — it just means you're done with this order.`
        : "\n\nEverything is received, reconciled and filed.");

    // WHERE A BILL COMES FROM (Mark, 2026-08-27: "after we reconcile/close a
    // PO, the app could ask 'Generate an Invoice for Purchase Order X?'"; and
    // 2026-09-01, making this the ordinary route rather than a catch-up:
    // "created only once a purchase order is reconciled and closed … perhaps
    // with a confirmation dialogue right before so the user can choose not to
    // create an invoice"). Offered as a ticked box beside the question, not as
    // a second dialog — `whatFollows`' shape, and the reason it is one line
    // rather than a chain: two panels for one act reads as the app
    // second-guessing the answer you just gave. Ticked, because recording the
    // bill is what usually happens; untickable, because the person closing the
    // order is the one who knows when it isn't.
    //
    // FILE, never GENERATE. When a document is on the order the bill exists and
    // this records it; when none is, there is nothing to record and no offer is
    // made. Inventing a bill from the received quantities was considered and
    // dropped (Mark, same day): the orders with no paperwork are internal
    // transfers and prepaid online purchases, which do not produce one.
    const outcome = unfiled.length
      ? await confirmDialogWithOption({
          ...splitConfirmMessage(message),
          confirmLabel: "Close order",
          option: { label: fileReadingsLabel(unfiled), defaultChecked: true },
        })
      : {
          ok: await confirmDialog({
            ...splitConfirmMessage(message),
            confirmLabel: "Close order",
          }),
          option: false,
        };
    if (!outcome.ok) return;
    setError(null);
    const { data, error: closeError } = await supabase
      .from("purchase_orders")
      .update({ status: "closed" })
      .eq("id", order.id)
      .select("id");
    if (closeError) {
      setError(closeError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("That didn't close — you may not have permission to close this order.");
      return;
    }

    // Filing runs AFTER the close and cannot undo it — the house rule for a
    // chained write in this module (the upload stands if the read fails, the
    // read stands if filing fails, a sent email stands if its bookkeeping
    // does not). A failure here therefore reports and STAYS on the order,
    // where the paperwork and the offer both still are, rather than navigating
    // away from a message nobody would see.
    if (outcome.option) {
      const filed = await fileReadings(supabase, {
        orgId,
        order: { id: order.id, vendor_id: order.vendor_id, location_id: order.location_id, lines },
        readings: unfiled.map((a) => ({ id: a.id, extraction: a.extraction! })),
      });
      if (filed.error) {
        setError(`${order.po_number} is closed, but filing the paperwork failed: ${filed.error}`);
        router.refresh();
        return;
      }
    }

    // No `router.refresh()` first: the order screen is a fresh server render
    // and will show the closed status by itself.
    startTransition(() => router.push(closeHref));
  }

  /**
   * Size the split row to the space actually left below it.
   *
   * This can't be a CSS constant. `100vh - header - <a guess>` was the first
   * attempt and it ran the columns off the bottom of the window (Mark,
   * 2026-07-31), because what sits ABOVE the row varies: the invoice band grows
   * with the reader's notes and the billed-but-not-ordered list, and the
   * progress and undo bands come and go. Only the row knows where it starts.
   *
   * Measured, then written straight to the node — no state, so a resize doesn't
   * re-render nineteen rows, and no setState-in-an-effect for the lint to
   * object to.
   *
   * What's BELOW the row is measured too, rather than assumed. Hard-coding the
   * container's old `pb-22` left ~56px of empty page still scrolling, because the
   * app layout's own `py-8` sits under that as well. Subtracting whatever
   * actually follows the row makes the page land exactly one viewport tall, so
   * nothing scrolls and the measurement can't drift underneath itself.
   */
  const rowRef = useRef<HTMLDivElement>(null);
  // Stacked — chosen, or implied by a window narrower than `xl` — sizes itself
  // and scrolls the page, which is the point of stacking.
  const splitting = layout === "split" || (layout === "auto" && wideEnoughToSplit);
  useFillToBottom(rowRef, splitting);

  /** Drag the divider. Fractions rather than pixels, so the split survives a
   *  window resize meaning something different. */
  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    const box = rowRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (e: PointerEvent) =>
      setReceivingSplit(clampSplit((e.clientX - box.left) / box.width));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const documentPane = (
    <DocumentPane
      attachment={shown}
      attachments={attachments}
      canEdit={canReceive}
      busy={saving}
      onPick={setPickedId}
      onFilesPicked={(files) => void upload(files, kind)}
      onDropRejected={rejectDrop}
      onRead={(a) => void read(a)}
      onRemove={(a) => void remove(a)}
      fileRef={fileRef}
      kind={kind}
      onKindChange={setKind}
      stacked={stacked}
    />
  );

  // `h-full` + an inner scroller so the lines column matches the document
  // column's height instead of running past it, and long orders scroll INSIDE
  // their own pane rather than dragging the whole page (Mark, 2026-07-31). The
  // header band stays put while the rows move under it.
  const linesPane = (
    <Pane>
      {/* The same band as the document column's — one component, so the two
          rules across the top of the screen can't drift apart again. */}
      <PaneHeader>
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </h2>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {lines.filter((l) => l.qty_received !== null).length} counted
        </span>
        {/* The bulk receive sits with the rows it fills (Mark, 2026-08-04,
            placing it "next to the add item button" when the ActionBar went).
            It was the ActionBar's leading command; with no bar, the honest home
            for a verb is the thing it acts on. Both are `shrink-0` in a band
            that cannot wrap, so at a hard-dragged narrow split they clip —
            the same edge the document band has. */}
        {canReceive && (
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <button
              type="button"
              disabled={saving || toFill.length === 0}
              onClick={() => void receiveBulk()}
              title="Fills only lines with nothing counted yet. Anything already counted is left alone."
              className="h-9 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {toFill.length === 0
                ? "All counted"
                : hasBilling
                  ? `Receive ${toFill.length} from invoice`
                  : `Receive ${toFill.length} as ordered`}
            </button>
            <AddPoLines order={order} orgId={orgId} lines={lines} />
          </span>
        )}
      </PaneHeader>
      {/* min-h-0 is what lets a flex child actually shrink and scroll — without
          it the ul takes its content height and overflows the box instead. */}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((line) => (
          <ReceivingRow
            key={line.id}
            line={line}
            match={matchByLine.get(line.id)}
            action={priceAction(line, matchByLine.get(line.id), order.location_id)}
            sku={skuAction(line)}
            canMatch={(match?.unmatchedInvoice.length ?? 0) > 0}
            canReceive={canReceive}
            saving={saving}
            onSetReceived={(value) => setReceived(line, value)}
            onPrice={(action) => applyPrice(line, action)}
            onMatch={() => setMatching(line)}
            onAdoptSku={() => adoptSku(line)}
          />
        ))}
      </ul>
      {lines.length === 0 && (
        <p className="px-3 py-6 text-sm text-muted">This order has no lines.</p>
      )}
    </Pane>
  );

  return (
    <>
      {/* No `pb-*` here. Every value it ever held was clearance for the
          fixed ActionBar; with the footer in the flow there is nothing to
          scroll past, and the app layout's own py-8 is the breathing room. */}
      <div className="space-y-4">
        {/* Header: which order, and the three numbers that say whether it adds up. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold text-ink">Receive {order.po_number}</h1>
          <span
            className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${PO_STATUS_CLASS[order.status]}`}
          >
            {PO_STATUS_LABEL[order.status]}
          </span>
          {/* No date here any more: `delivery_date` now has a labelled, editable
              home on the strip below, and the same value reading "due 08-01"
              here and "Received 08-01" there is two claims about one column. */}
          <span className="text-sm text-muted">
            {order.vendors?.name ?? "—"} · {locationCode}
          </span>
          <span className="ml-auto flex items-baseline gap-4 tabular-nums">
            <Stat label="Ordered" value={money(ordered)} />
            <Stat
              label="Received"
              value={money(received)}
              accent={received < ordered - 0.005}
            />
          </span>
        </div>

        {attachmentError && (
          <p className="border border-accent px-4 py-3 text-sm text-accent">
            Could not read this order&rsquo;s paperwork: {attachmentError}
          </p>
        )}
        {phase.kind !== "idle" && (
          <ProgressBand
            label={phase.label}
            note={
              phase.kind === "reading"
                ? "Reading an invoice takes about half a minute. You can keep counting."
                : undefined
            }
          />
        )}
        {(error || attachError) && (
          <p className="text-sm text-accent">{error ?? attachError}</p>
        )}

        {source?.extraction && match && (
          <InvoiceSummary
            invoiceCount={billCount}
            poNumber={order.po_number}
            vendorName={order.vendors?.name ?? null}
            extraction={source.extraction}
            match={match}
            fileName={source.file_name}
            model={source.extraction_model}
            receivedTotal={received}
            deliveryDate={order.delivery_date}
            onTakeDeliveryDate={canReceive ? takeDeliveryDate : undefined}
            saving={saving}
            addItemSlot={
              canReceive ? (
                <AddPoLines order={order} orgId={orgId} lines={lines} />
              ) : undefined
            }
          />
        )}

        {lastBulk && lastBulk.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 border border-ink bg-mark-fill px-4 py-2 text-sm text-ink">
            <span>
              Filled {lastBulk.length} {lastBulk.length === 1 ? "line" : "lines"} from{" "}
              {hasBilling ? "the invoice" : "the ordered quantities"}.
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void undoBulk()}
              className="ml-auto h-8 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
            >
              Undo
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* The day it arrived, editable, sitting where you'd check it — the
              → in the invoice band writes this same column, and a machine's
              reading of a photograph is exactly the kind of value you want to
              see in a field rather than take on trust (Mark, 2026-08-03).

              It's `delivery_date`, which PO detail labels "Delivery" and the
              vendor PDF prints as such. Here it's "Received", because that is
              what the column MEANS on a screen where you're recording an
              arrival — one column, and the honest label for it depends on
              which end of the order you're standing at. */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Received
            </span>
            {canReceive ? (
              // Width-boxed: this sits in a shrink-to-fit strip rather than a
              // grid track, so a boxed field's `w-full` needs something
              // definite to resolve against.
              <span className="block w-36">
                <InlineValue
                  boxed={BOXED_FIELDS}
                  table="purchase_orders"
                  id={order.id}
                  column="delivery_date"
                  value={order.delivery_date}
                  kind="date"
                />
              </span>
            ) : (
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                {order.delivery_date ?? "—"}
              </span>
            )}
          </div>

          {/* The layout control. A VIEW control, so it lives with the view
              rather than with the footer's commands. `ml-auto` puts
              it against the right edge (Mark, 2026-08-03) — it's the one thing
              on this strip you set once and stop touching, so it gets out of
              the way of the field you actually check. */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
              Layout
            </span>
            {/* size="sm": this sits beside a fixed-height pane band. */}
            <TabPicker
              ariaLabel="Layout"
              size="sm"
              value={layout}
              onChange={setReceivingLayout}
              options={[
                { key: "auto", label: "Auto" },
                { key: "split", label: "Side by side" },
                { key: "stacked", label: "Stacked" },
              ]}
            />
          </div>
        </div>

        {stacked ? (
          // Stacked: document on top, lines beneath. Both reachable by
          // scrolling, so nothing is hidden and there is no mode to be lost in
          // — which is why this beats a Lines/Invoice toggle at iPad widths.
          <div className="space-y-4">
            {documentPane}
            {linesPane}
          </div>
        ) : (
          /* Document LEFT — source, then destination. ONE height for the whole
             row, so the two columns end level; each column then scrolls its own
             contents rather than the page scrolling both (Mark, 2026-07-31 —
             "the purchase order column should be in a scroll view"). Below xl
             the row is a plain block and both panes size themselves, since
             stacking is the point there. */
          <div
            ref={rowRef}
            className={`gap-0 ${layout === "split" ? "flex" : "block xl:flex"}`}
          >
            <div
              style={{ flexBasis: `${split * 100}%` }}
              // An EMPTY pane still matches the column when split (that's the
              // point), but must not reserve 70vh of nothing to scroll past
              // when stacked.
              //
              // `min-w-0` is not decoration. A flex item's automatic minimum
              // size is its MIN-CONTENT, which outranks `flex-basis`, and the
              // header's row of controls made that 780px — so the document
              // column silently took 58% of a 50% split the moment its band
              // stopped wrapping. The lines side has carried the same class
              // since it was written.
              className={`min-w-0 shrink-0 grow-0 max-xl:basis-auto ${
                layout === "split" ? "h-full" : "xl:h-full"
              } ${shown ? "max-xl:h-[70vh]" : "max-xl:h-auto"}`}
            >
              {documentPane}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the document"
              onPointerDown={startDrag}
              className="mx-1 w-2 shrink-0 cursor-col-resize touch-none self-stretch bg-transparent hover:bg-hairline max-xl:hidden"
            />
            <div
              className={`min-w-0 flex-1 max-xl:mt-4 ${
                layout === "split" ? "h-full" : "xl:h-full"
              }`}
            >
              {linesPane}
            </div>
          </div>
        )}
        {/* The footer, in the page's own flow — no black bar (Mark, 2026-08-04:
            "get rid of the black band at the bottom… just two buttons").
            It is the LAST child of the space-y container, which matters: the
            split row measures whatever follows it, so a footer here is counted
            automatically and the columns still end level. A fixed bar had to
            live outside this container and be paid for with `pb-22`, and that
            clearance is gone with it.

            COMPLETE IS BLACK, and that is a real exception to "every button is
            white; only a set filter is black". It's the panel-commit exception
            (`DIALOG_COMMIT_CLASS`) applied to a screen that behaves like one:
            receiving produces a single outcome, and this row is a text-weight
            escape beside the commit rather than a row of peer buttons — which
            is precisely the distinction that rule turns on. Mark asked for it
            (2026-08-04) and it is the same two-weight footer, so the rule is
            being applied, not bent. Note the STATUS is still `closed` and the
            chip still reads Closed; only the verb on this button changed. */}
        <div className="flex items-center justify-end gap-6">
          {/* The SAME href as the order's breadcrumb, trail and all. It was a
              bare `/purchase-orders/{id}`, which threw the trail away and then
              quietly shortened it for good: leaving by this button gave a
              detail screen that no longer knew it came from the list, and its
              Receive link could only stamp one crumb, so the next visit here
              went back one place instead of two (Mark, 2026-07-31 — "the
              breadcrumb only goes back one place. Is that intentional?").
              Breadcrumbs live in the query string precisely so every link has
              to carry them. */}
          <Link
            href={closeHref}
            className="inline-flex h-9 items-center border border-ink bg-white px-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-ink hover:text-white"
          >
            Close
          </Link>
          {canReceive && canClose(order.status) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void close()}
              title="Mark this order received, reconciled and filed — it names anything still unresolved first."
              className={DIALOG_COMMIT_CLASS}
            >
              Complete
            </button>
          )}
        </div>
      </div>

      <BackToTop />

      {matching && match && (
        <Dialog
          title={`Match ${matching.vendor_items?.inventory_items?.name ?? matching.description ?? "this line"}`}
          onClose={() => setMatching(null)}
          width="max-w-2xl"
          footer={
            <button
              type="button"
              onClick={() => setMatching(null)}
              className={DIALOG_CANCEL_CLASS}
            >
              Cancel
            </button>
          }
        >
          <p className="mb-4 text-sm text-muted">
            These invoice lines paired with nothing on this order — usually because
            the vendor renumbered the item. Picking one sets this line&rsquo;s product
            ID to the vendor&rsquo;s, which is what makes the two sides join.
          </p>
          <ul className="space-y-2">
            {match.unmatchedInvoice.map((l, i) => {
              const sku = matchableSku(l);
              return (
                <li
                  key={`${sku ?? "?"}-${i}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-hairline px-3 py-2 text-sm"
                >
                  <span className="tabular-nums text-muted">{sku ?? "no number"}</span>
                  <span className="text-ink">{l.description}</span>
                  <span className="tabular-nums text-muted">
                    {l.qty ?? "—"} × {money(l.unit_price)}
                  </span>
                  {/* A line with no number at all can't be paired, because
                      pairing IS copying a number. Said on screen rather than in
                      a tooltip — a disabled button explains itself only on
                      hover, and the iPad this is used on has none (Mark,
                      2026-08-04: "why are they disabled?"). */}
                  {sku ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => matchTo(matching, l)}
                      title={`Set this line's product ID to ${sku}`}
                      className="ml-auto h-9 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
                    >
                      Match
                    </button>
                  ) : (
                    <span className="ml-auto text-[11px] uppercase tracking-[0.06em] text-subtle">
                      no item number to match on
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Dialog>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">{label}</span>
      <span className={`text-[15px] ${accent ? "text-accent" : "text-ink"}`}>{value}</span>
    </span>
  );
}

