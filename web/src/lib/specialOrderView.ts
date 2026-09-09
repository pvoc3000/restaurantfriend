/**
 * REMEMBERING THE SPECIAL ORDERS LIST'S VIEW ACROSS A HARD LOAD.
 *
 * Mark, 2026-09-08: "make sure that the filter settings persist across page
 * loads. 'Upcoming' keeps getting set."
 *
 * They already persisted across everything EXCEPT a hard load, which is what
 * made this confusing to describe: the filters live in the URL
 * (`history.replaceState`), so a reload of the same address keeps them, and
 * `lib/navMemory`'s `paths` puts them back when you leave the section and come
 * back. But `paths` is IN MEMORY ONLY, deliberately — "a hard load has nothing
 * worth restoring" is true of a record somebody was reading yesterday and false
 * of a list's own filters. So opening the app, or reloading from `/`, landed on
 * a bare `/special-orders`, and a bare URL means the `view` dimension's default,
 * which is Upcoming.
 *
 * A SESSION COOKIE is this app's answer to exactly that, three times over
 * already — `rf.guide.view`, `rf.po.view`, `rf.invoice.view` — and the order
 * guide's stated reason applies here word for word: the nav link is a bare
 * path with no query to carry, AND the server has to know the view before it
 * queries (the window below the filters is `event_date >= a month ago` unless
 * the view is `past` or `all`).
 *
 * Per SESSION, not per user: it lasts until you log out, and
 * `clearSessionCookies` drops it so the next person on a shared iPad starts
 * from the defaults.
 *
 * WHAT IS STORED IS THE LIST'S OWN QUERY STRING, verbatim — whatever
 * `filterHref` just wrote. Not a parsed shape: the dimensions, their values and
 * the sort keys are the list's business, they have changed twice already, and a
 * second schema for them here is a second thing to keep in step. Reading it
 * back is `URLSearchParams`, and anything that no longer means something is
 * dropped by `parseFilterValues` exactly as a hand-edited URL would be.
 */

import type { RawSearchParams } from "./filterMenus";

export const SPECIAL_ORDER_VIEW_COOKIE = "rf.specialOrders.view";

/**
 * Every key the list writes into its own address — the six dimensions, the
 * search box, and the sort.
 *
 * IT EXISTS TO ANSWER ONE QUESTION: did this request carry a view of its own?
 * If it did, that view wins outright and the cookie is ignored, because
 * somebody following a link — a breadcrumb back from a record, a URL shared
 * with a colleague — must get the view the link describes and not a mixture of
 * it with whatever this browser last looked at.
 *
 * Which is also why the fallback REPLACES rather than merges. Merging would
 * quietly add this browser's other filters to a shared link, so a colleague
 * opening `?status=order` would get `?status=order` plus whichever kitchen you
 * happen to have selected.
 *
 * Keep it in step with `SpecialOrdersList`'s dimensions. A key missing here is
 * not a crash: the list still works, the cookie still stores it (the whole
 * query is stored verbatim), and the only cost is that a URL carrying ONLY that
 * key is not recognised as a view and would be overwritten by the cookie.
 */
export const SPECIAL_ORDER_VIEW_KEYS = [
  "q",
  "sort",
  "dir",
  "view",
  "status",
  "kind",
  "kitchen",
  "pickup",
  "todo",
] as const;

export function hasViewParams(params: RawSearchParams | null | undefined): boolean {
  if (!params) return false;
  return SPECIAL_ORDER_VIEW_KEYS.some((k) => {
    const v = params[k];
    // An EMPTY string is a real value here — `?q=` is a cleared search box,
    // which is a view somebody chose — but `undefined` is the key being absent.
    return v !== undefined;
  });
}

/** The stored query string, back as the shape every filter reader takes. */
export function parseSpecialOrderView(raw: string | undefined | null): RawSearchParams {
  if (!raw) return {};
  const params: RawSearchParams = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    // Repeated keys become arrays — `urlFilterParams`' own rule, and the two
    // must agree or a view restored from the cookie would differ from the same
    // view restored from the URL.
    const seen = params[key];
    if (seen === undefined) params[key] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else params[key] = [seen, value];
  }
  return params;
}

/**
 * The cookie's value for an href the list just wrote.
 *
 * Takes the href rather than the pieces so there is ONE serializer — whatever
 * `filterHref` produces is what comes back, including any dimension added
 * later that this module has never heard of.
 */
export function viewCookieValue(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? "" : href.slice(q + 1);
}
