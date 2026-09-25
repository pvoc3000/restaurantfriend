// THE PURCHASE ORDER, REDRAWN IN THE APP'S OWN LANGUAGE — a draft on /forms
// (Mark, 2026-09-25: "remake the purchase order using this same style"). NOT
// wired yet; `PoPdf` in `purchasing/pdf/PoPdfDocs` is still what vendors get.
//
// Same data, same rules as `PoPdf` (spec §4.9), which are the vendor's side of
// the conversation and not a matter of looks:
//
//   · NO PRICES AT ALL (Mark, 2026-07-28) — not unit, not extended, no total.
//   · Each line reads `composedDescription`: the VENDOR's description first,
//     then brand, then the composed pack; the Pack column is the vendor's own
//     unit of sale ("CS", "BAG").
//   · Grouped by category, alphabetical inside each (`groupBy` +
//     `compareDocumentLines`) — the same two functions, imported, not copied.
//   · The line's own note prints under it.
//
// What changes is the look, from `components/pdf/appDocument`: the black
// masthead band carries the billing entity; the VENDOR is the page heading,
// because that is who the paper is for; the facts are fields; the categories
// are `DataTable`'s black group bands; and each line's tick box is a real
// 1px box, the app's mark for "somebody writes here" — it is ticked at
// receiving.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  DocFooter,
  Field,
  INK,
  MUTED,
  SUBTLE,
  caps,
  docStyles,
  isoDay,
  qtyText,
} from "@/components/pdf/appDocument";
import { composedDescription, groupBy } from "@/components/purchasing/pdf/PoPdfDocs";
import { formatAddress, summaryLine, type OrgDocData, type PoDocData } from "@/lib/poProcessing";
import { compareDocumentLines } from "@/lib/purchaseOrders";

const s = {
  ...docStyles,
  ...StyleSheet.create({
    headRight: { alignItems: "flex-end" },
    summary: { ...caps(6.5, 0.12), color: SUBTLE },
    itemsHeadRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 6,
    },
    row: { flexDirection: "row", paddingVertical: 4.5, alignItems: "flex-start" },
    cBox: { width: 22, paddingLeft: 6, paddingTop: 1 },
    box: { width: 9, height: 9, borderWidth: 1, borderColor: INK },
    cProduct: { width: 58, color: MUTED },
    cQty: { width: 36, textAlign: "right", paddingRight: 10, fontSize: 11, fontFamily: "Helvetica-Bold" },
    cPack: { width: 40, ...caps(8, 0.06), fontFamily: "Helvetica-Bold", paddingTop: 1.5 },
    cDesc: { flexGrow: 1, flexBasis: 0 },
    note: { fontSize: 8, color: MUTED, marginTop: 2 },
    notes: { marginTop: 20 },
  }),
};

/** The billing entity's name — what the vendor bills — falling back to the org. */
function entityName(org: OrgDocData): string {
  return org.billing?.entity_name ?? org.name;
}

export function PoAppStylePdf({ pos, org }: { pos: PoDocData[]; org: OrgDocData }) {
  const billing = org.billing;
  const billAddress = formatAddress(billing ? { ...billing, street1: billing.address1 ?? billing.street1 } : null);
  // The masthead's right side, as the special-order documents set it: the
  // address on one line, then how to reach us.
  const mastheadLines = [
    [billing?.address1 ?? billing?.street1, billing?.city, billing?.state, billing?.zip]
      .filter(Boolean)
      .join(" "),
    [billing?.phone, billing?.email].filter(Boolean).join(" / "),
  ].filter(Boolean);

  return (
    <Document>
      {pos.map((po) => {
        const shipTo = formatAddress(po.ship_to);
        return (
          <Page key={po.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              <Text style={s.wordmark}>{entityName(org)}</Text>
              <View style={s.mastheadRight}>
                {mastheadLines.map((l, i) => (
                  <Text key={i} style={s.mastheadLine}>
                    {l}
                  </Text>
                ))}
              </View>
            </View>

            <View style={s.body}>
              <View style={s.headingRow}>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
                  <Text style={s.kicker}>Purchase order</Text>
                  <Text style={s.h1}>{po.vendor_name}</Text>
                  <Text style={s.caption}>
                    {[po.account_number ? `Account # ${po.account_number}` : null, `${po.location_code} ${po.location_name}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <View style={s.numberBlock}>
                  <Text style={s.kicker}>No.</Text>
                  <Text style={s.number}>{po.po_number}</Text>
                </View>
              </View>

              <View style={s.blocks}>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Order</Text>
                  <Field label="Date" value={isoDay(po.order_date)} />
                  <Field label="Delivery" value={isoDay(po.delivery_date)} />
                  <Field label="Account" value={po.account_number} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Ship to</Text>
                  <Field label="Shop" value={`${po.location_code} ${po.location_name}`} />
                  <Field label="Address" value={shipTo.join("\n")} />
                </View>
                <View style={s.block}>
                  <Text style={s.sectionHead}>Bill to</Text>
                  <Field label="Name" value={entityName(org)} />
                  <Field label="Address" value={billAddress.join("\n")} />
                </View>
              </View>

              <View style={s.items}>
                <View style={s.itemsHeadRow}>
                  <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
                    Items <Text style={s.sectionCount}>{po.lines.length}</Text>
                  </Text>
                  <Text style={s.summary}>{summaryLine(po.lines)}</Text>
                </View>
                <View style={s.tableHead} fixed>
                  <Text style={[s.th, s.cBox]}> </Text>
                  <Text style={[s.th, s.cProduct]}>Product #</Text>
                  <Text style={[s.th, { width: 36, textAlign: "right", paddingRight: 10 }]}>Qty</Text>
                  <Text style={[s.th, { width: 40 }]}>Pack</Text>
                  <Text style={[s.th, s.cDesc]}>Description</Text>
                </View>
                {groupBy(
                  po.lines,
                  (l) => l.category ?? "Other",
                  (l) => l.category ?? "zzz",
                  compareDocumentLines
                ).map((group) => (
                  <View key={group.label}>
                    <Text style={s.groupBand}>{group.label}</Text>
                    {group.items.map((line) => (
                      <View key={line.id} style={s.row} wrap={false}>
                        <View style={s.cBox}>
                          <View style={s.box} />
                        </View>
                        <Text style={s.cProduct}>{line.product_id ?? ""}</Text>
                        <Text style={s.cQty}>{qtyText(line.qty)}</Text>
                        <Text style={s.cPack}>{line.pack_type ?? ""}</Text>
                        <View style={s.cDesc}>
                          <Text>{composedDescription(line)}</Text>
                          {line.notes ? <Text style={s.note}>{line.notes}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>

              {po.notes ? (
                <View style={s.notes} wrap={false}>
                  <Text style={s.sectionHead}>Notes</Text>
                  <Text style={s.prose}>{po.notes}</Text>
                </View>
              ) : null}
            </View>

            <DocFooter>{`${entityName(org)} · PO ${po.po_number}`}</DocFooter>
          </Page>
        );
      })}
    </Document>
  );
}
