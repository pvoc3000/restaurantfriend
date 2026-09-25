// THE QUOTE, REDRAWN IN THE APP'S OWN LANGUAGE — a proposal on /forms (Mark,
// 2026-09-25: "using the design language of the app … make it look like our
// app"). NOT wired to Send; `OrderDocumentPdf` is still what customers get.
//
// Same data, same fields, same order of reading as the FileMaker-faithful
// quote. What changes is how it looks, and each change is a rule the app
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
//     the CalcPad's frame, and the grand total wears the ONE yellow fill.

import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  usTime,
  type DocOrg,
  type OrderDocData,
} from "@/lib/specialOrderDocs";
import { customerLabel, lineTotal } from "@/lib/specialOrders";

Font.registerHyphenationCallback((word) => [word]);

/* The app's tokens, in print. */
const INK = "#000000";
const MUTED = "#545454"; // --rf-neutral-600, secondary text
const SUBTLE = "#757575"; // --rf-neutral-500, captions and labels
const HAIRLINE = "#e4e4e4"; // --rf-neutral-200
const MARK_FILL = "#ffe98a"; // --rf-yellow-200

/* Tracking, as the app sets it: +0.06em for names and commands, +0.12em for
   labels. react-pdf takes letterSpacing in points, so it is per size. */
const caps = (size: number, em: number) => ({
  fontSize: size,
  letterSpacing: size * em,
  textTransform: "uppercase" as const,
});

const PAGE_X = 40;

/** Width ÷ height of `public/logo-wordmark-white.png` (2000 × 216 as drawn). */
const LOGO_ASPECT = 2000 / 216;

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
  /* The org's WORDMARK takes the typed name's place on the band (Mark,
     2026-09-25: "use this in place of the mark and remove the text"). WHITE
     ON TRANSPARENT artwork made for a dark ground — the square app icon was a
     black tile and melted into the band. Height is fixed and width follows the
     artwork (`LOGO_ASPECT`), so a different wordmark only needs its ratio. */
  logo: { height: 14, width: 14 * LOGO_ASPECT },
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

export function QuoteAppStylePdf({
  orders,
  org,
  approval,
  logoUrl,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  approval?: { name: string; at: string; reference: string } | null;
  /**
   * The org's wordmark for a dark ground, as a URL or `data:` URI the
   * renderer can fetch (PNG or JPG — @react-pdf reads no WebP or SVG file). It
   * REPLACES the typed name; without one the masthead sets the name in type.
   * Today /forms passes `public/logo-wordmark-white.png`, Donut Friend's own
   * artwork; when orgs get
   * their own logo (planned 2026-09-25, docs/history/04p-tablet-shell.md) it
   * comes from there instead.
   */
  logoUrl?: string | null;
}) {
  return (
    <Document>
      {orders.map((order) => {
        const t = order.totals;
        const delivery = order.fulfillment === "delivery";
        return (
          <Page key={order.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              {logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's Image has no alt
                <Image src={logoUrl} style={s.logo} />
              ) : (
                <Text style={s.wordmark}>{org.name}</Text>
              )}
              <View style={s.mastheadRight}>
                {org.addressLine ? <Text style={s.mastheadLine}>{org.addressLine}</Text> : null}
                {org.contactLine ? <Text style={s.mastheadLine}>{org.contactLine}</Text> : null}
              </View>
            </View>

            <View style={s.body}>
              <View style={s.headingRow}>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
                  <Text style={s.kicker}>Quote</Text>
                  <Text style={s.h1}>{order.title || isoDay(order.event_date) || "Special order"}</Text>
                  <Text style={s.caption}>
                    {[order.location_name, order.date_initiated ? `Quoted ${order.date_initiated}` : null]
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
                  <Text style={s.sectionHead}>Notes</Text>
                  {order.notes_quote ? (
                    <Text style={s.prose}>{order.notes_quote}</Text>
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
                    </View>
                    <View style={s.grand}>
                      <Text style={s.grandLabel}>Total quote</Text>
                      <Text style={s.grandValue}>{money(t.total)}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {org.terms ? (
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
                {org.name} · Quote {order.number}
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
