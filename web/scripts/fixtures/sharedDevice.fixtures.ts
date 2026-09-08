// lib/sharedDevice — the shared-iPad rules: the PIN shape, the device cookie,
// the idle limit and the lockout arithmetic that MIRRORS 097's
// `attempt_pin_unlock`. SQL decides; these exist so the screen's copy of the
// rule cannot drift from it in silence.

import {
  IDLE_MS,
  LOCKOUT,
  idleExpired,
  isValidPin,
  lockoutFor,
  parseDeviceCookie,
  retryLabel,
  serializeDeviceCookie,
  type PinAttempt,
} from "../../src/lib/sharedDevice";
import { eq, no, ok, test } from "./harness";

const ID = "6ec6508c-1111-4222-8333-444444444444";
const SECRET = "ab".repeat(32);

test("isValidPin: exactly four digits", () => {
  ok(isValidPin("0420"), "leading zero is a digit");
  ok(isValidPin("1234"));
  no(isValidPin("123"), "three");
  no(isValidPin("12345"), "five");
  no(isValidPin("12a4"), "a letter");
  no(isValidPin(" 1234"), "leading space");
  no(isValidPin("1234\n"), "trailing newline");
  no(isValidPin(""), "empty");
});

test("device cookie: round trip", () => {
  const raw = serializeDeviceCookie({ id: ID, secret: SECRET });
  eq(raw, `${ID}.${SECRET}`);
  eq(parseDeviceCookie(raw), { id: ID, secret: SECRET });
});

test("device cookie: anything malformed is not a device", () => {
  eq(parseDeviceCookie(undefined), null, "absent");
  eq(parseDeviceCookie(""), null, "empty");
  eq(parseDeviceCookie(ID), null, "no secret");
  eq(parseDeviceCookie(`${ID}.${SECRET.slice(1)}`), null, "short secret");
  eq(parseDeviceCookie(`${ID}.${SECRET.toUpperCase()}`), null, "upper-case hex");
  eq(parseDeviceCookie(`not-a-uuid.${SECRET}`), null, "bad id");
  eq(parseDeviceCookie(`${ID}.${SECRET}.extra`), null, "trailing junk");
});

test("idleExpired: five minutes, inclusive at the boundary", () => {
  eq(IDLE_MS, 5 * 60_000, "Mark's five minutes");
  no(idleExpired(1_000_000, 1_000_000 + IDLE_MS - 1), "one ms short");
  ok(idleExpired(1_000_000, 1_000_000 + IDLE_MS), "exactly five minutes");
  ok(idleExpired(1_000_000, 1_000_000 + IDLE_MS * 3), "long gone");
});

const NOW = 1_700_000_000_000;
const U = "u1";
const V = "u2";
function fails(user: string | null, n: number, spacingMs = 1_000, startAgoMs = 60_000): PinAttempt[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: user,
    succeeded: false,
    at: NOW - startAgoMs + i * spacingMs,
  }));
}

test("lockoutFor: four failures is not locked, five is", () => {
  eq(lockoutFor(fails(U, 4), U, NOW), { locked: false });
  const r = lockoutFor(fails(U, 5), U, NOW);
  ok(r.locked, "fifth failure locks");
  if (r.locked) {
    // Oldest failure was 60s ago; the window is 15 minutes.
    eq(r.retryAfterSeconds, 14 * 60, "seconds until the oldest ages out");
  }
});

test("lockoutFor: a success is not a failure", () => {
  const set = [...fails(U, 4), { userId: U, succeeded: true, at: NOW - 30_000 }];
  eq(lockoutFor(set, U, NOW), { locked: false });
});

test("lockoutFor: one person's failures do not lock another", () => {
  eq(lockoutFor(fails(U, 5), V, NOW), { locked: false });
});

test("lockoutFor: failures outside fifteen minutes age out", () => {
  const old = fails(U, 5, 1_000, 16 * 60_000);
  eq(lockoutFor(old, U, NOW), { locked: false });
});

test("lockoutFor: ten failures on the device lock everybody", () => {
  const spread = [...fails(U, 4), ...fails(V, 4), ...fails(null, 2)];
  eq(spread.length, LOCKOUT.devicePer15m);
  const r = lockoutFor(spread, "u3", NOW);
  ok(r.locked, "a third person is refused too");
});

test("lockoutFor: twenty in a day locks for the rest of it", () => {
  // Spread over 20 hours, never five within any fifteen minutes.
  const spread = Array.from({ length: 20 }, (_, i) => ({
    userId: U,
    succeeded: false,
    at: NOW - 20 * 60 * 60_000 + i * 60 * 60_000,
  }));
  const r = lockoutFor(spread, U, NOW);
  ok(r.locked, "day cap");
  if (r.locked) eq(r.retryAfterSeconds, 4 * 60 * 60, "until the oldest is a day old");
});

test("retryLabel: never says zero", () => {
  eq(retryLabel(1), "Try again in a minute.");
  eq(retryLabel(89), "Try again in a minute.");
  eq(retryLabel(90), "Try again in 2 minutes.");
  eq(retryLabel(14 * 60), "Try again in 14 minutes.");
  eq(retryLabel(60 * 60), "Try again in an hour.");
  eq(retryLabel(4 * 60 * 60), "Try again in 4 hours.");
});
