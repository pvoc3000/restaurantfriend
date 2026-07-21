# DF Operations → Native App: Feasibility & Project Plan

**Date:** July 19, 2026
**Prepared from:** FileMaker Database Design Reports (8 of 10 files; DF-PO-System and DF-Premade-Production DDRs still needed)

---

## 1. The Verdict: Feasible

This rewrite is realistic for you to do, for three reasons:

**The data is small.** Your biggest table is CLItem at ~448k rows. Postgres handles tables a thousand times that size without breaking a sweat. Total data across the whole solution is well under a gigabyte. Migration is a scripting exercise, not an engineering problem.

**The apparent complexity is mostly FileMaker boilerplate.** The DDRs show ~82 tables, ~1,400 scripts, and ~500 layouts — but a large fraction of that evaporates in a modern stack:

- Hundreds of scripts are `Sort By X`, `Find Y`, `Go To Layout`, `Redo Last Sort` variants. In a native app these are *one* reusable sortable/filterable list component, not 40 scripts per module.
- Dozens of layouts are Desktop/iPad/iPhone/Web variants of the same screen. SwiftUI adaptive layouts collapse these to one screen each.
- Duplicated tables (Employees, TimeSheets, Reviews, Events exist in *both* DF-Employees and DF-Time-Sheets; Locations appears in three files) collapse into single canonical tables.
- The entire DF-Operations-03 navigation system (AreaMenu, TableMenu, LayoutTable — 3 tables and dozens of scripts just to build menus) is replaced by an ordinary tab bar / sidebar.

A realistic count of what you actually built: roughly **40–45 real entities** and **10–12 functional modules**. That's a substantial app, but a normal-sized one.

**Nothing in it requires exotic technology.** It's CRUD, lists, forms, PDF generation, a few CSV imports/exports, email, and reporting. The hard part is scope, not difficulty.

**The honest caveat:** this is a 6–12 month project for one person working part-time, even with heavy AI assistance. The "full replacement, then switch" rollout you chose means nobody benefits until the end, and the old system keeps accumulating data you'll have to re-migrate at cutover. The plan below structures the build so that even within a full-replacement strategy, you build and validate module by module internally.

---

## 2. Functional Inventory (what the solution actually does)

Extracted from the DDRs. This becomes the checklist we spec against.

| Module | Today's home | Core entities | Notable functionality |
|---|---|---|---|
| **Employees / HR** | DF-Employees | Employees (445), Events (2.4k), Reviews, Uniforms, Policies, Policy Signers | Onboarding sheets (FOH/BOH), write-ups & point system, review templates & printing, policy signatures, hiring docs, rosters, phone lists |
| **Time & Payroll** | DF-Time-Sheets | TimeSheets (75k), Days, PayPeriods | Homebase import, Gusto export (timesheets + tips), Wells Fargo report, cost/hours recalculation, labor reports by employee/location/payrate, sales & tips graphs |
| **Quotes & Orders (wholesale/special orders)** | DF-Quotes-Orders | Customers (5.9k), Orders (8.3k), OrderItems (20k), OrderPayments, MenuItems | Quote → Invoice → Receipt lifecycle with email delivery, delivery scheduling + Google distance, calendar view, order duplication, production sheets, sales reports, "orders for today/tomorrow/this week" |
| **Inventory & Purchasing** | DF-Operations-03 (+ missing DF-PO-System DDR) | Vendors, VendorItems, Inventory, OrderGuides, POs, POItems | Order guides by day, PO generation from order guide, price-change logging, shopping reports, vendor usage reports |
| **Production / Recipes** | DF-Recipes, DF-Operations-03 (+ missing DF-Premade-Production DDR) | Recipes (491), RecipeElements (8.1k), RecipeItems, Donuts, DonutSchedules, Trays, BatchLogs | Percentage-based recipe scaling, ingredient↔vendor-item links, donut schedules by location, tray reports, production schedules, par cheat sheets |
| **Supervisor Shift Logs** | DF-Supervisor-Log | Log (13k), Ratings (44k), Sales, Documents, Requests | Multi-page guided shift log (p01–p10), employee ratings per shift, leftovers report, sales & tips entry, document library |
| **Checklists** | DF CheckLists | MCList templates, CList instances (7.8k), CLItem (448k) | Template → generated checklist, subtasks, photo attachments, completion tracking, walkthrough reports, PDF output |
| **Locations & Facilities** | DF-Locations | Locations (6), MaintenanceLog, InspectionLog, Drawers, ShopLocations (241) | Maintenance requests with assignment/completion, inspection logs, cash drawer tracking, purchase requisitions |
| **Cross-cutting** | DF-Operations-03 | — | Role-based access (3–4 privilege sets ≈ admin / supervisor / staff), per-user login, location context switching, messaging cards |

External integrations to preserve: **Homebase** (schedule/time import), **Gusto** (payroll export), **email** (quotes/invoices/receipts, blast email), **Google Distance Matrix** (delivery), PDF generation throughout.

---

## 3. Target Architecture

Locked in by your answers: **iPhone + iPad native, plus web; managed cloud database; SwiftUI.**

```
┌────────────────────┐   ┌────────────────────┐
│  iOS/iPadOS app    │   │  Web app           │
│  (SwiftUI, one     │   │  (admin, reports,  │
│  codebase, adaptive│   │  desktop work)     │
│  layouts)          │   │                    │
└─────────┬──────────┘   └─────────┬──────────┘
          │      HTTPS / realtime  │
          └───────────┬────────────┘
                      ▼
        ┌──────────────────────────┐
        │  Supabase                │
        │  • Postgres (one clean   │
        │    schema, ~40 tables)   │
        │  • Auth (roles via RLS)  │
        │  • Storage (photos, PDFs,│
        │    documents, hardcopies)│
        │  • Edge functions (PDF   │
        │    gen, email, Gusto     │
        │    export, Homebase sync)│
        └──────────────────────────┘
```

**Why Supabase specifically:** it's Postgres (real relational database — your data is deeply relational), has built-in auth with row-level security that maps cleanly to your admin/supervisor/staff privilege sets, file storage for all those container fields (checklist photos, review hardcopies, documents), and it's equally reachable from Swift and from a web front end. Cost at your scale: roughly $25/mo Pro tier. Firebase would fight your relational model; CloudKit would strand the web app.

**One decision I made for you (flag if wrong):** you didn't select Mac desktop, but most admin/reporting work lives on Desktop layouts today. In this architecture, that work moves to the **web app** — which also covers the Supervisor-Log web users. If the person doing payroll and reporting works on a Mac, they'll do it in a browser.

**Key design shifts from FMP:**

- One canonical schema. Employees, TimeSheets, Locations, etc. exist once, referenced everywhere. This alone kills a whole class of your current bugs and sync scripts.
- Business logic lives in the database (constraints, views, functions) and a thin service layer — not in 1,400 imperative scripts. Reports become SQL views; "Find Overdue Reviews" becomes a query, not a script.
- Sort/find/navigate scripts disappear into standard list UI patterns.
- PDF generation (invoices, checklists, production schedules, reviews) runs server-side from HTML templates — one system for both clients.
- The web app can start tiny: even just reports + payroll screens. Recommend a simple stack (e.g., SvelteKit or Next.js on the same Supabase backend); it can grow module by module after cutover.

**Offline:** recommend online-first for v1 (the shop presumably has Wi-Fi), with local caching for reads. True offline sync is the single most expensive feature you could add — defer it unless the floor genuinely loses connectivity.

---

## 4. How to Tell Me What the App Does (better than DDRs)

You asked if there's a better way than DDRs to convey functionality without copying the old design. Yes — a three-source approach, module by module:

1. **You narrate the workflow** (15–30 min per module, voice or text): who uses it, on what device, what a typical day looks like, what's annoying about the current version, what you'd drop entirely. The *why*, which no DDR contains.
2. **Screenshots of the layouts actually used daily** (skip the blanks, copies, and "temp" layouts — I can see from the DDR which ones those probably are). The visual grammar of what matters on each screen.
3. **The DDRs as the completeness net.** After you narrate, I cross-check every table, script, and layout in the DDR against the spec and ask "you didn't mention X — dead code or forgot?" This is how we catch the 13 years of tacked-on features without recreating them blindly.

From each module session I produce a short **functional spec**: entities, workflows, screens, rules, reports, and an explicit "not carrying forward" list. You approve it; it becomes the build contract. This is exactly the "recreate functionality, not schema" outcome you asked for.

---

## 5. Phased Plan

Even with a full-replacement rollout, we build in phases and validate each internally.

### Phase 0 — Specification (2–4 weeks, mostly conversation)
- Export the two missing DDRs (DF-PO-System, DF-Premade-Production).
- Module-by-module walkthroughs (§4). Suggested order: start with **Supervisor Log or Checklists** (self-contained, well-understood) to calibrate the process, then Orders, Inventory/Purchasing, Production, Employees, Timesheets, Locations.
- Output: ~10 functional specs + a master entity list + a kill list of features not carried forward.

### Phase 1 — Foundation (2–3 weeks) — *revised: web-first (locked 2026-07-19)*
- Supabase project; canonical schema v1 (entities only, from the specs); auth with roles; RLS policies mirroring your privilege sets.
- **Web app skeleton first** (not Xcode): the web app inherits the FMP-desktop "power tool" role, and it's where migrated data gets cleaned and the schema gets exercised while it's still fluid. Design system, auth flow, list/table/form patterns, Supabase client.
- A trial data migration of one easy table end-to-end to prove the pipeline early.
- The SwiftUI app starts **after** the first module's backend + web flow is proven on real use (see revised Phase 2 order). Rationale: migration cleanup needs bulk-edit surfaces; web redeploys tolerate schema churn; the module's first user is Mark on the power surface; Swift then targets a stable, proven API.

### Phase 2 — Module builds (the long middle, ~4–6 months part-time)
Build order chosen so each module's dependencies already exist:
1. **Employees + Locations** (everything references them)
2. **Checklists** (self-contained, high daily usage, iPad-centric — a great first "real" module)
3. **Supervisor Log + Ratings** (depends on employees, checklists)
4. **Timesheets + Pay Periods** (depends on employees; includes Homebase import + Gusto export)
5. **Vendors + Inventory + Order Guides + POs** (self-contained cluster)
6. **Recipes + Production/Donut scheduling** (depends on vendor items)
7. **Customers + Quotes/Orders** (depends on menu items/production; includes PDFs + email + calendar)
8. **Facilities: maintenance, inspections, purchase reqs, documents** (small, mops up the long tail)

Each module: build → migrate that module's real data into a staging environment → you use it with real workflows for a week → fix → freeze the spec.

**Per-module surface order (locked 2026-07-19, set by the purchasing module):** schema + RLS → migration dry run → **web admin screens** (used to clean the migrated data) → **web workflow screens** (used for real work — e.g., a real Monday order via iPad Safari as the stopgap) → **SwiftUI floor app** as the polish layer on the proven backend → staff rollout. "Web first" stays module-scoped: only the screens that module needs, never a wholesale desktop-layout rebuild.

### Phase 3 — Full data migration & parallel run (3–4 weeks)
- Final migration scripts for all tables, rehearsed until they run clean in one shot (including container-field files → Supabase Storage).
- Parallel run: staff uses the new app; FMP stays read-only-available as the safety net. Compare outputs (payroll totals, invoice totals) for one full pay period.

### Phase 4 — Cutover
- Re-run migration on the delta, freeze FMP files as archive, decommission FileMaker Server licensing. Keep read-only FMP copies for a year for reference.

---

## 6. Risks, Honestly

- **Scope creep is the #1 killer.** 13 years of features means everything feels essential. The kill list in Phase 0 matters as much as the specs. Rule of thumb: if nobody used it in the last 90 days, it doesn't get rebuilt in v1.
- **Full-replacement means a long dark period.** If motivation or time gets thin mid-build, consider flipping to per-module cutover (the build order above deliberately keeps that door open — modules 2, 3, and 5 could each go live independently).
- **Payroll accuracy is the highest-stakes surface.** The Gusto export and timesheet math get a dedicated parallel-run validation, not a spot check.
- **The missing DDRs** (PO-System, Premade-Production) cover purchasing and production — two of the meatier modules. Get those exported before Phase 0 planning for them.
- **You're the bus factor**, same as today. Mitigation: the functional specs double as documentation, and a boring, conventional stack (SwiftUI + Postgres) means any contractor can pick it up later — which was never true of the FMP files.

---

## 7. Immediate Next Steps

1. Export DDRs for **DF-PO-System** and **DF-Premade-Production** into the same folder.
2. Pick the first walkthrough module (suggest **Checklists** or **Supervisor Log**) and just talk me through a day of using it — I'll draft the first functional spec and we'll calibrate the format.
3. I can also draft the **master entity list** (the ~40-table clean schema, v0) from the DDRs alone right now, as a strawman for you to react to.
