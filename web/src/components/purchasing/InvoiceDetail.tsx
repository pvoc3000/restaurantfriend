"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { withFrom } from "@/lib/breadcrumbs";
import { useFillToBottom } from "@/lib/fillHeight";
import { useViewportAtLeast } from "@/lib/tableHead";
import { money } from "@/lib/purchaseOrders";
import {
  agingBucket,
  amountReconciliation,
  approvalReadiness,
  findPossibleDuplicates,
  lineSumReconciliation,
  matchPrintedPoNumber,
  printedPoNumbers,
  printedVendorDisagreement,
  signedTotal,
  lineExtended,
  rescaledExtended,
  computedAmounts,
  totalDisagreesWithDocument,
  toInvoiceLine,
  AGING_LABEL,
  INVOICE_STATUS_CLASS,
  INVOICE_STATUS_LABEL,
  type LinkedOrder,
  type VendorInvoice,
  type VendorInvoiceLine,
} from "@/lib/invoices";
import { matchInvoiceToOrder, matchesFromLinks } from "@/lib/invoiceMatch";
import type { InvoiceLine } from "@/lib/invoiceExtraction";
import { RowMenu } from "@/components/ui/RowMenu";
import { LinkToPo, type LinkCandidate } from "./LinkToPo";
import type { LinkedPurchaseOrder } from "@/lib/invoiceQueries";
import type { SignedAttachment } from "@/lib/attachments";
import { DocumentPane } from "./DocumentPane";
import { useAttachmentActions } from "./useAttachmentActions";
import { InvoiceFooter } from "./InvoiceFooter";
import { PushToQuickBooks } from "./PushToQuickBooks";
import { attachmentRejection, type AttachmentKind } from "@/lib/attachments";
import {
  handAmendment,
  amendedTotal,
  invoiceCharges,
} from "@/lib/invoiceExtraction";

type InvoiceRecord = VendorInvoice & {
  vendors: { id: string; name: string; order_type: string } | null;
};

const INVOICE_LINE_WIDTHS_KEY = "rf.invoiceLines.columnWidths.v1";

/**
 * The label column for the Bill and Amounts lists.
 *
 * 8rem, not the 9rem a full-width `dl` uses: side by side inside the record
 * column these boxes are ~330px at `xl`, and 144px of that spent on a label
 * leaves a vendor name nowhere to go.
 *
 * Not 7rem either, which was the first try: "Invoice number" wrapped to two
 * lines at 112px while every other label sat on one, so that row alone stood
 * 17px taller and the column read as ragged beside Amounts. 128px clears it —
 * measured, not guessed.
 */
const DL_CLASS = "grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm";

/**
 * One invoice: what we were billed, what it belongs to, and whether it should
 * be paid.
 *
 * LAYOUT — document left, record right, ONE viewport, with the buttons in a
 * footer both columns end at (Mark, 2026-08-05: "the buttons under the invoice
 * item datatable should be in the footer area of the screen. The bottoms of the
 * pdf preview pane and the invoice items datatable should extend to the top of
 * the footer"). The same shape as the receiving screen, and it now shares that
 * screen's measuring hook rather than owning a second copy — see
 * lib/fillHeight.
 *
 * Within the record column, Bill and Amounts pair up and Purchase orders sits
 * under them, all fixed; the lines table takes whatever is left and scrolls its
 * own rows under its own labels.
 *
 * This started as a page that scrolled, on the reasoning that a desk screen
 * isn't a standing task. That was wrong about the READER rather than about the
 * task: an invoice is a document you check against a record, and a page three
 * screens tall means the thing you are checking has scrolled away. Measured on
 * a 15-line invoice at 1280×720: 2,463px → one viewport.
 */
export function InvoiceDetail({
  invoice,
  lines,
  linkedOrders,
  linkError,
  attachments,
  documentError,
  duplicateCandidates,
  linkCandidates,
  locationCode,
  orgId,
  vendors,
  locations,
  canEdit,
  canApprove,
  selfHref,
  closeHref,
}: {
  invoice: InvoiceRecord;
  lines: VendorInvoiceLine[];
  linkedOrders: LinkedPurchaseOrder[];
  linkError: string | null;
  attachments: SignedAttachment[];
  documentError: string | null;
  duplicateCandidates: VendorInvoice[];
  /** This vendor's recent orders at this location, for Link to PO…. */
  linkCandidates: LinkCandidate[];
  locationCode: string;
  orgId: string;
  vendors: { id: string; name: string; inactive?: boolean }[];
  locations: { id: string; code: string; name: string }[];
  canEdit: boolean;
  canApprove: boolean;
  selfHref: string;
  closeHref: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [settingTotal, setSettingTotal] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("invoice");

  // The split row fills the window down to the footer; below `xl` the columns
  // stack and the page scrolls instead, which is what stacking is for.
  const rowRef = useRef<HTMLDivElement>(null);
  // The floor is what stops the lines table being squeezed out of existence,
  // and it is a MEASUREMENT of what stands above the table in this column.
  //
  // It was 660, taken when Bill+Amounts AND Purchase orders were both here.
  // Purchase orders moved under the document on 2026-09-02, and a floor left
  // at the old figure stopped being a floor and became the height: at 1440×900
  // the row wanted 602 and took 660, so the page scrolled by 58px on a screen
  // built not to. Re-measured with the amendment band showing — its worst
  // case — Bill+Amounts is 351 and the gap 40, so 560 leaves the table ~170px
  // and the row still fits a 900px window. Below it the page scrolls instead,
  // the same trade receiving makes with its own 280.
  useFillToBottom(rowRef, useViewportAtLeast(1280), 560);

  const {
    phase,
    busy,
    error: attachError,
    fileRef,
    upload,
    read,
    remove,
    reportError,
  } = useAttachmentActions({ poId: null, orgId, invoiceId: invoice.id });

  const shown =
    attachments.find((a) => a.id === shownId) ?? attachments[0] ?? null;

  // The three-way match, per linked order. `matchesFromLinks` prefers the
  // stored pairing over a fresh one, so a manual match made at the delivery is
  // what approval is judged against.
  const matched: LinkedOrder[] = useMemo(
    () =>
      linkedOrders.map((order) => ({
        poNumber: order.po_number,
        matches: matchesFromLinks(
          order.lines,
          lines
            .filter((l) => l.purchase_order_id === order.id)
            .map((l) => ({
              ...toInvoiceLine(l),
              purchase_order_item_id: l.purchase_order_item_id,
            }))
        ).matches,
      })),
    [linkedOrders, lines]
  );

  const duplicates = useMemo(
    () => findPossibleDuplicates(invoice, duplicateCandidates),
    [invoice, duplicateCandidates]
  );

  /**
   * BOTH CHECKS ASK ABOUT THE PAGE, NEVER ABOUT OUR OWN COLUMNS (Mark,
   * 2026-09-02: "there's a warning that isn't appropriate … after I changed it
   * back the warning didn't go away").
   *
   * They read `invoice.subtotal` and the stored parts until then, which was
   * right while those were transcribed off the document and became meaningless
   * the day the figures were computed from the lines: the stored columns are
   * now a CACHE the list reads, maintained on every line write, so comparing
   * the lines against them asks whether our own bookkeeping kept up. Worse, the
   * Amounts block beside the caveat shows the COMPUTED subtotal, so the warning
   * quoted a number that appears nowhere on screen — 15490761 read "the item
   * lines come to $535.33 against a subtotal of $452.29" over an Amounts block
   * saying $535.33, with no way for the reader to act on either figure.
   *
   * Against the READING they are facts about the document again, which is what
   * their wording always claimed: the vendor's own foot does not add up, or the
   * lines we hold do not come to the subtotal they printed. Both go quiet when
   * there is no reading to compare against, which is the honest answer for a
   * hand-typed bill.
   */
  const printedCharges = shown?.extraction
    ? invoiceCharges(shown.extraction)
    : null;
  const amounts = useMemo(
    () =>
      amountReconciliation(
        printedCharges === null
          ? { subtotal: null, tax: null, freight: null, other_charges: null, total: null }
          : {
              subtotal: printedCharges.subtotal,
              tax: printedCharges.tax,
              freight: printedCharges.freight,
              other_charges: printedCharges.other,
              total: printedCharges.total,
            }
      ),
    [printedCharges]
  );
  const lineSums = useMemo(
    () => lineSumReconciliation(lines, printedCharges?.subtotal ?? null),
    [lines, printedCharges]
  );

  // What the reader took off the page, when it cannot be the vendor on the
  // record — the check that catches a wrong-vendor pick on a hand-created
  // invoice and a mis-filed auto-created one.
  //
  // This compared the two names for EQUALITY until 2026-08-27, punctuation
  // stripped, and that is far too strict to be worth reading: measured over the
  // 49 readings on file, only three of twelve distinct pairs match as text,
  // because our catalog carries the name staff say and the invoice prints the
  // name lawyers use ("BakeMark" against "BAKEMARK USA LLC"). It was warning on
  // most invoices in the system, which is the same as warning on none.
  // `printedVendorDisagreement` is the measured rule and lives in lib/invoices
  // so the receiving screen's chip and this caveat cannot disagree.
  const vendorDisagreement = shown?.extraction
    ? printedVendorDisagreement(shown.extraction, invoice.vendors?.name ?? null)
    : null;

  /**
   * The page as a driver left it — struck lines and a total written by hand.
   *
   * DERIVED FROM THE READING, never stored: a re-read updates it and nothing
   * has to be kept in step. It is shown at the TOP because it changes what the
   * whole document means — BakeMark 452660 sat here reading $1,001.26 while the
   * page in the folder said $823.46, and the reader had seen all of it and
   * could only say so in a note behind a caret (Mark, 2026-09-02).
   */
  const amendment = shown?.extraction ? handAmendment(shown.extraction) : null;
  /**
   * What the delivery actually produced for a line, from the purchase order it
   * is linked to.
   *
   * ALREADY LOADED — `PO_LINE_SELECT` carries `qty_received`, and the PO column
   * beside this one already resolves the same line — so this costs no query.
   *
   * THREE ANSWERS, NOT TWO, which is why it is a column rather than a mark on
   * the ones that disagree: a line can agree, differ, or never have been
   * counted, and a marker that only appears on a difference cannot tell the
   * last two apart. "Never counted" is the state that hid two cases of whipped
   * topping (Mark, 2026-09-02).
   */
  function receivedFor(l: VendorInvoiceLine): { qty: number | null; linked: boolean } {
    if (!l.purchase_order_item_id) return { qty: null, linked: false };
    for (const order of linkedOrders) {
      const poLine = order.lines.find((p) => p.id === l.purchase_order_item_id);
      if (poLine) {
        return {
          qty: poLine.qty_received === null || poLine.qty_received === undefined
            ? null
            : Number(poLine.qty_received),
          linked: true,
        };
      }
    }
    return { qty: null, linked: false };
  }

  /**
   * Take the total the page was corrected to.
   *
   * ONE FIELD, and deliberately not the lines as well: zeroing a struck line's
   * `extended` is a second judgement — the printed figure is still what was
   * printed — and a button that quietly rewrote seven rows would be doing more
   * than it says. The band names the struck lines; they are one click each.
   */
  async function takeAmendedTotal(next: number) {
    setSettingTotal(true);
    const { data, error } = await supabase
      .from("vendor_invoices")
      .update({ total: next })
      .eq("id", invoice.id)
      .select("id");
    setSettingTotal(false);
    // Its own row count: below purchaser+ this changes nothing and returns NO
    // error, and a total that silently did not move is money reading wrong.
    if (error || !data || data.length === 0) return;
    router.refresh();
  }

  /** What the invoice adds up to from its own lines and charges. Null on a
   *  hand-typed bill with no lines, which keeps whatever was typed. */
  const computed = useMemo(
    () => computedAmounts(lines, invoice),
    [lines, invoice]
  );

  /**
   * Write a line's quantity or price, and the arithmetic that follows from it.
   *
   * ONE STATEMENT FOR THE LINE — the charge rides along, so a row can never be
   * caught with a quantity and a stale total beside it — and then a SECOND for
   * the invoice, because the totals live on another table and `alsoUpdate`
   * cannot reach it.
   *
   * The charge is RESCALED, not recomputed: `rescaledExtended` moves it by the
   * rate the line was really billed at, which is the only thing that is right
   * on a broken case. Recomputing it as qty × unit_price turned Chefs Warehouse
   * 73358289 from $472.13 into $1,952.90.
   *
   * The invoice write is skipped when there is nothing to compute, which is the
   * hand-typed bill: its total is the only figure it has.
   */
  async function writeLineAmount(
    lineId: string,
    column: "qty" | "unit_price" | "extended",
    next: unknown
  ): Promise<{ error: string | null }> {
    const value = next === null || next === "" ? null : Number(next);
    const line = lines.find((l) => l.id === lineId);
    const qty = column === "qty" ? value : (line?.qty ?? null);
    const price = column === "unit_price" ? value : (line?.unit_price ?? null);

    const { error } = await supabase
      .from("vendor_invoice_lines")
      .update(
        column === "extended"
          ? { extended: value }
          : {
              [column]: value,
              extended: line
                ? rescaledExtended(line, { [column]: value })
                : lineExtended(qty, price),
            }
      )
      .eq("id", lineId)
      .select("id");
    // Reported back to the cell, which reopens itself on a refusal — below
    // purchaser+ this changes nothing and returns no error, so the row count is
    // what says so.
    if (error) return { error: error.message };

    const after = lines.map((l) =>
      l.id === lineId
        ? {
            ...l,
            qty,
            unit_price: price,
            extended:
              column === "extended"
                ? value
                : line
                  ? rescaledExtended(line, { [column]: value })
                  : lineExtended(qty, price),
          }
        : l
    );
    const sums = computedAmounts(after, invoice);
    if (sums.total !== null) {
      // ITS OWN ROW COUNT, like every other money write here. This one took
      // `.select("id")` and threw the answer away, so a second statement that
      // changed nothing — a refused write, a row that had moved — left the line
      // correct and the invoice's cached figures behind it, which is how
      // 15490761 came to sit at $452.29 while its own lines said $535.33 and
      // the LIST quoted the stale one. Reported through the cell, which reopens
      // on a refusal rather than closing over a number that did not stick.
      const { data, error: totalsError } = await supabase
        .from("vendor_invoices")
        .update({ subtotal: sums.subtotal, total: sums.total })
        .eq("id", invoice.id)
        .select("id");
      if (totalsError) return { error: totalsError.message };
      if (!data || data.length === 0) {
        return { error: "The line saved, but the invoice total did not." };
      }
    }
    return { error: null };
  }

  /** Which of OUR lines the page strikes out, by the vendor's own SKU — the
   *  same key the lines were seeded under. */
  const struckSkus = useMemo(
    () =>
      new Set(
        (amendment?.struck ?? [])
          .map((l) => (l.product_id ?? "").trim())
          .filter(Boolean)
      ),
    [amendment]
  );

  /**
   * The purchase order this invoice PRINTS, when exactly one candidate answers
   * to it — a proposal, never an automatic link. A printed number is one OCR
   * digit from someone else's order, so the same uniqueness discipline the SKU
   * join uses applies here one level up: two matches, another vendor or another
   * location all refuse.
   *
   * Provenance is different and DOES link by itself: an invoice created from a
   * purchase order's own Paperwork card is linked to that order because you
   * attached it there.
   */
  const printedProposals = useMemo(() => {
    if (!shown?.extraction) return [];
    const alreadyLinked = new Set(
      linkedOrders.map((o) => o.po_number.toUpperCase())
    );
    return printedPoNumbers(shown.extraction)
      .map((printed) => ({
        printed,
        hit: matchPrintedPoNumber(printed, linkCandidates, {
          vendor_id: invoice.vendor_id,
          location_id: invoice.location_id,
        }),
      }))
      .filter((p) => p.hit && !alreadyLinked.has(p.hit.po_number.toUpperCase()));
  }, [shown, linkCandidates, invoice.vendor_id, invoice.location_id, linkedOrders]);

  async function linkPrinted(orderId: string) {
    const order = linkCandidates.find((c) => c.id === orderId);
    if (!order) return;
    // Keyed by the OBJECT the matcher was handed, so its answer maps back to a
    // row with no index arithmetic to get wrong.
    const rowOf = new Map<InvoiceLine, VendorInvoiceLine>();
    const asInvoiceLines: InvoiceLine[] = lines
      .filter((l) => l.purchase_order_id === null)
      .map((l) => {
        const shape = toInvoiceLine(l);
        rowOf.set(shape, l);
        return shape;
      });

    const { matches } = matchInvoiceToOrder(order.lines, asInvoiceLines);
    for (const m of matches) {
      if (!m.invoice) continue;
      const row = rowOf.get(m.invoice);
      if (!row) continue;
      await supabase
        .from("vendor_invoice_lines")
        .update({
          purchase_order_id: order.id,
          purchase_order_item_id: m.line.id,
        })
        .eq("id", row.id);
    }
    router.refresh();
  }

  const caveats = useMemo(() => {
    const list = approvalReadiness(
      invoice,
      lines,
      matched,
      attachments.length,
      duplicates,
      vendorDisagreement
    );
    // WHERE THE TRANSCRIPTION'S JOB WENT (Mark, 2026-09-02: "If it's off, we
    // should be warned when 'approving' and allowed to cancel and edit").
    //
    // The totals are computed now, so they can no longer disagree with
    // themselves — the only disagreement left worth raising is with the PAGE,
    // and this is the moment for it: approving is when somebody says the bill
    // is payable, and a difference nobody has looked at is exactly what that
    // decision must not pass over. `approvalReadiness` already lets you through
    // after naming what is unresolved, so cancelling and editing is what its
    // confirm has always offered.
    //
    // Against the DOCUMENT's own figure — a driver's handwritten correction
    // where there is one, else what was printed — never our own column.
    const printed =
      shown?.extraction?.corrected_total ?? shown?.extraction?.invoice_total ?? null;
    const off = totalDisagreesWithDocument(computed.total, printed);
    return off ? [...list, off] : list;
  }, [
    invoice,
    lines,
    matched,
    attachments.length,
    duplicates,
    vendorDisagreement,
    computed.total,
    shown,
  ]);

  const columns: DataColumn<VendorInvoiceLine>[] = [
    {
      key: "product_id",
      label: "Product ID",
      width: 150,
      hideWhenCompact: true,
      sortValue: (l) => l.product_id,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="product_id"
            value={l.product_id}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>{l.product_id ?? "—"}</span>
        ),
    },
    {
      key: "description",
      label: "Description",
      width: 320,
      pinned: true,
      wrap: true,
      sortValue: (l) => l.description,
      render: (l) => {
        // MARKED WHERE YOU READ THE LINE, not in a legend. A struck line still
        // shows its printed figures — that is the record — so the only thing
        // saying "do not believe these" has to sit beside them.
        const struck = struckSkus.has((l.product_id ?? "").trim());
        return (
          <span className="flex flex-wrap items-baseline gap-x-2">
            {canEdit ? (
              <InlineValue
                table="vendor_invoice_lines"
                id={l.id}
                column="description"
                value={l.description}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{l.description ?? "—"}</span>
            )}
            {struck && (
              <span className="bg-mark-fill px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">
                struck out by hand
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "pack",
      label: "Pack",
      width: 110,
      hideWhenCompact: true,
      sortValue: (l) => l.pack,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="pack"
            value={l.pack}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>{l.pack ?? "—"}</span>
        ),
    },
    {
      key: "qty",
      // WHOSE NUMBER IT IS. Mark read this as a received quantity and expected
      // it to reflect the receiving he had already done (2026-09-02) — it is
      // the vendor's claim, and has to be, or a line billed for goods that
      // never came would have nowhere to show up.
      label: "Billed",
      // Wider than a bare quantity: the flag rides in this cell rather than
      // taking a column of its own, and only appears when it has something to
      // say. The Received column it replaces was 110.
      width: 130,
      align: "right",
      sortValue: (l) => l.qty,
      // FLAGGED, NOT COLUMNED (Mark, 2026-09-02, having seen both). A column
      // spent width on the ~95% of lines where the two agree and there is
      // nothing to say; the flag appears only when there is, and carries the
      // received figure with it so the column's answer is still there when it
      // matters.
      //
      // "Not counted" keeps its own words rather than being folded into
      // silence: a line nobody counted and a line that agrees are different
      // facts, and it was the first that hid two cases of whipped topping.
      render: (l) => {
        const { qty: received, linked } = receivedFor(l);
        const differs =
          linked && received !== null && Math.abs(received - Number(l.qty ?? 0)) > 0.0001;
        return (
          <span className="flex items-center justify-end gap-1">
            {canEdit ? (
              <InlineValue
                table="vendor_invoice_lines"
                id={l.id}
                column="qty"
                value={l.qty}
                kind="number"
                align="right"
                onWrite={(next) => writeLineAmount(l.id, "qty", next)}
              />
            ) : (
              <span className={`${READ_ONLY_VALUE} tabular-nums`}>{l.qty ?? "—"}</span>
            )}
            {differs && (
              <span
                className="shrink-0 bg-mark-fill px-1 text-[11px] font-semibold tabular-nums"
                title={`${received} received against ${l.qty ?? 0} billed`}
              >
                {received} rec
              </span>
            )}
            {linked && received === null && (
              <span
                className="shrink-0 bg-mark-fill px-1 text-[11px] font-semibold uppercase"
                title="Nobody has recorded what arrived for this line"
              >
                uncounted
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 120,
      align: "right",
      sortValue: (l) => l.unit_price,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="unit_price"
            value={l.unit_price}
            kind="number"
            align="right"
            onWrite={(next) => writeLineAmount(l.id, "unit_price", next)}
            format={(v) => money(Number(v))}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {money(l.unit_price)}
          </span>
        ),
    },
    {
      key: "extended",
      label: "Extended",
      width: 130,
      align: "right",
      sortValue: (l) => l.extended,
      // MAINTAINED, NOT COMPUTED (Mark, 2026-09-02: "Extended should be
      // calculated, full stop" — and it is, on every edit, by
      // `rescaledExtended`). It stays TYPEABLE because the arithmetic behind a
      // distributor's line is not always ours: a broken case bills a fraction
      // of the printed case price, so a figure derived from qty × unit_price
      // would be confidently wrong on rows nobody had touched.
      //
      // A quantity of nothing carrying a charge is marked — that is not a
      // pricing subtlety, it is a line that was struck and a figure left
      // behind, which is exactly what BakeMark 452660 was.
      render: (l) => {
        const stranded =
          Number(l.qty ?? 0) === 0 && Number(l.extended ?? 0) !== 0;
        const cell = canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="extended"
            value={l.extended}
            kind="number"
            align="right"
            onWrite={(next) => writeLineAmount(l.id, "extended", next)}
            format={(v) => money(Number(v))}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {l.extended === null ? "—" : money(l.extended)}
          </span>
        );
        return stranded ? (
          <span
            className="bg-mark-fill"
            title="Billed for nothing and still carrying a charge — take the amended total, or clear this figure."
          >
            {cell}
          </span>
        ) : (
          cell
        );
      },
    },
    {
      key: "po",
      label: "PO line",
      width: 200,
      sortValue: (l) => l.purchase_order_id,
      render: (l) => {
        const order = linkedOrders.find((o) => o.id === l.purchase_order_id);
        if (!order) {
          return (
            <span className="text-faint">
              {l.kind === "item" ? "—" : ATTACHMENT_LINE_KIND[l.kind]}
            </span>
          );
        }
        const poLine = order.lines.find((p) => p.id === l.purchase_order_item_id);
        return (
          <span className="text-muted">
            <Link
              href={withFrom(`/purchase-orders/${order.id}`, {
                href: selfHref,
                label: invoice.invoice_number ?? "Invoice",
              })}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {order.po_number}
            </Link>
            {poLine && (
              <span className="block truncate text-[12px]">
                {poLine.vendor_items?.inventory_items?.name ?? poLine.description ?? ""}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  if (canEdit) {
    columns.push({
      key: "menu",
      label: "",
      width: 56,
      render: (l) => (
        <RowMenu
          label={`Actions for ${l.description ?? "this line"}`}
          items={[
            {
              label: "Unlink",
              hint: "Leave this line unattributed",
              disabled: l.purchase_order_id === null,
              onSelect: () => void setLineLink(l.id, null, null),
            },
            {
              label: l.kind === "freight" ? "Mark as an item" : "Mark as freight",
              // Kind is what keeps the totals honest: a freight LINE and a
              // header freight amount are the same charge printed twice, so
              // the subtotal check counts item lines only.
              hint:
                l.kind === "freight"
                  ? "Count it toward the subtotal again"
                  : "A delivery fee or fuel surcharge",
              onSelect: () =>
                void setLineKind(l.id, l.kind === "freight" ? "item" : "freight"),
            },
          ]}
        />
      ),
    });
  }

  async function setLineLink(
    lineId: string,
    purchaseOrderId: string | null,
    purchaseOrderItemId: string | null
  ) {
    await supabase
      .from("vendor_invoice_lines")
      .update({
        purchase_order_id: purchaseOrderId,
        purchase_order_item_id: purchaseOrderItemId,
      })
      .eq("id", lineId);
    router.refresh();
  }

  async function setLineKind(lineId: string, kind: VendorInvoiceLine["kind"]) {
    await supabase.from("vendor_invoice_lines").update({ kind }).eq("id", lineId);
    router.refresh();
  }

  return (
    <>
      {/* The duplicate band, above the fields where you'll see it before you
          work. Yellow, not red: it is worth your eye, not necessarily wrong —
          a credit memo legitimately carries the number it credits. */}
      {duplicates.length > 0 && (
        <div className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
          <p className="font-semibold">This may be a duplicate.</p>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.invoice.id}>
                <Link
                  href={withFrom(`/invoices/${d.invoice.id}`, {
                    href: selfHref,
                    label: invoice.invoice_number ?? "Invoice",
                  })}
                  className="underline decoration-neutral-500 underline-offset-[3px] hover:decoration-neutral-900"
                >
                  {d.invoice.invoice_number ?? "No number"}
                </Link>{" "}
                <span className="text-muted">
                  — {d.reason}
                  {d.invoice.invoice_date ? ` · ${d.invoice.invoice_date}` : ""}
                  {d.invoice.total !== null ? ` · ${money(d.invoice.total)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* TWO MAIN COLUMNS, MATCHING THE CONTENT ROW BELOW — the "green boxes"
          (Mark, 2026-09-03, correcting the four-box row: "I overlooked how
          the elements would align vertically with that layout"). The four-box
          row spanned the FULL page width on its own terms, so its column
          edges had no relationship to the document pane and the Bill/Amounts
          column beneath it — which is what "align vertically" was catching.

          THIS HEADER USES THE SAME `xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`
          TEMPLATE AS THE CONTENT GRID BELOW (`ref={rowRef}`), not a copy of
          the numbers — it is the one thing that makes "the total's right edge
          is the document pane's right edge" true without either grid knowing
          the other's width. This is the 2026-09-02 convention, restored.

          EACH GREEN COLUMN THEN SPLITS IN HALF — the "red boxes… half the
          width of their parent boxes" — into its own two-cell grid:
          identity | total on the left, QuickBooks | actions on the right.
          `items-start` at both levels is what keeps every cell's top on the
          same line while it grows down on its own — the same technique as
          the four-box row, just nested one level deeper so the outer edges
          now correspond to real content below them. */}
      <div className="grid items-start gap-x-4 gap-y-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* LEFT — identity | total, matching the document pane's width.
            TOTAL IS SIZED TO ITS OWN CONTENT (`max-content`), not half the
            column — a 50/50 split left identity with only ~257px at 1440,
            which wraps "APPROVED" onto its own line the moment the invoice
            number runs long (Mark, 2026-09-03: "ARINT2000689768"). Total
            never needs more than a label and a dollar figure, so it takes
            only that, and identity gets everything left over. */}
        <div className="grid items-start gap-x-4 grid-cols-[minmax(0,1fr)_max-content]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
                {invoice.invoice_number ?? "No number"}
              </h1>
              <span
                className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${INVOICE_STATUS_CLASS[invoice.status]}`}
              >
                {INVOICE_STATUS_LABEL[invoice.status]}
              </span>
              {invoice.is_credit && (
                <span className="inline-flex h-6 items-center border border-ink bg-mark-fill px-2 text-[12px] font-semibold uppercase tracking-[0.12em]">
                  Credit memo
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
              {invoice.vendors ? (
                // Underlined AT REST, not on hover: the iPad has no hover, and
                // a link the colour of the line it sits in reads as more
                // subtitle.
                <Link
                  href={withFrom(`/vendors/${invoice.vendors.id}`, {
                    href: selfHref,
                    label: invoice.invoice_number ?? "Invoice",
                  })}
                  className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                >
                  {invoice.vendors.name}
                </Link>
              ) : (
                "No vendor"
              )}{" "}
              · {locationCode}
              {invoice.due_date &&
                ` · ${AGING_LABEL[agingBucket(invoice.due_date, todayLocal())]}`}
            </p>
          </div>

          {/* Half the left column's width, right-aligned — so its own right
              edge lands on the document pane's right edge below it. */}
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Total
            </div>
            {/* THE COMPUTED FIGURE, the same one AMOUNTS shows. It read the
                stored column until 2026-09-02 and, once the totals became
                calculated, that put TWO different totals on one screen —
                caught on Chefs Warehouse 73358289, whose header said $472.13
                over an Amounts block saying $1,952.90. A screen may disagree
                with the page; it may not disagree with itself. */}
            <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(
                computed.total === null
                  ? signedTotal(invoice)
                  : invoice.is_credit
                    ? -computed.total
                    : computed.total
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — QuickBooks | actions, matching the Bill/Amounts column's
            width. Each renders its OWN box now (buttons, then its own prose)
            — see `PushToQuickBooks` and `InvoiceFooter` — so this grid only
            has to place the two boxes side by side.

            THE QUICKBOOKS SLOT IS WRAPPED IN ITS OWN `div` (Mark, 2026-09-03:
            "Void, Delete and Withdraw appear where the quickbook buttons
            should be, then move into place"). A grid with `grid-cols-2`
            whose FIRST child has NO DOM NODE AT ALL does not leave an empty
            slot: CSS auto-placement drops the one remaining child
            (`InvoiceFooter`) into the FIRST track, because there is nothing
            to hold that track open. `PushToQuickBooks` NOW renders a
            placeholder while it decides what to show, so this no longer
            fires on an ordinary load — but it still returns `null` outright
            once it learns the org has no QuickBooks connection at all, and
            THAT case would flash Actions left exactly the same way without
            this wrapper. It costs nothing to keep either way: an always-
            present `div` is what guarantees the track stays open regardless
            of what, if anything, ends up inside it. */}
        <div className="grid grid-cols-2 items-start gap-x-4">
          <div>
            <PushToQuickBooks
              invoiceId={invoice.id}
              vendorId={invoice.vendor_id}
              locationId={invoice.location_id}
              orgId={orgId}
              status={invoice.status}
              total={invoice.total}
              isCredit={invoice.is_credit}
              invoiceNumber={invoice.invoice_number}
              invoiceDate={invoice.invoice_date}
              dueDate={invoice.due_date}
              canPush={canEdit}
              supabase={supabase}
              onDone={() => router.refresh()}
            />
          </div>
          <InvoiceFooter
            invoiceId={invoice.id}
            status={invoice.status}
            approvedAt={invoice.approved_at}
            caveats={caveats}
            canApprove={canApprove}
            canEdit={canEdit}
            closeHref={closeHref}
            supabase={supabase}
            onDone={() => router.refresh()}
          />
        </div>
      </div>

      {(attachError || documentError || linkError) && (
        <p className="border border-accent px-4 py-3 text-sm text-accent">
          {attachError ?? documentError ?? linkError}
        </p>
      )}
      {phase.kind !== "idle" && (
        <p className="text-sm text-muted">{phase.label}</p>
      )}

      {/* Document left, record right, both ending level at the footer (Mark,
          2026-08-05). The row's height is MEASURED — see lib/fillHeight — for
          the reason receiving measures its own: what sits above varies (the
          duplicate band comes and goes, the masthead wraps at narrow widths), so
          any `100vh - <guess>` is right at exactly one size.

          Below `xl` the columns stack and the page scrolls, which is the point
          of stacking; `useFillToBottom` clears the height itself. */}
      <div
        ref={rowRef}
        className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      >
        <div className="flex min-h-0 min-w-0 flex-col">
          <DocumentPane
            attachment={shown}
            attachments={attachments}
            canEdit={canEdit}
            busy={busy}
            onPick={setShownId}
            onFilesPicked={(files) => void upload(files, kind)}
            // Through the hook, so a refused drop reads the same here as on PO
            // detail and lands in the same line as an upload failure.
            onDropRejected={(rejected) => reportError(attachmentRejection(rejected))}
            onRead={(a) => void read(a)}
            onRemove={(a) => void remove(a)}
            fileRef={fileRef}
            kind={kind}
            onKindChange={setKind}
            stacked={false}
          />

          {/* UNDER THE DOCUMENT, as wide as it (Mark, 2026-09-02). It was in the
              record column, where it and Bill+Amounts were ~433px of fixed
              blocks standing between the lines table and the top of the screen.
              Moved here it costs the pane a little height and hands the table
              all of its own — which was the point, the room wanted being
              VERTICAL rather than horizontal.

              `shrink-0` so it keeps its size and the PANE gives, which is the
              right way round: a document viewer scrolls, a list of two orders
              does not. */}
          <div className="shrink-0 space-y-2 pt-4">
            <section className="shrink-0 space-y-2">
              {/* The heading and the one command on one line — which is where
                  the rows' own Reconcile links sit, so they share a right
                  margin and this costs no line of its own (Mark, 2026-09-02). */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <SectionHeading count={linkedOrders.length}>
                  Purchase orders
                </SectionHeading>
                {canEdit && (
                  <LinkToPo
                    lines={lines}
                    candidates={linkCandidates}
                    onDone={() => router.refresh()}
                  />
                )}
              </div>

              {/* What the page PRINTS, offered rather than taken. Yellow, because
                  it's worth your eye and not a warning. */}
              {canEdit &&
                printedProposals.map((p) => (
                  <p
                    key={p.printed}
                    className="flex flex-wrap items-center gap-3 border border-ink bg-mark-fill px-4 py-2 text-sm"
                  >
                    <span>
                      This invoice prints{" "}
                      <strong>{p.hit!.po_number}</strong>.
                    </span>
                    <button
                      type="button"
                      onClick={() => void linkPrinted(p.hit!.id)}
                      className="h-8 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
                    >
                      Link
                    </button>
                  </p>
                ))}

              {linkedOrders.length === 0 ? (
                // A landlord bill should not be nagged about a purchase order.
                invoice.vendors?.order_type === "none" ? (
                  <p className="text-sm text-muted">
                    This vendor isn&rsquo;t ordered from, so there&rsquo;s no
                    purchase order to link.
                  </p>
                ) : (
                  <p className="text-sm text-muted">
                    No lines on this invoice point at a purchase order yet.
                  </p>
                )
              ) : (
                <ul className="space-y-2 text-sm">
                  {linkedOrders.map((order) => {
                    const count = lines.filter(
                      (l) => l.purchase_order_id === order.id
                    ).length;
                    return (
                      <li
                        key={order.id}
                        className="flex flex-wrap items-baseline gap-x-4 border border-hairline px-4 py-2"
                      >
                        <Link
                          href={withFrom(`/purchase-orders/${order.id}`, {
                            href: selfHref,
                            label: invoice.invoice_number ?? "Invoice",
                          })}
                          className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                        >
                          {order.po_number}
                        </Link>
                        <span className="text-muted">{order.order_date}</span>
                        <span className="text-muted">
                          {count} {count === 1 ? "line" : "lines"}
                        </span>
                        <Link
                          href={withFrom(`/purchase-orders/${order.id}/receive`, {
                            href: selfHref,
                            label: invoice.invoice_number ?? "Invoice",
                          })}
                          className="ml-auto text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                        >
                          Reconcile
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}


          </section>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-y-10 xl:overflow-hidden">
          {/* Bill and Amounts side by side (Mark, 2026-08-05, on the page being
              too tall): they are two SHORT lists — seven rows and five — and
              stacking them spent a whole block's height plus a gap on nothing.

              They pair at `md` rather than at the page's own `xl` because this
              is a fact about THESE two boxes, not about the document beside
              them: below `xl` the record column is full width and has even more
              room for two. Below `md` they stack, which is the only width where
              a 7rem label and a value genuinely don't share a line. */}
          <div className="grid shrink-0 gap-x-8 gap-y-10 md:grid-cols-2">
            {/* The bill itself. */}
            <section className="min-w-0 space-y-2">
              <SectionHeading>Bill</SectionHeading>
              <dl className={DL_CLASS}>
              <Field label="Invoice number">
                <Cell canEdit={canEdit} value={invoice.invoice_number}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="invoice_number"
                    value={invoice.invoice_number}
                  />
                </Cell>
              </Field>
              <Field label="Invoice date">
                <Cell canEdit={canEdit} value={invoice.invoice_date}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="invoice_date"
                    value={invoice.invoice_date}
                    kind="date"
                  />
                </Cell>
              </Field>
              <Field label="Due date">
                <Cell canEdit={canEdit} value={invoice.due_date}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="due_date"
                    value={invoice.due_date}
                    kind="date"
                  />
                </Cell>
              </Field>
              {/* Free TEXT, not a PickList: the vocabulary is the vendor's, not
                  ours, and an allowNew-less list would make an unlisted value
                  unenterable — the GAL/QT lesson. */}
              <Field label="Terms">
                <Cell canEdit={canEdit} value={invoice.terms}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="terms"
                    value={invoice.terms}
                  />
                </Cell>
              </Field>
              <Field label="Vendor">
                <Cell canEdit={canEdit} value={invoice.vendors?.name ?? null}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="vendor_id"
                    value={invoice.vendor_id}
                    kind="pick"
                    nullable={false}
                    options={vendors.map((v) => ({ value: v.id, label: v.name, inactive: v.inactive }))}
                    activateTable="vendors"
                  />
                </Cell>
              </Field>
              <Field label="Location">
                <Cell canEdit={canEdit} value={locationCode}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="location_id"
                    value={invoice.location_id}
                    kind="pick"
                    nullable={false}
                    options={locations.map((l) => ({
                      value: l.id,
                      label: l.code,
                      hint: l.name,
                    }))}
                  />
                </Cell>
              </Field>
              <Field label="Note">
                <Cell canEdit={canEdit} value={invoice.notes}>
                  <InlineValue
                    boxed={BOXED_FIELDS}
                    table="vendor_invoices"
                    id={invoice.id}
                    column="notes"
                    value={invoice.notes}
                  />
                </Cell>
              </Field>
            </dl>
          </section>

          {/* The money. */}
          <section className="min-w-0 space-y-2">
            <SectionHeading>Amounts</SectionHeading>
            <dl className={DL_CLASS}>
              {(
                [
                  ["Subtotal", "subtotal", invoice.subtotal],
                  ["Tax", "tax", invoice.tax],
                  ["Freight", "freight", invoice.freight],
                  ["Other", "other_charges", invoice.other_charges],
                  ["Total", "total", invoice.total],
                ] as const
              ).map(([label, column, value]) => (
                <Field key={column} label={label}>
                  {/* SUBTOTAL AND TOTAL ARE READ once the invoice has lines to
                      add up — the same decision as `extended`, one level up.
                      Tax, freight and other stay typed: they are on the page
                      and follow from nothing. A bill with NO lines keeps every
                      field, which is the rent bill and the plumber. */}
                  {(column === "subtotal" || column === "total") &&
                  computed.total !== null ? (
                    <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                      {money(column === "subtotal" ? computed.subtotal : computed.total)}
                    </span>
                  ) : (
                  <Cell canEdit={canEdit} value={value === null ? null : money(value)}>
                    <InlineValue
                      boxed={BOXED_FIELDS}
                      table="vendor_invoices"
                      id={invoice.id}
                      column={column}
                      value={value}
                      kind="number"
                      format={(v) => money(Number(v))}
                      // A charge moves the total with it, in one statement.
                      alsoUpdate={
                        column === "tax" || column === "freight" || column === "other_charges"
                          ? (next) => {
                              const sums = computedAmounts(lines, {
                                ...invoice,
                                [column]: next === null || next === "" ? null : Number(next),
                              });
                              return sums.total === null
                                ? null
                                : { subtotal: sums.subtotal, total: sums.total };
                            }
                          : undefined
                      }
                    />
                  </Cell>
                  )}
                </Field>
              ))}
            </dl>

            {/* Yellow, never red — "worth your eye", the ≈/? rule. A total that
                doesn't match its parts is usually a reading to correct, not a
                vendor who can't add up. */}
            {/* THE PAGE WAS AMENDED BY HAND, and that outranks every other
                caveat here — it changes what the document says is owed, where
                the rest are about how well we read it. Yellow: a driver taking
                goods back is normal, not an error. */}
            {amendment && (
              <div className="space-y-1 border border-ink bg-mark-fill px-4 py-2 text-sm">
                <p>
                  <strong>Amended by hand on the page.</strong>{" "}
                  {amendment.printedTotal !== null && (
                    <>
                      Printed{" "}
                      <span className="tabular-nums">{money(amendment.printedTotal)}</span>,{" "}
                    </>
                  )}
                  {amendment.correctedTotal !== null ? (
                    <>
                      handwritten{" "}
                      <strong className="tabular-nums">
                        {money(amendment.correctedTotal)}
                      </strong>
                      .
                    </>
                  ) : (
                    <>
                      and the lines left standing come to{" "}
                      <strong className="tabular-nums">{money(amendment.remaining)}</strong>.
                    </>
                  )}
                </p>
                {amendment.struck.length > 0 && (
                  <p className="text-[13px]">
                    Struck out:{" "}
                    {amendment.struck
                      .map((l) => `${l.product_id || "no number"} ${l.description}`.trim())
                      .join(" · ")}
                    .
                  </p>
                )}
                {/* SAID, NOT SETTLED. Our own sum against the pen — when they
                    disagree the page is the record, and which one is on screen
                    should never be a silent choice. */}
                {amendment.correctedTotal !== null &&
                  Math.abs(amendment.correctedTotal - amendment.remaining) > 0.005 && (
                    <p className="text-[13px]">
                      The lines left standing come to{" "}
                      <span className="tabular-nums">{money(amendment.remaining)}</span>, which is
                      not what was written.
                    </p>
                  )}
                {/* THE OFFER, NOT THE WRITE — the receiving screen's `→` idiom.
                    The total is TRANSCRIBED, never computed: it is what the
                    vendor's document claims, and deriving it would let our
                    arithmetic quietly replace theirs so a misread line stopped
                    being visible. But the corrected figure is on the page, we
                    have read it, and making somebody retype it is the friction
                    Mark hit (2026-09-02). A number the page supplies, offered
                    beside the one it replaces. */}
                {Math.abs(Number(invoice.total ?? 0) - amendedTotal(amendment)) > 0.005 && (
                  <p className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span>
                      This record still says{" "}
                      <span className="tabular-nums">{money(invoice.total)}</span>.
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="border border-ink bg-white px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
                        disabled={settingTotal}
                        onClick={() => void takeAmendedTotal(amendedTotal(amendment))}
                      >
                        {settingTotal
                          ? "Setting…"
                          : `→ ${money(amendedTotal(amendment))}`}
                      </button>
                    )}
                  </p>
                )}
              </div>
            )}
            {amounts.differs && (
              <p className="border border-ink bg-mark-fill px-4 py-2 text-sm">
                The page&rsquo;s own parts add up to{" "}
                <strong className="tabular-nums">{money(amounts.computed)}</strong>,
                but the invoice says{" "}
                <strong className="tabular-nums">{money(amounts.stated)}</strong>.
                {amounts.missing.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    Nothing was read for {amounts.missing.join(", ")}.
                  </span>
                )}
              </p>
            )}
            {lineSums.differs && (
              <p className="border border-ink bg-mark-fill px-4 py-2 text-sm">
                The item lines come to{" "}
                <strong className="tabular-nums">{money(lineSums.computed)}</strong>{" "}
                against a printed subtotal of{" "}
                <strong className="tabular-nums">{money(lineSums.stated)}</strong>.
              </p>
            )}
            </section>
          </div>

          {/* What it belongs to. */}
          {/* The lines, in a pane of their own. Fifteen rows is 1,319px — more
              than the rest of the record put together — so left to run they
              are what makes this page three screens tall. Paned, the column
              labels stick to the top of the pane and the sticky document beside
              you stays in view while you read them. */}
          <DataTable
            rows={lines}
            columns={columns}
            rowKey={(l) => l.id}
            storageKey={INVOICE_LINE_WIDTHS_KEY}
            columnChooser
            scroll
            fill
            // 1536, not the app's usual `xl`: this table lives in the RECORD
            // column, so it gets ~55% of the window rather than all of it. At a
            // 1280 laptop that is 677px for eight columns and every single
            // header clipped to an ellipsis — which CLAUDE.md names as the tell
            // that a column is too narrow for its name. Product ID and Pack
            // drop first because the description carries their sense; the eye
            // brings either back, and an explicit choice beats this default in
            // both directions.
            compactBelow={1536}
            leading={<SectionHeading count={lines.length}>Lines</SectionHeading>}
            empty={
              <p className="text-sm text-muted">
                No lines — a one-line bill doesn&rsquo;t need any.
              </p>
            }
          />
        </div>
      </div>

    </>
  );
}

const ATTACHMENT_LINE_KIND: Record<VendorInvoiceLine["kind"], string> = {
  item: "—",
  freight: "Freight",
  other: "Other",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * An editable cell, or the same value as plain text below purchaser+.
 *
 * The read-only branch wears InlineValue's own resting padding — without it a
 * plain string starts 4px to the left of the cells above it and the whole
 * column looks broken (Mark, 2026-08-02, on a PO's sent_via).
 */
function Cell({
  canEdit,
  value,
  children,
}: {
  canEdit: boolean;
  value: string | number | null;
  children: React.ReactNode;
}) {
  if (canEdit) return <>{children}</>;
  return (
    <span className={READ_ONLY_VALUE}>
      {value === null || value === "" ? "—" : value}
    </span>
  );
}

/** Vendor names differ by punctuation and case far more often than by identity. */
/** The browser's day, for the aging chip only — the LIST computes its buckets
 *  from the org's timezone on the server, which is what the filters use. */
function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
