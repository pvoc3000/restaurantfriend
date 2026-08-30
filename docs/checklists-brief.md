# Facility checks — checklists, walkthroughs, tasks, maintenance, inspections, equipment

Read this before designing or touching anything in migrations 075–077,
`lib/checklists`, `lib/facilityTasks`, `components/checklists/`,
`components/tasks/` or `components/equipment/`.

Settled in conversation with Mark on 2026-08-29.

---

## Why this is one module and not four

FMP's closing routine has a piece the app didn't: a **checklist** the supervisor
walks at the end of a shift — things to put eyes on and duties to complete,
grouped by shop section, ticked off, photographed, with anything wrong flagged
into the emailed report. It was scoped out of the shift report deliberately on
2026-08-28.

Working through it, four unbuilt nav stubs turned out to be one machine:

> **Observation → Finding → Work → Verification**

- A **checklist run**, a manager's **walkthrough** and an **inspection log** are
  all observations — a template, a run, a named person's answers at a time.
- A flagged item, an out-of-range fridge and an inspector's citation are all
  findings.
- A **task** and a **maintenance request** are the same work, at two levels of
  escalation.
- The next walk is the verification.

So: two table families, each with a `kind` — 035's merge precedent in Mark's own
words ("Events already had different types, what's one more") and 051's `kind`
column. Six nav entries over two spines.

## Mark's decisions

| | |
| --- | --- |
| Templates | **Location-scoped.** "The layouts are too different and the requirements aren't even close." Duplicate-then-change-location is the shortcut instead. |
| Scheduling | 1–7 weekdays, and one **or several** shifts |
| Duplicates | Multiple checklists for one day+shift are **rare but real** — so no unique constraint |
| Who edits masters | **Managers and purchasers** (`canWriteCatalog`) |
| Values on duties | **Yes** — fridge temperatures above all |
| Equipment | **In v1**, minimal |
| Walkthrough scoring | **Per item** |
| Issue → maintenance | **Supervisor-initiated, never automatic** |
| History | Nothing migrates. FMP's checklists stay on disk. |

---

## The rules that would be expensive to rediscover

### 1. A run SNAPSHOTS its template

`prompt`, `section_name`, `sort`, the whole response spec. 013's rule, where a
PO line snapshots description, pack and price.

Without it, rewording an item in September silently rewrites what August's
supervisor is recorded as having been asked to check. **History becomes a claim
nobody made.** `section_name` is snapshotted as TEXT beside the id, so a shelf
renamed or deleted next month cannot rewrite or blank last month's walk.

### 2. A check is FOUR states

`pending` / `done` / `issue` / `na`. The order guide's three-state lesson widened
by one: "nobody has been there yet" and "looked at, fine" are different
sentences, and a checklist that merges them is one you cannot audit.

Pressing the state an item is already in returns it to `pending`. That is the
only undo, and a walk you cannot correct is one people stop trusting.

### 3. An out-of-range reading raises the issue BY ITSELF

The one place this module lets the app decide anything, and the line worth
stating:

> The app must never decide what counts as dirty. It can absolutely decide what
> counts as above 40°F.

`statusForReading` does it, and it writes a note naming the value — because 076
refuses an issue with no note, and the constraint should be satisfied by a true
sentence rather than an empty string.

`no_range` is a real answer, not a failure: plenty of `number` items are just a
count. Merging it into `in_range` would let the UI claim a reading had been
checked when nothing checked it.

### 4. The shift-report link is an FK, NOT a (location, date, shift) tuple

070 deliberately declined a unique constraint on that tuple because a
**handover legitimately produces two closing reports for one night**. So the
tuple does not identify a report, and a tuple join would attach a checklist to
the wrong one. `checklist_runs.shift_report_id` is the link, nullable both ways.

### 5. The business date is the module's highest-risk bug

A closing walk finished at 1:15am belongs to **yesterday**, and `current_date`
in Postgres is UTC — so after 4pm Pacific it is already tomorrow. A run and its
report must agree about which day they are or they never find each other.

`businessDateFor` (`lib/checklists`) is the one rule, derived in the org's
timezone and passed in. **Nothing in 075–077 calls `current_date`.** It applies
to CLOSING only, with a 5am cutoff; `business_date` is editable for the cases no
rule should try to cover.

### 6. The carry-forward has to get LOUDER

Mark's best idea here — a manager flags the dirty fryer and it appears on every
subsequent supervisor's checklist until it's done — has one failure mode, and
everything in `lib/facilityTasks` is aimed at it: a task that appears
IDENTICALLY for thirty nights is one people learn to scroll past, which trains
them to skim the section that also holds tonight's real work.

So: a task is **its own record** with one identity and one close (never a row
copied onto thirty nights); it **ages visibly** (`taskTone`, quiet → mark →
loud); somebody other than tonight's supervisor can close it or promote it to
maintenance so it *leaves* the nightly list; and after a week
`staleTaskBanner` surfaces it where a manager reads.

### 7. Cancelling needs a reason; finishing does not

032's shape verbatim — the requirement rides the **decision**, not the column.
Marking a task done needs no essay (the row says done and names who and when);
cancelling is the only record a vanished job ever gets.

There is **no delete policy** on `location_tasks` — cancelling IS the eraser,
059's rule. Consequence: a `delete` from the app removes 0 rows and returns NO
error, so the screen must never offer one.

### 8. `cardinality`, never `array_length(x, 1)`

Caught on the harness by asserting a refusal rather than assuming it.
`array_length('{}', 1)` returns **NULL, not 0**, so `array_length(x,1) > 0` is
NULL, the whole check evaluates to NULL, and **a CHECK CONSTRAINT PASSES ON
NULL** — the empty array sails straight through. Written that way first.

### 9. Photos: two write orders, opposite on purpose

**Upload = Storage then row** (a row pointing at nothing renders broken).
**Delete = row then object** (an orphaned object is invisible and harmless).
018's rule; `lib/facilityPhotos` is where it is written down.

The file input carries **no `capture` attribute** — without it iOS offers
Library / Take Photo / Choose File in one sheet — and the formats are named
explicitly so iOS transcodes HEIC on the way out, at pick time rather than after
the walk is over.

### 10. Scores are optional, and the section roll-up is DERIVED

Mark chose per-item scoring. The measured hazard is real: 89% of FMP's 40,793
`kind='shift'` ratings are a 5, so its five categories discriminated nothing.
Three mitigations, none of which take the choice away — the score is nullable
with "not scored" as the resting state, pressing a score again clears it, and
`sectionScores` computes the trend from whatever was actually scored.

A section with nothing scored returns **null, never zero** — zero is a real
score in 035's range (a supervisor writing the shift off), so defaulting to it
reports the worst possible verdict on a section nobody looked at.

---

## Walks and master lists share ONE screen

Mark, 2026-08-30: "instead of having a checklist and master checklist menu
options, what about just having a Checklist screen with tab picker … Basically
combine the two screens into one."

They are the same subject at two moments — what gets walked, and what has been —
and two adjacent nav entries made you decide which one you wanted before you
could look at either. The Location section was the longest in the app at eight
entries; it is seven now.

`/events` is the precedent for the mechanism: a `TabPicker` choosing between two
populations fetched under different rules and rendered with different columns.

Three things about it:

- **Only the LISTS merge.** Both records keep their own address —
  `/checklists/[id]` and `/checklist-templates/[id]` — because they are
  different kinds of record. `/checklist-templates` (the list) is a redirect
  shim, `/location`'s pattern, because that address is in the record's own
  breadcrumb and in anything already shared.
- **The nav entry carries `also: ["/checklist-templates"]`**, so both the shim
  and the still-live record route light the Checklists tab. `/timesheets` does
  the same for `/pay-periods`.
- **The view is a real navigation, not `history.replaceState`.** The two halves
  are different queries and the server has to run the other one — `/events`'
  split, where the date window pushes and every filter beside it replaces. The
  tabs carry `href`, so each view is bookmarkable, and the default (`walks`)
  writes no parameter so `/checklists` stays canonical.

Both halves are fetched on every load rather than per view. That costs one query
and buys two things: the tab counts are honest before you switch, and the walks
view needs the templates anyway — "asked for today, not walked" is computed from
them.

## Departures worth knowing

**There is no `task_checklist_done` column**, although CLAUDE.md predicted one.
070's own comment says its three `task_*` flags exist because each is "an act
NOTHING ELSE CAN OBSERVE" — and with checklists as rows, whether the checklist
was done IS observable: a linked run, submitted. A boolean beside it would be a
second answer to a question that has one (016's `nextDeliveryDate` trap). The
submit page says `3 of 27 checklist items have not been looked at` instead,
which is more useful than a boolean anyway.

**`submit_shift_report` and `reopen_shift_report` are untouched.** Two acts, not
one: finishing the walk submits the RUN, submitting the report sends. Neither
triggers the other. 072 exists precisely because flipping a status without
undoing a flush duplicates records silently.

**Equipment links are not carried across a duplicate.** A fryer is a physical
thing in one building; sections have a name to match on, equipment does not, and
guessing would be worse than leaving it to be set.

---

## Not built, and named so nobody thinks it was forgotten

- **A cadence engine.** Preventive maintenance (monthly hood filters, quarterly
  descale) wants exactly three shapes — weekday set, every N days, monthly on
  the Nth. Building a general scheduler is where a feature like this
  metastasizes. Today's weekday set covers the daily and weekly cases.
- **A checklist PDF**, and therefore attaching one to the shift-report email.
  The issues are on the report's own page; the PDF and `send-shift-report`'s
  `pdf_base64` are the next increment.
- **A `choice` response type in the UI.** The column and the constraint exist;
  no screen collects the options yet, so `AddTemplateItem` does not offer the
  kind (076 refuses a choice item with no choices, and offering it would bounce
  a raw 23514).
- **Cost per asset.** `location_tasks.vendor_invoice_id` is the seam and has no
  reader.
- **A `/checklists/[id]` editor.** Read-only on purpose: one write path, and the
  walk is it.

---

## Three bugs the live walk found

None of them typechecks, lints or fixture-fails. All three needed the browser.

**1. An HTML entity in JSX text eats the space after an interpolated value.**
`What a walk at {active.code} asks for` rendered as **"at DF01asks for"**. SWC
strips the leading whitespace of a JSXText node that contains an entity, so the
`&rsquo;` two lines further down deleted a space two lines up. Swapping the
entity for a literal `’` fixes it, which is what this module now does
everywhere. **This is pre-existing across the app** — `ShopSectionsTable.tsx`,
`DerivedDay.tsx`, `RecalculateWorkdays.tsx`, `BaseUnitEditor.tsx`,
`FixDrawer.tsx` and `PlanMatrix.tsx` all have the same shape and have not been
swept. The rule: **use literal typographic characters in JSX text, never HTML
entities.** `react/no-unescaped-entities` does not object to `’ “ ” —`.

**2. A shared class string that carries a colour cannot be overridden.**
`FOOTER_CELL` held `text-white` and the walk's commit appended `bg-white
text-ink`, which rendered **white on white** — an invisible Finish button on the
module's primary screen. Tailwind resolves competing utilities by STYLESHEET
order, not class-string order. A shared string now states LAYOUT only and each
caller states its own colours. Found by reading `getComputedStyle`, not by
looking: at a glance the footer simply appears to have one button.

**3. One fact, one mark.** An out-of-range reading showed the quiet
"expected 34–40 F" hint AND the red chip saying the same thing, three
characters apart. The hint is guidance while the reading is fine and a warning
once it is not; both at once read as two complaints about one number.

And one trap that bit the seeding script rather than the app: **PostgREST unions
the keys across a bulk insert and sends explicit NULL for any key a row omits**,
which defeats column DEFAULTs (`requires_photo` is `not null default false` and
the insert failed on it). Every array insert in this module builds its rows from
a single `.map()`, so they are uniform; an ad-hoc one must be too.

## What two real checklists taught (2026-08-30)

Mark supplied DF01's actual opening and closing lists as PDFs. Three things they
settled that no amount of design could have:

**A checklist item says FOUR things, and 076 modelled two.** The paper has a
checkbox, the instruction, a WHO (Baker, Fryer, Assistant Baker, Supervisor) and
a NOTE ("water emptied", "replace filter on Tue/Fri/Sun", "including shelving
above"). Migration **078** adds `guidance` and `position`, both nullable on the
template item and both snapshotted onto the run item. Of 105 real items, 23 name
a position and 16 carry a note — so most rows have neither, which is why neither
column has a default.

`position` is the ROSTER vocabulary (`employees.position`), **not**
`org_members.role` — the two overlap on the word "Supervisor" and mean different
things by it. It is a HINT and never a gate: a checklist that refused a tick
because the closer was covering the baker's shift would be worse than useless.

**The section vocabularies do not match, and the brief was wrong about it.**
This document claimed "a walk follows the same route through the building as the
order guide". DF01's 72 shop sections are SHELVES for counting stock — "Walk In
R1 S3", "FOH Cab 2" — while the checklists walk ROOMS. Only OFFICE matched.
Mark's call (2026-08-30) was to use the area-level sections that already exist
and to add FOH sub-areas rather than a new vocabulary: seven stations at
sort_order 60.1–60.7, inside FOH's own 60–69 band, plus one new "Outside". Mop
room → Kitchen Dish Pit, "basically in the dish pit".

**Known consequence, not yet resolved:** between-section order comes from
`shop_sections.sort_order`, which is the ORDER GUIDE's walk — Kitchen(10),
Bathroom(50), FOH(60), Office(90), i.e. back-to-front. The paper closes
front-to-back: lobby, register, stations, then BOH. So the walk presents the
same items in a different order from the paper. Fixing it means either moving
existing sections (which would move the order guide) or giving a template its
own section ordering. Ask before doing either.

**A typo in somebody's own document stays.** "Production logs fillout out
complely", "wiped and santized", "use toilet bush" are transcribed verbatim.
Correcting a document while copying it is not a thing to do quietly; each is one
inline edit.

`migration/load-df01-checklists.mjs` is the loader — dry run by default,
idempotent (re-running replaces a template's items rather than doubling them,
which is safe because a run snapshots its own copy), and `--wipe` to remove both.

## Probes

*Run these; don't trust a line in CLAUDE.md — it has been wrong in both
directions for four different migrations.*

**075**
```sql
select count(*) from equipment;            -- table exists
select count(*) from location_tasks;       -- table exists
select conname from pg_constraint
 where conrelid = 'public.location_tasks'::regclass and contype = 'c';
--   includes location_tasks_reason_when_cancelled
select polname, polcmd from pg_policy
 where polrelid = 'public.location_tasks'::regclass;
--   THREE rows and NO delete. A fourth means somebody added an eraser
--   that bypasses the reason.
```

**076** — the one that matters is the empty-array refusal, because it is what
was wrong first:
```sql
select column_name from information_schema.columns
 where table_name = 'location_tasks' and column_name = 'source_run_item_id';
--   one row: this is the half of 076 that touches 075's table

insert into checklist_templates (org_id, location_id, kind, name, weekdays)
select id, (select id from locations limit 1), 'checklist', 'x', '{}'::smallint[]
from orgs limit 1;
--   must ERROR. If it inserts, the check is using array_length again.

select count(*) from pg_policy
 where polrelid = 'public.checklist_runs'::regclass;   -- 4
```

**077**
```sql
select id, public from storage.buckets where id = 'facility-photos';
--   one row, public = FALSE. A public bucket here is a data leak.
select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
  and polname like 'facility_photos_object_%';         -- 4

insert into facility_photos (org_id, storage_path) select id, 'x' from orgs limit 1;
--   must ERROR: violates facility_photos_one_owner
```

## Order of application

**075 → 076 → 077**, and the order is load-bearing: 076's
`checklist_run_items.task_id` references a table 075 creates, and 077's photos
reference both. Apply BEFORE deploying — the screens select these columns, and
until then each says so in its own sentence rather than rendering an empty
table.

None is rerunnable (`create table` fails a second time, which is how you know it
already ran).
