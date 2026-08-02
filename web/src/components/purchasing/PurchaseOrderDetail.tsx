"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { qty } from "@/lib/catalog";
import {
  canClose,
  closeReadiness,
  money,
  orderedQty,
  orderedTotal,
  priceDiffers,
  receivedQty,
  receivedTotal,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  type PoLine,
  type PoStatus,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import type { SignedAttachment } from "@/lib/attachments";
import { PoAttachments } from "./PoAttachments";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import { Checkbox } from "@/components/ui/Checkbox";
import { PickList } from "@/components/ui/PickList";
import { AddPoLines } from "./AddPoLines";
import { OrderBar } from "./OrderBar";
import { ProcessPo, type ProcessingContext } from "./ProcessPo";

/**
 * Reserve, in the page's flow, exactly the height of a `position: fixed` footer.
 *
 * The Paperwork band is pinned to the bottom of the window, so it takes no
 * space — and two things then need to know how much space it WOULD have taken:
 * the last of the page's content, which must not slide under it, and
 * `useFillViewportHeight`, which sizes the line pane from "everything below me"
 * and would otherwise run the table under the band.
 *
 * Measured, not a constant, for the reason every other measurement on this
 * screen is: the card is 62px with nothing attached and taller with files in
 * it, and a wrong guess is invisible until someone files an invoice. Written
 * straight to the node — no state, so a resize doesn't re-render the line
 * table, and the `set-state-in-effect` lint has nothing to object to. The >1px
 * guard stops the observer reacting to its own write.
 */
function useStickyFooterClearance(
  footerRef: React.RefObject<HTMLElement | null>,
  spacerRef: React.RefObject<HTMLElement | null>
) {
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const spacer = spacerRef.current;
    if (!footer || !spacer) return;

    const measure = () => {
      const target = footer.getBoundingClientRect().height;
      if (Math.abs(parseFloat(spacer.style.height || "0") - target) > 1) {
        spacer.style.height = `${target}px`;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [footerRef, spacerRef]);
}

/**
 * PO detail: what was ordered, what arrived, and the gap between them.
 *
 * The order is EDITABLE (Mark, 2026-07-28 — "I should be able to edit the
 * information in a purchase order, especially before it's sent. At the very
 * least the item amount"). Ordered quantity, price, and the snapshot fields the
 * vendor reads are all inline cells; this screen used to freeze them as
 * "historical record", which was the wrong reading of a draft — a PO is a
 * working document until it's sent, and after it's sent it's still the place a
 * correction has to land. It's deliberately not gated on status: you can
 * already delete a line off a received order, so refusing to fix a typo on one
 * would be a strange place to draw the line. Every write is purchaser+, which
 * is what the RLS policy allows — below that the cells render as plain text
 * rather than offering an edit the database would reject.
 *
 * What stays read-only: the catalog item's NAME (that's the catalog's, not the
 * order's — edit it on the item).
 *
 * RECEIVING is no longer here. It had been a mode on this table — a toggle that
 * swapped two columns in — and being a mode on a record-editing screen was the
 * whole problem (Mark, 2026-07-31). It lives at `[id]/receive` now, writing
 * through the same columns; this screen keeps its inline cells for desk
 * corrections.
 */
export function PurchaseOrderDetail({
  order,
  lines,
  locationCode,
  vendorLink,
  orgId,
  processing,
  attachments,
  attachmentError,
  receiveHref,
}: {
  order: PurchaseOrder;
  lines: PoLine[];
  locationCode: string;
  vendorLink: ReactNode;
  /** Needed to INSERT a line — org_id is not null and RLS checks it. */
  orgId: string;
  /** Null for viewers below purchaser — the card writes, so it isn't shown. */
  processing: ProcessingContext | null;
  /** The order's paperwork, signed by the server (migration 018). */
  attachments: SignedAttachment[];
  /** Non-null if the attachments couldn't be read at all — see the page. */
  attachmentError: string | null;
  /** Link to the receiving screen, stamped with this page's own trail. Built on
   *  the server, which is the only side that has the search params. */
  receiveHref: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const footerSpacerRef = useRef<HTMLDivElement>(null);
  useStickyFooterClearance(footerRef, footerSpacerRef);
  const [checkedLines, setCheckedLines] = useState<Set<string>>(new Set());

  // Line selection (and deletion) is purchaser+ work — `processing` is
  // already null for anyone below that role.
  const canEditLines = processing !== null;

  function toggleLine(id: string) {
    setCheckedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Delete the selected lines. Received quantities are order history, so
   *  the confirm names them before anything irreversible happens. */
  async function deleteLines() {
    const selected = lines.filter((l) => checkedLines.has(l.id));
    const received = selected.filter((l) => l.qty_received !== null);
    const message =
      `Delete ${selected.length} line${selected.length === 1 ? "" : "s"} from ${order.po_number}?` +
      (received.length > 0
        ? `\n\nWARNING: ${received.length} of them ${
            received.length === 1 ? "has" : "have"
          } a received quantity — deleting erases that history permanently.`
        : "\n\nThis cannot be undone.");
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_order_items")
      .delete()
      .in("id", [...checkedLines]);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCheckedLines(new Set());
    router.refresh();
  }

  const ordered = orderedTotal(lines);
  const received = receivedTotal(lines);
  const orderedPackages = orderedQty(lines);
  const receivedPackages = receivedQty(lines);

  async function setStatus(status: PoStatus) {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status })
      .eq("id", order.id);
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  /**
   * Close the order — "reconciled and filed". The confirm NAMES what's still
   * loose and then lets you through anyway; see closeReadiness for why gating
   * would be the wrong call.
   */
  async function close() {
    const caveats = closeReadiness(lines, attachments.length, order.location_id);
    const message =
      `Close ${order.po_number}?` +
      (caveats.length > 0
        ? `\n\nStill unresolved:\n· ${caveats.join("\n· ")}\n\nClosing anyway is fine — it just means you're done with this order.`
        : "\n\nEverything is received, reconciled and filed.");
    if (!window.confirm(message)) return;
    await setStatus("closed");
  }

  const columns: DataColumn<PoLine>[] = [
    // Selection first, purchaser+ only — the delete bar appears once
    // something is checked.
    ...(canEditLines
      ? [
          {
            key: "select",
            label: "",
            width: 40,
            render: (l: PoLine) => (
              <Checkbox
                checked={checkedLines.has(l.id)}
                onChange={() => toggleLine(l.id)}
                label={`select ${l.description ?? l.id}`}
                size={18}
              />
            ),
          } as DataColumn<PoLine>,
        ]
      : []),
    // Type leads (Mark, 2026-07-27 — the table ran off the screen): the item's
    // category is short, repeats down the order, and is what the vendor-facing
    // PDF groups by, so it costs a fraction of what the item NAME cost.
    {
      key: "item_type",
      label: "Type",
      width: 110,
      // Wraps rather than widens — "Flavors and Extracts" doesn't fit on one
      // line and clipping it to "Flavors and …" loses the distinction.
      wrap: true,
      sortValue: (l) => l.vendor_items?.inventory_items?.category ?? null,
      // Type, then Item, then description (Mark, 2026-07-27). A category
      // covers several lines, so the type alone leaves each group in arrival
      // order; the two tiebreaks are the Item cell's own two lines, read top
      // to bottom. Brand last so identical descriptions still land somewhere
      // predictable.
      sortTiebreaks: [
        (l: PoLine) => l.vendor_items?.inventory_items?.name ?? l.description ?? "",
        (l: PoLine) => l.description ?? "",
        (l: PoLine) => l.brand ?? "",
      ],
      render: (l: PoLine) => (
        <span className="text-muted">
          {l.vendor_items?.inventory_items?.category ?? "—"}
        </span>
      ),
    },
    {
      key: "product_id",
      label: "Product ID",
      width: 110,
      sortValue: (l) => l.product_id,
      render: (l) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="product_id"
            value={l.product_id}
            className="text-muted"
          />
        ) : (
          <span className="text-muted">{l.product_id ?? "—"}</span>
        ),
    },
    // What the item IS and what you ordered it as, in one wrapping cell —
    // two columns' worth of information in one column's width. The catalog
    // name leads because that's what you recognise; the snapshot beneath it is
    // what the vendor's invoice will say.
    {
      key: "item",
      // The line's catalog name — the column that IS the row.
      pinned: true,
      label: "Item",
      width: 215,
      wrap: true,
      sortValue: (l) => l.vendor_items?.inventory_items?.name ?? l.description,
      // One item can appear twice under different pack sizes, so the cell's
      // second line breaks the tie here too.
      sortTiebreaks: [(l) => l.description ?? "", (l) => l.brand ?? ""],
      render: (l) => {
        const name = l.vendor_items?.inventory_items?.name ?? null;
        const orderedAs = [l.brand, l.description].filter(Boolean).join(" · ");
        // The second line is the SNAPSHOT — brand and description as they'll
        // print on the vendor's copy — so it's the half that's editable. The
        // name above it belongs to the catalog and isn't the order's to change.
        const snapshot = canEditLines ? (
          <span className="flex items-baseline gap-1 text-xs text-muted">
            <InlineValue
              table="purchase_order_items"
              id={l.id}
              column="brand"
              value={l.brand}
              placeholder="brand"
            />
            <span className="shrink-0 text-faint">·</span>
            <InlineValue
              table="purchase_order_items"
              id={l.id}
              column="description"
              value={l.description}
              placeholder="description"
            />
          </span>
        ) : orderedAs ? (
          <span className="block text-xs text-muted">{orderedAs}</span>
        ) : null;

        // A line whose vendor item is gone still has its snapshot — that's the
        // historical record, so it leads instead of an em dash.
        if (!name) {
          return canEditLines ? (
            snapshot
          ) : (
            <span className="text-muted">{orderedAs || "—"}</span>
          );
        }
        return (
          <span className="block leading-snug">
            <span className="block text-ink">{name}</span>
            {snapshot}
          </span>
        );
      },
    },
    {
      key: "package_desc",
      // Stays FREE TEXT while the catalog's own package field becomes a pick
      // list (Mark's sweep, 2026-07-30) — deliberately, because this column
      // isn't the same kind of thing. Generation snapshots the COMPOSED pack
      // here ("1 × 5 lbs", migration 013), not a token from a vocabulary, so a
      // nine-value list couldn't express what belongs in it and would invite
      // overwriting a correct pack with "CS".
      label: "Pack",
      // 85px clipped every multi-pack to "1 × 5 l…", which is the same
      // information-off-the-edge problem.
      width: 115,
      sortValue: (l) => l.package_desc,
      render: (l) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="package_desc"
            value={l.package_desc}
            className="text-muted"
          />
        ) : (
          <span className="text-muted">{l.package_desc ?? "—"}</span>
        ),
    },
    {
      key: "qty_ordered",
      label: "Ordered",
      width: 95,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered),
      // The item amount — the one Mark named. Editable straight through to
      // sent and received orders: what you're fixing is usually what the
      // vendor actually billed.
      render: (l) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="qty_ordered"
            value={Number(l.qty_ordered)}
            kind="number"
            align="right"
            // NOT NULL in schema 001 — an empty box asks for a number rather
            // than bouncing a Postgres constraint back at you.
            nullable={false}
            className="text-body"
          />
        ) : (
          <span className="text-body">{Number(l.qty_ordered)}</span>
        ),
    },
    {
      key: "qty_received",
      label: "Received",
      width: 100,
      align: "right",
      sortValue: (l) => (l.qty_received === null ? null : Number(l.qty_received)),
      // Receiving is a purchase_order_items write, so it's purchaser+ too —
      // the policy has always said so; the cell now says it as well.
      render: (l) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="qty_received"
            value={l.qty_received}
            kind="number"
            align="right"
            placeholder="—"
          />
        ) : (
          <span className="text-body">
            {l.qty_received === null ? "—" : Number(l.qty_received)}
          </span>
        ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 110,
      align: "right",
      sortValue: (l) => (l.unit_price === null ? null : Number(l.unit_price)),
      render: (l) => {
        const catalog = l.vendor_items?.price;
        // Editing this changes what the ORDER says it paid. The ≠ is a FLAG,
        // not an action: pushing the number the other way onto the catalog is
        // receiving's job now, where it's the second stage of a labelled
        // button rather than a band of its own.
        const marker = priceDiffers(l) && (
          <span
            className="ml-1 shrink-0 text-xs font-semibold text-accent"
            title={`Catalog price is ${money(catalog ?? null)} — settle it on the receiving screen`}
          >
            ≠
          </span>
        );
        if (!canEditLines) {
          return (
            <span className="text-body">
              {money(l.unit_price)}
              {marker}
            </span>
          );
        }
        return (
          <span className="flex items-baseline justify-end">
            <InlineValue
              table="purchase_order_items"
              id={l.id}
              column="unit_price"
              value={l.unit_price}
              kind="number"
              align="right"
              className="min-w-0 flex-1 text-body"
              // Money to read, the raw number to type.
              format={(v) => money(Number(v))}
            />
            {marker}
          </span>
        );
      },
    },
    {
      key: "line_total",
      label: "Line total",
      width: 95,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
      render: (l) => (
        <span className="text-muted">
          {money(Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0))}
        </span>
      ),
    },
    // The note the VENDOR reads — it prints under the description on their copy
    // (§4.9). Snapshotted at generation (migration 015) and editable here
    // precisely so it can be struck off one order without touching the catalog
    // entry every future order inherits (Mark, 2026-07-28).
    {
      key: "notes",
      label: "Note",
      width: 115,
      wrap: true,
      sortValue: (l: PoLine) => l.notes,
      render: (l: PoLine) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="notes"
            value={l.notes}
            placeholder="—"
            className="text-muted"
          />
        ) : (
          <span className="text-muted">{l.notes ?? "—"}</span>
        ),
    },

    {
      key: "discrepancy_note",
      // The line has two notes: this one is receiving's ("short 2 cases") and
      // never leaves the building, while "Note" above goes to the vendor.
      // "Receiving" named the PHASE where it should have named the CONTENT
      // (Mark, 2026-07-31), so it says "Receiving note" now.
      //
      // That rename cost 65px and had to be PAID for, not just typed:
      // ColumnHeader truncates its label, and at this size the words need ~185
      // against the 120 this column had — so it would have shipped the
      // misnaming again as "RECEIVING NO…". Item, Product ID, Note and Line
      // total each gave up a few pixels; the total is still 1290, which is what
      // fits a 1440 window.
      label: "Receiving note",
      width: 185,
      sortValue: (l) => l.discrepancy_note,
      render: (l) =>
        canEditLines ? (
          <InlineValue
            table="purchase_order_items"
            id={l.id}
            column="discrepancy_note"
            value={l.discrepancy_note}
          />
        ) : (
          <span className="text-muted">{l.discrepancy_note ?? "—"}</span>
        ),
    },
  ];

  // --- The three slots of the one box above the lines. See OrderBar. --------

  /* How many DISTINCT products, and how many packages they add up to — the
     second is what you count off the truck, and the line count alone never told
     you (Mark, 2026-07-27). Packages of each line's own vendor item, so a case
     and an each both count as one; that's the intended reading for a delivery
     check. Received is shown only once something has been, so the bar stays
     quiet on a draft. */
  const statement = (
    <span className="text-subtle">
      {lines.length} {lines.length === 1 ? "product" : "products"} ·{" "}
      <span className="tabular-nums text-body">{qty(orderedPackages)}</span>{" "}
      {orderedPackages === 1 ? "package" : "packages"}
      {receivedPackages > 0 && (
        <>
          {" · "}
          <span
            className={`tabular-nums ${
              receivedPackages < orderedPackages ? "text-accent" : "text-body"
            }`}
          >
            {qty(receivedPackages)}
          </span>{" "}
          received
        </>
      )}
    </span>
  );

  const statusControl = (
    <label className="flex items-center gap-2">
      <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
        Status
      </span>
      <PickList
        variant="field"
        ariaLabel="Status"
        value={order.status}
        disabled={busy}
        onPick={(s) => setStatus(s as PoStatus)}
        options={PO_STATUS_ORDER.map((s) => ({
          value: s,
          label: PO_STATUS_LABEL[s],
        }))}
        className="w-40"
      />
    </label>
  );

  const lineActions = (
    <>
      {/* Adding a line is a write to the order, so it's purchaser+ for the same
          reason the delete bar is. */}
      {canEditLines && <AddPoLines order={order} orgId={orgId} lines={lines} />}

      {/* Receiving is a screen, not a button. The old "Receive all as ordered"
          wrote the ordered quantities from here — which is what made reading an
          invoice look pointless — and it wasn't role-gated either, so staff got
          an enabled button whose writes RLS rejected.

          px-6 where its neighbours take px-4 (Mark, 2026-08-02: "a little wider
          so the label isn't truncated"). The trailing ellipsis is NOT
          truncation — it's the house mark for a command that opens something
          rather than acting where it stands, the same one "Add item…" and
          "Email PO…" wear — but read against two neighbours that end in whole
          words it looks like a clipped label, and the extra width makes it read
          as deliberate. */}
      <Link
        href={receiveHref}
        className="flex h-9 items-center border border-ink bg-white px-6 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-ink hover:text-white"
      >
        Receive&hellip;
      </Link>

      {/* The end of the order's life, and the only route to it that means
          anything — the status menu can always set `closed`, but says nothing
          about what closing asserts. */}
      {canEditLines && canClose(order.status) && (
        <button
          disabled={busy}
          onClick={close}
          className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
        >
          Close order
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              {order.po_number}
            </h1>
            <span
              className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[order.status]}`}
            >
              {PO_STATUS_LABEL[order.status]}
            </span>
          </div>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {vendorLink} · {locationCode}
          </p>
        </div>
        {/* Ordered / Received as two Statistics: the header answers "how big
            is this order and did it all arrive" before anything else. */}
        <div className="ml-auto flex items-start gap-8 text-right">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Ordered total
            </div>
            <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(ordered)}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Received total
            </div>
            <div
              className={`text-[22px] font-bold tabular-nums tracking-[-0.01em] ${
                received < ordered - 0.005 ? "text-accent" : ""
              }`}
            >
              {money(received)}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Ordered
        </dt>
        {/* Order date only. Delivery had a SECOND editor here — same column,
            same write, two controls (Mark, 2026-08-02: "can we just use one").
            The one that survived is the bar's, because it's the one carrying
            the "arrives …" suggestion chip; this row would have been the copy
            you fix a date on without ever seeing what the vendor's delivery
            days imply. Order date stays because nothing else edits it. */}
        <dd className="tabular-nums">
          {canEditLines ? (
            <InlineValue
              table="purchase_orders"
              id={order.id}
              column="order_date"
              value={order.order_date}
              kind="date"
              nullable={false}
            />
          ) : (
            order.order_date
          )}
        </dd>
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Sent via
        </dt>
        <dd>{order.sent_via ?? "—"}</dd>
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Notes
        </dt>
        <dd>
          {canEditLines ? (
            <InlineValue
              table="purchase_orders"
              id={order.id}
              column="notes"
              value={order.notes}
              placeholder="none"
            />
          ) : (
            (order.notes ?? "—")
          )}
        </dd>
      </dl>

      {error && <p className="text-sm text-accent">{error}</p>}

      {/* ONE box above the lines (Mark, 2026-08-02). The Process card and the
          line bar were two stacked frames saying things about the same order;
          `OrderBar` is the shared layout and these three are its slots. When
          there's no `processing` — i.e. below purchaser+ — the bar renders here
          instead, without the Delivery editor or any of the send buttons. */}
      {processing ? (
        <ProcessPo
          order={order}
          context={processing}
          statement={statement}
          status={statusControl}
          lineActions={lineActions}
        />
      ) : (
        <OrderBar
          statement={statement}
          trailing={
            <>
              <span className="flex items-center gap-2 text-muted">
                <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                  Delivery
                </span>
                <span className="tabular-nums">{order.delivery_date ?? "—"}</span>
              </span>
              {statusControl}
            </>
          }
          actions={lineActions}
        />
      )}

      {checkedLines.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 border border-ink px-4 py-3 text-sm">
          <span>
            {checkedLines.size} {checkedLines.size === 1 ? "line" : "lines"} selected
          </span>
          <button
            disabled={busy}
            onClick={deleteLines}
            className="h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={() => setCheckedLines(new Set())}
            className="ml-auto text-muted underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Clear
          </button>
        </div>
      )}

      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.id}
        // v4 (2026-07-31): "Receiving" became "Receiving note", which needs
        // 185px where it had 120 — a stored v3 keeps the old width and clips
        // the new label, so the key moves. Reconcile mode's two Invoice columns
        // are gone with it.
        // v3 (2026-07-28): the vendor Note column arrived and every other
        // column gave up a few pixels to pay for it — total still 1290, which
        // is what fits a 1440 window. A stored v2 layout has no width for the
        // new column and keeps the old ones fat, so a new key drops them.
        // (v2 was the same story for v1: Type replaced the item name, and the
        // name moved into the wrapping Item cell.)
        storageKey="rf.purchaseOrderLines.columnWidths.v4"
        columnChooser
        // The lines scroll in their own pane so the page ends where the window
        // does (Mark, 2026-08-02 — on 142-181119-01 the list ran off the
        // screen). `scroll` is all it takes: DataTable then sizes the pane with
        // useFillViewportHeight, which measures its own top AND everything
        // below it — including the clearance left for the pinned Paperwork
        // band. No constant to go stale when the bar above changes height.
        //
        // Past the hook's 256px floor it stops shrinking and lets the page
        // scroll instead, which is the honest answer: a 19-line order in a
        // short window can't have both a readable list and everything else, and
        // a 60px pane would be neither.
        scroll
        // Type first (Mark, 2026-07-27): it groups the order the way the
        // vendor-facing PDF does, so the screen and the document read alike.
        defaultSort={{ key: "item_type" }}
        rowClassName={(l) =>
          l.qty_received !== null && Number(l.qty_received) < Number(l.qty_ordered)
            ? "bg-[var(--rf-yellow-50)]"
            : ""
        }
        empty={<p className="text-sm text-muted">This order has no lines.</p>}
      />

      {/* Clearance for the pinned band below. Its height is MEASURED and
          written here (see useStickyFooterClearance) rather than guessed: the
          card is 62px empty and taller with files in it, and this number is
          also what useFillViewportHeight reads as "everything below the pane",
          so a guess would show up as the line list running under the band. */}
      <div ref={footerSpacerRef} aria-hidden />

      {/* PINNED to the bottom of the window (Mark, 2026-08-02), and last in the
          order of the screen (Mark, earlier the same day — declutter). It used
          to sit with Process, on the reasoning that sending the order and
          filing what came back are the two things you DO to an order while the
          lines are what you read. True, but it put a card you touch once — at
          delivery, then never again — between the Process card and the order
          itself, so every visit paid for it.

          It keeps its BOUNDING BOX (Mark, 2026-08-02, on seeing it as a
          full-bleed band with a top rule: he "preferred the paperwork section
          in a bounding box and the datatable without a bottom border" — the
          band's rule ran the full width directly under the line table, so it
          read as a border the table had grown). So the card draws its own frame
          as it always did, and the fixed wrapper contributes only position and
          an opaque white backdrop — which it still needs, because once the pane
          hits its floor the rows scroll UNDER this.

          Receiving is where this card is actually WORKED anyway: that screen has
          its own document pane, and auto-read-on-attach lives in the shared
          useAttachmentActions, so filing an invoice from there behaves exactly
          as it does from here. This copy is for looking one up later.

          Visible to everyone — the invoice is the answer to "what did we
          actually pay" — but only purchaser+ can add or remove, matching
          migration 018's storage policies. */}
      <div
        ref={footerRef}
        // Full-bleed and opaque, but with NO border of its own — it carries the
        // page's own gutters as padding so the card lines up with the table
        // above it, and the white is what stops rows showing through when the
        // page scrolls behind it.
        //
        // z-30 is the ActionBar's rung: above the table and its sticky column
        // labels (20), below the masthead (50) and anchored panels (70).
        className="fixed inset-x-0 bottom-0 z-30 bg-white px-4 py-4 xl:px-12"
      >
        {attachmentError ? (
          <p className="border border-accent px-4 py-3 text-sm text-accent">
            Could not load this order&rsquo;s paperwork: {attachmentError}
          </p>
        ) : (
          <PoAttachments
            poId={order.id}
            orgId={orgId}
            attachments={attachments}
            canEdit={canEditLines}
          />
        )}
      </div>
    </div>
  );
}
