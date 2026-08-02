// An employee's paperwork — signed forms in the PRIVATE `employee-documents`
// bucket (migration 021), read through short-lived signed URLs.
//
// The point of the table is that onboarding completeness is DERIVED from it
// (Mark, 2026-08-01: paperwork should be "flags that are set when those
// documents are uploaded", not a checklist someone ticks). FMP had eight
// checkboxes and the documents themselves lived nowhere; a checkbox is a claim
// about a piece of paper in a drawer, and it can go stale the moment it's
// ticked optimistically. Here "complete" cannot be true without the file.

import type { PickOption } from "@/components/ui/PickList";

export const EMPLOYEE_DOCS_BUCKET = "employee-documents";

/** Same reasoning as the PO attachments' TTL: long enough to read, short
 *  enough that a URL copied out of the page stops working by end of shift. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type DocumentKind =
  | "application"
  | "w4"
  | "i9"
  | "i9_docs"
  | "food_handler_card"
  | "handbook"
  | "notice_to_employee"
  | "training_ack"
  | "meal_break_waiver"
  | "review"
  | "write_up"
  | "other";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  application: "Application",
  w4: "W-4",
  i9: "I-9",
  i9_docs: "I-9 documents",
  food_handler_card: "Food handler card",
  handbook: "Employee handbook",
  notice_to_employee: "Notice to employee",
  training_ack: "Training acknowledgement",
  meal_break_waiver: "Meal break waiver",
  review: "Performance review",
  write_up: "Write-up",
  other: "Other",
};

/** Exactly migration 021's check constraint — a value outside it fails insert.
 *  Grouped so the onboarding set reads as one thing in the menu. */
export const DOCUMENT_KIND_OPTIONS: PickOption[] = [
  { value: "application", label: "Application", group: "Onboarding" },
  { value: "w4", label: "W-4", hint: "federal withholding", group: "Onboarding" },
  { value: "i9", label: "I-9", hint: "work eligibility", group: "Onboarding" },
  { value: "i9_docs", label: "I-9 documents", hint: "ID and eligibility proof", group: "Onboarding" },
  { value: "food_handler_card", label: "Food handler card", group: "Onboarding" },
  { value: "handbook", label: "Employee handbook", hint: "signed receipt", group: "Onboarding" },
  { value: "notice_to_employee", label: "Notice to employee", hint: "Labor Code 2810.5", group: "Onboarding" },
  { value: "training_ack", label: "Training acknowledgement", group: "Onboarding" },
  { value: "meal_break_waiver", label: "Meal break waiver", group: "Other forms" },
  { value: "review", label: "Performance review", group: "Other forms" },
  { value: "write_up", label: "Write-up", hint: "discipline, incident", group: "Other forms" },
  { value: "other", label: "Other", group: "Other forms" },
];

/**
 * The paperwork a complete file has — FMP's eight onboarding checkboxes, in the
 * order that layout showed them.
 *
 * A constant, not `orgs.settings`: this list is federal and California
 * employment paperwork, not Donut Friend's configuration. If a second org ever
 * needs a different set — a different state, say — that's the moment it moves
 * into settings, and design rule 2 will be why.
 *
 * `meal_break_waiver` is deliberately NOT required: FMP kept it as a separate
 * checkbox because only some shifts need one.
 */
export const REQUIRED_ONBOARDING_KINDS: DocumentKind[] = [
  "application",
  "w4",
  "i9",
  "i9_docs",
  "food_handler_card",
  "handbook",
  "notice_to_employee",
  "training_ack",
];

/**
 * Which required kinds have no document on file, in the order above.
 *
 * Unknown kinds are ignored rather than throwing — the check constraint is the
 * real gate, and a kind added by a later migration must not break this screen
 * for everyone before the deploy catches up.
 */
export function missingPaperwork(kinds: string[]): DocumentKind[] {
  const have = new Set(kinds);
  return REQUIRED_ONBOARDING_KINDS.filter((kind) => !have.has(kind));
}

export type EmployeeDocument = {
  id: string;
  employee_id: string;
  storage_path: string;
  kind: DocumentKind;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};

/** A document plus somewhere to look at it — null when signing failed. */
export type SignedEmployeeDocument = EmployeeDocument & { url: string | null };

/**
 * `{org_id}/{employee_id}/{uuid}.{ext}` — the org leads because that is what
 * migration 021's storage policies authorise on, reading the first folder
 * segment with no join. Same shape and same reasoning as `attachmentPath`.
 */
export function documentPath(
  orgId: string,
  employeeId: string,
  fileName: string
): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : "";
  return `${orgId}/${employeeId}/${crypto.randomUUID()}${ext}`;
}
