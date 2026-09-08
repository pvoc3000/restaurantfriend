/**
 * The shared-iPad rules, pure. The cookies, the PIN shape, the idle limit and
 * the lockout arithmetic — everything the lock screen, the server actions and
 * migration 097 have to agree on, in one place so a fixture can pin it.
 *
 * Mark's decisions (2026-09-08): FOUR digits; FIVE minutes idle; a device is
 * not bound to a shop.
 *
 * The lockout thresholds here MIRROR `attempt_pin_unlock` in 097 and are not
 * read by it — SQL decides, under an advisory lock; this copy exists so the
 * screen can say "try again in twelve minutes" from the same rule, and so a
 * change to one is visible against the other in a fixture.
 */

/** httpOnly, a year, set by `registerThisDevice`. `${id}.${secret}`. */
export const DEVICE_COOKIE = "rf.device";
/**
 * httpOnly, session. Present exactly when the session was minted by a PIN —
 * which is what /account, the Admin tab and /settings read to refuse a
 * password change, a PIN change or a device registration. A PIN is not a
 * password.
 */
export const PIN_SESSION_COOKIE = "rf.pin_session";

export const PIN_LENGTH = 4;
export const IDLE_MS = 5 * 60_000;

const PIN_RE = /^[0-9]{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

export function isValidPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

export type DeviceCookie = { id: string; secret: string };

/** Null for anything that is not exactly `<uuid>.<64 hex>`. */
export function parseDeviceCookie(raw: string | undefined | null): DeviceCookie | null {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_RE.test(id) || !SECRET_RE.test(secret)) return null;
  return { id, secret };
}

export function serializeDeviceCookie(cookie: DeviceCookie): string {
  return `${cookie.id}.${cookie.secret}`;
}

/** True once `now` is IDLE_MS or more past the last activity. */
export function idleExpired(lastActivityMs: number, nowMs: number): boolean {
  return nowMs - lastActivityMs >= IDLE_MS;
}

export type PinAttempt = { userId: string | null; succeeded: boolean; at: number };

export const LOCKOUT = {
  devicePer15m: 10,
  userPer15m: 5,
  userPerDay: 20,
} as const;

const FIFTEEN_MIN = 15 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;

/**
 * Whether an unlock for `userId` on this device would be refused as `locked`,
 * and for how many seconds. Mirrors `attempt_pin_unlock`: the failures are
 * counted in a rolling window and the answer is the time until the oldest
 * counted one ages out of the window that tripped.
 */
export function lockoutFor(
  attempts: PinAttempt[],
  userId: string,
  nowMs: number
): { locked: false } | { locked: true; retryAfterSeconds: number } {
  const failed = attempts.filter((a) => !a.succeeded);
  const in15 = failed.filter((a) => a.at > nowMs - FIFTEEN_MIN);
  const userIn15 = in15.filter((a) => a.userId === userId);
  const userInDay = failed.filter((a) => a.userId === userId && a.at > nowMs - ONE_DAY);

  const until = (set: PinAttempt[], window: number) => {
    const oldest = Math.min(...set.map((a) => a.at));
    return Math.max(1, Math.ceil((oldest + window - nowMs) / 1000));
  };

  if (userInDay.length >= LOCKOUT.userPerDay) {
    return { locked: true, retryAfterSeconds: until(userInDay, ONE_DAY) };
  }
  if (userIn15.length >= LOCKOUT.userPer15m) {
    return { locked: true, retryAfterSeconds: until(userIn15, FIFTEEN_MIN) };
  }
  if (in15.length >= LOCKOUT.devicePer15m) {
    return { locked: true, retryAfterSeconds: until(in15, FIFTEEN_MIN) };
  }
  return { locked: false };
}

/** "Try again in 12 minutes" — never "in 0 minutes". */
export function retryLabel(seconds: number): string {
  if (seconds < 90) return "Try again in a minute.";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Try again in ${minutes} minutes.`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "Try again in an hour." : `Try again in ${hours} hours.`;
}
