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
      // Pay Periods used to sit here, and it went on 2026-08-06 (Mark: "since
      // pay periods are now on the timesheet screen, there's no need for a pay
      // period menu item"). Both its screens folded into Timesheets — the list's
      // only job was choosing a fortnight, which that screen's picker does, and
      // the record became its "Export timesheets…" panel. `/pay-periods*` still
      // resolves, as redirect shims, which is what the `also` below is for.
      //
      // Known consequence: 027 makes pay_periods readable by ANY member, and
      // that list was the whole of what the permission bought a supervisor.
      // Nothing they could act on is lost — the tip writer `report_pooled_tips`
      // has never had a surface they can reach — but that missing screen is now
      // the obvious next one.
      {
        slug: "timesheets",
        label: "Timesheets",
        href: "/timesheets",
        built: true,
        also: ["/pay-periods"],
        // Migration 028 gates timesheets at owner/admin on every verb, select
        // included — what a named person was paid for is the same class of fact
        // as their home address. The screen says so itself for anyone who
        // reaches it by URL; this only keeps the tab out of the menu for people
        // it would never open for.
        roles: ["owner", "admin"],
      },
      {
        slug: "payroll-benefits",
        // "Benefits" (Mark, 2026-08-06). This read "Payroll Benefits" on the
        // grounds that the bare word in an HR menu reads as health insurance,
        // which this is emphatically not — that argument was OVERRULED, not
        // forgotten, and it assumed a sibling would lend the context that
        // Timesheets keeping its own name means there isn't one. If anyone ever
        // does take this for medical cover, that is the note to reread.
        label: "Benefits",
        href: "/payroll-benefits",
        built: true,
        // 033 makes payroll_benefits readable by any member — it names no
        // person. The tab is still gated, because the screen is only useful to
        // whoever also maintains the entitlements, which IS owner/admin.
        roles: ["owner", "admin"],
      },
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
      // The production price grid (decision 10). It lives under Operations
      // because that is the slot FileMaker's own price screen occupied, and
      // because the grid prices the MENU rather than describing one item — if
      // it turns out staff look for it under Production, move this line.
      { slug: "prices", label: "Prices", href: "/price-grid", built: true },
    ],
  },
  {
    slug: "production",
    label: "Production",
    // FMP's seven, reworked to this module's own vocabulary (production brief,
    // Terminology): "Item Schedules" was its name for PLANS and "Prod
    // Schedules" for the committed day, which is the ambiguity decision 1
    // exists to kill. Recipe Items is gone entirely — decision 2 merges it into
    // Elements, so a menu item for it would name a table that no longer exists.
    subs: [
      { slug: "plans", label: "Plans", href: "/plans", built: true },
      // `resolveRoute` prefix-matches, so /schedules/[id] lights this without
      // an `also`. The derived day is a sibling screen rather than a sub of its
      // own: it is what generation is ABOUT to write, so it belongs to the same
      // tab as the record it becomes.
      {
        slug: "schedules",
        label: "Schedules",
        href: "/schedules",
        built: true,
        also: ["/production-day"],
      },
      { slug: "items", label: "Items", href: "/production-items", built: true },
      { slug: "elements", label: "Elements", href: "/elements", built: true },
      { slug: "recipes", label: "Recipes", href: "/recipes", built: true },
      // Element actuals — phase 5. `resolveRoute` prefix-matches, so a log
      // record lights this without an `also`. There is deliberately no route
      // for a single BATCH: it is only ever worked in the pinned pane on its
      // log (Mark, 2026-08-09 — "there will never be any use for the standalone
      // batch log item record").
      { slug: "batch-logs", label: "Batch Logs", href: "/batch-logs", built: true },
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
    // The section already existed as two stubs, which answers the brief's own
    // open question about placement: a tier-1 section, not a pair of subs under
    // Operations. `resolveRoute` prefix-matches, so /special-orders/[id],
    // /customers/[id] and the receive-style child routes light these without an
    // `also`.
    //
    // Both are supervisor+ (decision 7) — a TIDINESS rule, never a security
    // one: RLS is the gate and each screen says so in a sentence. Staff have no
    // screen that needs a customer's phone number, so a menu item leading to a
    // refusal is worse than no menu item.
    subs: [
      {
        slug: "special-orders",
        label: "Special Orders",
        href: "/special-orders",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      {
        slug: "customers",
        label: "Customers",
        href: "/customers",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
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
 * What the menu remembers. Declared HERE rather than imported from
 * lib/navMemory, because that module imports THIS one — the dependency has to
 * keep running one way, which is also why `sectionHref` has always taken its
 * memory structurally.
 */
export type NavMemoryLike = {
  /** section slug → sub slug. The whole content of the rf.nav cookie. */
  subs: Record<string, string>;
  /** navPathKey() → the last url seen there. In memory only. */
  paths: Record<string, string>;
};

/**
 * Where the last url for a sub-section is filed.
 *
 * Per SUB, because tier 2 needs its own answer and tier 1 reaches its answer
 * through the sub it remembers. Per LOCATION, because a remembered purchase
 * order or shop section is a location-scoped row — the problem
 * `clearScrollMemory()` exists for, solved by keying instead of clearing, so
 * coming back to DF01 finds DF01's record again. The cost is that switching
 * shops also forgets the org-level records (an employee), which is conservative
 * and never wrong.
 */
export function navPathKey(
  locationId: string | null,
  sectionSlug: string,
  subSlug: string
): string {
  return `${locationId ?? "anywhere"}|${sectionSlug}/${subSlug}`;
}

function rememberedHref(
  section: NavSection,
  sub: NavSub,
  memory: NavMemoryLike,
  locationId: string | null
): string | undefined {
  return memory.paths[navPathKey(locationId, section.slug, sub.slug)];
}

/**
 * Where a section tab goes: the last SCREEN you had open there — list or record
 * — or the sub you last used, or its first sub the first time you visit.
 *
 * The tab for the section you are ALREADY in goes to the list instead (Mark,
 * 2026-08-06). That's the escape hatch: a tab whose only destination was the
 * record you're standing on would be a no-op, and "back to the top of this
 * area" is what pressing your own tab has always meant.
 */
export function sectionHref(
  section: NavSection,
  memory: NavMemoryLike,
  locationId: string | null,
  activeSectionSlug: string | null
): string {
  const remembered = memory.subs[section.slug];
  const sub = (remembered ? findSub(section, remembered) : undefined) ?? section.subs[0];
  if (section.slug === activeSectionSlug) return sub.href;
  return rememberedHref(section, sub, memory, locationId) ?? sub.href;
}

/** The same rule one tier down, so Employees → Timesheets → Employees comes back
 *  to the employee you were reading. */
export function subHref(
  section: NavSection,
  sub: NavSub,
  memory: NavMemoryLike,
  locationId: string | null,
  activeSubSlug: string | null
): string {
  if (sub.slug === activeSubSlug) return sub.href;
  return rememberedHref(section, sub, memory, locationId) ?? sub.href;
}
