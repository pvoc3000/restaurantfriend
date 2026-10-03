// The night's packet, rendered client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY from a click handler — the renderer is heavy
// and nothing on a normal page load needs it.
//
// SEVEN DOCUMENTS, ONE DATASET (production brief decision 5). The premade
// schedule is the record; the three tray guides and the three element sheets
// are the same lines re-cut, computed here and never stored. One `<Document>`
// with a page run per part, which is `PoPdfDocs`' multi-document idiom — a
// packet is one print job, not seven downloads.
//
// DRAWN IN THE APP'S OWN DESIGN LANGUAGE since 2026-09-25 (Mark: "now do the
// production packet"), from the shared `components/pdf/appDocument` parts the
// special-order documents and the PO use: the black masthead band, the sheet's
// name as the page heading with the night's date beside it, type bands black
// and size bands the light-grey group strip. The tally strip's and tray
// ruler's filled cells are that same grey — the orange and green they wore
// meant nothing in the app's palette, where colour is state. Every count,
// total, write-in box and rule is unchanged; the previous look is in git
// history at b727828a.
//
// One rule inherited from the sheets already in this folder:
//   * NO `≥` GLYPH. @react-pdf's built-in Helvetica is WinAnsi-encoded and
//     renders it as a stray "e" — which does not merely lose the claim, it
//     replaces it with a typo. Lower bounds are spelled "AT LEAST" in words.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  HAIRLINE,
  INK,
  MUTED,
  STRIP_FILL,
  SUBTLE,
  caps,
  docStyles,
  isoDay,
  topGapDocStyles,
} from "@/components/pdf/appDocument";
import {
  countTotals,
  rollUp,
  tallyBoxes,
  trayRuler,
  packetDate,
  totalDonuts,
  TRAY_CELLS,
  type Grain,
  type RollSize,
  type RollSubtype,
  type RollType,
  type ScheduleLine,
} from "@/lib/productionSchedule";
import { premadeSheetTitle } from "@/lib/productionPacket";
import { kitchenOrderPages } from "@/components/specialOrders/pdf/SpecialOrderPdfs";
import type { OrderDocData } from "@/lib/specialOrderDocs";
import type { PacketData, PacketKitchen, PacketSchedule, SheetElement } from "@/lib/productionPacket";

export type PacketPart =
  | "special"
  | "premade"
  | "baker"
  | "fryer"
  | "decorator"
  | "donut"
  | "weekly";

// NO HINTS (Mark, 2026-08-28). Each part used to carry a gloss — "one per shop
// — the record", "what to cut" — and the names below say what they are to
// anybody who works here. A caption under every row of a checklist is a second
// thing to read on the way to a decision that is already obvious.
//
// WHAT THE DIALOG OFFERS, WHICH IS NO LONGER EVERYTHING IT CAN RENDER (Mark,
// 2026-09-01: "remove the 'production items sheet' 'AB Items' and 'weekly
// production' options from the checkbox list"). Four parts, not seven.
//
// The RENDERERS are deliberately left in place — `DonutSheetPage` and
// `WeeklySheetPage` are still reached through `parts`, and `PacketPart` still
// names them (the AB sheet was deleted with AB, 2026-09-30). They are what `_production.mer` was read for, and putting a
// row back is one line here rather than a rebuild. Nothing passes those keys
// today, so they are unreachable from the app; that is a known cost of keeping
// the door rather than the corridor.
export const PACKET_PARTS: { key: PacketPart; label: string }[] = [
  // SPECIAL ORDERS LEAD, because they are the only pages with a customer's name
  // on them and a time somebody is standing in the shop at. Everything below is
  // the night's own work.
  { key: "special", label: "Special orders" },
  { key: "premade", label: "Premade schedule" },
  { key: "baker", label: "Baker tray guide" },
  { key: "fryer", label: "Fryer tray guide" },
  { key: "decorator", label: "Decorator tray guide" },
];

/** The tray guides' side margin and ruler indent, in points — FileMaker's. */
const GUIDE_X = 19;
const GUIDE_INDENT = 25;

const styles = {
  ...docStyles,
  ...topGapDocStyles,
  ...StyleSheet.create({
    // The night, large, where a record's number sits on the other documents.
    nightDate: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 3 },
    blurb: { fontSize: 8, color: MUTED, marginTop: 6 },

    // A black band DELIMITS — the app's own rule for a group heading.
    typeBand: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: INK,
      paddingVertical: 4,
      // No right padding: the premade band's TOTAL and L/O labels must sit
      // exactly over the write-in boxes, which run to the margin.
      paddingLeft: 6,
      paddingRight: 0,
      marginTop: 12,
    },
    typeBandText: { ...caps(8, 0.12), fontFamily: "Helvetica-Bold", color: "#fff" },
    typeBandTotal: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#fff", marginLeft: 10 },
    typeBandRight: { marginLeft: "auto", flexDirection: "row" },
    bandLabel: { ...caps(6, 0.12), color: "#fff", width: 34, textAlign: "center", marginLeft: 4 },

    // The app's group STRIP, one step below the band.
    sizeBand: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: STRIP_FILL,
      paddingVertical: 3,
      paddingHorizontal: 6,
    },
    sizeBandText: { ...caps(7, 0.12), fontFamily: "Helvetica-Bold" },
    sizeBandTotal: { fontSize: 8, fontFamily: "Helvetica-Bold", marginLeft: 10 },

    row: { flexDirection: "row", alignItems: "center", marginTop: 3 },
    rowLabel: { width: 118, paddingRight: 4 },
    rowName: { fontSize: 8 },
    rowSub: { fontSize: 6.5, color: SUBTLE },
    rowPar: { width: 28, fontSize: 8.5, fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 6 },

    strip: { flexDirection: "row", borderWidth: 1, borderColor: INK, flexGrow: 1 },
    box: {
      flexGrow: 1,
      flexBasis: 0,
      borderRightWidth: 0.5,
      borderRightColor: HAIRLINE,
      paddingVertical: 3,
      alignItems: "center",
    },
    boxOn: { backgroundColor: STRIP_FILL },
    boxText: { fontSize: 7, color: INK },
    boxTextOff: { fontSize: 7, color: HAIRLINE },

    // A box somebody writes in — the app's 1px box, as on every document.
    writeIn: { width: 34, height: 14, borderWidth: 1, borderColor: INK, marginLeft: 4 },
    // Room for "7.5" in a baker's hand.
    batchWriteIn: { width: 60, height: 18, borderWidth: 1, borderColor: INK },
    // A name in a baker's hand.
    preparedByWriteIn: { width: 160, height: 18, borderWidth: 1, borderColor: INK, marginLeft: 8 },
    batchWriteInLabel: { width: 60, paddingLeft: 3 },
    preparedByLabel: { width: 160, marginLeft: 8, paddingLeft: 3 },

    /* ---- the three tray guides ----
       LAID OUT ON FILEMAKER'S OWN GEOMETRY (Mark, 2026-10-03: "follow the
       original design as closely as possible. Pay particular attention to the
       size of the boxes, and the spacing of elements"), measured off the real
       2026-10-01 DF01 baker guide with `pdftotext -bbox`: 19pt side margins,
       the ruler indented 25pt, 25 cells on a 22pt pitch and 22pt tall, the
       tray number top-left and the count bottom-right, a 49pt step from one
       cut to the next. The type, the tracked caps, the masthead and the grey
       fill are the app's; the measurements are the original's. The side
       margin is narrower than every other document's 40pt BECAUSE of the box:
       25 cells of 22pt plus the indent is 575pt, and a 40pt margin leaves 532. */
    guideMasthead: { ...topGapDocStyles.masthead, paddingHorizontal: GUIDE_X },
    guideBody: { paddingHorizontal: GUIDE_X },
    guideFooter: { ...docStyles.footer, left: GUIDE_X, right: GUIDE_X },
    guideTitle: { ...caps(18, -0.02), fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.1 },
    guideBlurb: { fontSize: 8, color: MUTED, marginTop: 2 },
    guideDate: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
    guideTotal: { fontSize: 8, color: MUTED, marginTop: 4 },
    guideTypeBand: {
      backgroundColor: INK,
      height: 15,
      justifyContent: "center",
      paddingLeft: 4,
      marginTop: 12,
    },
    guideTypeText: { ...caps(10, 0.08), fontFamily: "Helvetica-Bold", color: "#fff" },
    guideSizeBand: {
      backgroundColor: STRIP_FILL,
      height: 14,
      justifyContent: "center",
      paddingLeft: 4,
      marginBottom: 2,
    },
    guideSizeText: { ...caps(8, 0.1), fontFamily: "Helvetica-Bold" },
    guideHead: { flexDirection: "row", alignItems: "baseline", height: 13, paddingTop: 3 },
    guideName: { ...caps(8.5, 0.06), fontFamily: "Helvetica-Bold", textDecoration: "underline" },
    guideOf: { ...caps(6, 0.12), color: SUBTLE, marginLeft: 5 },
    // The tray ruler: a cell per tray NUMBER, the count written inside the ones
    // the run fills. NOT the counting strip — answered question 3 says so.
    guideRuler: {
      flexDirection: "row",
      marginLeft: GUIDE_INDENT,
      marginTop: 2,
      height: 22,
      borderWidth: 1,
      borderColor: INK,
    },
    trayCell: {
      flexGrow: 1,
      flexBasis: 0,
      borderLeftWidth: 0.75,
      borderLeftColor: INK,
      justifyContent: "space-between",
      paddingHorizontal: 1.5,
      paddingTop: 1,
      paddingBottom: 1,
    },
    trayIndex: { fontSize: 6, color: SUBTLE },
    trayCount: { fontSize: 7.5, fontFamily: "Helvetica-Bold", textAlign: "right" },
    trayOn: { backgroundColor: STRIP_FILL },
    guideSubtotal: { marginLeft: GUIDE_INDENT, marginTop: 2.5, height: 9.5 },
    guideSubtotalText: { ...caps(6, 0.1) },
    guideCutTotal: { marginLeft: GUIDE_INDENT, marginTop: 1, marginBottom: 5 },
    guideCutTotalText: { ...caps(7, 0.1), fontFamily: "Helvetica-Bold" },
    guideTypeTotal: { marginLeft: GUIDE_INDENT, marginTop: 8, marginBottom: -1 },
    guideTypeTotalText: { ...caps(8.5, 0.06), fontFamily: "Helvetica-Bold" },

    subtotal: { flexDirection: "row", marginTop: 4, marginLeft: 118 },
    subtotalText: { ...caps(6, 0.12), color: SUBTLE },
    subtotalBatch: { ...caps(6, 0.12), color: SUBTLE, marginLeft: 24 },
    grandTotal: { flexDirection: "row", marginTop: 5, marginLeft: 118 },
    grandTotalText: { ...caps(7.5, 0.08), fontFamily: "Helvetica-Bold" },
    // A total row's counts, each under the write-in box it sums — the row's own
    // `writeIn` geometry, so the figure sits under the column it adds up.
    countCell: { width: 34, marginLeft: 4, textAlign: "center" },
    nightTotal: {
      flexDirection: "row",
      marginTop: 12,
      paddingTop: 5,
      borderTopWidth: 2,
      borderTopColor: INK,
      marginLeft: 118,
    },
    grandBatch: { fontSize: 9, fontFamily: "Helvetica-Bold", marginLeft: 24 },

    sheetHeadLabel: { ...caps(7.5, 0.08), fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 4 },
    sheetRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
    colElement: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
    colAmount: { width: 70, textAlign: "right", paddingRight: 8 },
    colShift: { width: 56 },
    colStock: { width: 70 },
    colMade: { width: 60 },
    cell: { fontSize: 8.5 },
    cellMuted: { fontSize: 7.5, color: MUTED },

    emptyNote: { fontSize: 9, color: SUBTLE, marginTop: 12 },
  }),
};

/** The packet's masthead band, on every page: the org, and what this is. */
function PacketMasthead({ packet, guide }: { packet: PacketData; guide?: boolean }) {
  return (
    <View style={guide ? styles.guideMasthead : styles.masthead} fixed>
      <Text style={styles.wordmark}>{packet.orgName}</Text>
      <View style={styles.mastheadRight}>
        <Text style={styles.mastheadLine}>Production packet</Text>
        <Text style={styles.mastheadLine}>Printed {packet.printedOn}</Text>
      </View>
    </View>
  );
}

/** A sheet's heading: the kitchen above the sheet's name, the night beside it. */
function SheetHeading({
  kicker,
  title,
  caption,
  date,
  children,
}: {
  kicker: string;
  title: string;
  caption?: string | null;
  date: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.headingRow}>
      <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.h1}>{title}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        {children}
      </View>
      <View style={styles.numberBlock}>
        <Text style={styles.kicker}>Night</Text>
        <Text style={styles.nightDate}>{isoDay(date) || date}</Text>
      </View>
    </View>
  );
}

/** The fixed footer: what this sheet is, and the page within the packet. */
function PacketFooter({ children, guide }: { children: string; guide?: boolean }) {
  return (
    <View style={guide ? styles.guideFooter : styles.footer} fixed>
      <Text style={styles.footerText}>{children}</Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function ProductionPacketPdf({
  packet,
  parts,
  orders = [],
}: {
  packet: PacketData;
  parts: PacketPart[];
  /**
   * The night's special orders, as KITCHEN ORDER sheets.
   *
   * Passed in rather than derived from `packet.schedules`, and that is the
   * whole of the care (Mark, 2026-09-01). A special order only appears among
   * those schedules if somebody SCHEDULED it — and measured on the live data,
   * of 33 orders printed since 2026-08-01 exactly 2 had a schedule, while 0 of
   * the 9 upcoming ones do. Deriving these from the packet would therefore
   * print two sheets in thirty-three and call itself "all documents", which is
   * decision 11's failure with the sign flipped: an absence that looks like
   * completeness. So the CALLER says which orders the night has, from the same
   * list the screen is showing.
   */
  orders?: OrderDocData[];
}) {
  const want = new Set(parts);
  return (
    <Document title={`Production packet ${packet.printedOn}`}>
      {want.has("special") && orders.length > 0
        ? kitchenOrderPages(orders, packet.orgName, packet.printedOn)
        : null}

      {want.has("premade")
        ? packet.schedules.map((s) => (
            <PremadePage key={`p-${s.id}`} schedule={s} packet={packet} />
          ))
        : null}

      {packet.kitchens.map((k) => (
        <Fragmentish key={k.key}>
          {want.has("baker") ? <TrayGuidePage kitchen={k} packet={packet} grain="subtype" /> : null}
          {want.has("fryer") ? <TrayGuidePage kitchen={k} packet={packet} grain="finish" /> : null}
          {want.has("decorator") ? <TrayGuidePage kitchen={k} packet={packet} grain="item" /> : null}
          {want.has("donut") ? <DonutSheetPage kitchen={k} packet={packet} /> : null}
          {want.has("weekly") ? <WeeklySheetPage kitchen={k} packet={packet} /> : null}
        </Fragmentish>
      ))}
    </Document>
  );
}

/** `<Document>` accepts Pages and arrays of them; a real Fragment confuses the
 *  reconciler on some versions, so children are flattened by hand. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* -- the premade schedule: the RECORD --------------------------------------- */

function PremadePage({ schedule, packet }: { schedule: PacketSchedule; packet: PacketData }) {
  const rolled = rollUp(schedule.lines, "item");

  const { heading, subtitle } = premadeSheetTitle(schedule);

  return (
    <Page size="LETTER" style={styles.page} wrap>
      <PacketMasthead packet={packet} />
      <View style={styles.body}>
      {/* The order's own name, under the order's number. The NOTE below is a
          different fact somebody typed and is kept either way. The kitchen
          leads, as FileMaker's "*** KITCHEN: DF01 ***" did: it is the first
          thing a baker checks. */}
      <SheetHeading
        kicker={`Kitchen ${schedule.kitchenCode}`}
        title={heading}
        caption={subtitle}
        date={schedule.date}
      >
        {schedule.note ? <Text style={styles.blurb}>{schedule.note}</Text> : null}
      </SheetHeading>

      {rolled.length === 0 ? (
        <Text style={styles.emptyNote}>Nothing on this schedule.</Text>
      ) : (
        <>
          {rolled.map((type) => <PremadeType key={type.itemType} type={type} />)}
          {/* THE NIGHT'S GRAND TOTAL (Mark, 2026-09-19), the schedule
              record's closing row on paper. */}
          <View style={styles.nightTotal} wrap={false}>
            <CountTotalRow
              label="NIGHT TOTAL"
              lines={schedule.lines}
              textStyle={styles.grandTotalText}
            />
          </View>
        </>
      )}
      </View>

      <PacketFooter>
        {[
          `${heading}`,
          `Generated${schedule.generatedAt ? ` ${schedule.generatedAt.slice(0, 10)}` : ""}${
            schedule.generatedByName ? ` by ${schedule.generatedByName}` : ""
          }`,
        ].join(" · ")}
      </PacketFooter>
    </Page>
  );
}

function PremadeType({ type }: { type: RollType }) {
  return (
    <View>
      <View style={styles.typeBand}>
        <Text style={styles.typeBandText}>{(type.itemType || "(no type)").toUpperCase()}</Text>
        <Text style={styles.typeBandTotal}>{fmt(type.total)}</Text>
        <View style={styles.typeBandRight}>
          <Text style={styles.bandLabel}>Total</Text>
          <Text style={styles.bandLabel}>L/O</Text>
        </View>
      </View>

      {type.sizes.map((size) => (
        <View key={size.size}>
          <View style={styles.sizeBand}>
            <Text style={styles.sizeBandText}>{(size.size || "(no size)").toUpperCase()} SIZE</Text>
            <Text style={styles.sizeBandTotal}>{fmt(size.total)}</Text>
          </View>

          {size.subtypes.map((sub) => (
            <View key={`${size.size}|${sub.subtype}`}>
              {sub.rows.map((row) => {
                const line = row.lines[0];
                return <PremadeRow key={row.key} line={line} />;
              })}
              <View style={styles.subtotal}>
                <CountTotalRow
                  label={`${(sub.subtype || "(no cut)").toUpperCase()} TOTAL`}
                  lines={subtypeLines(sub)}
                  textStyle={styles.subtotalText}
                />
              </View>
            </View>
          ))}

          <View style={styles.subtotal}>
            <CountTotalRow
              label={`${(size.size || "").toUpperCase()} ${(type.itemType || "").toUpperCase()} TOTAL`}
              lines={sizeLines(size)}
              textStyle={styles.subtotalText}
            />
          </View>
        </View>
      ))}

      <View style={styles.grandTotal}>
        <CountTotalRow
          label={`${(type.itemType || "(no type)").toUpperCase()} TOTAL`}
          lines={type.sizes.flatMap(sizeLines)}
          textStyle={styles.grandTotalText}
        />
      </View>
    </View>
  );
}

const subtypeLines = (sub: RollSubtype) => sub.rows.flatMap((r) => r.lines);
const sizeLines = (size: RollSize) => size.subtypes.flatMap(subtypeLines);

/**
 * A premade total line: the par in words as it always printed, and — once the
 * night is counted — MADE and L/O under the two write-in boxes they sum, with
 * SOLD after the par since the sheet has no column for it. The same sums as the
 * schedule record's (`countTotals`); a count no line has prints nothing, so a
 * packet printed before the night looks exactly as it did.
 */
function CountTotalRow({
  label,
  lines,
  textStyle,
}: {
  label: string;
  lines: ScheduleLine[];
  textStyle: (typeof styles)[keyof typeof styles];
}) {
  const t = countTotals(lines);
  return (
    <>
      <Text style={[textStyle, { flexGrow: 1 }]}>
        {label}: {fmt(t.par)}
        {t.sold !== null ? `    SOLD: ${fmt(t.sold)}` : ""}
      </Text>
      <Text style={[textStyle, styles.countCell]}>{t.made !== null ? fmt(t.made) : ""}</Text>
      <Text style={[textStyle, styles.countCell]}>{t.leftover !== null ? fmt(t.leftover) : ""}</Text>
    </>
  );
}

function PremadeRow({ line }: { line: ScheduleLine }) {
  // Measured on the real packet: 24 boxes whatever the par, and the first
  // FLOOR(par / box size) of them carry the number.
  const { boxes, filled } = tallyBoxes(line.par, line.tally_box_size);
  const cells = Array.from({ length: boxes }, (_, i) => i < filled);
  const sub = [line.subtype, line.finish].filter(Boolean).join(" - ");
  return (
    <View style={styles.row} wrap={false}>
      <View style={styles.rowLabel}>
        <Text style={styles.rowName}>{line.item_name}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={styles.rowPar}>[{fmt(line.par)}]</Text>
      <View style={styles.strip}>
        {cells.map((on, i) => (
          <View key={i} style={on ? [styles.box, styles.boxOn] : styles.box}>
            <Text style={on ? styles.boxText : styles.boxTextOff}>{line.tally_box_size}</Text>
          </View>
        ))}
      </View>
      <View style={styles.writeIn} />
      <View style={styles.writeIn} />
    </View>
  );
}

/* -- the three tray guides: ONE renderer at three grains --------------------- */

const GUIDE_TITLE: Record<Grain, string> = {
  subtype: "BAKER TRAY GUIDE",
  finish: "FRYER TRAY GUIDE",
  item: "DECORATING TRAY GUIDE",
};

const GUIDE_BLURB: Record<Grain, string> = {
  subtype: "This guide shows the TOTAL number of each type of donut to cut today, including special orders",
  finish: "This guide shows the TOTAL number of donuts to prepare for decorating, including special orders",
  item: "This guide shows the TOTAL number of donuts of each kind to decorate today, including special orders",
};

function TrayGuidePage({
  kitchen,
  packet,
  grain,
}: {
  kitchen: PacketKitchen;
  packet: PacketData;
  grain: Grain;
}) {
  const rolled = rollUp(kitchen.lines, grain);
  const total = totalDonuts(kitchen.lines);
  return (
    <Page size="LETTER" style={styles.page} wrap>
      <PacketMasthead packet={packet} guide />
      <View style={styles.guideBody}>
      {/* FileMaker's header, in the app's type: the guide's name with its one
          sentence under it, the night and the night's total at the right. The
          shops beside the total are the thing FileMaker could not say: this
          kitchen is filling more than one shop's case tonight. */}
      <View style={styles.headingRow}>
        <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
          <Text style={styles.kicker}>Kitchen {kitchen.kitchenCode}</Text>
          <Text style={styles.guideTitle}>{GUIDE_TITLE[grain]}</Text>
          <Text style={styles.guideBlurb}>{GUIDE_BLURB[grain]}</Text>
        </View>
        <View style={styles.numberBlock}>
          <Text style={styles.kicker}>Night</Text>
          <Text style={styles.guideDate}>{isoDay(kitchen.date) || kitchen.date}</Text>
          <Text style={styles.guideTotal}>
            {[
              kitchen.shopCodes.length > 1 ? `For ${kitchen.shopCodes.join(", ")}` : null,
              `${fmt(total)} total donuts`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>

      {rolled.length === 0 ? (
        <Text style={styles.emptyNote}>Nothing to make in this kitchen tonight.</Text>
      ) : (
        rolled.map((type) => (
          <View key={type.itemType}>
            {type.sizes.map((size, sizeIndex) => (
              <View key={size.size}>
                {size.subtypes.map((sub, subIndex) => {
                  const cut = (sub.subtype || "(no cut)").toUpperCase();
                  const sizeName = (size.size || "(no size)").toUpperCase();
                  return (
                    <View key={`${size.size}|${sub.subtype}`}>
                      {sub.rows.map((row, rowIndex) => {
                        // The baker's row IS the cut, so it is headed by the cut
                        // and its size, as FileMaker heads it. The fryer's and
                        // decorator's rows are a finish or a donut WITHIN a cut,
                        // so the cut joins the size in the brackets.
                        const name = grain === "subtype" ? cut : (row.label || "—").toUpperCase();
                        const of = grain === "subtype" || !sub.subtype ? sizeName : `${cut} - ${sizeName}`;
                        const first = subIndex === 0 && rowIndex === 0;
                        return (
                          // The bands travel WITH the first row beneath them, so
                          // a band is never the last thing on a page.
                          <View key={row.key} wrap={false}>
                            {first && sizeIndex === 0 ? (
                              <View style={styles.guideTypeBand}>
                                <Text style={styles.guideTypeText}>
                                  {(type.itemType || "(no type)").toUpperCase()}
                                </Text>
                              </View>
                            ) : null}
                            {first ? (
                              <View style={styles.guideSizeBand}>
                                <Text style={styles.guideSizeText}>{sizeName}</Text>
                              </View>
                            ) : null}
                            <View style={styles.guideHead}>
                              <Text style={styles.guideName}>{name}</Text>
                              <Text style={styles.guideOf}>({of})</Text>
                            </View>
                            <TrayRuler total={row.total} capacity={row.trayCapacity} />
                            <View style={styles.guideSubtotal}>
                              <Text style={styles.guideSubtotalText}>
                                {name} TOTAL: {fmt(row.total)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}

                      {/* The cut's own total, where a cut has several rows. With
                          one row — always, on the baker's guide — the line
                          above already says it. */}
                      {sub.rows.length > 1 ? (
                        <View style={styles.guideCutTotal}>
                          <Text style={styles.guideCutTotalText}>
                            {cut} ({sizeName}) TOTAL: {fmt(sub.total)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}

            <View style={styles.guideTypeTotal}>
              <Text style={styles.guideTypeTotalText}>
                {(type.itemType || "(no type)").toUpperCase()} TOTAL: {fmt(type.total)}
              </Text>
            </View>
          </View>
        ))
      )}

      {/* TOTAL BATCHES (Mark, 2026-09-30) — the baker's guide only. The bakers
          write how much of each donut they made; the opening or mid
          supervisor copies it into the shift report's Donut batches page (the
          batch's Made fields),
          which asks for exactly this list (`batchDonuts`). Kept whole on one
          page, so the box is never split from its heading. */}
      {grain === "subtype" && kitchen.batchDonuts.length > 0 ? (
        <View wrap={false}>
          {/* The two labels sit over their boxes: the band has no right
              padding, so a fixed-width label lines up with the box beneath. */}
          <View style={styles.typeBand}>
            <Text style={[styles.typeBandText, { flexGrow: 1 }]}>TOTAL BATCHES</Text>
            <Text style={[styles.typeBandText, styles.batchWriteInLabel]}>MADE</Text>
            <Text style={[styles.typeBandText, styles.preparedByLabel]}>PREPARED BY</Text>
          </View>
          {kitchen.batchDonuts.map((name) => (
            <View key={name} style={styles.sheetRow}>
              <Text style={[styles.cell, { flexGrow: 1 }]}>{name}</Text>
              <View style={styles.batchWriteIn} />
              {/* Who made it (Mark, 2026-09-30) — the shift report's Prepared
                  by picker is copied from here. */}
              <View style={styles.preparedByWriteIn} />
            </View>
          ))}
        </View>
      ) : null}
      </View>

      <PacketFooter guide>{`${GUIDE_TITLE[grain]} · Kitchen ${kitchen.kitchenCode}`}</PacketFooter>
    </Page>
  );
}

function TrayRuler({ total, capacity }: { total: number; capacity: number }) {
  const trays = trayRuler(total, capacity);
  return (
    <View style={styles.guideRuler}>
      {Array.from({ length: TRAY_CELLS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.trayCell,
            i < trays.length ? styles.trayOn : {},
            // The frame is the first cell's left edge.
            i === 0 ? { borderLeftWidth: 0 } : {},
          ]}
        >
          <Text style={styles.trayIndex}>{i + 1}</Text>
          <Text style={styles.trayCount}>{i < trays.length ? fmt(trays[i]) : " "}</Text>
        </View>
      ))}
    </View>
  );
}

/* -- the element sheets ------------------------------------------------------ */

function DonutSheetPage({ kitchen, packet }: { kitchen: PacketKitchen; packet: PacketData }) {
  // Dough only: an element the night needs BATCHES of. The components come out
  // of the same roll-up but belong on the AB and weekly rhythms, which have
  // their own pars.
  const dough = kitchen.demand.filter((d) => d.batches !== null);
  return (
    <Page size="LETTER" style={styles.page} wrap>
      <PacketMasthead packet={packet} />
      <View style={styles.body}>
      <SheetHeader
        title="DONUT ELEMENT SHEET"
        kitchen={kitchen}
        blurb="Dough to make tonight, derived from every schedule this kitchen is filling"
      />

      {dough.length === 0 ? (
        <Text style={styles.emptyNote}>
          Nothing made resolved for tonight. An element whose recipe does not
          say how much a batch yields contributes
          nothing and is listed below rather than counted as zero.
        </Text>
      ) : (
        <>
          <View style={[styles.tableHead, { marginTop: 16 }]}>
            <Text style={[styles.th, styles.colElement]}>Element</Text>
            <Text style={[styles.th, styles.colAmount]}>Batches</Text>
            <Text style={[styles.th, styles.colMade]}>Made</Text>
          </View>
          {dough.map((d) => (
            <View key={d.elementId} style={styles.sheetRow} wrap={false}>
              <View style={styles.colElement}>
                <Text style={styles.cell}>{d.name}</Text>
                {d.unresolved.length ? (
                  <Text style={styles.cellMuted}>
                    AT LEAST — {d.unresolved.length} item
                    {d.unresolved.length === 1 ? "" : "s"} state no amount
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.cell, styles.colAmount]}>{(d.batches ?? 0).toFixed(2)}</Text>
              <View style={styles.colMade}>
                <View style={styles.writeIn} />
              </View>
            </View>
          ))}
        </>
      )}

      {kitchen.demand.some((d) => d.quantity !== null) ? (
        <>
          <Text style={styles.sheetHeadLabel}>Components</Text>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colElement]}>Element</Text>
            <Text style={[styles.th, styles.colAmount]}>Needed</Text>
            <Text style={[styles.th, styles.colMade]}>Made</Text>
          </View>
          {kitchen.demand
            .filter((d) => d.quantity !== null)
            .map((d) => (
              <View key={`c-${d.elementId}`} style={styles.sheetRow} wrap={false}>
                <Text style={[styles.cell, styles.colElement]}>{d.name}</Text>
                <Text style={[styles.cell, styles.colAmount]}>
                  {trimNum(d.quantity ?? 0)} {d.unit ?? ""}
                </Text>
                <View style={styles.colMade}>
                  <View style={styles.writeIn} />
                </View>
              </View>
            ))}
        </>
      ) : null}
      </View>

      <PacketFooter>{`Donut element sheet · Kitchen ${kitchen.kitchenCode}`}</PacketFooter>
    </Page>
  );
}

/** The AB sheet beside it went with AB itself (Mark, 2026-09-30). */
function WeeklySheetPage({ kitchen, packet }: { kitchen: PacketKitchen; packet: PacketData }) {
  const rows: SheetElement[] = kitchen.weekly;
  return (
    <Page size="LETTER" style={styles.page} wrap>
      <PacketMasthead packet={packet} />
      <View style={styles.body}>
      <SheetHeader
        title="WEEKLY ELEMENT SHEET"
        kitchen={kitchen}
        blurb="The standing rhythm for this kitchen and this day — stock up to par"
      />

      {rows.length === 0 ? (
        <Text style={styles.emptyNote}>
          Nothing on the weekly rhythm for {kitchen.kitchenCode} on{" "}
          {packetDate(kitchen.date)}.
        </Text>
      ) : (
        <>
          <View style={[styles.tableHead, { marginTop: 16 }]}>
            <Text style={[styles.th, styles.colElement]}>Element</Text>
            <Text style={[styles.th, styles.colShift]}>Shift</Text>
            <Text style={[styles.th, styles.colAmount]}>Batch</Text>
            <Text style={[styles.th, styles.colStock]}>Par</Text>
            <Text style={[styles.th, styles.colMade]}>Made</Text>
          </View>
          {rows.map((e) => (
            <View key={e.id} style={styles.sheetRow} wrap={false}>
              <View style={styles.colElement}>
                <Text style={styles.cell}>
                  {e.name}
                  {e.batchLabel ? ` — ${e.batchLabel}` : ""}
                </Text>
                {e.note ? <Text style={styles.cellMuted}>{e.note}</Text> : null}
              </View>
              <Text style={[styles.cellMuted, styles.colShift]}>{e.shift ?? ""}</Text>
              <Text style={[styles.cell, styles.colAmount]}>
                {e.amount !== null ? `${trimNum(e.amount)} ${e.unit ?? ""}` : ""}
              </Text>
              <Text style={[styles.cellMuted, styles.colStock]}>{e.stock ?? ""}</Text>
              <View style={styles.colMade}>
                <View style={styles.writeIn} />
              </View>
            </View>
          ))}
        </>
      )}
      </View>

      <PacketFooter>{`Weekly element sheet · Kitchen ${kitchen.kitchenCode}`}</PacketFooter>
    </Page>
  );
}

function SheetHeader({
  title,
  kitchen,
  blurb,
}: {
  title: string;
  kitchen: PacketKitchen;
  blurb: string;
}) {
  return (
    <SheetHeading
      kicker={`Kitchen ${kitchen.kitchenCode}`}
      title={title}
      caption={kitchen.shopCodes.length > 1 ? `For ${kitchen.shopCodes.join(", ")}` : null}
      date={kitchen.date}
    >
      <Text style={styles.blurb}>{blurb}</Text>
    </SheetHeading>
  );
}

/* -------------------------------------------------------------------------- */

/** Whole donuts read as whole numbers; a fractional par keeps two places. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Precision falls as the quantity grows — no kitchen scale shows "30.625 g".
 *  The lesson the recipe sheet learned in print. */
function trimNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
