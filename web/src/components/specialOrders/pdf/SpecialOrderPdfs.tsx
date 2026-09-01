// The special-order documents, rendered to PDF client-side with
// @react-pdf/renderer. Import this module DYNAMICALLY (await import(...)) from
// a click handler — the renderer is heavy and nothing on a normal page load
// needs it. (The `PoPdfDocs` idiom, and the same reasons.)
//
// FIVE documents from THREE renderers (decision 11):
//
//   OrderDocumentPdf   quote · invoice · receipt — ONE layout at three moments.
//                      The quote adds the terms and the signature lines; the
//                      invoice adds the payments block and TOTAL DUE; the
//                      receipt is the invoice with the balance settled.
//   KitchenOrderPdf    the production sheet: no money at all, grouped by SIZE
//                      CLASS, printing the customized name over the full
//                      taxonomy, and ending in the signature bands.
//   StatementPdf       decision 21 — one customer's orders over a period.
//
// SignedQuotePdf is `OrderDocumentPdf` with decision 17's approval block, which
// is why it is a flag on the quote rather than a fourth renderer: the artifact
// the approval files must BE the quote that was approved.
//
// ---------------------------------------------------------------------------
// VERIFIED against FileMaker's own four PDFs for order 9885 (in
// `DF Operations Screenshots/desktop/Special Orders/`) by rendering ours in
// Node over the real live rows — the recipe-sheet verification pattern.
//
// ONE DELIBERATE DEVIATION, and it is worth stating because it looks like a
// mistake next to the reference: FileMaker prints the quote's terms and
// signature lines at the foot of PAGE ONE, above two dozen items and two pages
// before the total. That is its body/footer layout showing through rather than
// a decision — nobody signs a total they have not reached yet. Ours prints
// them after the totals, at the end of the document.
//
// AND ONE DISAGREEMENT WE ARE RIGHT ABOUT: the reference invoice for 9885 says
// TOTAL DUE $0.00 on an unpaid $161.77 quote. That is FileMaker's stored-total
// drift (decision 6's whole reason). Ours derives the balance and prints
// $161.77.
// ---------------------------------------------------------------------------

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  DOCUMENT_TITLE,
  sizeClassGroups,
  taxonomyLine,
  usDate,
  usTime,
  usWeekday,
  type DocOrg,
  type DocumentKind,
  type DocumentLine,
  type OrderDocData,
  type StatementData,
} from "@/lib/specialOrderDocs";
import { customerLabel, isProductionLine, lineTotal } from "@/lib/specialOrders";

/**
 * NO HYPHENATION, ANYWHERE.
 *
 * @react-pdf hyphenates by default, which on a narrow meta column broke a real
 * customer's address into `alexlan-dayan@gmail.com` — an email that cannot be
 * copied off the page and reads as a typo. Nothing on these documents is
 * justified prose, so there is nothing hyphenation buys; a long value wraps
 * whole or overflows its column, both of which are honest.
 *
 * Registered at module scope because the callback is GLOBAL to the renderer —
 * doing it per-document would be a second place to forget.
 */
Font.registerHyphenationCallback((word) => [word]);

/**
 * THE MASTHEAD IS THE ORG'S NAME AT 40PT, which is not a flourish — it is what
 * makes a printed quote recognisable across a kitchen, and it is what twelve
 * years of these look like.
 *
 * Sizes, and nothing else (the `PoPdf` rule — four sizes and two greys):
 *
 *   40  Helvetica-Bold   the org name
 *   12  Helvetica-Bold   the address and contact lines under it; band labels
 *   11  Helvetica-Bold   the document's own name, top right
 *    9  Helvetica[-Bold] everything you read: lines, meta values, totals
 *    8  Helvetica        secondary — the terms paragraph, footers, taxonomy
 *
 *   #000  ink — this design system's one colour
 *   #666  secondary
 *   #ffe98a  the mark (--rf-yellow-200), used on exactly ONE thing: the
 *            kitchen sheet's pickup time. Colour means "worth your eye" here
 *            as everywhere else in the app, and on a production sheet the time
 *            is the fact somebody misses.
 */
const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 36,
    paddingHorizontal: 34,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#000",
  },

  /* ---- masthead ---- */
  masthead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orgName: { fontSize: 40, fontFamily: "Helvetica-Bold", letterSpacing: -1 },
  orgLine: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docPage: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right" },
  eventLine: {
    fontSize: 11,
    fontFamily: "Helvetica-BoldOblique",
    textAlign: "right",
    marginTop: 8,
  },

  /* ---- the black header bands ---- */
  bandRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  bandBlock: { flexGrow: 1, flexBasis: 0 },
  band: {
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingVertical: 3,
  },
  metaRow: { flexDirection: "row", marginTop: 4, gap: 6 },
  metaLabel: {
    width: 74,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    textTransform: "uppercase",
  },
  metaValue: { flexGrow: 1, flexBasis: 0, fontSize: 9 },
  metaValueUnderlined: {
    flexGrow: 1,
    flexBasis: 0,
    fontSize: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: "#000",
  },

  /* ---- the item table ---- */
  itemsHead: { flexDirection: "row", marginTop: 26, marginBottom: 4 },
  headCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    borderBottomWidth: 0.75,
    borderBottomColor: "#000",
  },
  row: { flexDirection: "row", paddingVertical: 3.5, alignItems: "flex-start" },
  colIndex: { width: 22, fontSize: 9, textAlign: "right", paddingRight: 6 },
  colItem: { width: 176, fontSize: 9 },
  colQty: { width: 26, fontSize: 9, textAlign: "right" },
  colPrice: { width: 40, fontSize: 9, textAlign: "right" },
  colNotes: { flexGrow: 1, flexBasis: 0, fontSize: 9, paddingLeft: 14 },
  colCost: { width: 52, fontSize: 9, textAlign: "right" },

  /* ---- totals ---- */
  footRow: { flexDirection: "row", marginTop: 18, gap: 24 },
  footCol: { flexGrow: 1, flexBasis: 0 },
  totalLine: { flexDirection: "row", marginTop: 3 },
  totalLabel: {
    flexGrow: 1,
    flexBasis: 0,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    paddingRight: 10,
  },
  totalValue: { width: 66, fontSize: 9, textAlign: "right" },
  grandLabel: {
    flexGrow: 1,
    flexBasis: 0,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    paddingRight: 10,
  },
  grandValue: { width: 66, fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },

  /* ---- terms and signature ---- */
  termsHead: { fontSize: 8, fontFamily: "Helvetica-Bold", marginTop: 26 },
  terms: { fontSize: 7, marginTop: 4, lineHeight: 1.35, textAlign: "justify" },
  signRow: { flexDirection: "row", gap: 30, marginTop: 34 },
  signLine: { borderTopWidth: 0.75, borderTopColor: "#000", paddingTop: 2 },
  signLabel: { fontSize: 7, textTransform: "uppercase" },

  /* ---- kitchen sheet ---- */
  kitchenHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  kitchenBoxes: { flexDirection: "row", gap: 8, flexShrink: 0 },
  kitchenBox: { width: 112 },
  kitchenValue: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 2 },
  kitchenSub: { fontSize: 9, textAlign: "center" },
  mark: { backgroundColor: "#ffe98a" },
  orderNumber: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  asOf: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right", marginTop: 4 },
  sizeClass: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 2 },
  kitchenRow: { flexDirection: "row", paddingVertical: 5, alignItems: "flex-start" },
  kQty: { width: 34, fontSize: 9 },
  kItem: { width: 300, fontSize: 9 },
  taxonomy: { fontSize: 8, fontFamily: "Helvetica-Oblique", color: "#666", marginTop: 2 },
  kNotes: { flexGrow: 1, flexBasis: 0, fontSize: 9 },
  endOfList: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginTop: 12,
  },
  allergen: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 8 },
  signBandRow: { flexDirection: "row", marginTop: 20 },
  signBand: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingVertical: 3,
    marginRight: 1,
  },
  signBandValue: { flexGrow: 1, flexBasis: 0, fontSize: 10, textAlign: "center", paddingVertical: 5 },

  note: { fontSize: 8, marginTop: 6, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 34,
    right: 34,
    fontSize: 7,
    color: "#666",
    textAlign: "center",
  },
});

function money(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Quantities print as integers where they are integers — "1", never "1.00". */
function qtyText(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2)));
}

/**
 * A totals row that prints NOTHING when the figure is zero.
 *
 * FileMaker's own behaviour, and it is right: a quote for a pickup order should
 * not carry a line reading "DELIVERY: $0.00", which invites the question of
 * what the delivery was. The label still prints — the block's shape is
 * constant, so the eye finds SUBTOTAL and TOTAL in the same place on every
 * document — and only the number is withheld.
 */
function TotalRow({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.totalLine}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value === null || value === 0 ? "" : money(value)}</Text>
    </View>
  );
}

function Meta({
  label,
  value,
  underlined = false,
}: {
  label: string;
  value: string;
  underlined?: boolean;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={underlined ? styles.metaValueUnderlined : styles.metaValue}>{value}</Text>
    </View>
  );
}

function Masthead({
  org,
  order,
  title,
}: {
  org: DocOrg;
  order: OrderDocData;
  title: string;
}) {
  return (
    <>
      <View style={styles.masthead} fixed>
        <View>
          <Text style={styles.orgName}>{org.name}</Text>
          <Text style={styles.orgLine}>{org.addressLine}</Text>
          <Text style={styles.orgLine}>{org.contactLine}</Text>
        </View>
        <View>
          <Text style={styles.docTitle}>{title}</Text>
          <Text
            style={styles.docPage}
            render={({ pageNumber, totalPages }) => `p ${pageNumber} OF ${totalPages}`}
          />
        </View>
      </View>
      {/* The event line repeats on every page — on a four-page order it is the
          only thing that says which event these items belong to.

          IT PRINTS THE TITLE ALONE, falling back to the date. Printing both
          read "Pregnanacy Revela 8/16/2026 8/16/2026" on the very first real
          order rendered, because Mark's titles routinely END with the date —
          which is also why FileMaker prints just the title here. The date has
          its own labelled row in the block below. */}
      <Text style={styles.eventLine} fixed>
        {order.title || usDate(order.event_date)}
      </Text>
    </>
  );
}

/* ==========================================================================
 * QUOTE · INVOICE · RECEIPT
 * ========================================================================== */

/**
 * One layout at three moments (decision 11).
 *
 * What varies is small and named here rather than in three near-identical
 * components, which is how the two of them that were meant to stay in step
 * would stop being: the invoice and receipt show the payments block and label
 * the grand total TOTAL DUE; the quote labels it TOTAL QUOTE and carries the
 * terms and the signature lines.
 */
export function OrderDocumentPdf({
  orders,
  org,
  kind,
  /** Decision 17: an approved quote is the quote it approved, plus who signed
   *  it and when. Never passed for anything else. */
  approval,
}: {
  orders: OrderDocData[];
  org: DocOrg;
  kind: DocumentKind;
  approval?: { name: string; at: string; reference: string } | null;
}) {
  const showsPayments = kind === "invoice" || kind === "receipt";
  const grandLabel =
    kind === "quote" ? "TOTAL QUOTE:" : kind === "receipt" ? "TOTAL DUE:" : "TOTAL DUE:";

  return (
    <Document>
      {orders.map((order) => {
        const note =
          kind === "quote"
            ? order.notes_quote
            : kind === "invoice"
              ? order.notes_invoice
              : order.notes_receipt;
        const t = order.totals;
        return (
          <Page key={order.id} size="LETTER" style={styles.page}>
            <Masthead org={org} order={order} title={DOCUMENT_TITLE[kind]} />

            <View style={styles.bandRow}>
              <View style={styles.bandBlock}>
                <Text style={styles.band}>{DOCUMENT_TITLE[kind]}</Text>
                <Meta label={DOCUMENT_TITLE[kind]} value={order.number} />
                <Meta label="Event date" value={usDate(order.event_date)} />
                <Meta
                  label={order.fulfillment === "delivery" ? "Delivery" : "Pickup"}
                  value={order.event_time ? `after ${usTime(order.event_time)}` : ""}
                />
                <Meta label="Location" value={order.location_name ?? ""} underlined />
              </View>

              <View style={styles.bandBlock}>
                <Text style={styles.band}>CUSTOMER</Text>
                {/* LAST NAME FIRST — the roster reading, and what FileMaker
                    prints. `customerLabel` is the app's one implementation. */}
                <Meta label="Name" value={customerLabel(order.customer)} />
                <Meta label="Phone" value={order.customer?.phone ?? ""} />
                <Meta label="Email" value={order.customer?.email ?? ""} />
              </View>

              <View style={styles.bandBlock}>
                <Text style={styles.band}>CONTACT</Text>
                <Meta label="Name" value={order.contact_name ?? ""} />
                <Meta label="Phone" value={order.contact_phone ?? ""} />
                <Meta label="Email" value={order.contact_email ?? ""} />
                <Meta label="Event address" value={order.delivery_address ?? ""} />
              </View>
            </View>

            {/* NOT `fixed`, unlike the kitchen sheet's.

                A fixed header repeats on EVERY page, including one that holds
                only the totals — which is what a two-page quote is, since our
                rows are tighter than FileMaker's and 29 of them fit on page
                one. That printed an empty ITEM/QTY/PRICE header directly above
                the TOTALS band, which reads as a table that failed to render.
                The kitchen sheet keeps its fixed header because its list
                genuinely runs over pages and nothing but the list is on them. */}
            <View style={styles.itemsHead}>
              <Text style={styles.colIndex}> </Text>
              <Text style={[styles.colItem, styles.headCell]}>Item</Text>
              <Text style={[styles.colQty, styles.headCell]}>Qty</Text>
              <Text style={[styles.colPrice, styles.headCell]}>Price</Text>
              <Text style={[styles.colNotes, styles.headCell]}>Notes</Text>
              <Text style={[styles.colCost, styles.headCell]}>Cost</Text>
            </View>

            {order.lines.map((line, i) => (
              <View key={line.id} style={styles.row} wrap={false}>
                <Text style={styles.colIndex}>{i + 1}.</Text>
                <Text style={styles.colItem}>{line.name}</Text>
                <Text style={styles.colQty}>{qtyText(line.qty)}</Text>
                <Text style={styles.colPrice}>{money(line.unit_price)}</Text>
                <Text style={styles.colNotes}>{line.notes ?? ""}</Text>
                <Text style={styles.colCost}>{money(lineTotal(line))}</Text>
              </View>
            ))}

            <View style={styles.footRow}>
              <View style={styles.footCol}>
                {showsPayments ? (
                  <>
                    <Text style={styles.band}>PAYMENTS</Text>
                    {order.payments.map((p, i) => (
                      <View key={i} style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{usDate(p.paid_on)}</Text>
                        <Text style={styles.metaValue}>
                          {[p.payment_type, p.note].filter(Boolean).join(" · ")}
                        </Text>
                        <Text style={styles.totalValue}>{money(Number(p.amount) || 0)}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text style={styles.headCell}>NOTES</Text>
                )}
                {note ? <Text style={styles.note}>{note}</Text> : null}
              </View>

              <View style={styles.footCol}>
                <Text style={styles.band}>TOTALS</Text>
                <TotalRow label="SUBTOTAL:" value={t.subtotal} />
                <TotalRow label="TAX:" value={t.tax} />
                <TotalRow label="DISCOUNT:" value={t.discount} />
                <TotalRow label="DELIVERY:" value={t.deliveryCharge} />
                <TotalRow label="RUSH FEE:" value={t.rushFee} />
                {showsPayments ? <TotalRow label="PAYMENTS:" value={t.paid} /> : null}
                <View style={styles.totalLine}>
                  <Text style={styles.grandLabel}>{grandLabel}</Text>
                  {/* THE QUOTE PRINTS THE TOTAL; THE INVOICE PRINTS WHAT IS
                      STILL OWED. Two different questions, and the reference
                      invoice answers the second one wrong — see the header. */}
                  <Text style={styles.grandValue}>
                    {money(kind === "quote" ? t.total : t.balance)}
                  </Text>
                </View>
              </View>
            </View>

            {kind === "invoice" || kind === "receipt" ? (
              org.invoiceFooter ? (
                <Text style={styles.note}>{org.invoiceFooter}</Text>
              ) : null
            ) : null}

            {kind === "quote" && org.terms ? (
              <>
                <Text style={styles.termsHead}>
                  IN ORDER TO PROCEED WITH YOUR ORDER, PLEASE READ AND SIGN BELOW:
                </Text>
                <Text style={styles.terms}>{org.terms.toUpperCase()}</Text>

                {approval ? (
                  /* THE APPROVED ARTIFACT (decision 17). It is the quote with
                     the approval written where the pen would have gone —
                     typed-name clickwrap is legally equivalent for this class
                     of agreement, and the token identity is what makes it
                     auditable afterwards. */
                  <View style={styles.signRow}>
                    <View style={[styles.signLine, { flexGrow: 1, flexBasis: 0 }]}>
                      <Text style={styles.signLabel}>
                        Signature — approved online by {approval.name}
                      </Text>
                      <Text style={styles.note}>
                        {approval.at} · reference {approval.reference}
                      </Text>
                    </View>
                    <View style={[styles.signLine, { width: 150 }]}>
                      <Text style={styles.signLabel}>Date</Text>
                      <Text style={styles.note}>{approval.at.slice(0, 10)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.signRow}>
                    <View style={[styles.signLine, { flexGrow: 1, flexBasis: 0 }]}>
                      <Text style={styles.signLabel}>Signature</Text>
                    </View>
                    <View style={[styles.signLine, { width: 150 }]}>
                      <Text style={styles.signLabel}>Date</Text>
                    </View>
                  </View>
                )}
              </>
            ) : null}

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }) =>
                `${DOCUMENT_TITLE[kind]} #${order.number} · ${pageNumber} / ${totalPages}`
              }
              fixed
            />
          </Page>
        );
      })}
    </Document>
  );
}

/* ==========================================================================
 * THE KITCHEN ORDER
 * ========================================================================== */

function KitchenBox({
  label,
  value,
  sub,
  marked = false,
}: {
  label: string;
  value: string;
  sub?: string;
  marked?: boolean;
}) {
  return (
    <View style={styles.kitchenBox}>
      <Text style={styles.band}>{label}</Text>
      <Text style={[styles.kitchenValue, ...(marked ? [styles.mark] : [])]}>{value}</Text>
      {sub ? (
        <Text style={[styles.kitchenSub, ...(marked ? [styles.mark] : [])]}>{sub}</Text>
      ) : null}
    </View>
  );
}

/**
 * The production sheet — the one document with NO MONEY ON IT AT ALL, which is
 * the point: a decorator holding this is being told what to make, and a price
 * beside a donut is a question they cannot answer.
 *
 * `Misc` lines never reach it (decision 5, enforced in `sizeClassGroups`), so
 * an order carrying a $75 delivery fee prints its donuts and not the fee.
 */
export function KitchenOrderPdf({
  orders,
  printedOn,
}: {
  orders: OrderDocData[];
  org?: DocOrg;
  /**
   * The org's calendar day, as `YYYY-MM-DD` — what AS OF means.
   *
   * Passed in rather than taken from `new Date()` here, for `lib/today`'s
   * reason: a browser in another zone, or a UTC host, dates the sheet to
   * tomorrow after 4pm Pacific. Every caller already holds the org's own today.
   */
  printedOn?: string;
}) {
  return <Document>{kitchenOrderPages(orders, printedOn)}</Document>;
}

/**
 * The same pages, WITHOUT a `<Document>` around them — so the production packet
 * can carry them (Mark, 2026-09-01: "why not include a 'Special Orders' option
 * … so we don't need to do it as a separate process?").
 *
 * A FUNCTION RETURNING AN ARRAY, not a component. `<Document>` accepts Pages
 * and arrays of them, and `ProductionPacketPdfs` already documents that a real
 * Fragment confuses the reconciler on some versions — which is why that file
 * flattens its children by hand. Returning the array sidesteps the question
 * rather than betting on it.
 */
export function kitchenOrderPages(
  orders: OrderDocData[],
  printedOn?: string
): React.ReactElement[] {
  return orders.map((order) => {
        const groups = sizeClassGroups(order.lines);
        const pickupTime = usTime(order.ready_by_time ?? order.event_time);
        return (
          <Page key={order.id} size="LETTER" style={styles.page}>
            <View style={styles.kitchenHeadRow} fixed>
              <View style={styles.kitchenBoxes}>
                <KitchenBox label="KITCHEN" value={order.kitchen_code ?? "—"} />
                <KitchenBox
                  label="DAY OF WEEK"
                  value={usWeekday(order.event_date)}
                  sub={usDate(order.event_date)}
                />
                <KitchenBox
                  label={order.fulfillment === "delivery" ? "DELIVERY TIME" : "PICK UP TIME"}
                  value={pickupTime || "—"}
                  sub={order.location_code ?? undefined}
                  marked
                />
              </View>
              <View>
                <Text style={styles.orderNumber}>ORDER #{order.number}</Text>
                {/* AS OF IS THE DAY THIS CAME OFF THE PRINTER (Mark,
                    2026-09-01), not the day of the event. The event date is on
                    this page twice already — in the DAY OF WEEK box on the left
                    and in EVENT INFO below — so printing it a third time under
                    the order number said nothing, while the question AS OF
                    actually answers is "how current is the sheet in my hand?".
                    An order is a working document and its lines change; a
                    decorator holding two copies needs to know which is the
                    later one. */}
                <Text style={styles.asOf}>AS OF {usDate(printedOn ?? order.event_date)}</Text>
              </View>
            </View>

            <View style={styles.bandRow}>
              <View style={styles.bandBlock}>
                <Text style={styles.band}>CONTACT INFO</Text>
                <Text style={styles.note}>{order.contact_name ?? customerLabel(order.customer)}</Text>
                <Text style={styles.note}>{order.contact_phone ?? order.customer?.phone ?? ""}</Text>
                <Text style={styles.note}>{order.contact_email ?? order.customer?.email ?? ""}</Text>
              </View>
              <View style={styles.bandBlock}>
                <Text style={styles.band}>EVENT INFO</Text>
                {/* The title alone — see the masthead's event line for why. */}
                <Text style={[styles.note, { fontFamily: "Helvetica-Bold" }]}>
                  {order.title || usDate(order.event_date)}
                </Text>
                <Text style={styles.note}>
                  {[usDate(order.event_date), usTime(order.event_time)].filter(Boolean).join("  ")}
                </Text>
                {order.fulfillment === "delivery" && order.delivery_address ? (
                  <Text style={styles.note}>{order.delivery_address}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.itemsHead} fixed>
              <Text style={[styles.kQty, styles.headCell]}>Qty</Text>
              <Text style={[styles.kItem, styles.headCell]}>Item</Text>
              <Text style={[styles.kNotes, styles.headCell]}>Notes</Text>
            </View>

            {groups.map((group) => (
              <View key={group.label}>
                <Text style={styles.sizeClass}>{group.label}</Text>
                {group.lines.map((line) => (
                  <View key={line.id} style={styles.kitchenRow} wrap={false}>
                    <Text style={styles.kQty}>{qtyText(line.qty)}</Text>
                    <View style={styles.kItem}>
                      <Text>{line.name}</Text>
                      {/* WHAT IT ACTUALLY IS, under what somebody called it.
                          The name is an edited copy; this is the taxonomy. */}
                      <Text style={styles.taxonomy}>{taxonomyLine(line)}</Text>
                    </View>
                    <Text style={styles.kNotes}>{line.notes ?? ""}</Text>
                  </View>
                ))}
              </View>
            ))}

            {order.notes_production ? (
              <Text style={styles.note}>{order.notes_production}</Text>
            ) : null}

            <Text style={styles.endOfList}>*** END OF LIST ***</Text>
            <Text style={styles.allergen}>
              ALLERGEN WARNING:   {order.allergen_info || "None"}
            </Text>

            <View style={styles.signBandRow}>
              <Text style={styles.signBand}>ORDER TAKEN BY</Text>
              <Text style={styles.signBand}>DATE / TIME</Text>
              <Text style={styles.signBand}>PICKUP / DELIVERY</Text>
            </View>
            <View style={styles.signBandRow}>
              <Text style={styles.signBandValue}>{order.taken_by ?? ""}</Text>
              <Text style={styles.signBandValue}>{usDate(order.date_initiated)}</Text>
              <Text style={styles.signBandValue}>
                {order.fulfillment === "delivery" ? "Delivery" : "Pickup"}
              </Text>
            </View>
            <View style={styles.signBandRow}>
              <Text style={styles.signBand}>DELIVERY TRACKING #</Text>
              <Text style={styles.signBand}>ORDER COMPLETED BY</Text>
              <Text style={styles.signBand}>NUMBER OF BOXES</Text>
            </View>
            <View style={styles.signBandRow}>
              <Text style={styles.signBandValue}>{order.delivery_tracking ?? ""}</Text>
              <Text style={styles.signBandValue}> </Text>
              <Text style={styles.signBandValue}>{order.delivery_boxes ?? ""}</Text>
            </View>
            <View style={[styles.signBandRow, { marginTop: 14 }]}>
              <Text style={styles.signBand}>RECEIVED</Text>
              <Text style={styles.signBand}>DATE &amp; TIME</Text>
            </View>
            <View style={styles.signBandRow}>
              <Text style={[styles.signBandValue, { textAlign: "left", paddingLeft: 6 }]}>X</Text>
              <Text style={styles.signBandValue}> </Text>
            </View>

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }) =>
                `ORDER #${order.number} · ${pageNumber} / ${totalPages}`
              }
              fixed
            />
          </Page>
    );
  });
}

/* ==========================================================================
 * THE WHOLESALE STATEMENT (decision 21)
 * ========================================================================== */

/**
 * One customer, one period, one line per order — the weekly chore Mark does by
 * hand for Cafe Knotted.
 *
 * ITS LINE GRAIN IS DELIBERATE: one row per ORDER, not per donut. That is what
 * a customer checks a bill against (they know what they ordered on Tuesday),
 * and it is what an accounting export will want when the QBO era arrives —
 * decision 21's other half.
 */
export function StatementPdf({
  statement,
  org,
}: {
  statement: StatementData;
  org: DocOrg;
}) {
  const period = `${usDate(statement.from)} – ${usDate(statement.to)}`;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.masthead} fixed>
          <View>
            <Text style={styles.orgName}>{org.name}</Text>
            <Text style={styles.orgLine}>{org.addressLine}</Text>
            <Text style={styles.orgLine}>{org.contactLine}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>STATEMENT</Text>
            <Text
              style={styles.docPage}
              render={({ pageNumber, totalPages }) => `p ${pageNumber} OF ${totalPages}`}
            />
          </View>
        </View>
        <Text style={styles.eventLine} fixed>
          {period}
        </Text>

        <View style={styles.bandRow}>
          <View style={styles.bandBlock}>
            <Text style={styles.band}>CUSTOMER</Text>
            <Meta label="Name" value={customerLabel(statement.customer)} />
            <Meta label="Phone" value={statement.customer?.phone ?? ""} />
            <Meta label="Email" value={statement.customer?.email ?? ""} />
          </View>
          <View style={styles.bandBlock}>
            <Text style={styles.band}>PERIOD</Text>
            <Meta label="From" value={usDate(statement.from)} />
            <Meta label="To" value={usDate(statement.to)} />
            <Meta label="Orders" value={String(statement.orders.length)} />
          </View>
        </View>

        <View style={styles.itemsHead} fixed>
          <Text style={[styles.colIndex, styles.headCell]}>#</Text>
          <Text style={[styles.colItem, styles.headCell]}>Date</Text>
          <Text style={[styles.colNotes, styles.headCell]}>Order</Text>
          <Text style={[styles.colCost, styles.headCell]}>Paid</Text>
          <Text style={[styles.colCost, styles.headCell]}>Total</Text>
        </View>

        {statement.orders.map((o) => (
          <View key={o.id} style={styles.row} wrap={false}>
            <Text style={styles.colIndex}>{o.number}</Text>
            <Text style={styles.colItem}>{usDate(o.event_date)}</Text>
            <Text style={styles.colNotes}>{o.title ?? ""}</Text>
            <Text style={styles.colCost}>
              {o.totals.paid === 0 ? "" : money(o.totals.paid)}
            </Text>
            <Text style={styles.colCost}>{money(o.totals.total)}</Text>
          </View>
        ))}

        {statement.orders.length === 0 ? (
          <Text style={styles.note}>No orders in this period.</Text>
        ) : null}

        <View style={styles.footRow}>
          <View style={styles.footCol} />
          <View style={styles.footCol}>
            <Text style={styles.band}>TOTALS</Text>
            <TotalRow label="ORDERS:" value={statement.total} />
            <TotalRow label="PAYMENTS:" value={statement.paid} />
            <View style={styles.totalLine}>
              <Text style={styles.grandLabel}>TOTAL DUE:</Text>
              <Text style={styles.grandValue}>{money(statement.balance)}</Text>
            </View>
          </View>
        </View>

        {org.invoiceFooter ? <Text style={styles.note}>{org.invoiceFooter}</Text> : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `STATEMENT ${period} · ${pageNumber} / ${totalPages}`
          }
          fixed
        />
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
  if (kind === "order")
    return <KitchenOrderPdf orders={orders} org={org} printedOn={printedOn} />;
  return <OrderDocumentPdf orders={orders} org={org} kind={kind} approval={approval} />;
}

export type { DocumentLine };
export { isProductionLine };
