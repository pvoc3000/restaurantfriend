// `lib/payLink` — the pay page's rules (migration 119).
//
// `toCents` is the one that moves money, so it was checked by BREAKING it:
// swapping `Math.round` for `Math.trunc` turns the floating-point test red
// (19.99 is 1998.999… cents in binary), which is the short charge the
// module's comment describes.

import { test, eq, ok } from "./harness";
import { payLine, payStateMessage, payUrl, squareScriptUrl, toCents } from "../../src/lib/payLink";

test("toCents: ordinary amounts", () => {
  eq(toCents(80), 8000);
  eq(toCents("80.00"), 8000, "numeric arrives as a string");
  eq(toCents(0.01), 1);
  eq(toCents(1234.5), 123450);
});

test("toCents: binary floating point does not charge a cent short", () => {
  eq(toCents(19.99), 1999);
  eq(toCents(0.29), 29);
  eq(toCents(1.005 + 0.005), 101, "a sum that lands a hair under a whole cent");
});

test("toCents: refuses what is not a whole number of cents", () => {
  eq(toCents(1.234), null);
  eq(toCents("abc"), null);
  eq(toCents(null), null);
  eq(toCents(undefined), null);
  eq(toCents(Number.NaN), null);
  eq(toCents(Number.POSITIVE_INFINITY), null);
});

test("squareScriptUrl: one host per environment", () => {
  eq(squareScriptUrl("sandbox"), "https://sandbox.web.squarecdn.com/v1/square.js");
  eq(squareScriptUrl("production"), "https://web.squarecdn.com/v1/square.js");
});

test("payUrl: the /q link's twin, trailing slash tolerated", () => {
  eq(payUrl("abc", "https://app.example.com"), "https://app.example.com/pay/abc");
  eq(payUrl("abc", "https://app.example.com/"), "https://app.example.com/pay/abc");
});

test("payLine: no link, no paragraph", () => {
  eq(payLine(""), "");
  ok(payLine("https://x/pay/abc").includes("https://x/pay/abc"));
});

test("payStateMessage: every non-open state has words, and they differ", () => {
  const states = ["unknown", "superseded", "cancelled", "paid", "busy", "unavailable"] as const;
  const titles = states.map((s) => payStateMessage(s).title);
  for (const [i, t] of titles.entries()) ok(t.length > 0, `${states[i]} has a title`);
  eq(new Set(titles).size, titles.length, "no two states read the same");
  eq(payStateMessage("open").title, "");
});
