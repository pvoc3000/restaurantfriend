"use client";

import { usePathname } from "next/navigation";

import { useScrollMemory, useScrollMemoryKeyOverride } from "@/lib/scrollMemory";

/**
 * Scroll restoration for EVERY screen (Mark, 2026-07-30: "any list view now and
 * in the future"). Rendered once by the (app) layout, so a new screen gets this
 * by existing — there is nothing to opt into and nothing to remember when
 * adding one.
 *
 * It renders nothing. It lives in the layout rather than in each page because
 * the layout survives navigation: one hook re-keyed on every move flushes the
 * page you're leaving and restores the one you're arriving at, in that order,
 * without either page having to know about it.
 *
 * The key is ACTIVE LOCATION + pathname. The location has to be in it because
 * every list here is location-scoped and switching location is a navigation to
 * the same URL — without it, DF01's position would be restored into DF02's
 * shorter list. The query string is deliberately NOT in it: filters and sort
 * live there and change constantly (the search box writes a key per keystroke),
 * and you always come back to the URL you left because that's what the
 * breadcrumb trail stamps. A screen whose identity isn't its path — the order
 * guide, seven lists at one URL — publishes its own key with
 * `useScrollMemoryKey`.
 *
 * Detail screens get it too. That's not scope creep: a PO with forty lines is
 * as much a list as the PO list is.
 */
export function ScrollMemory({ locationId }: { locationId: string | null }) {
  const pathname = usePathname();
  const override = useScrollMemoryKeyOverride();
  useScrollMemory(override ?? `${locationId ?? "anywhere"}:${pathname}`);
  return null;
}
