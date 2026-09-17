// lib/salesPosting — a shop-day's Square sales as one QuickBooks journal entry.
//
// THE ANCHOR CASE IS A REAL DAY: DF01 on 2026-09-10, every figure as Square's
// Reporting API returned it during the step-0 probe, asserted on the EMITTED
// Line[] JSON rather than on a shape — the likeliest refactor here is one that
// helpfully lets a negative amount through, or drops the class off a line, and
// both reconcile perfectly on every report anybody looks at.

import { test, eq, ok, no } from "./harness";
import {
  buildJournalEntry,
  docNumberForDay,
  isOurDocNumber,
  journalHash,
  postingState,
  postingLabel,
  diffAgainstShogo,
  shopForEntryLines,
  tenderRole,
  centsToAmount,
  SALES_ROLES,
  type SalesBreakdown,
  type SalesMapping,
  type PostingShop,
  type BuildInput,
  type FlatJournalLine,
} from "../../src/lib/salesPosting";

// --- the real DF01 2026-09-10 -----------------------------------------------

function realDay(over: Partial<SalesBreakdown> = {}): SalesBreakdown {
  return {
    v: 1,
    pulled_at: "2026-09-17T16:02:11.000Z",
    lines: [
      { kind: "category", key: "Ice Cream", name: "Ice Cream", cents: 13075 },
      { kind: "category", key: "Coffee & Tea", name: "Coffee & Tea", cents: 7755 },
      { kind: "category", key: "Special Orders", name: "Special Orders", cents: 71920 },
      { kind: "category", key: "Beverages", name: "Beverages", cents: 2650 },
      { kind: "category", key: "Signatures", name: "Signatures", cents: 176445 },
      { kind: "discount", key: "discounts", name: "Discounts and comps", cents: 5489 },
      { kind: "tax", key: "sales_tax", name: "Sales tax", cents: 18074 },
      { kind: "tip", key: "tips", name: "Tips", cents: 15391 },
      { kind: "tender", key: "CARD", name: "CARD", cents: 230573 },
      { kind: "tender", key: "OTHER:UBEREATS", name: "UBEREATS", cents: 32271 },
      { kind: "tender", key: "OTHER:DOORDASH", name: "DOORDASH", cents: 31884 },
      { kind: "tender", key: "CASH", name: "CASH", cents: 5093 },
      { kind: "fee", key: "CARD", name: "CARD fees", cents: 7234 },
    ],
    totals: {
      net_sales_cents: 266356,
      top_line_cents: 271845,
      itemized_returns_cents: 0,
      refunds_by_amount_cents: 0,
      total_collected_cents: 299821,
    },
    ...over,
  };
}

const role = (key: string, ref: string, name: string): SalesMapping => ({
  kind: "role", square_key: key, square_name: null, account_ref: ref, account_name: name,
});
const cat = (key: string, ref: string | null, name: string | null): SalesMapping => ({
  kind: "category", square_key: key, square_name: key, account_ref: ref, account_name: name,
});
const tender = (key: string, ref: string | null, name: string | null): SalesMapping => ({
  kind: "tender", square_key: key, square_name: key.replace(/^OTHER:/, ""), account_ref: ref, account_name: name,
});

const ROLES: SalesMapping[] = [
  role("uncategorized_income", "U", "Uncategorized Income"),
  role("discounts", "D", "Discounts Given"),
  role("service_charges", "S", "Delivery Services"),
  role("tax", "T", "Franchise Tax Board Payable:Sales Tax Payable"),
  role("tips", "P", "Square Tips"),
  role("gift_cards", "G", "Square Gift Cards"),
  role("card", "C", "Undeposited Square Funds"),
  role("cash", "H", "Undeposited Cash"),
  role("other_tender", "O", "Undeposited Square Funds"),
  role("fees", "F", "Merchant Services:Square Fees"),
];
const CATS: SalesMapping[] = [
  cat("Signatures", "SIG", "Signatures"),
  cat("Ice Cream", "ICE", "Ice Cream"),
  cat("Coffee & Tea", "COF", "Coffee & Tea"),
  cat("Beverages", "BEV", "Beverages"),
  cat("Special Orders", "SPO", "Special Orders"),
];
const TENDERS: SalesMapping[] = [
  tender("OTHER:UBEREATS", "UE", "Undeposited Uber Eats"),
  // DoorDash is seen and unmapped: the row exists with no account.
  tender("OTHER:DOORDASH", null, null),
];

const DF01: PostingShop = {
  code: "DF01",
  qbo_class_ref: "5000000000000012345",
  qbo_class_name: "DF01",
  qbo_location_ref: "1",
  qbo_location_name: "DF01 HP",
};

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    breakdown: realDay(),
    mappings: [...ROLES, ...CATS, ...TENDERS],
    shop: DF01,
    businessDate: "2026-09-10",
    netSalesCents: 266356,
    tipsCents: 15391,
    existing: null,
    ...over,
  };
}

function built(over: Partial<BuildInput> = {}) {
  const b = buildJournalEntry(input(over));
  if (!b.ok) throw new Error("expected a build, got refusals: " + b.refusals.join(" | "));
  return b;
}

function refused(over: Partial<BuildInput> = {}): string[] {
  const b = buildJournalEntry(input(over));
  if (b.ok) throw new Error("expected refusals, got a build");
  return b.refusals;
}

// --- the anchor: the real day, line for line --------------------------------

test("the real DF01 day balances and emits exactly these lines", () => {
  const b = built();
  eq(b.debits, 305310, "debits");
  eq(b.credits, 305310, "credits");
  eq(b.mode, "create");
  eq(b.docNumber, "DF01-2026-09-10");
  eq(b.body.DocNumber, "DF01-2026-09-10");
  eq(b.body.TxnDate, "2026-09-10");
  no(b.body.Id, "a create carries no Id");
  no(b.body.SyncToken, "a create carries no SyncToken");
  eq(
    JSON.stringify(b.body.Line),
    JSON.stringify([
      line("Credit", 130.75, "ICE", "Ice Cream", "Ice Cream"),
      line("Credit", 77.55, "COF", "Coffee & Tea", "Coffee & Tea"),
      line("Credit", 719.2, "SPO", "Special Orders", "Special Orders"),
      line("Credit", 26.5, "BEV", "Beverages", "Beverages"),
      line("Credit", 1764.45, "SIG", "Signatures", "Signatures"),
      line("Debit", 54.89, "D", "Discounts Given", "Discounts and comps"),
      line("Credit", 180.74, "T", "Franchise Tax Board Payable:Sales Tax Payable", "Sales tax collected"),
      line("Credit", 153.91, "P", "Square Tips", "Tips"),
      line("Debit", 2233.39, "C", "Undeposited Square Funds", "Card takings, net of fees"),
      line("Debit", 322.71, "UE", "Undeposited Uber Eats", "UBEREATS takings"),
      line("Debit", 318.84, "O", "Undeposited Square Funds", "DOORDASH takings"),
      line("Debit", 50.93, "H", "Undeposited Cash", "Cash takings"),
      line("Debit", 72.34, "F", "Merchant Services:Square Fees", "Square fees"),
    ]),
    "the emitted Line[]"
  );
  // The unmapped tender is NAMED, with where it went.
  eq(b.unmapped, [{ kind: "tender", key: "OTHER:DOORDASH", name: "DOORDASH", cents: 31884, role: "other_tender" }]);
  eq(b.warnings, []);
});

function line(posting: "Debit" | "Credit", amount: number, ref: string, name: string, description: string) {
  return {
    DetailType: "JournalEntryLineDetail",
    Amount: amount,
    Description: description,
    JournalEntryLineDetail: {
      PostingType: posting,
      AccountRef: { value: ref, name },
      ClassRef: { value: "5000000000000012345", name: "DF01" },
      DepartmentRef: { value: "1", name: "DF01 HP" },
    },
  };
}

test("class and location ride EVERY line, since a JournalEntry has no header DepartmentRef", () => {
  const b = built();
  ok(b.body.Line.every((l) => l.JournalEntryLineDetail.ClassRef?.value === "5000000000000012345"), "class on every line");
  ok(b.body.Line.every((l) => l.JournalEntryLineDetail.DepartmentRef?.value === "1"), "location on every line");
  no("DepartmentRef" in b.body, "no header DepartmentRef");
});

test("every emitted amount is positive: a side flips, a sign never appears", () => {
  const b = built();
  ok(b.body.Line.every((l) => l.Amount > 0), "positive amounts");
});

// --- refusals -----------------------------------------------------------------

test("no breakdown refuses", () => {
  const r = refused({ breakdown: null });
  ok(r[0].includes("No breakdown"), r[0]);
});

test("an incomplete breakdown refuses", () => {
  const r = refused({ breakdown: realDay({ incomplete: true }) });
  ok(r[0].includes("incomplete"), r[0]);
});

test("a shop with no class or no location refuses, naming which", () => {
  const r = refused({ shop: { ...DF01, qbo_class_ref: null, qbo_location_ref: null } });
  ok(r.some((x) => x.includes("no QuickBooks class")), "class");
  ok(r.some((x) => x.includes("no QuickBooks location")), "location");
});

test("a DocNumber over QuickBooks' limit refuses rather than truncating", () => {
  const r = refused({ shop: { ...DF01, code: "DONUTFRIEND01" } });
  ok(r.some((x) => x.includes("DONUTFRIEND01-2026-09-10")), r.join(" | "));
  const d = docNumberForDay("DF01", "2026-09-10");
  eq(d, { ok: true, value: "DF01-2026-09-10" });
});

test("a missing role refuses BY NAME, and only when a line needs it", () => {
  const r = refused({ mappings: [...ROLES.filter((m) => m.square_key !== "tax"), ...CATS, ...TENDERS] });
  eq(r.length, 1);
  ok(r[0].includes("Sales tax collected"), r[0]);
  // The gift-cards role is unset here too, and nothing on this day needs it.
  const b = buildJournalEntry(input({ mappings: [...ROLES.filter((m) => m.square_key !== "gift_cards"), ...CATS, ...TENDERS] }));
  ok(b.ok, "an unused role is not required");
});

test("debits ≠ credits refuses naming both sides — no plug line, ever", () => {
  const day = realDay();
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CASH" ? { ...l, cents: 5094 } : l));
  const r = refused({ breakdown: day });
  eq(r.length, 1);
  ok(r[0].includes("does not balance"), r[0]);
  ok(r[0].includes("$3,053.11") && r[0].includes("$3,053.10"), r[0]);
  ok(r[0].includes("$0.01 apart"), r[0]);
});

test("nothing to post refuses", () => {
  const r = refused({ breakdown: realDay({ lines: [] }) });
  ok(r[0].includes("Nothing to post"), r[0]);
});

// --- the fallbacks ------------------------------------------------------------

test("an unmapped category posts to the unmapped-categories role and is recorded", () => {
  const day = realDay();
  day.lines.push({ kind: "category", key: "Misfits", name: "Misfits", cents: 1000 });
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CASH" ? { ...l, cents: 6093 } : l));
  const b = built({ breakdown: day });
  const misfits = b.lines.find((l) => l.source.key === "Misfits")!;
  eq(misfits.account.ref, "U");
  eq(misfits.posting, "Credit");
  eq(b.unmapped.filter((u) => u.kind === "category"), [{ kind: "category", key: "Misfits", name: "Misfits", cents: 1000, role: "uncategorized_income" }]);
});

test("a category in net return is a DEBIT of the magnitude", () => {
  const day = realDay();
  day.lines.push({ kind: "category", key: "Merch", name: "Merch", cents: -500 });
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CASH" ? { ...l, cents: 4593 } : l));
  const b = built({ breakdown: day, mappings: [...ROLES, ...CATS, ...TENDERS, cat("Merch", "MER", "Merchandise")] });
  const merch = b.lines.find((l) => l.source.key === "Merch")!;
  eq(merch.posting, "Debit");
  eq(merch.cents, 500);
  const emitted = b.body.Line.find((l) => l.Description === "Merch")!;
  eq(emitted.Amount, 5);
  eq(emitted.JournalEntryLineDetail.PostingType, "Debit");
});

test("CARD, CASH and SQUARE_GIFT_CARD have fixed homes; everything else falls to the other-tender role", () => {
  eq(tenderRole("CARD"), "card");
  eq(tenderRole("CASH"), "cash");
  eq(tenderRole("SQUARE_GIFT_CARD"), "gift_cards");
  eq(tenderRole("OTHER:UBEREATS"), "other_tender");
  eq(tenderRole("AFTERPAY"), "other_tender");
});

test("a gift card redeemed debits the gift-card liability; one sold credits it", () => {
  const day = realDay();
  day.lines.push({ kind: "gift_card_sale", key: "gift_cards", name: "Gift cards sold", cents: 5000 });
  day.lines.push({ kind: "tender", key: "SQUARE_GIFT_CARD", name: "SQUARE_GIFT_CARD", cents: 2000 });
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CARD" ? { ...l, cents: 233573 } : l));
  const b = built({ breakdown: day });
  const sold = b.lines.find((l) => l.source.kind === "gift_card_sale")!;
  const redeemed = b.lines.find((l) => l.source.key === "SQUARE_GIFT_CARD")!;
  eq([sold.posting, sold.account.ref, sold.cents], ["Credit", "G", 5000]);
  eq([redeemed.posting, redeemed.account.ref, redeemed.cents], ["Debit", "G", 2000]);
  eq(redeemed.description, "Gift cards redeemed");
});

test("a service charge credits its role, and a net-returned one debits it", () => {
  const day = realDay();
  day.lines.push({ kind: "service_charge", key: "Courier Tip", name: "Courier Tip", cents: -700 });
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CARD" ? { ...l, cents: 229873 } : l));
  const b = built({ breakdown: day });
  const svc = b.lines.find((l) => l.source.kind === "service_charge")!;
  eq([svc.posting, svc.account.ref, svc.cents], ["Debit", "S", 700]);
});

test("a fee on a tender that took nothing still debits fees and then fails the balance", () => {
  const day = realDay();
  day.lines.push({ kind: "fee", key: "AFTERPAY", name: "AFTERPAY fees", cents: 100 });
  const r = refused({ breakdown: day });
  ok(r[0].includes("does not balance"), r[0]);
});

// --- create versus update -----------------------------------------------------

test("a day already in QuickBooks builds an UPDATE with Id, SyncToken and sparse:false", () => {
  const b = built({ existing: { qbo: { id: "145", sync_token: "3", doc_number: "DF01-2026-09-10" } } });
  eq(b.mode, "update");
  eq(b.body.Id, "145");
  eq(b.body.SyncToken, "3");
  eq(b.body.sparse, false);
});

test("an id with no sync token is NOT an update — the pair is written together or not at all", () => {
  const b = built({ existing: { qbo: { id: "145" } } });
  eq(b.mode, "create");
});

test("the hash is stable across builds and moves when a line moves", () => {
  const a = built().hash;
  const b = built().hash;
  eq(a, b, "same input, same hash");
  const day = realDay();
  day.lines = day.lines.map((l) => (l.kind === "category" && l.key === "Signatures" ? { ...l, cents: 176446 } : l));
  day.lines = day.lines.map((l) => (l.kind === "tender" && l.key === "CASH" ? { ...l, cents: 5094 } : l));
  const c = built({ breakdown: day }).hash;
  ok(a !== c, "a changed line changes the hash");
  // A remapped account changes it too: the entry is different even though the money is not.
  const d = built({ mappings: [...ROLES, ...CATS.map((m) => (m.square_key === "Signatures" ? { ...m, account_ref: "SIG2" } : m)), ...TENDERS] }).hash;
  ok(a !== d, "a remapped account changes the hash");
  eq(journalHash({ docNumber: "x", txnDate: "2026-01-01", lines: [] }).length, 16);
});

// --- warnings -----------------------------------------------------------------

test("a hand-corrected net figure is a warning, and the entry follows the breakdown", () => {
  const b = built({ netSalesCents: 266000 });
  eq(b.warnings.length, 1);
  ok(b.warnings[0].includes("$2,660.00") && b.warnings[0].includes("$2,663.56"), b.warnings[0]);
  eq(b.debits, 305310);
});

test("a refund by amount is named, since it posts as a return on Uncategorized", () => {
  const day = realDay({ totals: { ...realDay().totals, refunds_by_amount_cents: -25000 } });
  const b = built({ breakdown: day });
  ok(b.warnings.some((w) => w.includes("$250.00") && w.includes("Uncategorized")), b.warnings.join(" | "));
});

// --- the screen -----------------------------------------------------------------

test("postingState: unposted, posted, stale, failed — and failed outranks the rest", () => {
  eq(postingState({ external_ref: null, breakdown_hash: "h1", post_error: null }), "unposted");
  eq(postingState({ external_ref: { qbo: { id: "1", breakdown_hash: "h1" } }, breakdown_hash: "h1", post_error: null }), "posted");
  eq(postingState({ external_ref: { qbo: { id: "1", breakdown_hash: "h1" } }, breakdown_hash: "h2", post_error: null }), "stale");
  eq(postingState({ external_ref: { qbo: { id: "1", breakdown_hash: "h1" } }, breakdown_hash: "h1", post_error: "fault 6000" }), "failed");
  eq(postingState({ external_ref: null, breakdown_hash: null, post_error: "fault 6000" }), "failed");
  eq(postingLabel("posted", { qbo: { doc_number: "DF01-2026-09-10" } }), "DF01-2026-09-10");
  eq(postingLabel("stale", null), "pulled again");
  eq(postingLabel("unposted", null), "—");
});

test("isOurDocNumber knows our shape and nobody else's", () => {
  ok(isOurDocNumber("DF01-2026-09-10", ["DF01", "DF02"]));
  no(isOurDocNumber("DF03-2026-09-10", ["DF01", "DF02"]), "an unknown shop");
  no(isOurDocNumber("SHOGO-1234", ["DF01"]), "Shogo's");
  no(isOurDocNumber(null, ["DF01"]), "none");
});

test("centsToAmount is exact at two places", () => {
  eq(centsToAmount(223339), 2233.39);
  eq(centsToAmount(-5), 0.05);
  eq(centsToAmount(100), 1);
});

test("SALES_ROLES lists each role once with a classification", () => {
  eq(new Set(SALES_ROLES.map((r) => r.key)).size, SALES_ROLES.length);
  // "Revenue", never "Income": that is the word QuickBooks' Classification uses,
  // and a picker filtered on the wrong one offers nothing.
  ok(SALES_ROLES.every((r) => ["Revenue", "Liability", "Asset", "Expense"].includes(r.classification)));
});

// --- the parallel run ---------------------------------------------------------

test("diffAgainstShogo compares per account, signed, largest delta first", () => {
  const ours = built().lines;
  const theirs: FlatJournalLine[] = [
    { entry_id: "9", doc_number: "1234", txn_date: "2026-09-10", posting: "Credit", amount: 1764.45, account_ref: "SIG", account_name: "Signatures", class_name: "DF01", department_name: "DF01 HP", description: null },
    { entry_id: "9", doc_number: "1234", txn_date: "2026-09-10", posting: "Credit", amount: 180.74, account_ref: "T", account_name: "Franchise Tax Board Payable:Sales Tax Payable", class_name: "DF01", department_name: null, description: null },
    { entry_id: "9", doc_number: "1234", txn_date: "2026-09-10", posting: "Debit", amount: 12.5, account_ref: "R", account_name: "Refunds", class_name: "DF01", department_name: null, description: null },
  ];
  const rows = diffAgainstShogo(ours, theirs);
  const sig = rows.find((r) => r.account === "Signatures")!;
  eq([sig.ours, sig.theirs, sig.delta], [176445, 176445, 0]);
  const refunds = rows.find((r) => r.account === "Refunds")!;
  eq([refunds.ours, refunds.theirs, refunds.delta], [0, -1250, 1250]);
  ok(Math.abs(rows[0].delta) >= Math.abs(rows[rows.length - 1].delta), "sorted by |delta|");
});

test("shopForEntryLines reads the shop off a class or a location name", () => {
  const shops: PostingShop[] = [DF01, { code: "DF02", qbo_class_ref: "2", qbo_class_name: "DF02", qbo_location_ref: "2", qbo_location_name: "DF02 DTLA" }];
  const l = (class_name: string | null, department_name: string | null): FlatJournalLine => ({
    entry_id: "1", doc_number: null, txn_date: "2026-09-10", posting: "Credit", amount: 1, account_ref: null, account_name: null, class_name, department_name, description: null,
  });
  eq(shopForEntryLines([l("DF02", null)], shops), "DF02");
  eq(shopForEntryLines([l(null, "df01 hp")], shops), "DF01");
  eq(shopForEntryLines([l(null, null)], shops), null);
});
