// The completed checklist as paper — rendered client-side with
// @react-pdf/renderer. Import this module DYNAMICALLY (await import(...)) from
// a click handler: the renderer is heavy and nothing on a normal page load
// needs it. (`PoPdfDocs`' idiom, and its reasons.)
//
// WHY IT EXISTS: the record screen is what the shop reads and the email is what
// management reads, and neither of those is what a health inspector asks for.
// They ask for the paper — who checked what, on which day, and what was found.
//
// ISSUES LEAD, deliberately. A run's own order is the walk's, which is right on
// screen because you are following it; on a document being read AFTERWARDS the
// question is what went wrong, and burying three findings among seventy ticks
// makes a reader hunt for them.

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * NO HYPHENATION, ANYWHERE.
 *
 * @react-pdf hyphenates by default — on a narrow column that once broke a real
 * customer's address into `alexlan-dayan@gmail.com`. Nothing here is justified
 * prose, so hyphenation buys nothing.
 *
 * REGISTERED AT MODULE SCOPE OF THIS FILE, even though `SpecialOrderPdfs` does
 * the same: the callback is global to the renderer, but whether that module has
 * been loaded depends on what the reader clicked earlier. `PoPdfDocs` does NOT
 * register it, so there is no module a new one can rely on having run.
 */
Font.registerHyphenationCallback((word) => [word]);

/**
 * TYPOGRAPHY THAT @react-pdf's BUILT-IN HELVETICA SILENTLY DROPS.
 *
 * The bundled Helvetica is WinAnsi-encoded, and characters it cannot place are
 * emitted as NOTHING — not as a box, not as a question mark. On this document
 * that is not cosmetic: `expected 34–40 °F` printed as **"expected 3440 °F"**,
 * which does not lose the range, it replaces it with a different number, on the
 * page somebody hands a health inspector. Caught by inflating the content
 * stream of a real render; invisible in review and to the type checker.
 *
 * The same trap cost the recipe sheet its `≥` once already (it printed a stray
 * "e"), so this is the second time. ASCII on the page, proper typography
 * everywhere else — `readingLabel` is shared with the screen and the email and
 * must keep its en dash, so the substitution belongs HERE and not at the source.
 */
const PDF_SAFE: [RegExp, string][] = [
  [/[\u2013\u2014]/g, "-"], // en and em dash
  [/[\u2018\u2019]/g, "'"],
  [/[\u201c\u201d]/g, '"'],
  [/\u2026/g, "..."],
  [/\u2265/g, ">="],
  [/\u2264/g, "<="],
  [/\u00d7/g, "x"],
  [/\u00b7/g, "-"], // middle dot
];

function pdfText(raw: string): string {
  let out = raw;
  for (const [from, to] of PDF_SAFE) out = out.replace(from, to);
  return out;
}

export type ChecklistPdfItem = {
  status: "pending" | "done" | "issue" | "na";
  prompt: string;
  sectionName: string | null;
  guidance: string | null;
  position: string | null;
  equipmentName: string | null;
  note: string | null;
  valueText: string | null;
  valueNumber: number | null;
  unit: string | null;
  expected: string | null;
  score: number | null;
};

export type ChecklistPdfData = {
  orgName: string;
  kindLabel: string;
  title: string;
  locationCode: string;
  businessDate: string;
  shiftLabel: string | null;
  status: "open" | "submitted";
  walkedBy: string | null;
  submittedAt: string | null;
  printedOn: string;
  items: ChecklistPdfItem[];
};

/**
 * Sizes, and nothing else — `PoPdf`'s rule, four sizes and two greys.
 *
 *   22  Helvetica-Bold   the org name
 *   11  Helvetica-Bold   the document's own name and the section bands
 *    9  Helvetica[-Bold] everything you read
 *    8  Helvetica        secondary: guidance, whose job it is, the footer
 *
 *   #000 ink · #666 secondary · #ffe98a the mark, on a finding and nothing else
 */
const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 34,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#000",
  },
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  orgName: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.5 },
  docTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docMeta: { fontSize: 8, color: "#666", textAlign: "right", marginTop: 2 },

  rule: { borderBottomWidth: 1, borderBottomColor: "#000", marginTop: 10 },

  metaRow: { flexDirection: "row", marginTop: 10, gap: 24 },
  metaLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#666",
  },
  metaValue: { fontSize: 9, marginTop: 1 },

  band: {
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 16,
  },
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 4,
    borderBottomWidth: 0.75,
    borderBottomColor: "#000",
    paddingBottom: 2,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 3.5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  cellStatus: { width: 46, fontSize: 8, fontFamily: "Helvetica-Bold" },
  cellPrompt: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  cellAnswer: { width: 130 },
  sub: { fontSize: 8, color: "#666", marginTop: 1 },
  mark: { backgroundColor: "#ffe98a" },
  finding: { fontSize: 9, fontFamily: "Helvetica-Bold" },

  empty: { fontSize: 9, color: "#666", marginTop: 6 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 34,
    right: 34,
    fontSize: 8,
    color: "#666",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

const STATUS_WORD: Record<ChecklistPdfItem["status"], string> = {
  pending: "—",
  done: "DONE",
  issue: "ISSUE",
  na: "N/A",
};

function answerOf(i: ChecklistPdfItem): string {
  if (i.valueNumber != null) return pdfText(`${i.valueNumber}${i.unit ? ` ${i.unit}` : ""}`);
  if (i.valueText) return pdfText(i.valueText);
  return "";
}

function Line({ item }: { item: ChecklistPdfItem }) {
  const answer = answerOf(item);
  return (
    <View style={styles.row} wrap={false}>
      <Text style={styles.cellStatus}>{STATUS_WORD[item.status]}</Text>
      <View style={styles.cellPrompt}>
        <Text>{pdfText(item.prompt)}</Text>
        {item.guidance ? <Text style={styles.sub}>{pdfText(item.guidance)}</Text> : null}
        {item.note ? <Text style={styles.sub}>{pdfText(item.note)}</Text> : null}
      </View>
      <View style={styles.cellAnswer}>
        {answer ? <Text>{answer}</Text> : null}
        {item.expected ? <Text style={styles.sub}>{pdfText(item.expected)}</Text> : null}
        {item.equipmentName ? <Text style={styles.sub}>{pdfText(item.equipmentName)}</Text> : null}
        {item.score != null ? <Text style={styles.sub}>score {item.score}</Text> : null}
        {item.position ? <Text style={styles.sub}>{pdfText(item.position)}</Text> : null}
      </View>
    </View>
  );
}

export function ChecklistPdf({ data }: { data: ChecklistPdfData }) {
  const issues = data.items.filter((i) => i.status === "issue");
  const looked = data.items.filter((i) => i.status !== "pending").length;

  // The walk order the run was written in — one band per section, in the order
  // the rows arrive, which is the record screen's own grouping.
  const bands: { section: string; rows: ChecklistPdfItem[] }[] = [];
  for (const i of data.items) {
    const key = i.sectionName ?? "No section";
    const last = bands[bands.length - 1];
    if (last && last.section === key) last.rows.push(i);
    else bands.push({ section: key, rows: [i] });
  }

  return (
    <Document title={`${data.title} ${data.businessDate}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.masthead}>
          <Text style={styles.orgName}>{pdfText(data.orgName)}</Text>
          <View>
            <Text style={styles.docTitle}>{pdfText(data.kindLabel.toUpperCase())}</Text>
            <Text style={styles.docMeta}>{pdfText(data.title)}</Text>
          </View>
        </View>
        <View style={styles.rule} />

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Shop</Text>
            <Text style={styles.metaValue}>{data.locationCode || "—"}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>
              {data.businessDate}
              {data.shiftLabel ? ` - ${data.shiftLabel}` : ""}
            </Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Checked by</Text>
            <Text style={styles.metaValue}>{data.walkedBy ? pdfText(data.walkedBy) : "-"}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Answered</Text>
            <Text style={styles.metaValue}>
              {looked} of {data.items.length}
            </Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Finished</Text>
            <Text style={styles.metaValue}>
              {data.status === "submitted" ? (data.submittedAt ?? "yes") : "not finished"}
            </Text>
          </View>
        </View>

        {/* ISSUES FIRST. A clean run SAYS SO rather than omitting the band —
            an absent section cannot be told from a section that was never
            rendered, which is `checklistSection`'s argument in the email. */}
        <Text style={styles.band}>What was found</Text>
        {issues.length === 0 ? (
          <Text style={styles.empty}>Nothing was flagged.</Text>
        ) : (
          issues.map((i, n) => (
            <View key={`issue-${n}`} style={styles.row} wrap={false}>
              <Text style={styles.cellStatus}>
                <Text style={styles.mark}> ! </Text>
              </Text>
              <View style={styles.cellPrompt}>
                <Text style={styles.finding}>{pdfText(i.prompt)}</Text>
                {i.note ? <Text style={styles.sub}>{pdfText(i.note)}</Text> : null}
                <Text style={styles.sub}>
                  {pdfText(i.sectionName ?? "No section")}
                  {i.equipmentName ? ` - ${pdfText(i.equipmentName)}` : ""}
                </Text>
              </View>
              <View style={styles.cellAnswer}>
                {answerOf(i) ? <Text>{answerOf(i)}</Text> : null}
                {i.expected ? <Text style={styles.sub}>{pdfText(i.expected)}</Text> : null}
              </View>
            </View>
          ))
        )}

        <Text style={styles.band}>What was checked</Text>
        {/* NO `fixed` HEADER ON THIS TABLE. A repeated header lands on any page
            that holds only the tail of a section, which on a 70-item list is
            most of them. The section heading below repeats where it matters. */}
        {bands.map((band, n) => (
          <View key={`band-${n}`}>
            <Text style={styles.sectionHeading}>{pdfText(band.section)}</Text>
            {band.rows.map((i, m) => (
              <Line key={`row-${n}-${m}`} item={i} />
            ))}
          </View>
        ))}
        {data.items.length === 0 ? (
          <Text style={styles.empty}>This list had no items.</Text>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {pdfText(data.orgName)} - {data.locationCode} - printed {data.printedOn}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
