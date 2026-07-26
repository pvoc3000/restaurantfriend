// "Which sub-section was I last on in each section?"
//
// The old system did this and it's most of why its menu felt fast: you left
// Purchasing on Purchase Orders, went to HR, came back, and you were on
// Purchase Orders again. First visit to a section lands on its first sub.
//
// A SESSION cookie, same reasoning and same shape as rf.guide.view (see
// lib/orderGuide.ts): this is per-session state, not per-user config, so it
// lasts until you log out — signOut() deletes it. Encoded as a query string
// rather than JSON so parsing is total and each entry validates on its own.
//
// The live store that keeps this fresh as you navigate is lib/navMemoryStore.ts;
// this file is the pure half, imported by both the server and the client.

import { SECTIONS, findSection, findSub } from "@/lib/nav";

export const NAV_COOKIE = "rf.nav";

/** section slug → sub slug. Only visited sections appear. */
export type NavMemory = Record<string, string>;

export const EMPTY_NAV_MEMORY: NavMemory = {};

/**
 * Tolerant of anything: a stale or hand-edited cookie loses only the entries
 * that no longer make sense. A section that was renamed, or a sub that was
 * removed, simply falls back to that section's first sub.
 */
export function parseNavMemory(raw: string | undefined | null): NavMemory {
  if (!raw) return EMPTY_NAV_MEMORY;

  const memory: NavMemory = {};
  for (const [sectionSlug, subSlug] of new URLSearchParams(raw)) {
    const section = findSection(sectionSlug);
    if (!section) continue;
    if (!findSub(section, subSlug)) continue;
    memory[sectionSlug] = subSlug;
  }
  return memory;
}

export function serializeNavMemory(memory: NavMemory): string {
  // Written in SECTIONS order so the cookie is stable and diffable, and so a
  // key that isn't a real section can't sneak in from a caller.
  const params = new URLSearchParams();
  for (const section of SECTIONS) {
    const subSlug = memory[section.slug];
    if (subSlug && findSub(section, subSlug)) params.set(section.slug, subSlug);
  }
  return params.toString();
}
