// The PO documents, rendered to PDF client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY (await import(...)) from a click handler —
// the renderer is heavy and nothing on a normal page load needs it.
//
// Two documents share the visual language:
// - PoPdf — the vendor-facing purchase order (spec §4.9, modelled on sent PO
//   112-18008-01). Unit prices only, NO extended prices and NO total — the
//   vendor doesn't get our math; internal totals live on the PO detail screen.
// - ShoppingListPdf — the in_person processing mode: same lines sorted by shop
//   section for walking a store. Internal document, so prices and a running
//   total ARE here.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  formatAddress,
  summaryLine,
  trimNumber,
  type DocLine,
  type OrgDocData,
  type PoDocData,
} from "@/lib/poProcessing";

/**
 * FOUR sizes and TWO greys, and nothing else (Mark, 2026-07-27 — "I want to
 * simplify it"). The document had drifted to seven sizes and four greys, most
 * of them one-offs:
 *
 *   16  Helvetica-Bold     the document's name — org, or "Shopping list"
 *   14  Helvetica-Bold     "PURCHASE ORDER"; regular for the number beside it
 *    9  Helvetica[-Bold]   everything you read: lines, meta values, totals
 *    8  Helvetica          secondary — labels, addresses, instructions, footer
 *
 *   #111  body
 *   #666  secondary
 *
 * 7pt and 8pt were indistinguishable in print but split across four styles,
 * and 10 and 12 each appeared exactly once. Weight and colour carry the
 * hierarchy instead — a printed order is read at arm's length on a shelf, so
 * fewer, larger steps beat a fine-grained scale.
 */
const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  orgName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  orgLine: { fontSize: 8, color: "#666" },
  poTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
  // Same size as the title, regular weight: the number is the other half of
  // the heading, not a caption under it. Was the only 12pt in the document.
  poNumber: { fontSize: 14, textAlign: "right", marginTop: 2 },
  metaGrid: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#111",
  },
  metaBlock: { flexGrow: 1, flexBasis: 0 },
  metaLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#666",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: { fontSize: 9 },
  summary: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
    textAlign: "right",
  },
  category: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    backgroundColor: "#eee",
    paddingVertical: 3,
    paddingHorizontal: 4,
    marginTop: 8,
    marginBottom: 2,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
  },
  checkbox: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: "#111",
    marginRight: 6,
    marginTop: 1,
  },
  colProduct: { width: 60, color: "#666" },
  colQty: { width: 40, fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 8 },
  colPack: { width: 70, paddingRight: 6 },
  colDesc: { flexGrow: 1, flexBasis: 0 },
  instructions: { color: "#666", fontSize: 8, marginTop: 1 },
  notes: { marginTop: 12, fontSize: 8, color: "#666" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#666",
    textAlign: "center",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    // Body size, bold — same treatment as the summary line at the top, which
    // is the other number that sums the page. Was the only 10pt.
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
});

function money(value: number | null): string {
  if (value === null) return "";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "item // brand // pack // unit price" — §4.9's composed description. */
function composedDescription(line: DocLine): string {
  return [
    line.item_name ?? line.description,
    line.brand,
    line.description !== line.item_name ? line.description : null,
    line.unit_price !== null ? money(line.unit_price) : null,
  ]
    .filter(Boolean)
    .join("  //  ");
}

function groupBy<T>(
  items: T[],
  key: (item: T) => string,
  sort: (a: T) => number | string
): { label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = key(item);
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()]
    .map(([label, list]) => ({ label, items: list, sort: sort(list[0]) }))
    .sort((a, b) =>
      typeof a.sort === "number" && typeof b.sort === "number"
        ? a.sort - b.sort
        : String(a.sort).localeCompare(String(b.sort))
    );
}

function OrgBlock({ org }: { org: OrgDocData }) {
  const billing = org.billing;
  return (
    <View>
      <Text style={styles.orgName}>{billing?.entity_name ?? org.name}</Text>
      {[billing?.address1 ?? billing?.street1,
        [billing?.city, [billing?.state, billing?.zip].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", "),
        billing?.phone,
        billing?.email]
        .filter(Boolean)
        .map((line, i) => (
          <Text key={i} style={styles.orgLine}>
            {line}
          </Text>
        ))}
    </View>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** The vendor-facing PO (spec §4.9). One PO per <Page> group; pass several
 *  POs to batch-print them as one file. */
export function PoPdf({ pos, org }: { pos: PoDocData[]; org: OrgDocData }) {
  return (
    <Document>
      {pos.map((po) => (
        <Page key={po.id} size="LETTER" style={styles.page}>
          <View style={styles.headerRow}>
            <OrgBlock org={org} />
            <View>
              <Text style={styles.poTitle}>PURCHASE ORDER</Text>
              <Text style={styles.poNumber}>{po.po_number}</Text>
            </View>
          </View>

          <View style={styles.metaGrid}>
            <Meta label="Date">
              <Text style={styles.metaValue}>{po.order_date}</Text>
            </Meta>
            <Meta label="Vendor">
              <Text style={styles.metaValue}>{po.vendor_name}</Text>
              {po.account_number && (
                <Text style={styles.metaValue}>Account # {po.account_number}</Text>
              )}
            </Meta>
            <Meta label="Delivery">
              <Text style={styles.metaValue}>{po.delivery_date ?? "—"}</Text>
            </Meta>
            <Meta label={`Ship to — ${po.location_code}`}>
              {(formatAddress(po.ship_to).length > 0
                ? formatAddress(po.ship_to)
                : [po.location_name]
              ).map((line, i) => (
                <Text key={i} style={styles.metaValue}>
                  {line}
                </Text>
              ))}
            </Meta>
            <Meta label="Bill to">
              <Text style={styles.metaValue}>
                {org.billing?.entity_name ?? org.name}
              </Text>
              {formatAddress(
                org.billing
                  ? { ...org.billing, street1: org.billing.address1 }
                  : null
              ).map((line, i) => (
                <Text key={i} style={styles.metaValue}>
                  {line}
                </Text>
              ))}
            </Meta>
          </View>

          <Text style={styles.summary}>{summaryLine(po.lines)}</Text>

          {groupBy(
            po.lines,
            (l) => l.category ?? "Other",
            (l) => l.category ?? "zzz"
          ).map((group) => (
            <View key={group.label}>
              <Text style={styles.category}>{group.label}</Text>
              {group.items.map((line) => (
                <View key={line.id} style={styles.line} wrap={false}>
                  <View style={styles.checkbox} />
                  <Text style={styles.colProduct}>{line.product_id ?? ""}</Text>
                  <Text style={styles.colQty}>{trimNumber(line.qty)}</Text>
                  <Text style={styles.colPack}>{line.pack ?? ""}</Text>
                  <View style={styles.colDesc}>
                    <Text>{composedDescription(line)}</Text>
                    {line.instructions && (
                      <Text style={styles.instructions}>{line.instructions}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ))}

          {po.notes && <Text style={styles.notes}>Notes: {po.notes}</Text>}

          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }) =>
              `${po.po_number} · ${pageNumber} / ${totalPages}`
            }
            fixed
          />
        </Page>
      ))}
    </Document>
  );
}

/** The in_person mode: same lines, walked by shop section. Internal, so
 *  prices and the total are included. Takes `org` unused so the two documents
 *  are call-compatible for the list's batch handler. */
export function ShoppingListPdf({ pos }: { pos: PoDocData[]; org: OrgDocData }) {
  return (
    <Document>
      {pos.map((po) => {
        const total = po.lines.reduce(
          (sum, l) => sum + l.qty * (l.unit_price ?? 0),
          0
        );
        return (
          <Page key={po.id} size="LETTER" style={styles.page}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.orgName}>Shopping list</Text>
                <Text style={styles.orgLine}>
                  {po.vendor_name} · {po.location_code} · {po.order_date} ·{" "}
                  {po.po_number}
                </Text>
              </View>
              <Text style={styles.summary}>{summaryLine(po.lines)}</Text>
            </View>

            {groupBy(
              po.lines,
              (l) => l.shop_section ?? "No section",
              (l) => l.shop_section_sort ?? Number.MAX_SAFE_INTEGER
            ).map((group) => (
              <View key={group.label}>
                <Text style={styles.category}>{group.label}</Text>
                {group.items.map((line) => (
                  <View key={line.id} style={styles.line} wrap={false}>
                    <View style={styles.checkbox} />
                    <Text style={styles.colQty}>{trimNumber(line.qty)}</Text>
                    <Text style={styles.colPack}>{line.pack ?? ""}</Text>
                    <View style={styles.colDesc}>
                      <Text>
                        {[line.item_name ?? line.description, line.brand]
                          .filter(Boolean)
                          .join("  //  ")}
                      </Text>
                      {line.description && line.description !== line.item_name && (
                        <Text style={styles.instructions}>{line.description}</Text>
                      )}
                    </View>
                    <Text style={styles.colProduct}>
                      {line.unit_price !== null
                        ? `${money(line.unit_price)} ea`
                        : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text>Estimated total {money(total)}</Text>
            </View>

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }) =>
                `${po.po_number} · ${pageNumber} / ${totalPages}`
              }
              fixed
            />
          </Page>
        );
      })}
    </Document>
  );
}
