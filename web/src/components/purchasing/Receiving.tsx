"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ActionBar, ActionBarButton } from "@/components/ui/ActionBar";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { BackToTop } from "@/components/ui/BackToTop";
import type { AttachmentKind, SignedAttachment } from "@/lib/attachments";
import { matchInvoiceToOrder } from "@/lib/invoiceMatch";
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
import type { InvoiceLine } from "@/lib/invoiceExtraction";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";
import {
  clampSplit,
  setReceivingLayout,
  setReceivingSplit,
  useReceivingLayout,
  useReceivingSplit,
} from "@/lib/receivingLayout";
import { AddPoLines } from "./AddPoLines";
import { DocumentPane } from "./DocumentPane";
import { InvoiceSummary } from "./InvoiceSummary";
import { ReceivingRow } from "./ReceivingRow";
import { useAttachmentActions } from "./useAttachmentActions";

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
}: {
  order: PurchaseOrder & { vendors: { id: string; name: string } | null };
  lines: PoLine[];
  locationCode: string;
  orgId: string;
  /** purchaser+. Below that the screen is readable and nothing writes. */
  canReceive: boolean;
  attachments: SignedAttachment[];
  attachmentError: string | null;
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
  const splitRef = useRef<HTMLDivElement>(null);

  const {
    phase,
    busy: attachBusy,
    error: attachError,
    fileRef,
    upload,
    remove,
  } = useAttachmentActions({ poId: order.id, orgId });

  const saving = pending || attachBusy;

  // Derived, never stored. Matching is pure and cheap — 20 lines against 20 —
  // so it happens on every render; nothing about a match is worth persisting,
  // and recomputing means an edited product ID re-matches immediately.
  const source = useMemo(() => latestRead(attachments), [attachments]);
  const match = useMemo(
    () => (source?.extraction ? matchInvoiceToOrder(lines, source.extraction.lines) : null),
    [lines, source]
  );
  const matchByLine = useMemo(
    () => new Map((match?.matches ?? []).map((m) => [m.line.id, m])),
    [match]
  );
  const rows = useMemo(() => receivingOrder(lines), [lines]);
  const toFill = useMemo(
    () => fillable(rows, matchByLine, source?.extraction != null),
    [rows, matchByLine, source]
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
    if (!invoice.product_id) return;
    void write(() =>
      supabase
        .from("purchase_order_items")
        .update({ product_id: invoice.product_id })
        .eq("id", line.id)
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

  async function close() {
    const caveats = closeReadiness(lines, attachments.length, order.location_id);
    const message =
      `Close ${order.po_number}?` +
      (caveats.length > 0
        ? `\n\nStill unresolved:\n· ${caveats.join("\n· ")}\n\nClosing anyway is fine — it just means you're done with this order.`
        : "\n\nEverything is received, reconciled and filed.");
    if (!window.confirm(message)) return;
    await write(() =>
      supabase.from("purchase_orders").update({ status: "closed" }).eq("id", order.id)
    );
  }

  /** Drag the divider. Fractions rather than pixels, so the split survives a
   *  window resize meaning something different. */
  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    const box = splitRef.current?.getBoundingClientRect();
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
      onRemove={(a) => void remove(a)}
      fileRef={fileRef}
      kind={kind}
      onKindChange={setKind}
      stacked={stacked}
    />
  );

  const linesPane = (
    <div className="border border-ink">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 border-ink px-3 py-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </h2>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {lines.filter((l) => l.qty_received !== null).length} counted
        </span>
        {canReceive && (
          <span className="ml-auto">
            <AddPoLines order={order} orgId={orgId} lines={lines} />
          </span>
        )}
      </div>
      <ul>
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
    </div>
  );

  return (
    <>
      <div className="space-y-4 pb-22">
        {/* Header: which order, and the three numbers that say whether it adds up. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold text-ink">Receive {order.po_number}</h1>
          <span
            className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${PO_STATUS_CLASS[order.status]}`}
          >
            {PO_STATUS_LABEL[order.status]}
          </span>
          <span className="text-sm text-muted">
            {order.vendors?.name ?? "—"} · {locationCode}
            {order.delivery_date && ` · due ${order.delivery_date}`}
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
            extraction={source.extraction}
            match={match}
            fileName={source.file_name}
            model={source.extraction_model}
            receivedTotal={received}
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
              {source?.extraction ? "the invoice" : "the ordered quantities"}.
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

        {/* The layout control. A VIEW control, so it lives with the view and
            not in the ActionBar, which carries commands only. */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
            Layout
          </span>
          <LayoutButton current={layout} value="auto" label="Auto" />
          <LayoutButton current={layout} value="split" label="Side by side" />
          <LayoutButton current={layout} value="stacked" label="Stacked" />
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
          <div
            ref={splitRef}
            className={`gap-0 ${layout === "split" ? "flex" : "block xl:flex"}`}
          >
            {/* Document LEFT — source, then destination. Sticky under the
                masthead's MEASURED height so the page keeps one scroller: the
                universal ScrollMemory sees it, and the fixed ActionBar sits
                over a normally-scrolling page. */}
            <div
              style={{ flexBasis: `${split * 100}%` }}
              className={`sticky top-[calc(var(--rf-header-h)+1rem)] shrink-0 grow-0 max-xl:static max-xl:basis-auto ${
                shown
                  ? "h-[calc(100vh-var(--rf-header-h)-9rem)] min-h-64 max-xl:h-[70vh]"
                  : "h-auto max-xl:h-auto"
              }`}
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
            <div className="min-w-0 flex-1 max-xl:mt-4">{linesPane}</div>
          </div>
        )}
      </div>

      {/* Fixed children OUTSIDE the space-y container: space-y puts a bottom
          margin on every child but the last, and for a bottom:0 fixed box it's
          the margin edge that lands on the viewport floor. */}
      {/* Finalize then Close, at the right (Mark, 2026-07-31). The pair reads
          as a form's footer — Finalize is the commit, Close is the way out —
          which is why Finalize sits in the trailing group with it rather than
          with the receive command on the left, where the ActionBar's usual
          act-here / move-there split would have put it. */}
      <ActionBar
        trailing={
          <>
            {canReceive && canClose(order.status) && (
              <ActionBarButton
                disabled={saving}
                onClick={() => void close()}
                title="Mark this order received, reconciled and filed — it names anything still unresolved first."
              >
                Finalize
              </ActionBarButton>
            )}
            <Link
              href={`/purchase-orders/${order.id}`}
              className="flex min-w-40 items-center justify-center px-5 text-center text-[12px] font-semibold uppercase tracking-[0.06em] text-white no-underline hover:bg-neutral-800 xl:min-w-48 xl:px-8"
            >
              Close
            </Link>
          </>
        }
      >
        {canReceive && (
          <ActionBarButton
            disabled={saving || toFill.length === 0}
            onClick={() => void receiveBulk()}
            title="Fills only lines with nothing counted yet. Anything already counted is left alone."
          >
            {toFill.length === 0
              ? "Nothing left to receive"
              : source?.extraction
                ? `Receive ${toFill.length} from invoice`
                : `Receive ${toFill.length} as ordered`}
          </ActionBarButton>
        )}
      </ActionBar>
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
            {match.unmatchedInvoice.map((l, i) => (
              <li
                key={`${l.product_id ?? "?"}-${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-hairline px-3 py-2 text-sm"
              >
                <span className="tabular-nums text-muted">{l.product_id ?? "no number"}</span>
                <span className="text-ink">{l.description}</span>
                <span className="tabular-nums text-muted">
                  {l.qty ?? "—"} × {money(l.unit_price)}
                </span>
                <button
                  type="button"
                  disabled={saving || !l.product_id}
                  onClick={() => matchTo(matching, l)}
                  title={
                    l.product_id
                      ? `Set this line's product ID to ${l.product_id}`
                      : "This invoice line printed no item number, so there's nothing to match on"
                  }
                  className="ml-auto h-9 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
                >
                  Match
                </button>
              </li>
            ))}
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

function LayoutButton({
  current,
  value,
  label,
}: {
  current: string;
  value: "auto" | "split" | "stacked";
  label: string;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      onClick={() => setReceivingLayout(value)}
      aria-pressed={on}
      className={`h-8 border border-ink px-3 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors ${
        on ? "bg-ink text-white" : "bg-white text-ink hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}
