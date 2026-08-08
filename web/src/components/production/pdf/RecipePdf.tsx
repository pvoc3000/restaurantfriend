// The recipe sheet, rendered to PDF client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY (await import(...)) from a click handler —
// the renderer is heavy and nothing on a normal page load needs it.
//
// This is the KITCHEN BINDER page: what FileMaker printed, minus the diseases.
// Every scale column is computed from the base amount rather than stored
// (decision 3), so a corrected ingredient corrects all four columns at once —
// which the old sheet, with four hand-maintained numbers per line, could not do.
//
// It carries COST, unlike the vendor-facing purchase order, because this
// document never leaves the building. That is the same split PoPdf and
// ShoppingListPdf already draw.

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  scaleColumns,
  columnCell,
  formatCell,
  bakersPercent,
  type ScaleColumn,
} from "@/lib/production";
import { convert } from "@/lib/units";

export type RecipePdfLine = {
  name: string;
  qty: number | null;
  unit: string | null;
  note: string | null;
  /** Migration 041 — a row FileMaker's AUTO switch left alone prints what
   *  somebody typed, not a multiple of the base. */
  scaleAuto: boolean;
  scaleAmounts: (number | null)[] | null;
  scaleUnits: (string | null)[] | null;
  /** FMP's HIDE box — in the recipe, off the printed page. */
  hidden: boolean;
  /** Null when the ingredient could not be priced — printed as a dash. */
  cost: number | null;
};

export type RecipePdfStep = {
  body: string;
  /** A short-lived signed URL. `@react-pdf` fetches it while rendering, so it
   *  has to still be valid at the moment Print is pressed — which it is, since
   *  the page that minted it is the page you pressed it on. */
  imageUrl: string | null;
};

export type RecipePdfData = {
  orgName: string;
  recipeName: string;
  elementName: string | null;
  versionLabel: string;
  isMaster: boolean;
  author: string | null;
  description: string | null;
  yieldAmount: number | null;
  yieldUnit: string | null;
  mixerSize: string | null;
  prepTime: string | null;
  shelfLife: string | null;
  storage: string | null;
  tools: string | null;
  note: string | null;
  testingNotes: string | null;
  scaleLabels: string[] | null;
  scaleMultipliers: number[] | null;
  lines: RecipePdfLine[];
  steps: RecipePdfStep[];
  batchCost: number | null;
  /** How many ingredients could not be priced — what the ≥ is hiding. */
  unpricedCount: number;
  printedOn: string;
};

/**
 * The same four sizes and two greys `PoPdfDocs` settled on (Mark, 2026-07-27),
 * because a kitchen sheet and an order are read the same way — at arm's length,
 * on a shelf, in a hurry.
 */
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  recipeName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  makes: { fontSize: 8, color: "#666", marginTop: 2 },
  versionTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
  versionNote: { fontSize: 8, color: "#666", textAlign: "right", marginTop: 2 },

  metaGrid: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#111",
  },
  metaBlock: { flexGrow: 1, flexBasis: 0 },
  metaLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  metaValue: { fontSize: 9 },

  description: { fontSize: 8, color: "#666", marginBottom: 12 },

  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 4 },

  headRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111",
    paddingBottom: 4,
    marginBottom: 4,
  },
  headCell: { fontSize: 8, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", paddingVertical: 3 },
  cell: { fontSize: 9 },
  cellMuted: { fontSize: 8, color: "#666" },

  colName: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
  colAmount: { width: 78, textAlign: "right", paddingRight: 6 },
  colPercent: { width: 40, textAlign: "right", paddingRight: 6 },
  colCost: { width: 52, textAlign: "right" },

  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#111",
    marginTop: 4,
    paddingTop: 4,
  },

  step: { flexDirection: "row", marginBottom: 4 },
  stepNumber: { width: 16, fontSize: 9, color: "#666" },
  stepBody: { flexGrow: 1, flexBasis: 0, fontSize: 9 },
  stepImage: { marginTop: 4, marginBottom: 2, maxWidth: 200, objectFit: "contain" },

  notes: { fontSize: 8, color: "#666", marginTop: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#666",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export function RecipePdf({ data }: { data: RecipePdfData }) {
  const columns = scaleColumns(data.scaleLabels, data.scaleMultipliers);
  // The % column is derived per line, so it never earns an amount column of
  // its own — it has its own narrow column at the right of the ingredients.
  const amountColumns = columns.filter((c) => !c.isPercent);
  const baseIndex = columns[0]?.index ?? 0;
  const base = columns[0]?.multiplier ?? 1;
  // The percentage is a share of the whole recipe, so it is computed BEFORE the
  // hidden rows come off — a working note left off the binder page must not
  // move the numbers on it.
  const allPercents = bakersPercent(
    data.lines.map((l) => ({ qty: l.qty, unit: l.unit })),
    convert
  );
  const printed = data.lines
    .map((line, i) => ({ line, percent: allPercents[i] }))
    .filter(({ line }) => !line.hidden);

  return (
    <Document title={`${data.recipeName} v${data.versionLabel}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.recipeName}>{data.recipeName}</Text>
            <Text style={styles.makes}>
              {data.orgName}
              {data.elementName ? ` · makes ${data.elementName}` : ""}
            </Text>
          </View>
          <View>
            <Text style={styles.versionTitle}>v{data.versionLabel}</Text>
            <Text style={styles.versionNote}>
              {data.isMaster ? "Master version" : "Not the master version"}
              {data.author ? ` · ${data.author}` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <Meta label="Yield">
            {data.yieldAmount === null
              ? "—"
              : `${data.yieldAmount} ${data.yieldUnit ?? ""}`.trim()}
          </Meta>
          <Meta label="Mixer">{data.mixerSize ?? "—"}</Meta>
          <Meta label="Prep time">{data.prepTime ?? "—"}</Meta>
          <Meta label="Shelf life">{data.shelfLife ?? "—"}</Meta>
          <Meta label="Storage">{data.storage ?? "—"}</Meta>
        </View>

        {data.description ? <Text style={styles.description}>{data.description}</Text> : null}
        {data.tools ? (
          <Text style={styles.description}>Tools: {data.tools}</Text>
        ) : null}

        <Text style={styles.sectionTitle}>INGREDIENTS</Text>

        <View style={styles.headRow}>
          <Text style={[styles.headCell, styles.colName]}>Ingredient</Text>
          {amountColumns.map((c) => (
            <Text key={c.label} style={[styles.headCell, styles.colAmount]}>
              {c.label}
            </Text>
          ))}
          <Text style={[styles.headCell, styles.colPercent]}>%</Text>
          <Text style={[styles.headCell, styles.colCost]}>Cost</Text>
        </View>

        {printed.map(({ line, percent }, i) => (
          <View key={`${line.name}-${i}`} style={styles.row} wrap={false}>
            <View style={styles.colName}>
              <Text style={styles.cell}>{line.name}</Text>
              {line.note ? <Text style={styles.cellMuted}>{line.note}</Text> : null}
            </View>
            {amountColumns.map((c) => (
              <Text key={c.label} style={[styles.cell, styles.colAmount]}>
                {formatCell(
                  columnCell(
                    {
                      qty: line.qty,
                      unit: line.unit,
                      scaleAuto: line.scaleAuto,
                      scaleAmounts: line.scaleAmounts,
                      scaleUnits: line.scaleUnits,
                    },
                    c,
                    base,
                    baseIndex
                  )
                )}
              </Text>
            ))}
            <Text style={[styles.cellMuted, styles.colPercent]}>
              {percent === null ? "" : `${percent.toFixed(1)}%`}
            </Text>
            <Text style={[styles.cell, styles.colCost]}>
              {line.cost === null ? "—" : `$${line.cost.toFixed(2)}`}
            </Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={[styles.headCell, styles.colName]}>
            BATCH COST
            {data.unpricedCount
              ? ` — ${data.unpricedCount} ingredient${data.unpricedCount === 1 ? "" : "s"} not priced`
              : ""}
          </Text>
          {amountColumns.map((c) => (
            <Text key={c.label} style={[styles.cell, styles.colAmount]} />
          ))}
          <Text style={[styles.cell, styles.colPercent]} />
          {/* "AT LEAST", not "≥". @react-pdf's built-in Helvetica is
              WinAnsi-encoded and has no ≥ glyph — it rendered as a stray "e",
              so the total read "e$12.10" and the lower-bound claim was not
              merely lost but replaced with a typo. Found by rendering a real
              recipe and reading the paper. The screen keeps the ≥, where the
              browser's own fonts have it. */}
          <Text style={[styles.headCell, styles.colCost]}>
            {data.batchCost === null
              ? "—"
              : `${data.unpricedCount ? "AT LEAST " : ""}$${data.batchCost.toFixed(2)}`}
          </Text>
        </View>

        {data.steps.length ? (
          <>
            <Text style={styles.sectionTitle}>PROCEDURE</Text>
            {data.steps.map((s, i) => (
              <View key={i} style={styles.step} wrap={false}>
                <Text style={styles.stepNumber}>{i + 1}.</Text>
                <View style={styles.stepBody}>
                  <Text>{s.body}</Text>
                  {/* The picture goes UNDER its step rather than beside it: a
                      procedure is read as prose and a photo in the margin would
                      squeeze every step's text to make room for the one step
                      that has one. */}
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's
                      Image is a PDF primitive, not an <img>; it takes no alt. */}
                  {s.imageUrl ? <Image src={s.imageUrl} style={styles.stepImage} /> : null}
                </View>
              </View>
            ))}
          </>
        ) : null}

        {data.note || data.testingNotes ? (
          <>
            <Text style={styles.sectionTitle}>NOTES</Text>
            {data.note ? <Text style={styles.notes}>{data.note}</Text> : null}
            {data.testingNotes ? <Text style={styles.notes}>{data.testingNotes}</Text> : null}
          </>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            {data.recipeName} v{data.versionLabel}
          </Text>
          {/* Costs are live, so a printed sheet is a SNAPSHOT and says so.
              Without the date this page would look like a standing figure,
              which is the exact claim FileMaker's frozen costs made. */}
          <Text>Costs as at {data.printedOn}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metaValue}>{children}</Text>
    </View>
  );
}

/** Named so a caller can keep the type without importing the component. */
export type { ScaleColumn };
