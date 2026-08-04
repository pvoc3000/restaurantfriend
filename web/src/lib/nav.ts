// The app's menu, in one place.
//
// Two tiers, inherited from DF Operations: a row of major SECTIONS and, under
// it, the SUB-SECTIONS of whichever section you're in. Staff navigated that way
// for thirteen years, so the structure is the old one; only the skin is new.
//
// Only Purchasing has real screens today. Everything else points at
// /soon/<section>/<sub>, a placeholder that names the screen and says it isn't
// built — so the shape of the product is walkable before it exists, and each
// module drops into a slot that already has a name. To ship one: set `built`
// and give it a real `href`.

import type { Role } from "./roles";

export type NavSub = {
  /** Stable id. This is what the remembered-menu cookie stores — renaming it
   *  invalidates that entry, which is harmless (it falls back to the first). */
  slug: string;
  /** The word staff use, not the route: /items is "Inventory". */
  label: string;
  href: string;
  built: boolean;
  /** Extra pathname prefixes that keep this sub lit — detail routes that don't
   *  sit under the sub's own href. */
  also?: string[];
  /**
   * Who sees this in the menu. Absent means everyone.
   *
   * This is a TIDINESS rule, never a security one: RLS decides what a screen
   * can actually load, and each gated screen says so in a sentence rather than
   * rendering an empty table. Hiding the tab only keeps the menu honest about
   * what's worth tapping.
   */
  roles?: Role[];
};

export type NavSection = {
  slug: string;
  label: string;
  subs: NavSub[];
};

/** Placeholder href for a screen that doesn't exist yet. */
function soon(section: string, sub: string): NavSub["href"] {
  return `/soon/${section}/${sub}`;
}

function stub(section: string, slug: string, label: string): NavSub {
  return { slug, label, href: soon(section, slug), built: false };
}

export const SECTIONS: NavSection[] = [
  {
    slug: "location",
    // Labelled with the active location's code (DF01, DF02…), never the word
    // "Location" — see sectionLabel(). The old system did the same: the tab
    // told you where you were working before you looked anywhere else. Since
    // the switcher went, this is also the only place the code is on screen at
    // every scroll position (with HeaderShell's collapsed strip).
    label: "Location",
    subs: [
      // A list of all six, and where the working location is chosen (Mark,
      // 2026-08-01) — this replaced the masthead switcher. It used to be a
      // singular, id-less /location showing whichever one you were working at.
      { slug: "locations", label: "Locations", href: "/locations", built: true },
      {
        slug: "shop-sections",
        label: "Shop Sections",
        href: "/shop-sections",
        built: true,
      },
      stub("location", "tasks", "Tasks"),
      stub("location", "maintenance-requests", "Maintenance Requests"),
      stub("location", "inspection-logs", "Inspection Logs"),
      stub("location", "purchase-requests", "Purchase Requests"),
    ],
  },
  {
    slug: "hr",
    label: "HR",
    subs: [
      {
        slug: "employees",
        label: "Employees",
        href: "/employees",
        built: true,
        // Migration 020 gates the employee record at owner/admin. The screen
        // says so itself for anyone who reaches it by URL — this only keeps
        // the tab out of the menu for people it would never open for.
        roles: ["owner", "admin"],
      },
      stub("hr", "team-events", "Team Events"),
      stub("hr", "team-ratings", "Team Ratings"),
      stub("hr", "team-reviews", "Team Reviews"),
      stub("hr", "pay-periods", "Pay Periods"),
      stub("hr", "time-sheets", "Time Sheets"),
    ],
  },
  {
    slug: "operations",
    label: "Operations",
    subs: [
      stub("operations", "shift-reports", "Shift Reports"),
      stub("operations", "documents", "Documents"),
      stub("operations", "policies", "Policies"),
      stub("operations", "check-lists", "Check Lists"),
      stub("operations", "master-check-lists", "Master Check Lists"),
      stub("operations", "tags", "Tags"),
      stub("operations", "prices", "Prices"),
    ],
  },
  {
    slug: "production",
    label: "Production",
    subs: [
      stub("production", "item-schedules", "Item Schedules"),
      stub("production", "items", "Items"),
      stub("production", "elements", "Elements"),
      stub("production", "production-schedules", "Production Schedules"),
      stub("production", "recipes", "Recipes"),
      stub("production", "recipe-items", "Recipe Items"),
      stub("production", "batch-logs", "Batch Logs"),
    ],
  },
  {
    slug: "purchasing",
    label: "Purchasing",
    subs: [
      {
        slug: "vendors",
        label: "Vendors",
        href: "/vendors",
        built: true,
        // A vendor item is reachable from both Vendors and Inventory; Vendors
        // is the closer parent, so it keeps the light.
        also: ["/vendor-items"],
      },
      { slug: "inventory", label: "Inventory", href: "/items", built: true },
      { slug: "order-guide", label: "Order Guide", href: "/order-guide", built: true },
      {
        slug: "purchase-orders",
        label: "Purchase Orders",
        href: "/purchase-orders",
        built: true,
      },
      // After Purchase Orders, which is the order the work happens in: you
      // order, you receive, you owe. `resolveRoute` prefix-matches, so
      // /invoices/[id] lights this without an `also`.
      { slug: "invoices", label: "Invoices", href: "/invoices", built: true },
      // Last on purpose: a migration-era tool, easy to drop when the catalog
      // is clean.
      { slug: "cleanup", label: "Cleanup", href: "/cleanup", built: true },
    ],
  },
  {
    slug: "special-orders",
    label: "Special Orders",
    subs: [
      stub("special-orders", "special-orders", "Special Orders"),
      stub("special-orders", "customers", "Customers"),
    ],
  },
];

export function findSection(slug: string): NavSection | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

/**
 * The menu as this role should see it — subs whose `roles` exclude them are
 * dropped, and a section left with nothing goes too.
 *
 * Computed on the SERVER (AppHeader holds the session) and handed to AppNav as
 * a prop, so the role never has to cross into the client bundle and the
 * decision lives in one place.
 */
export function sectionsForRole(role: Role): NavSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    subs: section.subs.filter((sub) => !sub.roles || sub.roles.includes(role)),
  })).filter((section) => section.subs.length > 0);
}

export function findSub(section: NavSection, slug: string): NavSub | undefined {
  return section.subs.find((s) => s.slug === slug);
}

/**
 * The location section wears the active location's code. Falls back to the
 * generic word when there's no location at all (an org with none seeded).
 */
export function sectionLabel(section: NavSection, locationCode: string | null): string {
  return section.slug === "location" ? (locationCode ?? section.label) : section.label;
}

export type NavPosition = { sectionSlug: string; subSlug: string };

/** A path matches an href if it IS it or sits under it — /items must not
 *  match /items-archive. */
function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which tabs light up for a pathname, or null for routes that belong to no
 * section — Home and Settings are utilities, not sections, and deliberately
 * light nothing (the second tier hides entirely there).
 *
 * Detail routes keep their section AND sub lit: /vendors/9 is still Vendors.
 * The longest match wins, so a sub whose href is a prefix of another's can't
 * steal it.
 */
export function resolveRoute(pathname: string): NavPosition | null {
  const soonMatch = /^\/soon\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (soonMatch) {
    const section = findSection(soonMatch[1]);
    const sub = section && findSub(section, soonMatch[2]);
    return section && sub ? { sectionSlug: section.slug, subSlug: sub.slug } : null;
  }

  let best: { position: NavPosition; length: number } | null = null;
  for (const section of SECTIONS) {
    for (const sub of section.subs) {
      if (!sub.built) continue;
      for (const href of [sub.href, ...(sub.also ?? [])]) {
        if (under(pathname, href) && (!best || href.length > best.length)) {
          best = {
            position: { sectionSlug: section.slug, subSlug: sub.slug },
            length: href.length,
          };
        }
      }
    }
  }
  return best?.position ?? null;
}

/**
 * Where a section tab goes: the sub you last used there, or its first sub the
 * first time you visit. `memory` comes from the rf.nav cookie — see
 * lib/navMemory.ts for why it's threaded through the client rather than read
 * from the cookie on every render.
 */
export function sectionHref(section: NavSection, memory: Record<string, string>): string {
  const remembered = memory[section.slug];
  const sub = (remembered ? findSub(section, remembered) : undefined) ?? section.subs[0];
  return sub.href;
}
