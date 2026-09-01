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
// Two rules inherited from the sheets already in this folder:
//   * the same four sizes and two greys, because a kitchen sheet is read at
//     arm's length, on a shelf, in a hurry;
//   * NO `≥` GLYPH. @react-pdf's built-in Helvetica is WinAnsi-encoded and
//     renders it as a stray "e" — which does not merely lose the claim, it
//     replaces it with a typo. Lower bounds are spelled "AT LEAST" in words.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  rollUp,
  tallyBoxes,
  trayRuler,
  packetDate,
  totalDonuts,
  TRAY_CELLS,
  type Grain,
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
  | "ab"
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
// The three RENDERERS are deliberately left in place — `DonutSheetPage` and
// `RhythmSheetPage` are still reached through `parts`, and `PacketPart` still
// names all seven. They are what `_production.mer` was read for, and putting a
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

const INK = "#111";
const MUTED = "#666";
const FAINT = "#aaa";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: INK },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  // marginLeft, not leading spaces in the Text: @react-pdf collapses those.
  titleAside: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 4, marginLeft: 8 },
  subtitle: { fontSize: 8, color: MUTED, marginTop: 2 },
  dateBig: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
  dateAside: { fontSize: 8, color: MUTED, textAlign: "right", marginTop: 2 },

  // A black band DELIMITS — the app's own rule for a group heading.
  typeBand: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: INK,
    color: "#fff",
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 10,
  },
  typeBandText: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#fff" },
  typeBandTotal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#fff", marginLeft: 10 },
  typeBandRight: { marginLeft: "auto", flexDirection: "row" },
  bandLabel: { fontSize: 8, color: "#fff", width: 34, textAlign: "center" },

  sizeBand: {
    flexDirection: "row",
    backgroundColor: "#eee",
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  sizeBandText: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  sizeBandTotal: { fontSize: 9, fontFamily: "Helvetica-Bold", marginLeft: 10 },

  subtypeHead: { flexDirection: "row", alignItems: "baseline", marginTop: 6 },
  subtypeName: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textDecoration: "underline",
  },
  subtypeSize: { fontSize: 7, color: MUTED, marginLeft: 4 },

  row: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  rowLabel: { width: 118, paddingRight: 4 },
  rowName: { fontSize: 8 },
  rowSub: { fontSize: 6, color: FAINT },
  rowPar: { width: 26, fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 6 },
  rowCount: { width: 26, fontSize: 8, textAlign: "right", paddingRight: 6 },

  strip: { flexDirection: "row", borderWidth: 1, borderColor: INK, flexGrow: 1 },
  box: {
    flexGrow: 1,
    flexBasis: 0,
    borderRightWidth: 0.5,
    borderRightColor: "#ddd",
    paddingVertical: 3,
    alignItems: "center",
  },
  boxOn: { backgroundColor: "#fdf6e3" },
  boxText: { fontSize: 7, color: "#d08a00" },
  boxTextOff: { fontSize: 7, color: "#e8e8e8" },

  writeIn: { width: 34, height: 14, borderWidth: 1, borderColor: INK, marginLeft: 4 },

  // The tray ruler: a cell per tray NUMBER, the count written inside the ones
  // the run fills. NOT the counting strip — answered question 3 says so.
  trayCell: {
    flexGrow: 1,
    flexBasis: 0,
    borderRightWidth: 0.5,
    borderRightColor: "#ccc",
    minHeight: 18,
  },
  trayIndex: { fontSize: 5, color: FAINT, paddingLeft: 1 },
  trayCount: { fontSize: 7, textAlign: "center" },
  trayOn: { backgroundColor: "#eef6ea" },

  subtotal: { flexDirection: "row", marginTop: 3, marginLeft: 118 },
  subtotalText: { fontSize: 7, color: MUTED },
  subtotalBatch: { fontSize: 7, color: MUTED, marginLeft: 24 },
  grandTotal: { flexDirection: "row", marginTop: 5, marginLeft: 118 },
  grandTotalText: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  grandBatch: { fontSize: 9, fontFamily: "Helvetica-Bold", marginLeft: 24 },

  sheetHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 3,
    marginTop: 8,
  },
  sheetHeadCell: { fontSize: 7, fontFamily: "Helvetica-Bold" },
  sheetRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#eee" },
  colElement: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
  colAmount: { width: 70, textAlign: "right", paddingRight: 8 },
  colShift: { width: 56 },
  colStock: { width: 70 },
  colMade: { width: 60 },
  cell: { fontSize: 8 },
  cellMuted: { fontSize: 7, color: MUTED },

  empty: { fontSize: 8, color: MUTED, marginTop: 10 },

  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: MUTED,
  },
});

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
        ? kitchenOrderPages(orders, packet.printedOn)
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
          {want.has("ab") ? <RhythmSheetPage kitchen={k} packet={packet} kind="ab" /> : null}
          {want.has("weekly") ? <RhythmSheetPage kitchen={k} packet={packet} kind="weekly" /> : null}
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
      <View style={styles.headerRow}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.titleAside}>*** KITCHEN: {schedule.kitchenCode} ***</Text>
          </View>
          {/* The order's own name, under the order's number. The NOTE below is
              a different fact somebody typed and is kept either way. */}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {schedule.note ? <Text style={styles.subtitle}>{schedule.note}</Text> : null}
        </View>
        <Text style={styles.dateBig}>{packetDate(schedule.date)}</Text>
      </View>

      {rolled.length === 0 ? (
        <Text style={styles.empty}>Nothing on this schedule.</Text>
      ) : (
        rolled.map((type) => <PremadeType key={type.itemType} type={type} />)
      )}

      <View style={styles.footer} fixed>
        <Text>
          generated{schedule.generatedAt ? ` on ${schedule.generatedAt.slice(0, 10)}` : ""}
          {schedule.generatedByName ? ` by ${schedule.generatedByName}` : ""}
        </Text>
        <Text>printed on {packet.printedOn}</Text>
      </View>
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
          <Text style={styles.bandLabel}>total</Text>
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
                <Text style={styles.subtotalText}>
                  {(sub.subtype || "(no cut)").toUpperCase()} TOTAL: {fmt(sub.total)}
                </Text>
              </View>
            </View>
          ))}

          <View style={styles.subtotal}>
            <Text style={styles.subtotalText}>
              {(size.size || "").toUpperCase()} {(type.itemType || "").toUpperCase()} TOTAL:{" "}
              {fmt(size.total)}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.grandTotal}>
        <Text style={styles.grandTotalText}>
          {(type.itemType || "(no type)").toUpperCase()} TOTAL: {fmt(type.total)}
        </Text>
      </View>
    </View>
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
      <View style={styles.headerRow}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.title}>{GUIDE_TITLE[grain]}</Text>
            <Text style={styles.titleAside}>({kitchen.kitchenCode})</Text>
          </View>
          <Text style={styles.subtitle}>{GUIDE_BLURB[grain]}</Text>
          {kitchen.shopCodes.length > 1 ? (
            // The thing FileMaker could not say: this kitchen is filling more
            // than one shop's case tonight.
            <Text style={styles.subtitle}>for {kitchen.shopCodes.join(", ")}</Text>
          ) : null}
        </View>
        <View>
          <Text style={styles.dateBig}>{packetDate(kitchen.date)}</Text>
          <Text style={styles.dateAside}>{fmt(total)} total donuts</Text>
        </View>
      </View>

      {rolled.length === 0 ? (
        <Text style={styles.empty}>Nothing to make in this kitchen tonight.</Text>
      ) : (
        rolled.map((type) => (
          <View key={type.itemType}>
            <View style={styles.typeBand}>
              <Text style={styles.typeBandText}>{(type.itemType || "(no type)").toUpperCase()}</Text>
              <Text style={styles.typeBandTotal}>{fmt(type.total)}</Text>
            </View>

            {type.sizes.map((size) => (
              <View key={size.size}>
                <View style={styles.sizeBand}>
                  <Text style={styles.sizeBandText}>{(size.size || "(no size)").toUpperCase()}</Text>
                  <Text style={styles.sizeBandTotal}>{fmt(size.total)}</Text>
                </View>

                {size.subtypes.map((sub) => (
                  <View key={`${size.size}|${sub.subtype}`}>
                    <View style={styles.subtypeHead}>
                      <Text style={styles.subtypeName}>
                        {(sub.subtype || "(no cut)").toUpperCase()}
                      </Text>
                      <Text style={styles.subtypeSize}>({(size.size || "—").toUpperCase()})</Text>
                    </View>

                    {sub.rows.map((row) => (
                      <View key={row.key} style={styles.row} wrap={false}>
                        <View style={styles.rowLabel}>
                          <Text style={styles.rowName}>{row.label || "—"}</Text>
                        </View>
                        <Text style={styles.rowCount}>{fmt(row.total)}</Text>
                        <TrayRuler total={row.total} capacity={row.trayCapacity} />
                      </View>
                    ))}

                    <View style={styles.subtotal}>
                      <Text style={styles.subtotalText}>
                        {(sub.subtype || "(no cut)").toUpperCase()} TOTAL: {fmt(sub.total)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}

            <View style={styles.grandTotal}>
              <Text style={styles.grandTotalText}>
                {(type.itemType || "(no type)").toUpperCase()} TOTAL: {fmt(type.total)}
              </Text>
            </View>
          </View>
        ))
      )}

      <View style={styles.footer} fixed>
        <Text>{packet.orgName}</Text>
        <Text>printed on {packet.printedOn}</Text>
      </View>
    </Page>
  );
}

function TrayRuler({ total, capacity }: { total: number; capacity: number }) {
  const trays = trayRuler(total, capacity);
  return (
    <View style={styles.strip}>
      {Array.from({ length: TRAY_CELLS }, (_, i) => (
        <View key={i} style={i < trays.length ? [styles.trayCell, styles.trayOn] : styles.trayCell}>
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
      <SheetHeader
        title="DONUT ELEMENT SHEET"
        kitchen={kitchen}
        blurb="Dough to make tonight, derived from every schedule this kitchen is filling"
      />

      {dough.length === 0 ? (
        <Text style={styles.empty}>
          Nothing made resolved for tonight. An element whose recipe does not
          say how much a batch yields contributes
          nothing and is listed below rather than counted as zero.
        </Text>
      ) : (
        <>
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetHeadCell, styles.colElement]}>Element</Text>
            <Text style={[styles.sheetHeadCell, styles.colAmount]}>Batches</Text>
            <Text style={[styles.sheetHeadCell, styles.colMade]}>Made</Text>
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
          <Text style={[styles.sheetHeadCell, { marginTop: 14 }]}>COMPONENTS</Text>
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetHeadCell, styles.colElement]}>Element</Text>
            <Text style={[styles.sheetHeadCell, styles.colAmount]}>Needed</Text>
            <Text style={[styles.sheetHeadCell, styles.colMade]}>Made</Text>
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

      <View style={styles.footer} fixed>
        <Text>{packet.orgName}</Text>
        <Text>printed on {packet.printedOn}</Text>
      </View>
    </Page>
  );
}

function RhythmSheetPage({
  kitchen,
  packet,
  kind,
}: {
  kitchen: PacketKitchen;
  packet: PacketData;
  kind: "ab" | "weekly";
}) {
  const rows: SheetElement[] = kind === "ab" ? kitchen.ab : kitchen.weekly;
  return (
    <Page size="LETTER" style={styles.page} wrap>
      <SheetHeader
        title={kind === "ab" ? "AB ELEMENT SHEET" : "WEEKLY ELEMENT SHEET"}
        kitchen={kitchen}
        blurb="The standing rhythm for this kitchen and this day — stock up to par"
      />

      {rows.length === 0 ? (
        <Text style={styles.empty}>
          Nothing on the {kind === "ab" ? "AB" : "weekly"} rhythm for {kitchen.kitchenCode} on{" "}
          {packetDate(kitchen.date)}.
        </Text>
      ) : (
        <>
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetHeadCell, styles.colElement]}>Element</Text>
            <Text style={[styles.sheetHeadCell, styles.colShift]}>Shift</Text>
            <Text style={[styles.sheetHeadCell, styles.colAmount]}>Batch</Text>
            <Text style={[styles.sheetHeadCell, styles.colStock]}>Par</Text>
            <Text style={[styles.sheetHeadCell, styles.colMade]}>Made</Text>
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

      <View style={styles.footer} fixed>
        <Text>{packet.orgName}</Text>
        <Text>printed on {packet.printedOn}</Text>
      </View>
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
    <View style={styles.headerRow}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.titleAside}>  ({kitchen.kitchenCode})</Text>
        </View>
        <Text style={styles.subtitle}>{blurb}</Text>
        {kitchen.shopCodes.length > 1 ? (
          <Text style={styles.subtitle}>for {kitchen.shopCodes.join(", ")}</Text>
        ) : null}
      </View>
      <Text style={styles.dateBig}>{packetDate(kitchen.date)}</Text>
    </View>
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
