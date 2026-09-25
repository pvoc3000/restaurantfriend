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

// DRAWN IN THE APP'S OWN DESIGN LANGUAGE since 2026-09-25 (Mark: "finally,
// do the checklist in the same style"), from the shared
// `components/pdf/appDocument` parts every other document uses: the black
// masthead band, the list's title as the page heading with how much was
// answered beside it, Run and Sign-off field blocks, section heads with counts
// for What was found and What was checked, the walk's sections as `DataTable`'s
// black group bands, and no rules between rows. Issues still lead, a finding
// still wears the one yellow mark, and every value still goes through
// `pdfText`. The previous look is in git history at 63451a21.

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  DocFooter,
  Field,
  MARK_FILL,
  MUTED,
  caps,
  docStyles,
} from "@/components/pdf/appDocument";

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

const styles = {
  ...docStyles,
  ...StyleSheet.create({
    section: { marginTop: 20 },
    row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 4 },
    cellStatus: { width: 46, paddingLeft: 6, ...caps(7, 0.12), fontFamily: "Helvetica-Bold", paddingTop: 1.5 },
    cellPrompt: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
    cellAnswer: { width: 130 },
    sub: { fontSize: 8, color: MUTED, marginTop: 1.5 },
    // The one mark on the page: a finding, and nothing else.
    mark: { backgroundColor: MARK_FILL, paddingHorizontal: 5, paddingVertical: 1.5, alignSelf: "flex-start" },
    finding: { ...caps(8.5, 0.06), fontFamily: "Helvetica-Bold" },
    emptyNote: { fontSize: 9, color: MUTED, marginTop: 2 },
  }),
};

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
        <View style={styles.masthead} fixed>
          <Text style={styles.wordmark}>{pdfText(data.orgName)}</Text>
          <View style={styles.mastheadRight}>
            <Text style={styles.mastheadLine}>{pdfText(data.kindLabel)}</Text>
            <Text style={styles.mastheadLine}>Printed {data.printedOn}</Text>
          </View>
        </View>

        <View style={styles.body}>
        <View style={styles.headingRow}>
          <View style={{ flexGrow: 1, flexBasis: 0, paddingRight: 24 }}>
            <Text style={styles.kicker}>{pdfText(data.kindLabel)}</Text>
            <Text style={styles.h1}>{pdfText(data.title)}</Text>
            <Text style={styles.caption}>
              {[data.locationCode, data.businessDate, data.shiftLabel ? pdfText(data.shiftLabel) : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <View style={styles.numberBlock}>
            <Text style={styles.kicker}>Answered</Text>
            <Text style={styles.number}>
              {looked} of {data.items.length}
            </Text>
          </View>
        </View>

        <View style={styles.blocks}>
          <View style={styles.block}>
            <Text style={styles.sectionHead}>Run</Text>
            <Field label="Shop" value={data.locationCode} />
            <Field label="Date" value={data.businessDate} />
            <Field label="Shift" value={data.shiftLabel ? pdfText(data.shiftLabel) : null} />
          </View>
          <View style={styles.block}>
            <Text style={styles.sectionHead}>Sign-off</Text>
            <Field label="Checked by" value={data.walkedBy ? pdfText(data.walkedBy) : null} />
            <Field label="Answered" value={`${looked} of ${data.items.length}`} />
            <Field
              label="Finished"
              value={data.status === "submitted" ? (data.submittedAt ?? "Yes") : "Not finished"}
            />
          </View>
        </View>

        {/* ISSUES FIRST. A clean run SAYS SO rather than omitting the band —
            an absent section cannot be told from a section that was never
            rendered, which is `checklistSection`'s argument in the email. */}
        <View style={styles.section}>
        <Text style={styles.sectionHead}>
          What was found <Text style={styles.sectionCount}>{issues.length}</Text>
        </Text>
        {issues.length === 0 ? (
          <Text style={styles.emptyNote}>Nothing was flagged.</Text>
        ) : (
          issues.map((i, n) => (
            <View key={`issue-${n}`} style={styles.row} wrap={false}>
              <View style={[styles.cellStatus, { paddingTop: 0 }]}>
                <Text style={styles.mark}>Issue</Text>
              </View>
              <View style={styles.cellPrompt}>
                <Text style={styles.finding}>{pdfText(i.prompt)}</Text>
                {i.note ? <Text style={styles.sub}>{pdfText(i.note)}</Text> : null}
                <Text style={styles.sub}>
                  {pdfText(i.sectionName ?? "No section")}
                  {i.equipmentName ? ` · ${pdfText(i.equipmentName)}` : ""}
                </Text>
              </View>
              <View style={styles.cellAnswer}>
                {answerOf(i) ? <Text>{answerOf(i)}</Text> : null}
                {i.expected ? <Text style={styles.sub}>{pdfText(i.expected)}</Text> : null}
              </View>
            </View>
          ))
        )}
        </View>

        <View style={styles.section}>
        <Text style={styles.sectionHead}>
          What was checked <Text style={styles.sectionCount}>{data.items.length}</Text>
        </Text>
        {/* NO `fixed` HEADER ON THIS TABLE. A repeated header lands on any page
            that holds only the tail of a section, which on a 70-item list is
            most of them. Each section's black band marks where it starts. */}
        {bands.map((band, n) => (
          <View key={`band-${n}`}>
            <Text style={styles.groupBand}>{pdfText(band.section)}</Text>
            {band.rows.map((i, m) => (
              <Line key={`row-${n}-${m}`} item={i} />
            ))}
          </View>
        ))}
        {data.items.length === 0 ? (
          <Text style={styles.emptyNote}>This list had no items.</Text>
        ) : null}
        </View>
        </View>

        <DocFooter>
          {[pdfText(data.orgName), data.locationCode, pdfText(data.title), data.businessDate]
            .filter(Boolean)
            .join(" · ")}
        </DocFooter>
      </Page>
    </Document>
  );
}
