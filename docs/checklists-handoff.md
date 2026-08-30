# Facility checks — where a next session picks up

Written 2026-08-30 at the end of the build; **rewritten the same day** after the
follow-up session closed most of it. Read **`docs/checklists-brief.md`** first —
it carries the decisions, the traps and the probes. This document is only *what
is not done*.

---

## Both of the things that were wrong are fixed

**The email carries the checklist.** `checklistSection` in
`web/src/lib/shiftReports.ts`, called from `supervisorBody` — so management gets
it through that function's identity and cannot get it any other way. A clean
night says `Nothing was flagged.` rather than going quiet, a checklist nobody
started says so in `S.mark`, and a shop with no list at all is silent so its
email is byte-identical to before the feature. Pinned by 11 new fixtures against
the produced STRING; verified over live rows in Node, HTML and `toText` both.

**"Reopen" no longer lies.** The link reads **View** once submitted, and a
separate owner/admin **Reopen** command sits beside it (`ReopenChecklistRun`) —
Mark's call over the rename. A plain update, not an RPC: 072's
`reopen_shift_report` is a definer *because submitting flushed rows into other
tables*, and a checklist run flushes nothing. `.select("id")` and a row count,
because 076 says a write matching no policy changes zero rows and returns no
error.

## Three bugs the first handoff did not know about, all fixed

1. **A walk with an unsectioned item snapshotted NO ITEMS.** `checklist_run_items.sort`
   is `numeric(8, 2)`, and both snapshot callers inlined
   `(sectionOrder.get(id) ?? 9999) * 1000 + sort` — 9,999,010, an overflow. The
   run was already inserted, so you got an empty checklist and an error in a
   dialog. Invisible on DF01's real lists, where every item has a section;
   certain on the first template anybody types in a hurry. Now one clamped
   `runItemSort` in `lib/checklists`, used by both, fixture-pinned in a test that
   goes red if the sentinel is put back.
2. **A run's photos vanished once the org had 1,000 of any.**
   `loadChecklistRun` fetched `facility_photos` org-wide and unpaginated;
   PostgREST truncates at 1,000 with no error. Now scoped `.in("run_item_id", …)`.
3. **`/inspection-logs` `already_run_today` compared a run id to a template id**,
   so it was always false. Both list screens also swept every run item in the org
   on each page load; now scoped to the rows on screen.

## What else this round shipped

- **Task photos** (`TaskPhotos`) — `facility_photos.task_id` had no writer. Upload
  = Storage then row, delete = row then object, and **delete is the first caller
  that ordering has ever had anywhere in the app.**
- **The checklist PDF** (`pdf/ChecklistPdf`) — issues first, then the sections.
  Its own hyphenation callback at module scope, and a `pdfText()` sanitizer,
  because @react-pdf's bundled WinAnsi Helvetica **silently drops the en dash**:
  `expected 34–40 °F` printed as **"expected 3440 °F"** on the page you hand an
  inspector. Same trap that once cost the recipe sheet its `≥`. Caught by
  inflating the content stream of a real render.
- **`choice` is finished.** The type picker routes to a dialog that writes
  `response_type` and `choices` in ONE statement (076 refuses a choice with no
  options), and `WalkItem` renders a button row. The editor is also in the
  **row menu**, not only the Expected cell — that column is `hideWhenCompact` at
  1440, so on a 1280 laptop the cell affordance is not on screen.
- **The three typos are corrected** in the live rows and in the loader.
- **"Walk" is gone from the last three visible strings** it had survived in —
  a column header, an empty state, and one of this round's own.

## What is built and live

Migrations **075–078, all applied**, and this round needed **no new one** —
everything it does was already permitted by 076's and 077's policies. **1,436
fixtures pass** (1,416 before). 24 components across `components/checklists/`,
`components/tasks/`, `components/equipment/`.

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

**Live data:** DF01 Opening (35 items) and DF01 Closing (70 items) from Mark's
own PDFs, plus **DF01 Manager Walkthrough (3 placeholder items)** — see §1
below. Everything else is at zero: no runs, no tasks, no equipment, no photos.
The 2026-08-30 verification created a walkthrough run, a closing run, a task and
a photo, exercised all of them, and deleted every one.

**Still nothing has been used in anger**, which remains the most important
caveat here. Every rule has now been exercised on the harness AND walked
end to end against the live database — but none of it has survived a real
Tuesday, and the three bugs above are what one afternoon of actually pressing
the buttons turned up.

---

## Not built, in the order I would do them

### 1. Walkthroughs — RUN ONCE, now, but never in anger
The whole path was walked end to end on 2026-08-30 and it works: a manager
scores an item, an out-of-range reading raises its own issue, a task is raised
from it, and that task appears in the carried-over band at the top of **that
night's closing checklist**. Every step is verified.

**`DF01 Manager Walkthrough` is left on the live database and its three items
are PLACEHOLDERS somebody invented for that test** — "Front of house
presentation", "Walk-in temperature" (34–40 °F, so it demonstrates the
auto-issue), "Fryer oil condition" (a `choice`, so it demonstrates that). It is
never offered automatically (`weekdays` null, which is what a manager's round
wants), so it is harmless — but replace the items with real ones before anybody
treats it as a real list.

### 2. Inspection logs are a filtered list and nothing more
The brief says an inspection wants three things a checklist does not: **the
inspector's own document**, **findings with deadlines**, and **permit expiry**.
None is built. All three have machinery waiting — `facility_photos` for the
document, `location_tasks.due_on` for the deadlines, and 034's `expiryState`
(already used on `equipment.warranty_ends_on`) for the expiry.

### 3. Photographs are not in the PDF
`ChecklistPdf` prints the answers and not the pictures. @react-pdf fetching
signed URLs is a real risk and the document is useful without them, so it was
deliberately left for a second pass. A photograph of the thing is most of what
a finding is worth.

### 4. Equipment has no delete
Only an active toggle. Fine for now — 023's lesson is that deletion is for the
typo, not the thing — but a mistyped fryer is currently permanent. Copy
`EmployeeActions`' confirm, which counts what it would take with it.

### 5. Cost per asset
`location_tasks.vendor_invoice_id` is the seam and **has no reader**. Once a
repair bill is linked, "this compressor has cost £2,400 in eight months" is a
join away. That is the argument for replacing a machine, and nobody in the
business can make it today.

### 6. No cadence engine
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
- **`numeric(8, 2)` holds 999999.99, and an overflow is an insert that fails
  AFTER its parent succeeded.** See bug 1 above. Any composed sort key wants a
  clamp and a fixture, not a comment.
- **@react-pdf's bundled Helvetica is WinAnsi and emits nothing for a character
  it cannot place** — no box, no question mark. An en dash turns `34–40` into
  `3440`. Verify a PDF by inflating its content stream, never by looking at it.
- **A dialog handed a row object holds a snapshot.** `router.refresh()` hands
  down fresh rows and the open panel keeps the old ones, so a photo you just
  added does not appear — which reads as the upload having failed. Keep the ID
  in state and look the row up each render.
- **The browser pane lies.** It goes hidden on its own and every
  `getBoundingClientRect` then reads 0; it also paints stale frames mid-recompile
  that look entirely plausible. Check `innerWidth !== 0` and measure the DOM
  before believing a screenshot.
