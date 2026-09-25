// THE QUOTE, INVOICE AND RECEIPT, REDRAWN IN THE APP'S OWN LANGUAGE — a
// proposal on /forms (Mark, 2026-09-25: "using the design language of the app
// … make it look like our app", the quote first, then "the invoice and receipt
// in the same style"). NOT wired to Send; `OrderDocumentPdf` is still what
// customers get.
//
// ONE LAYOUT AT THREE MOMENTS, as there (decision 11), and varying in the same
// places: the invoice and receipt add a PAYMENTS block, a Payments line in the
// totals, the invoice footer, and a grand total that is the BALANCE ("Total
// due"); the quote has the terms and the signature boxes instead.
//
// Same data, same fields, same order of reading as the FileMaker-faithful
// documents. What changes is how they look, and each change is a rule the app
// already keeps on screen:
//
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
  type OrderDocData,
} from "@/lib/specialOrderDocs";

/** The three customer documents — the kitchen order is a different layout. */
export type AppStyleKind = "quote" | "invoice" | "receipt";
import { customerLabel, lineTotal } from "@/lib/specialOrders";
import type { CustomerInvoiceDoc } from "@/components/specialOrders/pdf/SpecialOrderPdfs";

Font.registerHyphenationCallback((word) => [word]);

/* The app's tokens, in print. */
const INK = "#000000";
const MUTED = "#545454"; // --rf-neutral-600, secondary text
const SUBTLE = "#757575"; // --rf-neutral-500, captions and labels
const HAIRLINE = "#e4e4e4"; // --rf-neutral-200
const MARK_FILL = "#ffe98a"; // --rf-yellow-200
const STOP_FILL = "#ffcfc9"; // --rf-red-200, "stop"

/* Tracking, as the app sets it: +0.06em for names and commands, +0.12em for
   labels. react-pdf takes letterSpacing in points, so it is per size. */
const caps = (size: number, em: number) => ({
  fontSize: size,
  letterSpacing: size * em,
  textTransform: "uppercase" as const,
});

const PAGE_X = 40;

const s = StyleSheet.create({
  page: {
    // The masthead is ABSOLUTE and fixed, so it sits on every page without
    // pushing the flow; the page's own top padding clears it.
    paddingTop: 40 + 20,
    paddingBottom: 44,
    paddingHorizontal: 0,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },

  /* ---- masthead ---- */
  masthead: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: INK,
    paddingHorizontal: PAGE_X,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { ...caps(13, 0.06), fontFamily: "Helvetica-Bold", color: "#fff" },
  mastheadRight: { alignItems: "flex-end" },
  mastheadLine: { ...caps(6.5, 0.12), color: "#fff", marginTop: 1.5 },

  body: { paddingHorizontal: PAGE_X },

  /* ---- page heading ---- */
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { ...caps(7.5, 0.12), color: SUBTLE },
  h1: {
    ...caps(22, -0.02),
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
    lineHeight: 1.1,
  },
  caption: { ...caps(7.5, 0.12), color: SUBTLE, marginTop: 5 },
  numberBlock: { alignItems: "flex-end" },
  number: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 3 },

  /* ---- section heading (ui/SectionHeading) ---- */
  sectionHead: {
    ...caps(9, 0.08),
    fontFamily: "Helvetica-Bold",
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: INK,
    marginBottom: 7,
  },
  sectionCount: { color: SUBTLE, fontFamily: "Helvetica" },

  /* ---- field blocks ---- */
  blocks: { flexDirection: "row", gap: 22, marginTop: 20 },
  block: { flexGrow: 1, flexBasis: 0 },
  field: { flexDirection: "row", marginBottom: 4 },
  label: { ...caps(6.5, 0.12), color: SUBTLE, width: 54, paddingTop: 1.5 },
  // NO lineHeight on a flexBasis-0 column: react-pdf then reserves an extra
  // line of height under it (measured 2026-09-25), which opened a blank line
  // under every item that carried a note.
  value: { flexGrow: 1, flexBasis: 0, fontSize: 9 },
  empty: { color: SUBTLE },

  /* ---- items (DataTable) ---- */
  items: { marginTop: 20 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: INK,
    paddingBottom: 4,
  },
  th: { ...caps(6.5, 0.12), color: SUBTLE },
  row: { flexDirection: "row", paddingVertical: 4, alignItems: "flex-start" },
  cIndex: { width: 20, color: SUBTLE },
  cItem: { width: 170, paddingRight: 8 },
  cQty: { width: 30, textAlign: "right" },
  cPrice: { width: 48, textAlign: "right" },
  cNotes: { flexGrow: 1, flexBasis: 0, paddingLeft: 16, color: MUTED },
  cCost: { width: 60, textAlign: "right" },
  itemName: { ...caps(8.5, 0.06), fontFamily: "Helvetica-Bold" },

  /* ---- notes + totals ---- */
  foot: { flexDirection: "row", gap: 28, marginTop: 18, alignItems: "flex-start" },
  notes: { flexGrow: 1, flexBasis: 0 },
  prose: { fontSize: 9, color: INK },

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

  /* ---- footer ---- */
  footer: {
    position: "absolute",
    bottom: 20,
    left: PAGE_X,
    right: PAGE_X,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
  },
  footerText: { ...caps(6.5, 0.12), color: SUBTLE },

  /* ---- kitchen order ---- */
  stats: { flexDirection: "row", gap: 22, marginTop: 20 },
  stat: { flexGrow: 1, flexBasis: 0 },
  statValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 2 },
  statSub: { ...caps(7.5, 0.12), color: SUBTLE, marginTop: 3 },
  statMarked: { backgroundColor: MARK_FILL, paddingHorizontal: 6, paddingVertical: 3, alignSelf: "flex-start" },
  /* DataTable's group band: black, white caps. */
  groupBand: {
    ...caps(7.5, 0.12),
    fontFamily: "Helvetica-Bold",
    color: "#fff",
    backgroundColor: INK,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 8,
  },
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
  invBand: {
    flexDirection: "row",
    backgroundColor: INK,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 8,
  },
  invBandText: { ...caps(7.5, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
  invDetail: { paddingLeft: 12 },
  invSum: { borderTopWidth: 1, borderTopColor: INK, marginTop: 2 },
});

function money(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function qtyText(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2)));
}

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** `2026-10-03` → `SAT 2026-10-03` — the app's ISO date with its weekday. */
function isoDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${WEEKDAY[day]} ${m[0]}`;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = (value ?? "").trim();
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text style={v ? s.value : [s.value, s.empty]}>{v || "—"}</Text>
    </View>
  );
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

export function OrderDocumentAppStylePdf({
  orders,
  org,
  kind,
  approval,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  kind: AppStyleKind;
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
                              {approval.at} · reference {approval.reference}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                    <View style={s.signDate}>
                      <Text style={s.signLabel}>Date</Text>
                      <View style={s.signBox}>
                        {approval ? <Text style={s.signValue}>{approval.at.slice(0, 10)}</Text> : null}
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
export function KitchenOrderAppStylePdf({
  orders,
  org,
  printedOn,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  /** The org's today, `YYYY-MM-DD` — what AS OF means (see `KitchenOrderPdf`). */
  printedOn?: string;
}) {
  return (
    <Document>
      {orders.map((order) => {
        const groups = sizeClassGroups(order.lines);
        const delivery = order.fulfillment === "delivery";
        const time = usTime(order.ready_by_time ?? order.event_time);
        const asOf = printedOn ?? order.event_date;
        return (
          <Page key={order.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              <Text style={s.wordmark}>{org.name}</Text>
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
                {org.name} · Kitchen order {order.number}
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
 * THE CUSTOMER INVOICE (migration 124)
 * ========================================================================== */

/**
 * `CustomerInvoicePdf` in the app's language (Mark, 2026-09-25). Same data:
 * one row per ORDER on a weekly invoice; on a one-order invoice that order is
 * ITEMIZED — here under `DataTable`'s black group band, its items, discount,
 * delivery, rush, tax and earlier payments beneath, closed by "This order".
 * The customer is the heading, because an invoice is addressed to someone.
 * Amount due wears the one yellow fill, which leaves once it is settled — the
 * receipt's rule.
 */
export function CustomerInvoiceAppStylePdf({
  invoice,
  org,
}: {
  invoice: CustomerInvoiceDoc;
  org: DocOrg;
}) {
  const settled = invoice.balance <= 0;
  const orderCount = invoice.lines.length;
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

          <View style={s.items}>
            <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
              {orderCount === 1 ? "Order" : "Orders"} <Text style={s.sectionCount}>{orderCount}</Text>
            </Text>
            <View style={s.tableHead} fixed>
              <Text style={[s.th, s.invDesc]}>{orderCount === 1 ? "Item" : "Order"}</Text>
              <Text style={[s.th, s.invAmount]}>Amount</Text>
            </View>
            {invoice.lines.map((l, i) =>
              l.detail ? (
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
                  <View style={[s.invRow, s.invDetail, s.invSum]} wrap={false}>
                    <Text style={[s.invDesc, s.itemName]}>This order</Text>
                    <Text style={[s.invAmount, { fontFamily: "Helvetica-Bold" }]}>{money(l.amount)}</Text>
                  </View>
                </View>
              ) : (
                <View key={i} style={s.invRow} wrap={false}>
                  <Text style={s.invDesc}>{l.description}</Text>
                  <Text style={s.invAmount}>{money(l.amount)}</Text>
                </View>
              )
            )}
          </View>

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
                  <TotalRow label="Total" value={invoice.total} />
                  <TotalRow label="Payments" value={invoice.paid ? -invoice.paid : 0} />
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
