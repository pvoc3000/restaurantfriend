<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4e. ✅ **EMPLOYEE EVENTS — migration 035, APPLIED and LOADED 2026-08-06.**
   FMP's two HR child tables merged into ONE (Mark: "In retrospect, these should
   really be all in one table: Events. What were 'ratings' are really just shift
   events… Events already had different types, what's one more."). `Events`
   (2,398 rows, ~200/yr, narrative) and `Ratings` (44,251 rows, ~5,000/yr, one
   per person per shift, **written daily and still in use**) are now
   `employee_events`, 46,553 rows, 2014-06-11 → 2026-08-06.
   **THE BATCH SHIFT-LOG SCREEN IS DEFERRED TO THE PRODUCTION MODULE**, and that
   is the load-bearing scoping decision (Mark, 2026-08-06). Supervisors write
   ratings 2–3 at a time at end of shift, alongside sales, tips and donut
   production counts — `Operations/ShiftReports.mer` carries all of it. A
   ratings-only batch screen would be built twice. So the write surface is the
   employee's own record and RLS is owner/admin on all four verbs, verified in
   the harness as a real authenticated **supervisor: 0 rows visible, insert
   refused by RLS** — the assertion that proves the deferral is real and not
   merely unwired in the UI.
   **`ShiftReports.mer` is READ but never loaded**, and it is what made the
   migration good: `_log_id` is a real unique id (13,059 of 13,059) and
   `Ratings.log_id` joins it at **100.0%**, supplying the four things Ratings has
   no column for — the LOCATION (DF01 25,592 · DF02 15,578 · DF03 2,946 · EVENT
   134), the SUPERVISOR (44,237 rows, all 46 ids resolving to real employees),
   the SHIFT as a label (`Off-site` 481, which the 1/2/3 sort field cannot
   express), and a DATE for the 329 ratings whose own is blank. An earlier plan
   recovered location by joining to the TIMESHEET, which works from 2020 and not
   at all before; that inference is gone, along with any need to read the 85 MB
   Timesheets.mer. The `log_id` rides in `source_payload` for the day Production
   builds a real `shift_logs` table — a column now would reference nothing.
   **The five category scores collapse to ONE and we keep a BETTER figure than
   FMP had.** 89% of 40,793 scored ratings are a 5, so the categories never
   discriminated; the note is the payload. FMP stored `round(mean)`, which agrees
   with the true mean on only 33,545 rows, so the transform computes the mean to
   2dp — `[4,5,5,4,5]` was filed as "5" and is now 4.60. The five survive in
   `source_payload`, so the collapse is reversible without a re-export.
   Two measurements decided the schema and both would be easy to get backwards:
   **`n/a` is EXCLUDED from the mean** (the mean over the rest matches FMP's
   total on 15,427 rows, differs on 1) and **`0` is INCLUDED, because a zero is a
   supervisor writing the shift off** — of 132 rows carrying one the total says
   counted on 107, excluded on 10, and the 65 all-zero rows read "NO CALL/NO
   SHOW". Hence `check (score between 0 and 5)`; at 1–5 it would refuse 72 rows
   of real history mid-batch.
   Eleven kinds, folding FMP's three drifted merge pairs. `document_note` is
   HISTORICAL ONLY — **field-map.md was wrong** to say the 81 `Document` rows go
   to `employee_documents`: 021 declares `storage_path not null` and these are
   metadata with no files, and a metadata-only row would let `missingPaperwork()`
   report a W-4 as filed that nobody can produce, which is the exact failure 021
   exists to prevent. 253 ratings whose POSITION read some spelling of "call out"
   became `call_out` events (a narrow `/^call out$/` would have missed "CALLED
   OUT", "DF- CALL OUT" and "Call out/cover").
   **NO `timesheet_id`, NO `log_id` column, NO period gate** — each argued in the
   migration header. The period gate especially: `period_editable_on` returns
   TRUE for a day outside the 178-period calendar, so half of Events would be
   freely editable while 2020 was frozen.
   **THE UI'S CAP WAS A BUG UNTIL REAL DATA FOUND IT.** The block opens on a
   "Notes & warnings" tier because a long-serving person's warnings would
   otherwise be buried under a thousand shift ratings. The first cut capped ONE
   query at 500 and let the client filter — measured on Ruby Mares (1,590 events,
   84 narrative), that would have hidden **69 of her 84**, including 4 written
   and 6 verbal warnings, while the tab's own count said everything was fine. So
   it is TWO queries: narrative kinds fetched WHOLE (rare — 2,635 across all 445
   people), only shifts capped, and the "showing N of M" line names shift ratings
   specifically and never appears on the tier that is complete.
   Kind renders as plain text, never a coloured chip — colour means record STATE
   and a warning is a record TYPE. `deleteWarnings` gained an event count, since
   035 cascades and 023 lets an owner delete a record carrying a decade of
   write-ups.
   **`backfill-break-premiums.mjs` closed the phase-5 data gap** (see the
   correction under 4d): 10,453 `not_owed` decisions written from the break
   reasons FMP kept in its Ratings table, resolving **3,138** of the excess
   findings. **`hours: 0` explicitly** — 029 defaults it to 1.00 and
   `timesheets/page.tsx` sums EVERY premium's hours for the worksheet regardless
   of decision, so the default would have put ten thousand phantom premium hours
   on screen; verified after the write, total premium hours = 1, identical to the
   owed total. It **skips the 451 findings our rule argues with** rather than
   recording decisions nobody made: the dominant code among them is `short_meal`
   (208), and a waiver covers SKIPPING a meal on a short shift, not taking a
   ten-minute one — several read "no break needed" at 5.1h, the same 5h-vs-6h
   misreading recorded above, and three are junk ("test" twice, "fgdfg").
   `--include-contested` overrides it. Never upserts: one human decision already
   on file was left untouched, and a second `--apply` wrote 0.
   **Shipped 2026-08-26 — `/events`, THE WHOLE TEAM ON ONE SCREEN, and the
   retirement of the Team Ratings stub.** 035 merged the two tables in August
   and then built ONE surface for them: the employee record, every query scoped
   `.eq("employee_id", id)`. So "every warning in the last 90 days", "who called
   out this month" and "what happened at DF01 last week" each meant opening
   twenty-six records one after another — and 035's own
   `employee_events_org_date_idx (org_id, occurred_on desc)`, created for
   exactly this screen, **had never had a reader**.
   **THE `team-ratings` STUB WENT WITH IT LANDING**, which is the merge finally
   reaching the menu: a rating IS `kind = 'shift'`, so that was a filter on this
   screen pretending to be a screen of its own, and whichever of the two you
   pressed you would have got the same list. The surviving entry keeps the slug
   `team-events` (the `rf.nav` cookie stores it) and is LABELLED just **Events**,
   since the band above it already says HR. `roles: ["owner","admin"]`, which is
   035's RLS exactly, and `/events` joins `InactiveLocationGate`'s exempt list
   for `/sales`' reason — the shop is a filter DIMENSION here, not a scope.
   **TWO POPULATIONS FETCHED UNDER DIFFERENT RULES, and the tier picker exists
   to say so.** Notes and warnings are fetched WHOLE, all the way back to 2014
   (2,635 rows, three pages); shift ratings are bounded by a **date window** —
   7 / 30 / 90 days / This year, default 90. Bounding the narrative half is the
   failure the record screen already documents: cap it and the recent ratings
   crowd out every older warning while the count says everything is fine.
   Measured live: 520 shifts in 90 days, 66 in 30, **0 in 7** (FileMaker's own
   writing stops at the 2026-08-06 load), and **1,749 this year** — note that
   is NOT the 2,996 a 365-day window gives, which is a different question.
   **THE WINDOW IS THE ONE CONTROL THAT REFETCHES** — a `router.push` where every
   filter beside it is `history.replaceState`, because only the window changes
   what the server loaded. `/sales`' split. It is also why `windowKey` is a PROP
   and never state: a local copy would survive the push and start lying.
   **`withRatingWindow` is not a convenience, it is the trap.** `filterQuery`
   rebuilds a list's query string FROM SCRATCH out of the search term, the
   declared dimensions and the sort — so a bare `filterHref` DROPS `?window=30`,
   and every keystroke would reset the address bar to 90 while the rows stayed
   on 30. Invisible until somebody presses Back. Every href on the screen goes
   through it, the default key DELETES the param so the plain list keeps one
   canonical address, and 12 fixtures pin it (checked by breaking both halves:
   5 go red).
   **THE TIER IS A DIMENSION THAT IS NOT A MENU.** It rides in `dimensions` so it
   lands in the URL, is parsed back and narrows the rows like everything else —
   and it is DRAWN as a `TabPicker`, so `FilterMenus` is handed a `menuDimensions`
   subset AND rows already narrowed by the tier, which is what keeps its option
   counts conditioned on it. Its Clear knows only its own four, so the caller
   puts the tier back, or "Clear 2 filters" would also throw you from Shift
   ratings to Notes & warnings while counting itself as two.
   **THE TWO PICKERS SHARE ONE ROW, ON EVERY TIER, AND NEITHER IS CAPTIONED**
   (Mark, 2026-08-26, in three passes — one line, no caption, always visible).
   **SUPERSEDED 2026-09-10 (Mark):** both are captioned `PickList`s now (Show,
   Window), and they ride in `FilterMenus`' `leading` slot beside a flexing
   Search, so the whole filter bar — Search · Show · Window · Kind · Shop · By
   · Score — is ONE line, measured at 1280 and 1440 with every caption and box
   level. The "always visible" half below still stands.
   **THE WINDOW WAS HIDDEN UNDER Notes & warnings AND THAT WAS WRONG ON A FACT,
   not on a judgement.** It was hidden on the grounds that a control which does
   nothing is one people stop trusting — but the window is NOT inert there: the
   **"Shift ratings 520" count in the tab beside it is a function of it**, so
   hiding it left that number governed by a setting you could not see. Measured
   live: from the Notes & warnings tier, moving the window to 30 days takes that
   tab 520 → 66 and All 3,155 → 2,701. It also broke the rule `NewTimesheet`
   already settled (Mark, 2026-08-05) — a control that VANISHES cannot be told
   from a feature that does not exist, which is why that button is disabled
   rather than hidden. **Check that rule before hiding any control.**
   The window's sentence went with it and is now on every tier too, counted from
   `tierCounts` rather than a second `filter`, so the sentence and the tab cannot
   disagree about one number — under Notes & warnings it is what explains why
   the tab beside says 520 and this one says 2,635.
   Tier still LEADS, which is now just reading order (which population, then how
   much of it) rather than a fix for anything. Dropping the captions was the
   other half: captioning the window alone made the row 23px taller on two tiers
   of three, so the tier picker and the whole table under it moved by the height
   of a label. Measured after all three passes: tier, window and the table head
   hold **identical positions on all three tiers** — nothing in the control area
   moves at all. The `ariaLabel`s stay, since "7 days" read aloud names nothing.
   **Kind's options are the ten NARRATIVE kinds only**, plus a derived
   `disciplinary` (warnings + incidents, 633 live) that gives `isDisciplinary`
   its first list-level reader. The tier says which population, Kind says which
   of the ten inside it, and no label appears in both.
   **There is deliberately NO "Who" menu**: 445 people is a directory, and
   `filterCounts` is O(rows x options), so that one dimension would be ~1.4M
   predicate calls per keystroke — more than the other four combined. The SEARCH
   BOX matches the employee name, which is how `/special-orders` finds a
   customer. **Score IS a menu** (Under 4 / 4 or better / Not scored) because 89%
   of scored ratings are a 5 and the other 11% is the entire information content
   of forty-four thousand rows.
   **Shop and Score are shifts-tier menus in practice and are kept anyway**:
   2,382 of the 2,635 narrative rows carry NO shop (035 recovers it from the
   shift report, and only ratings have one) and ZERO carry a score. The
   conditioned counts state that rather than hiding it.
   **READ-ONLY, and the Who column is the whole navigation** (Mark, 2026-08-26).
   No inline edits, no delete, no create: the row links to
   `employeeTabHref(id, "events")` under `withFrom`, so the record's breadcrumb
   comes back to the FILTERED view. One write path — a second editor would be two
   places to correct one row. Known cost, accepted: the fastest route to fixing a
   misfiled rating is find it here, click through, find it again. If that becomes
   a common job the answer is `openRowKey`/`lib/shiftFocus` on the record, not an
   editor here.
   `EVENT_SELECT` moved to `lib/employeeEvents` and both screens read it — a
   column present in one select and missing from the other is a cell that reads
   an em dash on one screen and a value on the other. It must stay **ONE STRING
   LITERAL**: supabase-js parses it at the type level, and `"a" + "b"` widens to
   `string`, which collapses every selected column to `GenericStringError`
   (caught by tsc, 15 errors, when it was first written as a concatenation).
   Widths were MEASURED rather than chosen, twice: the expand chevron rides in
   the Date cell and takes 34px of it, so at 130 a date clipped to "2026-08-0";
   and Shift carries the position after it, so at 100 a real roster read
   "Opening Sr..." mid-word. Final 1230 = Date 155 - Who 190 (pinned) - Kind 140
   - Shop 70 - Shift 130 - Score 80 - Note 325 - By 140, `compactBelow` 1280.
   Verified against the live database at 1440 and 900: tier counts
   **2,635 / 520 / 3,155** to the row; This year 1,749; 7 days 0 with its own
   empty sentence; the window stripping `?window=` when it returns to 90; Back
   from an employee restoring `?kind=disciplinary&sort=who&dir=asc` intact; kind
   bands summing to 2,635 (Attendance 867 - Call out 435 - Incident 339 -
   Negative 409 - Verbal 194 - Positive 158 - Written 100 - Document note 81 -
   Note 38 - Check-in 14); shop bands DF01 77 - DF02 140 - **DF03 36** - No shop
   2,382, that DF03 being the proof the code map came from `session.locations`
   and not `activeLocations`; and the compact set shedding to five columns with
   nothing clipped. **1,223 fixtures pass.**
   **Harness note:** the browser pane goes HIDDEN on its own, and while it is
   every `getBoundingClientRect` reads 0, React never hydrates, and a sticky
   header composites a few pixels out of place — which reads exactly like a
   layout bug. A `screenshot` restores it. Measure again before believing any
   geometry, and check `innerWidth !== 0` first.
