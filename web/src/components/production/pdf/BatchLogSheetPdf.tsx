// The batch log as a write-in sheet — Preview Batch Log… (Mark, 2026-11-09).
// Import this module DYNAMICALLY from a click handler — the renderer is heavy
// and nothing on a normal page load needs it.
//
// Drawn from the shared `components/pdf/appDocument` parts, like every printed
// document: the black masthead band, the kitchen over BATCH LOG with the log's
// date where a record's number sits, a black band per element type, and the
// app's 1px box wherever somebody writes. Each row is the batch and its par,
// then an On hand box and a Made box — the two figures the shift produces and
// later types into the log's pane.
//
// The order and banding are `lib/batchLogSheet`'s, which are the screen's
// defaults; see there.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  DocFooter,
  HAIRLINE,
  INK,
  MUTED,
  docStyles,
  isoDay,
} from "@/components/pdf/appDocument";
import {
  batchSheetName,
  batchSheetPar,
  type BatchSheetData,
} from "@/lib/batchLogSheet";

/** A write-in box: room for "4 × 3 gal" in a baker's hand. */
const BOX_W = 92;
const BOX_H = 20;
const BOX_GAP = 10;
const PAR_W = 86;

const styles = {
  ...docStyles,
  ...StyleSheet.create({
    logDate: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 3 },
    noteLine: { fontSize: 8.5, color: MUTED, marginTop: 6, lineHeight: 1.35 },

    head: { ...docStyles.tableHead, marginTop: 18, alignItems: "flex-end" },
    colName: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
    colPar: { width: PAR_W, textAlign: "right", paddingRight: 10 },
    colBox: { width: BOX_W, marginLeft: BOX_GAP },
    thBox: { width: BOX_W, marginLeft: BOX_GAP, paddingLeft: 3 },

    band: { ...docStyles.groupBand, marginTop: 10 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: HAIRLINE,
    },
    name: { fontSize: 9 },
    par: { fontSize: 9, fontFamily: "Helvetica-Bold" },
    box: { width: BOX_W, height: BOX_H, borderWidth: 1, borderColor: INK, marginLeft: BOX_GAP },

    empty: { fontSize: 9, color: MUTED, marginTop: 14 },
  }),
};

export function BatchLogSheetPdf({ data }: { data: BatchSheetData }) {
  const count = data.groups.reduce((n, g) => n + g.lines.length, 0);
  const caption = [data.schedule ? `${data.schedule} schedule` : null, `${count} ${count === 1 ? "batch" : "batches"}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <Document title={`Batch log ${data.kitchenCode} ${data.logDate}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.masthead} fixed>
          <Text style={styles.wordmark}>{data.orgName}</Text>
          <View style={styles.mastheadRight}>
            <Text style={styles.mastheadLine}>Batch log</Text>
            <Text style={styles.mastheadLine}>Printed {data.printedOn}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.headingRow}>
            <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
              <Text style={styles.kicker}>Kitchen {data.kitchenCode}</Text>
              <Text style={styles.h1}>Batch log</Text>
              <Text style={styles.caption}>{caption}</Text>
              {data.note ? <Text style={styles.noteLine}>{data.note}</Text> : null}
            </View>
            <View style={styles.numberBlock}>
              <Text style={styles.kicker}>Log</Text>
              <Text style={styles.logDate}>{isoDay(data.logDate) || data.logDate}</Text>
            </View>
          </View>

          {count === 0 ? (
            <Text style={styles.empty}>Nothing on this log yet.</Text>
          ) : (
            <>
              <View style={styles.head}>
                <Text style={[styles.th, styles.colName]}>Element</Text>
                <Text style={[styles.th, styles.colPar]}>Par</Text>
                <Text style={[styles.th, styles.thBox]}>On hand</Text>
                <Text style={[styles.th, styles.thBox]}>Made</Text>
              </View>

              {data.groups.map((g) => (
                <View key={g.type}>
                  {/* The band rides with its first row, so a page never ends
                      on a heading with nothing under it. */}
                  {g.lines.map((line, i) => (
                    <View key={line.id} wrap={false}>
                      {i === 0 ? <Text style={styles.band}>{g.type}</Text> : null}
                      <View style={styles.row}>
                        <Text style={[styles.name, styles.colName]}>{batchSheetName(line)}</Text>
                        <Text style={[styles.par, styles.colPar]}>{batchSheetPar(line)}</Text>
                        <View style={styles.box} />
                        <View style={styles.box} />
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </>
          )}
        </View>

        <DocFooter>{`Batch log · ${data.kitchenCode} · ${data.logDate}`}</DocFooter>
      </Page>
    </Document>
  );
}
