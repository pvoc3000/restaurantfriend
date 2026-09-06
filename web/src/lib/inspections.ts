/**
 * Inspection logs — the pure half (migration 093).
 *
 * An inspection is the RECORD OF A VISIT by a health (or other) inspector: the
 * day, the score, the report they left, what they found, and what was done
 * about it. Not a walk and not a template (Mark, 2026-09-05) — FileMaker's
 * `InspectionLog` shape, with the report in 077's bucket and the follow-up in
 * 075's tasks.
 */
import { PHOTO_ACCEPT } from "./facilityPhotos";

export type Inspection = {
  id: string;
  location_id: string;
  inspected_on: string;
  inspection_type: string;
  inspector: string | null;
  score: string | null;
  violations: string | null;
  violations_corrected: string | null;
  notes: string | null;
};

/** The columns every inspection screen reads. ONE string literal, for the
 *  reason `EVENT_SELECT` gives — a concatenation widens to `string` and
 *  collapses every column to `GenericStringError`. */
export const INSPECTION_SELECT =
  "id, location_id, inspected_on, inspection_type, inspector, score, violations, violations_corrected, notes, created_at";

/**
 * The report is usually a PDF and sometimes a photograph of one. 077's bucket
 * takes both; `PHOTO_ACCEPT` alone would refuse the thing this card is FOR.
 */
export const INSPECTION_DOC_ACCEPT = ["application/pdf", ...PHOTO_ACCEPT] as const;
export const INSPECTION_DOC_ACCEPT_ATTR = INSPECTION_DOC_ACCEPT.join(",");

export function inspectionDocRejection(file: { name: string; type: string }): string | null {
  if ((INSPECTION_DOC_ACCEPT as readonly string[]).includes(file.type)) return null;
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    return (
      `${file.name} is a HEIC photo, which the app can't read. ` +
      "Use the Attach button rather than dragging it in — that asks iOS to convert it."
    );
  }
  return `${file.name} isn't a report the app can file. PDF, JPEG, PNG or WebP.`;
}

/**
 * The number inside a score, where there is one. `score` is TEXT (093 says
 * why): "98" reads as 98, " 92 " as 92, "A" and "Pass" as null. A number with
 * junk after it ("93/100") reads as 93 — the leading figure is the score.
 */
export function scoreNumber(score: string | null | undefined): number | null {
  if (!score) return null;
  const m = score.trim().match(/^(\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type ScoreTone = "ok" | "warn" | "alarm" | null;

/**
 * LA County's letter grades: A is 90 and up, B 80–89, C 70–79, and below
 * that the placard is a number nobody wants in the window. The tone follows
 * the grade — quiet for an A, yellow for a B, red below — so a list of
 * inspections shows at a glance which visit went badly. A non-numeric score
 * gets no tone; the text says what it says.
 */
export function scoreTone(score: string | null | undefined): ScoreTone {
  const n = scoreNumber(score);
  if (n === null) return null;
  if (n >= 90) return "ok";
  if (n >= 80) return "warn";
  return "alarm";
}

/** A one-line preview of a paragraph for a list cell. */
export function excerpt(text: string | null | undefined, max = 80): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

