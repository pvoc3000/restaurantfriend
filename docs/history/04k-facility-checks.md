<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4k. 🚧 **FACILITY CHECKS — checklists, walkthroughs, tasks, maintenance,
   inspections and equipment (migrations 075, 076, 077, 078 — ALL FOUR APPLIED
   2026-08-29/30). *Probe, don't read this line.*** Mark, 2026-08-29: "we kind of need to think of
   checklists, tasks, and maintenance requests as one, interconnected and
   interdependent module."
   **Read `docs/checklists-brief.md` before designing or touching any of it** —
   it carries the decisions, the traps and the probes — and
   **`docs/checklists-handoff.md` for what is still OUTSTANDING**.
   **BOTH OF THOSE ARE FIXED 2026-08-30, and NO MIGRATION WAS NEEDED** —
   everything below was already permitted by 076's and 077's policies.
   **THE EMAIL CARRIES THE CHECKLIST.** `checklistSection` in
   `lib/shiftReports`, called from `supervisorBody`, so management gets it
   through `managementBody`'s identity and can get it no other way — the
   existing composition fixture is what enforces that placement, and needed no
   edit. **A CLEAN NIGHT SAYS SO** rather than going quiet: silence is reserved
   for the one case where no list is linked AND none was asked for, so an
   un-adopted shop's email is byte-identical to before. If the section vanished
   on a clean night nobody could tell CLEAN from NOBODY WALKED from THE FEATURE
   BROKE, and once absence is routine the loud not-started case stops being
   loud. **`position` (078) IS DELIBERATELY NOT CARRIED** into `EmailReport`:
   it draws on the same vocabulary as `shift_report_ratings.position`
   ("Sr. DF"), so it would trip the privacy sweep for a reason that has nothing
   to do with a person.
   **"REOPEN" NO LONGER LIES**: the link reads **View** once submitted and an
   owner/admin **Reopen** stands beside it (Mark's call over the rename). A
   PLAIN UPDATE, not an RPC — 072's `reopen_shift_report` is a definer *because
   submitting flushed rows into other tables*, and a checklist run flushes
   nothing. Do not "fix" it into an RPC.
   **THREE BUGS THE HANDOFF DID NOT KNOW ABOUT, all found by pressing the
   buttons, all fixed.** The first is the one that mattered:
   **A WALK WITH AN UNSECTIONED ITEM SNAPSHOTTED NO ITEMS AT ALL.**
   `checklist_run_items.sort` is `numeric(8, 2)` — 999999.99 — and both snapshot
   callers inlined `(sectionOrder.get(id) ?? 9999) * 1000 + sort`, which is
   9,999,010. The insert failed, the RUN had already been created, and you got
   an empty checklist with an error in a dialog. Invisible on DF01's real lists,
   where every item has a section; certain on the first template anybody types
   in a hurry. Now ONE clamped `runItemSort` in `lib/checklists` used by both,
   pinned by a fixture that goes red the moment the sentinel is put back.
   Then: **`loadChecklistRun` fetched `facility_photos` ORG-WIDE and
   unpaginated**, so on the day the org filed its thousandth photo a walk's own
   pictures would have started disappearing with no error (PostgREST's silent
   1,000-row cap); and **`/inspection-logs`' `already_run_today` compared a RUN
   id to a TEMPLATE id**, so it was always false. Both list screens also swept
   every run item in the org on each page load; all three are scoped now.
   **ALSO SHIPPED**: task photos (`facility_photos.task_id` had no writer, and
   its DELETE is the first caller `WRITE_ORDER_NOTE`'s row-then-object order has
   ever had anywhere in the app); the **checklist PDF**; `choice` FINISHED — the
   type picker routes to a dialog writing `response_type` and `choices` in ONE
   statement, since 076 refuses a choice with no options, and the editor is in
   the ROW MENU as well as the Expected cell because that column is
   `hideWhenCompact` at 1440 and so is absent on a 1280 laptop; the three
   transcribed typos corrected in the live rows AND the loader; and "walk"
   removed from the visible strings it had survived in.
   **"WALK" IS GONE AS A NOUN, EVERYWHERE** (Mark, 2026-08-30, after asking for
   a sweep): a full pass over the module — checklists, TASKS, equipment and the
   shift report's checklist page, two independent passes so an apostrophe
   swallowing a line in one could not hide it from both — found FIFTEEN
   user-facing uses, and **four of them were on the Tasks screens**, which the
   first sweep never opened. The twelve NOUNS are now "checklist"; the three
   VERBS stay, because "what a supervisor walks at the end of a shift" is
   ordinary English rather than a coined record type. `ChecklistWalk` gained a
   `noun` prop for the two it needed, threaded from `WalkRunner`, which already
   derives it from the run's snapshotted kind — so an inspection log does not
   call itself a checklist. Component names, `canWalkChecklists` and the
   `?view=walks` key are untouched and invisible; "Walkthrough" is the kind's
   own label and "walk-in" is a fridge.
   **THE CREATE COMMAND SITS IN THE LIST'S OWN CONTROL ROW, RIGHT-ALIGNED**
   (Mark, 2026-09-03), which REVERSES his 2026-08-30 call that it belonged
   beside the title — that one was against a `justify-end` row of its own ABOVE
   the filters, where a create command really did read as one more filter, and
   this is a different placement: the LAST cell of the row the search box and
   the tabs are already in, pushed to the page's right edge (measured, 1232 at
   a 1280 window, the same edge as the columns eye below it). All five —
   Start a walk, New template, New task, New maintenance request, New
   inspection log, New equipment — and the title rows are now a bare `h1`.
   **`action?: ReactNode` IS THE SLOT**, on `ChecklistsList`,
   `ChecklistTemplatesList`, `EquipmentList` and `TasksScreen`: a NODE rather
   than a flag, because only the page knows which command a list is for and
   what to hand it, and the button is a client component the server page can
   pass down as an element.
   **The search box had to stop growing for it to work.** Three of those rows
   put the search in a `min-w-[16rem] flex-1` wrapper, which eats every spare
   pixel — so `ml-auto` on the command gets nothing and it lands next to the
   tabs rather than at the edge. `w-72` on the input, the app's usual search
   width, which is also what left-aligned the tab pickers Mark asked about
   separately the same day.
   **`/production-items` AND `/recipes` GAINED A CREATE COMMAND** (Mark,
   2026-09-03) — `NewProductionItem` and `NewRecipe`, `NewElement`'s template.
   Two things worth knowing.
   **The item's duplicate check WARNS and never blocks**, which is 038's own
   reasoning: it dropped `unique (org, name)` because "Angry Samoa" is four
   different donuts, and DECLINED to replace it with a composite index on
   (name, size, type, subtype) because those are four separate `InlineValue`
   cells — changing a Regular to a Mini when that Mini exists would fail on the
   first edit with no order that works. So the create says so and lets you
   through, `findPossibleRehires`' treatment.
   **A RECIPE IS TWO ROWS, and the second is not optional**: every reader here
   goes through the MASTER version — costing, the printed sheet, the Costs
   matrix, the record's default tab — so the create writes v01 and marks it
   master in the same act. 036's partial unique index is what makes that safe.
   If the version write fails the recipe still EXISTS, so it says what happened
   and lands on it rather than reporting a failure over a real record.
   **`version_label` IS STORED BARE — "01", never "v01".** Every reader
   prefixes it (`v{version_label}` in `RecipeVersions`, `RecipeInfo`,
   `RecipesList` and `BatchRecipe`), so a stored "v01" renders "vv01". Caught by
   creating one and looking at it, not by reading.
   **SUPERSEDED 2026-09-10: a command in the title row is now TOP- and
   right-aligned everywhere** (Mark: "not only right aligned, but TOP aligned as
   well"), through `PageHeading`'s `items-start`. Kept for the history:
   **PRODUCTION KEEPS ITS COMMANDS BESIDE THE TITLE and BOTTOM-ALIGNS them**
   (Mark, 2026-09-03, having asked for the same move and then undone it: "just
   bottom right align the existing buttons"). `items-end` on the title row, so
   the button sits level with the LAST line of the title block rather than the
   first — which is what looked wrong once each of those titles gained a
   description under it. It is the cheaper answer to the same complaint, and it
   leaves the Facilities pattern as the exception rather than the rule.
   **FLAGGING AN ISSUE BY HAND WAS IMPOSSIBLE** (Mark, 2026-08-30, walking a
   real list: "I get a message 'Say what is wrong before flagging it' but I see
   no way to add a note"). A deadlock, and on the module's central act:
   `needsNote` gated the note box on `row.status` ALREADY being `issue` or
   `na`, while `setStatus` refused to SET either without a note — so on any row
   that did not already carry one there was nothing to type in. The only issues
   that could exist were the ones an out-of-range reading raises for itself,
   which write their own note; **which is exactly why the verification walk
   sailed past it** — it flagged by typing 46 °F, the one path that works.
   **THE BUTTON NOW ARMS THE ROW AND THE NOTE COMMITS IT.** Pressing Issue or
   N/A opens the box focused (`autoFocus` fires because the box MOUNTS at that
   moment, and `arming` is null on page load so a row carrying an old note never
   steals focus), shows the button as pressed — it was, and looking inert is what
   the refusal already felt like — and writes status and note in ONE statement on
   blur or ⌘↵. Both columns together is the constraint that started this: 076
   refuses either state with no note, and a raw 23514 is the one refusal an
   inline control cannot explain. **Blurring with an EMPTY box cancels silently**,
   because nothing was written and changing your mind is not an error; clearing
   the note on a row that IS flagged still refuses and reverts, which is the
   other case and a real one. N/A asks "Why not?" where Issue asks "What is
   wrong?".

   **THE TIER PICKER IS All - Done - Remaining - Issues** (Mark's order,
   2026-08-30) — the whole list, what is behind you, what is in front of you,
   then what needs somebody, widest to narrowest, with the two you move between
   while walking side by side. **`Done` MEANS ANSWERED, not the `done` STATUS**:
   that is `progressLabel`'s own definition and its count sits on the SAME ROW
   ("13 of 70 done"), so two numbers a hand's breadth apart cannot disagree
   about one word. It also makes the tiers reconcile — Done + Remaining is
   exactly All, Issues a subset of Done — where the strict reading would strand
   every `na` item in no tier but All.
   **A FLAGGED ISSUE IS NOT OUTSTANDING** (Mark, 2026-08-30: "if everything is
   either marked done or flagged, then there aren't any outstanding issues. The
   box says items flagged are outstanding issues and I disagree"). He is right,
   and it goes to the module's posture: a checklist's job is to FIND what is
   wrong, not to fix it, so an item looked at, found broken and written up is as
   answered as an item gets — and telling its author they have not finished
   tells somebody who did the job properly that they didn't. `checklistReadiness`
   no longer counts them; the confirm states them as INFORMATION beside the
   caveats ("1 issue is flagged, and it goes in the report"), which is
   `salesNote`'s rule in this same codebase. **A flagged item still wants its
   PHOTO** if one was asked for — that is a separate obligation, evidence
   somebody asked for and did not get, and only the issue stopped being a caveat.
   **FINISH IS BLACK ONLY ONCE NOTHING IS OUTSTANDING, AND IS NEVER GATED ON IT.**
   Mark asked whether it should only work at Remaining 0 and was talked out of
   it: `checklistReadiness` is built on `closeReadiness`'s posture and says why
   in its own words — gate finishing on a complete set and the night the walk-in
   floods is a report that never gets sent. Gating would also tax every
   legitimately unanswerable item with an N/A *and a note* before anybody could
   submit, and leave a supervisor at 68 of 70 unable to record the two issues
   they did find. So the WEIGHT carries the message instead: ordinary while
   anything is unlooked-at, filled once it is the obvious last act —
   `PRIMARY_BUTTON_CLASS`'s own "only ever right CONDITIONALLY" rule, the same
   shape as /timesheets filling Import while the pay period is empty.

   **THE WALK OPENS ON `All`** (Mark, 2026-08-30), not on Remaining. A list that
   hides the items you have already answered reads as a shorter list than the
   one you are holding, and on a 70-item closing routine the rows moving out
   from under you as you tick is what loses your place. The other three tiers
   are for looking something up; the walk itself is the whole list in the shop's
   own order.
   **YOU COULD NOT FINISH A CHECKLIST FROM INSIDE THE SHIFT REPORT** (Mark,
   2026-08-30). `WalkRunner`'s footer owned the button and `ChecklistPage`
   mounts only `ChecklistWalk`, the body — so from the report you could answer
   every item and the run stayed `open`, the submit page went on saying "the
   checklist is answered but has not been finished", and the only way out was an
   "Open it full screen" link, finishing there, and coming back to a report you
   had left. **The act is `components/checklists/FinishChecklist` now** and both
   surfaces call it — extracted rather than copied, because it carries a
   confirm, a readiness list, a findings sentence and a row-count check, two of
   which have been got wrong once each already. **What it does NOT own is where
   you go afterwards**: the full-screen runner LEAVES on success (finishing is
   the end of that task) while the embedded one must not navigate at all, hence
   `onFinished`. **"Open it full screen" is GONE** (Mark, same day) — with
   Finish here it was the one control on the page that threw away where you
   were. The embedded button is ORDINARY, not filled: this report's single
   outcome is Send on its submit page, and finishing the checklist is a step on
   the way.
   Page 7 of the shift report is **"Tomorrow's production"** (was "Tomorrow's
   paper"), and both of its empty states are just **"None."** — a heading that
   already names the shop and the date does not need a sentence repeating them.

   **THE RUNNER'S FOOTER IS WHITE AND ITS COMMIT IS BLACK** (Mark, 2026-08-30).
   It was a black bar with the colours inverted — a white Finish on black —
   which said the right thing backwards and made this the one screen in the app
   where the important button is the pale one. It now matches the RECEIVING
   SCREEN, which is its closest sibling: `Close` beside a black commit, an
   escape beside a commit rather than a row of peers, which is the panel-commit
   exception applied to a screen that behaves like a panel because a run
   produces ONE outcome.
   **THE TOP RULE IS NOT OPTIONAL** — Mark asked whether it needed one, and the
   app had already answered twice: `SpecialOrdersList`'s pinned legend draws a
   `border-t border-hairline` for the stated reason that "without a top rule the
   rows scroll up into an unmarked white band", and `ui/StickyFooter` deliberately
   contributes position and a white backdrop and NOTHING ELSE, leaving the frame
   to the caller. On a black bar the band separated itself; on a white one
   nothing does.
   Both buttons are ONE BOX — same border, same 56px height, only the fill
   differs (`WorkingHere`'s rule) — and the sizing is the runner's own rather
   than `BUTTON_CLASS`/`PRIMARY_BUTTON_CLASS`, whose colours and hover
   inversions they borrow: those are `h-9` at 12px, the DESK metrics, and this
   screen is tablet-first where 36px is under the 44px a thumb wants.

   **THE BUTTON NAMES THE MECHANISM, NOT THE RECORD — "Pin to future
   checklists"** (Mark, 2026-09-09, in two steps: "when the 'raise a task'
   button appears on a checklist, it's unclear what the button does/will do",
   and then, reading the description that answered it, "I think a different
   label for the button is needed. 'Pin to future checklists' or something like
   that").
   **HIS SECOND MESSAGE WAS ALSO A QUESTION ABOUT BEHAVIOUR AND THE ANSWER IS
   YES**: "if the user doesn't raise a task, then, the next time a checklist is
   run the issue will not appear on it?" It will not, and this is the thing to
   know about the whole module. A run reads exactly TWO things — its OWN
   `checklist_run_items`, scoped `.eq("run_id", runId)`, and the shop's open
   `location_tasks`. **Nothing anywhere looks at a previous run.** So a flagged
   item nobody pins is recorded on that night's run and in that night's emailed
   report, and is never seen again. Checked in the code rather than reasoned
   about, because it is the premise the label now rests on.
   **WHICH IS WHY "Raise a task" WAS THE WRONG LABEL.** It named the ROW that
   gets written — true, and not what the person standing there is deciding. What
   they are deciding is whether this survives tonight. The pinning is the
   consequence they cannot see and the reason the button exists, so it belongs
   on the face of it.
   **THE DESCRIPTION SWAPPED JOBS WITH THE LABEL.** For one commit it carried
   the carry-forward and deliberately left the task record out, on the grounds
   that "Raise a task" had already said so. With the label naming the mechanism
   instead, the record became the unsaid half — so the line is now "It becomes a
   task, and stays until somebody closes it", which names the record and the
   only way it ends. The done-state moved with it: "Reported —" became
   "Pinned —", so the past tense echoes the verb rather than introducing a third
   word for one act.
   **THE LABEL STAYS TRUE FOR THE TASK'S WHOLE LIFE, checked rather than
   assumed**: `carry_forward` is `not null default true` (075) and is written
   ONLY at creation, by `NewTask`'s own switch. Nothing edits it afterwards, so
   a task pinned here cannot quietly stop being pinned. **If that ever becomes
   editable, this label is the thing that starts lying.**
   **STILL THE EXCEPTION THE "STOP WRITING HINTS" RULE NAMES** — a line earns
   its place when it states a fact the reader cannot see — which is what the
   whole exchange turned on: the first description was accurate and the button
   above it was still naming the wrong thing.
   Measured at 1024, 820, 768, 600 and 375: the button is **231×44 at every
   width** (`shrink-0`, so it never wraps or squeezes), with the sentence beside
   it down to 768 and on its own line below that.
   **THE BAND IS "PINNED TASKS" AND EACH LINE LEADS WITH ITS SHELF** (Mark,
   2026-09-09, four wordings in one message; the label shortened again to
   **"Pin to checklists"**, since "future" is what "pin" already means, and the
   description to "Pinned tasks show on future checklists until someone
   completes it").
   **"Carried over" NAMED THE MECHANISM AND "Pinned tasks" NAMES THE THING** —
   and it now matches the button that creates them, which "Carried over" never
   did. One verb for one act, across the button, its done-state ("Pinned —") and
   the band.
   **THE SECTION IS THE HALF THAT MAKES THE BAND A ROUTE.** A pinned band of
   five jobs with no places on it has to be read line by line to work out which
   are on your way to the next shelf — and the title cannot say it, since "All
   trash taken out" is true of three sections. `taskLineLabel` composes
   "FOH: All trash taken out — Cans dirty".
   **`location_tasks.shop_section_id` HAS EXISTED SINCE 075 AND THIS PATH HAD
   NEVER WRITTEN IT.** Every task raised from a checklist arrived with an empty
   Where — on the Tasks screen as well as in the band — so this fills a column
   that was already there rather than adding one. It writes the run item's
   **id**, not its snapshotted `section_name`: a task outlives the run, so it
   should follow a shelf that gets renamed, where the run's own copy is
   deliberately frozen (076's decision 1).
   **COMPOSED AT READ TIME, NEVER BAKED INTO `title`.** The title is a stored
   column that `/tasks` shows in its own Title cell BESIDE a Where column, so a
   prefix would print the section twice there — and would freeze a name that can
   change. One function, and each screen decides whether it wants the place in
   the line.
   **NOTHING IS INVENTED for a task with no section**, which is every one raised
   before this: they read exactly as they always did. Pinned by fixtures for
   absent, null and whitespace-only, and checked by breaking the composer.
   The walk's own grouping still uses the run's snapshotted `section_name`; the
   new `shop_section_id` on `WalkItemRow` is only ever carried onto a task.
   **AND THE TASKS DIALOGS' TEXTAREAS WERE GREY** where every field beside them
   was black (Mark, 2026-08-30: "most fields have black borders, details is
   grey"). `NewTask` and `ResolveTask` were the only two form textareas in the
   app dressed in `border-hairline` — `NewPurchaseRequest`, `RequestActions`,
   `ProcessPo`, `SendDocument` and `InquiryForm` all use `border-ink`, which is
   also what `TextInput` and `PickList variant="field"` sit at. A grey box next
   to a black one reads as a disabled field. (The runner's and the shift
   report's inputs keep `border-hairline hover:border-ink` — that is the
   tablet-first dense dress, a different surface.)
   **PICKING A PIECE OF EQUIPMENT FILLS IN WHERE IT STANDS** (Mark, same day).
   `NewTask` takes `shop_section_id` on its equipment options now and fills the
   Where field from it — but only when that field is EMPTY or holds a value the
   dialog itself put there, tracked by `sectionWasFilled`. A section somebody
   chose is never overwritten, while changing equipment does move one that was
   autofilled; clearing the equipment leaves the section alone, since "where" is
   still true of the job once it stops being about a particular machine.
   `createSpecialOrder`'s seed-once-never-slave shape. Verified against Mark's
   own equipment: Coffee Grinder → FOH, changing to 20 QT Mixer → Kitchen, then
   Office chosen by hand → survives a change to Espresso Machine.
   **@react-pdf's BUNDLED HELVETICA IS WinAnsi AND EMITS NOTHING FOR A CHARACTER
   IT CANNOT PLACE** — no box, no question mark. `expected 34–40 °F` printed as
   **"expected 3440 °F"**, which does not lose the range, it replaces it with a
   different number, on the page you hand a health inspector. The same trap cost
   the recipe sheet its `≥` once already. `ChecklistPdf` has a `pdfText()`
   sanitizer while `readingLabel` keeps its en dash for the screen and the email.
   **Verify a PDF by inflating its content stream, never by looking at it.**
   **1,436 fixtures pass**, and the whole module was WALKED against the live
   database 2026-08-30 and left as found (0 runs, 0 tasks, 0 photos): a
   walkthrough scored, an out-of-range reading raising its own issue, a task
   raised from it and appearing in the carried-over band of that night's
   CLOSING checklist, a photo attached and removed, the PDF's text runs decoded,
   Reopen clearing `submitted_at` with every answer intact, and the real email
   rendered over live rows in Node — HTML and `toText` both.
   **DF01 Manager Walkthrough IS LEFT ON THE LIVE DATABASE and its three items
   are PLACEHOLDERS** invented for that test. It is never offered automatically
   (`weekdays` null), so it is harmless — replace the items before treating it
   as a real list.
   FMP's closing routine had a piece the app didn't: a list the supervisor
   walks at the end of a shift, grouped by shop section, ticked off,
   photographed, with anything wrong flagged into the emailed report. It was
   scoped out of the shift report on 2026-08-28 and four nav stubs were waiting
   for it.
   **THEY ARE ONE MACHINE — observation → finding → work → verification.** A
   checklist run, a manager's WALKTHROUGH and an INSPECTION LOG are all
   observations (one template/run family, told apart by `kind`); a TASK and a
   MAINTENANCE REQUEST are the same work at two levels of escalation (one
   table, one `kind`). 035's merge precedent in Mark's own words — "Events
   already had different types, what's one more" — and 051's `kind` column. Six
   nav entries over two spines.
   **CHECKLISTS MOVED FROM OPERATIONS TO THE LOCATION SECTION** (Mark: "I sort
   of feel I misplaced the location of checklists in the menu"). The nav is
   organised by THE WORK and every one of these is about the BUILDING — the
   same argument that put purchase requests under Purchasing. The Operations
   stubs "Check Lists" and "Master Check Lists" are gone; the Location section
   is Locations · Shop Sections · Checklists · Tasks · Maintenance · Inspection
   Logs · Equipment, and all of it sits INSIDE `InactiveLocationGate` (unlike
   `/employees` and `/sales`, these really are location-scoped: you do not walk
   a closing list at a shop that is shut).
   **THE WALKS AND THE MASTER LISTS SHARE ONE SCREEN** (Mark, 2026-08-30:
   "instead of having a checklist and master checklist menu options, what about
   just having a Checklist screen with tab picker … Basically combine the two
   screens into one"). They shipped as two adjacent nav entries the day before,
   which made you decide which one you wanted before you could look at either —
   and they are the same subject at two moments. `/events` is the precedent for
   the mechanism: a `TabPicker` over two populations fetched under different
   rules and rendered with different columns. **Only the LISTS merge** — both
   records keep their own address, `/checklist-templates` (the list) is a
   redirect shim (`/location`'s pattern, since that address is in the record's
   own breadcrumb), and the nav entry carries **`also: ["/checklist-templates"]`**
   so the shim AND the still-live record route both light the tab
   (`/timesheets`' idiom for `/pay-periods`). The view is a REAL NAVIGATION
   rather than `history.replaceState`, because the two halves are different
   QUERIES and the server has to run the other one — `/events`' own split — and
   the default writes no parameter so `/checklists` stays canonical.
   **A RUN SNAPSHOTS ITS TEMPLATE** — 013's rule, and the most important thing
   here. Without it, rewording an item in September silently rewrites what
   August's supervisor is recorded as having been asked to check. The SECTION
   NAME is snapshotted as text beside the id, so a shelf renamed or deleted next
   month cannot rewrite or blank last month's walk.
   **A CHECK IS FOUR STATES** — pending / done / issue / n/a, the order guide's
   three-state lesson widened by one. Pressing the state an item is already in
   returns it to pending, which is the only undo.
   **AN ITEM CAN ASK FOR A NUMBER, AND AN OUT-OF-RANGE READING RAISES THE ISSUE
   BY ITSELF** (Mark: "having the supervisors enter fridge temperatures would be
   pretty awesome"). That is the one place this module lets the app decide
   anything, and the line is worth keeping: **the app must never decide what
   counts as dirty, and it can absolutely decide what counts as above 40°F.** It
   writes a note naming the value, because 076 refuses an issue with no note and
   the constraint should be met by a true sentence rather than an empty string.
   **EQUIPMENT IS THE MISSING NOUN.** Without it a task says "the fryer" as a
   STRING and nothing can aggregate — no repair history, no per-unit trend, no
   cost per asset. With it, a reading belongs to THAT walk-in and "this one has
   crept 36 → 39 over six weeks" is a failing compressor visible before it
   fails. `warranty_ends_on` reuses 034's expiry vocabulary whole, null meaning
   "does not lapse". `vendor_invoice_id` is the money seam and has no reader.
   **THE SHIFT-REPORT LINK IS AN FK, NEVER A (location, date, shift) TUPLE.**
   070 declined a unique constraint on that tuple because a HANDOVER
   legitimately produces two closing reports for one night — so the tuple does
   not identify a report and a join on it would attach a walk to the wrong one.
   **THE BUSINESS DATE IS THE MODULE'S HIGHEST-RISK BUG.** A closing walk
   finished at 1:15am belongs to YESTERDAY, and `current_date` is UTC, so after
   4pm Pacific it is already tomorrow. `businessDateFor` in `lib/checklists` is
   the one rule, derived in the org's timezone and passed in; nothing in
   075–077 calls `current_date`. Closing only, 5am cutoff, editable.
   **THE CARRY-FORWARD HAD TO GET LOUDER.** Mark's best idea here — a manager
   flags the dirty fryer on a walkthrough and it appears on every subsequent
   supervisor's checklist until it is done — has one failure mode, and
   `lib/facilityTasks` is aimed at it: a task appearing IDENTICALLY for thirty
   nights is one people learn to scroll past, which trains them to skim the
   section that also holds tonight's real work. So a task is its OWN RECORD with
   one identity and one close (never a row copied onto thirty nights), it AGES
   visibly, somebody other than tonight's supervisor can close it or promote it
   to maintenance so it LEAVES the nightly list, and after a week
   `staleTaskBanner` surfaces it where a manager reads.
   **CANCELLING NEEDS A REASON AND FINISHING DOES NOT** — 032's shape, the
   requirement riding the DECISION. There is NO delete policy on
   `location_tasks`: cancelling is the eraser (059's rule), so a `delete` from
   the app removes 0 rows and returns NO error and the screen must never offer
   one.
   **SCORING IS PER ITEM** (Mark's call over per-section) with three mitigations
   against the measured all-fives hazard — 89% of FMP's 40,793 shift ratings are
   a 5: the score is optional with "not scored" resting, pressing it again
   clears it, and the section roll-up is DERIVED from whatever was scored. A
   section with nothing scored is NULL, never zero — zero is a real score in
   035's range and defaulting to it reports the worst possible verdict on a
   section nobody looked at.
   **`cardinality`, NEVER `array_length(x, 1)`** — caught on the harness by
   asserting a refusal rather than assuming it. `array_length('{}', 1)` returns
   NULL rather than 0, so the predicate is NULL, and **a CHECK CONSTRAINT PASSES
   ON NULL**: the empty array sailed straight through. Written that way first.
   **DEPARTURE, DELIBERATE: there is no `task_checklist_done` column**, although
   this file predicted one. 070's own comment says its three `task_*` flags
   exist because each is "an act NOTHING ELSE CAN OBSERVE" — and with checklists
   as rows, whether the checklist was done IS observable (a linked run,
   submitted). A boolean beside it would be a second answer to a question that
   has one, which is 016's trap. The submit page says "3 of 27 checklist items
   have not been looked at" instead. `submit_shift_report` and
   `reopen_shift_report` are UNTOUCHED: two acts, not one.
   Screens: **`/checklists` IS ONE SCREEN OF TWO VIEWS** — Checklists |
   Templates, a `TabPicker` over two populations fetched under different rules
   and rendered with different columns (`/events`' precedent). They shipped as
   two adjacent nav entries on 2026-08-29 and merged the next day (Mark: "what
   about just having a Checklist screen with tab picker … combine the two
   screens into one"), because deciding which of two menu items you wanted came
   before you could look at either. **Only the LISTS merged**: both records keep
   their own address, `/checklist-templates` (the list) is a redirect shim
   (`/location`'s pattern, since that address is in the record's own
   breadcrumb), and the nav entry carries **`also: ["/checklist-templates"]`** so
   the shim AND the still-live record route both light the tab. The view is a
   REAL NAVIGATION rather than `history.replaceState` — the two halves are
   different QUERIES — and the default writes no parameter so `/checklists`
   stays canonical.
   Plus `/checklists/[id]` (read-only archive) + the runner at
   `/checklists/[id]/run` in the `(fullscreen)` group (the order guide's posture
   — one scrolling document, black shop-section bands in the shop's own walk
   order, 44px targets, `text-[16px]`, every tap writing immediately);
   `/checklist-templates/[id]` (duplicate-to-another-shop maps sections BY
   DISPLAY NAME, names what didn't map, and arrives INACTIVE — `PlanDetail`'s
   duplicate with the one thing that build didn't need); `/tasks` +
   `/maintenance-requests` (one table, two doors); `/equipment` + record with
   its reading history; `/inspection-logs`.
   **"WALK" WAS A WORD THIS MODULE INVENTED** and is gone from every visible
   string (Mark, 2026-08-30). The tab is **Checklists**, the command **New
   checklist**, the second view **Templates** — which is what the route and the
   `?view=` parameter always said, so only the words were out of step. The tab
   echoing the screen's own name was the deliberate trade: a supervisor says
   they are doing the checklist, and a tab nobody recognises costs more. The KEY
   stays `walks` and is invisible (it is the default view, so only
   `?view=templates` reaches an address bar). **The command's noun is a PROP**,
   because `/inspection-logs` renders the same control and "New checklist" there
   would name the wrong record; and **the runner names its KIND** off the run's
   snapshotted `kind`, since one hardcoded noun would be wrong on two of three.
   `ChecklistWalk` is ONE COMPONENT WITH TWO DOORS — standalone and as a page of
   the shift-report runner, which gained `checklist` in `pagesForShift` for every
   shift (closing 8 pages, opening 6, mid and off-site 5).
   **078 — A CHECKLIST ITEM SAYS FOUR THINGS AND 076 MODELLED TWO**, which two
   real DF01 documents settled and no amount of design would have. The paper has
   a checkbox, the instruction, a WHO (Baker, Fryer, Assistant Baker,
   Supervisor) and a NOTE ("water emptied", "replace filter on Tue/Fri/Sun"). So
   `guidance` and `position`, both nullable on the template item and both
   SNAPSHOTTED onto the run item. Of 105 real items 23 name a position and 16
   carry a note — most have neither, which is why neither has a default.
   **`position` is the ROSTER vocabulary** (`employees.position`), NOT
   `org_members.role`: the two overlap on "Supervisor" and mean different things
   by it. A hint, never a gate.
   **THE SECTION VOCABULARIES DO NOT MATCH, and the brief was wrong to claim a
   walk follows the order guide's route.** DF01's 72 shop sections are SHELVES
   for counting stock — "Walk In R1 S3", "FOH Cab 2" — where the checklists walk
   ROOMS. Only OFFICE matched. Mark's call: use the area-level sections that
   already exist, add seven FOH sub-areas at **60.1–60.7** inside FOH's own
   60–69 band, plus one new "Outside" at 0; mop room → Kitchen Dish Pit
   ("basically in the dish pit"). They add nothing to the order guide — a
   section with no inventory renders no band there.
   **DF01's REAL OPENING AND CLOSING LISTS ARE LOADED** (2026-08-30) —
   `migration/load-df01-checklists.mjs`, 8 new shop sections, 2 templates, 105
   items, transcribed with `pdftotext -layout` rather than retyped by eye.
   Three of Mark's own typos are VERBATIM ("fillout out complely", "santized",
   "toilet bush"): correcting somebody's document while copying it is not a
   thing to do quietly. The loader is dry-run by default and idempotent —
   re-running REPLACES a template's items rather than doubling them, which is
   safe because a run snapshots its own copy.
   **KNOWN AND UNANSWERED: the walk order does not match the paper.**
   Between-section order comes from `shop_sections.sort_order`, which is the
   ORDER GUIDE's route — Kitchen(10), Bathroom(50), FOH(60), Office(90), i.e.
   back-to-front, because that is how you count stock — where the closing list
   goes front-to-back. Fixing it means moving existing sections (which moves the
   order guide) or giving a template its own section ordering. Ask before either.
   **STILL NOT BUILT, named so nobody thinks it was forgotten:** a cadence
   engine (PM wants three shapes and a general scheduler is where this
   metastasizes), PHOTOGRAPHS IN THE PDF (@react-pdf fetching signed URLs is a
   real risk and the document is useful without them — a second pass),
   cost-per-asset (`location_tasks.vendor_invoice_id` is the seam and has NO
   reader), an editor on the run record (read-only on purpose — one write path,
   and the runner is it), equipment DELETE, and everything an inspection log
   wants beyond a filtered list — the inspector's document, findings with
   deadlines, permit expiry. The checklist PDF is NOT attached to the
   shift-report email; the email carries the findings as text instead.
   Verified: **every migration replays on the Docker harness**, every constraint
   refuses what it should (checked by asserting the refusal, which is what found
   the `cardinality` bug), and as REAL AUTHENTICATED ROLES a supervisor reads a
   colleague's run and **updates 0 rows with NO error**, a staffer sees 0 runs
   and 0 tasks while reading the templates, a purchaser edits a master where a
   supervisor's update changes 0, an author's write to a SUBMITTED run changes 0
   and a delete removes 0 — all silently — an owner always writes, `anon` sees
   nothing, and a junk storage path is refused by the POLICY rather than raising
   a cast error. **1,436 fixtures pass** (1,416 at first ship), each rule checked by BREAKING
   it (the ISO weekday, the after-midnight rollover, the out-of-range issue, the
   unscored-section null, the carry-forward order, cancelled-counted-as-open and
   the silent age label all go red). All **78 migrations** replay clean.
   **WALKED END TO END against the real DF01 data 2026-08-30 and left as found.**
   What that proved beyond the harness: the UI wrote `weekdays [6,7]` and
   `shifts ['closing']`, so the ISO mapping holds through a real picker; Sunday
   matched and the "asked for today — not started" band appeared; the snapshot
   took 4 of 5 items, leaving off the Monday-only one; **44°F against 34–40
   raised the issue BY ITSELF and wrote its own note**; raising a task linked it
   so the item reads "Reported"; the carried-over band appeared at the top of
   the next walk immediately; the readiness confirm named what was outstanding
   and let me through; and Finish left for the archive.
   **THE MISSING-NIGHTS NOTE IS ONE STATEMENT IN WHICHEVER PLACE CAN BE SEEN**
   (Mark, 2026-08-31: "in place of the empty table, why not put the text above
   there instead?"). `/shift-reports`' Needs-attention count is flagged reports
   PLUS nights the shop was open and nobody reported — and those nights have no
   ROW, they are a band above the table. So with nothing flagged, the tab read
   5 over a table reading "Nothing needs attention", which is the screen
   contradicting itself; the first fix put a second sentence in the empty slot
   pointing AT the band, which is one fact stated twice an inch apart. Now
   `gapsNote` renders in the table's own empty slot when there are no rows, and
   ABOVE the table when there are — never both, because when rows exist the
   empty slot does not. Verified both ways at 1440, the second by temporarily
   flagging every report (tab 7, note above, two rows beneath).
   **PAGE 8 SAYS NOTHING IT CANNOT ACT ON** (Mark, 2026-09-03, four sentences
   over three passes). Gone: the blockers box's "These can only be answered
   tonight"; the outstanding box's "You can send it anyway — this is a list, not
   a gate"; and BOTH of `salesNote`'s lines, so **that function is deleted**
   rather than left returning null.
   The sales pair is the instructive one. "Square has not reported this day yet
   — the figures will arrive on tomorrow's sync" was the NORMAL case, so page 8
   opened by describing a wait nobody is waiting on and that no act of a
   supervisor's can end; "Sales are in." then went with it, because a page
   listing what is UNRESOLVED has nothing to say about a thing that resolved
   itself. The figure is on page 3 and in the email. Two comments elsewhere
   cited `salesNote` for the "INFORMATION, never a caveat" rule; the rule
   survives, the citations now state it rather than pointing at a dead function.
   The two prose lines under the boxes were each explaining the box above them,
   which the box's own heading already does.
   **AND THEN THE TWO BOXES BECAME ONE, ALL RED** (Mark, same day: "we have two
   distinct boxes when I think one would do", then "make all the text the same
   — red"). The gate-versus-list distinction cost a heading, a border and 32px
   of air to state something the SEND BUTTON already enforces — it is disabled,
   and its tooltip names the blockers — so what is left on the page is one list
   of things somebody should deal with. Blockers lead, because you cannot leave
   without them; the heading follows the box's JOB rather than its contents
   ("Before this can be sent" while one is present, "Still outstanding"
   otherwise); and the only thing still telling the two kinds apart is the
   BORDER, red and 2px when blocked. **The box is FILLED yellow** (Mark's third
   pass), which is the mark colour doing what this file says it is for — a
   fill, never an ink — over the whole thing rather than per line. Red on
   yellow-200 measures **4.62:1**, which passes AA; worth re-measuring if
   either token moves. **The heading sits OUTSIDE the box and centred** (his
   fourth), so it titles the thing rather than being its first line. The arrays
   stay separate in the props and in `submitReadiness`/`submitBlockers` — this
   is a rendering decision, and the email still reports only `outstanding`.
   **THE REPORT IS THE LAST PAGE BEFORE SUBMIT, ON EVERY SHIFT** (Mark, same
   day). It was already true of opening, mid and off-site and false of CLOSING,
   where Tomorrow's production sat between the two — so the one shift with
   something to write was asked to write it, sent off to a printer, and then
   shown a submit page. Everything above the report is a thing you look at or
   count; the report is what you make of it, so it reads last and the next tap
   sends it. Nothing depends on the order (`submitReadiness` and
   `submitBlockers` both ask `pages.includes`, and the runner numbers what it is
   given), which is exactly why a fixture pins it — a reorder would otherwise
   break the rule in silence.
   **THE RUNNER HAS ONE TYPE SCALE, AND `main` SETS THE BODY SIZE** (Mark,
   2026-09-03: "the font changes between pages 4 and 5"). It did — and between
   most other pairs too: eight pages had grown 12 · 13 · 14 · 15 · 16 · 18 with
   no rule, so a row was 15px on Premades, 16px on the checklist and 14px on
   the report. The scale now: **18px** the black banner only, **16px** body —
   every row, value, list item and input — and in-page headings at 16px bold
   uppercase (`ui/SectionHeading`'s own size), **14px** secondary (muted notes,
   hints, errors), **12px** uppercase small-caps labels and table column heads.
   16px is not a taste: it is the threshold below which iOS Safari zooms a
   focused input, so the fields were already there and the text beside them
   should match.
   **`text-[16px]` ON `main` IS WHAT MAKES IT HOLD.** The app's base is 15px (a
   DESK size, `--rf-text-base`), so anything this surface does not size
   explicitly inherits it — a `ui/Checkbox` label sat at 15 beside 16px rows.
   Setting it once on main covers every unstyled element, now and later.
   Deliberately NOT touched: `ui/SectionHeading`'s 13px count badge and
   `lib/anchoredPanel`'s 9px caret, both shared with every other screen in the
   app — this pass was the shift report, and those are a wider decision.
   **AN EMPTY STATE THAT IS THE WHOLE PAGE IS CENTRED HORIZONTALLY AND NOT
   VERTICALLY** (Mark, 2026-09-03) — a bare `text-center` paragraph at the top,
   uncapped so it stays on one line. Two of them: the checklist page's "No
   checklist is set up for this shift at this shop" and the premades page's "No
   production schedule was generated for this shop today".
   **The vertical version was built first and is instructive.** It needed
   `main` to be a flex column so the page could claim the height — `h-full`
   does not work, main being a `flex-1` block whose height is not a definite
   value for percentage resolution, measured at 24px inside a 595px parent —
   and THAT quietly narrowed all eight pages, because every page root is
   `mx-auto max-w-*` and AUTO MARGINS ON A FLEX ITEM MAKE IT SHRINK-TO-FIT
   (measured, 365px where 672 was right, which looks like a deliberate layout
   rather than a fault). `main` is a plain block again and both hazards go with
   it; widths verified afterwards at 672 / 768 / 896 as declared.
   **IT MOVED UNDER THE TAB PICKER 2026-09-03** (Mark), which retires the
   two-places arrangement above: the nights are half of the Needs-attention
   COUNT, so the sentence explaining that count belongs beneath the tab carrying
   it — over the tabs it read as a banner about the whole screen. One place now,
   in `leading` below the picker, so it sits directly over the table whether or
   not the table has rows, and the empty slot no longer stands in for it. The
   contradiction that started all this is still closed, by wording rather than
   by placement: with gaps present the empty slot says **"No reports need
   attention"**, which is about REPORTS and does not argue with a line naming
   nights that produced none. **The other three tabs carry counts too** — they
   had none, so the one tier with a count read as the only one that was
   measured.
   **THREE BUGS ONLY RENDERING COULD CATCH**, none of which typechecks, lints or
   fixture-fails — see `docs/checklists-brief.md` for each:
   an HTML ENTITY IN JSX TEXT EATING THE SPACE after an interpolated value (a
   whole-app trap, now a convention below); a shared class string carrying
   `text-white` that the commit appended `text-ink` to, rendering the runner's
   **Finish button WHITE ON WHITE** — invisible, on the module's primary screen,
   found with `getComputedStyle` because by eye the footer just looks like it
   has one button; and the walk row OVERLAPPING ITSELF at 375px, because
   `flex-wrap` only helps when a child can claim the next line and a `flex-1`
   sibling has a 0 basis. That last had been true since the runner shipped and
   was invisible because it was only ever checked at desktop width.

   **AN INSPECTION LOG IS THE RECORD OF A VISIT, NOT A WALK — migration 093,
   APPLIED 2026-09-05 and LOADED the same day** (`migration/load-inspections.mjs`:
   13 inspections, 12 reports filed, a second `--apply` filed 0). *Probe, don't
   read this line*: `select count(*) from inspections` (13); `select count(*)
   from facility_photos where inspection_id is not null` (12). Walked live at
   DF01 and left as found: the four DF01 rows, the 2024-09-11 record with FMP's
   line breaks intact and its PDF served through the signed link (200,
   application/pdf); a task raised from it with a due date landed in Follow-up,
   on `/tasks`, and as "1" in the list's Open tasks (then cancelled with a
   reason — there is no task delete); a throwaway inspection filed through New
   inspection landed dated the ORG's day (2026-09-05 where UTC read the 6th)
   and Delete named it and returned to the list. Mark, 2026-09-05: "conceptually I think of the inspection log as a
   record of a visit by the health inspector (or some other city or county
   inspector). It's the result of their inspection and nothing more. Not a walk.
   No need for a template as far as I can tell. … I would just build a way to
   record an inspection, upload the report, and track what things we need to
   work on." This REVERSES 076's modelling of an inspection as a
   `checklist_runs` row of kind 'inspection' (never used — no template of that
   kind was ever created). FMP's `InspectionLog` had exactly the new shape:
   type · date · score · a container with the hardcopy · Violations ·
   Violations_Corrected, 13 records, all Health, scores 92–99.
   **093**: `inspections` (its own table, not nullable-template runs — every
   reader of `checklist_runs` assumes items exist); `facility_photos.inspection_id`
   as a THIRD owner, the one-owner CHECK widened; `location_tasks.source_inspection_id`
   (`set null` — deleting the record of the visit does not make the drain less
   loose). RLS is 075's tasks: supervisor+ select/insert/update, **owner/admin
   DELETE** (023's rule). `score` is TEXT (the next inspector writes "A");
   `inspection_type` is free text with `allowNew` (all 13 say Health). Verified
   on the Docker harness as real roles: a supervisor files and edits, cannot
   claim another's `created_by`, deletes 0 with no error; staff and anon see 0;
   a report with no owner or two owners is refused by the CHECK; the owner's
   delete cascades the report and leaves the task with a null source. 093 is
   NOT rerunnable ("relation already exists" is the signal).
   Screens: `/inspection-logs` (a `DataTable`: Date · Type · Score chip · Inspector
   · Violations excerpt · Report count · Open tasks; **New inspection** in the
   command strip) and `/inspection-logs/[id]` (Details `dl`, Violations and
   Corrected as boxed paragraphs, a **Report** card taking PDFs — `INSPECTION_DOC_ACCEPT`,
   since `PHOTO_ACCEPT` alone would refuse the thing the card is FOR — with
   drop, Open and Remove, and a **Follow-up** list with **New task from this
   inspection**). `ScoreChip` tone follows LA County's grades: quiet ≥90,
   mark-fill 80–89, red below; a letter score gets no tone.
   **`NewTask` gained a Due date and `sourceInspectionId`** — `due_on` had had
   no writer since 075 — so a task raised from an inspection is an ordinary
   `location_tasks` row and lands on every closing checklist until done, which
   is what "show up on the checklist until resolved like issues do" means with
   NO new machinery. Deeper integration (the inspection appearing ON a
   checklist, for instance) is deliberately NOT built: Mark asked to talk first.
   The template kind picker stopped offering 'inspection'; the kind stays in the
   type and the check. `checklist_runs` keeps its `kind` check unchanged.
   **The loader matches the 12 exported PDFs to the 13 records BY DATE** from a
   table typed in the file — a `.mer` carries a container's filename, never
   its bytes — and is idempotent on `(org_id, legacy_id)`, filing a report only
   where the record has none. Dry run measured: 13 to load, 12 with a report;
   the 2026-07-06 DF02 visit (score 92) has no document on disk. One quirk kept
   as FMP had it: the 2022-11-16 record says DF02 while its file is named
   `DF03 221116.pdf`.
   Permit expiry was offered and NOT built — Mark did not ask for it.
   **THE REPORT IS PREVIEWED, ON THE RIGHT** (Mark, 2026-09-05, two asks:
   "I'd like to see the inspection document previewed on the detail page",
   then "let the report viewer take up the right side of the screen"). The
   record is a two-column grid at `xl`: details, the two paragraphs and
   Follow-up down the left, the Report column on the right — STICKY under the
   masthead, with the VIEWER BOX measured to the foot of the window by
   `useFillToBottom` (480 floor; 560 overran a 900px window) and the file list
   beneath it. Stacked below `xl` the box is `h-[70vh]`. **Measure the box, not
   the column**: a height handed down through `FileDropZone`'s wrapper and a
   flex chain arrived as 150px, the PDF plugin's own minimum — and a second
   height utility on `Pane` (`h-full`) loses by stylesheet order, so a WRAPPER
   carries the height. The viewer is **`ui/DocumentViewer`**, extracted from the
   receiving screen's `DocumentPane` (PDF via `<object>` with the Open fallback
   iOS needs; images with zoom and rotate; URL held from first render and keyed
   by document id so a refresh never re-fetches the PDF) — one viewer, or the
   two drift. With several files the list's names are the picker.
   **Violations and Corrected are TWICE a note's height** (Mark, same day) —
   `InlineValue rows={8}`, a new prop that drives the textarea AND the resting
   box's floor together (`BOXED_FIELD_TALLER`, `min-h-32`): both 128px,
   measured, so the field does not jump on click. Default 4 rows / `min-h-16`,
   every other note unchanged. **And the record has the book**: the list owns
   its sort (`sortRows`) and publishes the found set under `/inspection-logs`,
   the record renders `RecordNav` in the crumb row — "2 of 4" → Next → "3 of 4"
   verified. A new record screen gets the book by doing those two things.
   **DOCUMENTS — migration 094, APPLIED 2026-09-05 and LOADED the same day**
   (`migration/load-documents.mjs`: 73 documents, 64 files, a second `--apply`
   filed 0; *probe*: `select count(*) from org_documents` 73, `… from
   org_document_files` 64). Walked live and left as found: 73 rows in ten
   category bands with the nine file-less records marked; Espresso Log's record
   with the PDF previewed at the right, Open serving it (200, application/pdf)
   and Download carrying the filename; a throwaway document filed through New
   document and removed through Delete, back to 73.
   **A `FiledDocumentsTarget` MUST NOT CROSS THE SERVER → CLIENT LINE** — it
   carries a function (`rejection`), and passing it from the page took the
   whole record down with "Functions cannot be passed directly to Client
   Components" (`BatchLogDetail`'s lesson, met again the first time the
   component had a second caller). The targets are a registry INSIDE the
   client module and the page passes `kind="inspection" | "document"`.
   **PRINT IS A ROW ACTION** (Mark, 2026-09-06: "Is it possible to add a
   'print' option … along with open, download, and remove?"). It is, by one
   route, `lib/printDocument`: a cross-origin PDF cannot be printed by the page
   (`window.open(url).print()` is refused), but the signed URL already lets the
   app's origin FETCH it, and a blob: URL is same-origin — so fetch the bytes,
   load them in a hidden iframe, and ask that frame to print (print-js's
   technique). Verified by stubbing the frame's `print`: called once, no
   error. Known limit, not fixable from here: **iOS Safari prints only the
   first page of a PDF in a frame**, so Open (the viewer's own print button)
   stays beside it. The document record's Description and Notes are
   `rows={8}`, the inspection's two paragraphs' size. Mark, 2026-09-05: "Super simple. It's just a place
   to store, retrieve, and print the documents the organization uses … Like the
   inspection report, I want to see the document previewed on the right side."
   FMP's `Documents` table, 73 records: title · version (TEXT — "01", "2021",
   "2023-01") · category (free text, nine values, `allowNew`) · shop or ALL ·
   description · notes · submitted by · added · the file in a container. 64 of
   the 73 have a file in the export; nine do not.
   **094**: `org_documents` + `org_document_files` (a record with NO file is a
   real state, and the 4-up beside the single is a second file) and a bucket of
   their own, **`org-documents`** — NOT `facility-photos`, whose reads are
   supervisor+ and whose objects are evidence about a building, where a cheat
   sheet is for every member to read and print. Membership READ (table, files
   and objects), supervisor+ WRITE, owner/admin DELETE (023). `location_id` null
   = ALL. Verified on the Docker harness as real roles (staff read the record
   and the file, update 0, insert refused; supervisor delete 0; anon 0; owner's
   delete cascades the file row; a staffer's object insert refused, a
   supervisor's landed, and the staffer READS it). NOT rerunnable.
   Screens: `/documents` (org-wide, exempt from `InactiveLocationGate`; a
   `DataTable` grouped by CATEGORY with a search box and nothing else; **File**
   column marks a record with none) and `/documents/[id]` (the record on the
   left, the file previewed on the right, the record book). The nav stub became
   the real entry; the sheet's row for the stub is kept as written — **staff
   Read was tried and reverted within the hour**, because Documents sits before
   Production in the menu and would have become every staffer's landing screen
   (`homeHref`); the table policy is membership-wide regardless.
   **THE RECORD'S COMMANDS ARE ONE ACTIONS MENU (Mark, 2026-09-12)** — "combine
   the action buttons on the documents detail page into an actionmenu, place it
   where the delete button currently sits. Rename the attach button to 'Attach
   File...'". **Attach File… · Delete Document… (red)**, in the title row where
   Delete stood; measured at 1440 the trigger's right edge is the content margin
   (1377) and its top is the h1's (98, ink at 99).
   **THE SCREEN'S "ACTION BUTTONS" WERE EXACTLY TWO, one at each end of the
   page** — Attach on the card, Delete beside the title. The per-FILE controls
   stay: Open · Print · Download · Remove are underlined text on each row of the
   list, they act on THAT file, and there can be several, so a screen-level menu
   has no way to say which one it means.
   **`AttachFile` CAME OUT OF `FiledDocuments` TO MAKE THAT POSSIBLE**, and it
   is a component rather than a function because THE HIDDEN INPUT HAS TO COME
   WITH IT: opening a file picker is `input.click()` and the browser honours it
   only INSIDE a user gesture, so the input must be mounted wherever the command
   is. `showAttach={false}` is how this record takes the command while the
   INSPECTION record keeps the button; the drop zone stays on both, a dragged
   file having nowhere else to land. **The upload moved to `documentWrites`**
   beside `deleteDocuments`, which is what keeps the drop and the two buttons
   one implementation — the insert's row count being exactly the thing a copy
   forgets, and a refused insert leaving the file in the bucket and on no record
   at all.
   **`react-hooks/refs` REFUSES A REF CLOSURE HANDED INTO A RENDER PROP**, which
   is `PushToQuickBooks`' wall a second time: the rule reads `children(...)` as a
   CALL DURING RENDER, so a row whose `onSelect` closes over `someRef.current` is
   an error even inside a `useCallback`. Restructured rather than silenced —
   `useId` plus a `getElementById` in the handler, which is where the element is
   wanted anyway. **Reach for that before a disable comment** if a command
   component ever needs a DOM node from a menu row.
   Known and Mark's to reverse: the label is ONE label, so the inspection
   record's button reads "Attach File…" too, where its card is called Report.
   **`components/documents/FiledDocuments` IS THE INSPECTION RECORD'S REPORT
   CARD, GENERALISED** — the table, owner column, bucket, accept list and
   wording are a `FiledDocumentsTarget` (`INSPECTION_DOCUMENTS` in
   `lib/inspections`, `ORG_DOCUMENT_FILES` in `lib/orgDocuments`), so the two
   screens share one preview column, one drop zone and one pair of write
   orders. It gained **Download** (Supabase's `download=` parameter on the
   signed URL) beside Open; **printing is Open** — the browser's own viewer
   carries the print button, and a cross-origin PDF cannot be printed from
   here. `lib/orgDocuments.exportPrefix`/`fileMatchesRecord` is how the loader
   pairs files with records: FMP named each export
   `{shop}_{category}_{title}_{version}_{original}`, so the prefix IS the
   record; one collision (the two Ice Cream Display Signs v02) is told apart by
   the description's "4up". Dry run: 73 to load, 64 with a file, 0 unclaimed.
   **A TASK CAN BE SOMEBODY'S — migration 079, APPLIED 2026-08-31.** *Probe,
   don't read this line; it has been wrong in both directions for four different
   migrations.* Mark, 2026-08-31: "Tasks should be assignable to someone. Not
   mandatory, but when assigned they only appear on that person's checklist."
   **IT POINTS AT AN APP USER, NOT AN EMPLOYEE**, and that is the decision to
   understand before touching any of it. The effect asked for is about WHOSE
   CHECKLIST a job appears on, and a checklist is walked by somebody signed in
   (`checklist_runs.started_by` is an auth user). Assigning to an `employees`
   row would let a shop hand work to the overnight baker, who has an HR record
   and no login (044's distinction) — and the job would then appear on NOBODY's
   checklist while looking assigned. The roster is `org_members`, which 001's
   `members_read` already shows to every member, so this needs **no definer
   function** — unlike 044's `production_operators` and 053's
   `special_order_takers`, which exist only because `employees` READ is
   owner/admin.
   **THE ORPHAN RULE IS THE ONE TO KEEP IF THIS IS EVER REWRITTEN.** 079 has no
   `on delete` clause, matching `created_by` beside it, because revoking access
   BANS an auth user rather than deleting it (4c) — so an assignment outlives
   the login. `taskIsFor` therefore shows a task whose assignee is no longer a
   member to EVERYBODY: without it, the day somebody leaves, every job assigned
   to them drops off every checklist in the shop, silently, which is the exact
   failure the carry-forward exists to prevent. `openTasksForRun` takes a
   `TaskViewer` (viewer id + the current membership) and it is **required with
   no default** — a default of "nobody" would hide every assigned task from a
   caller that merely forgot to pass one.
   **The viewer, never the run's `started_by`**: the band is derived live rather
   than snapshotted, and nothing downstream depends on it — the emailed report's
   checklist section is built from `checklist_run_items`, so what one reader
   sees cannot change what anybody is sent.
   No policy change: 075 is supervisor+ on every verb because a task is a
   supervisor's own record end to end (a ROW rule, therefore a policy), and this
   is one more column on that row. Anybody who can edit a task can assign it,
   including to somebody else, which is what "hand this to Karina" means.
   UI: an **Assigned** column on `/tasks` and `/maintenance-requests` (inline
   `kind="pick"`, "Anybody" resting, sorted by the NAME and not the uuid; widths
   key bumped to **v2**), an **Assigned to** field on the create dialog that says
   in words what assigning DOES ("It will appear on their checklist only"), and
   a quiet label on the walk's carried-over row — named only when it is somebody
   ELSE's, since a row on your own checklist saying "assigned to you" is the
   screen telling you where you are standing. Until 079 is applied both screens
   SAY SO by name (`/tasks` names 079 rather than 075, and the walk carries a
   `taskWarning` rather than an empty band, which would assert that nothing is
   outstanding). Probes: `select column_name, is_nullable from
   information_schema.columns where table_name = 'location_tasks' and
   column_name = 'assigned_to'` (one row, YES), and `select count(*) from
   pg_policy where polrelid = 'public.location_tasks'::regclass` — still
   **THREE**, none of them a delete, or somebody has added an eraser that
   bypasses the reason.
   Verified: all **79 migrations** replay on the Docker harness, and as real
   authenticated roles a supervisor assigns a task to a COLLEAGUE and hands it
   back while a staffer sees 0, updates 0 and **deletes 0 with NO error**, and
   `anon` sees 0. **1454 fixtures pass**, 15 new, each rule checked by breaking
   it — dropping the orphan clause turns 2 red and dropping the assignment
   filter turns 1.
   **WALKED AGAINST THE LIVE DATABASE THE SAME DAY AND LEFT AS FOUND** (both
   real DF01 tasks back to `assigned_to` null). What that proved beyond the
   harness, on Mark's own session: the picker offered Anybody · Mark · Test ·
   Traci — the three members, sorted by name, all supervisor+ — and writing
   through it landed; with the chemicals task assigned to **Test**, its uuid AND
   its title were both ABSENT from Mark's own run at
   `/checklists/[id]/run` while the unassigned one stayed; reassigned to
   **Mark**, it came back reading `Carried over — 2` with a quiet **yours**
   beside it and nothing beside the unassigned one. Note the archive record at
   `/checklists/[id]` renders no carried band at all — the band is the RUNNER's,
   which is where to look when verifying this.

   **PARTIAL DAYS ARE LOADED AND MARKED** (Mark, 2026-08-31: "at one point I
   made the decision to not load partial sales data in Sales. I take that back.
   Let's go back to loading all sales data and making a note when a day's data
   is incomplete."). `SyncFromSquare` stopped at YESTERDAY from 2026-08-28, on
   the reasoning that a part-day "lands in the table looking exactly as
   authoritative as the fourteen complete days beside it". That was right about
   the RISK and wrong about the remedy — today's takings are the figure a
   manager most wants at 4pm, and the answer to a number needing a caveat is the
   caveat rather than the absence. The pull now runs through TODAY.
   **THE CAVEAT IS ANSWERED FROM `synced_at`, NEVER FROM THE CALENDAR**, and
   that is the whole of the care. `isDayComplete` in `lib/sales` asks whether the
   pull happened after the end of the reporting day it covers (Square's runs
   01:00 – 00:59 PT, hence `REPORTING_DAY_ROLLOVER_HOUR`). "Is this date today?"
   goes stale by itself: a row pulled at 4pm Tuesday and never pulled again is a
   part-day forever, and a date test would quietly call it settled by Thursday.
   A **manual** row (065's `source`) is always complete — somebody typed it
   deliberately — and a row with no `synced_at` is treated as complete rather
   than smeared with a warning nothing can clear.
   Two surfaces: a **part day** chip in the day table's Pulled column, which is
   the column that already reports a figure's PROVENANCE and where the `edited`
   mark lives; and a sentence under the summary beside the gap line, kept
   separate from it because a day nobody pulled and a day still being taken are
   different problems and only one is fixed by pressing Sync. **`missingDays`
   still stops at YESTERDAY** — a missing today is not a hole in the history, it
   is a day nobody has synced yet, and reporting it every morning is what
   teaches people to stop reading that line.
   Measured through the real rule over the live table (read-only, paginated on a
   UNIQUE order — ordering by `business_date` alone gave 8,432 rows holding
   8,429 distinct ids, which is the audit trap this file already documents):
   **8,432 rows, 0 incomplete**, so nothing in eleven years of history is
   retroactively marked. The rendering was proved by temporarily moving the
   rollover hour to 23, which correctly painted 2 chips and the sentence naming
   both shop-days. 8 fixtures, checked by breaking it — a calendar-date test
   fails the 00:00–00:59 sliver, and hardcoding UTC fails that and the
   org-timezone case.

