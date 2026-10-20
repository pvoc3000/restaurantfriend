// EACH NEW DAY STARTS ON THE START PAGE (Mark, 2026-10-20: "first new activity
// after being idle for a while, and it's the next day → go to /start"; a gap of
// three hours AND a new day; "a link should go to the link"; tablet also).
//
// Pure, fixture-tested. The browser half is `components/NewDayReturn` (desk and
// tablet) and the shared iPad's unlock (`components/lock/LockScreen`).
//
// BOTH CONDITIONS, on purpose. The date alone would bounce somebody working
// through midnight — the overnight bakers start 00:00–03:59, often already in
// the app; the gap alone would bounce a long lunch. The day is the ORG's (its
// timezone), never the device's idea of it.

import { localDateISO } from "./timeZone";

/** How long nothing must have happened before a new day counts. */
export const NEW_DAY_GAP_MS = 3 * 60 * 60 * 1000;

/** The device's last touch, for this rule — localStorage, every tab. */
export const DAY_ACTIVITY_KEY = "rf.day.active";

/** Where the person was when the new day sent them to Start — sessionStorage,
 *  so it belongs to the one tab that was moved. */
export const NEW_DAY_BACK_KEY = "rf.day.back";

/** How long Start offers the way back. Past this it is yesterday's news. */
const BACK_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Is `nowMs` the first touch of a new day? Three hours or more since
 * `previousMs`, AND a later date in `zone`. No previous touch (a new device, a
 * cleared browser) is not a new day: there is nothing to come back from.
 */
export function isNewDay(previousMs: number | null, nowMs: number, zone: string): boolean {
  if (previousMs === null || !Number.isFinite(previousMs) || !Number.isFinite(nowMs)) return false;
  if (nowMs - previousMs < NEW_DAY_GAP_MS) return false;
  return localDateISO(zone, nowMs) > localDateISO(zone, previousMs);
}

/** A stored timestamp, or null for missing or garbage. */
export function readMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A path that is safe to send somebody back to: same-origin, not the lock or
 *  sign-in screens, and not Start itself. */
export function isReturnablePath(path: unknown): path is string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  return !/^\/(start|lock|login|welcome)(\/|\?|#|$)/.test(path) && path !== "/";
}

export type BackPoint = { href: string; label: string; at: number };

export function serializeBack(point: BackPoint): string {
  return JSON.stringify(point);
}

/** The way back as stored, or null — nothing stored, malformed, or an unsafe
 *  path. `readBack` also applies the age limit. */
export function parseBack(raw: string | null | undefined): BackPoint | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { href, label, at } = parsed as Record<string, unknown>;
  if (!isReturnablePath(href) || typeof at !== "number" || !Number.isFinite(at)) return null;
  const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : "where you were";
  return { href, label: name, at };
}

/** The way back Start should offer, or null — `parseBack`'s refusals, and
 *  anything older than half a day. */
export function readBack(raw: string | null | undefined, nowMs: number): BackPoint | null {
  const point = parseBack(raw);
  if (!point || nowMs - point.at > BACK_TTL_MS || nowMs < point.at) return null;
  return point;
}
