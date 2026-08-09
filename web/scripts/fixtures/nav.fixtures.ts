// The remembered menu: which screen each tab comes back to.
//
// Pinning the rules a rewrite would break quietly. The interesting ones are the
// negatives — an ACTIVE tab must go to its list even when a record is
// remembered, a location must not answer for another location, and no url may
// ever reach the cookie.
//
// Checked by breaking each rule in turn: dropping the active-tab fallback in
// `sectionHref`/`subHref` reds 4 cases; dropping `locationId` from `navPathKey`
// reds 2; making `rememberIn` always return a fresh object reds 2.

import {
  SECTIONS,
  findSection,
  findSub,
  navPathKey,
  resolveRoute,
  sectionHref,
  subHref,
  type NavSection,
  type NavSub,
} from "../../src/lib/nav";
import {
  EMPTY_NAV_MEMORY,
  parseNavMemory,
  rememberIn,
  serializeNavMemory,
  type NavMemory,
} from "../../src/lib/navMemory";
import { eq, ok, test } from "./harness";

const DF01 = "11111111-1111-1111-1111-111111111111";
const DF02 = "22222222-2222-2222-2222-222222222222";

// The real menu, not a fixture one: these functions are only ever asked about
// sections that exist, and a stub section would hide a wrong slug.
function section(slug: string): NavSection {
  const found = findSection(slug);
  ok(found, `section ${slug} exists`);
  return found as NavSection;
}

function sub(sectionSlug: string, slug: string): NavSub {
  const found = findSub(section(sectionSlug), slug);
  ok(found, `sub ${sectionSlug}/${slug} exists`);
  return found as NavSub;
}

/** A memory holding one remembered screen, arrived at the way the app does. */
function memoryWith(
  sectionSlug: string,
  subSlug: string,
  locationId: string | null,
  url: string
): NavMemory {
  return rememberIn(EMPTY_NAV_MEMORY, { sectionSlug, subSlug }, locationId, url);
}

const PO = "/purchase-orders/abc?from=%2Fpurchase-orders&fromLabel=Purchase+Orders";

// ---------------------------------------------------------------- fresh memory

test("with nothing remembered, a section tab goes to its first sub", () => {
  eq(sectionHref(section("purchasing"), EMPTY_NAV_MEMORY, DF01, null), "/vendors");
});

test("with nothing remembered, a sub tab goes to its own list", () => {
  eq(
    subHref(section("hr"), sub("hr", "timesheets"), EMPTY_NAV_MEMORY, DF01, null),
    "/timesheets"
  );
});

// ------------------------------------------------------- remembering a screen

test("a section tab returns to the remembered record, query and all", () => {
  const memory = memoryWith("purchasing", "purchase-orders", DF01, PO);
  eq(sectionHref(section("purchasing"), memory, DF01, "hr"), PO);
});

test("a sub tab returns to the remembered record — the Employees/Timesheets case", () => {
  const employee = "/employees/e1?from=%2Femployees&fromLabel=Employees";
  const memory = memoryWith("hr", "employees", DF01, employee);
  // Standing on Timesheets, the Employees tab carries the employee.
  eq(subHref(section("hr"), sub("hr", "employees"), memory, DF01, "timesheets"), employee);
});

test("a remembered LIST comes back as that list", () => {
  const memory = memoryWith("purchasing", "invoices", DF01, "/invoices");
  eq(sectionHref(section("purchasing"), memory, DF01, "hr"), "/invoices");
});

// ------------------------------------------- the tab you're on goes to the list

test("the ACTIVE section tab goes to the list, not the remembered record", () => {
  const memory = memoryWith("purchasing", "purchase-orders", DF01, PO);
  eq(sectionHref(section("purchasing"), memory, DF01, "purchasing"), "/purchase-orders");
});

test("the ACTIVE sub tab goes to the list, not the remembered record", () => {
  const memory = memoryWith("purchasing", "purchase-orders", DF01, PO);
  eq(
    subHref(section("purchasing"), sub("purchasing", "purchase-orders"), memory, DF01, "purchase-orders"),
    "/purchase-orders"
  );
});

test("an inactive sub of the active section still carries its own record", () => {
  // A vendor item lights Vendors (nav's `also`), so Purchasing is active and the
  // Vendors tab is the active sub — but Invoices is not, and keeps its record.
  const invoice = "/invoices/i1";
  let memory = memoryWith("purchasing", "vendors", DF01, "/vendor-items/v1");
  memory = rememberIn(memory, { sectionSlug: "purchasing", subSlug: "invoices" }, DF01, invoice);
  eq(subHref(section("purchasing"), sub("purchasing", "invoices"), memory, DF01, "vendors"), invoice);
});

// ------------------------------------------------------------- location keying

test("a record remembered at one shop does not answer for another", () => {
  const memory = memoryWith("purchasing", "purchase-orders", DF01, PO);
  eq(sectionHref(section("purchasing"), memory, DF02, "hr"), "/purchase-orders");
  // ...and coming back to DF01 finds it again.
  eq(sectionHref(section("purchasing"), memory, DF01, "hr"), PO);
});

test("navPathKey tells two shops apart, and a null location has its own bucket", () => {
  ok(
    navPathKey(DF01, "purchasing", "invoices") !== navPathKey(DF02, "purchasing", "invoices"),
    "two shops differ"
  );
  ok(
    navPathKey(null, "purchasing", "invoices") !== navPathKey(DF01, "purchasing", "invoices"),
    "no shop differs from a shop"
  );
});

test("navPathKey tells two subs of one section apart", () => {
  ok(
    navPathKey(DF01, "hr", "employees") !== navPathKey(DF01, "hr", "timesheets"),
    "two subs differ"
  );
});

// ------------------------------------------------- the reducer's identity rules

test("rememberIn returns the SAME object when nothing moved", () => {
  const first = memoryWith("hr", "employees", DF01, "/employees");
  const again = rememberIn(first, { sectionSlug: "hr", subSlug: "employees" }, DF01, "/employees");
  ok(again === first, "unchanged memory is the same object");
});

test("rememberIn keeps `subs` identical when only the url moved", () => {
  const first = memoryWith("hr", "employees", DF01, "/employees");
  const second = rememberIn(first, { sectionSlug: "hr", subSlug: "employees" }, DF01, "/employees/e1");
  ok(second !== first, "the memory itself is new");
  ok(second.subs === first.subs, "subs is untouched, so no cookie is rewritten");
  eq(second.paths[navPathKey(DF01, "hr", "employees")], "/employees/e1");
});

test("rememberIn replaces `subs` when the sub moved", () => {
  const first = memoryWith("hr", "employees", DF01, "/employees");
  const second = rememberIn(first, { sectionSlug: "hr", subSlug: "timesheets" }, DF01, "/timesheets");
  ok(second.subs !== first.subs, "subs is new, so the cookie is rewritten");
  eq(second.subs.hr, "timesheets");
  // The employee is still filed — that's the whole point of the tier-2 case.
  eq(second.paths[navPathKey(DF01, "hr", "employees")], "/employees");
});

// -------------------------------------------------------------- the wire format

test("no url ever reaches the cookie", () => {
  const memory = memoryWith("purchasing", "purchase-orders", DF01, PO);
  eq(serializeNavMemory(memory), "purchasing=purchase-orders");
});

test("the cookie round-trips, and comes back with no paths", () => {
  let memory = memoryWith("hr", "timesheets", DF01, "/timesheets");
  memory = rememberIn(memory, { sectionSlug: "purchasing", subSlug: "invoices" }, DF01, "/invoices/i1");
  const reparsed = parseNavMemory(serializeNavMemory(memory));
  eq(reparsed.subs, { hr: "timesheets", purchasing: "invoices" });
  eq(reparsed.paths, {});
});

test("a stale cookie entry falls back to the section's first sub", () => {
  const memory = parseNavMemory("purchasing=no-such-sub&nonsense=whatever");
  eq(memory.subs, {});
  eq(sectionHref(section("purchasing"), memory, DF01, null), "/vendors");
});

test("a remembered sub that no longer exists doesn't lose the section", () => {
  // Hand-built rather than through rememberIn, which is what a renamed slug
  // leaves behind in a live session.
  const memory: NavMemory = { subs: { purchasing: "retired-sub" }, paths: {} };
  eq(sectionHref(section("purchasing"), memory, DF01, null), "/vendors");
});

/* -- production phase 5 flipped Batch Logs from a stub to a real screen ---- */

test("the Batch Logs sub is built and points at /batch-logs", () => {
  const sub = findSub(findSection("production")!, "batch-logs")!;
  ok(sub, "the sub still exists");
  ok(sub.built, "and is no longer a /soon/ stub");
  eq(sub.href, "/batch-logs");
});

test("a batch RECORD lights the Batch Logs tab without needing an `also`", () => {
  // resolveRoute prefix-matches, longest wins — which is why /batch-logs/[id]
  // needs no extra wiring and why a sibling route starting with the same
  // letters would.
  const at = resolveRoute("/batch-logs/9d1f0f8e-0000-4000-8000-000000000000");
  eq(at?.sectionSlug, "production");
  eq(at?.subSlug, "batch-logs");
});

test("no production sub is a stub any more except by intent", () => {
  // Phase 5 was the last one. If this goes red, a screen was added as a stub
  // and the roadmap note in CLAUDE.md needs to say so.
  const stubs = findSection("production")!
    .subs.filter((s) => !s.built)
    .map((s) => s.slug);
  eq(stubs, []);
});

test("every built sub has a real href, not a /soon/ one", () => {
  const wrong = SECTIONS.flatMap((s) => s.subs)
    .filter((s) => s.built && s.href.startsWith("/soon/"))
    .map((s) => s.slug);
  eq(wrong, []);
});
