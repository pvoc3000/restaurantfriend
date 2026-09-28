// The special-order documents, rendered to PDF client-side with
// @react-pdf/renderer. Import this module DYNAMICALLY (await import(...)) from
// a click handler — the renderer is heavy and nothing on a normal page load
// needs it. (The `PoPdfDocs` idiom, and the same reasons.)
//
// DRAWN IN THE APP'S OWN DESIGN LANGUAGE since 2026-09-25 (Mark: "these are
// all superior to what we are currently using. Wire them to send"). They were
// drafted on /forms beside the FileMaker-faithful set they replaced; that set
// — verified against FileMaker's own PDFs for order 9885, and its notes on why
// — is in git history at ac727f0c, `SpecialOrderPdfs.tsx`.
//
//   OrderDocumentPdf    quote · invoice · receipt — ONE layout at three
//                       moments (decision 11). The invoice and receipt add a
//                       PAYMENTS block, a Payments line in the totals, the
//                       invoice footer, and a grand total that is the BALANCE
//                       ("Total due"); the quote has the terms and the
//                       signature boxes instead. `approval` fills those boxes
//                       for decision 17's signed quote (`SignedQuotePdf`).
//   KitchenOrderPdf     the production sheet: no money, grouped by size class.
//                       `kitchenOrderPages` is the same pages without a
//                       Document, for the production packet.
//   CustomerInvoicePdf  migration 124 — one row per order, itemized on a
//                       one-order invoice.
//   StatementPdf        144 — one customer's account over a period, balance forward.
//
// Each look is a rule the app already keeps on screen:
//   · The masthead is a BLACK BAND with the org's name in white tracked caps —
//     the app's masthead, not a 40pt letterhead.
//   · The record's name is the PAGE HEADING (`ui/PageHeading`: big bold caps,
//     a tracked caption under it), and each block has a SECTION HEADING.
//   · Labels are small grey tracked caps ABOVE or BESIDE black values — a
//     detail screen's `dl`. Read-only, so no boxes.
//   · The item table is `DataTable`: caption-grey column labels over a 2px
//     black rule, and NO rule between rows.
//   · Empty money is an em dash, never blank and never $0.00.
//   · Dates are ISO with the weekday (`SAT 2026-10-03`), the app's form.
//   · Prose is SENTENCE CASE — the terms were printed in capitals, which the
//     design system forbids ("never set a sentence in caps").
//   · The one BOX on the page is where the customer writes — signature and
//     date — because a box means "you fill this in".
//   · The totals sit in a Classic Mac window (black title bar, hard shadow),
//     the CalcPad's frame, and the grand total wears the ONE yellow fill —
//     EXCEPT on a settled receipt. Yellow means "look at this", and a balance
//     of $0.00 is nothing to look at; a receipt still owing keeps it.

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  DOCUMENT_LABEL,
  sizeClassGroups,
  taxonomyLine,
  usTime,
  usWeekday,
  type DocOrg,
  type DocumentKind,
  type OrderDocData,
} from "@/lib/specialOrderDocs";
import { AGING_BUCKETS, type StatementDocument, type StatementRow } from "@/lib/customerStatement";

import { customerLabel, lineTotal } from "@/lib/specialOrders";
import { PAPER_COLUMNS, type InvoiceTotalsBreakdown, type PaperRow } from "@/lib/customerInvoices";
import { dateInTimeZone, serverTimeZone } from "@/lib/today";
import {
  Field,
  HAIRLINE,
  INK,
  MARK_FILL,
  MUTED,
  STOP_FILL,
  SUBTLE,
  caps,
  docStyles,
  isoDay,
  qtyText,
} from "@/components/pdf/appDocument";

/** The three customer documents — the kitchen order is a different layout. */
export type CustomerDocumentKind = Exclude<DocumentKind, "order">;

Font.registerHyphenationCallback((word) => [word]);

const s = {
  ...docStyles,
  ...StyleSheet.create({

  /* ---- items (DataTable) ---- */
  row: { flexDirection: "row", paddingVertical: 4, alignItems: "flex-start" },
  cIndex: { width: 20, color: SUBTLE },
  cItem: { width: 170, paddingRight: 8 },
  cQty: { width: 30, textAlign: "right" },
  cPrice: { width: 48, textAlign: "right" },
  cNotes: { flexGrow: 1, flexBasis: 0, paddingLeft: 16, color: MUTED },
  cCost: { width: 60, textAlign: "right" },

  /* ---- notes + totals ---- */
  foot: { flexDirection: "row", gap: 28, marginTop: 18, alignItems: "flex-start" },
  notes: { flexGrow: 1, flexBasis: 0 },

  /* The Mac window: 1.5pt frame, black title bar, a hard 3pt shadow drawn as
     an offset black box behind it. */
  windowWrap: { width: 212, position: "relative", marginRight: 3, marginBottom: 3 },
  windowShadow: {
    position: "absolute",
    top: 3,
    left: 3,
    right: -3,
    bottom: -3,
    backgroundColor: INK,
  },
  window: { borderWidth: 1.5, borderColor: INK, backgroundColor: "#fff" },
  titleBar: {
    backgroundColor: INK,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  titleBarText: { ...caps(7, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
  totals: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalLabel: { ...caps(6.5, 0.12), color: SUBTLE, paddingTop: 1.5 },
  totalValue: { fontSize: 9, textAlign: "right" },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 2,
    borderTopColor: INK,
    backgroundColor: MARK_FILL,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  grandLabel: { ...caps(7.5, 0.12), fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 15, fontFamily: "Helvetica-Bold" },

  /* ---- payments (invoice, receipt) ---- */
  payments: { marginBottom: 16 },
  payRow: { flexDirection: "row", paddingVertical: 2.5 },
  payDate: { width: 86 },
  payWhat: { flexGrow: 1, flexBasis: 0, color: MUTED },
  payAmount: { width: 60, textAlign: "right" },
  invoiceFooter: { fontSize: 9, color: MUTED, marginTop: 22 },

  /* ---- terms + signature ---- */
  terms: { marginTop: 20 },
  lead: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  termsText: { fontSize: 7.5, lineHeight: 1.45, color: MUTED },
  signRow: { flexDirection: "row", gap: 16, marginTop: 14 },
  signField: { flexGrow: 1, flexBasis: 0 },
  signDate: { width: 150 },
  signLabel: { ...caps(6.5, 0.12), color: SUBTLE, marginBottom: 4 },
  signBox: { borderWidth: 1, borderColor: INK, height: 32, paddingHorizontal: 8, justifyContent: "center" },
  signValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  signSub: { fontSize: 7, color: MUTED, marginTop: 2 },

  /* ---- kitchen order ---- */
  stats: { flexDirection: "row", gap: 22, marginTop: 20 },
  stat: { flexGrow: 1, flexBasis: 0 },
  statValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 2 },
  statSub: { ...caps(7.5, 0.12), color: SUBTLE, marginTop: 3 },
  statMarked: { backgroundColor: MARK_FILL, paddingHorizontal: 6, paddingVertical: 3, alignSelf: "flex-start" },
  kRow: { flexDirection: "row", paddingVertical: 5, alignItems: "flex-start" },
  kQty: { width: 44, fontSize: 13, fontFamily: "Helvetica-Bold", paddingLeft: 6 },
  kItem: { width: 250, paddingRight: 12 },
  kNotes: { flexGrow: 1, flexBasis: 0, color: MUTED },
  taxonomy: { fontSize: 7.5, color: SUBTLE, marginTop: 2 },
  endOfList: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  endRule: { flexGrow: 1, borderTopWidth: 0.75, borderTopColor: HAIRLINE },
  endText: { ...caps(7, 0.12), color: SUBTLE, marginHorizontal: 10 },
  allergen: { flexDirection: "row", marginTop: 18, paddingHorizontal: 10, paddingVertical: 8 },
  allergenLabel: { ...caps(7, 0.12), fontFamily: "Helvetica-Bold", width: 118, paddingTop: 1.5 },
  allergenText: { flexGrow: 1, flexBasis: 0, fontSize: 10, fontFamily: "Helvetica-Bold" },
  handoff: { marginTop: 22 },
  boxGrid: { flexDirection: "row", gap: 16, marginBottom: 10 },
  boxCell: { flexGrow: 1, flexBasis: 0 },

  /* ---- customer invoice ---- */
  invRow: { flexDirection: "row", paddingVertical: 4, alignItems: "flex-start" },
  invDesc: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
  invAmount: { width: 80, textAlign: "right" },
  invCol: { width: 62, textAlign: "right" },
  invBand: {
    flexDirection: "row",
    backgroundColor: INK,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 8,
  },
  invBandText: { ...caps(7.5, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
  invDetail: { paddingLeft: 12 },

  /* ---- statement ---- */
  stNo: { width: 48, color: SUBTLE },
  stDate: { width: 96 },
  stTitle: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
  stMoney: { width: 70, textAlign: "right" },
  aging: { flexDirection: "row", gap: 10 },
  agingCell: { flexGrow: 1, flexBasis: 0 },
  agingLabel: { ...caps(6.5, 0.12), color: SUBTLE, marginBottom: 3 },
  agingValue: { fontSize: 9 },
  }),
};

function money(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * An approval instant as the shop reads it: `2026-09-19` and `10:42 AM PDT`,
 * in the org's zone. The signed quote is rendered in the CUSTOMER's browser,
 * so without the org's zone this printed the raw UTC instant and dated an
 * evening approval in Los Angeles the next day (fixed 2026-09-25). Falls back
 * to the rendering host's zone when the org has not set one, and to the raw
 * string if it will not parse.
 */
function approvalStamp(at: string, timeZone: string | null): { date: string; time: string } {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return { date: at.slice(0, 10), time: at };
  const zone = timeZone || serverTimeZone();
  try {
    return {
      date: dateInTimeZone(at, zone),
      time: new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(instant),
    };
  } catch {
    // An unknown zone name in settings — say so in UTC rather than throw.
    return { date: at.slice(0, 10), time: `${at.slice(11, 16)} UTC` };
  }
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.totalRow}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={value ? s.totalValue : [s.totalValue, s.empty]}>
        {value ? money(value) : "—"}
      </Text>
    </View>
  );
}

export function OrderDocumentPdf({
  orders,
  org,
  kind,
  approval,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  kind: CustomerDocumentKind;
  /** Decision 17's approval, on a quote only. */
  approval?: { name: string; at: string; reference: string } | null;
}) {
  const label = DOCUMENT_LABEL[kind];
  const showsPayments = kind !== "quote";
  return (
    <Document>
      {orders.map((order) => {
        const t = order.totals;
        const delivery = order.fulfillment === "delivery";
        const note =
          kind === "quote" ? order.notes_quote : kind === "invoice" ? order.notes_invoice : order.notes_receipt;
        const grand = kind === "quote" ? t.total : t.balance;
        const marked = !(kind === "receipt" && t.balance <= 0);
        const stamp = approval ? approvalStamp(approval.at, org.timeZone) : null;
        return (
          <Page key={order.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              <Text style={s.wordmark}>{org.name}</Text>
              <View style={s.mastheadRight}>
                {org.addressLine ? <Text style={s.mastheadLine}>{org.addressLine}</Text> : null}
                {org.contactLine ? <Text style={s.mastheadLine}>{org.contactLine}</Text> : null}
              </View>
            </View>

            <View style={s.body}>
              <View style={s.headingRow}>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
                  <Text style={s.kicker}>{label}</Text>
                  <Text style={s.h1}>{order.title || isoDay(order.event_date) || "Special order"}</Text>
                  <Text style={s.caption}>
                    {[
                      order.location_name,
                      kind === "quote" && order.date_initiated ? `Quoted ${order.date_initiated}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <View style={s.numberBlock}>
                  <Text style={s.kicker}>No.</Text>
                  <Text style={s.number}>{order.number}</Text>
                </View>
              </View>

              <View style={s.blocks}>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Event</Text>
                  <Field label="Date" value={isoDay(order.event_date)} />
                  <Field
                    label={delivery ? "Delivery" : "Pickup"}
                    value={order.event_time ? `After ${usTime(order.event_time)}` : null}
                  />
                  <Field label="Location" value={order.location_name} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Customer</Text>
                  <Field label="Name" value={order.customer ? customerLabel(order.customer) : null} />
                  <Field label="Phone" value={order.customer?.phone} />
                  <Field label="Email" value={order.customer?.email} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Contact</Text>
                  <Field label="Name" value={order.contact_name} />
                  <Field label="Phone" value={order.contact_phone} />
                  <Field label="Email" value={order.contact_email} />
                  <Field label="Address" value={order.delivery_address} />
                </View>
              </View>

              <View style={s.items}>
                <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
                  Items <Text style={s.sectionCount}>{order.lines.length}</Text>
                </Text>
                <View style={s.tableHead}>
                  <Text style={[s.th, s.cIndex]}> </Text>
                  <Text style={[s.th, s.cItem]}>Item</Text>
                  <Text style={[s.th, s.cQty]}>Qty</Text>
                  <Text style={[s.th, s.cPrice]}>Price</Text>
                  <Text style={[s.th, s.cNotes]}>Notes</Text>
                  <Text style={[s.th, s.cCost]}>Cost</Text>
                </View>
                {order.lines.map((line, i) => (
                  <View key={line.id} style={s.row} wrap={false}>
                    <Text style={s.cIndex}>{i + 1}</Text>
                    <Text style={[s.cItem, s.itemName]}>{line.name}</Text>
                    <Text style={s.cQty}>{qtyText(line.qty)}</Text>
                    <Text style={s.cPrice}>{money(line.unit_price)}</Text>
                    <Text style={s.cNotes}>{line.notes ?? ""}</Text>
                    <Text style={s.cCost}>{money(lineTotal(line))}</Text>
                  </View>
                ))}
              </View>

              <View style={s.foot} wrap={false}>
                <View style={s.notes}>
                  {showsPayments ? (
                    <View style={s.payments}>
                      <Text style={s.sectionHead}>
                        Payments <Text style={s.sectionCount}>{order.payments.length}</Text>
                      </Text>
                      {order.payments.length === 0 ? (
                        <Text style={[s.prose, s.empty]}>—</Text>
                      ) : (
                        order.payments.map((p, i) => (
                          <View key={i} style={s.payRow}>
                            <Text style={s.payDate}>{isoDay(p.paid_on) || "—"}</Text>
                            <Text style={s.payWhat}>
                              {[p.payment_type, p.note].filter(Boolean).join(" · ")}
                            </Text>
                            <Text style={s.payAmount}>{money(Number(p.amount) || 0)}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                  <Text style={s.sectionHead}>Notes</Text>
                  {note ? (
                    <Text style={s.prose}>{note}</Text>
                  ) : (
                    <Text style={[s.prose, s.empty]}>—</Text>
                  )}
                </View>
                <View style={s.windowWrap}>
                  <View style={s.windowShadow} />
                  <View style={s.window}>
                    <View style={s.titleBar}>
                      <Text style={s.titleBarText}>Totals</Text>
                    </View>
                    <View style={s.totals}>
                      <TotalRow label="Subtotal" value={t.subtotal} />
                      <TotalRow label="Discount" value={t.discount ? -t.discount : 0} />
                      <TotalRow label="Delivery" value={t.deliveryCharge} />
                      <TotalRow label="Rush fee" value={t.rushFee} />
                      <TotalRow label="Tax" value={t.tax} />
                      {showsPayments ? (
                        <TotalRow label="Payments" value={t.paid ? -t.paid : 0} />
                      ) : null}
                    </View>
                    <View style={marked ? s.grand : [s.grand, { backgroundColor: "#fff" }]}>
                      <Text style={s.grandLabel}>{kind === "quote" ? "Total quote" : "Total due"}</Text>
                      <Text style={s.grandValue}>{money(grand)}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {showsPayments && org.invoiceFooter ? (
                <Text style={s.invoiceFooter}>{org.invoiceFooter}</Text>
              ) : null}

              {kind === "quote" && org.terms ? (
                <View style={s.terms} wrap={false}>
                  <Text style={s.sectionHead}>Terms</Text>
                  <Text style={s.lead}>To go ahead with your order, please read and sign below.</Text>
                  <Text style={s.termsText}>{org.terms}</Text>

                  <View style={s.signRow}>
                    <View style={s.signField}>
                      <Text style={s.signLabel}>Signature</Text>
                      <View style={s.signBox}>
                        {approval ? (
                          <>
                            <Text style={s.signValue}>Approved online by {approval.name}</Text>
                            <Text style={s.signSub}>
                              {stamp?.date} · {stamp?.time} · reference {approval.reference}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                    <View style={s.signDate}>
                      <Text style={s.signLabel}>Date</Text>
                      <View style={s.signBox}>
                        {stamp ? <Text style={s.signValue}>{stamp.date}</Text> : null}
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={s.footer} fixed>
              <Text style={s.footerText}>
                {org.name} · {label} {order.number}
              </Text>
              <Text
                style={s.footerText}
                render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

/* ==========================================================================
 * THE KITCHEN ORDER
 * ========================================================================== */

/** A box somebody writes in — the signature box's dress, with an optional
 *  value already printed where the record knows it. */
function WriteBox({ label, value }: { label: string; value?: string | number | null }) {
  const v = value === null || value === undefined ? "" : String(value);
  return (
    <View style={s.boxCell}>
      <Text style={s.signLabel}>{label}</Text>
      <View style={s.signBox}>{v ? <Text style={s.signValue}>{v}</Text> : null}</View>
    </View>
  );
}

/**
 * The production sheet in the app's language (Mark, 2026-09-25). NO MONEY, as
 * on the original — a decorator is being told what to make — and `Misc` lines
 * never reach it (`sizeClassGroups`).
 *
 * What the record KNOWS prints as fields; what the kitchen WRITES is a box
 * (completed by, received, and the tracking number and box count when the
 * record does not have them yet). The size classes are `DataTable`'s black
 * group bands. The pickup time keeps the sheet's one yellow fill — it is the
 * fact somebody misses — and an allergen warning takes the red "stop" fill,
 * because it is one.
 */
export function KitchenOrderPdf({
  orders,
  org,
  printedOn,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  /**
   * The org's calendar day, as `YYYY-MM-DD` — what AS OF means: the day this
   * came off the printer, so a decorator holding two copies knows which is
   * later. Passed in rather than taken from `new Date()` here, for
   * `lib/today`'s reason: a browser in another zone dates the sheet wrong.
   */
  printedOn?: string;
}) {
  return <Document>{kitchenOrderPages(orders, org.name, printedOn)}</Document>;
}

/**
 * The same pages WITHOUT a `<Document>` around them, so the production packet
 * can carry them. A FUNCTION RETURNING AN ARRAY, not a component: `<Document>`
 * accepts arrays of Pages, and `ProductionPacketPdfs` documents that a real
 * Fragment confuses the reconciler on some versions.
 */
export function kitchenOrderPages(
  orders: OrderDocData[],
  orgName: string,
  printedOn?: string
): React.ReactElement[] {
  return orders.map((order) => {
        const groups = sizeClassGroups(order.lines);
        const delivery = order.fulfillment === "delivery";
        const time = usTime(order.ready_by_time ?? order.event_time);
        const asOf = printedOn ?? order.event_date;
        return (
          <Page key={order.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              <Text style={s.wordmark}>{orgName}</Text>
              <View style={s.mastheadRight}>
                <Text style={s.mastheadLine}>Kitchen order {order.number}</Text>
                {asOf ? <Text style={s.mastheadLine}>As of {asOf}</Text> : null}
              </View>
            </View>

            <View style={s.body}>
              <View style={s.headingRow}>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
                  <Text style={s.kicker}>Kitchen order</Text>
                  <Text style={s.h1}>{order.title || isoDay(order.event_date) || "Special order"}</Text>
                  <Text style={s.caption}>{order.location_name ?? ""}</Text>
                </View>
                <View style={s.numberBlock}>
                  <Text style={s.kicker}>No.</Text>
                  <Text style={s.number}>{order.number}</Text>
                </View>
              </View>

              <View style={s.stats}>
                <View style={s.stat}>
                  <Text style={s.sectionHead}>Kitchen</Text>
                  <Text style={s.statValue}>{order.kitchen_code ?? "—"}</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.sectionHead}>Day</Text>
                  <Text style={s.statValue}>{usWeekday(order.event_date).toUpperCase() || "—"}</Text>
                  <Text style={s.statSub}>{order.event_date ?? ""}</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.sectionHead}>{delivery ? "Delivery time" : "Pickup time"}</Text>
                  <View style={s.statMarked}>
                    <Text style={[s.statValue, { marginTop: 0 }]}>{time || "—"}</Text>
                  </View>
                  <Text style={s.statSub}>{order.location_code ?? ""}</Text>
                </View>
              </View>

              {/* UP HERE, not after the list where the original prints it: on
                  a two-page order that put it on page 2, and it is the one line
                  on the sheet nobody can afford to miss. */}
              <View
                style={
                  order.allergen_info
                    ? [s.allergen, { backgroundColor: STOP_FILL }]
                    : [s.allergen, { borderWidth: 0.75, borderColor: HAIRLINE }]
                }
              >
                <Text style={s.allergenLabel}>Allergen warning</Text>
                <Text style={order.allergen_info ? s.allergenText : [s.allergenText, s.empty]}>
                  {order.allergen_info || "None"}
                </Text>
              </View>

              <View style={s.blocks}>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Order</Text>
                  <Field label="Taken by" value={order.taken_by} />
                  <Field label="Taken" value={order.date_initiated} />
                  <Field label="Handoff" value={delivery ? "Delivery" : "Pickup"} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Contact</Text>
                  <Field label="Name" value={order.contact_name ?? customerLabel(order.customer)} />
                  <Field label="Phone" value={order.contact_phone ?? order.customer?.phone} />
                  <Field label="Email" value={order.contact_email ?? order.customer?.email} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Event</Text>
                  <Field label="Date" value={isoDay(order.event_date)} />
                  <Field label="Time" value={usTime(order.event_time)} />
                  {delivery ? <Field label="Address" value={order.delivery_address} /> : null}
                </View>
              </View>

              <View style={s.items}>
                <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
                  Items{" "}
                  <Text style={s.sectionCount}>{groups.reduce((a, g) => a + g.lines.length, 0)}</Text>
                </Text>
                <View style={s.tableHead} fixed>
                  <Text style={[s.th, { width: 44, paddingLeft: 6 }]}>Qty</Text>
                  <Text style={[s.th, s.kItem]}>Item</Text>
                  <Text style={[s.th, s.kNotes]}>Notes</Text>
                </View>
                {groups.map((group) => (
                  <View key={group.label}>
                    <Text style={s.groupBand}>{group.label}</Text>
                    {group.lines.map((line) => (
                      <View key={line.id} style={s.kRow} wrap={false}>
                        <Text style={s.kQty}>{qtyText(line.qty)}</Text>
                        <View style={s.kItem}>
                          <Text style={s.itemName}>{line.name}</Text>
                          <Text style={s.taxonomy}>{taxonomyLine(line)}</Text>
                        </View>
                        <Text style={s.kNotes}>{line.notes ?? ""}</Text>
                      </View>
                    ))}
                  </View>
                ))}

                <View style={s.endOfList}>
                  <View style={s.endRule} />
                  <Text style={s.endText}>End of list</Text>
                  <View style={s.endRule} />
                </View>
              </View>

              <View wrap={false}>
                {order.notes_production ? (
                  <View style={{ marginTop: 16 }}>
                    <Text style={s.sectionHead}>Notes</Text>
                    <Text style={s.prose}>{order.notes_production}</Text>
                  </View>
                ) : null}

                <View style={s.handoff}>
                  <Text style={s.sectionHead}>Handoff</Text>
                  <View style={s.boxGrid}>
                    <WriteBox label="Order completed by" />
                    <WriteBox label="Number of boxes" value={order.delivery_boxes} />
                    <WriteBox label="Delivery tracking #" value={order.delivery_tracking} />
                  </View>
                  <View style={s.boxGrid}>
                    <WriteBox label="Received" />
                    <WriteBox label="Date & time" />
                  </View>
                </View>
              </View>
            </View>

            <View style={s.footer} fixed>
              <Text style={s.footerText}>
                {orgName} · Kitchen order {order.number}
              </Text>
              <Text
                style={s.footerText}
                render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              />
            </View>
          </Page>
    );
  });
}

/* ==========================================================================
 * THE CUSTOMER INVOICE (migration 124)
 * ========================================================================== */

/**
 * THE CUSTOMER INVOICE (migration 124) — one invoice, a row per ORDER (Mark,
 * 2026-09-23), worded like the pay page ("Order #SO-10057 · Cafe Knotted ·
 * 10/5/2026"). Since 2026-09-27 its money is in COLUMNS — Subtotal, Discount,
 * Delivery, Rush fee, Tax — each adding up to its line in the Totals window
 * (`invoicePaper`, lib/customerInvoices). The amounts are the invoice's own
 * frozen lines, never re-derived here: this is the paper the customer was sent.
 */
export type CustomerInvoiceDoc = {
  number: string;
  issued_on: string;
  due_on: string | null;
  notes: string | null;
  customer: { name: string; phone: string | null; email: string | null };
  /** The money in columns (several orders); else one order, itemized. */
  columns: boolean;
  lines: PaperRow[];
  /** The Totals window (2026-09-27): `invoiceTotalsBreakdown`. */
  totals: InvoiceTotalsBreakdown;
  total: number;
  paid: number;
  balance: number;
};


/**
 * The customer invoice in the app's language (Mark, 2026-09-25):
 * one row per ORDER on a weekly invoice; on a one-order invoice that order is
 * ITEMIZED — here under `DataTable`'s black group band, its items beneath.
 * The Totals window reads like an order's: Subtotal, Discount, Delivery, Rush
 * fee, Tax and Payments, summed over every order (2026-09-27).
 * The customer is the heading, because an invoice is addressed to someone.
 * Amount due wears the one yellow fill, which leaves once it is settled — the
 * receipt's rule.
 */
export function CustomerInvoicePdf({
  invoice,
  org,
}: {
  invoice: CustomerInvoiceDoc;
  org: DocOrg;
}) {
  const settled = invoice.balance <= 0;
  const orderRows = invoice.lines.filter((l) => !l.free);
  const chargeRows = invoice.lines.filter((l) => l.free);
  const orderCount = orderRows.length;
  // The columns something on this invoice uses; Subtotal always.
  const shown = PAPER_COLUMNS.filter(
    (c) => c.key === "subtotal" || invoice.lines.some((l) => Math.abs(l.parts?.[c.key] ?? 0) >= 0.005)
  );
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.masthead} fixed>
          <Text style={s.wordmark}>{org.name}</Text>
          <View style={s.mastheadRight}>
            {org.addressLine ? <Text style={s.mastheadLine}>{org.addressLine}</Text> : null}
            {org.contactLine ? <Text style={s.mastheadLine}>{org.contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.body}>
          <View style={s.headingRow}>
            <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
              <Text style={s.kicker}>Invoice</Text>
              <Text style={s.h1}>{invoice.customer.name}</Text>
              <Text style={s.caption}>
                {[
                  invoice.issued_on ? `Issued ${invoice.issued_on}` : null,
                  invoice.due_on ? `Due ${isoDay(invoice.due_on)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <View style={s.numberBlock}>
              <Text style={s.kicker}>No.</Text>
              <Text style={s.number}>{invoice.number}</Text>
            </View>
          </View>

          <View style={s.blocks}>
            <View style={s.block}>
              <Text style={s.sectionHead}>Bill to</Text>
              <Field label="Name" value={invoice.customer.name} />
              <Field label="Phone" value={invoice.customer.phone} />
              <Field label="Email" value={invoice.customer.email} />
            </View>
            <View style={s.block}>
              <Text style={s.sectionHead}>Invoice</Text>
              <Field label="Number" value={invoice.number} />
              <Field label="Issued" value={isoDay(invoice.issued_on)} />
              <Field label="Due" value={isoDay(invoice.due_on)} />
            </View>
          </View>

          {/* ORDERS, then OTHER CHARGES — two sections headed alike (Mark,
              2026-09-27: "make the 'other charges' header the same formatting
              as 'order'"), each with its own column labels. */}
          {[
            { title: orderCount === 1 ? "Order" : "Orders", first: invoice.columns ? "Order" : "Item", rows: orderRows },
            { title: "Other charges", first: "Charge", rows: chargeRows },
          ]
            .filter((sec) => sec.rows.length > 0)
            .map((sec) => (
              <View key={sec.title} style={s.items}>
                <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
                  {sec.title} <Text style={s.sectionCount}>{sec.rows.length}</Text>
                </Text>
                <View style={s.tableHead} fixed>
                  <Text style={[s.th, s.invDesc]}>{sec.first}</Text>
                  {invoice.columns ? (
                    shown.map((c) => (
                      <Text key={c.key} style={[s.th, s.invCol]}>{c.label}</Text>
                    ))
                  ) : (
                    <Text style={[s.th, s.invAmount]}>Amount</Text>
                  )}
                </View>
                {sec.rows.map((l, i) =>
                  l.detail && !invoice.columns ? (
                    <View key={i}>
                      <View style={s.invBand} wrap={false}>
                        <Text style={[s.invBandText, s.invDesc]}>{l.description}</Text>
                      </View>
                      {l.detail.rows.map((r, j) => (
                        <View key={j} style={[s.invRow, s.invDetail]} wrap={false}>
                          <Text style={[s.invDesc, r.amount < 0 ? { color: MUTED } : {}]}>{r.label}</Text>
                          <Text style={[s.invAmount, r.amount < 0 ? { color: MUTED } : {}]}>
                            {r.amount ? money(r.amount) : "—"}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View key={i} style={s.invRow} wrap={false}>
                      <Text style={s.invDesc}>{l.description}</Text>
                      {invoice.columns ? (
                        shown.map((c) => {
                          const v = l.parts?.[c.key] ?? 0;
                          return (
                            <Text key={c.key} style={v ? (v < 0 ? [s.invCol, { color: MUTED }] : s.invCol) : [s.invCol, s.empty]}>
                              {v ? money(v) : "—"}
                            </Text>
                          );
                        })
                      ) : (
                        <Text style={s.invAmount}>{money(l.amount)}</Text>
                      )}
                    </View>
                  )
                )}
              </View>
            ))}

          <View style={s.foot} wrap={false}>
            <View style={s.notes}>
              <Text style={s.sectionHead}>Notes</Text>
              {invoice.notes ? (
                <Text style={s.prose}>{invoice.notes}</Text>
              ) : (
                <Text style={[s.prose, s.empty]}>—</Text>
              )}
            </View>
            <View style={s.windowWrap}>
              <View style={s.windowShadow} />
              <View style={s.window}>
                <View style={s.titleBar}>
                  <Text style={s.titleBarText}>Totals</Text>
                </View>
                <View style={s.totals}>
                  <TotalRow label="Subtotal" value={invoice.totals.subtotal} />
                  <TotalRow label="Discount" value={invoice.totals.discount ? -invoice.totals.discount : 0} />
                  <TotalRow label="Delivery" value={invoice.totals.delivery} />
                  <TotalRow label="Rush fee" value={invoice.totals.rush} />
                  <TotalRow label="Tax" value={invoice.totals.tax} />
                  {/* "Less invoice N" (141) — only when an order is billed
                      partly on another invoice, a deposit's before its balance. */}
                  {invoice.totals.prior ? (
                    <TotalRow label="Invoiced earlier" value={-invoice.totals.prior} />
                  ) : null}
                  <TotalRow label="Payments" value={invoice.totals.payments ? -invoice.totals.payments : 0} />
                </View>
                <View style={settled ? [s.grand, { backgroundColor: "#fff" }] : s.grand}>
                  <Text style={s.grandLabel}>Amount due</Text>
                  <Text style={s.grandValue}>{money(invoice.balance)}</Text>
                </View>
              </View>
            </View>
          </View>

          {org.invoiceFooter ? <Text style={s.invoiceFooter}>{org.invoiceFooter}</Text> : null}
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {org.name} · Invoice {invoice.number}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/* ==========================================================================
 * THE STATEMENT (migration 144)
 * ========================================================================== */

/**
 * A BALANCE-FORWARD STATEMENT, the textbook one (Mark, 2026-09-27): what the
 * customer owed when the period began, every invoice and payment in it with
 * the balance after each, and what they owe at its end — then the invoices
 * still open and how late they are. It was one row per ORDER (decision 21)
 * while orders were the bill; invoices are the bill now.
 *
 * A refund is a charge (money back to them raises what they owe); a voided
 * invoice stays on the paper at no charge, so a number they were sent is
 * accounted for. Balance due keeps the yellow until settled, and a customer
 * in credit reads CREDIT, not a minus sign.
 */
export function StatementPdf({
  statement: doc,
  org,
}: {
  statement: StatementDocument;
  org: DocOrg;
}) {
  const st = doc.statement;
  const name = customerLabel(doc.customer);
  const invoiceCount = st.rows.filter((r) => r.kind === "invoice").length;
  const paymentCount = st.rows.filter((r) => r.kind === "payment" || r.kind === "refund").length;
  const settled = st.closing <= 0.005;
  const inCredit = st.closing < -0.005;
  const activity = (r: StatementRow): string => {
    if (r.invoice) {
      return r.kind === "void"
        ? `Invoice ${r.invoice.label} · void`
        : `Invoice ${r.invoice.label}${r.invoice.due_on ? ` · due ${isoDay(r.invoice.due_on)}` : ""}`;
    }
    const p = r.payment;
    return [
      r.kind === "refund" ? "Refund" : "Payment",
      p?.type,
      p?.paid.length ? `invoice ${p.paid.join(", ")}` : null,
      p?.credit ? `${money(p.credit)} credit` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const cell = (value: number) => (
    <Text style={value ? s.stMoney : [s.stMoney, s.empty]}>{value ? money(value) : "—"}</Text>
  );
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.masthead} fixed>
          <Text style={s.wordmark}>{org.name}</Text>
          <View style={s.mastheadRight}>
            {org.addressLine ? <Text style={s.mastheadLine}>{org.addressLine}</Text> : null}
            {org.contactLine ? <Text style={s.mastheadLine}>{org.contactLine}</Text> : null}
          </View>
        </View>

        <View style={s.body}>
          <View>
            <Text style={s.kicker}>Statement</Text>
            <Text style={s.h1}>{name}</Text>
            <Text style={s.caption}>
              {st.from} – {st.to} · {invoiceCount} {invoiceCount === 1 ? "invoice" : "invoices"} ·{" "}
              {paymentCount} {paymentCount === 1 ? "payment" : "payments"}
            </Text>
          </View>

          <View style={s.blocks}>
            <View style={s.block}>
              <Text style={s.sectionHead}>Customer</Text>
              <Field label="Name" value={name} />
              <Field label="Phone" value={doc.customer?.phone} />
              <Field label="Email" value={doc.customer?.email} />
            </View>
            <View style={s.block}>
              <Text style={s.sectionHead}>Account</Text>
              <Field label="From" value={isoDay(st.from)} />
              <Field label="To" value={isoDay(st.to)} />
              <Field label="Opening" value={money(st.opening)} />
            </View>
          </View>

          <View style={s.items}>
            <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
              Activity <Text style={s.sectionCount}>{st.rows.length}</Text>
            </Text>
            <View style={s.tableHead} fixed>
              <Text style={[s.th, s.stDate]}>Date</Text>
              <Text style={[s.th, s.stTitle]}>Activity</Text>
              <Text style={[s.th, s.stMoney]}>Charges</Text>
              <Text style={[s.th, s.stMoney]}>Payments</Text>
              <Text style={[s.th, s.stMoney]}>Balance</Text>
            </View>
            <View style={s.invRow} wrap={false}>
              <Text style={s.stDate}>{isoDay(st.from)}</Text>
              <Text style={[s.stTitle, { color: MUTED }]}>Opening balance</Text>
              <Text style={[s.stMoney, s.empty]}>—</Text>
              <Text style={[s.stMoney, s.empty]}>—</Text>
              <Text style={s.stMoney}>{money(st.opening)}</Text>
            </View>
            {st.rows.map((r, i) => (
              <View key={i} style={s.invRow} wrap={false}>
                <Text style={s.stDate}>{isoDay(r.date) || "—"}</Text>
                <Text style={r.kind === "void" ? [s.stTitle, { color: MUTED }] : s.stTitle}>{activity(r)}</Text>
                {cell(r.kind === "refund" ? -r.paid : r.charge)}
                {cell(r.kind === "refund" ? 0 : r.paid)}
                <Text style={s.stMoney}>{money(r.balance)}</Text>
              </View>
            ))}
            {st.rows.length === 0 ? (
              <Text style={[s.prose, s.empty, { marginTop: 8 }]}>No invoices or payments in this period.</Text>
            ) : null}
          </View>

          {st.open.length > 0 ? (
            <View style={s.items}>
              <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
                Open invoices <Text style={s.sectionCount}>{st.open.length}</Text>
              </Text>
              <View style={s.tableHead} fixed>
                <Text style={[s.th, s.stNo]}>Invoice</Text>
                <Text style={[s.th, s.stDate]}>Issued</Text>
                <Text style={[s.th, s.stDate]}>Due</Text>
                <Text style={[s.th, s.stTitle]}>Late</Text>
                <Text style={[s.th, s.stMoney]}>Balance</Text>
              </View>
              {st.open.map((o) => (
                <View key={o.id} style={s.invRow} wrap={false}>
                  <Text style={s.stNo}>{o.label}</Text>
                  <Text style={s.stDate}>{isoDay(o.issued_on)}</Text>
                  <Text style={s.stDate}>{isoDay(o.due_on) || "—"}</Text>
                  <Text style={o.daysPastDue > 0 ? s.stTitle : [s.stTitle, s.empty]}>
                    {o.daysPastDue > 0 ? `${o.daysPastDue} ${o.daysPastDue === 1 ? "day" : "days"}` : "—"}
                  </Text>
                  <Text style={s.stMoney}>{money(o.balance)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={s.items} wrap={false}>
            <Text style={s.sectionHead}>Aging · {isoDay(st.to)}</Text>
            <View style={s.aging}>
              {AGING_BUCKETS.map((b) => (
                <View key={b.key} style={s.agingCell}>
                  <Text style={s.agingLabel}>{b.label}</Text>
                  <Text style={st.aging[b.key] ? s.agingValue : [s.agingValue, s.empty]}>
                    {st.aging[b.key] ? money(st.aging[b.key]) : "—"}
                  </Text>
                </View>
              ))}
              {/* What the columns come to, less this, is the balance due. */}
              <View style={s.agingCell}>
                <Text style={s.agingLabel}>Credit</Text>
                <Text style={st.credit > 0.005 ? s.agingValue : [s.agingValue, s.empty]}>
                  {st.credit > 0.005 ? money(-st.credit) : "—"}
                </Text>
              </View>
            </View>
          </View>

          <View style={s.foot} wrap={false}>
            <View style={s.notes}>
              {org.invoiceFooter ? <Text style={[s.prose, { color: MUTED }]}>{org.invoiceFooter}</Text> : null}
            </View>
            <View style={s.windowWrap}>
              <View style={s.windowShadow} />
              <View style={s.window}>
                <View style={s.titleBar}>
                  <Text style={s.titleBarText}>Totals</Text>
                </View>
                <View style={s.totals}>
                  <TotalRow label="Opening" value={st.opening} />
                  <TotalRow label="Charges" value={st.charges} />
                  <TotalRow label="Payments" value={st.payments ? -st.payments : 0} />
                </View>
                <View style={settled ? [s.grand, { backgroundColor: "#fff" }] : s.grand}>
                  <Text style={s.grandLabel}>{inCredit ? "Credit" : "Balance due"}</Text>
                  <Text style={s.grandValue}>{money(Math.abs(st.closing))}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {org.name} · Statement {st.from} – {st.to}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/** Convenience for the callers that pick a renderer by kind. */
export function documentElement(
  kind: DocumentKind,
  orders: OrderDocData[],
  org: DocOrg,
  approval?: { name: string; at: string; reference: string } | null,
  /** The org's today, for the kitchen sheet's AS OF line. */
  printedOn?: string
) {
  if (kind === "order") return <KitchenOrderPdf orders={orders} org={org} printedOn={printedOn} />;
  return <OrderDocumentPdf orders={orders} org={org} kind={kind} approval={approval} />;
}
