// "Which SCREEN was I last on in each area?"
//
// The old system did this and it's most of why its menu felt fast: you left
// Purchasing on Purchase Orders, went to HR, came back, and you were on
// Purchase Orders again. This goes one step further (Mark, 2026-08-06): if what
// you were last looking at was a RECORD, that's where the tab takes you — "if we
// were looking at a list, we return to that. If it was a detail view, we return
// to that." First visit to a section still lands on its first sub.
//
// So there are two halves to the memory, and they are kept apart because they
// live for different lengths of time:
//
//   subs   section slug → sub slug. A SESSION cookie, same reasoning and same
//          shape as rf.guide.view (see lib/orderGuide.ts): per-session state,
//          not per-user config, so it lasts until you log out — signOut()
//          deletes it. Encoded as a query string rather than JSON so parsing is
//          total and each entry validates on its own.
//
//   paths  navPathKey() → the last url seen there. IN MEMORY ONLY, the call
//          `scrollMemory` and `recordSet` already made and for their reason: the
//          (app) layout survives soft navigation, so all the clicking this
//          exists for is one page load, while a hard load has nothing worth
//          restoring. Opening the app tomorrow and being dropped on a record
//          somebody was reading yesterday is the thing to avoid, and it also
//          keeps the cookie's size and meaning exactly as they were.
//
// The live store that keeps this fresh as you navigate is lib/navMemoryStore.ts;
// this file is the pure half, imported by both the server and the client.

// Relative, like the rest of lib: the fixture harness compiles these modules to
// CommonJS and plain Node has no idea what "@/" means.
import {
  SECTIONS,
  findSection,
  findSub,
  navPathKey,
  type NavMemoryLike,
  type NavPosition,
} from "./nav";

export const NAV_COOKIE = "rf.nav";

export type NavMemory = NavMemoryLike;

export const EMPTY_NAV_MEMORY: NavMemory = { subs: {}, paths: {} };

/**
 * Tolerant of anything: a stale or hand-edited cookie loses only the entries
 * that no longer make sense. A section that was renamed, or a sub that was
 * removed, simply falls back to that section's first sub.
 *
 * `paths` always comes back empty — the cookie has never carried one, and this
 * is the only place the server can seed from.
 */
export function parseNavMemory(raw: string | undefined | null): NavMemory {
  if (!raw) return EMPTY_NAV_MEMORY;

  const subs: Record<string, string> = {};
  for (const [sectionSlug, subSlug] of new URLSearchParams(raw)) {
    const section = findSection(sectionSlug);
    if (!section) continue;
    if (!findSub(section, subSlug)) continue;
    subs[sectionSlug] = subSlug;
  }
  return { subs, paths: {} };
}

export function serializeNavMemory(memory: NavMemory): string {
  // Written in SECTIONS order so the cookie is stable and diffable, and so a
  // key that isn't a real section can't sneak in from a caller. `paths` is
  // deliberately not written — see the header.
  const params = new URLSearchParams();
  for (const section of SECTIONS) {
    const subSlug = memory.subs[section.slug];
    if (subSlug && findSub(section, subSlug)) params.set(section.slug, subSlug);
  }
  return params.toString();
}

/**
 * Record where we are. The pure half of navMemoryStore's `remember`, so the rule
 * can be reasoned about — and fixture-tested — without a document to write a
 * cookie to.
 *
 * Returns the SAME OBJECT when nothing changed, which is not tidiness: the store
 * hands this to useSyncExternalStore, whose getSnapshot must be referentially
 * stable or React re-renders forever. Each map is preserved individually too, so
 * the store can tell from identity alone whether the cookie needs rewriting —
 * otherwise every record you opened would rewrite an identical cookie.
 */
export function rememberIn(
  memory: NavMemory,
  position: NavPosition,
  locationId: string | null,
  url: string
): NavMemory {
  const key = navPathKey(locationId, position.sectionSlug, position.subSlug);
  const subChanged = memory.subs[position.sectionSlug] !== position.subSlug;
  const pathChanged = memory.paths[key] !== url;
  if (!subChanged && !pathChanged) return memory;

  return {
    subs: subChanged
      ? { ...memory.subs, [position.sectionSlug]: position.subSlug }
      : memory.subs,
    paths: pathChanged ? { ...memory.paths, [key]: url } : memory.paths,
  };
}
