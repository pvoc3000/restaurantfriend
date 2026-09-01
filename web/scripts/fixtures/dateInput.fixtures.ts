// `lib/dateInput` — typing and pasting a date.
//
// Every rule here was checked by BREAKING it: dropping the round trip turns the
// February cases green-on-the-wrong-answer, and swapping the US order turns
// four red.

import { test, eq } from "./harness";
import { parseTypedDate, formatTypedDate } from "../../src/lib/dateInput";

const iso = (raw: string) => {
  const out = parseTypedDate(raw);
  return out.status === "date" ? out.iso : out.status;
};

/* -- the ordinary ways somebody types a date ------------------------------ */

test("US order is the default reading", () => {
  eq(iso("9/1/2026"), "2026-09-01");
  eq(iso("09/01/2026"), "2026-09-01");
  eq(iso("12/25/2026"), "2026-12-25");
});

test("dashes, dots and spaces separate as well as slashes", () => {
  eq(iso("9-1-2026"), "2026-09-01");
  eq(iso("9.1.2026"), "2026-09-01");
  eq(iso("9 1 2026"), "2026-09-01");
});

test("a two-digit year is this century", () => {
  eq(iso("9/1/26"), "2026-09-01");
  eq(iso("1/5/99"), "2099-01-05");
});

test("surrounding whitespace is somebody's paste, not a typo", () => {
  eq(iso("  9/1/2026  "), "2026-09-01");
});

/* -- pasting, which is the half a native date input simply cannot do ------ */

test("a pasted ISO date is read as ISO, not as US", () => {
  // The four-digit FIRST part is the whole rule. Read US-first this would be
  // month 2026, which is nothing.
  eq(iso("2026-09-01"), "2026-09-01");
  eq(iso("2026/09/01"), "2026-09-01");
});

test("a pasted timestamp keeps its date", () => {
  eq(iso("2026-09-01T00:00:00Z"), "2026-09-01");
  eq(iso("2026-09-01 14:30:00+00"), "2026-09-01");
});

test("eight bare digits split by their leading pair", () => {
  eq(iso("20260901"), "2026-09-01");
  eq(iso("09012026"), "2026-09-01");
  // 19xx is a year too — a date of birth is the one field that reaches back.
  eq(iso("19850612"), "1985-06-12");
});

/* -- the refusals, which is most of what this is for ---------------------- */

test("an empty box is CLEARING, not a typo", () => {
  // The distinction the three-state result exists for: empty writes null, an
  // unreadable string reverts. Merging them would erase the date somebody was
  // in the middle of correcting.
  eq(iso(""), "empty");
  eq(iso("   "), "empty");
});

test("a day that does not exist is refused, not rolled over", () => {
  // `new Date("2026-02-31")` is March 2nd and does not throw. Without the round
  // trip this stores a date in the wrong MONTH and says nothing.
  eq(iso("2/31/2026"), "invalid");
  eq(iso("2026-02-31"), "invalid");
  eq(iso("4/31/2026"), "invalid");
});

test("February 29th is refused in a common year and kept in a leap year", () => {
  eq(iso("2/29/2025"), "invalid");
  eq(iso("2/29/2024"), "2024-02-29");
});

test("out-of-range parts are refused as themselves", () => {
  eq(iso("13/1/2026"), "invalid");
  eq(iso("9/32/2026"), "invalid");
  eq(iso("0/1/2026"), "invalid");
  eq(iso("9/0/2026"), "invalid");
});

test("text that is not a date reverts", () => {
  eq(iso("tomorrow"), "invalid");
  eq(iso("9/1"), "invalid");
  eq(iso("2026"), "invalid");
  eq(iso("9//2026"), "invalid");
  eq(iso("1234567"), "invalid");
});

test("a three-digit year is not guessed at", () => {
  eq(iso("9/1/202"), "invalid");
});

/* -- and back out again --------------------------------------------------- */

test("the box shows what a native date input showed", () => {
  // Zero-padded, US-ordered. This replaces `<input type="date">` on every
  // screen at once, so anything else moves fifty fields nobody asked to move.
  eq(formatTypedDate("2026-09-01"), "09/01/2026");
  eq(formatTypedDate("2026-12-25"), "12/25/2026");
});

test("no date shows nothing at all", () => {
  eq(formatTypedDate(null), "");
  eq(formatTypedDate(undefined), "");
  eq(formatTypedDate(""), "");
});

test("what the box shows parses back to what it came from", () => {
  // The property that keeps a blur from changing a value nobody touched.
  for (const d of ["2026-09-01", "2024-02-29", "1985-06-12", "2026-12-31"]) {
    eq(iso(formatTypedDate(d)), d, d);
  }
});
