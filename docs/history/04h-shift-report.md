<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4h. ✅ **THE SUPERVISOR SHIFT REPORT — migrations 070, 071, 072, all APPLIED,
   and WALKED against the real database 2026-08-28/29.** Mark: "It's time.
   Everything we need is in place (except for checklists)."
   The last daily routine still running in FileMaker. A supervisor opens a
   full-screen, tablet-first report at the end of a shift, walks the pages that
   shift is asked for, generates and prints tomorrow's kitchen paper on the way,
   and sends: **management gets the version WITH staff ratings, supervisors the
   one without.** 035 predicted this screen in as many words — it deferred the
   ratings writer to "the PRODUCTION module's screen", and this is it. Of the
   43,918 `kind='shift'` rows, not one had been written by this app.
   **THE TWO ANSWERS THAT SHAPE EVERYTHING: write-through, and nothing reaches
   the owning tables until Send.** No permanent second copy of any fact —
   ratings become `employee_events`, counts become `production_schedule_items`
   actuals, yields become `production_batches`, sales are READ and never
   stored. But the report is revisable until submitted, so the three child
   tables (`shift_report_ratings` / `_counts` / `_batches`) are the DRAFT and
   `submit_shift_report` is the one act that flushes them. **The draft is
   PERSISTED**, not held in a browser: pause-and-resume is one of the three
   commands Mark specified and a dropped iPad at 9pm must not cost a shift.
   After the flush each draft row keeps a pointer to the row it created, which
   makes it a transcript rather than a duplicate.
   **PAGES ARE DERIVED FROM THE SHIFT**, and the two production pages are
   MIRRORS that never both appear (Mark, 2026-08-28, correcting his own earlier
   note): the OPENING supervisor records what the overnight bake produced
   (Elements made), the CLOSER records what was left of it (Premades) plus
   sales and tomorrow's paper. Seven pages closing, five opening, **four for mid
   and off-site** — an off-site shift has no kitchen for a batch log to be
   about, which is 317 of FMP's 13,059 reports and a known accepted cost.
   `pagesForShift` returns the list and the runner numbers what it is given, so
   an opening report reads "PAGE 3 OF 5" rather than skipping.
   **THE SHIFT REPORT NEVER WRITES A SALES NUMBER ANYWHERE.** (This paragraph
   used to open "SALES ARE NOT INCOMPLETE AT 9PM — THEY ARE ABSENT, and that is
   better", because `SyncFromSquare` stopped at yesterday so there was no
   `daily_sales` row for today at all. **Mark reversed that on 2026-08-31** —
   see "PARTIAL DAYS ARE LOADED AND MARKED" below — so today's row now usually
   exists. Nothing here changes: the report still reads rather than writes, and
   still says which figure it is showing.) Square's reporting day runs 1:00 AM
   to 12:59 AM PT. `sync-square-sales` gained a **`preview: true` mode**
   that returns the window's rows without calling `record_daily_sales`, and its
   role check is now mode-dependent — owner/admin to WRITE, supervisor+ to
   PREVIEW, because reading a figure off the register in front of you is not the
   act that feeds `tip_pools`. Verified live: $1,364.08 returned and **zero rows
   written to `daily_sales` or `tip_pools`**. The email carries the provisional
   figure marked provisional and keeps what it quoted in `email_receipt`; the
   record screen renders the SETTLED figure once the sync catches up and says
   which it is showing (`foodHandlerExpiry`'s rule). Consequence:
   `Task_SalesData_isComplete_b` has NO counterpart — Square types it now, so
   there is no act to complete.
   **SPECIAL ORDERS AND PRODUCTION SCHEDULES ARE ONE PAGE.** They stopped being
   two tasks on 2026-08-27 when `GenerateSchedules` grew the special-order pull;
   `fetchPacketData` calls `companionScheduleIds` itself, so printing a plan
   schedule already expands to include that night's special-order schedules.
   FileMaker split them because FileMaker's generation did not pull. TWO task
   flags survive, not one: a per-order kitchen document and the tray-guide
   packet are different paper and the submit page must say which is missing.
   **SENT AND EMAILED ARE TWO FACTS** (`sent_at` vs `emailed_at`), and keeping
   them one column was a real hole caught in review: the flush could succeed,
   the mail fail, and the report read "sent" with nobody told — while
   `submit_shift_report` refuses to run twice, so there was no way back. A row
   with one and not the other shows on the list as "Sent, but not emailed" with
   a Resend.
   **THE EMAIL'S PRIVACY BOUNDARY IS STRUCTURAL, NOT TESTED.**
   `managementBody = supervisorBody + ratingsSection`, so ratings can reach the
   supervisor version only if somebody deliberately MOVES that section, never by
   forgetting — `gustoExport`'s discipline. The fixture (asserted against the
   produced STRING) is a second line of defence. **Both bodies are composed in
   the BROWSER and posted** to `send-shift-report`: `_shared` cannot import from
   `web/`, so composing in Deno would be a second implementation of the one rule
   that must never drift. `_shared/email.ts` gained an optional **`html`** field
   (multipart/alternative, text part FIRST so a client picks the last it can
   render) — optional and unset by every existing caller, the shape `messageId`
   was added in. Verified by building the MIME in Node: both parts round-trip
   byte-for-byte and the subject survives RFC 2047 chunking.
   **`shift_report_ratings` HAS ITS OWN SELECT POLICY** — owner/admin OR the
   report's author, never plain supervisor+. The two emails encode that boundary
   and a table readable by every supervisor would undo it in one click.
   **Migration 072 — REOPEN**, asked for within an hour of the first real send.
   It is NOT a status flip: `submit_shift_report` INSERTS `employee_events`
   (there is no natural key — a person can be rated twice in a day by two
   shifts), so flipping `status` and letting somebody Send again produces a
   SECOND rating for the same person on the same day, silently. Reopening undoes
   the flush and leaves the DRAFT alone. **It refuses to destroy two things**,
   both named in its receipt: a count somebody has recorded SINCE (the revert is
   conditional on the line still holding what the flush put there — proved on
   the harness with a line recounted to 30/1), and a premium inside a CLOSED pay
   period. Owner/admin only; the three `task_*` flags stay, because paper that
   came out of a printer did not go back in.
   **Migration 071 — the break TIME.** FMP asked when, and that is the more
   useful half: California's rule is about TIMING, so "they got a break" and "at
   4:45pm off a 10am start" are different facts and only the second shows a late
   meal. A `time`, nullable even when the box is ticked. **Deliberately NOT
   wired into the premium** — whether a late meal owes one is `lib/breakRules`'
   judgement over the punches, and the punches are not imported until the pay
   period ends.
   **THE ROSTER IS TYPED, and that is forced.** `timesheets` would be the
   natural source and is unusable: punches are not imported until after the pay
   period ends, so at 9pm tonight's own shift is not in the table (Mark,
   2026-08-28). Names come from **`special_order_takers`** (053) and positions
   from a distinct sweep of `employees.position` — `employees` READ is
   owner/admin (020), so a supervisor cannot learn a colleague's name any other
   way. That trap bit twice in test SCRIPTS during the walk: a seed joining
   `employees` inside an impersonated block inserted ZERO rows and reported
   success.
   Screens: `/shift-reports` (list, attention tier, create dialog),
   `/shift-reports/[id]` (the READ-ONLY record — the archive, and the reason
   declining the migration is safe: without it the only way to read last Tuesday
   is to find the email), and `/shift-reports/[id]/run` in a new
   **`(fullscreen)` route group** — the app's FIRST chrome-less route that is
   also signed in, its layout calling `getAppSession()` itself and keeping only
   `ConfirmProvider` and `CalcPad`. No `proxy.ts` change: anything not
   explicitly exempted there is already auth-gated.
   **The attention tier is what makes it a routine rather than a form** —
   `locations.open_days` (017, first reader ever) says which nights a shop was
   open, so "nobody reported Tuesday" is a FACT. Found 7 real unreported nights
   at DF01 on the first load.
   **NO HISTORY MIGRATES** (Mark's call). FMP's `Operations/ShiftReports.mer` —
   13,059 rows, 2017–2026, 7,334 closing / 5,403 opening / 309 off-site, median
   557 characters of narrative, only 43 empty — stays on disk. It was still READ:
   the six `Task_*_isComplete_b` flags and the shift vocabulary come from it.
   **Only three task flags survive**: `narrative` being non-empty answers
   `Task_Log`, Square answers `Task_SalesData`, and `task_checklist_done` is NOT
   created — a column for an unbuilt feature is a claim nothing can satisfy.
   **CHECKLISTS ARE STILL OUT**, deliberately and by Mark's scoping.
   **What the live walk found that nothing else could** (all fixed): pressing
   "Start the report" DID NOT NAVIGATE, because `router.refresh()` raced
   `router.push()` across a route-group boundary — `NewPlan` does the same and
   gets away with it inside `(app)`; the break checkbox had NO VISIBLE LABEL,
   because `ui/Checkbox`'s `label` is the ACCESSIBLE NAME and `children` is the
   visible one (four call sites); missing React keys on the page bodies, which
   cross the server/client boundary in a collection; and the Premades header
   rendering **"LEFTNOTE"**, because a `w-28` on a `th` is a suggestion an
   auto-layout table ignores — both counting tables are `table-fixed` with a
   colgroup now.
   **Mark's own first send exercised the skip path on real data**: he marked
   himself as having missed a break with no reason, and the flush skipped the
   premium, NAMED it in the receipt, and sent anyway rather than blocking the
   report over one incomplete row.
   **A `→` ON THE PREMADES PAGE TAKES THE PAR** (receiving's idiom, and its
   reason: the usual answer is "we made what we were asked to"). An arrow rather
   than a prefilled box — a box that filled itself would make merely OPENING the
   page look like somebody had counted. It hides once they agree.
   **The rows are in the PRINTED SHEET's order**, not the schedule's `sort`:
   whoever is counting is holding that sheet and reading down it.
   `compareForPremadeSheet` is exported from `lib/productionSchedule` and
   `rollUp` shares it rather than keeping a second copy.
   **The generate dialog lost its shop list and all its commentary** (Mark,
   2026-08-28: "we should be able to schedule anything that will be made at the
   current working location. We don't care where it's sold"). `selected` still
   carries every eligible shop to the RPC — `p_location_ids` is how the function
   is addressed — it is just no longer a thing anybody is asked about.
   "Print packet…" is **"Print All Documents"**; the packet parts lost their
   hints and three were renamed to the kitchen's words rather than the schema's:
   **Production Items Sheet, AB Items, Weekly Production**. Whichever button is
   next is BLACK and never both — generate when the night has no schedule, print
   once it has one.
   **A SPECIAL ORDER'S PREMADE SHEET IS TITLED BY THE ORDER**:
   `SPECIAL ORDER #9761` over `Wedding 8/29/2026`. `premadeSheetTitle` splits
   the stored title with `splitScheduleTitle`, the INVERSE of `scheduleTitle`
   and living beside it — a fixture runs a title through the composer and back,
   so the paper and the screen cannot spell one document two ways. The FILENAME
   follows the heading. Verified by capturing the blob, inflating the content
   stream and decoding the hex text runs.
   **`(fullscreen)` and `ui/PickList size="lg"`**: the runner is tablet-first —
   44px targets, `text-[16px]` (below which iOS Safari zooms on focus), which
   needed a real `size` prop rather than a `className` override, because
   Tailwind resolves competing utilities by STYLESHEET order.
   **1355 fixtures pass**, each rule checked by breaking it.
   **Still owed:** nobody holds `purchaser` or `supervisor` as an APP ROLE yet,
   so the no-ratings version currently reaches NOBODY. Inviting the 8 real
   supervisors is what fills it. And what the email LOOKS LIKE when it lands is
   the one leg no probe can settle.
   **THE POSITION PICKER WAS EMPTY FOR EVERY SUPERVISOR — migration 103, NEEDS
   APPLYING** (Mark, 2026-09-09: "no positions are populating the position
   picklist on the rating page"). *Probe, don't read this line.*
   **THE FIRST SUPERVISOR TO USE THIS SCREEN FOUND IT, which is the whole
   story**: the note directly above says nobody held the role yet, and the day
   somebody did, the page's one vocabulary control turned out to be reachable
   only by the two roles that do not write shift reports. It read the shop's
   own titles straight off `employees.position`, and 020 gates
   `employees_select` to OWNER/ADMIN because that row carries a home address
   and a date of birth — so a supervisor's select **matched zero rows and
   returned NO error**, the picker opened holding nothing, and owner/admin saw
   a full seventeen. Reproduced on the harness as a real authenticated
   supervisor before anything was written: `count(*) from employees` = 0.
   **THE ASYMMETRY IS WHAT MAKES IT AN OVERSIGHT RATHER THAN A DECISION.** The
   roster of NAMES on that same page has come through `special_order_takers`
   (053) since the day it shipped, for exactly this reason and with a comment
   saying so — the definer was called TWO LINES ABOVE the raw select. Only the
   vocabulary of JOBS was left behind.
   **103 IS 020's OWN PREDICTION, VERBATIM** — "a supervisor phone list and a
   'my own record' view are both real future needs and both COLUMN-scoped, so
   each arrives as a definer function naming the safe columns … never by
   loosening this." RLS filters ROWS; "a supervisor may read this one column"
   is a COLUMN rule. `employee_positions(p_org_id)` is the third outing of
   044's `production_operators` shape and the SAFEST of them: a name identifies
   a person, where this returns a distinct set of job titles and cannot be
   joined back to anybody. Supervisor+, matching `special_order_takers`; the
   run page already refuses below that, so the check is the stale-session
   backstop rather than the gate.
   **EVERY EMPLOYEE, not just the active ones**, which is where it departs from
   `special_order_takers` — and the departure is measured. That function drops
   the terminated because somebody who left in 2019 is not who just answered
   the phone, which is a claim about PEOPLE; a vocabulary has no such
   staleness. Over the live catalog all employees give **17** distinct titles
   and non-inactive give **9**, and the eight lost include Overnight Baker,
   General Manager, Kitchen Supervisor, PA and Sr. AB — every one a job
   somebody does at this shop today, absent only because whoever fills it is
   recorded under another title or a stale status. Offering a title nobody
   holds costs one row in a list of seventeen; withholding one costs somebody
   typing it by hand. `allowNew` stays regardless, so a title this has never
   seen is enterable and is never a reason to widen anything here.
   **THE RETURNED COLUMN IS `title`, NOT `position`** — `position` is a
   RESERVED WORD in a `returns table` list and Postgres refuses it outright,
   which the harness caught and reading had not. Quoting works and is worse:
   the OUT parameter would then shadow `employees.position` inside the body.
   **APPLY IT BEFORE DEPLOYING** (059's order, not 012's): the page calls the
   RPC, so a deploy in front of the migration leaves the picker empty for
   EVERYONE until the SQL runs — which is the same silence, briefly widened.
   It is rerunnable (`create or replace`, nothing dropped).
   Verified on the harness as real authenticated roles: all 103 migrations
   replay, a supervisor gets the vocabulary where a direct select gets zero
   rows, the owner gets the SAME answer (one path, not two), staff and a
   non-member are refused BY NAME, a null org raises from the first statement,
   `anon` is refused execute, and `pg_proc` holds exactly one. Checked by
   BREAKING it — dropping the trim, the blank guard and the DISTINCT returns a
   blank option and `DF` twice under two spellings, which is the garbage the
   guards exist for. **1762 fixtures pass.**
   Not verified in the browser: the pane lands on the shared-device PIN lock
   (097) and there is no way past it from here.
   **103 IS APPLIED** (Mark, 2026-09-09) — probed the same day:
   `select public.employee_positions(null)` raises **"no organisation given"**,
   which proves the body runs, and a real org id from a service_role script
   answers **"Not your organisation"**, which is 014's footgun (no `auth.uid()`
   to resolve) and is itself proof the org guard runs.
   **THE BATCH REPORT IS RETIRED, so the opener no longer has a page for it**
   (Mark, 2026-09-09: "we are no longer doing the batch report, so we can skip
   that page for the morning shift"). `elements` comes off `OPENING_PAGES` and
   is now on NO shift; opening goes 6 pages to 5.
   **THE PAGE, ITS COMPONENT AND ITS QUERIES ALL SURVIVE, UNREACHED.** Every one
   of them already sat behind a `wants("elements")` that is simply always false
   now, so nothing lies and nothing half-runs — which is why this is not the
   Leads band's "revert it whole, no dead predicate left behind". That rule is
   about a predicate that still CLAIMS something; these are guards that have
   stopped being asked. One line brings the page back, and a fixture goes red if
   somebody does it by accident.
   **`OPENING_PAGES` IS NOW IDENTICAL TO `SHORT_PAGES` AND STAYS ITS OWN LIST**:
   the two are the same by coincidence rather than by rule — mid and off-site
   hold those five because there is no kitchen and no till, opening holds them
   because one page was retired — and merging them would put that decision
   behind a name that argues against it.
   **THE PREMADES COLUMN LABELS STICK** (Mark, same day: "so the user knows what
   they're entering"). Made and Left are two identical boxes eight pixels apart,
   and thirty rows down the sheet the only thing telling them apart is a heading
   that has scrolled off.
   **THE CLASS ALONE WAS A NO-OP, AND THE CAUSE IS `lib/tableHead`'s OWN
   DOCUMENTED TRAP — in the file it is documented in.** `main` carried
   `overflow-y-auto`, which made it an overflow SCROLL CONTAINER, and a sticky
   cell pins to its nearest such ancestor. But the shell is `min-h-screen` with
   height AUTO, so that box is content-sized and never scrolls — measured
   `scrollHeight` 2097 against `clientHeight` 2097 — while the WINDOW does. So
   the labels pinned to a box that cannot move and left with the page:
   **measured at −511px after a 600px scroll**, against 0 and holding once the
   class came off. That class had never done anything except break this.
   Measured on a standalone replica of the runner's exact flex shell rather than
   argued, because the browser pane cannot get past the shared-device PIN lock
   (097) to reach the real screen. Verify it there when you next have a session.
   **If this surface ever wants a genuinely fixed banner and footer**, the
   answer is a DEFINITE height on the shell — **`h-dvh`, never `h-screen`**,
   since iOS Safari's `100vh` is the LARGE viewport and would hide the footer
   under the browser chrome — and `overflow-y-auto` comes back at the same time.
   One without the other is exactly what was there.
   `STICKY_HEAD_ROW_IN_PANE` is what the labels wear, and its doc now says what
   it always meant: it sticks at 0, which suits a table in its own pane AND a
   chrome-less full-screen page whose banner scrolls away. The masthead variants
   offset against `--rf-header-h`, which on a `(fullscreen)` route is the seed
   value rather than a masthead that is there.
   **1763 fixtures pass**, and the four that pin the retirement were each
   checked by putting the page back: all four go red, including the one saying
   nobody is asked about batches — which is the blocker that would otherwise
   return in silence with it.
   **EVERY TITLE AND HEADER ON THE RUNNER STICKS** (Mark, 2026-09-09: "make all
   titles and headers in the shift report sticky"), which finishes the sentence
   the premades fix started an hour earlier.
   **THE BLACK BANNER PUBLISHES ITS OWN MEASURED HEIGHT AS `--rf-runner-h`**,
   seeded 0 in `globals.css`, and everything beneath stacks against it. It is
   measured for the masthead's reason: the bar WRAPS — one line at a desk, two
   on a portrait iPad — so any constant is right at one width and wrong at
   another, and wrong here means a page's column labels sitting on the rows they
   label. **A NEW VARIABLE RATHER THAN `--rf-header-h`**, which on a
   `(fullscreen)` route is sitting at its 4rem seed because no masthead is
   mounted to publish it: offsetting against that would float every header 64px
   into nothing. And the seed is **0 where the masthead's is 4rem**, because
   this is published from a layout effect — at 0 the worst first frame is a
   header flush to the top, which is where it sat before any of this.
   **`WalkRunner` HAD A STICKY BANNER FROM THE DAY IT SHIPPED and this shell
   never did**, which is the tell that this was an omission rather than a
   decision. It publishes the same variable now, so `ChecklistWalk` — mounted by
   BOTH runners — reads one offset and behaves identically on each. Making it
   sticky on one of the two surfaces a shared component appears on is the "I
   edited this and it only changed here" complaint waiting to happen.
   **WHAT STICKS: the banner, the premades and elements column labels, and the
   checklist's black shop-section bands.** A band stays pinned for exactly as
   long as its own `<section>` is on screen and is then pushed off by the next,
   because a sticky element is bounded by its containing block and each band is
   the first child of its section — free, and the behaviour you want. Move a
   band out of its section and it would stick for the whole document.
   **WHAT DOES NOT, and each for a reason.** The SALES table's head, because
   that table has exactly TWO rows: a sticky range is bounded by the table's own
   box, so it could never pin — the class would be decoration. Tomorrow's
   `SectionHeading` over a three-row list, for the same reason, and because that
   component is shared with every detail screen in the app. And the field labels
   on Report and Submit, which are labels over a box rather than headers over
   anything that scrolls.
   **MEASURED on a standalone replica of the runner's exact shell**, since the
   pane cannot get past the PIN lock: banner top **0 at every scroll position**,
   published height 57 against a measured bottom of 56.5, the thead holding at
   **57** — flush under the banner, no gap and no overlap — through 900px and
   then correctly releasing at −172 once its own table has gone by, and at
   scrollTop 2305 the three bands reading **−297.5 / 57 / 309.5**, which is one
   band pinned and its neighbours where they belong.
   **The footer gained `z-30`**, the banner's rung. It had none, which was safe
   only while nothing else here was sticky — a `z-20` table head would now paint
   OVER the four buttons on a viewport short enough for the two to meet, and
   those four are the way out.
   **THE NEEDS-ATTENTION TAB IS GONE AND DRAFTS IS THE DEFAULT** (Mark,
   2026-09-09). It was the list's opening view and it was a tier over a queue
   that is normally EMPTY — the wrong shape for the screen you land on, where
   Drafts is what somebody comes here to finish. Three tabs now: Drafts · Sent ·
   All.
   **NEITHER HALF OF WHAT IT COUNTED IS LOST**, which is what makes this a tab
   going rather than a feature. `attentionReason` still paints the Status cell
   yellow ("Sent, but not emailed", "Still a draft") — the first of those is the
   hole that function exists to close, a flush that succeeded beside a mail that
   did not — and `missingNights` still produces the sentence over the table.
   Both stay pure and fixture-tested; neither lost a caller.
   **THE MISSING-NIGHT SENTENCE NOW SHOWS ON EVERY TIER**, which is the one
   judgement in here. It was tied to that tab because it was HALF OF ITS COUNT
   and explained the half you could not see — the nights have no ROW, so no
   filter can reach them. With the count gone there is nothing left to explain,
   and the FACT belongs to the shop's last seven days rather than to any tier,
   so leaving it behind a filter would have been the only remaining way to lose
   it. The 2026-08-31 note about it appearing in the table's empty slot is
   history twice over now: it renders above the table, always.
   The empty states became tier-aware in the same pass, because the old generic
   "No shift reports here yet." was written for a screen whose first tab was a
   queue — on Drafts the useful sentence is "everything here has been sent".
   **THE PACKET PRINTED ANOTHER SHOP'S SPECIAL ORDERS** (Mark, 2026-09-09, of a
   closing DF01 report: "a special order (the knotted standing order) is
   included in the documents. Why?"). Because the query behind Print All
   Documents asked for **every committed order in the ORG on that date and
   narrowed by nothing at all** — no kitchen, no pickup shop — while the query
   directly beside it had always scoped `production_schedules` by
   `kitchen_location_id`. Reproduced exactly: DF01's 09-09 closing report,
   packet for 09-10, **1 order before and 0 after** — #10023, Cafe Knotted's
   wholesale day, whose pickup AND kitchen are both DF02.
   **IT WAS LATENT FOR TEN DAYS AND THEN BECAME NIGHTLY**, which is why it
   surfaced now and not in August. The omission shipped with the runner on
   2026-08-28, when there were almost no upcoming orders to leak — Cafe
   Knotted's last real day was 2026-08-23 and the standing orders had never been
   materialized. **Migration 099 (2026-09-08) started minting one a day**, and
   19 of the 24 upcoming orders are that account, so from that day every DF01
   closing report picked one up. Worth knowing as a CLASS: a feature that fills
   an empty table is how a dormant scoping bug wakes up.
   **`ordersForKitchen` in `lib/specialOrderSchedule` is the fix**, over
   `scheduleKitchen` — so an order carrying a pickup shop and no kitchen belongs
   to that shop's kitchen, the same coalesce `schedule_special_order` and the
   generate dialog apply rather than a fourth answer to one question. Measured
   today it changes nothing (all 24 upcoming orders carry a kitchen) and a
   HAND-TYPED order is exactly the case that would not, since
   `createSpecialOrder` defaults the pickup shop to where you are standing and
   deliberately does not default a kitchen.
   **AN ORDER WITH NEITHER REACHES NO PACKET, and that is the answer rather than
   a gap**: this is paper a kitchen bakes from, so handing it to every kitchen
   would have it MADE TWICE. It stays on the report's own "also that day" block,
   which includes the unassigned and marks them, and on /special-orders.
   Narrowed in JS rather than in the query, because the rule already existed and
   a PostgREST `.or(...)` spelling of the same coalesce would be a second copy
   of it in a second language. The cost is a handful of rows — ONE date, against
   an org holding 24 committed orders in the next fortnight.
   A FUNCTION rather than a `.filter` at the call site so that dropping the
   scoping is something a fixture notices; checked by dropping it, and it goes
   red. Measured over the fortnight after the report: **15 wrong-kitchen order
   sheets removed, 15 right ones kept** — DF01 keeps its 09-12 baby shower, DF02
   keeps all fourteen Cafe Knotted days — and **0 orders reach nobody**.
   **1764 fixtures pass.**
   **THE FOOTER IS ICONS WITH THE WORD KEPT UNDER THEM** (Mark, 2026-09-09,
   over six passes: "instead of 'back' and 'next' labels for the nav buttons
   lets use large arrow glyphs", "thicker arrows please. fat.", "the arrows on
   row 1 do not match", "row 3 looks better", then — off eight mockups —
   "material symbols with a small word under it (H) but with a check mark
   instead of an arrow for send. And send is green", and finally the sizes).
   **IT LANDED ON MATERIAL SYMBOLS, WHICH IS WHAT THIS APP ALREADY DOES** —
   `RecordNav`'s record-book buttons and the Columns eye, Apache 2.0, inlined as
   one `currentColor` path each rather than an icon dependency. That also
   settles the complaint RecordNav's own note records from 2026-07-31, when its
   four had shipped as TYPED CHARACTERS while the eye was artwork: **"two
   families of arrow in one app is the sort of thing you can't unsee"**. The
   Unicode arrows below were the typed half of exactly that split, which is why
   they lasted an afternoon.
   **THE UNICODE ROUTE IS WORTH KEEPING AS A RECORD, because it is a good
   demonstration of why a type family beats a pile of codepoints.** `→` (U+2192)
   went in first and is a HAIRLINE in the UI font, carrying no more ink than the
   14px word it replaced — the receiving caret's "reach for the bigger GLYPH
   before the bigger size", deciding something a second time. `⬅`/`➡`
   (U+2B05/U+27A1) are fatter and come from DIFFERENT BLOCKS, so the two heads
   are visibly different shapes; Mark caught that at a glance. U+279C mirrored
   with `scaleX(-1)` fixed the matching by construction and shipped for an hour.
   And the moment Cancel, Pause and Send were asked for too, the approach fell
   over on its own terms: `❚❚` merged into a solid square that reads as STOP,
   `✈` rendered a third the size of everything beside it, and `➤` for Send
   pointed the same way as Next. **Unicode glyphs are not optically sized as a
   set and never will be.**
   **SF SYMBOLS WERE ASKED ABOUT AND CANNOT BE USED HERE**, for two independent
   reasons: Apple's licence covers app UIs on Apple platforms rather than a
   website, and there is no delivery route anyway — the glyphs live in a private
   system font no `font-family` exposes, so the only access is undocumented
   Private Use Area codepoints that are tofu everywhere else. **They are the
   right answer for phase 5's SwiftUI app**, where they are native and free.
   **THE WORD STAYS, AND THAT IS THE HALF THAT MATTERS.** A bare `✕` cannot say
   which of two things the first cell is — Cancel on your own draft, Close on a
   sent report or somebody else's — which this file already argues for at
   length; same for "Pause & close", where "& close" is the half that says it
   LEAVES. The words are the ones that were already there, UNSHORTENED: an icon
   was added and nothing was taken away. They are also each button's accessible
   name, so no `aria-label` is needed and the artwork is `aria-hidden`.
   **SEND IS GREEN AND IT IS `--rf-green-300`, WHICH IS A MEASUREMENT.** The
   obvious token is the wrong one: `--color-go-ink` (green-600) is built to be
   INK ON WHITE, where it passes at 5.34:1, and on this bar it is **3.54:1**,
   under AA. `--color-go` (green-200) is the other way — 14.44:1, and so pale
   that beside the white cells the tick reads as off-white rather than green.
   green-300 is **11.24:1** and unmistakably green. A fill-range value used as
   INK on a dark ground is the same move `text-mark` makes on the masthead, and
   this file's own rule says so: "the one place `text-mark` is right is on
   BLACK". The yellow it replaces measures 9.85:1, so the bar got brighter.
   **28px OF ARTWORK OVER A 12px WORD, AND THE BAR DOES NOT GROW.** 7 + 28 + 2 +
   12 + 7 is exactly the `min-h-14` (56px) it has always been — **measured at 56
   on all three states** — and change either size and the padding has to be
   recomputed (28/10 lands on the same 56 with a plain `py-2`). Eight pairs were
   rendered side by side to get there: 26/9, 26/10, 26/12, 24/12, then 28/11,
   28/10 and 28/12.
   **AND IT LANDS BACK ON THIS SURFACE'S OWN TYPE SCALE**, whose floor is the
   12px of its small-caps labels and column heads. Worth recording because the
   two runners-up did not: 28/11 and 28/10 were each shipped for a few minutes
   and each would have put a new size below that floor, on the argument that a
   caption under an icon is its own element rather than a label in the scale.
   **That argument turned out not to be needed** — the ICON carries the size
   difference and the word stays the size every other label on this screen is.
   wght **700**, not RecordNav's 300, because these sit on a black bar at arm's
   length where 300 is a hairline; same family, different weight, which is what
   a weight axis is for.
   **`FOOTER_CELL` became `inline-flex items-center justify-center`** rather
   than leaning on a button's own centring, which is a UA behaviour and not a
   stated one.
   **TWO HARNESS NOTES, each of which cost a pass.** A canvas `measureText` with
   `ui-sans-serif` in the font string DOES NOT RESOLVE and silently measures a
   fallback — it reported `→` at 24×20 when the browser paints a hairline, so
   measure a glyph AS RENDERED, which is what the "measure a title as rendered"
   rule already says for text. And **the browser pane has a TAB CAP**: at nine
   open tabs `navigate` to a new file and `tabs_create` both fail with errors
   that read like a missing or unreadable file. Close tabs when you finish
   verifying — the memory note already says so.
   **AND AN ENTITY IN A JSX *ATTRIBUTE* IS NOT DECODED**, unlike one in JSXText:
   `word="Pause &amp; close"` renders the five characters `&amp;`. Caught before
   it shipped, and the mirror image of the SWC whitespace trap this file already
   documents for entities in text.

   **RATINGS PRIVACY RE-AUDITED 2026-09-18** (Mark: nobody but owners, managers
   and the authoring supervisor may read ratings/events, anywhere). No change
   needed. Every migration replayed in the Docker harness, one seeded report
   and rating, rows visible per role — `shift_reports` / `shift_report_ratings`
   / `employee_events`: owner 1/1/1 · manager 1/1/1 · authoring supervisor
   1/1/**0** · another supervisor 1/**0**/0 · purchaser 1/0/0 · staff 0/0/0 ·
   signed out 0/0/0. The author reads their own ratings through the draft
   table, never through `employee_events`. Also checked: no view reads either
   table; the only definer functions touching them are submit and reopen, and
   `sent_receipt` holds counts only (087's `v_skipped` is never appended to);
   the ratings email goes only to owner/admin addresses, chosen server-side;
   `/employees` and `/events` are X/X/- for staff/supervisor/purchaser; the
   record screen shows the ratings section from the ROWS, so another supervisor
   sees no section at all.

   **A MISSING DAY CAN BE GENERATED FROM THE PREMADES PAGE** (Mark,
   2026-09-18: "we should be allowed to generate the schedule if it's missing,
   just so we can enter counts"). Counts are keyed on `schedule_item_id`, so a
   day nobody generated left the page empty with no way forward. The empty
   state now carries **Generate today's schedule**, which calls
   `generate_production_schedules` bare — the report's date, the report's shop,
   one day, no replace — and NOT the `GenerateSchedules` dialog, which is for
   the next night: it defaults to tomorrow, tops up standing orders and pulls
   special orders, and pulling today's orders into a schedule after they have
   been made would be wrong. Par comes from the plan as it stands now. An empty
   receipt (no plan covers that shop's day) is said in words instead of the
   button. Not walked live: exercising it means writing a real schedule.

   **PREMADES READ EVERY NON-SPECIAL-ORDER SCHEDULE FOR THE DAY** (2026-09-18).
   The runner fetched the shop's day with `.maybeSingle()`, which errors on two
   rows — and a day routinely has two, because generating a night also writes a
   schedule per special order it pulls (and a shop fed by two kitchens gets one
   per kitchen). DF02 on 2026-09-18 had a plan schedule beside Cafe Knotted's,
   so the page said "no schedule" on a day with 35 lines. Now: every schedule
   for location + date except `source = 'special_order'`, lines from all of them.

   **PAGE 7'S GENERATE OPENED ON THE WRONG NIGHT** (fixed 2026-09-18). It passed
   the next production date AS `today`, and `GenerateSchedules` has defaulted to
   the day after `today` since 2026-09-07 — so the dialog offered the night
   after the one the page was about. It now passes the org's day as `today` and
   the next production date as the new `startDate` prop.

   **NEW SHIFT REPORT RESUMES A DRAFT RATHER THAN WARNING ABOUT IT** (Mark,
   2026-09-18: "help avoid supervisors starting a new report if they already
   have a draft started"). The yellow sentence alone did not stop a second DF02
   closing report that night. When a draft exists for the chosen date + shift,
   the black button (and Enter) is **Resume the draft**, with **Start another**
   beside it for the handover case — still no constraint, for 070's reason. A
   SENT match says to ask a manager to reopen it and links to it, since a second
   report is the wrong fix for a missing count.

   **A SUPERVISOR REOPENS THEIR OWN SENT REPORT — migration 106, NOT YET
   APPLIED as of 2026-09-18** (Mark: "my supervisor is unable to 'reopen' a
   report they sent"). 072 kept reopening owner/admin because it un-writes rows
   on other people's HR records — true of somebody else's report, not of your
   own, where every row it takes back is one you wrote by pressing Send. The
   scope is the AUTHOR (`created_by = auth.uid()`), the rule 070's update/delete
   policies and `submit_shift_report` already use, and the only one that works:
   a reopened report is a draft, and a supervisor may only edit a draft they
   created. Tested on the Docker harness over all 106 migrations: author
   reopens and can then edit; a colleague's report, and staff even on their own,
   are refused; owner reopens anyone's; anon has no execute. The record screen
   shows Reopen to the author; New shift report's sent-duplicate line says "open
   it and tap Reopen" for your own and "ask a manager" otherwise.

   **A RE-SENT REPORT IS EMAILED AS A CORRECTION — migration 107, APPLIED
   2026-09-18** (Mark: "build the corrected email version", after choosing it
   over letting a supervisor skip the second email: managers read the email,
   not the app, and it is the only copy carrying the ratings, so a silent fix
   would leave their inbox copy wrong). 072's reopen clears `emailed_at` —
   rightly — so the fact that people HAVE read a copy was lost; 107 adds
   `previously_emailed_at`, which the reopen fills with
   `coalesce(emailed_at, previously_emailed_at)` and nothing ever clears. When
   it is set, `emailSubject` leads with "Corrected: " and `supervisorBody` (so
   the management body too, by construction) opens with "Corrected report. This
   replaces the copy emailed <shop wall time>". The runner reads the column in
   its own query and ignores an error, so it never depended on the deploy order.
   Harness: stashed on reopen, kept across a second reopen after a failed mail,
   absent on a report never emailed. Two fixtures cover subject, both bodies and
   that the notice leads. A report reopened BEFORE 107 (DF02's 2026-09-18
   closing) has nothing stashed and re-sends unmarked.

   **A MANAGER CAN FINISH ANYBODY'S DRAFT — migration 108, NOT YET APPLIED as
   of 2026-09-18** (Mark: "I can reopen someone else's report, but I can't send
   it or close it again"). 070 already let owner/admin update, delete and SEND
   any report; two things still said author-only — the runner's `editable`
   (`created_by === session.userId`) and the write policies on the three draft
   tables, which carried no manager exemption. So a manager's reopen of a
   colleague's report produced a draft only its author could finish. The runner
   now offers edit and Send to the author OR a manager (`canReadHr`), and 108
   gives the three `*_write` policies the same owner/admin exemption their
   parent has. Supervisors unchanged. Harness: owner and admin write a count on
   a supervisor's draft, the author still can, a colleague supervisor is
   refused, the owner sends it and the count reaches the schedule line, and a
   sent report takes no writes from anyone. Known edge: sending finishes the
   linked checklist only for whoever STARTED that checklist (076), so a manager
   sending somebody else's report gets the existing "was not finished" warning.

   **INCIDENT 2026-09-18: A REOPENED REPORT WAS DELETED BY "CANCEL".** The
   runner derived `canDiscard` from `canSend`, which was harmless while both
   meant "the author". The 108 change widened `editable`/`canSend` to managers,
   and through that coupling a manager's Cancel became a DELETE of somebody
   else's draft. Mark reopened DF02's 2026-09-18 closing report (which took its
   35 counts and its ratings back off the schedule and the HR records), pressed
   Cancel, and the Discard confirm — "Nothing was ever written to the schedule
   or to anybody's record, so there is nothing else to undo" — was false for a
   reopened report; the draft was the only copy and it cascaded away. The
   screen then did not leave, so a second Cancel reported "The report was not
   discarded — nothing changed", the opposite of the truth. The management
   email of 20:28 PT is the surviving copy.
   Fixed the same night: `canDiscard` is computed on the server on its own
   terms — the AUTHOR's draft, never sent (`previously_emailed_at` null) — and
   passed to the runner; a successful discard leaves by HARD navigation; the
   list's Delete confirm has a third case for a reopened report saying it is
   the only copy. Known gap: a report reopened after a FAILED email has no
   `previously_emailed_at`, so it still reads as never sent.
   **Lesson: a permission widened for one act must not flow through a variable
   another act reads.** `canDiscard = canSend && …` looked like a tidy
   statement that the two had one owner; it was a promise nobody re-checked
   when one of them changed.

   **ONE PAGE PER SCHEDULE, SPECIAL ORDERS INCLUDED** (Mark, 2026-09-19:
   supervisors "should fill out any schedules generated, including special
   orders", and each schedule "should" be its own page). The runner's premades
   fetch lost its `.neq("source", "special_order")`, and the server now hands
   `ShiftReportRunner` a `premadePages` list that stands in the premades slot:
   the day's plan schedules first ("Premades", or "Premades — made at DF02"
   when two kitchens feed the shop), then each special order ("Special order —
   Cafe Knotted"), numbered as pages of their own. Each step is REMOUNTED by
   key, so one schedule's half-typed count cannot carry to the next page. A day
   with no plan schedule still leads with an empty Premades page, because the
   Generate button lives in its empty state and a special order must not hide
   that nobody generated the premades; a special order with no lines gets no
   page. No schema change: counts were already keyed on `schedule_item_id`, and
   Send's flush and 107's reopen never looked at a schedule's source. Uncounted
   special-order lines now count towards the Send gate like any other line.
   Not walked live — the pane was signed out.

   **THE CALCULATOR STOPPED GETTING IN THE WAY** (Mark, 2026-09-23:
   supervisors entering premade counts had to close the pad before they could
   tap the next field). The cause was not only its size: `ui/CalcPad` put an
   INVISIBLE full-screen catcher behind itself, so the first tap anywhere else
   only dismissed it — every next field took two taps. Four changes, all in
   `CalcPad`, so every calculator field in the app gets them:
   (1) **tap-through** — the catcher is gone; a tap outside blurs the field (the
   commit) and still lands where it was aimed, and a finger that travels is a
   scroll, not a dismissal; (2) **‹ › in the title bar** walk the page's
   calculator fields in reading order, including `InlineValue` cells at rest
   (`data-rf-calc-opener`), and the title bar names the field from its
   `aria-label` while the field itself wears a 3px ring
   (`[data-rf-calc-active]`); (3) **placement** — pinned to the window edge
   away from the field, centred vertically, and it STAYS PARKED until it would
   cover the field: choosing afresh per field flipped it across the screen
   between Made (left of centre) and Left (right of it) and the next tap missed
   a key; (4) **smaller** — 15rem wide, down from 21, keys about 50px.
   Verified in the pane with a coarse pointer faked and a temporary harness
   (the pane was on the lock screen): typing, `3+4=`, ›/‹ across inputs and
   InlineValue cells, one-tap move to another field, tap-away dismiss, and ›
   scrolling an off-screen field into view. **Not yet tried on an iPad** — the
   one thing the harness can't prove is WebKit's synthesised mouse sequence.
   **And it proved to be the thing** (Mark, same day, on the iPad: "it still
   takes two taps"). Tapping another field still spent the first tap on
   dismissing: iOS delivers a tap's focus AFTER pointerup, and our blur there
   changed the page first (a save, the pad unmounting, the outline coming off)
   — most likely WebKit's content-change heuristic then treated the tap as a
   hover and dropped the focus. Fix: on a tap outside, `CalcPad` focuses the
   tapped input/textarea/select ITSELF, before anything changes (which blurs
   and saves the old field in the same move), and clicks an `InlineValue`
   opener the way › does; only a tap on something that isn't a field blurs and
   closes. Verified by dispatching pointer events alone, with no browser focus
   following — the iOS failure mode — onto a calculator field, an InlineValue
   cell and a plain text field: one tap each, and a typed 73 saved on the way.
   Still to confirm on the iPad itself.

   **THE EMAIL'S PREMADES ARE ONE SECTION PER SCHEDULE** (Mark, 2026-09-25:
   "I want to see the shop's premades in one section, and each special order or
   wholesale order separated by itself"). `EmailReport.premades` is now a list
   of `{ title, lines }`, and each is its own heading + table. The titles are
   the runner's page titles — the page builds one `premadeSections` list and
   both the pages and the email read it, so the screen and the inbox name a
   schedule the same way ("Premades", "Special order — #9761 · Cafe Knotted").
   A section with no lines (the empty Premades page kept for its Generate
   button) is left out of the email. Fixture pins order and placement.
