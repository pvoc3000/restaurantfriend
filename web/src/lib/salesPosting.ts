/**
 * A SHOP-DAY'S SQUARE SALES AS ONE QUICKBOOKS JOURNAL ENTRY — the rule, pure.
 *
 * This replaces Shogo (Mark, 2026-09-16). Shogo kept a mapping grid PER SHOP
 * over hundreds of Square names and stopped silently on the first it had not
 * seen. This keeps ONE grid for the org — about ten fixed ROLES plus a row per
 * Square category and tender the sync has seen — and an unknown name never
 * stops a post: it lands on its kind's default and is NAMED on the receipt.
 *
 * Pure and fixture-tested, so `qbo-sync`'s `post_daily_sales` VALIDATES what
 * this built rather than rebuilding it (`freeze_pay_period`'s shape, and
 * `buildBillPayload`'s). No Supabase import, or the fixture build breaks.
 *
 * MONEY IS INTEGER CENTS UNTIL THE PAYLOAD EDGE, and the entry must balance to
 * the cent with NO PLUG LINE EVER — a day that does not balance is refused
 * naming both sides, because a plug is how a book stops meaning anything.
 *
 * The identity the balance rests on was MEASURED over sixty days of both shops
 * and every tender type (2026-09-17, see `sync-square-sales`):
 *
 *   Σ categories + Σ service charges + tax + tips + gift cards sold
 *     = Σ tenders + discounts
 *
 * with fees inside the card tender (card net of fee + fee = card gross).
 */

import { DOC_NUMBER_MAX, type QboRefValue } from "./quickbooks";

// ---------------------------------------------------------------------------
// What the sync stores (migration 104's `daily_sales.breakdown`)
// ---------------------------------------------------------------------------

export type BreakdownKind =
  | "category"
  | "service_charge"
  | "discount"
  | "tax"
  | "tip"
  | "gift_card_sale"
  | "tender"
  | "fee";

export type BreakdownLine = {
  kind: BreakdownKind;
  /** A category NAME, a tender key (`CARD`, `CASH`, `SQUARE_GIFT_CARD`,
   *  `OTHER:UBEREATS`), or a fixed key for the singletons. */
  key: string;
  name: string;
  /** SIGNED THE WAY THE MONEY MOVES for the kind: a category is gross net of
   *  returns (negative on a day of net returns), a tender is payments minus
   *  refunds, discounts and fees are positive magnitudes. */
  cents: number;
};

export type SalesBreakdown = {
  v: 1;
  pulled_at: string;
  /** Set by the sync when a cell could not be read. The builder refuses it. */
  incomplete?: boolean;
  lines: BreakdownLine[];
  totals: {
    net_sales_cents: number;
    top_line_cents: number;
    itemized_returns_cents: number;
    refunds_by_amount_cents: number;
    total_collected_cents: number;
  };
};

// ---------------------------------------------------------------------------
// The roles — the fixed slots every entry needs
// ---------------------------------------------------------------------------

export type SalesRole =
  | "uncategorized_income"
  | "discounts"
  | "service_charges"
  | "tax"
  | "tips"
  | "gift_cards"
  | "card"
  | "cash"
  | "other_tender"
  | "fees"
  | "bank";

/** QuickBooks' own `Classification` words — income accounts are `Revenue`
 *  there, measured on the real chart (304 accounts, 2026-09-17). */
export type AccountClassification = "Revenue" | "Liability" | "Asset" | "Expense";

/**
 * In the order the grid lists them: the income side first, then what is owed,
 * then where the money went. `classification` narrows the account picker; it
 * is a HINT for the picker and never a refusal — a shop that keeps its tips in
 * an income account is a shop, not an error.
 */
export const SALES_ROLES: {
  key: SalesRole;
  label: string;
  hint: string;
  classification: AccountClassification;
}[] = [
  { key: "uncategorized_income", label: "Unmapped categories", hint: "where a Square category with no mapping posts (credit)", classification: "Revenue" },
  { key: "discounts", label: "Discounts and comps", hint: "the day's discounts, as a debit against income", classification: "Revenue" },
  { key: "service_charges", label: "Service charges", hint: "delivery fees and courier tips collected with an order (credit)", classification: "Revenue" },
  { key: "tax", label: "Sales tax collected", hint: "one line, every tax Square collected that day (credit)", classification: "Liability" },
  { key: "tips", label: "Tips", hint: "what customers tipped through Square (credit)", classification: "Liability" },
  { key: "gift_cards", label: "Gift cards", hint: "sold is a credit, redeemed is a debit — never income", classification: "Liability" },
  { key: "card", label: "Card takings", hint: "card payments net of Square's fee (debit)", classification: "Asset" },
  { key: "cash", label: "Cash takings", hint: "cash payments net of cash refunds (debit)", classification: "Asset" },
  { key: "other_tender", label: "Unmapped tenders", hint: "where a tender with no mapping posts — Uber Eats, DoorDash, Afterpay (debit)", classification: "Asset" },
  { key: "fees", label: "Square fees", hint: "processing fees, posted daily (debit)", classification: "Expense" },
  { key: "bank", label: "Bank account for payouts", hint: "where a Square payout lands — the Deposit is made into this account (105)", classification: "Asset" },
];

export const SALES_ROLE_LABEL: Record<SalesRole, string> = Object.fromEntries(
  SALES_ROLES.map((r) => [r.key, r.label])
) as Record<SalesRole, string>;

/** Which role an UNMAPPED category or tender falls to. */
export const DEFAULT_ROLE_FOR: Record<"category" | "tender", SalesRole> = {
  category: "uncategorized_income",
  tender: "other_tender",
};

/** Tenders with a fixed home, whatever the grid says. */
const TENDER_ROLE: Record<string, SalesRole> = {
  CARD: "card",
  CASH: "cash",
  SQUARE_GIFT_CARD: "gift_cards",
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One row of `accounting_sales_mappings`. */
export type SalesMapping = {
  kind: "role" | "category" | "tender";
  square_key: string;
  square_name: string | null;
  account_ref: string | null;
  account_name: string | null;
};

/** The shop, as `locations` carries it after 104. */
export type PostingShop = {
  code: string;
  qbo_class_ref: string | null;
  qbo_class_name: string | null;
  qbo_location_ref: string | null;
  qbo_location_name: string | null;
};

/** What a posted day carries in `external_ref.qbo`. */
export type SalesPostingRef = {
  qbo?: {
    id?: string;
    sync_token?: string;
    doc_number?: string | null;
    entity?: "JournalEntry";
    journal_hash?: string;
    breakdown_hash?: string;
  };
};

export type BuildInput = {
  breakdown: SalesBreakdown | null;
  /** `orgs.name`, which closes the memo (Mark, 2026-09-24). Not hashed. */
  orgName?: string;
  mappings: readonly SalesMapping[];
  shop: PostingShop;
  businessDate: string;
  /** `daily_sales.net_sales_cents` — the payroll figure, which somebody may
   *  have corrected by hand. The entry follows the BREAKDOWN (it has to
   *  balance to Square's tenders); a disagreement is a warning. */
  netSalesCents: number;
  tipsCents: number;
  /** The row's current ref, so a repost is an UPDATE of the same entry. */
  existing: SalesPostingRef | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type JournalLine = {
  posting: "Debit" | "Credit";
  /** Always positive: QuickBooks refuses a negative amount, so a category in
   *  net return flips to a debit rather than carrying a minus sign. */
  cents: number;
  account: QboRefValue;
  description: string;
  /** Where the line came from, for the receipt and the diff. */
  source: { kind: BreakdownKind; key: string };
};

export type Unmapped = {
  kind: "category" | "tender";
  key: string;
  name: string;
  cents: number;
  role: SalesRole;
};

export type QboJournalEntry = {
  Id?: string;
  SyncToken?: string;
  sparse?: boolean;
  DocNumber: string;
  TxnDate: string;
  PrivateNote: string;
  Line: {
    DetailType: "JournalEntryLineDetail";
    Amount: number;
    Description: string;
    JournalEntryLineDetail: {
      PostingType: "Debit" | "Credit";
      AccountRef: { value: string; name?: string };
      ClassRef?: { value: string; name?: string };
      DepartmentRef?: { value: string; name?: string };
    };
  }[];
};

export type JournalBuild =
  | {
      ok: true;
      mode: "create" | "update";
      docNumber: string;
      lines: JournalLine[];
      debits: number;
      credits: number;
      unmapped: Unmapped[];
      warnings: string[];
      /** Of the lines, DocNumber and date — what `post_daily_sales` compares
       *  against the stored `journal_hash` to skip an unchanged day. */
      hash: string;
      body: QboJournalEntry;
    }
  | { ok: false; refusals: string[] };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** `DF01-2026-09-15`. Refuses, never truncates: a cut DocNumber is a duplicate
 *  waiting to happen. */
export function docNumberForDay(shopCode: string, businessDate: string): { ok: true; value: string } | { ok: false; reason: string } {
  const value = `${shopCode.trim()}-${businessDate}`;
  if (value.length > DOC_NUMBER_MAX) {
    return {
      ok: false,
      reason: `The document number ${value} is ${value.length} characters and QuickBooks allows ${DOC_NUMBER_MAX}.`,
    };
  }
  return { ok: true, value };
}

/** Our own DocNumbers, so Shogo's entries can be told from ours. */
export function isOurDocNumber(docNumber: string | null | undefined, shopCodes: readonly string[]): boolean {
  if (!docNumber) return false;
  const m = /^([A-Za-z0-9]+)-(\d{4}-\d{2}-\d{2})$/.exec(docNumber.trim());
  return Boolean(m && shopCodes.includes(m[1]));
}

export function roleAccount(mappings: readonly SalesMapping[], role: SalesRole): QboRefValue | null {
  const m = mappings.find((x) => x.kind === "role" && x.square_key === role);
  const ref = m?.account_ref?.trim();
  return ref ? { ref, name: m?.account_name?.trim() || null } : null;
}

function mappedAccount(
  mappings: readonly SalesMapping[],
  kind: "category" | "tender",
  key: string
): QboRefValue | null {
  const m = mappings.find((x) => x.kind === kind && x.square_key === key);
  const ref = m?.account_ref?.trim();
  return ref ? { ref, name: m?.account_name?.trim() || null } : null;
}

/** Which role a tender falls to when the grid has nothing for it. */
export function tenderRole(key: string): SalesRole {
  return TENDER_ROLE[key] ?? DEFAULT_ROLE_FOR.tender;
}

/** Cents → the number QuickBooks wants. Only ever called at the payload edge. */
export function centsToAmount(cents: number): number {
  return Number((Math.abs(cents) / 100).toFixed(2));
}

/**
 * A stable hash of what would be sent. FNV-1a over the canonical JSON — no
 * crypto here because this module runs in the fixture build too, and a
 * collision between two versions of one day's entry is not a risk worth a
 * dependency. Its job is "did anything change", not secrecy.
 */
export function journalHash(input: { docNumber: string; txnDate: string; lines: readonly JournalLine[] }): string {
  const canonical = JSON.stringify({
    d: input.docNumber,
    t: input.txnDate,
    l: input.lines.map((l) => [l.posting, l.cents, l.account.ref, l.source.kind, l.source.key]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Two passes over the string with different seeds make 64 bits of it.
  let g = 0x9747b28c;
  for (let i = canonical.length - 1; i >= 0; i--) {
    g ^= canonical.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + g.toString(16).padStart(8, "0");
}

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * One journal entry for one shop-day, or the reasons there cannot be one.
 *
 * The rules, each pinned by a fixture:
 *   · no breakdown, or an incomplete one → refused (sync again);
 *   · the shop lacks a Class or a Location → refused (both are stamped on
 *     every line; Mark: "keep class and location");
 *   · a category posts to its mapping, else to the unmapped-categories role,
 *     and is RECORDED as unmapped; a tender likewise, except CARD, CASH and
 *     SQUARE_GIFT_CARD, which have fixed homes;
 *   · a category or service charge in net return is a DEBIT of the magnitude,
 *     never a negative credit;
 *   · CARD's debit is net of its fee; every fee debits the fees role;
 *   · a role with no account, needed by a non-zero line → refused BY NAME;
 *   · debits ≠ credits → refused naming both sides — no plug, ever;
 *   · nothing to post → refused;
 *   · the day's net figure disagreeing with the breakdown → a warning.
 */
export function buildJournalEntry(input: BuildInput): JournalBuild {
  const { breakdown, mappings, shop, businessDate, existing } = input;
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (!breakdown) {
    return { ok: false, refusals: ["No breakdown has been pulled for this day — sync from Square again."] };
  }
  if (breakdown.incomplete) {
    return {
      ok: false,
      refusals: ["The breakdown for this day is incomplete (a figure could not be read) — sync from Square again and read its warnings."],
    };
  }

  const klass = shop.qbo_class_ref?.trim() ? { value: shop.qbo_class_ref.trim(), ...(shop.qbo_class_name ? { name: shop.qbo_class_name } : {}) } : null;
  const dept = shop.qbo_location_ref?.trim() ? { value: shop.qbo_location_ref.trim(), ...(shop.qbo_location_name ? { name: shop.qbo_location_name } : {}) } : null;
  if (!klass) refusals.push(`${shop.code} has no QuickBooks class — set it on the location's record.`);
  if (!dept) refusals.push(`${shop.code} has no QuickBooks location — set it on the location's record.`);

  const doc = docNumberForDay(shop.code, businessDate);
  if (!doc.ok) refusals.push(doc.reason);

  const lines: JournalLine[] = [];
  const unmapped: Unmapped[] = [];
  const missingRoles = new Set<SalesRole>();

  const need = (role: SalesRole): QboRefValue | null => {
    const acct = roleAccount(mappings, role);
    if (!acct) missingRoles.add(role);
    return acct;
  };
  const push = (
    posting: "Debit" | "Credit",
    cents: number,
    account: QboRefValue | null,
    description: string,
    source: JournalLine["source"]
  ) => {
    if (cents === 0 || !account) return;
    // A negative amount flips the side rather than carrying a sign.
    const side: "Debit" | "Credit" = cents > 0 ? posting : posting === "Debit" ? "Credit" : "Debit";
    lines.push({ posting: side, cents: Math.abs(cents), account, description, source });
  };

  // EVERY FEE NETS AGAINST THE CARD LINE, whatever tender the sync keyed it
  // to. Square takes all of its fees out of the card PAYOUT — the gift-card
  // load fee on a card bought with cash included — so the cash in the drawer
  // is the full amount and the money Square sends is the card takings less
  // every fee. Measured (2026-09-17, 18 shop-days): keyed this way the card
  // line agrees with the payout for that day's charges to within cents, and
  // keyed per tender it was short by the whole load fee on every such day —
  // which is the residual that would have kept Undeposited Square Funds from
  // ever clearing against the deposits (105).
  let feesTotal = 0;
  for (const l of breakdown.lines) if (l.kind === "fee") feesTotal += l.cents;

  let categoriesCents = 0;
  let serviceCents = 0;
  let discountCents = 0;
  let tipCents = 0;
  let feesCents = 0;
  let sawCard = false;

  for (const l of breakdown.lines) {
    switch (l.kind) {
      case "category": {
        categoriesCents += l.cents;
        const mapped = mappedAccount(mappings, "category", l.key);
        const account = mapped ?? need(DEFAULT_ROLE_FOR.category);
        if (!mapped && l.cents !== 0) {
          unmapped.push({ kind: "category", key: l.key, name: l.name, cents: l.cents, role: DEFAULT_ROLE_FOR.category });
        }
        push("Credit", l.cents, account, l.name, { kind: l.kind, key: l.key });
        break;
      }
      case "service_charge": {
        serviceCents += l.cents;
        push("Credit", l.cents, need("service_charges"), `Service charge · ${l.name}`, { kind: l.kind, key: l.key });
        break;
      }
      case "discount": {
        discountCents += l.cents;
        push("Debit", l.cents, need("discounts"), "Discounts and comps", { kind: l.kind, key: l.key });
        break;
      }
      case "tax":
        push("Credit", l.cents, need("tax"), "Sales tax collected", { kind: l.kind, key: l.key });
        break;
      case "tip":
        tipCents += l.cents;
        push("Credit", l.cents, need("tips"), "Tips", { kind: l.kind, key: l.key });
        break;
      case "gift_card_sale":
        push("Credit", l.cents, need("gift_cards"), "Gift cards sold", { kind: l.kind, key: l.key });
        break;
      case "tender": {
        const fixed = TENDER_ROLE[l.key];
        const mapped = fixed ? null : mappedAccount(mappings, "tender", l.key);
        const role = fixed ?? DEFAULT_ROLE_FOR.tender;
        const account = mapped ?? need(role);
        if (!fixed && !mapped && l.cents !== 0) {
          unmapped.push({ kind: "tender", key: l.key, name: l.name, cents: l.cents, role });
        }
        const fee = l.key === "CARD" ? feesTotal : 0;
        if (l.key === "CARD") sawCard = true;
        const net = l.cents - fee;
        const description =
          l.key === "CARD"
            ? fee ? "Card takings, net of fees" : "Card takings"
            : l.key === "CASH"
              ? "Cash takings"
              : l.key === "SQUARE_GIFT_CARD"
                ? "Gift cards redeemed"
                : `${l.name} takings${fee ? ", net of fees" : ""}`;
        push("Debit", net, account, description, { kind: l.kind, key: l.key });
        break;
      }
      case "fee":
        feesCents += l.cents;
        break;
    }
  }
  // Every fee, one line — and a day with fees and no card payment at all
  // (a refund fee on a quiet day) still has them taken out of the payout,
  // so the card line carries the negative and flips to a credit.
  if (!sawCard && feesTotal !== 0) {
    push("Debit", -feesTotal, need("card"), "Square fees taken from the payout", { kind: "tender", key: "CARD" });
  }
  push("Debit", feesCents, feesCents ? need("fees") : null, "Square fees", { kind: "fee", key: "fees" });

  for (const role of missingRoles) {
    refusals.push(`No account is set for “${SALES_ROLE_LABEL[role]}” — Settings → Accounting → Sales from Square.`);
  }

  if (lines.length === 0 && refusals.length === 0) {
    refusals.push("Nothing to post: the breakdown has no lines.");
  }

  const debits = lines.filter((l) => l.posting === "Debit").reduce((a, l) => a + l.cents, 0);
  const credits = lines.filter((l) => l.posting === "Credit").reduce((a, l) => a + l.cents, 0);
  if (refusals.length === 0 && debits !== credits) {
    refusals.push(
      `The day does not balance: debits ${money(debits)} against credits ${money(credits)} ` +
        `(${money(debits - credits)} apart). Nothing is posted until Square's figures agree with themselves — sync again, and if it persists, this day needs a look.`
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // The payroll figure against the breakdown's own arithmetic. They disagree
  // when somebody corrected the day by hand (065) — which is allowed, and
  // which the entry deliberately does not follow, because the entry has to
  // balance to what Square collected.
  const breakdownNet = categoriesCents + serviceCents - discountCents;
  if (breakdownNet !== input.netSalesCents) {
    warnings.push(
      `This day's net sales figure (${money(input.netSalesCents)}) disagrees with its breakdown (${money(breakdownNet)}); the entry follows the breakdown.`
    );
  }
  if (tipCents !== input.tipsCents) {
    warnings.push(
      `This day's tips figure (${money(input.tipsCents)}) disagrees with its breakdown (${money(tipCents)}); the entry follows the breakdown.`
    );
  }
  if (breakdown.totals.refunds_by_amount_cents) {
    warnings.push(
      `${money(-breakdown.totals.refunds_by_amount_cents)} was refunded by amount rather than by item; Square reports it as a return on the Uncategorized category, which is where it posts.`
    );
  }

  const docNumber = (doc as { ok: true; value: string }).value;
  const hash = journalHash({ docNumber, txnDate: businessDate, lines });
  const id = existing?.qbo?.id?.trim();
  const syncToken = existing?.qbo?.sync_token?.trim();
  const mode: "create" | "update" = id && syncToken ? "update" : "create";

  const body: QboJournalEntry = {
    ...(mode === "update" ? { Id: id, SyncToken: syncToken, sparse: false } : {}),
    DocNumber: docNumber,
    TxnDate: businessDate,
    PrivateNote: `Square sales · ${shop.code} · ${businessDate} · pulled ${breakdown.pulled_at.slice(0, 16).replace("T", " ")}${orgTail(input.orgName)}`,
    Line: lines.map((l) => ({
      DetailType: "JournalEntryLineDetail" as const,
      Amount: centsToAmount(l.cents),
      Description: l.description,
      JournalEntryLineDetail: {
        PostingType: l.posting,
        AccountRef: { value: l.account.ref, ...(l.account.name ? { name: l.account.name } : {}) },
        // ON EVERY LINE. A JournalEntry has no header DepartmentRef, unlike a
        // Bill, so both refs ride each line; the server compares what
        // QuickBooks kept against what was sent.
        ClassRef: klass!,
        DepartmentRef: dept!,
      },
    })),
  };

  return { ok: true, mode, docNumber, lines, debits, credits, unmapped, warnings, hash, body };
}

// ---------------------------------------------------------------------------
// The state of a day, for the Sales screen
// ---------------------------------------------------------------------------

export type PostingState = "unposted" | "posted" | "stale" | "failed";

/**
 * `failed` outranks the rest: a day that reached QuickBooks last week and was
 * refused this morning is a day somebody has to look at. `stale` means the
 * breakdown has been pulled again and differs from what was posted.
 */
export function postingState(row: {
  external_ref: SalesPostingRef | null;
  breakdown_hash: string | null;
  post_error: string | null;
}): PostingState {
  if (row.post_error) return "failed";
  const qbo = row.external_ref?.qbo;
  if (!qbo?.id) return "unposted";
  if (row.breakdown_hash && qbo.breakdown_hash && qbo.breakdown_hash !== row.breakdown_hash) return "stale";
  return "posted";
}

export function postingLabel(state: PostingState, ref: SalesPostingRef | null): string {
  switch (state) {
    case "unposted":
      return "—";
    case "failed":
      return "failed";
    case "stale":
      return "pulled again";
    case "posted":
      return ref?.qbo?.doc_number ?? "posted";
  }
}

// ---------------------------------------------------------------------------
// The parallel run against Shogo
// ---------------------------------------------------------------------------

/** One line of a QuickBooks journal entry, as `find_journal_entries` flattens it. */
export type FlatJournalLine = {
  entry_id: string;
  doc_number: string | null;
  txn_date: string;
  posting: "Debit" | "Credit";
  amount: number;
  account_ref: string | null;
  account_name: string | null;
  class_name: string | null;
  department_name: string | null;
  description: string | null;
};

export type ShogoDiffRow = {
  account: string;
  /** Signed cents: a credit is positive, a debit negative. */
  ours: number;
  theirs: number;
  delta: number;
};

function signed(posting: "Debit" | "Credit", cents: number): number {
  return posting === "Credit" ? cents : -cents;
}

/**
 * Per account, what we would post against what Shogo posted for the same
 * shop-day. Keyed by ACCOUNT NAME, since that is what both sides carry and
 * what a reader recognises; a name Shogo used that we did not (Refunds,
 * Third Party Fees) shows up as ours = 0.
 */
export function diffAgainstShogo(
  ours: readonly JournalLine[],
  theirs: readonly FlatJournalLine[]
): ShogoDiffRow[] {
  const byAccount = new Map<string, { ours: number; theirs: number }>();
  const slot = (name: string) => {
    const k = name.trim() || "(no account)";
    let s = byAccount.get(k);
    if (!s) {
      s = { ours: 0, theirs: 0 };
      byAccount.set(k, s);
    }
    return s;
  };
  for (const l of ours) slot(l.account.name ?? l.account.ref).ours += signed(l.posting, l.cents);
  for (const l of theirs) slot(l.account_name ?? l.account_ref ?? "").theirs += signed(l.posting, Math.round(l.amount * 100));
  return [...byAccount]
    .map(([account, s]) => ({ account, ours: s.ours, theirs: s.theirs, delta: s.ours - s.theirs }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.account.localeCompare(b.account));
}

/** Which shop a Shogo entry is for, from the class or location its lines name. */
export function shopForEntryLines(
  lines: readonly FlatJournalLine[],
  shops: readonly PostingShop[]
): string | null {
  for (const s of shops) {
    const names = [s.qbo_class_name, s.qbo_location_name].filter(Boolean).map((n) => n!.trim().toLowerCase());
    if (names.length === 0) continue;
    if (lines.some((l) => names.includes((l.class_name ?? "").trim().toLowerCase()) || names.includes((l.department_name ?? "").trim().toLowerCase()))) {
      return s.code;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// A Square payout as one QuickBooks Bank Deposit (migration 105)
// ---------------------------------------------------------------------------
//
// The other half of the card line. 104's entry debits the card takings, net
// of every fee, to Undeposited Square Funds; when Square pays them out this
// moves that money to the bank, for the EXACT amount the bank will show, so
// the bank feed offers a MATCH instead of adding a second deposit. One line,
// never a breakdown of the payout: the fees were expensed on the day, and a
// deposit that re-stated them would count them twice.
//
// What the books held before this (2026-09-17, read back): a Deposit per
// payout into Chase ACH, one line to Undeposited Square Funds, dated the
// bank's own date — which is Square's `arrival_date`. Same shape here, with
// the shop's class on the line and its location on the header (a Deposit
// takes a header DepartmentRef where a JournalEntry does not), and the
// payout's end-to-end id as the DocNumber, because the bank's ACH memo
// carries that same id and it is how a bank line is traced to a payout.

/** One row of `square_payouts`, as the builder wants it. */
export type SquarePayout = {
  id: string;
  location_id: string;
  square_payout_id: string;
  end_to_end_id: string | null;
  /** Square's own word: SENT, PAID or FAILED. */
  status: string;
  payout_type: string | null;
  sent_at: string;
  arrival_date: string;
  amount_cents: number;
  external_ref: PayoutPostingRef | null;
  post_error: string | null;
};

export type PayoutPostingRef = {
  qbo?: {
    id?: string;
    sync_token?: string;
    doc_number?: string | null;
    entity?: "Deposit";
    deposit_hash?: string;
    /** Stamped by `record_payout_posting` from the row, so the screen can say
     *  "changed since posted" without rebuilding. */
    amount_cents?: number;
    arrival_date?: string;
  };
};

export type QboDeposit = {
  Id?: string;
  SyncToken?: string;
  sparse?: boolean;
  DocNumber: string;
  TxnDate: string;
  PrivateNote: string;
  DepositToAccountRef: { value: string; name?: string };
  DepartmentRef?: { value: string; name?: string };
  Line: {
    DetailType: "DepositLineDetail";
    Amount: number;
    Description: string;
    DepositLineDetail: {
      AccountRef: { value: string; name?: string };
      ClassRef?: { value: string; name?: string };
    };
  }[];
};

export type DepositBuild =
  | {
      ok: true;
      mode: "create" | "update";
      docNumber: string;
      cents: number;
      bank: QboRefValue;
      account: QboRefValue;
      hash: string;
      warnings: string[];
      body: QboDeposit;
    }
  | { ok: false; refusals: string[] };

/** The payout's end-to-end id — `T316V42B337KEBX`, the id the bank memo
 *  carries — else a prefix of Square's own id. Refuses over the cap. */
export function docNumberForPayout(payout: Pick<SquarePayout, "end_to_end_id" | "square_payout_id">): { ok: true; value: string } | { ok: false; reason: string } {
  const e2e = payout.end_to_end_id?.trim();
  const value = e2e ? e2e : `SQ-${payout.square_payout_id.replace(/^po_/, "").slice(-12)}`;
  if (value.length > DOC_NUMBER_MAX) {
    return { ok: false, reason: `The deposit's document number would be ${value.length} characters (${value}); QuickBooks allows ${DOC_NUMBER_MAX}.` };
  }
  return { ok: true, value };
}

export function depositHash(input: { docNumber: string; txnDate: string; cents: number; bankRef: string; accountRef: string; classRef: string; deptRef: string }): string {
  return journalHash({
    docNumber: input.docNumber,
    txnDate: input.txnDate,
    lines: [
      { posting: "Debit", cents: input.cents, account: { ref: input.bankRef, name: null }, description: "", source: { kind: "tender", key: input.classRef } },
      { posting: "Credit", cents: input.cents, account: { ref: input.accountRef, name: null }, description: "", source: { kind: "tender", key: input.deptRef } },
    ],
  });
}

/**
 * One deposit for one payout, or the reasons there cannot be one.
 *
 *   · a payout Square reports as anything but SENT or PAID → refused (money
 *     that did not move is not a deposit);
 *   · a zero or negative payout → refused (Square taking money BACK is a
 *     withdrawal, recorded by hand — rare, and worth a person's eye);
 *   · the shop lacks a Class or a Location → refused, as for the entry;
 *   · no bank role, or no card role → refused by name;
 *   · the amount is the payout's, to the cent, and there is one line.
 */
export function buildDeposit(input: {
  payout: SquarePayout;
  /** `orgs.name`, which closes the memo. Not hashed. */
  orgName?: string;
  mappings: readonly SalesMapping[];
  shop: PostingShop;
}): DepositBuild {
  const { payout, mappings, shop } = input;
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (payout.status !== "SENT" && payout.status !== "PAID") {
    refusals.push(`Square reports this payout as ${payout.status}, so no money reached the bank.`);
  }
  if (!Number.isInteger(payout.amount_cents) || payout.amount_cents <= 0) {
    refusals.push(
      payout.amount_cents < 0
        ? `This payout is negative (${money(payout.amount_cents)}) — Square took money back, which is a withdrawal to record by hand.`
        : "This payout is for nothing."
    );
  }

  const klass = shop.qbo_class_ref?.trim() ? { value: shop.qbo_class_ref.trim(), ...(shop.qbo_class_name ? { name: shop.qbo_class_name } : {}) } : null;
  const dept = shop.qbo_location_ref?.trim() ? { value: shop.qbo_location_ref.trim(), ...(shop.qbo_location_name ? { name: shop.qbo_location_name } : {}) } : null;
  if (!klass) refusals.push(`${shop.code} has no QuickBooks class — set it on the location's record.`);
  if (!dept) refusals.push(`${shop.code} has no QuickBooks location — set it on the location's record.`);

  const bank = roleAccount(mappings, "bank");
  const account = roleAccount(mappings, "card");
  if (!bank) refusals.push(`No account is set for “${SALES_ROLE_LABEL.bank}” — Settings → Accounting → Sales from Square.`);
  if (!account) refusals.push(`No account is set for “${SALES_ROLE_LABEL.card}” — Settings → Accounting → Sales from Square.`);

  const doc = docNumberForPayout(payout);
  if (!doc.ok) refusals.push(doc.reason);

  if (refusals.length > 0) return { ok: false, refusals };

  const docNumber = (doc as { ok: true; value: string }).value;
  const cents = payout.amount_cents;
  const hash = depositHash({
    docNumber,
    txnDate: payout.arrival_date,
    cents,
    bankRef: bank!.ref,
    accountRef: account!.ref,
    classRef: klass!.value,
    deptRef: dept!.value,
  });
  const id = payout.external_ref?.qbo?.id?.trim();
  const syncToken = payout.external_ref?.qbo?.sync_token?.trim();
  const mode: "create" | "update" = id && syncToken ? "update" : "create";
  const sent = payout.sent_at.slice(0, 10);

  const body: QboDeposit = {
    ...(mode === "update" ? { Id: id, SyncToken: syncToken, sparse: false } : {}),
    DocNumber: docNumber,
    TxnDate: payout.arrival_date,
    PrivateNote: `Square payout · ${shop.code} · sent ${sent}, arriving ${payout.arrival_date} · ${docNumber}${orgTail(input.orgName)}`,
    DepositToAccountRef: { value: bank!.ref, ...(bank!.name ? { name: bank!.name } : {}) },
    DepartmentRef: dept!,
    Line: [
      {
        DetailType: "DepositLineDetail",
        Amount: centsToAmount(cents),
        Description: `Square payout ${docNumber} · ${shop.code}`,
        DepositLineDetail: {
          AccountRef: { value: account!.ref, ...(account!.name ? { name: account!.name } : {}) },
          ClassRef: klass!,
        },
      },
    ],
  };

  return { ok: true, mode, docNumber, cents, bank: bank!, account: account!, hash, warnings, body };
}

/**
 * The state of a payout for the Sales screen — `postingState`'s shape.
 * `stale` means the payout's amount or arrival date moved after it was
 * posted (both are stamped into the ref by the database at post time).
 */
export function payoutPostingState(row: Pick<SquarePayout, "external_ref" | "post_error" | "amount_cents" | "arrival_date">): PostingState {
  if (row.post_error) return "failed";
  const qbo = row.external_ref?.qbo;
  if (!qbo?.id) return "unposted";
  if (
    (qbo.amount_cents !== undefined && qbo.amount_cents !== row.amount_cents) ||
    (qbo.arrival_date !== undefined && qbo.arrival_date !== row.arrival_date)
  ) {
    return "stale";
  }
  return "posted";
}

export function payoutPostingLabel(state: PostingState, ref: PayoutPostingRef | null): string {
  switch (state) {
    case "unposted":
      return "—";
    case "failed":
      return "failed";
    case "stale":
      return "changed since posted";
    case "posted":
      return ref?.qbo?.doc_number ?? "posted";
  }
}

/** A QuickBooks Deposit as `find_deposits` flattens it. */
export type FlatDeposit = {
  id: string;
  doc_number: string | null;
  txn_date: string;
  total_cents: number;
  deposit_to_name: string | null;
  department_name: string | null;
  private_note: string | null;
  lines: { cents: number; account_name: string | null; class_name: string | null; entity_name: string | null; description: string | null }[];
};

export type DepositMatch = {
  payoutId: string;
  /** Deposits on the books for this payout's amount within a few days of its
   *  arrival: OURS (the DocNumber is the payout's) or somebody else's. */
  ours: FlatDeposit[];
  theirs: FlatDeposit[];
};

/**
 * Which deposits on the books answer to each payout — by AMOUNT within
 * `windowDays` of the arrival date, since a deposit the bank feed added
 * carries no id. The parallel run: while the bank feed is still adding them,
 * a payout with a deposit of ours AND one of theirs is doubled on the books.
 */
export function matchDeposits(
  payouts: readonly Pick<SquarePayout, "id" | "amount_cents" | "arrival_date" | "end_to_end_id" | "square_payout_id">[],
  deposits: readonly FlatDeposit[],
  windowDays = 4
): DepositMatch[] {
  const dayMs = 86400000;
  return payouts.map((p) => {
    const doc = docNumberForPayout(p);
    const ours: FlatDeposit[] = [];
    const theirs: FlatDeposit[] = [];
    const at = Date.parse(`${p.arrival_date}T00:00:00Z`);
    for (const d of deposits) {
      if (d.total_cents !== p.amount_cents) continue;
      const gap = Math.abs(Date.parse(`${d.txn_date}T00:00:00Z`) - at) / dayMs;
      if (gap > windowDays) continue;
      if (doc.ok && d.doc_number === doc.value) ours.push(d);
      else theirs.push(d);
    }
    return { payoutId: p.id, ours, theirs };
  });
}

/** " · Donut Friend", or nothing when the org has no name. */
function orgTail(orgName: string | null | undefined): string {
  const n = (orgName ?? "").trim();
  return n ? ` · ${n}` : "";
}
