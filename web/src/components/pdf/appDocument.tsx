// THE APP'S DESIGN LANGUAGE, IN PRINT — the parts every document drawn in it
// shares (the special-order documents since 2026-09-25, and the purchase
// order). Extracted when the second family arrived, so the two cannot drift:
// a masthead, a heading, a field or a group band here is the same thing on a
// quote and on a PO.
//
// What each rule is on screen: the black masthead band is the app's masthead;
// the heading is `ui/PageHeading` (big bold caps, a tracked caption); a
// section head is `ui/SectionHeading`; a field is a detail screen's `dl` —
// grey tracked caps beside a black value, NO box, since nothing printed is
// editable; the table head and group band are `DataTable`'s; an empty value is
// an em dash.

import { StyleSheet, Text, View } from "@react-pdf/renderer";

/* The app's tokens, in print. */
export const INK = "#000000";
export const MUTED = "#545454"; // --rf-neutral-600, secondary text
export const SUBTLE = "#757575"; // --rf-neutral-500, captions and labels
export const HAIRLINE = "#e4e4e4"; // --rf-neutral-200
export const STRIP_FILL = "#f1f1f1"; // --rf-neutral-100, a group strip
export const MARK_FILL = "#ffe98a"; // --rf-yellow-200
export const STOP_FILL = "#ffcfc9"; // --rf-red-200, "stop"

/* Tracking, as the app sets it: +0.06em for names and commands, +0.12em for
   labels. react-pdf takes letterSpacing in points, so it is per size. */
export const caps = (size: number, em: number) => ({
  fontSize: size,
  letterSpacing: size * em,
  textTransform: "uppercase" as const,
});

export const PAGE_X = 40;

export const docStyles = StyleSheet.create({
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
  // paddingTop sets the label's baseline level with the value's first line.
  // react-pdf puts a value's extra leading BELOW each line, not split above
  // and below, so the value's leading does not move this.
  label: { ...caps(6.5, 0.12), color: SUBTLE, width: 54, paddingTop: 1.5 },
  // 8.5pt with 1.35 leading (Mark, 2026-09-25: the values at 9pt with no
  // leading looked "a little too big/cramped", worst on a wrapped address).
  // The leading is safe HERE: the extra blank line react-pdf once reserved
  // came from `lineHeight` on a TABLE cell's flexBasis-0 column (the item
  // notes), and a field's value measured clean at every wrap — checked on the
  // PO's addresses and the quote's contact block.
  value: { flexGrow: 1, flexBasis: 0, fontSize: 8.5, lineHeight: 1.35 },
  empty: { color: SUBTLE },

  /* ---- tables (DataTable) ---- */
  items: { marginTop: 20 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: INK,
    paddingBottom: 4,
  },
  th: { ...caps(6.5, 0.12), color: SUBTLE },
  itemName: { ...caps(8.5, 0.06), fontFamily: "Helvetica-Bold" },
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

  prose: { fontSize: 9, color: INK },

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

/** Quantities print as integers where they are integers — "1", never "1.00". */
export function qtyText(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2)));
}

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** `2026-10-03` → `SAT 2026-10-03` — the app's ISO date with its weekday. */
export function isoDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${WEEKDAY[day]} ${m[0]}`;
}

/** A label beside its value, a detail screen's `dl` row; `—` when empty. */
export function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const v = (value ?? "").trim();
  return (
    <View style={docStyles.field}>
      <Text style={docStyles.label}>{label}</Text>
      <Text style={v ? docStyles.value : [docStyles.value, docStyles.empty]}>{v || "—"}</Text>
    </View>
  );
}

/** The fixed footer: what this is on the left, the page count on the right. */
export function DocFooter({ children }: { children: string }) {
  return (
    <View style={docStyles.footer} fixed>
      <Text style={docStyles.footerText}>{children}</Text>
      <Text
        style={docStyles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}
