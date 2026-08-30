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
    // Just the word (Mark, 2026-08-27). This tab wore the active location's
    // CODE from 2026-08-01, when the masthead switcher was deleted and the tab
    // became the only place the code stayed on screen. The switcher is back —
    // `components/WorkingLocation`, at the far right of the same row — so the
    // code is stated by the control that SETS it, and a tab that named a shop
    // while leading to a list of all six can go back to naming the list.
    label: "Locations",
    subs: [
      // A list of all six, and one of the two places the working location is
      // chosen (Mark, 2026-08-01) — this replaced the masthead switcher, which
      // came back beside it on 2026-08-27. It used to be a singular, id-less
      // /location showing whichever one you were working at.
      //
      // Labelled "All", not "Locations" (Mark, 2026-08-27): the band above it
      // says Locations, so the sub only has to say WHICH of them — the same
      // trim that made HR's "Team Ratings" just "Events". The slug is
      // untouched, which is what the nav cookie stores.
      { slug: "locations", label: "All", href: "/locations", built: true },
      {
        slug: "shop-sections",
        label: "Shop Sections",
        href: "/shop-sections",
        built: true,
      },
      // ── The facility-checks module (migrations 075–077) ────────────────
      //
      // Checklists came HERE from Operations (Mark, 2026-08-29: "I sort of feel
      // I misplaced the location of checklists in the menu and they should
      // probably be part of the location menu set"). The two stubs that used to
      // sit under Operations — "Check Lists" and "Master Check Lists" — are
      // gone, and this is the rule the nav has always followed rather than a
      // change of mind: the menu is organised by THE WORK, and every entry
      // below is about the BUILDING. That is the same argument that put
      // purchase requests under Purchasing, where the work is the catalog and
      // the order.
      //
      // They are one module in four costumes — a checklist run, a walkthrough
      // and an inspection are all OBSERVATIONS, and a task and a maintenance
      // request are the same WORK at two levels of escalation — so they sit
      // together and read in the order you meet them: walk the list, maintain
      // the list, work what came out of it, then the register of things the
      // whole module points at.
      //
      // supervisor+ on the three that write; Templates and Equipment are
      // unrestricted because their READ is membership (076/075's own RLS), and
      // everyone should be able to see what they will be asked and to resolve
      // the name of the thing they are asked about. Tidiness only — RLS is the
      // gate and each screen says so in a sentence.
      {
        // ONE ENTRY, TWO VIEWS (Mark, 2026-08-30): "instead of having a
        // checklist and master checklist menu options, what about just having a
        // Checklist screen with tab picker". The walks and the templates are
        // the same subject at two moments, and two adjacent entries made you
        // decide which one you wanted before you could look at either.
        //
        // `also` carries the retired `/checklist-templates` — a redirect shim
        // for the list, and the still-live address of the template RECORD — so
        // both light this tab. `/timesheets` does the same for `/pay-periods`.
        slug: "checklists",
        label: "Checklists",
        href: "/checklists",
        built: true,
        also: ["/checklist-templates"],
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      {
        slug: "tasks",
        label: "Tasks",
        href: "/tasks",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      {
        // "Maintenance", not "Maintenance Requests" — same trim. The SLUG keeps
        // FileMaker's word because the `rf.nav` cookie stores it.
        slug: "maintenance-requests",
        label: "Maintenance",
        href: "/maintenance-requests",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      {
        slug: "inspection-logs",
        label: "Inspection Logs",
        href: "/inspection-logs",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      { slug: "equipment", label: "Equipment", href: "/equipment", built: true },
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
      {
        // The whole team's events on one screen (migration 035). The slug keeps
        // FileMaker's word because the `rf.nav` cookie stores it; the LABEL is
        // just "Events", since the section band above already says HR.
        //
        // `team-ratings` used to sit beside this and went with it landing: 035
        // merged Ratings into Events, so a rating IS `kind = 'shift'` — a filter
        // on this screen pretending to be a screen of its own, and whichever of
        // the two you pressed you would have got the same list.
        //
        // 035's RLS is owner/admin on all four verbs, and the screen says so
        // itself for anyone who reaches it by URL; this only keeps the tab out
        // of the menu for people it would never open for.
        slug: "team-events",
        label: "Events",
        href: "/events",
        built: true,
        roles: ["owner", "admin"],
      },
      stub("hr", "team-reviews", "Team Reviews"),
      // Pay Periods used to sit here, and it went on 2026-08-06 (Mark: "since
      // pay periods are now on the timesheet screen, there's no need for a pay
      // period menu item"). Both its screens folded into Timesheets — the list's
      // only job was choosing a fortnight, which that screen's picker does, and
      // the record became its "Close pay period…" panel. `/pay-periods*` still
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
      // Sales sits AFTER Shift Reports (Mark, 2026-08-23; it led the section
      // for a few hours first). Daily net sales and tips per shop, pulled from
      // Square — the numbers closing supervisors used to transcribe into
      // FileMaker's shift report. The two are related and distinct: Sales is
      // the settled figure for any day, Shift Reports is the whole closing
      // form (ratings, leftovers, production counts, tomorrow's paper).
      //
      // Shift Reports stays HERE rather than moving to Production (Mark,
      // 2026-08-28). The note that used to sit above argued for Production on
      // the grounds that the production brief deferred the screen there so it
      // would not be built twice — that was about WHERE THE WORK WAS
      // SEQUENCED, not where the menu entry belongs, and the screen is
      // organised by the shift a supervisor is closing rather than by the
      // tables it happens to write. The slug is untouched, so the `rf.nav`
      // cookie keeps working.
      //
      // supervisor+ is 070's own RLS, restated for tidiness only.
      {
        slug: "shift-reports",
        label: "Shift Reports",
        href: "/shift-reports",
        built: true,
        roles: ["owner", "admin", "purchaser", "supervisor"],
      },
      { slug: "sales", label: "Sales", href: "/sales", built: true },
      stub("operations", "documents", "Documents"),
      stub("operations", "policies", "Policies"),
      // "Check Lists" and "Master Check Lists" USED TO SIT HERE and moved to
      // the Locations section on 2026-08-29 when they were built — see the note
      // there. A checklist is about the building, and this section is about the
      // day's numbers and the shift.
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
      // Between the catalog and the walk, which is where a request happens: it
      // arrives before you set out and is answered while you are out. It sat
      // under Location as a stub until 2026-08-21, inherited from the FileMaker
      // FILE the table lives in (DF-Locations) rather than from the work — and
      // even FMP surfaced it in Purchasing, as the guide's "N REQUESTS" badge.
      // Deliberately NOT role-gated: `preq_insert` is membership-only, because
      // the person who notices the shelf is empty is rarely the person who
      // orders. `resolveRoute` matches on `href` or `href + "/"`, so this and
      // /purchase-orders cannot light each other.
      { slug: "requests", label: "Requests", href: "/purchase-requests", built: true },
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
