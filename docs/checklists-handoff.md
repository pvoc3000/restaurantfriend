# Facility checks — where a next session picks up

Written 2026-08-30, at the end of the build. Read
**`docs/checklists-brief.md`** first — it carries the decisions, the traps and
the probes. This document is only *what is not done*, and it starts with the
two things that are actually wrong.

---

## Start here: the module does not yet do the thing it was asked for

Mark's first sentence, 2026-08-29:

> "Anything flagged as an issue on a checklist would be included in the report
> that gets emailed."

**It isn't.** The checklist reaches the shift report's *pages* and its
*readiness* — the submit page says `6 of 27 checklist items have not been
looked at` — but `supervisorBody` in `web/src/lib/shiftReports.ts` has no
checklist section at all, so nothing about a flagged issue leaves the building.
This was in the approved plan and did not get built.

**What it needs.** A section in `supervisorBody`, never in `managementBody`.
That function's whole security property is the identity

```ts
managementBody(r) === supervisorBody(r) + ratingsSection(r)
```

so anything added to the supervisor half reaches management for free, and
nothing added to the management half can ever leak the other way. Put the
issues in `supervisorBody` — both audiences want them — and assert the result
against the produced STRING, the way `gustoExport`'s sick-hours fixture does.

The data is already assembled: the runner's page loads the run through
`loadChecklistRun`, and `EmailReport` is composed on the server in
`app/(fullscreen)/shift-reports/[id]/run/page.tsx`. It needs the issues added
to that type and rendered in the body.

## And one button lies

`/checklists/[id]` shows **Reopen** on a submitted record and links to
`/checklists/[id]/run` — which renders read-only, because `WalkRunner` gates
every control on `isOpen`. **Nothing anywhere sets a submitted run back to
`open`.** The only `status: "open"` writes are on create.

Two honest fixes, and the choice matters:

- **Rename it "View"** — one line, and defensible: a finished record is a
  document, which is what `checklist_runs` has no delete policy for.
- **Build a real reopen**, owner/admin only. 076's update policy already allows
  it (`user_has_role(org_id, array['owner','admin'])` in both USING and WITH
  CHECK), so it needs no migration. If you do this, look at
  `reopen_shift_report` (072) first — it exists because flipping a status
  without undoing what the submit did produced silent duplicates. A checklist
  run flushes nothing, so the same trap does not apply, but the reasoning is
  worth reading before deciding.

Ask Mark which. My instinct is the rename, because a walk that can be reopened
freely is a walk whose timestamps stop meaning anything.

---

## What is built and live

Migrations **075–078, all applied**. 78 migrations replay clean on the Docker
harness. **1,416 fixtures pass.** 20 components across
`components/checklists/`, `components/tasks/`, `components/equipment/`.

| Screen | State |
| --- | --- |
| `/checklists` | Two views in one screen — Checklists \| Templates |
| `/checklists/[id]` | Read-only record |
| `/checklists/[id]/run` | The runner, `(fullscreen)`, tablet-first |
| `/checklist-templates/[id]` | Template record (the list is a redirect shim) |
| `/tasks`, `/maintenance-requests` | One table, two views over `kind` |
| `/equipment`, `/equipment/[id]` | Register + reading history |
| `/inspection-logs` | The runs table filtered to `kind = 'inspection'` |
| Shift report | A `checklist` page on every shift, plus readiness |

**Live data:** DF01 Opening (35 items) and DF01 Closing (70 items), loaded from
Mark's own PDFs by `migration/load-df01-checklists.mjs`. Everything else is at
zero — no runs, no tasks, no equipment, no photos. **Nothing has been used in
anger yet**, which is the most important caveat in this document: every rule
below has been exercised on the harness and in one throwaway walk, and none of
it has survived a real Tuesday.

---

## Not built, in the order I would do them

### 1. The email (see above). Everything else is optional; this is not.

### 2. Walkthroughs have never been run
The kind exists, per-item scoring is built and fixture-tested, `sectionScores`
derives the roll-up, and the carry-forward works — but **no walkthrough
template exists**, so the whole path from "manager scores an item" to "task
lands on tonight's checklist" has only ever been exercised with a hand-made
run. Make one at DF01 and walk it before trusting it.

### 3. Task photos
`facility_photos.task_id` exists, 077's check enforces exactly one owner, and
**no UI writes it.** Photos only attach to checklist answers today. A
maintenance request with a photo of the broken thing is the obvious want, and
`WalkItem`'s `addPhoto` is the code to copy — the two write orders are opposite
on purpose and `lib/facilityPhotos` says why.

### 4. Inspection logs are a filtered list and nothing more
The brief says an inspection wants three things a checklist does not: **the
inspector's own document**, **findings with deadlines**, and **permit expiry**.
None is built. All three have machinery waiting — `facility_photos` for the
document, `location_tasks.due_on` for the deadlines, and 034's `expiryState`
(already used on `equipment.warranty_ends_on`) for the expiry.

### 5. The checklist PDF
Named in the plan, not built. It matters for the same reason the email does:
the paper is what a health inspector asks for. `PoPdfDocs.tsx` and
`SpecialOrderPdfs.tsx` are the template, and their hard-won traps are recorded
in `docs/checklists-brief.md` — register the no-op hyphenation callback at
module scope, and do not make a `fixed` table header on a document whose last
page is totals.

### 6. `choice` items cannot be created
`response_type = 'choice'` is a real column value, 076 refuses one with no
options, and **no screen collects the options** — which is why
`AddTemplateItem` deliberately does not offer the kind. It needs an editor for
`choices text[]` on the row before the kind can be offered.

### 7. Equipment has no delete
Only an active toggle. Fine for now — 023's lesson is that deletion is for the
typo, not the thing — but a mistyped fryer is currently permanent. Copy
`EmployeeActions`' confirm, which counts what it would take with it.

### 8. Cost per asset
`location_tasks.vendor_invoice_id` is the seam and **has no reader**. Once a
repair bill is linked, "this compressor has cost £2,400 in eight months" is a
join away. That is the argument for replacing a machine, and nobody in the
business can make it today.

### 9. No cadence engine
Preventive maintenance — monthly hood filters, quarterly descale, annual
extinguisher — wants exactly three shapes: a weekday set (built), every N days,
and monthly on the Nth. **Keep it to three.** A general scheduler is where a
feature like this metastasizes.

---

## Open questions for Mark

**The walk order does not match the paper, and this is the one he will notice
first.** Between-section order comes from `shop_sections.sort_order`, which is
the ORDER GUIDE's route — Kitchen(10), Bathroom(50), FOH(60), Office(90), i.e.
back-to-front, because that is how you count stock. His closing list goes
front-to-back: lobby, register, stations, then BOH. So the same items present
in a different order from the paper he handed over.

Neither fix is mine to choose: move existing sections (which moves the order
guide with them), or give a template its own section ordering independent of
the shelf walk. He has been told and has not answered.

**Three typos are transcribed verbatim** from his PDFs — "Production logs
fillout out complely", "wiped and santized", "use toilet bush". Each is one
inline edit. They were left because correcting somebody's document while
copying it is not a thing to do quietly.

**`checklist_run_tasks` is write-only.** `ChecklistWalk` upserts a row whenever
somebody acts on a carried-forward task, and nothing reads it. It exists so
"which tasks were open on the night of 12 August" stays answerable; that
question has no screen yet. Harmless, but do not mistake it for dead code.

---

## Things a rewrite would get wrong

All of these are argued at length in `docs/checklists-brief.md`; this is the
index, not the argument.

1. **A run snapshots its template** — including the section NAME as text.
2. **A check is four states**, and pressing the current one returns it to
   `pending`. That is the only undo.
3. **An out-of-range reading raises the issue by itself** — the one place the
   app decides anything.
4. **The shift-report link is an FK, not a (location, date, shift) tuple** —
   070 declined that unique constraint because a handover produces two reports.
5. **`businessDateFor` is the module's highest-risk rule.** A closing walk after
   midnight belongs to yesterday; `current_date` is UTC. Nothing in 075–078
   calls it.
6. **The carry-forward has to get louder**, or thirty identical appearances
   teach people to scroll past it.
7. **Cancelling needs a reason, finishing does not.** No delete policy on
   `location_tasks`.
8. **`cardinality`, never `array_length(x, 1)`** — the latter returns NULL for
   an empty array, and a CHECK passes on NULL.
9. **Scores are optional and the roll-up is derived**; an unscored section is
   null, never zero.
10. **There is no `task_checklist_done` column**, deliberately — the question is
    observable from a linked run.

## Traps that cost real time

- **An HTML entity in JSX text eats the space after an interpolated value.**
  SWC strips the leading whitespace of a text node containing one, so a
  `&rsquo;` two lines below deletes a space two lines above. Use literal
  typographic characters. **Still present in six shipped files elsewhere in the
  app** — `ShopSectionsTable`, `DerivedDay`, `RecalculateWorkdays`,
  `BaseUnitEditor`, `FixDrawer`, `PlanMatrix` — and not swept.
- **A shared class string carrying a colour cannot be overridden.** Tailwind
  resolves by stylesheet order. This shipped an invisible white-on-white Finish
  button on the module's primary screen.
- **`flex-wrap` only helps when a child can claim the next line.** A `flex-1`
  child has a 0 basis, so a `shrink-0` sibling that wraps internally will
  squeeze it to nothing and overlap it. Check every new row at 375px.
- **PostgREST unions the keys across a bulk insert** and sends explicit NULL for
  any key a row omits, defeating column defaults. Build array payloads from one
  `.map()`.
- **The browser pane lies.** It goes hidden on its own and every
  `getBoundingClientRect` then reads 0; it also paints stale frames mid-recompile
  that look entirely plausible. Check `innerWidth !== 0` and measure the DOM
  before believing a screenshot.
