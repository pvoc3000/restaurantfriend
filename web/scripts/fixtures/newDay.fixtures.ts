// Each new day starts on the Start page (lib/newDay).

import { eq, no, ok, test } from "./harness";
import { isNewDay, isReturnablePath, NEW_DAY_GAP_MS, readBack, readMs, serializeBack } from "../../src/lib/newDay";

const LA = "America/Los_Angeles";
// 2026-10-20 in Los Angeles is UTC-7.
const at = (iso: string) => Date.parse(iso);

test("newDay: last night to this morning is a new day", () => {
  ok(isNewDay(at("2026-10-20T22:00:00-07:00"), at("2026-10-21T06:30:00-07:00"), LA));
});

test("newDay: working through midnight is not — the gap is too short", () => {
  no(isNewDay(at("2026-10-20T23:30:00-07:00"), at("2026-10-21T00:15:00-07:00"), LA));
  no(isNewDay(at("2026-10-20T22:00:00-07:00"), at("2026-10-21T00:59:59-07:00"), LA), "2h59m59s");
  ok(isNewDay(at("2026-10-20T22:00:00-07:00"), at("2026-10-21T01:00:00-07:00"), LA), "exactly three hours");
});

test("newDay: a long gap on the same day is not — the date has to change", () => {
  no(isNewDay(at("2026-10-21T06:00:00-07:00"), at("2026-10-21T15:00:00-07:00"), LA));
});

test("newDay: the day is the org's, not UTC's", () => {
  // 18:00 and 21:30 in LA straddle UTC midnight (01:00Z and 04:30Z) — same LA day.
  no(isNewDay(at("2026-10-20T18:00:00-07:00"), at("2026-10-20T21:30:00-07:00"), LA));
});

test("newDay: no previous touch, or garbage, is never a new day", () => {
  no(isNewDay(null, at("2026-10-21T06:00:00-07:00"), LA));
  no(isNewDay(Number.NaN, at("2026-10-21T06:00:00-07:00"), LA));
  eq(readMs(null), null);
  eq(readMs("abc"), null);
  eq(readMs(String(NEW_DAY_GAP_MS)), NEW_DAY_GAP_MS);
});

test("newDay: only a same-origin page that isn't Start, lock or sign-in is returnable", () => {
  ok(isReturnablePath("/purchase-orders/abc?from=x"));
  for (const p of ["/", "/start", "/start?edit=1", "/lock", "/login", "//evil.com", "https://x", "/a\\b", 42]) {
    no(isReturnablePath(p), String(p));
  }
});

test("newDay: the way back expires after half a day and refuses unsafe paths", () => {
  const now = at("2026-10-21T07:00:00-07:00");
  const raw = serializeBack({ href: "/bills/1", label: "Bill 1", at: now - 60_000 });
  eq(readBack(raw, now)?.href, "/bills/1");
  eq(readBack(raw, now + 13 * 3600_000), null, "stale");
  eq(readBack(serializeBack({ href: "//evil.com", label: "x", at: now }), now), null);
  eq(readBack("{not json", now), null);
  eq(readBack(serializeBack({ href: "/bills/1", label: "  ", at: now }), now)?.label, "where you were");
});
