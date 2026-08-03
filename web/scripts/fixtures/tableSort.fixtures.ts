// makeComparator — the sort semantics every list screen shares.
//
// The cases that matter are about TIEBREAKS, because six lists pass one and a
// tiebreak that misbehaves looks like the list being randomly ordered rather
// than like a bug in a shared function.

import { makeComparator } from "../../src/lib/tableSort";
import { eq, test } from "./harness";

type Po = { date: string | null; vendor: string; number: string };

const rows: Po[] = [
  { date: "2026-08-03", vendor: "Sysco", number: "1004" },
  { date: "2026-08-01", vendor: "BakeMark", number: "1001" },
  { date: "2026-08-03", vendor: "Amoretti", number: "1003" },
  { date: "2026-08-01", vendor: "Sysco", number: "1002" },
];

/** The PO list's arrangement: a chosen column, then vendor, then PO number. */
function byDate(dir: "asc" | "desc") {
  return [...rows]
    .sort(
      makeComparator<Po>({
        value: (r) => r.date,
        dir,
        tiebreaks: [(r) => r.vendor, (r) => r.number],
      })
    )
    .map((r) => `${r.date} ${r.vendor}`);
}

test("tiebreak: within a date, vendors read A→Z", () => {
  eq(byDate("asc"), [
    "2026-08-01 BakeMark",
    "2026-08-01 Sysco",
    "2026-08-03 Amoretti",
    "2026-08-03 Sysco",
  ]);
});

test("tiebreak: flipping the primary does NOT flip the tiebreak", () => {
  // The whole point. Newest day first, but each day still reads A→Z — this is
  // the case that was wrong when the tiebreak took the primary's sign.
  eq(byDate("desc"), [
    "2026-08-03 Amoretti",
    "2026-08-03 Sysco",
    "2026-08-01 BakeMark",
    "2026-08-01 Sysco",
  ]);
});

test("tiebreak: a later tiebreak only speaks when the earlier one ties", () => {
  const same = [
    { date: "2026-08-01", vendor: "Sysco", number: "1009" },
    { date: "2026-08-01", vendor: "Sysco", number: "1002" },
  ];
  eq(
    same
      .sort(
        makeComparator<Po>({
          value: (r) => r.date,
          dir: "desc",
          tiebreaks: [(r) => r.vendor, (r) => r.number],
        })
      )
      .map((r) => r.number),
    ["1002", "1009"],
    "PO number ascending under a descending primary"
  );
});

test("empty cells sink in BOTH directions", () => {
  const withNull: Po[] = [
    { date: null, vendor: "Amoretti", number: "1000" },
    { date: "2026-08-01", vendor: "Sysco", number: "1002" },
  ];
  for (const dir of ["asc", "desc"] as const) {
    eq(
      [...withNull]
        .sort(makeComparator<Po>({ value: (r) => r.date, dir, tiebreaks: [(r) => r.vendor] }))
        .map((r) => r.date),
      ["2026-08-01", null],
      `nulls last, ${dir}`
    );
  }
});

test("two empty cells fall to the tiebreak, ascending", () => {
  const bothNull: Po[] = [
    { date: null, vendor: "Sysco", number: "1002" },
    { date: null, vendor: "Amoretti", number: "1000" },
  ];
  eq(
    [...bothNull]
      .sort(makeComparator<Po>({ value: (r) => r.date, dir: "desc", tiebreaks: [(r) => r.vendor] }))
      .map((r) => r.vendor),
    ["Amoretti", "Sysco"],
    "null primaries, tiebreak still A→Z"
  );
});

test("numbers compare as numbers, not as text", () => {
  const nums = [{ n: 100 }, { n: 9 }, { n: 20 }];
  eq(
    [...nums].sort(makeComparator<{ n: number }>({ value: (r) => r.n, dir: "asc" })).map((r) => r.n),
    [9, 20, 100]
  );
});
