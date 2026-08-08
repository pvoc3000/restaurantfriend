// The kitchen binder page, rendered client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY (await import(...)) from a click handler —
// the renderer is heavy and nothing on a normal page load needs it.
//
// REBUILT 2026-08-08 to FileMaker's own printed sheet, which Mark supplied as a
// reference (Banana Cake Donut v10). The brief for it is one sentence: **it has
// to be easy to follow by kitchen staff**, and everything here follows from
// that.
//
// WHAT IT DELIBERATELY DOES NOT CARRY, all three on Mark's instruction:
//
//   · **No money.** No unit cost, no line cost, no batch total. Costing is a
//     desk question and this page is read standing at a mixer; a column of
//     dollars is one more thing between the baker and the next amount. It is
//     also the same split `PoPdf` and `ShoppingListPdf` already draw, just
//     landing the other way round — the internal document is the one WITHOUT
//     prices here, because its reader has no use for them.
//   · **No notes.** The version note and the testing notes are the record of
//     how the recipe got here, not instructions for making it.
//   · **No percentages.** FileMaker's sheet has no % column and neither does
//     this; it is a formulation tool, and the screen still shows it.
//
// AND THE THING IT GAINED: mixer size, expected yield and prep time print as
// ROWS, one figure per batch column, because that is what they are (Mark:
// "the recipe contains multiple batches and the mixer and prep time are
// included with the batch size"). They come from real lines restored by
// `migration/backfill-recipe-metadata-rows.mjs`; the version-level PREP TIME in
// the header block is the recipe record's own field, which FileMaker prints
// there too.

import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { scaleColumns, columnCell, formatCell, type ScaleColumn } from "@/lib/production";

export type RecipePdfLine = {
  /** What to CALL it — the element's catalog name where there is one. */
  name: string;
  qty: number | null;
  unit: string | null;
  /** Migration 041 — a row FileMaker's AUTO switch left alone prints what
   *  somebody typed, not a multiple of the base. */
  scaleAuto: boolean;
  scaleAmounts: (number | null)[] | null;
  scaleUnits: (string | null)[] | null;
  /** FMP's HIDE box — in the recipe, off this page. */
  hidden: boolean;
  /** Its place in the walk. A JUMP between two consecutive rows is where
   *  FileMaker had a separator, and is what opens a gap here. */
  sort: number | null;
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
  versionLabel: string;
  /** FileMaker's own header block. */
  createdAt: string | null;
  /** Who wrote it — FileMaker fills this on 91% of versions. */
  author: string | null;
  info: string | null;
  prepTime: string | null;
  shelfLife: string | null;
  storage: string | null;
  tools: string | null;
  scaleLabels: string[] | null;
  scaleMultipliers: number[] | null;
  lines: RecipePdfLine[];
  steps: RecipePdfStep[];
  printedOn: string;
};

const RULE = "#111";
const HAIR = "#bbb";
const MUTED = "#666";

const styles = StyleSheet.create({
  page: { paddingHorizontal: 32, paddingTop: 28, paddingBottom: 54, fontSize: 9, fontFamily: "Helvetica", color: "#111" },

  /* The banner. Black, full width, the name and version centred in it —
     FileMaker sets it in green and Mark's note says white is fine, which is
     also the only colour this app's design system allows on a black band. */
  banner: { backgroundColor: "#111", paddingVertical: 8, paddingHorizontal: 10 },
  bannerText: { color: "#fff", fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "center", letterSpacing: 0.5 },

  /* The header block: two bordered panels under the banner. */
  header: { flexDirection: "row", borderWidth: 1, borderColor: RULE, borderTopWidth: 0 },
  panel: { flexGrow: 1, flexBasis: 0, padding: 8 },
  panelDivider: { borderLeftWidth: 1, borderLeftColor: RULE },
  factRow: { flexDirection: "row", marginBottom: 4 },
  factLabel: { width: 74, fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right", paddingRight: 8 },
  factValue: { flexGrow: 1, flexBasis: 0, fontSize: 9 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    alignSelf: "flex-start",
  },

  /* Ingredients. Name on the LEFT and the batch columns on the right — Mark's
     preference over FileMaker's, which puts the amounts first. */
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE, paddingBottom: 3, marginBottom: 3 },
  colName: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  colAmount: { width: 76, flexDirection: "row", paddingLeft: 6, paddingRight: 4, borderLeftWidth: 1, borderLeftColor: HAIR },
  headAmount: { width: 76, paddingLeft: 6, paddingRight: 26, fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right" },
  amountQty: { flexGrow: 1, flexBasis: 0, textAlign: "right", paddingRight: 4, fontSize: 10 },
  /* Same ink as the number, a size down. FileMaker sets them this way and it is
     right: the unit is part of the amount, not an annotation on it, and greying
     it made a column of "g" and "kg" read as decoration — which is exactly the
     difference between 780 g and 1.56 kg. */
  amountUnit: { width: 22, fontSize: 8 },

  row: { flexDirection: "row", paddingVertical: 3, alignItems: "flex-end" },
  name: { fontSize: 10 },
  /* The gap where FileMaker had a separator row. Height, not a rule: the source
     grouped with white space and so does this. */
  gap: { height: 9 },

  /* Procedure. */
  step: { flexDirection: "row", marginBottom: 8 },
  stepNumber: { width: 18, fontSize: 10, color: MUTED },
  stepBody: { flexGrow: 1, flexBasis: 0, fontSize: 10, lineHeight: 1.35, paddingRight: 10 },
  stepImage: { width: 96, objectFit: "contain" },

  footer: {
    position: "absolute",
    bottom: 22,
    left: 32,
    right: 32,
    fontSize: 8,
    color: MUTED,
    flexDirection: "row",
    alignItems: "center",
  },
  footerSide: { flexGrow: 1, flexBasis: 0 },
  footerOrg: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#111", textAlign: "center" },
});

export function RecipePdf({ data }: { data: RecipePdfData }) {
  const columns = scaleColumns(data.scaleLabels, data.scaleMultipliers);
  // No % column on paper. It is a formulation figure, the printed sheet has
  // never carried one, and every column dropped here is width the amounts get.
  const amountColumns = columns.filter((c) => !c.isPercent);
  const baseIndex = columns[0]?.index ?? 0;
  const base = columns[0]?.multiplier ?? 1;

  const printed = data.lines.filter((l) => !l.hidden);

  return (
    <Document title={`${data.recipeName} v${data.versionLabel}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {data.recipeName.toUpperCase()} V{data.versionLabel}
          </Text>
        </View>

        <View style={styles.header}>
          <View style={styles.panel}>
            {/* CREATED but not MODIFIED, which is the one place this departs
                from FileMaker's block on purpose. `updated_at` is maintained by
                a trigger and says when the ROW last changed — for every
                migrated recipe, the moment the migration ran — while FMP's
                `_ModificationTimestamp` says when the RECIPE last changed.
                Printing either under one label states something false, and
                CREATED already answers the question a baker is asking, which is
                how settled this recipe is. `backfill-recipe-created.mjs` keeps
                FMP's modification date in `source_payload` for the day it earns
                a column. */}
            <Fact label="Created">{data.createdAt ?? "—"}</Fact>
            {data.author ? <Fact label="Author">{data.author}</Fact> : null}
            {data.info ? <Fact label="Info">{data.info}</Fact> : null}
          </View>
          <View style={[styles.panel, styles.panelDivider]}>
            <Fact label="Prep time">{data.prepTime ?? "—"}</Fact>
            <Fact label="Shelf life">{data.shelfLife ?? "—"}</Fact>
            <Fact label="Storage">{data.storage ?? "—"}</Fact>
            {data.tools ? <Fact label="Tools">{data.tools}</Fact> : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>INGREDIENTS</Text>

        <View style={styles.headRow}>
          <View style={styles.colName} />
          {amountColumns.map((c) => (
            <Text key={c.index} style={styles.headAmount}>
              {c.label}
            </Text>
          ))}
        </View>

        {printed.map((line, i) => (
          <React.Fragment key={`${line.name}-${i}`}>
            {opensGroup(printed, i) ? <View style={styles.gap} /> : null}
            <View style={styles.row} wrap={false}>
              <View style={styles.colName}>
                <Text style={styles.name}>{line.name}</Text>
              </View>
              {amountColumns.map((c) => (
                <Amount key={c.index} line={line} column={c} base={base} baseIndex={baseIndex} />
              ))}
            </View>
          </React.Fragment>
        ))}

        {data.steps.length ? (
          <>
            <Text style={styles.sectionTitle}>PROCEDURE</Text>
            {data.steps.map((s, i) => (
              <View key={i} style={styles.step} wrap={false}>
                <Text style={styles.stepNumber}>{i + 1}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
                {/* The picture sits BESIDE its step, the way FileMaker sets it:
                    a photograph of a hand in a bowl is read together with the
                    sentence it illustrates, not after it. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's
                    Image is a PDF primitive, not an <img>; it takes no alt. */}
                {s.imageUrl ? <Image src={s.imageUrl} style={styles.stepImage} /> : null}
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerSide}>printed: {data.printedOn}</Text>
          <Text style={[styles.footerSide, styles.footerOrg]}>{data.orgName}</Text>
          <Text
            style={[styles.footerSide, { textAlign: "right" }]}
            render={({ pageNumber }) => `P${pageNumber}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/**
 * One batch column's amount, as two fields — the number and its unit.
 *
 * Split rather than set as one string because a column of numbers is read by
 * running your eye down its right edge, and "1.56 kg" beside "60 g" puts the
 * digits in different places on every line. FileMaker splits them for the same
 * reason.
 */
function Amount({
  line,
  column,
  base,
  baseIndex,
}: {
  line: RecipePdfLine;
  column: ScaleColumn;
  base: number;
  baseIndex: number;
}) {
  const cell = columnCell(
    {
      qty: line.qty,
      unit: line.unit,
      scaleAuto: line.scaleAuto,
      scaleAmounts: line.scaleAmounts,
      scaleUnits: line.scaleUnits,
    },
    column,
    base,
    baseIndex
  );
  const text = formatCell(cell);
  const cut = text.lastIndexOf(" ");
  const qty = cut > 0 ? text.slice(0, cut) : text;
  const unit = cut > 0 ? text.slice(cut + 1) : "";
  return (
    <View style={styles.colAmount}>
      <Text style={styles.amountQty}>{qty}</Text>
      <Text style={styles.amountUnit}>{unit}</Text>
    </View>
  );
}

/**
 * Whether a blank line goes ABOVE this row.
 *
 * FileMaker grouped its ingredients with separator rows — dry, then wet, then
 * the batch metadata — and those rows are presentation stored as data, so the
 * 036 load dropped them. What it could not drop is the HOLE they left in the
 * sort numbers, and that hole is the grouping: Banana Cake Donut v10 runs
 * 1, 2, (3), 4, 5, 6, 7, (98, 99), 100, 101, 102.
 *
 * Computed over the PRINTED rows, so a hidden line (Total Liquid, at 99) leaves
 * its own gap behind rather than absorbing one.
 */
function opensGroup(rows: RecipePdfLine[], i: number): boolean {
  if (i === 0) return false;
  const previous = rows[i - 1].sort;
  const current = rows[i].sort;
  if (previous === null || current === null) return false;
  return current - previous > 1;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label.toUpperCase()}:</Text>
      <Text style={styles.factValue}>{children}</Text>
    </View>
  );
}

/** Named so a caller can keep the type without importing the component. */
export type { ScaleColumn };
