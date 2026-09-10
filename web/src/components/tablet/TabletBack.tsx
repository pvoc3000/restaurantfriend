"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { tabletBackHref } from "@/lib/tablet/landing";
import { BAR_CELL, BAR_CELL_DEAD } from "./barCell";
import { BarLabel, ICON_ARROW_BACK } from "./BarLabel";

/**
 * The bar's Back. It reads the page's own URL — the breadcrumb `?from=` first,
 * the route's list second, home last (`tabletBackHref`) — so it always lands
 * somewhere that makes sense from HERE, whatever the shared iPad's history
 * holds. On the landing page there is nowhere back to be, and the cell stays
 * in place dead rather than vanishing: the bar's cells must not move about as
 * you go from screen to screen.
 */
export function TabletBack() {
  const pathname = usePathname();
  const search = useSearchParams();
  const params: Record<string, string | string[] | undefined> = {};
  search.forEach((value, key) => {
    const existing = params[key];
    params[key] = existing === undefined ? value : ([] as string[]).concat(existing, value);
  });
  const href = tabletBackHref(pathname, params);

  if (!href) {
    return (
      <span aria-hidden="true" className={BAR_CELL_DEAD}>
        <BarLabel icon={ICON_ARROW_BACK} word="Back" />
      </span>
    );
  }
  return (
    <Link href={href} className={BAR_CELL}>
      <BarLabel icon={ICON_ARROW_BACK} word="Back" />
    </Link>
  );
}
