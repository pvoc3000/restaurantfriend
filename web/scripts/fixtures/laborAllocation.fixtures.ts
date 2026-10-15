// lib/laborAllocation — the month's labor split between shops by hours worked.
//
// The shape Gusto actually posts: wages and taxes on the employee's assigned
// shop's CLASS and no Location. September 2026's real hours anchor the shares
// (DF01 1,457.2 h, DF02 899.5 h). Assertions are on the emitted lines, because
// the likeliest breakage is one that still balances — a split that drifts a
// cent, or a bucket left half-emptied in the Location dimension.

import { test, eq, ok, no } from "./harness";
import {
  buildLaborJournalEntry,
  isLaborDocNumber,
  laborDocNumber,
  laborHash,
  laborPostingState,
  lastDayOfMonth,
  monthsBetween,
  poolFromEntries,
  sharesFromHours,
  splitCents,
  type LaborEntry,
  type LaborShop,
} from "../../src/lib/laborAllocation";

const DF01: LaborShop = {
  id: "loc-1",
  code: "DF01",
  qbo_class_ref: "C1",
  qbo_class_name: "DF01",
  qbo_location_ref: "D1",
  qbo_location_name: "DF01",
};
const DF02: LaborShop = {
  id: "loc-2",
  code: "DF02",
  qbo_class_ref: "C2",
  qbo_class_name: "DF02",
  qbo_location_ref: "D2",
  qbo_location_name: "DF02",
};
const SHOPS = [DF01, DF02];
const WAGES = { ref: "60", name: "Payroll Expenses:Wages" };
const TAXES = { ref: "61", name: "Payroll Expenses:Taxes" };

const SEPT_HOURS = [
  { location_id: "loc-1", hours: 1457.2 },
  { location_id: "loc-2", hours: 899.5 },
];

function line(posting: string, amount: number, account: { ref: string; name: string } | null, klass: LaborShop | null, dept: LaborShop | null = null) {
  return {
    posting,
    amount,
    account_ref: account?.ref ?? "10",
    account_name: account?.name ?? "Checking",
    class_ref: klass?.qbo_class_ref ?? null,
    class_name: klass?.qbo_class_name ?? null,
    department_ref: dept?.qbo_location_ref ?? null,
    department_name: dept?.qbo_location_name ?? null,
  };
}

/** Two Gusto payrolls: DF01 people $10,000 wages + $800 tax, DF02 people $2,000
 *  wages + $160 tax, each balanced against the bank. */
const GUSTO: LaborEntry[] = [
  {
    id: "900",
    doc_number: null,
    txn_date: "2026-09-12",
    lines: [
      line("Debit", 6000, WAGES, DF01),
      line("Debit", 1000, WAGES, DF02),
      line("Debit", 480, TAXES, DF01),
      line("Debit", 80, TAXES, DF02),
      line("Credit", 7560, null, null),
    ],
  },
  {
    id: "901",
    doc_number: null,
    txn_date: "2026-09-26",
    lines: [
      line("Debit", 4000, WAGES, DF01),
      line("Debit", 1000, WAGES, DF02),
      line("Debit", 320, TAXES, DF01),
      line("Debit", 80, TAXES, DF02),
      line("Credit", 5400, null, null),
    ],
  },
];

function build(entries = GUSTO, hours = SEPT_HOURS, existing = null as null | { qbo: { id: string; sync_token: string } }) {
  const pool = poolFromEntries(entries, [WAGES, TAXES]);
  return buildLaborJournalEntry({
    month: "2026-09-01",
    pool,
    shares: sharesFromHours(hours, SHOPS),
    existing,
    orgName: "Donut Friend",
  });
}

test("laborAllocation: dates and doc numbers", () => {
  eq(laborDocNumber("2026-09-01"), "LABOR-2026-09");
  eq(lastDayOfMonth("2026-09-01"), "2026-09-30");
  eq(lastDayOfMonth("2028-02-01"), "2028-02-29");
  eq(lastDayOfMonth("2026-12-01"), "2026-12-31");
  ok(isLaborDocNumber("LABOR-2026-09"));
  no(isLaborDocNumber("DF01-2026-09-30"), "a sales entry is not ours");
  eq(monthsBetween("2026-11-15", "2027-01-03"), ["2027-01-01", "2026-12-01", "2026-11-01"]);
});

test("laborAllocation: the pool sums per account and bucket, ignoring the bank and our own entry", () => {
  const ours: LaborEntry = {
    id: "950",
    doc_number: "LABOR-2026-09",
    txn_date: "2026-09-30",
    lines: [line("Credit", 999, WAGES, DF01), line("Debit", 999, WAGES, DF02, DF02)],
  };
  const pool = poolFromEntries([...GUSTO, ours], [WAGES, TAXES]);
  eq(
    pool.map((b) => [b.accountRef, b.classRef, b.departmentRef, b.cents]),
    [
      ["61", "C1", null, 80000],
      ["61", "C2", null, 16000],
      ["60", "C1", null, 1000000],
      ["60", "C2", null, 200000],
    ]
  );
});

test("laborAllocation: debits and credits on the same bucket net", () => {
  const pool = poolFromEntries(
    [{ id: "1", doc_number: null, txn_date: "2026-09-01", lines: [line("Debit", 100, WAGES, DF01), line("Credit", 100, WAGES, DF01)] }],
    [WAGES]
  );
  eq(pool.length, 0, "a bucket that nets to zero is dropped");
});

test("laborAllocation: shares from September's real hours", () => {
  const s = sharesFromHours(SEPT_HOURS, SHOPS);
  ok(s.ok);
  if (!s.ok) return;
  eq(s.shares.map((x) => [x.shop.code, x.share.toFixed(3)]), [["DF01", "0.618"], ["DF02", "0.382"]]);
  eq(s.unassignedHours, 0);
});

test("laborAllocation: a shop with hours and no QuickBooks refs is refused by name", () => {
  const bare = { ...DF02, qbo_location_ref: null };
  const s = sharesFromHours(SEPT_HOURS, [DF01, bare]);
  no(s.ok);
  if (s.ok) return;
  ok(/DF02 has 899\.5 hours but no QuickBooks location/.test(s.refusals[0]), s.refusals[0]);
});

test("laborAllocation: hours on no shop are counted and left out", () => {
  const s = sharesFromHours([...SEPT_HOURS, { location_id: null, hours: 4 }], SHOPS);
  ok(s.ok);
  if (!s.ok) return;
  eq(s.unassignedHours, 4);
  eq(s.totalHours.toFixed(1), "2356.7");
});

test("laborAllocation: largest remainder adds back to the cent", () => {
  const thirds = [
    { shop: DF01, hours: 1, share: 1 / 3 },
    { shop: DF02, hours: 1, share: 1 / 3 },
    { shop: { ...DF02, id: "loc-3", code: "DF03" }, hours: 1, share: 1 / 3 },
  ];
  eq(splitCents(100, thirds), [34, 33, 33]);
  eq(splitCents(-100, thirds), [-34, -33, -33]);
  const sept = sharesFromHours(SEPT_HOURS, SHOPS);
  ok(sept.ok);
  if (!sept.ok) return;
  for (const total of [1, 7, 99999, 1216000]) {
    const parts = splitCents(total, sept.shares);
    eq(parts.reduce((a, b) => a + b, 0), total, `split of ${total}`);
  }
});

test("laborAllocation: the entry re-splits each account by hours and nets to zero per account", () => {
  const b = build();
  ok(b.ok);
  if (!b.ok) return;
  eq(b.docNumber, "LABOR-2026-09");
  eq(b.txnDate, "2026-09-30");
  eq(b.poolCents, 1296000);

  // Wages: $12,000 total → DF01 61.8322…% = $7,419.87, DF02 $4,580.13.
  const wages = b.moves.find((m) => m.accountRef === "60")!;
  eq(wages.target, { "loc-1": 741987, "loc-2": 458013 });
  eq(wages.current, { "loc-1": 1000000, "loc-2": 200000 });

  for (const acct of ["60", "61"]) {
    const net = b.lines
      .filter((l) => l.accountRef === acct)
      .reduce((s, l) => s + (l.posting === "Debit" ? l.cents : -l.cents), 0);
    eq(net, 0, `account ${acct} nets to zero`);
  }
  eq(b.debits, b.lines.filter((l) => l.posting === "Credit").reduce((s, l) => s + l.cents, 0));
});

test("laborAllocation: Gusto's class-only buckets are emptied, and the shop lines carry both refs", () => {
  const b = build();
  ok(b.ok && b.body);
  if (!b.ok || !b.body) return;
  const wageLines = b.body.Line.filter((l) => l.JournalEntryLineDetail.AccountRef.value === "60");
  eq(
    wageLines.map((l) => [
      l.JournalEntryLineDetail.PostingType,
      l.Amount,
      l.JournalEntryLineDetail.ClassRef?.value ?? null,
      l.JournalEntryLineDetail.DepartmentRef?.value ?? null,
    ]),
    [
      ["Credit", 10000, "C1", null],
      ["Credit", 2000, "C2", null],
      ["Debit", 7419.87, "C1", "D1"],
      ["Debit", 4580.13, "C2", "D2"],
    ]
  );
  ok(b.body.Line.every((l) => l.Amount > 0), "QuickBooks refuses a zero or negative line");
  ok(/DF01 1,457\.2 h \(61\.8%\)/.test(b.body.PrivateNote), b.body.PrivateNote);
});

test("laborAllocation: a bucket already on a shop's exact refs moves only the difference", () => {
  const entries: LaborEntry[] = [
    {
      id: "1",
      doc_number: null,
      txn_date: "2026-09-12",
      lines: [line("Debit", 600, WAGES, DF01, DF01), line("Debit", 400, WAGES, DF02, DF02), line("Credit", 1000, null, null)],
    },
  ];
  const b = build(entries, [{ location_id: "loc-1", hours: 50 }, { location_id: "loc-2", hours: 50 }]);
  ok(b.ok);
  if (!b.ok) return;
  eq(b.lines.map((l) => [l.posting, l.cents, l.classRef]), [["Credit", 10000, "C1"], ["Debit", 10000, "C2"]]);
});

test("laborAllocation: a month already split by hours posts nothing", () => {
  const entries: LaborEntry[] = [
    {
      id: "1",
      doc_number: null,
      txn_date: "2026-09-12",
      lines: [line("Debit", 500, WAGES, DF01, DF01), line("Debit", 500, WAGES, DF02, DF02), line("Credit", 1000, null, null)],
    },
  ];
  const b = build(entries, [{ location_id: "loc-1", hours: 50 }, { location_id: "loc-2", hours: 50 }]);
  ok(b.ok);
  if (!b.ok) return;
  eq(b.lines.length, 0);
  eq(b.body, null);
});

test("laborAllocation: one shop takes all of it", () => {
  const b = build(GUSTO, [{ location_id: "loc-1", hours: 80 }]);
  ok(b.ok);
  if (!b.ok) return;
  eq(b.moves.find((m) => m.accountRef === "60")!.target, { "loc-1": 1200000 });
});

test("laborAllocation: no labor in the month is refused, not posted empty", () => {
  const b = build([]);
  no(b.ok);
});

test("laborAllocation: update mode carries the stored id, and the hash follows the lines", () => {
  const first = build();
  const again = build(GUSTO, SEPT_HOURS, { qbo: { id: "77", sync_token: "3" } });
  ok(first.ok && again.ok);
  if (!first.ok || !again.ok || !again.body) return;
  eq(first.mode, "create");
  eq(again.mode, "update");
  eq(again.body.Id, "77");
  eq(first.hash, again.hash, "the same lines hash the same, create or update");
  const moved = build(GUSTO, [{ location_id: "loc-1", hours: 1457.2 }, { location_id: "loc-2", hours: 900 }]);
  ok(moved.ok && moved.hash !== first.hash, "different hours, different hash");
  eq(laborHash({ docNumber: "x", txnDate: "y", lines: [] }).length, 16);
});

test("laborAllocation: posting state", () => {
  eq(laborPostingState(null), "unposted");
  eq(laborPostingState({ external_ref: { qbo: { id: "1" } }, post_error: null }), "posted");
  eq(laborPostingState({ external_ref: { qbo: { id: "1" } }, post_error: "closed books" }), "failed");
});
