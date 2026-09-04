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

import { canReachPage } from "./pageAccess";
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
};

// WHO SEES AN ENTRY IS NOT DECLARED HERE. Each sub used to carry its own
// `roles` list; since 2026-09-04 the menu reads `lib/pageAccess` — the Page
// Permissions sheet as code — through `sectionsForRole`, so the menu, the
// layout's refusal and each page's editable flag answer from ONE table. A
// second copy on the entry is how the menu and the screen came to disagree.

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
    // FACILITIES (Mark, 2026-08-30), which is what the section grew into. It
    // was "Locations" while a location record and its shop sections were all it
    // held; since 075–078 it also carries checklists, tasks, maintenance,
    // inspections and the equipment register — every one of them about the
    // BUILDING rather than about the shop as a row in a table. A tier-1 tab
    // names the work, and the work here is looking after the place.
    //
    // (This tab also wore the active location's CODE from 2026-08-01, when the
    // masthead switcher was deleted and it became the only place the code
    // stayed on screen. The switcher came back on 2026-08-27 —
    // `components/WorkingLocation`, far right of the same row — so the code is
    // stated by the control that SETS it.)
    //
    // THE SLUG STAYS `location`, which is what the `rf.nav` cookie stores and
    // what `sectionForPath` matches on. Renaming a label is free; renaming a
    // slug drops everybody's remembered sub-section.
    label: "Facilities",
    subs: [
      // A list of all six, and one of the two places the working location is
      // chosen (Mark, 2026-08-01) — this replaced the masthead switcher, which
      // came back beside it on 2026-08-27. It used to be a singular, id-less
      // /location showing whichever one you were working at.
      //
      // "Locations" again, and NOT "All" (Mark, 2026-08-30). It was trimmed to
      // "All" on 2026-08-27 on the argument that the band above already said
      // Locations, so the sub only had to say WHICH of them — HR's "Team
      // Ratings" → "Events" trim. That argument dies with the rename: the band
      // now says Facilities, and "All" underneath it names nothing at all.
      { slug: "locations", label: "Locations", href: "/locations", built: true },
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
      // Who sees each of these is `lib/pageAccess`' row for it.
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
      },
      {
        slug: "tasks",
        label: "Tasks",
        href: "/tasks",
        built: true,
      },
      {
        // "Maintenance" in the band, "Maintenance Requests" on the page (Mark,
        // 2026-09-03). Nothing couples the two: a nav tier is a narrow strip
        // where a short label earns its place, and the title is where the full
        // name reads.
        slug: "maintenance-requests",
        label: "Maintenance",
        href: "/maintenance-requests",
        built: true,
      },
      {
        slug: "inspection-logs",
        label: "Inspection Logs",
        href: "/inspection-logs",
        built: true,
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
        // Migration 020 gates the employee record at owner/admin; the
        // pageAccess row matches, and the screen says so itself by URL.
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
        // 035's RLS is owner/admin on all four verbs; the pageAccess row
        // matches, and the screen says so itself by URL.
        slug: "team-events",
        label: "Events",
        href: "/events",
        built: true,
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
        // as their home address. The pageAccess row matches.
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
        // Owner only on the sheet — the manager cell is blank. See pageAccess.
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
      {
        slug: "shift-reports",
        label: "Shift Reports",
        href: "/shift-reports",
        built: true,
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
      // `resolveRoute` matches on `href` or `href + "/"`, so this and
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
    // Decision 7 had both at supervisor+; the sheet (2026-09-04) opens both
    // to staff READ ONLY, which migration 092 widened the select policies for.
    subs: [
      {
        slug: "special-orders",
        label: "Special Orders",
        href: "/special-orders",
        built: true,
      },
      {
        slug: "customers",
        label: "Customers",
        href: "/customers",
        built: true,
      },
    ],
  },
];

export function findSection(slug: string): NavSection | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

/**
 * The menu as this role should see it — subs the Page Permissions table hides
 * from them are dropped, and a section left with nothing goes too.
 *
 * Computed on the SERVER (AppHeader holds the session) and handed to AppNav as
 * a prop, so the decision lives in one place. A stub's /soon/ href is in the
 * table too, so an unbuilt screen is hidden from exactly the roles the sheet
 * hides it from.
 */
export function sectionsForRole(role: Role): NavSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    subs: section.subs.filter((sub) => canReachPage(role, sub.href)),
  })).filter((section) => section.subs.length > 0);
}

/**
 * Where `/` lands for this role: the Locations list where the sheet lets them
 * open it (Mark, 2026-08-20 — the first question of the day is which shop),
 * otherwise the first built screen the menu offers them, in menu order. A
 * staffer is hidden from Facilities, HR and Operations entirely, so a fixed
 * `/locations` would greet them with a refusal.
 */
export function homeHref(role: Role): string {
  if (canReachPage(role, "/locations")) return "/locations";
  for (const section of sectionsForRole(role)) {
    const first = section.subs.find((sub) => sub.built);
    if (first) return first.href;
  }
  // No menu at all — a role the sheet shows nothing. Settings is ungoverned.
  return "/settings";
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
