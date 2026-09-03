// The vendor invoice: its vocabulary, its money, and the two questions the
// Invoices module exists to answer — "when is this due" and "should we pay it".
//
// Everything here is PURE and fixture-tested (scripts/fixtures/invoices.fixtures).
// The screens hold no arithmetic of their own; see docs/invoices-brief.md.
//
// The record and the READING are deliberately different things. A reading
// (lib/invoiceExtraction) transcribes a photograph exactly as printed, negative
// signs and all. A record normalizes — one convention for credits, nulls kept
// as nulls where "not printed" and "zero" are different claims. The seam
// between them is `invoiceHeaderFromExtraction`, and it is the only place the
// sign of a credit is decided.

import {
  invoiceCharges,
  invoiceDueDate,
  isCreditReading,
  isoDate,
  priceDiffers,
  qtyDiffers,
  type InvoiceExtraction,
  type InvoiceLine,
} from "./invoiceExtraction";
import type { LineMatch } from "./invoiceMatch";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type InvoiceStatus = "open" | "approved" | "void";

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = ["open", "approved", "void"];

// `INVOICE_STATUS_LABEL` / `INVOICE_STATUS_CLASS` (open/approved/void only, no
// `paid`) are GONE — see below. Both status chips in the app now read
// `billStage`, so a paid bill reads Paid wherever it's shown, not just in the
// list.

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type InvoiceLineKind = "item" | "freight" | "other";

export type VendorInvoiceLine = {
  id: string;
  invoice_id: string;
  purchase_order_id: string | null;
  purchase_order_item_id: string | null;
  line_no: number | null;
  product_id: string | null;
  alt_product_id: string | null;
  description: string | null;
  pack: string | null;
  qty: number | null;
  unit_price: number | null;
  extended: number | null;
  kind: InvoiceLineKind;
  notes: string | null;
};

export type VendorInvoice = {
  id: string;
  org_id: string;
  location_id: string;
  vendor_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  terms: string | null;
  subtotal: number | null;
  tax: number | null;
  freight: number | null;
  other_charges: number | null;
  total: number | null;
  is_credit: boolean;
  status: InvoiceStatus;
  approved_at: string | null;
  approved_by: string | null;
  source: "manual" | "extraction";
  notes: string | null;
  synced_at: string | null;
  /** 089's timestamp. Bumped only when a LOCKED (money-affecting) column
   *  actually changes value — never by a notes or terms edit. Null means
   *  untouched since creation, which reads as "not stale" against a null
   *  `synced_at` too. See `pushIsStale`. */
  financials_touched_at: string | null;
  /** Whether a QuickBooks document is linked — the PRESENCE of a link, never
   *  the id itself: 086 exists to stop a QuickBooks id reaching the browser
   *  in a server-rendered prop, so a caller derives this from `external_ref`
   *  and never ships the ref whole. See `billStage`. */
  qbo_linked: boolean;
  /** 088's cache — see `billStage` and `billPaymentNote`. */
  qbo_balance: number | null;
  qbo_checked_at: string | null;
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * What this invoice does to the amount we owe.
 *
 * Amounts are stored POSITIVE and a credit carries `is_credit` (migration 025),
 * so this is the single place the sign lives. Every total on every screen goes
 * through it — a list that summed the raw column would report a credit memo as
 * money owed.
 */
export function signedTotal(invoice: Pick<VendorInvoice, "total" | "is_credit">): number {
  const total = Number(invoice.total ?? 0);
  return invoice.is_credit ? -total : total;
}

/** The same, over a set — the list's Window / Open / Overdue figures. */
export function sumSignedTotals(
  invoices: Pick<VendorInvoice, "total" | "is_credit">[]
): number {
  return invoices.reduce((sum, i) => sum + signedTotal(i), 0);
}

/** What the LINES add up to. Kind-blind: a freight LINE is money billed. */
export function lineTotal(lines: Pick<VendorInvoiceLine, "extended">[]): number {
  return lines.reduce((sum, l) => sum + Number(l.extended ?? 0), 0);
}

/** Half a cent, matching `priceDiffers` — one epsilon for money, everywhere. */
const MONEY_EPSILON = 0.005;

export type AmountCheck = {
  /** What the parts add up to, or null when there is nothing to add. */
  computed: number | null;
  /** What the invoice claims. */
  stated: number | null;
  differs: boolean;
  /** Named in the caveat, so "we assumed no tax" is visible rather than implied. */
  missing: ("subtotal" | "tax" | "freight" | "other")[];
};

/**
 * Does the foot of the invoice add up — subtotal + tax + freight + other = total?
 *
 * Nulls count as zero for the ARITHMETIC (an invoice printing no tax line is an
 * invoice with no tax) but are reported in `missing`, because "we treated the
 * absent tax as nothing" is an assumption the person approving should see
 * rather than infer from a number that happens to work out.
 *
 * A total with no parts at all is not a disagreement — that's the rent bill,
 * and there is no claim to check.
 *
 * NEITHER IS A TOTAL WITH NO SUBTOTAL, which is the same statement made
 * properly. The escape used to require all FOUR parts to be null, and a reader
 * that writes `tax: 0` for an invoice printing no tax — which is the honest
 * reading, and the commonest one — took the invoice out of that branch while
 * leaving nothing to add up. BakeMark 452660 then reported "the parts add up to
 * $0.00 against a total of $1,001.26" on an invoice whose seven lines sum to
 * $1,001.26 exactly (Mark, 2026-09-02).
 *
 * The subtotal is the only part that can carry the bulk of a bill; tax, freight
 * and other are addenda. Without it the equation is UNVERIFIABLE rather than
 * violated, and saying so is different from crying wolf. It is still named in
 * `missing`, so "the subtotal was never read" stays visible — which is the
 * thing actually worth fixing on that invoice.
 */
export function amountReconciliation(
  invoice: Pick<
    VendorInvoice,
    "subtotal" | "tax" | "freight" | "other_charges" | "total"
  >
): AmountCheck {
  const parts = [
    ["subtotal", invoice.subtotal],
    ["tax", invoice.tax],
    ["freight", invoice.freight],
    ["other", invoice.other_charges],
  ] as const;

  const missing = parts.filter(([, v]) => v === null).map(([k]) => k);
  const stated = invoice.total === null ? null : Number(invoice.total);

  // Nothing to check: either nothing was printed at the foot at all, or the one
  // part that could carry the bill is absent. See the note above — a `tax: 0`
  // reading used to sneak past the first test and fail the arithmetic on its own.
  if (missing.length === parts.length || invoice.subtotal === null) {
    return { computed: null, stated, differs: false, missing: [...missing] };
  }

  const computed = parts.reduce((sum, [, v]) => sum + Number(v ?? 0), 0);
  const differs =
    stated !== null && Math.abs(computed - stated) > MONEY_EPSILON;
  return { computed, stated, differs, missing: [...missing] };
}

export type LineSumCheck = {
  computed: number;
  stated: number | null;
  differs: boolean;
};

/**
 * Do the ITEM lines add up to the subtotal?
 *
 * Item lines only, and that exclusion is the whole point: a freight line and a
 * header `freight` amount are the SAME charge described twice — the reader put
 * a delivery fee in both places because it was printed in both places — so
 * counting it here as well as in `amountReconciliation` would double it and
 * report a disagreement on a perfectly good invoice.
 *
 * A subtotal with no lines is not a disagreement: that's a one-line bill typed
 * by hand, which is allowed to have no lines at all.
 */
export function lineSumReconciliation(
  lines: Pick<VendorInvoiceLine, "extended" | "kind">[],
  subtotal: number | null
): LineSumCheck {
  const items = lines.filter((l) => l.kind === "item");
  const computed = lineTotal(items);
  const stated = subtotal === null ? null : Number(subtotal);
  if (items.length === 0 || stated === null) {
    return { computed, stated, differs: false };
  }
  return { computed, stated, differs: Math.abs(computed - stated) > MONEY_EPSILON };
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

export type AgingBucket = "overdue" | "due7" | "due30" | "later" | "nodate";

export const AGING_ORDER: AgingBucket[] = [
  "overdue",
  "due7",
  "due30",
  "later",
  // LAST, not folded into "later": the rent bill with no printed due date will
  // be the commonest row in this list, and burying it in "later" hides work.
  "nodate",
];

export const AGING_LABEL: Record<AgingBucket, string> = {
  overdue: "Overdue",
  due7: "Due in 7 days",
  due30: "Due in 30 days",
  later: "Later",
  nodate: "No due date",
};

/**
 * Which aging band a bill falls in.
 *
 * `today` is a YYYY-MM-DD string in the ORG's timezone, computed once per
 * render (lib/today `todayInTimeZone`). It is not a Date and it is not the
 * host's day: a UTC server would otherwise start calling this afternoon's bills
 * overdue at 4pm Pacific — the same trap migration 007 exists to close for the
 * order guide, and the one `rangeStart` already respects.
 *
 * Due TODAY is `due7`, not overdue. You have until the end of the day.
 *
 * An APPROVED invoice still buckets. Approval is not payment, and "approved and
 * overdue" is a real state worth seeing; only `void` should drop out, which is
 * the caller's filter rather than this function's business.
 */
export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const due = isoDate(dueDate);
  if (!due) return "nodate";
  const days = daysBetween(today, due);
  if (days === null) return "nodate";
  if (days < 0) return "overdue";
  if (days <= 7) return "due7";
  if (days <= 30) return "due30";
  return "later";
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative means `to` is past. */
function daysBetween(from: string, to: string): number | null {
  const a = isoDate(from);
  const b = isoDate(to);
  if (!a || !b) return null;
  const ms =
    Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

export type DuplicateMatch = {
  invoice: Pick<VendorInvoice, "id" | "invoice_number" | "invoice_date" | "total">;
  /** 0 = same number, 1 = same money on about the same day. Lower is stronger. */
  rank: 0 | 1;
  reason: string;
};

/**
 * An invoice number is printed by a human and typed by a human. Case, spaces
 * and dashes never carry meaning here — the same reasoning, and nearly the same
 * code, as `normalizeSku`.
 */
export function normalizeInvoiceNumber(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!cleaned) return null;
  // Leading zeros are stripped here rather than kept for a second pass (which
  // is what the SKU join does): two invoices differing only by a leading zero
  // being genuinely different documents is not a real case, and this only ever
  // WARNS — the cost of an extra question is far below the cost of paying twice.
  return cleaned.replace(/^0+/, "") || cleaned;
}

/**
 * The invoice a READING should join rather than duplicate.
 *
 * `findPossibleDuplicates` below is the same question asked of a HUMAN, and it
 * warns rather than blocking because a person is standing there to judge. The
 * auto-filer has nobody: it runs on the act of attaching a document, so
 * whatever it decides is what happens. Left with no answer it created a second
 * record every time — measured on the live database 2026-08-27, 7 numbers were
 * on file more than once and 49 filings had produced 49 records where they
 * should have produced 41. Replaying those 49 through this function joins
 * exactly the 8 redundant ones and leaves no (vendor, number) pair repeated.
 *
 * So this is the CERTAIN half of that function, promoted from a warning to an
 * action, and nothing else:
 *
 * - **The number must match** (normalized the same way, so the auto-join and
 *   the on-screen warning cannot disagree about what "the same number" means).
 *   Rank 1 — same money, about the same day — stays a warning FOREVER: it is a
 *   heuristic, and two genuinely different bills merged by a machine is a worse
 *   outcome than the duplicate this exists to prevent.
 * - **A numberless reading joins nothing.** A rent bill and a photographed
 *   receipt have no key, which is the same reason migration 025 declines a
 *   unique index; a null must not match another null.
 * - **`is_credit` must agree.** A credit memo legitimately repeats the number
 *   of the invoice it credits — that is the case the constraint discussion in
 *   025 names — so merging the two would fold a refund into the bill.
 * - **A VOID invoice is not a match.** Void means somebody decided that record
 *   should not exist, so it no longer holds the number; filing the document
 *   again is how you replace it.
 */
export function filedInvoiceFor(
  reading: { vendor_id: string; invoice_number: string | null; is_credit: boolean },
  others: Pick<
    VendorInvoice,
    "id" | "vendor_id" | "invoice_number" | "status" | "is_credit"
  >[]
): Pick<VendorInvoice, "id" | "invoice_number"> | null {
  const number = normalizeInvoiceNumber(reading.invoice_number);
  if (!number) return null;

  for (const other of others) {
    if (other.vendor_id !== reading.vendor_id) continue;
    if (other.status === "void") continue;
    if (other.is_credit !== reading.is_credit) continue;
    if (normalizeInvoiceNumber(other.invoice_number) !== number) continue;
    return other;
  }
  return null;
}

/**
 * What a printed line IS, for telling "another page" from "the same page
 * again".
 *
 * Not an id — a reading has none. The SKU, the wording, the quantity and the
 * two money figures together, normalized the way a human comparing two
 * printouts would: case and spacing don't make a different line, and PostgREST
 * hands numerics back as strings, so `1` and `"1.000"` must key the same or
 * every comparison silently fails (`toInvoiceLine` carries the same warning).
 *
 * EXPORTED for `migration/cleanup-duplicate-invoices.mjs`, which folds records
 * the old auto-filer produced. That script has to pair a duplicate's lines with
 * the survivor's to carry PO links across, and pairing by anything other than
 * this would be a second definition of "the same printed line" — the drift this
 * file keeps warning about. Nothing in `web/src` calls it directly.
 */
export function linePrint(line: {
  product_id?: string | null;
  alt_product_id?: string | null;
  description?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  extended?: number | string | null;
}): string {
  const sku =
    normalizeInvoiceNumber(line.product_id ?? null) ??
    normalizeInvoiceNumber(line.alt_product_id ?? null) ??
    "";
  const words = (line.description ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const num = (v: number | string | null | undefined) =>
    v === null || v === undefined || v === "" ? "" : Number(v).toFixed(4);
  return [sku, words, num(line.qty), num(line.unit_price), num(line.extended)].join("|");
}

/**
 * The lines of a reading that this invoice does NOT already hold — what a
 * second page adds, and what a second copy of the same page does not.
 *
 * An invoice's pages are scanned and attached separately (Mark, 2026-08-27:
 * "I've uploaded individual pages from the same invoice"), and the totals block
 * prints on every page, so each page reads as the WHOLE bill: measured on Chefs
 * Warehouse 73535581 at DF02, two pages produced two records both claiming
 * $394.16, one holding 4 lines and the other 7 — so /invoices showed $788.32
 * owed for a $394.16 bill. Joining them on the header is only half an answer;
 * the record then has to end up holding the union of what its pages say, or
 * seven lines are silently lost.
 *
 * A MULTISET, not a set, and that is the case worth not getting wrong: one
 * invoice may legitimately print the same item twice at the same price. Each
 * existing line is consumed at most once, so re-reading a page with [A, A]
 * matches both and adds nothing, while a page with [A, A] against a record
 * holding one A adds exactly one.
 *
 * Numbering CONTINUES from what is already there — `line_no` is the printed
 * order and there is no unique constraint on it (025), so page two's lines sit
 * after page one's rather than colliding with them.
 */
type PrintedLine = {
  product_id?: string | null;
  alt_product_id?: string | null;
  description?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  extended?: number | string | null;
};

export function unfiledLines<T extends PrintedLine & { line_no: number | null }>(
  existing: (PrintedLine & { line_no?: number | null })[],
  drafts: T[]
): T[] {
  let next = existing.reduce((max, l) => Math.max(max, Number(l.line_no ?? 0)), 0);
  return surplusLines(existing, drafts).map((draft) => ({ ...draft, line_no: ++next }));
}

/**
 * The multiset itself, with no numbering: which of `incoming` is not already
 * accounted for in `held`.
 *
 * Factored out because there are now TWO places that have to agree about when
 * one page adds to a bill and when it merely repeats it — `unfiledLines`, which
 * writes rows, and `billsFromReadings`, which reconciles against readings that
 * have not been written yet. Two spellings of "the same printed line" is
 * exactly the drift this file keeps warning about, and here it would be
 * invisible: the two would agree on every ordinary invoice and disagree on the
 * re-uploaded page, which is the case both exist for.
 *
 * Each held line is consumed at most once — see `unfiledLines` for why a
 * multiset and not a set.
 */
function surplusLines<T extends PrintedLine>(
  held: readonly PrintedLine[],
  incoming: readonly T[]
): T[] {
  const have = new Map<string, number>();
  for (const line of held) {
    const key = linePrint(line);
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  const out: T[] = [];
  for (const line of incoming) {
    const key = linePrint(line);
    const count = have.get(key) ?? 0;
    if (count > 0) {
      have.set(key, count - 1);
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * The BILLS an order's paperwork amounts to, before any of it is filed.
 *
 * This is `createInvoiceFromReading`'s joining rule — same vendor, same number
 * — done in the head rather than in the database, and it exists because filing
 * moved to close (Mark, 2026-09-01). The receiving screen reconciles against
 * whatever paperwork is on the order, and until that day it could rely on the
 * FILED invoices to have already been joined and unioned for it. Now they have
 * not been, so the same three facts have to be worked out from the readings:
 *
 *   · two DIFFERENT invoices against one order are a partial shipment, and
 *     both are billing this delivery — `latestRead` alone would reconcile
 *     against whichever was read last and report every line of the other as
 *     unbilled;
 *   · two readings of ONE number are a re-taken photo or a second page, never
 *     a second bill;
 *   · a second page ADDS its lines, a second copy of a page adds nothing.
 *
 * A reading with no printed number never joins anything — the same refusal
 * `filedInvoiceFor` makes, and for the same reason: there is nothing to be
 * confident on. Two numberless readings of one document therefore read as two
 * bills, which is what the FILED path does with them too. Parity with what
 * filing would produce is the whole target here; a cleverer rule would be a
 * second answer to a question this module has already answered.
 *
 * Ordered by when each document was READ, so the pages of one bill line up the
 * way they were attached.
 */
export function billsFromReadings<
  T extends {
    kind: string;
    extraction: InvoiceExtraction | null;
    extracted_at?: string | null;
  }
>(attachments: readonly T[]): { number: string | null; lines: InvoiceLine[] }[] {
  const readings = attachments
    // An INVOICE only, `unfiledReadings`' rule: a packing slip may well have
    // been read and it is not a bill.
    .filter((a) => a.kind === "invoice" && a.extraction !== null)
    .sort((a, b) => (a.extracted_at ?? "").localeCompare(b.extracted_at ?? ""));

  const bills: { number: string | null; lines: InvoiceLine[] }[] = [];
  const byNumber = new Map<string, { number: string | null; lines: InvoiceLine[] }>();

  for (const reading of readings) {
    const extraction = reading.extraction as InvoiceExtraction;
    const key = normalizeInvoiceNumber(extraction.invoice_number ?? null);
    let bill = key === null ? undefined : byNumber.get(key);
    if (!bill) {
      // The number as PRINTED, like everywhere else in this module: whoever
      // reads it is holding the paper.
      bill = { number: extraction.invoice_number?.trim() || null, lines: [] };
      bills.push(bill);
      if (key !== null) byNumber.set(key, bill);
    }
    bill.lines.push(...surplusLines(bill.lines, extraction.lines ?? []));
  }
  return bills;
}

/**
 * The header fields a later page can fill IN, never overwrite.
 *
 * A multi-page invoice does not print everything on page one — the totals block
 * and the due date routinely sit on the last page — so a record filed from page
 * one can be missing figures that page two has. Filling only what is null is
 * what keeps this from being an edit: a value already on the record was either
 * read from a page or typed by a person, and neither should be replaced by
 * another page's guess.
 *
 * There is deliberately no special case for `is_credit`. A guard was written
 * for it and removed once a fixture showed it changed nothing: `false` is a
 * value rather than a blank, so the null test already refuses to touch it, and
 * a second rule saying the same thing is one more thing to keep true.
 */
export function blankHeaderFields(
  existing: Record<string, unknown>,
  header: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(header)) {
    if (value === null || value === undefined) continue;
    if (existing[key] === null || existing[key] === undefined) patch[key] = value;
  }
  return patch;
}

/**
 * What the close confirm's checkbox says.
 *
 * It counts BILLS, not documents, and that distinction is the whole of it: two
 * pages of one invoice are two attachments that will JOIN into a single record
 * (`filedInvoiceFor`), so "File 2 invoices" would promise something the write
 * will not do and would read as the duplicate bug still being there. Distinct
 * printed numbers is the closest thing to a bill count available before the
 * write, and it is exactly what the join keys on.
 *
 * A reading with no number is its own bill for counting purposes — there is
 * nothing to join it to, which is the same reason `filedInvoiceFor` refuses to
 * match one.
 */
export function fileReadingsLabel(
  readings: readonly { extraction: InvoiceExtraction | null }[]
): string {
  const numbered = new Set<string>();
  let unnumbered = 0;
  for (const r of readings) {
    const n = normalizeInvoiceNumber(r.extraction?.invoice_number ?? null);
    if (n) numbered.add(n);
    else unnumbered += 1;
  }
  const bills = numbered.size + unnumbered;
  if (bills === 1 && numbered.size === 1) {
    // The number as PRINTED, not the normalized form — the reader is checking
    // this against paper, so it has to be the characters on the paper.
    const printed = readings.find((r) => r.extraction?.invoice_number)?.extraction
      ?.invoice_number;
    return `Also file invoice ${printed?.trim()} as a bill`;
  }
  if (bills === 1) return "Also file this invoice as a bill";
  return `Also file these ${bills} invoices as bills`;
}

/** Same vendor, same money, within a week — the numberless re-upload. */
const NEAR_DUPLICATE_DAYS = 7;

/**
 * Other invoices that might be this same bill.
 *
 * WARNS, never blocks — `findPossibleRehires`' rule, and migration 025 declines
 * to add a unique constraint for the reasons written there. Paying a vendor
 * twice is the single most expensive mistake this module can prevent, and the
 * only thing that reliably prevents it is a human being asked.
 *
 * An invoice never reports ITSELF: this runs on a detail screen against the
 * list the record is already in.
 */
export function findPossibleDuplicates(
  candidate: Pick<
    VendorInvoice,
    "id" | "vendor_id" | "invoice_number" | "invoice_date" | "total"
  >,
  others: Pick<
    VendorInvoice,
    "id" | "vendor_id" | "invoice_number" | "invoice_date" | "total" | "status"
  >[]
): DuplicateMatch[] {
  const number = normalizeInvoiceNumber(candidate.invoice_number);
  const found: DuplicateMatch[] = [];

  for (const other of others) {
    if (other.id === candidate.id) continue;
    if (other.vendor_id !== candidate.vendor_id) continue;
    // A voided invoice is a document someone has already dealt with; raising it
    // again is noise.
    if (other.status === "void") continue;

    const otherNumber = normalizeInvoiceNumber(other.invoice_number);
    if (number && otherNumber && number === otherNumber) {
      found.push({
        invoice: other,
        rank: 0,
        reason: `same invoice number at this vendor`,
      });
      continue;
    }

    // The numberless case — a rent bill or a photographed receipt uploaded
    // twice. Money and date, since that's all either copy has.
    if (
      candidate.total !== null &&
      other.total !== null &&
      Math.abs(Number(candidate.total) - Number(other.total)) <= MONEY_EPSILON
    ) {
      const gap =
        candidate.invoice_date && other.invoice_date
          ? daysBetween(candidate.invoice_date, other.invoice_date)
          : null;
      if (gap !== null && Math.abs(gap) <= NEAR_DUPLICATE_DAYS) {
        found.push({
          invoice: other,
          rank: 1,
          reason: `same amount at this vendor, ${
            gap === 0 ? "the same day" : `${Math.abs(gap)} days apart`
          }`,
        });
      }
    }
  }

  return found.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * What a linked purchase order contributes to the approval question: the
 * three-way match between what was ordered, what was received, and what was
 * billed. Assembled by the detail screen from `matchInvoiceToOrder`, which
 * already computes exactly this pairing.
 */
export type LinkedOrder = {
  poNumber: string;
  matches: LineMatch[];
};

/**
 * What is still unresolved about a bill, in the words the confirm will use.
 *
 * `closeReadiness`'s twin, and it follows the same rule for the same reason: it
 * REPORTS and never blocks. Gate approval on a complete set and the bill whose
 * purchase order was never linked is stuck at `open` forever, which is how a
 * status stops meaning anything.
 *
 * Every caveat here must have an affordance on the screen that shows it — the
 * BakeMark lesson. A confirm that names something you are given no way to fix
 * teaches you to stop reading confirms.
 */
export function approvalReadiness(
  invoice: Pick<
    VendorInvoice,
    "subtotal" | "tax" | "freight" | "other_charges" | "total"
  >,
  lines: Pick<VendorInvoiceLine, "extended" | "kind" | "purchase_order_id">[],
  linked: LinkedOrder[],
  documentCount: number,
  duplicates: DuplicateMatch[],
  /** The vendor name the reader took off the page, when it disagrees with the
   *  vendor on the record. Null when it agrees or nothing was read. */
  vendorNameDisagreement: string | null
): string[] {
  const caveats: string[] = [];

  const amounts = amountReconciliation(invoice);
  if (amounts.differs) {
    caveats.push(
      `the parts add up to ${money(amounts.computed)}, but the invoice says ${money(
        amounts.stated
      )}`
    );
  }

  const sums = lineSumReconciliation(lines, invoice.subtotal);
  if (sums.differs) {
    caveats.push(
      `the item lines come to ${money(sums.computed)} against a subtotal of ${money(
        sums.stated
      )}`
    );
  }

  // Silent when NONE of them are attributed: that's a rent bill or a plumber's
  // invoice, and complaining about a missing purchase order every single time
  // is how a caveat becomes noise.
  const unattributed = lines.filter((l) => l.purchase_order_id === null).length;
  if (unattributed > 0 && unattributed < lines.length) {
    caveats.push(
      `${unattributed} ${
        unattributed === 1 ? "line isn't" : "lines aren't"
      } attributed to a purchase order`
    );
  }

  for (const order of linked) {
    const pricey = order.matches.filter(
      (m) => m.invoice !== null && priceDiffers(m.unitPrice, m.line.unit_price)
    ).length;
    if (pricey > 0) {
      caveats.push(
        `${pricey} ${pricey === 1 ? "line is" : "lines are"} billed at a price ${
          pricey === 1 ? "that differs" : "that differs"
        } from ${order.poNumber}`
      );
    }

    // Billed for MORE than we wrote down as received. A line with no received
    // quantity has nothing to disagree with — that's `qtyDiffers`' own
    // reasoning, and reporting it here would flag every unreceived order.
    const over = order.matches.filter((m) => {
      if (!m.invoice || m.line.qty_received === null) return false;
      const billed = m.invoice.qty;
      if (billed === null) return false;
      return billed - Number(m.line.qty_received) > 0.001;
    }).length;
    if (over > 0) {
      caveats.push(
        `${over} ${over === 1 ? "line is" : "lines are"} billed for more than was received on ${order.poNumber}`
      );
    }

    const receivedNotBilled = order.matches.filter(
      (m) => m.invoice === null && m.line.qty_received !== null &&
        Number(m.line.qty_received) > 0
    ).length;
    if (receivedNotBilled > 0) {
      caveats.push(
        `${receivedNotBilled} ${
          receivedNotBilled === 1 ? "line was" : "lines were"
        } received on ${order.poNumber} but ${
          receivedNotBilled === 1 ? "isn't" : "aren't"
        } on this invoice`
      );
    }
  }

  if (documentCount === 0) caveats.push("no document is attached");

  if (duplicates.length > 0) {
    const first = duplicates[0];
    caveats.push(
      `it may be a duplicate — ${first.reason}${
        first.invoice.invoice_number ? ` (${first.invoice.invoice_number})` : ""
      }`
    );
  }

  if (vendorNameDisagreement) {
    caveats.push(
      `the invoice reads "${vendorNameDisagreement}", which isn't the vendor on this record`
    );
  }

  return caveats;
}

// `qtyDiffers` is re-exported so the detail screen has one import for the
// comparisons this module's caveats are worded from.
export { qtyDiffers };

// ---------------------------------------------------------------------------
// From a reading to a record
// ---------------------------------------------------------------------------

export type InvoiceHeaderDraft = {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  terms: string | null;
  subtotal: number | null;
  tax: number | null;
  freight: number | null;
  other_charges: number | null;
  total: number | null;
  is_credit: boolean;
};

/**
 * The record a reading proposes.
 *
 * This is the ONE place a credit's sign is decided, and the normalization runs
 * one way only: magnitudes are made positive and the direction moves to
 * `is_credit`. The classic bug is doing it twice — a reading that carries both
 * the flag AND negative amounts must not come out positive-flagged-negative —
 * so the sign is taken from `isCreditReading` and the amounts are then made
 * unconditionally positive, rather than being flipped when the flag is set.
 *
 * Dates go through `isoDate`'s round trip. The json_schema holds the model to a
 * STRING and says nothing about its shape, while these land in `date` columns —
 * an unchecked "2026-02-31" rolls over to March 2nd rather than failing.
 */
export function invoiceHeaderFromExtraction(
  extraction: InvoiceExtraction
): InvoiceHeaderDraft {
  const charges = invoiceCharges(extraction);
  const isCredit = isCreditReading(extraction);
  const magnitude = (v: number | null) => (v === null ? null : Math.abs(Number(v)));

  return {
    invoice_number: extraction.invoice_number?.trim() || null,
    invoice_date: isoDate(extraction.invoice_date),
    due_date: invoiceDueDate(extraction),
    terms: extraction.terms?.trim() || null,
    subtotal: magnitude(charges.subtotal),
    tax: magnitude(charges.tax),
    freight: magnitude(charges.freight),
    other_charges: magnitude(charges.other),
    total: magnitude(charges.total),
    is_credit: isCredit,
  };
}

/**
 * The lines a reading proposes, in the order they were printed.
 *
 * Kind is `item` for everything: the reader is told to skip subtotal, tax,
 * delivery and total ROWS, so anything that reaches here is a line item. A
 * freight line only appears when a human marks one, which is what the per-line
 * menu is for.
 */
export function invoiceLinesFromExtraction(
  extraction: InvoiceExtraction
): Omit<VendorInvoiceLine, "id" | "invoice_id">[] {
  return extraction.lines.map((line, index) => ({
    purchase_order_id: null,
    purchase_order_item_id: null,
    line_no: index + 1,
    product_id: line.product_id?.trim() || null,
    alt_product_id: line.alt_product_id?.trim() || null,
    description: line.description?.trim() || null,
    pack: line.pack?.trim() || null,
    qty: line.qty,
    unit_price: line.unit_price,
    extended: line.extended,
    kind: "item" as const,
    notes: null,
  }));
}

/**
 * A STORED line in the shape the matcher reads.
 *
 * `matchInvoiceToOrder` is pure over `InvoiceLine`, which is the READING's
 * shape — so a stored row has to be presented in it before it can be matched.
 * One conversion, here, because two callers need it and two copies is how the
 * numeric coercions drift: `qty` and `unit_price` come back from PostgREST as
 * strings on a numeric column, and a string quantity silently fails every
 * comparison downstream.
 */
export function toInvoiceLine(line: VendorInvoiceLine): InvoiceLine {
  return {
    product_id: line.product_id,
    alt_product_id: line.alt_product_id,
    description: line.description ?? "",
    qty: line.qty === null ? null : Number(line.qty),
    unit_price: line.unit_price === null ? null : Number(line.unit_price),
    extended: line.extended === null ? null : Number(line.extended),
    pack: line.pack,
  };
}

/**
 * The purchase order number this invoice prints back at us, if a single one
 * covers the page.
 *
 * A per-LINE number wins over the header one where the lines agree — that is
 * the shape a consolidated invoice takes, and the header on those is often
 * blank or carries only the first order. Where the lines DISAGREE this returns
 * null: the document covers more than one order, and picking one of them would
 * be worse than saying nothing (the Link to PO dialog is where that gets
 * resolved, one order at a time).
 */
export function printedPoNumber(extraction: InvoiceExtraction): string | null {
  const perLine = new Set(
    extraction.lines
      .map((l) => l.purchase_order_number?.trim())
      .filter((v): v is string => Boolean(v))
  );
  if (perLine.size === 1) return [...perLine][0];
  if (perLine.size > 1) return null;
  return extraction.purchase_order_number?.trim() || null;
}

/**
 * Every purchase order number printed anywhere on this invoice — header and
 * lines together. What the Link block offers when the page names more than one.
 */
export function printedPoNumbers(extraction: InvoiceExtraction): string[] {
  const all = new Set<string>();
  const header = extraction.purchase_order_number?.trim();
  if (header) all.add(header);
  for (const line of extraction.lines) {
    const n = line.purchase_order_number?.trim();
    if (n) all.add(n);
  }
  return [...all];
}

/**
 * The purchase order numbers this invoice prints that are NOT the order you are
 * standing in front of — or null when there is nothing to say.
 *
 * Three rules, and each one is a real invoice rather than a hypothetical:
 *
 * SILENCE IS NOT DISAGREEMENT. BakeMark prints no customer PO number at all, so
 * an absent value must never warn — otherwise the one vendor whose paperwork is
 * simply built differently flags every delivery, and the mark stops meaning
 * anything on the deliveries where it does.
 *
 * ANY MATCH IS AGREEMENT. A consolidated invoice legitimately names several
 * orders (that is why `printedPoNumbers` reads the lines as well as the header),
 * so ours being among them is agreement, not a partial one.
 *
 * PUNCTUATION IS NOT A MISMATCH. Chefs Warehouse printed `132 181164 01` on
 * 2026-08-10 for our `132-181164-01` — the same number, spaces for hyphens.
 * `normalizeInvoiceNumber` is what the printed-number LINK already compares
 * with, so the warning and the link cannot disagree about what "the same
 * number" means.
 *
 * What comes back is what is PRINTED, not the normalized form: the reader is
 * being asked to check a document against a screen, so the screen has to show
 * the characters that are on the document.
 */
export function printedPoDisagreement(
  extraction: InvoiceExtraction,
  poNumber: string
): string[] | null {
  const printed = printedPoNumbers(extraction);
  if (printed.length === 0) return null;

  const ours = normalizeInvoiceNumber(poNumber);
  if (!ours) return null;
  if (printed.some((n) => normalizeInvoiceNumber(n) === ours)) return null;

  return printed;
}

/**
 * Words that say nothing about WHICH company this is.
 *
 * Legal forms, the trade the vendor is in, and the filler between. Dropping
 * them is what lets "Dawn Foods" and "Dawn Food Products, Inc." be recognised
 * as the same house while keeping "Unified Paper" and a hypothetical "Smart
 * Paper Co" apart — without this list they would share `paper` and the check
 * would stay quiet on a real mis-filing.
 *
 * Measured against the seven vendors whose invoices are on file; add to it when
 * a real pair asks, never speculatively.
 */
const VENDOR_NOISE = new Set([
  "the", "and", "of", "a",
  "inc", "incorporated", "llc", "llp", "ltd", "limited", "co", "corp",
  "corporation", "company", "usa", "us",
  "food", "foods", "foodservice", "foodservices", "paper", "packaging",
  "products", "product", "supply", "supplies", "distributing", "distributors",
  "distribution", "wholesale", "service", "services", "brands", "group",
]);

/**
 * The distinctive words in a company's name — lowercased, stripped of
 * punctuation, plurals folded, and with `VENDOR_NOISE` removed.
 *
 * The plural fold is the SKU matcher's lesson arriving here: "Coconut Flakes"
 * against "COCONUT FLAKE SWEET" cost that join a match, and "Dawn Foods"
 * against "Dawn Food Products" is the same single letter. It is a trailing `s`
 * and nothing cleverer — a stemmer would turn "Vesta" into "Vest".
 */
function vendorWords(name: string | null): Set<string> {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !VENDOR_NOISE.has(w));
  return new Set(words);
}

/**
 * The vendor this invoice says it is from, when that cannot be the vendor whose
 * order you are standing in front of — or null when there is nothing to say.
 *
 * It exists because of one real record. A Dawn Foods invoice was attached to a
 * Vesta Foodservice order, and the filer takes the vendor from the ORDER and
 * never from the page, so $1,985.99 of Dawn's bill sat on the books under Vesta
 * — a duplicate no number-based check could ever catch, because it was filed
 * under a vendor the real invoice has nothing to do with.
 *
 * IT WARNS ONLY WHEN THE TWO NAMES SHARE NOTHING, and that threshold is a
 * measurement rather than a preference. Over the 49 readings on file, only
 * three of twelve distinct pairs match as text: our catalog carries the name
 * staff say and the invoice prints the name lawyers use.
 *
 *     BakeMark              BAKEMARK USA LLC
 *     Chefs Warehouse       The Chefs' Warehouse West Coast, LLC
 *     Cook's Vanilla        Cook Flavoring Company
 *     Dawn Foods            Dawn Food Products, Inc.
 *     Stumptown             Stumptown Coffee Roasters
 *     Unified Paper         Unified Paper & Packaging
 *     Vesta Foodservice     VESTA FOODSERVICE
 *
 * Anything stricter than "shares nothing" flags nine of those twelve, which is
 * the failure `printedPoDisagreement` already names: the vendors whose paperwork
 * is merely built differently flag every delivery, and the mark stops meaning
 * anything where it matters. All seven stay silent here; Vesta against Dawn
 * shares no distinctive word and speaks up.
 *
 * SILENCE WHERE IT CANNOT JUDGE, which is two more cases: a reading with no
 * vendor name at all, and a name that reduces to nothing but noise words. An
 * absent answer is not a disagreement.
 *
 * What comes back is what is PRINTED, not the normalized form — the reader is
 * checking a document against a screen.
 */
export function printedVendorDisagreement(
  extraction: InvoiceExtraction,
  ourVendorName: string | null
): string | null {
  const printed = extraction.vendor_name?.trim();
  if (!printed) return null;

  const theirs = vendorWords(printed);
  const ours = vendorWords(ourVendorName);
  if (theirs.size === 0 || ours.size === 0) return null;

  for (const word of ours) if (theirs.has(word)) return null;
  return printed;
}

/**
 * The purchase order a printed number refers to — but only when exactly ONE
 * candidate answers to it.
 *
 * The refusals are the feature. A printed number is one OCR digit away from
 * someone else's order, so a second match, a different vendor or another
 * location all mean "don't link this" — the same uniqueness discipline the SKU
 * join already applies one level down. Nothing here writes; it proposes.
 */
export function matchPrintedPoNumber(
  printed: string | null,
  candidates: {
    id: string;
    po_number: string;
    vendor_id: string;
    location_id: string;
  }[],
  scope: { vendor_id: string; location_id: string }
): { id: string; po_number: string } | null {
  const wanted = normalizeInvoiceNumber(printed);
  if (!wanted) return null;

  const hits = candidates.filter(
    (c) =>
      c.vendor_id === scope.vendor_id &&
      c.location_id === scope.location_id &&
      normalizeInvoiceNumber(c.po_number) === wanted
  );
  if (hits.length !== 1) return null;
  return { id: hits[0].id, po_number: hits[0].po_number };
}

// ---------------------------------------------------------------------------

/** Money, matching lib/purchaseOrders' formatting exactly. */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Where a bill has got to — our acts, then QuickBooks'
// ---------------------------------------------------------------------------

/**
 * Open → Approved → Submitted → Paid, with `void` off to the side (Mark,
 * 2026-09-02: "the status should be 'Submitted' as in Submitted for payment.
 * When it's paid, the status should be 'Paid'").
 *
 * SUBMITTED AND PAID ARE DERIVED, NEVER STORED. `external_ref.qbo.id` already
 * says a bill is on the books and `qbo_balance` says what is left on it; a
 * status column repeating either would be two answers to one question, which
 * is the thing this schema keeps refusing (051's biconditional, 016's
 * `nextDeliveryDate`). `invoices.status` stays open/approved/void.
 *
 * THE FIRST TWO ARE OURS AND THE LAST TWO ARE NOT, and that is the distinction
 * the colours cannot carry. Open and Approved are acts we performed and are
 * always current. Submitted is true the moment a link exists. **Paid is a fact
 * we last HEARD**, so it may never be shown without `qbo_checked_at` beside it
 * — see `billPaymentNote`, and 088's header for why that pairing is what makes
 * storing the balance honest at all.
 *
 * "SUBMITTED" MEANS ON THE BOOKS, NOT SENT FOR PAYMENT. Nothing here can tell
 * QuickBooks to pay anybody: Bill Pay is a QBO interface feature and the
 * Accounting API records a payment rather than initiating one. During the
 * Bill.com parallel run it is usually Bill.com that put it there, which the
 * word still covers.
 *
 * PART-PAID IS NOT A FIFTH RUNG. A bill with something still on it reads
 * Submitted, and the note says what is owed — a number is more use than another
 * word. `void` is an exit rather than a rung, like `cancelled` on a special
 * order.
 */
export type BillStage = "open" | "approved" | "submitted" | "paid" | "void";

export const BILL_STAGE_ORDER: BillStage[] = [
  "open",
  "approved",
  "submitted",
  "paid",
  "void",
];

export const BILL_STAGE_LABEL: Record<BillStage, string> = {
  open: "Open",
  approved: "Approved",
  submitted: "Submitted",
  paid: "Paid",
  void: "Void",
};

/**
 * Yellow and green keep the meanings this list already gave them; the two new
 * rungs continue the purchase order ladder rather than inventing a vocabulary.
 * Submitted takes `closed`'s white-on-ink — definite, and nothing outstanding
 * from us — and Paid takes the same green as Approved a shade stronger, which
 * says "further along the same axis" and not "a different kind of thing".
 */
export const BILL_STAGE_CLASS: Record<BillStage, string> = {
  open: "border border-ink bg-[var(--rf-yellow-200)] text-ink",
  approved: "border border-ink bg-[var(--rf-green-200)] text-ink",
  submitted: "border border-ink bg-white text-ink",
  paid: "border border-ink bg-[var(--rf-green-300)] text-ink",
  void: "border border-neutral-300 bg-white text-faint",
};

/** Everything the stage is read from. Plain fields rather than the QuickBooks
 *  types, so `lib/invoices` stays free of that module and the fixtures can
 *  build a case in one line. */
export type BillStageInput = {
  status: InvoiceStatus;
  /** Whether a QuickBooks document is linked — `external_ref.qbo.id`. */
  linked: boolean;
  /** 088's cache. Null means either nobody asked or QuickBooks no longer has
   *  it; `checkedAt` is what tells those apart. */
  qbo_balance: number | null;
  qbo_checked_at: string | null;
};

export function billStage(invoice: BillStageInput): BillStage {
  // Void first: it is an exit from the ladder, not a position on it, and a
  // voided bill that happens to carry a link must not read as Submitted.
  if (invoice.status === "void") return "void";
  if (!invoice.linked) return invoice.status === "approved" ? "approved" : "open";
  // Zero is the only balance that means paid, and it must be a NUMBER — null
  // here is "not asked" or "no longer there", neither of which is paid.
  if (invoice.qbo_balance !== null && invoice.qbo_balance <= 0.005) return "paid";
  return "submitted";
}

/**
 * What QuickBooks last said, and when — the sentence that must accompany any
 * claim about payment.
 *
 * Null when there is nothing to report, so a bill nobody has asked about says
 * nothing rather than implying it was checked and found unpaid.
 */
export function billPaymentNote(
  invoice: BillStageInput,
  money: (n: number) => string
): string | null {
  if (!invoice.linked || !invoice.qbo_checked_at) return null;
  const when = invoice.qbo_checked_at.slice(0, 10);
  // Checked, and the document is not there. The one answer that needs an act
  // rather than a figure — the bill can neither be updated nor sent until the
  // link is forgotten.
  if (invoice.qbo_balance === null) return `no longer in QuickBooks · as of ${when}`;
  if (invoice.qbo_balance <= 0.005) return `paid · as of ${when}`;
  return `${money(invoice.qbo_balance)} owed · as of ${when}`;
}

/**
 * Has this bill's money changed since it was last sent to QuickBooks?
 *
 * 089's whole point: `financials_touched_at` is bumped ONLY by the LOCKED
 * columns, never by a notes or terms edit, so this can't false-alarm on a
 * typo fixed while the invoice happened to be open. Both sides are needed —
 * nothing pushed yet (`synced_at` null) is not stale, and nothing edited
 * since creation (`financials_touched_at` null) is not stale either, however
 * long ago the push was.
 */
export function pushIsStale(
  invoice: Pick<VendorInvoice, "synced_at" | "financials_touched_at">
): boolean {
  if (!invoice.synced_at || !invoice.financials_touched_at) return false;
  return (
    new Date(invoice.financials_touched_at).getTime() >
    new Date(invoice.synced_at).getTime()
  );
}

// ---------------------------------------------------------------------------
// The arithmetic, computed rather than typed
// ---------------------------------------------------------------------------

/**
 * A line's own money: what was billed times what it cost.
 *
 * ONLY WHERE THE PAGE'S OWN ARITHMETIC IS THIS ARITHMETIC, which on a food
 * distributor's invoice is not always. Chefs Warehouse 73358289 bills BROKEN
 * CASES — pack `24/1 LB BC` — printing the CASE price as the unit price and
 * charging for eaches: 7 units of a $62.68 case is $18.28, not $438.76.
 * Computing that invoice from qty × unit_price turns $472.13 into $1,952.90,
 * measured, on a bill already approved.
 *
 * So this is the SIMPLE case only, and `rescaledExtended` is what a quantity
 * edit actually goes through. Null when either half is missing — a struck line
 * with no price has no extended, and 0 would be a claim rather than an absence.
 */
export function lineExtended(
  qty: number | null | undefined,
  unitPrice: number | null | undefined
): number | null {
  if (qty === null || qty === undefined) return null;
  if (unitPrice === null || unitPrice === undefined) return null;
  return Math.round(Number(qty) * Number(unitPrice) * 100) / 100;
}

/**
 * What a line's charge becomes when its quantity or price moves.
 *
 * IT SCALES BY THE LINE'S OWN RATE, not by the printed unit price — which is
 * what makes it right on a broken case as well as an ordinary line. The rate a
 * line was really billed at is `extended ÷ qty`, whatever the page printed
 * beside it, so seven units at $18.28 rescale to fourteen at $36.56 and a
 * struck line at 2 × $88.90 rescales to 0 × anything = $0.00.
 *
 * The same reasoning receiving already uses: its price derivation is
 * `extended ÷ qty` precisely because it "survived catch-weight lines".
 *
 * Falls back to qty × unit_price only when there is no prior charge to scale —
 * a line somebody is typing from nothing — and returns null when there is
 * neither, because 0 would be a claim that the line was free.
 */
export function rescaledExtended(
  line: Pick<VendorInvoiceLine, "qty" | "unit_price" | "extended">,
  next: { qty?: number | null; unit_price?: number | null }
): number | null {
  const qty = next.qty !== undefined ? next.qty : line.qty;
  const price = next.unit_price !== undefined ? next.unit_price : line.unit_price;

  const hadQty = line.qty !== null && line.qty !== undefined && Number(line.qty) !== 0;
  const hadExtended = line.extended !== null && line.extended !== undefined;

  if (hadQty && hadExtended && qty !== null && qty !== undefined) {
    const rate = Number(line.extended) / Number(line.qty);
    // A price edit moves the charge in proportion, which keeps a broken case a
    // broken case: the ratio the vendor billed at is preserved.
    const priceRatio =
      next.unit_price !== undefined &&
      line.unit_price !== null &&
      line.unit_price !== undefined &&
      Number(line.unit_price) !== 0 &&
      price !== null &&
      price !== undefined
        ? Number(price) / Number(line.unit_price)
        : 1;
    return Math.round(Number(qty) * rate * priceRatio * 100) / 100;
  }
  return lineExtended(qty, price);
}

export type ComputedAmounts = {
  /** The item lines' own sum, or null when there are no lines to sum. */
  subtotal: number | null;
  /** Subtotal plus the charges, or null when there is nothing to compute from. */
  total: number | null;
};

/**
 * What the invoice comes to, from its lines and its charges.
 *
 * ITEM LINES ONLY for the subtotal, and the exclusion is the same one
 * `lineSumReconciliation` makes: a freight LINE and the header `freight` are one
 * charge printed twice, so counting both doubles it.
 *
 * NULL WHEN THERE ARE NO LINES, which is the rent bill and every other
 * hand-typed one-line bill. Those keep their typed total — computing 0 for them
 * would replace a real figure with a claim that nothing is owed, and they are
 * precisely the invoices this module exists to carry.
 */
export function computedAmounts(
  lines: Pick<VendorInvoiceLine, "qty" | "unit_price" | "extended" | "kind">[],
  charges: Pick<VendorInvoice, "tax" | "freight" | "other_charges">
): ComputedAmounts {
  const items = lines.filter((l) => l.kind === "item");
  if (lines.length === 0) return { subtotal: null, total: null };

  const subtotal =
    Math.round(
      // THE LINE'S OWN CHARGE, which is what it was billed — not qty × price,
      // which is wrong on every broken case (see `lineExtended`). A line
      // carrying no charge at all contributes nothing rather than a guess.
      items.reduce((sum, l) => sum + Number(l.extended ?? 0), 0) * 100
    ) / 100;

  // Charge LINES are money billed too, and they are not in the subtotal — a
  // freight line and the header `freight` are one charge printed twice, so
  // whichever the reader found is counted once here.
  const chargeLines = lines
    .filter((l) => l.kind !== "item")
    .reduce((sum, l) => sum + Number(l.extended ?? 0), 0);

  const total =
    Math.round(
      (subtotal +
        chargeLines +
        Number(charges.tax ?? 0) +
        Number(charges.freight ?? 0) +
        Number(charges.other_charges ?? 0)) *
        100
    ) / 100;
  return { subtotal, total };
}

/**
 * What to say at APPROVAL when our arithmetic and the page disagree.
 *
 * This is where the transcription's job moved to (Mark, 2026-09-02: "If it's
 * off, we should be warned when 'approving' and allowed to cancel and edit").
 * It is the right moment for it: approving is when somebody says the bill is
 * payable, and a difference nobody has looked at is exactly what that decision
 * should not pass over silently.
 *
 * `printed` is what the DOCUMENT said — the reading's own total, or the
 * handwritten correction where a driver left one — never our own column, which
 * is now computed and would always agree with itself.
 */
export function totalDisagreesWithDocument(
  computed: number | null,
  printed: number | null | undefined
): string | null {
  if (computed === null || printed === null || printed === undefined) return null;
  if (Math.abs(computed - Number(printed)) <= MONEY_EPSILON) return null;
  return (
    `The lines come to $${computed.toFixed(2)}, where the invoice says ` +
    `$${Number(printed).toFixed(2)}`
  );
}
