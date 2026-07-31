// Which navigation chrome is on screen — the pure half (lib/chromeModeStore.ts
// is the live half). Split the same way lib/navMemory is split from
// lib/navMemoryStore, so the (app) layout, a SERVER component, can read the
// cookie without dragging a "use client" module into the server graph.
//
// A COOKIE rather than localStorage, which is where display preferences
// otherwise live (lib/chromeStore, lib/columnWidths, lib/receivingLayout). The
// convention holds for those because they change things INSIDE an already
// correct page shell, so a wrong first paint is invisible. This one decides the
// whole shell AND the content column's geometry: with localStorage a sidebar
// user gets the two black bands on every hard load and then a swap, and
// --rf-nav-w can only apply after hydration, so an 800-row order guide jumps
// sideways right after a 3.5s loading.tsx. Same argument as rf.guide.view,
// whose stated reason is that the server has to know before it renders.

export const CHROME_COOKIE = "rf.chrome.nav";

/**
 * `top`       — the two black bands across the top (components/AppNav), the
 *               original and still the default.
 * `side`      — the left rail, marks only.
 * `side-open` — the rail expanded to labels. A separate MODE rather than local
 *               component state because expanding PUSHES the content (Mark,
 *               2026-07-31, following Indeed), which means it changes the
 *               server-rendered geometry and the server has to know it.
 */
export type ChromeMode = "top" | "side" | "side-open";

export const DEFAULT_CHROME_MODE: ChromeMode = "top";

/**
 * A year. This is per-user configuration, like column widths — not "where you
 * were", like rf.nav and rf.guide.view. That is also why signOut deletes those
 * and leaves this one alone.
 */
export const CHROME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Total, like parseNavMemory: anything unrecognised falls back to the default. */
export function parseChromeMode(raw: string | undefined): ChromeMode {
  return raw === "side" || raw === "side-open" ? raw : DEFAULT_CHROME_MODE;
}
