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
  | "orientation"
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
  orientation: "Orientation",
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
  { value: "orientation", label: "Orientation", group: "Onboarding" },
  { value: "meal_break_waiver", label: "Meal break waiver", group: "Other forms" },
  { value: "training_ack", label: "Training acknowledgement", group: "Other forms" },
  { value: "review", label: "Performance review", group: "Other forms" },
  { value: "write_up", label: "Write-up", hint: "discipline, incident", group: "Other forms" },
  { value: "other", label: "Other", group: "Other forms" },
];

/**
 * The paperwork a complete file has — FMP's eight onboarding ticks, ordered by
 * how often they were actually used.
 *
 * Read off the real data (2026-08-01, 445 employees, 114 with any tick at all):
 * Application 87 · W4 70 · I9 68 · Food Handlers Card 61 · I9 Documents 56 ·
 * Employee Handbook 48 · Orientation 45 · Notice to Employee 41.
 *
 * **`orientation`, not `training_ack`.** The FMP layout's eighth checkbox was
 * labelled "Training Acknowledgement", but its value list holds both and the
 * data says which one is real: Orientation 45 uses against Training
 * Acknowledgement's 3. The label was evidently changed without the value list
 * following. `training_ack` survives as a fileable kind so those three have
 * somewhere to go; it isn't required.
 *
 * A constant, not `orgs.settings`: this list is federal and California
 * employment paperwork, not Donut Friend's configuration. If a second org ever
 * needs a different set — a different state, say — that's the moment it moves
 * into settings, and design rule 2 will be why.
 *
 * `meal_break_waiver` is deliberately NOT required: FMP kept it as a separate
 * field (51 of 445 signed) because only some shifts need one.
 */
export const REQUIRED_ONBOARDING_KINDS: DocumentKind[] = [
  "application",
  "w4",
  "i9",
  "i9_docs",
  "food_handler_card",
  "handbook",
  "orientation",
  "notice_to_employee",
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

// ---------------------------------------------------------------------------
// Expiry (migration 034)
// ---------------------------------------------------------------------------

/**
 * How much warning an expiring document gets.
 *
 * A California food handler card runs three years and a lapsed one is a health
 * inspection finding, so this is deliberately generous: 60 days is time to book
 * the course, take it, and get the card scanned. The window is shared by every
 * kind because the thing it measures is how long it takes a person to renew a
 * piece of paper, which doesn't vary much by which paper it is.
 */
export const EXPIRY_SOON_DAYS = 60;

export type ExpiryState = "none" | "expired" | "soon" | "ok";

/**
 * Where a date stands against today. Both are ISO `yyyy-mm-dd`, which compares
 * correctly as a string — no Date is constructed for the comparison itself,
 * only for the arithmetic that moves `today` forward.
 *
 * Moved here from `lib/employees` (where it was `foodHandlerState`) when the
 * expiry stopped belonging to one column on one record. The rule is unchanged.
 */
export function expiryState(expires: string | null, today: string): ExpiryState {
  if (!expires) return "none";
  if (expires < today) return "expired";
  const soon = new Date(`${today}T00:00:00`);
  soon.setDate(soon.getDate() + EXPIRY_SOON_DAYS);
  return expires <= soon.toISOString().slice(0, 10) ? "soon" : "ok";
}

/** One thing that lapses, and what it is. */
export type ExpiryEntry = {
  kind: DocumentKind;
  /** ISO yyyy-mm-dd. */
  on: string;
  /**
   * True when this comes from a document on file. False for the one thing that
   * doesn't — the legacy `employees.food_handler_expires`, which is a date
   * somebody typed with no card behind it.
   */
  filed: boolean;
};

type ExpirableDocument = Pick<EmployeeDocument, "kind" | "expires_on">;

/** The food handler card on file, if there is one. */
export function filedFoodHandlerCard<T extends Pick<EmployeeDocument, "kind">>(
  docs: T[]
): T | null {
  return docs.find((d) => d.kind === "food_handler_card") ?? null;
}

/**
 * What a food handler card expiry means for one person, and which of the two
 * places it came from.
 *
 * The document WINS when a card is on file, even if that card carries no
 * expiry — because at that point the card is the record and a date typed on the
 * employee row is a claim about a different piece of paper. The legacy column
 * answers only while no card has been photographed.
 *
 * This is the same priority receiving uses for the FILED invoice over the last
 * raw reading, and it exists for the same reason: two stores of one fact, one
 * of which is being retired. Migration 034 names the probe that says when the
 * column can be dropped and this function can go with it.
 */
export function foodHandlerExpiry(
  docs: ExpirableDocument[],
  legacyExpires: string | null
): { on: string | null; source: "document" | "record" | null } {
  const card = filedFoodHandlerCard(docs);
  if (card) return { on: card.expires_on, source: "document" };
  return legacyExpires
    ? { on: legacyExpires, source: "record" }
    : { on: null, source: null };
}

/**
 * Everything that lapses for one person, SOONEST FIRST — the filed documents
 * carrying a date, plus the legacy food-handler date while no card is on file.
 *
 * Soonest first is what the roster wants: an expired date sorts ahead of a
 * future one by construction, so the head of this list is both "the next thing
 * to deal with" and "the worst thing outstanding" without asking twice.
 */
export function expiryRoll(
  docs: ExpirableDocument[],
  legacyFoodHandler: string | null = null
): ExpiryEntry[] {
  const roll: ExpiryEntry[] = docs
    .filter((d): d is ExpirableDocument & { expires_on: string } => !!d.expires_on)
    .map((d) => ({ kind: d.kind, on: d.expires_on, filed: true }));

  if (!filedFoodHandlerCard(docs) && legacyFoodHandler) {
    roll.push({ kind: "food_handler_card", on: legacyFoodHandler, filed: false });
  }

  // Date first, then kind, so two things lapsing on the same day come back in
  // a stable order rather than in whatever order they were filed.
  return roll.sort((a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind));
}

/** The next thing to lapse, with its state — the roster's flag. */
export function soonestExpiry(
  docs: ExpirableDocument[],
  legacyFoodHandler: string | null,
  today: string
): (ExpiryEntry & { state: ExpiryState }) | null {
  const [next] = expiryRoll(docs, legacyFoodHandler);
  return next ? { ...next, state: expiryState(next.on, today) } : null;
}

/**
 * The whole state of one person's file: what was never filed, and what was
 * filed and has since gone stale.
 *
 * The two are reported SEPARATELY and never merged. An expired food handler
 * card is not a missing one — it's on file, you can look at it, and what it
 * needs is a renewal rather than a first upload. Rolling them together would
 * also make the derived line lie in the other direction, because `missing` is
 * what `missingPaperwork` has always meant and the fixtures pin it.
 *
 * `complete` is the whole answer, and it is stricter than "nothing missing":
 * paperwork with a lapsed card in it is not complete paperwork.
 */
export type PaperworkStatus = {
  missing: DocumentKind[];
  expired: ExpiryEntry[];
  expiring: ExpiryEntry[];
  complete: boolean;
};

export function paperworkStatus(
  docs: ExpirableDocument[],
  legacyFoodHandler: string | null,
  today: string
): PaperworkStatus {
  const missing = missingPaperwork(docs.map((d) => d.kind));
  const roll = expiryRoll(docs, legacyFoodHandler);
  const expired = roll.filter((e) => expiryState(e.on, today) === "expired");
  const expiring = roll.filter((e) => expiryState(e.on, today) === "soon");
  return {
    missing,
    expired,
    expiring,
    complete: missing.length === 0 && expired.length === 0,
  };
}

export type EmployeeDocument = {
  id: string;
  employee_id: string;
  storage_path: string;
  kind: DocumentKind;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  /**
   * When this document lapses (migration 034). **Null means it does not
   * expire**, which is the default and the right answer for most of the
   * vocabulary — a W-4 and a signed handbook receipt do not go stale.
   *
   * Not gated by kind. Which documents expire is a fact about the piece of
   * paper in your hand: a food handler card carries a printed date, and a card
   * issued without one should be able to say so by staying null.
   */
  expires_on: string | null;
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
