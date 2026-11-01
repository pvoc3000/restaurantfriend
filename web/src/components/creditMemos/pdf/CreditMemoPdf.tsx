// THE CREDIT MEMO (migration 218, docs/customer-credit-memos-brief.md §9, §9a)
// — the customer invoice's paper and parts (`components/pdf/appDocument`), so
// a memo reads as the invoice's sibling: the masthead, who it credits, its
// number and date, the invoice it corrects, the reason, the lines in §9a's
// table (Item · Billed · Delivered · Price · Short · Credit), the total in the
// Mac window, and how it is settled.
//
// The invoice's own styles live in `SpecialOrderPdfs` and are not exported;
// the few this page needs are copied below rather than that file widened.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  Field,
  INK,
  MARK_FILL,
  MUTED,
  SUBTLE,
  caps,
  docStyles,
  isoDay,
  qtyText,
  topGapDocStyles,
} from "@/components/pdf/appDocument";
import type { DocOrg } from "@/lib/specialOrderDocs";
import type { CreditMemoPaperLine } from "@/lib/creditMemos";

export type CreditMemoDoc = {
  /** "CM-10000". */
  number: string;
  kindLabel: string;
  reason: string;
  note: string | null;
  issued_on: string;
  /** "INV-10025-2", or null for an allowance that names none. */
  invoice: string | null;
  /** "SO-10137 · 10/31/2026". */
  order: string | null;
  customer: { name: string; phone: string | null; email: string | null };
  lines: CreditMemoPaperLine[];
  total: number;
  /** "This credit will be applied to your next invoice." / "Refunded to …". */
  settlement: string;
  void: boolean;
};

const s = {
  ...docStyles,
  ...topGapDocStyles,
  ...StyleSheet.create({
    row: { flexDirection: "row", paddingVertical: 4, alignItems: "flex-start" },
    cItem: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
    cNum: { width: 50, textAlign: "right" },
    cPrice: { width: 54, textAlign: "right" },
    cCredit: { width: 66, textAlign: "right" },
    foot: { flexDirection: "row", gap: 28, marginTop: 18, alignItems: "flex-start" },
    notes: { flexGrow: 1, flexBasis: 0 },
    windowWrap: { width: 212, position: "relative", marginRight: 3, marginBottom: 3 },
    windowShadow: { position: "absolute", top: 3, left: 3, right: -3, bottom: -3, backgroundColor: INK },
    window: { borderWidth: 1.5, borderColor: INK, backgroundColor: "#fff" },
    titleBar: { backgroundColor: INK, height: 16, justifyContent: "center", alignItems: "center" },
    titleBarText: { ...caps(7, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
    grand: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: MARK_FILL,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    grandLabel: { ...caps(7.5, 0.12), fontFamily: "Helvetica-Bold" },
    grandValue: { fontSize: 15, fontFamily: "Helvetica-Bold" },
    settle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 14 },
    voidMark: { ...caps(9, 0.12), fontFamily: "Helvetica-Bold", color: "#b42318", marginTop: 6 },
  }),
};

function money(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const num = (v: number | null) => (v === null ? "" : qtyText(v));

export function CreditMemoPdf({ memo, org }: { memo: CreditMemoDoc; org: DocOrg }) {
  // A short shipment's own columns only where a line has them; an allowance
  // is an amount and a reason.
  const quantities = memo.lines.some((l) => l.kind === "item");
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
              <Text style={s.kicker}>Credit memo</Text>
              <Text style={s.h1}>{memo.customer.name}</Text>
              <Text style={s.caption}>
                {[`Issued ${isoDay(memo.issued_on)}`, memo.invoice ? `Credits invoice ${memo.invoice}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {memo.void ? <Text style={s.voidMark}>Void</Text> : null}
            </View>
            <View style={s.numberBlock}>
              <Text style={s.kicker}>No.</Text>
              <Text style={s.number}>{memo.number}</Text>
            </View>
          </View>

          <View style={s.blocks}>
            <View style={s.block}>
              <Text style={s.sectionHead}>Credit to</Text>
              <Field label="Name" value={memo.customer.name} />
              <Field label="Phone" value={memo.customer.phone} />
              <Field label="Email" value={memo.customer.email} />
            </View>
            <View style={s.block}>
              <Text style={s.sectionHead}>Credit memo</Text>
              <Field label="Number" value={memo.number} />
              <Field label="Issued" value={isoDay(memo.issued_on)} />
              <Field label="Invoice" value={memo.invoice} />
              <Field label="Order" value={memo.order} />
              <Field label="Reason" value={memo.reason} />
            </View>
          </View>

          <View style={s.items}>
            <Text style={[s.sectionHead, { borderBottomWidth: 0, marginBottom: 6 }]}>
              {memo.kindLabel} <Text style={s.sectionCount}>{memo.lines.length}</Text>
            </Text>
            <View style={s.tableHead} fixed>
              <Text style={[s.th, s.cItem]}>Item</Text>
              {quantities ? (
                <>
                  <Text style={[s.th, s.cNum]}>Billed</Text>
                  <Text style={[s.th, s.cNum]}>Delivered</Text>
                  <Text style={[s.th, s.cPrice]}>Price</Text>
                  <Text style={[s.th, s.cNum]}>Short</Text>
                </>
              ) : null}
              <Text style={[s.th, s.cCredit]}>Credit</Text>
            </View>
            {memo.lines.map((l, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={[s.cItem, l.kind === "item" ? s.itemName : {}]}>{l.item}</Text>
                {quantities ? (
                  <>
                    <Text style={s.cNum}>{num(l.billed)}</Text>
                    <Text style={s.cNum}>{num(l.delivered)}</Text>
                    <Text style={s.cPrice}>{l.price === null ? "" : money(l.price)}</Text>
                    <Text style={s.cNum}>{num(l.short)}</Text>
                  </>
                ) : null}
                <Text style={[s.cCredit, l.amount < 0 ? { color: MUTED } : {}]}>{money(l.amount)}</Text>
              </View>
            ))}
          </View>

          <View style={s.foot} wrap={false}>
            <View style={s.notes}>
              <Text style={s.sectionHead}>Notes</Text>
              {memo.note ? (
                <Text style={s.prose}>{memo.note}</Text>
              ) : (
                <Text style={[s.prose, { color: SUBTLE }]}>—</Text>
              )}
              <Text style={s.settle}>{memo.settlement}</Text>
            </View>
            <View style={s.windowWrap}>
              <View style={s.windowShadow} />
              <View style={s.window}>
                <View style={s.titleBar}>
                  <Text style={s.titleBarText}>Credit</Text>
                </View>
                <View style={memo.void ? [s.grand, { backgroundColor: "#fff" }] : s.grand}>
                  <Text style={s.grandLabel}>Total credit</Text>
                  <Text style={s.grandValue}>{money(memo.void ? 0 : memo.total)}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {org.name} · Credit memo {memo.number}
          </Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
