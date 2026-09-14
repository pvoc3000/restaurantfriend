// A vendor's active items as a price list — the Vendor List Report (Mark,
// 2026-09-14): "a list of all active vendor items for the current vendor,
// grouped by type, and sorted by item … package sizes and unit price. This will
// be used to show another vendor so they can try to match pricing."
//
// Rendered client-side with @react-pdf/renderer; import DYNAMICALLY from a
// click handler (`PoPdfDocs`' idiom). Prices are the working shop's — design
// rule 6, override then catalog — since that is what the shop actually pays.

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// @react-pdf hyphenates by default; nothing here wants it (see ChecklistPdf).
Font.registerHyphenationCallback((word) => [word]);

// The bundled Helvetica is WinAnsi and silently DROPS characters it cannot
// place — ChecklistPdf's lesson. A pack label carries "×".
const PDF_SAFE: [RegExp, string][] = [
  [/[–—]/g, "-"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, "..."],
  [/×/g, "x"],
  [/·/g, "-"],
];
function pdfText(raw: string | null | undefined): string {
  let out = raw ?? "";
  for (const [from, to] of PDF_SAFE) out = out.replace(from, to);
  return out;
}

export type VendorListRow = {
  item: string;
  productId: string | null;
  brand: string | null;
  description: string | null;
  pack: string | null;
  price: number | null;
  unitPrice: number | null;
  baseUnit: string | null;
};

export type VendorListGroup = { type: string; rows: VendorListRow[] };

export type VendorListData = {
  orgName: string;
  vendorName: string;
  locationCode: string | null;
  dateLabel: string;
  groups: VendorListGroup[];
  itemCount: number;
};

const COLS = {
  item: "22%",
  productId: "11%",
  brand: "12%",
  description: "25%",
  pack: "12%",
  price: "8%",
  unit: "10%",
} as const;

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  banner: {
    backgroundColor: "#000",
    color: "#fff",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, marginBottom: 10 },
  metaText: { fontSize: 9, color: "#444" },
  headRow: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: "#000",
    paddingBottom: 3,
    marginBottom: 2,
  },
  head: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase" },
  group: {
    marginTop: 8,
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: "#e5e5e5",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
  },
  cell: { paddingRight: 6 },
  right: { textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#666",
  },
});

function money(n: number | null): string {
  return n === null ? "-" : `$${n.toFixed(2)}`;
}

function unitMoney(n: number | null, unit: string | null): string {
  if (n === null) return "-";
  // Sub-cent unit prices are common; show enough to compare two vendors.
  const digits = n < 0.1 ? 4 : 2;
  return `$${n.toFixed(digits)}${unit ? `/${unit}` : ""}`;
}

function Header() {
  return (
    <View style={s.headRow} fixed>
      <Text style={[s.head, s.cell, { width: COLS.item }]}>Item</Text>
      <Text style={[s.head, s.cell, { width: COLS.productId }]}>Product ID</Text>
      <Text style={[s.head, s.cell, { width: COLS.brand }]}>Brand</Text>
      <Text style={[s.head, s.cell, { width: COLS.description }]}>Description</Text>
      <Text style={[s.head, s.cell, { width: COLS.pack }]}>Package</Text>
      <Text style={[s.head, s.cell, s.right, { width: COLS.price }]}>Price</Text>
      <Text style={[s.head, s.right, { width: COLS.unit }]}>Unit price</Text>
    </View>
  );
}

export function VendorItemListPdf({ data }: { data: VendorListData }) {
  return (
    <Document title={pdfText(`${data.vendorName} price list`)}>
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Text style={s.banner}>{pdfText(`${data.vendorName} - Price List`)}</Text>
        <View style={s.meta}>
          <Text style={s.metaText}>
            {pdfText(
              `${data.orgName}${data.locationCode ? ` - ${data.locationCode}` : ""} - ${
                data.itemCount
              } active item${data.itemCount === 1 ? "" : "s"}`
            )}
          </Text>
          <Text style={s.metaText}>{data.dateLabel}</Text>
        </View>

        <Header />

        {data.groups.length === 0 && (
          <Text style={{ marginTop: 12 }}>This vendor has no active items.</Text>
        )}

        {data.groups.map((g) => (
          <View key={g.type}>
            <Text style={s.group} minPresenceAhead={20}>
              {pdfText(g.type)}
            </Text>
            {g.rows.map((r, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={[s.cell, { width: COLS.item }]}>{pdfText(r.item)}</Text>
                <Text style={[s.cell, { width: COLS.productId }]}>{pdfText(r.productId)}</Text>
                <Text style={[s.cell, { width: COLS.brand }]}>{pdfText(r.brand)}</Text>
                <Text style={[s.cell, { width: COLS.description }]}>
                  {pdfText(r.description)}
                </Text>
                <Text style={[s.cell, { width: COLS.pack }]}>{pdfText(r.pack) || "-"}</Text>
                <Text style={[s.cell, s.right, { width: COLS.price }]}>{money(r.price)}</Text>
                <Text style={[s.right, { width: COLS.unit }]}>
                  {unitMoney(r.unitPrice, r.baseUnit)}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text>{pdfText(data.vendorName)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
