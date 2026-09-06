// Inspection logs — `lib/inspections`.

import { test, eq } from "./harness";
import {
  scoreNumber,
  scoreTone,
  excerpt,
  inspectionDocRejection,
  INSPECTION_DOC_ACCEPT,
} from "../../src/lib/inspections";

test("a score is text and the number is read out of it", () => {
  eq(scoreNumber("98"), 98);
  eq(scoreNumber(" 92 "), 92);
  eq(scoreNumber("93/100"), 93, "the leading figure");
  eq(scoreNumber("A"), null);
  eq(scoreNumber("Pass"), null);
  eq(scoreNumber(""), null);
  eq(scoreNumber(null), null);
});

test("the tone follows LA County's letter grades", () => {
  eq(scoreTone("98"), "ok");
  eq(scoreTone("90"), "ok", "90 is an A");
  eq(scoreTone("89"), "warn", "89 is a B");
  eq(scoreTone("80"), "warn");
  eq(scoreTone("79"), "alarm");
  eq(scoreTone("A"), null, "a letter says what it says");
});

test("an excerpt flattens a paragraph to one line", () => {
  // FileMaker separates lines with a vertical tab (U+000B); it is whitespace.
  const VT = String.fromCharCode(11);
  eq(excerpt("loose drain pipe" + VT + "from prep sink."), "loose drain pipe from prep sink.");
  eq(excerpt("a".repeat(100), 20), "a".repeat(19) + "…");
  eq(excerpt(null), "");
});

test("the report card takes a PDF, which the photo card does not", () => {
  eq(inspectionDocRejection({ name: "r.pdf", type: "application/pdf" }), null);
  eq(inspectionDocRejection({ name: "r.jpg", type: "image/jpeg" }), null);
  eq(typeof inspectionDocRejection({ name: "r.heic", type: "image/heic" }), "string");
  eq(typeof inspectionDocRejection({ name: "r.docx", type: "application/vnd.x" }), "string");
  eq(INSPECTION_DOC_ACCEPT[0], "application/pdf");
});
