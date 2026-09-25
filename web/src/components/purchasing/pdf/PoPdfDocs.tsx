// The PO documents, rendered to PDF client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY (await import(...)) from a click handler —
// the renderer is heavy and nothing on a normal page load needs it.
//
// DRAWN IN THE APP'S OWN DESIGN LANGUAGE since 2026-09-25 (Mark: "wire it up
// and do the shopping list too"), from the shared `components/pdf/appDocument`
// parts the special-order documents use. The previous look — "four sizes and
// two greys", modelled on sent PO 112-18008-01 — is in git history at
// 5467116c.
//
// Two documents:
// - PoPdf — the vendor-facing purchase order (spec §4.9). NO PRICES AT ALL
//   (Mark, 2026-07-28) — not unit prices, not extended prices, not a total.
//   The vendor quotes us; we don't quote them back. Money lives on the PO
//   detail screen, which is internal. The VENDOR is the page heading, because
//   that is who the paper is for; categories are `DataTable`'s black group
//   bands; each line's tick box is a real 1px box, ticked at receiving.
// - ShoppingListPdf — the in_person processing mode: the same lines walked by
//   SHOP SECTION for a store run. Internal, so unit prices and an estimated
//   total ARE here, our own item name leads (you are finding it on a shelf,
//   not reading the vendor's list), and the Pack column is the composed pack
//   ("12 × 2 lb") because its size is what you pick.

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
import {
  formatAddress,
  summaryLine,
  type DocLine,
  type OrgDocData,
  type PoDocData,
} from "@/lib/poProcessing";
import { compareDocumentLines } from "@/lib/purchaseOrders";

function money(value: number | null): string {
  if (value === null) return "";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * "description // brand // pack" — §4.9's composed description, minus the
 * price (Mark, 2026-07-28: "remove any pricing information"). The document
 * already carried no extended prices and no total; the unit price was the last
 * money on it. What we think a case costs is our side of the conversation —
 * the vendor's invoice is theirs — and a stale catalog price printed on an
 * order invites an argument nobody wants to have.
 *
 * `money` is still used by the shopping list, which is internal.
 */
export function composedDescription(line: DocLine): string {
  return [
    // The VENDOR's description leads; our catalog name is the fallback, not a
    // prefix (Mark, 2026-07-28). They're filling this order off their own
    // product list, and "Napkins" is what we call it, not what they sell.
    line.description ?? line.item_name,
    line.brand,
    // The pack STRUCTURE tails the line — "12 × 32 oz", the thing you check a
    // delivery against. The Pack column carries only the type ("CS"), so this
    // is where the size went; skip it when the two would say the same word.
    line.pack === line.pack_type ? null : line.pack,
  ]
    .filter(Boolean)
    .join("  //  ");
}

/**
 * `sort` orders the GROUPS; `itemSort` orders the lines inside one.
 *
 * Both documents used to leave the within-group order to whatever PostgREST
 * happened to return, which is stable enough to look deliberate and isn't:
 * nothing in the query asks for an order, so a category's lines could come back
 * differently on a reprint. Mark asked for description as the secondary sort
 * (2026-08-03) and it belongs here rather than at one call site, because the
 * vendor PO and the shopping list share this function and a document sorted
 * only half the time is worse than one that never was.
 *
 * Empty keys sink, matching lib/tableSort's rule for every list in the app.
 */
export function groupBy<T>(
  items: T[],
  key: (item: T) => string,
  sort: (a: T) => number | string,
  itemSort?: (a: T, b: T) => number
): { label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = key(item);
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  if (itemSort) for (const list of groups.values()) list.sort(itemSort);
  return [...groups.entries()]
    .map(([label, list]) => ({ label, items: list, sort: sort(list[0]) }))
    .sort((a, b) =>
      typeof a.sort === "number" && typeof b.sort === "number"
        ? a.sort - b.sort
        : String(a.sort).localeCompare(String(b.sort))
    );
}

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

    /* ---- shopping list ---- */
    cPackWide: { width: 70, paddingRight: 6, paddingTop: 1 },
    cPrice: { width: 70, textAlign: "right", color: MUTED },
    vendorDesc: { fontSize: 8, color: MUTED, marginTop: 2 },
    totalWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 18 },
    /* The special-order totals' Classic Mac window: frame, black title bar,
       and a hard 3pt shadow drawn as an offset black box behind it. */
    totalWindow: { width: 212, position: "relative", marginRight: 3, marginBottom: 3 },
    totalShadow: { position: "absolute", top: 3, left: 3, right: -3, bottom: -3, backgroundColor: INK },
    totalBox: { borderWidth: 1.5, borderColor: INK, backgroundColor: "#fff" },
    totalBar: { backgroundColor: INK, height: 16, justifyContent: "center", alignItems: "center" },
    totalBarText: { ...caps(7, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
    totalLine: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    totalLabel: { ...caps(7.5, 0.12), fontFamily: "Helvetica-Bold" },
    totalValue: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  }),
};

/** The billing entity's name — what the vendor bills — falling back to the org. */
function entityName(org: OrgDocData): string {
  return org.billing?.entity_name ?? org.name;
}

/** The vendor-facing PO (spec §4.9). One PO per <Page> group; pass several
 *  POs to batch-print them as one file. */
export function PoPdf({ pos, org }: { pos: PoDocData[]; org: OrgDocData }) {
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

/** The in_person mode: same lines, walked by shop section. Internal, so
 *  prices and the estimated total are included. Takes `org` for the masthead,
 *  and so the two documents are call-compatible for the list's batch handler. */
export function ShoppingListPdf({ pos, org }: { pos: PoDocData[]; org: OrgDocData }) {
  return (
    <Document>
      {pos.map((po) => {
        const total = po.lines.reduce((sum, l) => sum + l.qty * (l.unit_price ?? 0), 0);
        return (
          <Page key={po.id} size="LETTER" style={s.page}>
            <View style={s.masthead} fixed>
              <Text style={s.wordmark}>{entityName(org)}</Text>
              <View style={s.mastheadRight}>
                <Text style={s.mastheadLine}>Shopping list</Text>
                <Text style={s.mastheadLine}>{po.po_number}</Text>
              </View>
            </View>

            <View style={s.body}>
              <View style={s.headingRow}>
                <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
                  <Text style={s.kicker}>Shopping list</Text>
                  <Text style={s.h1}>{po.vendor_name}</Text>
                  <Text style={s.caption}>
                    {[`${po.location_code} ${po.location_name}`, isoDay(po.order_date)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <View style={s.numberBlock}>
                  <Text style={s.kicker}>No.</Text>
                  <Text style={s.number}>{po.po_number}</Text>
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
                  <Text style={[s.th, { width: 36, textAlign: "right", paddingRight: 10 }]}>Qty</Text>
                  <Text style={[s.th, { width: 70 }]}>Pack</Text>
                  <Text style={[s.th, s.cDesc]}>Item</Text>
                  <Text style={[s.th, { width: 70, textAlign: "right" }]}>Price</Text>
                </View>
                {groupBy(
                  po.lines,
                  (l) => l.shop_section ?? "No section",
                  (l) => l.shop_section_sort ?? Number.MAX_SAFE_INTEGER,
                  compareDocumentLines
                ).map((group) => (
                  <View key={group.label}>
                    <Text style={s.groupBand}>{group.label}</Text>
                    {group.items.map((line) => (
                      <View key={line.id} style={s.row} wrap={false}>
                        <View style={s.cBox}>
                          <View style={s.box} />
                        </View>
                        <Text style={s.cQty}>{qtyText(line.qty)}</Text>
                        <Text style={s.cPackWide}>{line.pack ?? ""}</Text>
                        <View style={s.cDesc}>
                          <Text style={s.itemName}>
                            {[line.item_name ?? line.description, line.brand].filter(Boolean).join("  //  ")}
                          </Text>
                          {line.description && line.description !== line.item_name ? (
                            <Text style={s.vendorDesc}>{line.description}</Text>
                          ) : null}
                        </View>
                        <Text style={line.unit_price !== null ? s.cPrice : [s.cPrice, s.empty]}>
                          {line.unit_price !== null ? `${money(line.unit_price)} ea` : "—"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>

              <View style={s.totalWrap} wrap={false}>
                <View style={s.totalWindow}>
                <View style={s.totalShadow} />
                <View style={s.totalBox}>
                  <View style={s.totalBar}>
                    <Text style={s.totalBarText}>Estimate</Text>
                  </View>
                  <View style={s.totalLine}>
                    <Text style={s.totalLabel}>Estimated total</Text>
                    <Text style={s.totalValue}>{money(total)}</Text>
                  </View>
                </View>
                </View>
              </View>
            </View>

            <DocFooter>{`${entityName(org)} · Shopping list ${po.po_number}`}</DocFooter>
          </Page>
        );
      })}
    </Document>
  );
}
