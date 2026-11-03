"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * A SEARCH LOOKS PAST THE DATE WINDOW TOO (Mark, 2026-11-03: "date ranges
 * across the whole app should also be paused when using the search bar").
 *
 * On most lists that is the client rule in `lib/filterMenus`' `searchingValues`.
 * The lists whose window is a SERVER filter only ever loaded the window's rows,
 * so pausing the picker alone would search a month and call it everything.
 * Their pages read `?q=` and widen what they load while it has text; this hook
 * is the client half — it re-runs the page when what the page loaded no longer
 * matches what the search wants.
 *
 * `wanted` and `loaded` are keys, compared as strings, so one hook serves both
 * kinds of page:
 *
 * - **All dates while searching** (special orders, shift reports, batch logs):
 *   the key is `"all"` or `""`, so only starting or clearing a search re-runs
 *   the page. Every keystroke in between filters what is already loaded.
 * - **The search itself on the server** (bills, purchase orders, which cap at
 *   500 rows and could never hold every date): the key is the term, so the page
 *   re-runs as you type — DEBOUNCED, so a word is one trip, not five.
 *
 * `loaded` is what the server says it did, so a re-run that lands settles the
 * comparison — no loop, and a page that arrives with `?q=` set needs no second
 * trip. The stored window is untouched, so clearing the search loads it again.
 */
export function useSearchLoadsAllDates(
  wanted: string,
  loaded: string,
  href: () => string,
  delayMs = 350
) {
  const router = useRouter();
  // The href at fire time, through a ref, so the effect keys on the two
  // strings alone.
  const hrefRef = useRef(href);
  useEffect(() => {
    hrefRef.current = href;
  });
  useEffect(() => {
    if (wanted === loaded) return;
    const timer = window.setTimeout(
      () => router.replace(hrefRef.current(), { scroll: false }),
      delayMs
    );
    return () => window.clearTimeout(timer);
  }, [wanted, loaded, delayMs, router]);
}

/**
 * The address bar's own URL with `q` set to the search, or removed — for the
 * lists that otherwise keep their search out of the URL (shift reports, batch
 * logs), so the server can see that a search is on.
 */
export function hrefWithSearch(q: string): string {
  const url = new URL(window.location.href);
  if (q.trim()) url.searchParams.set("q", q.trim());
  else url.searchParams.delete("q");
  return url.pathname + url.search;
}
