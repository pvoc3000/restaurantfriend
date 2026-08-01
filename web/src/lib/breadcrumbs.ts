// Breadcrumbs that follow the route you actually took, not a fixed hierarchy.
//
// An inventory item can be reached from the Inventory list OR from a vendor's
// item list, and "back" should mean different things in each case. Every link
// into a detail screen stamps where it came from in the query string; because
// the recorded href carries its own `from`, the trail nests without needing a
// separate parameter per level.
//
// It lives in the URL (not sessionStorage) so a reload, a shared link, and the
// browser's own Back button all agree on the trail.

import type { RawSearchParams } from "./itemFilters";

export type Crumb = { href: string; label: string };

/** Deeper than this and the URL gets silly; the oldest crumbs drop off. */
const MAX_DEPTH = 4;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Drop everything deeper than `depth` from a recorded href's own trail. Each
 * hop nests (and re-encodes) the whole previous URL, so without this the query
 * string roughly doubles per level — a few hops of vendor → item → vendor would
 * produce a URL long enough to break.
 */
function trimTrail(href: string, depth: number): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  const nestedHref = params.get("from");

  if (!nestedHref || !params.get("fromLabel")) return href;

  if (depth <= 0) {
    params.delete("from");
    params.delete("fromLabel");
  } else {
    params.set("from", trimTrail(nestedHref, depth - 1));
  }

  const trimmed = params.toString();
  return trimmed ? `${path}?${trimmed}` : path;
}

/**
 * The path a crumb points at, without its query — which is the key its list
 * publishes a found set under (`lib/recordSet`), and so how a detail screen
 * works out which pile of records it's sitting in.
 *
 * It lives HERE rather than beside the record set because the callers are
 * server components: `lib/recordSet` is a "use client" module, and a server
 * component can import a function from one but never call it.
 */
export function crumbPath(crumb: Crumb | undefined): string | null {
  if (!crumb) return null;
  const path = crumb.href.split("?")[0];
  return path.startsWith("/") ? path : null;
}

/** Stamp `from` onto a link so the destination knows where you came from. */
export function withFrom(href: string, from: Crumb): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  // -2: the crumb being stamped is itself one level, and the destination page
  // is another, so its own trail may carry at most MAX_DEPTH - 2 ancestors.
  params.set("from", trimTrail(from.href, MAX_DEPTH - 2));
  params.set("fromLabel", from.label);
  return `${path}?${params.toString()}`;
}

/**
 * Re-serialize the params a page was rendered with, so it can record ITSELF as
 * a crumb without losing the trail that led to it.
 */
export function currentQuery(params: RawSearchParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = one(value);
    if (single) search.set(key, single);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Rebuild the trail, oldest first, by walking the nested `from` links. Returns
 * `[fallback]` when you arrived directly, so a pasted URL still shows its
 * section rather than a bare page.
 */
export function parseTrail(params: RawSearchParams, fallback: Crumb): Crumb[] {
  const trail: Crumb[] = [];
  let href = one(params.from);
  let label = one(params.fromLabel);

  while (href && label && trail.length < MAX_DEPTH) {
    trail.unshift({ href, label });
    const nested = new URLSearchParams(href.split("?")[1] ?? "");
    href = nested.get("from") ?? "";
    label = nested.get("fromLabel") ?? "";
  }

  return trail.length > 0 ? trail : [fallback];
}
