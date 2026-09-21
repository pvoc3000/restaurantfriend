<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4g. 🚧 **Special Orders** — specced 2026-08-16; **phases 1–3, 4a AND ALL OF 5
   DONE; 4b and 4c not built. Migrations 051–058, 067–069 and 099 + 100 are
   ALL APPLIED (099 + 100 by Mark, 2026-09-08). All three edge functions are
   deployed.**
   *Probe, don't read this line.*
   The module records, quotes, invoices, prints, emails as specialorders@, takes
   a customer's approval on a public page, takes inquiries on a public form,
   proposes the next step as things happen, **puts the order's donuts on a
   real production schedule**, and **makes a wholesale account's days by
   itself**. What remains is the inquiry form's own build-your-box picker (4b)
   and the organic-email parser (4c).

   **Shipped 2026-09-08 — THE LIST'S ROWS HAVE THEIR OWN ⋯** (Mark: "add a
   'more options' button column to the special order list screen with
   'duplicate' and 'delete' options to start"). `ProductionItemsList`'s shape,
   three weeks after the PO list made the same argument: acting on ONE order
   meant opening it, and the list is where you are already looking at the one
   you mean. Unlabelled last column, so it stays out of the Columns menu — it is
   a control rather than a field, and hiding it would hide the only door.
   **BOTH VERBS LIVE IN `lib/specialOrderWrites`, WHICH IS THE POINT.** The
   record's command row does the same two things, and a delete on this table has
   THREE refusals and a confirm that counts what goes — precisely the things the
   PO list names as "remembered in one copy and forgotten in the other". Ninety
   lines moved out of `OrderActions` rather than being written a second time, and
   the two pure halves — `deleteRefusal` and `deleteConfirmMessage` — are what
   the two doors must agree about, so they are fixture-tested where a component
   is not.
   **IT PRE-COMPUTES NOTHING.** The row carries no line count, no schedule link
   and no `standing_order_id`, so Delete reads what it needs when it is pressed:
   one indexed read for one click, against widening the list's own query with
   three columns every row pays for and one row in fifty uses. That also means
   both doors ask the same question of the same data rather than of whatever
   each happened to hold — `OrderActions` lost `lineCount`, `paymentCount` and
   `fromStanding` outright.
   **A REFUSAL IS AN `alertDialog`, NOT A LINE IN THE CELL.**
   `InventoryItemActions` prints its errors under the ⋯ and can afford to; these
   are three-sentence refusals and this column is ~65px, so in flow they would
   wrap to twenty lines and push the table apart. `lib/confirm`'s `notice` is
   its own answer for "an error the reader must see".
   **THE STANDING-ORDER CONFIRM IS A DIFFERENT QUESTION**, which only became
   visible once one function wrote both: deleting a DAY should have been
   cancelled, where deleting a RECURRENCE should have been PAUSED — and the days
   it has already made survive it (051's `on delete set null`), which is worth
   saying because what actually stops is the making, silently. The refusals are
   ORDERED, and the materialized-day one outranks the scheduled one: both are
   true of a scheduled wholesale day and only one is about something the app
   would undo by itself.
   **WRITE ROLES ONLY** — both entries write, so below that the ⋯ would open an
   empty panel, unlike the PO list's, which keeps Preview and Download for every
   reader. `/special-orders` is staff-READ in the permissions sheet, so that is
   a real state.
   Measured at 1440 and 1280: nothing clipped, no page overflow, the cell 76px
   and 67px around a 36px button. Walked live and left as found — the refusal
   fired on the real materialized day 10021 naming standing order 9762, a
   duplicate of it landed as lead #10036 with its line and no `standing_order_id`,
   and deleting THAT copy through the record's own button worked, which is also
   migration 100 proving itself on a real order carrying a line.

   **Shipped 2026-09-08 — THE LIST REMEMBERS ITS VIEW ACROSS A HARD LOAD**
   (Mark: "make sure that the filter settings persist across page loads.
   'Upcoming' keeps getting set"). They already survived everything EXCEPT a
   hard load, which is what made this confusing to describe: the filters live in
   the URL, so a reload of the same address keeps them, and `lib/navMemory`'s
   `paths` puts them back when you leave the section and come back — but `paths`
   is IN MEMORY ONLY, deliberately, and "a hard load has nothing worth
   restoring" is true of a record somebody was reading yesterday and false of a
   list's own filters. Opening the app landed on a bare `/special-orders`, and a
   bare URL means the `view` dimension's default, which is Upcoming.
   **A SESSION COOKIE, this app's answer to exactly that three times over**
   (`rf.guide.view`, `rf.po.view`, `rf.invoice.view`), and the order guide's
   stated reason applies word for word: the nav link is a bare path with no
   query to carry, AND the server must know the view before it queries — the
   window under the filters is "a month back" unless the view is `past` or
   `all`, so a client-side restore would fetch a month and then filter to a
   view that wanted a decade.
   **WHAT IS STORED IS THE HREF'S OWN QUERY STRING, VERBATIM** — whatever
   `filterHref` just wrote, not a parsed shape. The dimensions have changed
   twice already and a second schema for them here is a second thing to keep in
   step; reading it back is `URLSearchParams`, and anything that no longer means
   something is dropped by `parseFilterValues` exactly as a hand-edited URL is.
   ONE function writes the view and writes it twice — URL and cookie together —
   so the two cannot disagree about what the view currently is.
   **IT REPLACES, IT DOES NOT MERGE.** A request carrying ANY view key uses its
   own view outright: merging would quietly add this browser's other filters to
   a shared link, so a colleague opening `?status=order` would also get whichever
   kitchen you happen to have selected. Proved live — `?view=upcoming` came up
   Upcoming with every other menu on All while the cookie held four filters.
   **`urlFilterParams` RETURNS AN EMPTY OBJECT ON A BARE PATH, NOT NULL**, which
   is the trap this had to dodge: the list's `urlFilterParams(PATH) ??
   initialFilters` would therefore have ignored the server's remembered view and
   left the filter bar saying "Upcoming" over rows the server had already
   filtered to something else. A screen disagreeing with itself is worse than
   not remembering at all. `hasViewParams` is the test both ends use, and an
   EMPTY value counts as a value — `?q=` is a cleared search box, which is a
   view somebody chose.
   Verified live end to end: setting view/status/kitchen/sort wrote a cookie
   mirroring the URL to the character, and a hard load of the bare
   `/special-orders` came back **All orders · Order · DF02 · Customer ▲, 133 of
   500**, with the menus and the rows agreeing. `clearSessionCookies` drops it
   with the rest, so a shared iPad does not hand the next person your view.

   **Shipped 2026-09-08 — AN ORDER WITH LINES COULD NOT BE DELETED (migration
   100, APPLIED 2026-09-08).** Found on the harness while proving 099's "a deleted
   day is remade" rule — which could not happen, because the delete itself
   failed. Reproduced in isolation as a real authenticated supervisor:
   `delete from special_orders` cascades to the order's items and payments, each
   fires 054's AFTER DELETE log trigger, the trigger writes into
   `special_order_events`, and that row's FK names the order the statement has
   just deleted. The whole statement rolls back and `OrderActions` reports the
   raw Postgres text.
   **EVERY SPECIAL ORDER CARRYING A LINE OR A PAYMENT HAS BEEN UNDELETABLE SINCE
   054 SHIPPED ON 2026-08-20** — which is every real order.
   **WHY A LIVE WALK MISSED IT, and it is the lesson worth keeping:** the
   2026-08-20 verification created an order, added a line, edited it, REMOVED THE
   LINE (to prove the "Removed 24 ×" entry), and only then deleted the order — by
   which point it was empty. The 2026-08-27 walk's delete was refused earlier by
   the scheduled-order guard. The one path never walked was the ordinary one.
   **THE GUARD GOES IN `log_special_order_event`, NOT IN THE TWO TRIGGERS.**
   Eleven lines both paths already go through, against two ~90-line
   reproductions of functions this migration otherwise has no business touching
   — and 055's rule cuts both ways, since a migration that restates a function it
   does not mean to change is how one gets silently reverted. It is also the
   honest place: that function already returns quietly on an empty message, and
   "there is no longer an order to record this against" is the same kind of
   answer. Nothing is lost, because `special_order_events` cascades with the
   order too. Verified both ways on the harness — an order with a line AND a
   payment deletes leaving zero orphan events, and a line removed from a LIVING
   order still logs "Removed 24 × Cruller", so the fix is not a mute.

   **Shipped 2026-09-08 — DECISION 13, STANDING ORDERS MATERIALIZE THEMSELVES
   (migration 099, APPLIED 2026-09-08 and LIVE).** Mark: "I haven't seen any special order
   'standing orders' get created automatically. I thought this was something we
   had built but maybe not."
   **IT WAS NOT, AND EVERYTHING AROUND IT WAS**, which is why it read as built.
   051 shipped `kind = 'standing_order'`, `standing_days`, `starts_on`,
   `ends_on`, `paused` and `standing_order_id`; it created
   `special_orders_standing_day` as the idempotency key "the materializer" would
   be safe on; it created `special_orders_standing_idx` FOR "the materializer's
   own sweep"; 057 set `horizon_days` to 14; `standingMaterializationDates` was
   written and fixture-tested; and `StandingOrderBlock` has been telling anybody
   who opened a standing order that "orders appear by themselves 14 days ahead —
   nobody has to remember". **The function those six things describe had never
   been written.** Measured before starting: **ZERO rows in the whole database
   carry a `standing_order_id`**, and Cafe Knotted's last wholesale day was
   **2026-08-23**, sixteen days earlier, loaded out of FileMaker.
   Worth remembering as a CLASS: a feature can be complete in its schema, its
   pure helpers, its indexes, its settings and its copy, and still not exist. The
   probe that settles it is the one nobody had run — `select count(*) ... where
   standing_order_id is not null`.
   **THE FUNCTION IS `security invoker`, 068's ARGUMENT VERBATIM** — every insert
   flows through 051's own supervisor+ policies, so a top-up cannot create an
   order its caller could not have created by hand. **Which makes the role
   check's SHAPE the opposite of every other guard in this schema: below
   supervisor+ it RETURNS `{skipped: "role"}`, it does not raise.** 092 widened
   the select policy to every member, so staff read `/special-orders` — and the
   list calls this before it queries, so a raise would replace the whole screen
   with a role error for the people least able to act on it.
   **THREE DOORS, ONE FUNCTION** (013's precedent): the list's server component
   and the generate-schedules dialog both top up the ROLLING HORIZON through
   `topUpWindow`, and `MaterializeNow` on the record reaches past it for a
   one-off, scoped by `p_order_id`. The horizon lives in `orgs.settings` and is
   read by the CALLERS rather than by the function, precisely because the escape
   hatch's whole job is to reach further.
   **IT NEVER BACKFILLS.** `p_from` is passed in — `current_date` is UTC, which
   after 4pm Pacific silently skips a day — and the window opens at `p_from`
   however old `starts_on` is. Cafe Knotted's sixteen missing days have HAPPENED;
   making them now would put orders nobody delivered onto a statement. Verified
   by breaking it on the harness: honouring `starts_on` produced **200 orders
   back to 2020-01-01**, which is also the `p_max` cap proving itself (uncapped
   it would have been ~2,400).
   **THE `exists` CHECK AND THE `on conflict do nothing` ARE TWO GUARDS, NOT
   ONE.** The conflict clause is the race guard; the pre-check is what stops an
   order number being burned for a day that already exists (013's rule). Proved
   by breaking it: with the pre-check gone the rows stay correct and a NO-OP RUN
   ADVANCES THE SEQUENCE BY EIGHT.
   **A CANCELLED DAY STILL BLOCKS RE-CREATION**, which is 051's stated intent and
   is now enforceable — so `OrderActions` REFUSES to delete a materialized day
   outright rather than confirming it. Not a click-through: deleting frees the
   slot, the next top-up makes the day again, and the donuts get made. Cancelling
   is the only thing that means "we are not making these", and the refusal says
   so. `standing_order_id` had no reader anywhere in `web/src`; a **Made from**
   row on the record is the other half, since "why is this order here" had no
   answer on screen.
   **THE RECORD NOW SAYS WHAT HAS ACTUALLY BEEN MADE**, beside the rule it has
   always described — "Made so far: 9 orders, through 2026-09-22", or a yellow
   "No orders have been made from this yet." Those are two different claims and
   for three weeks they disagreed completely; a line naming the real count is
   what would have caught this on the screen rather than in a database probe.
   **EIGHT OF THE TEN STANDING ORDERS ARE PAUSED BY THE MIGRATION** (Mark,
   2026-09-08: "everything should be paused except 9762 and 9763"). The seven
   **Yeastie Boys** orders are unpaused with `starts_on` null and 84 Bismarks
   each, and their last real order was **February 2025** — switching the top-up
   on without this would have made a week of orders for a dormant account, which
   is exactly why decision 13 said the migration must materialize nothing.
   **#10018** is an app-numbered duplicate of #9762 with an EMPTY weekday set,
   which would have made nothing and warned about itself forever. Paused rather
   than deleted: a standing order is the record of an arrangement, and unpausing
   is one tap.
   Verified: all 100 migrations replay on the Docker harness, and every rule was
   checked as a real authenticated role — a supervisor's run makes 8 orders on
   the right weekdays with the header snapshot and the lines copied, a second run
   makes 0 and burns no number, a cancelled day blocks re-creation, a deleted one
   is remade, staff get `skipped: "role"` with no error, `anon` is refused
   execute, a non-member gets "not your organisation", a range over a year is
   refused, and the misconfigured standing orders are NAMED. **1688 fixtures
   pass**, 11 new, each checked by breaking it.
   **THE FIRST REAL RUN, measured the same day it was applied.** *Probe, don't
   read this line.* `select public.ensure_standing_orders_materialized(null,
   null, null)` raises **"no organisation given"** from its first statement,
   which proves the body runs; `select count(*) from special_orders where
   standing_order_id is not null` was **15** an hour after Mark applied it — Cafe
   Knotted's 2026-09-08 through 2026-09-22, every day of the week, #9762 taking
   Mon–Thu and #9763 Fri–Sun, numbered 10021–10035 and each carrying "Print
   Order"; and `select number, paused from special_orders where kind =
   'standing_order'` shows the seven Yeastie Boys rows PAUSED with those two
   live. #10018 is gone — Mark deleted the duplicate rather than leaving it
   paused.
      **Not built, and named so nobody thinks it was forgotten:** nothing warns when
   a standing order's line has no `production_item_id` (it would schedule
   nothing — `unschedulableLines` already knows how to say this), and the
   materialized days are not shown ON the standing order's record, only counted.

   **Shipped 2026-08-27 — DECISION 9, SCHEDULING PRODUCTION (migrations 067 +
   068, BOTH NEED APPLYING).** 040 shipped the entire seam and left it unused
   for three weeks: `production_schedules.source` already accepted
   `'special_order'` with `source_ref` and `title` beside it,
   `production_schedule_items.par_source` accepted it too, its `tray_number`
   comment named "every special-order line", 051 gave
   `special_orders.production_schedule_id` an FK **that nothing had ever read**,
   `unschedulableLines()` was written and exported with **zero callers**, and
   the generate dialog said in user-visible copy *"Nothing generates special
   orders yet."*
   **067 EXISTS BECAUSE `unique (schedule_id, item_id)` CANNOT HOLD, and that is
   a MEASUREMENT.** `production_items` has **ONE generic `Letter` subtype** — 56
   rows, one per FLAVOUR — and no per-character item, because the character is a
   property of the ORDER. So every letter of a customer's name resolves to the
   same production item: order **#7769** spells HAPPY BIRTHDAY VINNY in 18 lines
   that ALL point at `Rites of Sprinkles - Choc`, which under 040's key is one
   line reading "18 × Rites of Sprinkles - Letter" and a decorator who does not
   know which letters to cut. Not an edge case — **943 of the 3,133 orders
   carrying linked lines (30.1%)** have two lines sharing a production item, and
   **roughly three in four of those collisions are different letters** rather
   than duplicates. So the key is
   `(schedule_id, item_id, coalesce(subtype, ''))`, an EXPRESSION index because
   two NULLs are never equal in a plain unique index. Cheap when it landed: 17
   schedules, 546 lines, all `source = 'plan'`.
   **PLAN SCHEDULES ARE UNAFFECTED AND THAT IS PROVABLE**: `production_day`
   groups by `(kitchen, item_id)` and returns one row per item, each with one
   subtype, so there is never a second row to split from.
   **THE DELETE-STALE PREDICATE HAD TO MOVE WITH THE CONFLICT TARGET, and
   forgetting it is a silently DOUBLED PAR.** 040's replacement pass deletes a
   line only when the day no longer carries its `item_id`; with the key widened
   but that predicate left alone, renaming an item's subtype in the catalog and
   regenerating leaves the old line standing AND inserts a new one. **Measured
   by breaking it on the harness: 2 lines, 48 donuts where 24 is right.** Both
   `not exists` blocks — the delete and the `v_lost` actuals count above it —
   gain `coalesce(d.subtype,'') = coalesce(li.subtype,'')`, and they must keep
   saying the same thing or the guard and the delete disagree about what is
   about to be lost. The function is REPRODUCED IN FULL (055's rule); the
   reproduction was diffed against 040:821-1109 and is byte-identical but for
   those three lines.
   **068 IS THE `freeze_pay_period` SHAPE: TypeScript computes, SQL validates
   and commits.** Grouping means normalising the CUT, and the live data holds
   **93 letter-ish spellings** of forty-odd characters (`Letter - "A"` 1,170,
   `Letter "A"` 17, `Letter. "A"`, lowercase, a stray `Letter - U"`, one
   escape-mangled `Letter - ""Y""`). That logic already exists, fixture-tested,
   in `lib/specialOrderLines`; a PL/pgSQL twin is 016's `nextDeliveryDate` trap
   on a document a kitchen bakes from. `lib/specialOrderSchedule` groups on
   `(production_item_id, canonicalCut)` and SUMS — repeated letters within a
   word are one line ("HAPPY" is 2 for P) — which is exactly what Mark asked
   for. A **bare `Letter`** is its own group and is never folded into a
   character (935 real rows: letters ordered, the word not settled), and a
   non-letter cut is trimmed and otherwise untouched, because two spellings of
   `Promise Ring` are both somebody's deliberate typing.
   **THE PAYLOAD IS NOT TRUSTED.** Every item must be a production item in this
   org AND appear as the `production_item_id` of a line on THIS order — without
   the second half, a caller holding one order's id could schedule any item in
   the catalog against it. Plus `(item_id, subtype)` unique within the payload
   (checked before it can raise as a `unique_violation` naming an index) and
   every par positive.
   **BOTH FUNCTIONS ARE `security invoker`, WHICH IS 013's PRECEDENT VERBATIM.**
   `production_schedules` is purchaser+ on insert and delete (040) while this
   module is supervisor+ (051), so a definer would silently widen "who commits a
   kitchen's night" as a side effect of wanting atomicity. Verified on the
   harness as real roles: **a supervisor's schedule is refused by RLS by name, a
   supervisor's unschedule DELETES ZERO ROWS AND RETURNS NO ERROR** — which is
   why `unschedule_special_order` checks the row count and says so — and `anon`
   is refused both outright. Atomicity holds anyway: a function body is one
   transaction, so an order can never rest half-scheduled.
   **`order_scheduled_at` TAKES TODAY, NOT THE PRODUCTION DATE**, and `p_today`
   is a PARAMETER — `current_date` is UTC, so after 4pm Pacific it dates an act
   to a day that has not happened. Every stage date beside it records the day
   the ACT happened; the day production was scheduled FOR is on the schedule.
   Only when empty (SendDocument's rule).
   **BOTH SHOP COERCIONS ARE NAMED IN THE DIALOG** (040's "names every coercion
   in its receipt"): the schedule's two location columns are NOT NULL where the
   order's are both nullable (kitchen filled on 83%, pickup shop only on recent
   rows), so kitchen ?? pickup and pickup ?? kitchen, with a yellow mark saying
   which stood in. Verified on the real #7769, which has no pickup shop.
   **054's TRIGGER WATCHES NEITHER `production_schedule_id` NOR THE STAGE
   DATES**, so the biggest act in the module would have left no trace in its own
   history. Both functions write a `special_order_events` row — the
   `Duplicated from order N` case, a fact with no watched column behind it.
   Unscheduling says it discarded a document and NOT that it undid anybody's
   decision: a to-do or status the workflow offer moved stays where a human put
   it.
   **SCHEDULED IS A LOCK, NOT A SYNC** (Mark's call). The Items tab, the event
   date and the kitchen — the three things the schedule was BUILT from — go
   read-only until somebody unschedules, which deletes the schedule outright.
   Everything else stays editable, because none of it changes what gets made.
   Keeping a live schedule in step with a changing order is a standing
   obligation; delete-and-rebuild is a rule you can state in a sentence. It is a
   UI lock and does not pretend otherwise — the guard that matters is in the
   function.
   **UNSCHEDULE REFUSES ONCE PRINTED OR COUNTED**, which is the one place this
   module is stricter than `closeReadiness`'s name-it-and-let-you-through rule,
   and deliberately: both facts are about the WORLD rather than the record —
   paper is in a kitchen, or somebody stood at a bench and counted. The escape
   hatch is real and is not a hole: a purchaser deletes the schedule from
   `/schedules/[id]`, which clears the link through the FK, and that confirm is
   now source-aware because "generating the day again would rebuild it from the
   plans" is FALSE here.
   **DELETING THE ORDER IS REFUSED WHILE IT IS SCHEDULED**, because `source_ref`
   deliberately carries no FK (040: the table did not exist yet), so the delete
   would leave a kitchen holding a schedule with a dead backlink. Cancelling is
   allowed and NAMES the schedule — cancelling does not unschedule, so those
   donuts still get made.
   **DECISION 11: SELECTING A NIGHT'S PLAN SCHEDULE PULLS IN ITS SPECIAL
   ORDERS** (`companionScheduleIds`). The packet summed the schedules you had
   TICKED, so "the tray guides include special orders by construction" was only
   true if somebody remembered — and forgetting produced a guide that looked
   complete and was short by a wedding. ONE DIRECTION only: ticking a special
   order alone does not drag the plan in, because printing one order's sheet is
   a real thing to want. Two consequences that are easy to get backwards: the
   print stamp goes on the EXPANDED set (an unstamped special-order schedule
   would slip past the printed guard while the kitchen holds the paper), and the
   FILENAME comes from the SELECTION (one chosen night is still one night).
   PostgREST has no tuple `IN`, so it is two `.in()`s narrowed to exact pairs in
   JS.
   `DATE_IMPLIES.order_scheduled_at` is order-aware now — the sixth rung is
   compound (printed AND scheduled) and since scheduling became a command the
   order can arrive from either side, so it offers **Print Order** when the
   order has not been printed and Send Receipt when it has.
   Verified: all 69 migrations replay on the Docker harness and every rule was
   checked by BREAKING it. (The 12-line roll-up this originally shipped is gone
   — see the 069 block below; #7769 now transcribes to 20 lines.) The same order
   rendered through the real dialog against the LIVE database gives the same 12
   lines and 118 to make, and the commit refuses legibly ("migration 068 has not
   been applied") while writing nothing.
   **GENERATING A NIGHT OFFERS ITS SPECIAL ORDERS — decision 12's pull, built
   at last** (Mark, 2026-08-27: "initially we thought we would pull special
   orders into a production schedule from this end, instead of pushing them
   from the special order page? Is that still a possibility?" — he was right
   about the history). Production brief decision 12 says special orders "inject
   production the same way FMP's do" and "the generate dialog's 'ignore special
   orders' toggle survives" — that toggle exists because FileMaker's generation
   PULLED them in. Nine days later the special-orders brief's decision 9
   specified push-from-the-order, nobody reconciled the two, and the toggle sat
   **inert for three weeks**: `p_ignore_special_orders` was written to
   `ignored_special_orders` and read by nothing.
   **THE PULL RUNS IN THE CLIENT, AND THAT IS THE DESIGN RATHER THAN A
   SHORTCUT.** Folding it into `generate_production_schedules` needs a PL/pgSQL
   twin of `scheduleDraft` — the cut canonicalisation over 93 spellings, the
   note copy, the Misc filter — which is 016's `nextDeliveryDate` trap and the
   thing 069 argued against. So the dialog calls `schedule_special_order` once
   per ticked order: **push stays the only writer and this is a second DOOR onto
   it**, same function, same guards, same transcript. No migration, no
   duplicated rule. Each call is its own transaction, so one refusal leaves the
   rest done and is NAMED in the receipt (the commonest being somebody having
   scheduled it while the dialog was open).
   **"READY FOR PRODUCTION" IS `status = 'order'`, AND THAT IS A MEASUREMENT**
   (Mark: "only special orders that are 'ready for production' (whatever that
   ends up meaning) should be offered"). Of the eleven upcoming orders that day,
   the two he had scheduled BY HAND were both `order` and both paid; of the
   eight he had not, **six were still quotes** — four without even a returned
   quote — one was an unpaid invoice, and exactly one was a committed order. So
   the rung the module already calls "paid — printing and scheduling remain" is
   the rung he schedules at, and offering a quote asks a kitchen to make donuts
   nobody has agreed to buy. It is also `suggestedTodo`'s own sequencing.
   Worth noting because the first reading of that data was ALARMIST and wrong:
   "eight upcoming orders unscheduled" sounds like a hole and is mostly correct
   behaviour.
   **A FLAGGED order is offered UNTICKED with its flag as the reason** — 013's
   under-minimum vendor, "unchecked-but-checkable". Everything else is withheld
   and **COUNTED in a sentence** ("1 more not ready — still a Quote"), never
   silently absent: an order that simply does not appear is indistinguishable
   from one the query missed.
   **The match is on the KITCHEN, not the pickup shop** — the dialog picks shops
   that SELL, while the schedule is made at the kitchen, so generating DF01
   brings along the wedding DF01 bakes for DF02.
   **`loadCandidates` carries a SEQUENCE GUARD**, because changing the date and
   then the day count puts two queries in flight and whichever answers last
   wins regardless of which was asked last. It also refuses to swallow a query
   failure into an empty list — "none ready for production" is a CLAIM, and a
   failed query must not make it.
   The toggle now means what it always said: tick it and the plans generate
   alone. Verified live end to end and **left exactly as found** — #9618
   offered and ticked while its quote-stage neighbour was withheld, generated
   alongside two plan schedules, `order_scheduled_at` stamped **2026-08-27**
   (the org's day, where UTC was already the 28th), `todo` untouched, five lines
   each carrying its own note; then all of it deleted back to 19 events, 21
   schedules, 622 lines.

   **THE GENERATE RECEIPT'S "DONE" WAS A NO-OP** (Mark, 2026-08-27), and the
   cause is worth knowing because it can only ever happen this way round: it was
   a `<Link href="/schedules">` in a dialog that ONLY EVER RENDERS ON
   `/schedules`, so it pointed at the page it was already on — which Next
   correctly treats as nothing to do, leaving the panel up and the button
   reading as dead. There was never anything to navigate to: `run` refreshes the
   list the moment the receipt arrives, so finishing means putting the receipt
   away, and it is a button that closes.

   **SORTING BY THE COLUMN A LIST IS GROUPED BY TURNS THE BANDS OVER** (Mark,
   2026-09-09: "changing the sort direction of the date column on the schedule
   list page doesn't actually change the sort direction"). It didn't, and it
   COULD NOT. `DataTable` bands a run of like-labelled rows, so a grouped list
   sorts by the group FIRST and by the chosen column WITHIN each run — and the
   group led with a HARDCODED direction. Inside a date band every row carries
   the same date, so the within-run comparison was a no-op and the arrow moved
   nothing at all.
   **THE FIX IS ONE CLAUSE: when the grouping and the sort name the same field,
   the direction drives the BANDS**, which by then is the only thing left for it
   to drive. Every grouping on these lists has a same-named sort key, so
   `grouping === sort.key` IS "you are sorting by what you are grouped by". A
   group the sort does not name keeps its own lead — ascending, except by DATE,
   where "most recent first" is what anybody means and an ascending band would
   open the list on last month.
   **THE SAME BUG WAS IN THREE LISTS AND ONLY ONE WAS REPORTED.**
   `/schedules` (default grouping DATE, so the Date column was the first thing
   anybody would try), **`/timesheets` (default grouping EMPLOYEE — sorting by
   Employee did nothing)** and `/batch-logs` (default grouping none, so it bit
   only once you picked one). Fixed in all three; grep for a comparator that
   leads with a group before adding a fourth.
   The schedules comparator moved to `lib/productionSchedule.sortSchedules` to
   be fixture-tested — **a comparator inside a `useMemo` is exactly where this
   hid**. 10 fixtures, checked in BOTH directions: restoring the hardcoded lead
   turns 3 red, and letting the direction drive every band turns 2.
   **THE SELECTION BAR DELETES** (Mark, 2026-09-09: "in the box that appears
   when selecting multiple schedules … add a delete button"). The bar had held
   only Print packet since it shipped, so removing a night meant opening it.
   **ONE IMPLEMENTATION BEHIND BOTH DOORS**, `components/production/scheduleWrites`,
   taking the ids as a parameter — the PO list's rule and its reason: what gets
   remembered in one copy and forgotten in the other is the `.select()` row-count
   check (a delete matching no policy removes ZERO rows and returns NO error, and
   on the record that cheerful success also NAVIGATES) and what the confirm NAMES.
   **THE CONFIRM IS PURE AND FIXTURE-TESTED**, which is how a real defect was
   caught before it shipped: keying the singular sentence on "every row is a
   special order" reads correctly on ONE night and then says "This came from a
   special order" over a selection of five. Three branches, not two.
   **ONE NIGHT NAMES ITSELF, A SELECTION IS COUNTED** — from a record the date is
   the useful fact, from a bar over fifteen ticked rows one row's date is a worse
   answer to "which ones?" than the number. It sums the items going with them,
   names counted quantities where any night carries them (somebody stood at a
   bench for those), and **a MIXED selection gets BOTH last sentences**: the
   plan one is FALSE of a special-order night (the generator only ever touches
   `source = 'plan'`, and this route bypasses `unschedule_special_order`'s
   printed/counted guard), so either alone would be true of some of what is
   going and a silent omission about the rest.
   **GATED ON `editable`, NOT ON `stampable`.** Printing STAMPS a night and is
   supervisor+ (044); deleting one is a purchaser's write. They are different
   rungs, so the bar can legitimately exist for somebody who may print and not
   delete — which is why `SchedulesList` now takes both flags. Red, like the
   record's own Delete and every destructive command on a screen: a reader
   cannot tell "opens a confirm" from "destroys" by looking.
   Measured at 1280: Print packet and Delete both 36px on the same top, 16px
   apart, Clear holding the bar's right edge, no wrap.
   **THE FROM COLUMN NAMES THE PLAN** (Mark, 2026-08-27: "instead of 'Plan' can
   the from column say the name of the plan instead?"). "Plan" was true of every
   plan schedule and so distinguished none of them, where "SUMMER 2026 (DF01)"
   is the thing you would go and look at — and the record's own sentence now
   names it too, as a LINK to `/plans/[id]`.
   **IT IS DERIVED, NOT SNAPSHOTTED, and that is the thing to know before
   trusting it.** Nothing records which plans fed a generation, so
   `plansInForce` answers "which plans are in force for this shop, KITCHEN and
   day" — which is the claim the record screen has always made in words ("From
   the plans active that day"), now with the names in it. The cost: activating
   or retiring a plan changes what an OLD schedule says it came from.
   Snapshotting `plan_ids` at generation is the fix and it is a migration.
   **The kitchen is in the match, not just the shop**: a shop running two plans
   into two kitchens produces two schedules, each fed by one of them, and
   without that test the wrong plan's name lands on the row. A plan with a null
   kitchen falls back to its selling shop (039's nullable column, decision 9's
   reading). Dates compare as STRINGS — `new Date` is UTC midnight and moves a
   plan's first day west of Greenwich.
   **Several plans can be in force**, since decision 9 makes a shop's menu their
   union and their pars SUM, so the label holds two names and counts past that
   ("EVERYDAY + 2 more", the full list in the row's `title`). Measured
   2026-08-27: all 17 real plan schedules resolve to exactly one.
   `scheduleSourceLabel` is ONE function called by the column that renders it
   AND the search that has to find it; sorting moved onto the LABEL, since
   sorting by the raw `source` would group every plan schedule under an order
   the reader cannot see. Date gave up 30px to pay for From's 210.

   **AND SINCE 2026-09-12 THEY ARE ONE ACTIONS MENU** (Mark), top-right in
   that same row: Add Item… · Print… · Recost · Regenerate… · Delete
   Schedule… (red). `AddScheduleItems` and `PrintPacket` gained an optional
   `children` render prop that hands out a menu row while keeping their
   dialogs, so `ScheduleActions` composes them itself (a server page cannot
   pass a function) and takes `stampable`/`orgId`/`addable` in place of the
   `print`/`add` slots. The trigger reads Costing… / Regenerating… /
   Deleting… while one runs.
   **THE RECORD'S COMMANDS MOVED UP INTO THE IDENTITY BLOCK** (Mark,
   2026-08-27, "like we do in the other detail views"), **Add item… with them**
   — so the row is Add item · Print · Recost · Regenerate · Delete, which reads
   build → produce → maintain → destroy. Add LEADS because it is the only one
   that changes what the kitchen MAKES; the rest act on the document as a whole.
   It rides in ScheduleActions as an `add` SLOT, `print`'s own idiom, which
   keeps the panel's query and state out of that component while letting the row
   decide the order. The Items heading is now a heading and nothing else.
   **That move exposed FOUR hand-typed near-copies of one button class** —
   `ScheduleActions`' local `COMMAND`, `AddScheduleItems`, `PrintPacket` and
   `ui/buttons`' own `BUTTON_CLASS` — which had already drifted (one had lost
   its `disabled:` state). Harmless while they sat on different rows; they now
   stand in ONE row where any drift is visible at a glance, so all three copies
   read `${BUTTON_CLASS} shrink-0`. Measured after: all five buttons 36px tall,
   1px border, 12px, 16px padding, tops on the same pixel as the h1. Print / Recost /
   Regenerate / Delete sat under the field grid, so on a long night they were a
   scroll away from the thing they act on. `items-start`, so they line up with
   the TOP of the title rather than centring against a block whose height
   changes with the source line and the special-order backlink; right-aligned
   beside it and left-aligned once they wrap under it. Measured: the h1's top
   and Print's top are the same pixel, and Delete, Add item and the table all
   end on 1217 — the page's own content edge. `ScheduleActions` lost the
   `ml-auto` on Delete, which in a content-sized cluster could only ever have
   been a no-op.

   **THE ALLERGEN CHIP ONLY SHOWS WHEN IT SAYS SOMETHING**, which the same
   session's backlink introduced and this fixes. Measured over the 835 real
   orders carrying `allergen_info`: **446 of them (53%) say some spelling of
   "no"** — "no" 242, "none" 132, "n/a" 44. A yellow mark reading "none" on
   half the orders is how the one reading PEANUTS stops being read.
   `meansNoAllergy` is a WHOLE-STRING match against a closed list and **fails
   safe**: "no nuts" contains "no" and means the opposite of it, so anything
   unrecognised is SHOWN. A new way of writing nothing costs one redundant
   chip; a new way of writing an allergy costs a great deal more.

   **FOUR CHANGES TO THE SCHEDULE, 2026-09-07, all Mark's.**
   **(a) GENERATING DEFAULTS TO TOMORROW.** The dialog is opened at the END of a
   shift, by the closer, to make the paper the overnight bake works from — so
   the night it is about has not happened yet. Defaulting to today meant every
   routine generation began by correcting the date, and the one time somebody
   forgot produced a schedule for a day already made. `daysAfter` in `lib/today`
   (the mirror of `daysBefore`), off the ORG's calendar day, so the boundary is
   the shop's rather than UTC's.
   **(b) TYPE, SIZE, CUT AND FINISH ARE EDITABLE, as picklists.** The note above
   that table had them read-only as "the line's own SNAPSHOT … a rename must not
   rewrite a printed document", and both halves are still true — neither argues
   against this. It is BECAUSE they are the line's own copy that editing one is
   safe: nothing here touches `production_items`, so tonight's sheet can say
   `Letter - "H"` without the catalog learning anything. Proved on the live
   09-07 schedule — the line's finish went Coffee Glaze → Maple Glaze and the
   FOUR catalog rows named Javabreaker stayed Coffee Glaze. The item's NAME
   stays read-only; it is the line's identity.
   The options come from the catalog query the Add-item panel ALREADY runs, plus
   the values on this schedule's own rows — the second source being the one that
   matters, since a special-order line carries a cut no `production_items` row
   has ever held (069). `allowNew` on top.
   **(c) A ROW HAS ITS OWN ⋯ — Duplicate line, Delete line.** Delete is the
   selection bar's own implementation taking the ids as a parameter (the PO
   list's rule: the confirm and the row-count check are what gets remembered in
   one copy and forgotten in the other), and it NAMES the single line, since
   from a row menu "1 item" is a worse answer to "which one?" than the name you
   just pressed.
   **DUPLICATE WORKS ON EVERY LINE — migration 096, APPLIED 2026-09-07.** It was
   special-order-only for one commit, because 069's key was
   `unique (schedule_id, item_id) where par_source <> 'special_order'` and so
   covered every line the generator did NOT write as well as the ones it did.
   Mark, 2026-09-07: "let's relax the index so plan lines can duplicate too."
   **THE KEY IS FOR THE GENERATOR AND NOW SAYS SO** —
   `where par_source in ('plan', 'override')`. 040 keyed the table because
   REGENERATION UPSERTS: `on conflict ... do update` needs exactly one row per
   item to aim at, and a second would double the day's par with nothing
   noticing. Every word of that is about the rows the generator writes. A
   `manual` row is invisible to the upsert in every respect except the index —
   the delete-stale pass already skips it by name — so the index was catching it
   for no reason of its own.
   **WHAT REMAINS FORBIDDEN is two rows the GENERATOR owns**, which is the
   doubling 040 exists against; verified on the harness, where a second `plan`
   line AND a `plan`+`override` pair are both refused by name.
   **THE CONSEQUENCE, WHICH IS THE POINT RATHER THAN A COST:** regenerating a
   day holding a duplicate restores the PLAN's line to the plan's par and leaves
   the copy alone, so the item is made once per line — `manual_kept: 2` in the
   receipt, measured. It is visible too: the copy carries no `planned_par`, so
   `planDeviation` reads it as ADDED and the Par column marks it.
   The copy is written `manual` unless it came from an order (then
   `special_order`) — both true, and both outside the key.
   **THE TRAP THIS MIGRATION NEARLY FELL INTO, and it is general: reproduce the
   function from the last migration that TOUCHED it, not from the one you are
   thinking about.** 096 is about 069's index, so 069's body was the obvious
   thing to copy — and **092** is the current version, having reproduced it to
   widen the role check to supervisor+. Copying 069 would have silently reverted
   that, with nothing failing and nobody looking. Caught by reading the guard
   while seeding the harness.
   And the CONFLICT TARGET has to carry the predicate WORD FOR WORD: the
   predicate given in `on conflict` must IMPLY the index's, and "not
   special_order" does not imply "in ('plan','override')" — a `manual` row
   satisfies the first and not the second. Written identically, and proved by
   RUNNING the generator on the harness, since plpgsql plans lazily and creating
   the function proves nothing about the inference.
   *Probe, don't read this line:* `select indexdef from pg_indexes where
   indexname = 'production_schedule_items_generated_line'` must end
   `WHERE (par_source = ANY (ARRAY['plan'::text, 'override'::text]))`, and
   `select count(*) from pg_proc where proname =
   'generate_production_schedules'` must be 1. NOT rerunnable — the `drop index`
   fails a second time, which is the signal it already ran.
   **PostgREST cannot reach `pg_indexes`, so the LIVE probe is BEHAVIOURAL** and
   is the better one anyway: a second `plan` line of an item must come back
   **23505**, a `manual` duplicate must be accepted, and the generator must
   raise `no locations given` from a null-argument RPC (two overloads would make
   PostgREST refuse to choose instead). All three confirmed on the hosted DB the
   day it was applied.
   **WALKED THROUGH THE APP on the real DF02 09-07 schedule and left as found**
   (35 lines, all `plan`, par total 380): Duplicate is enabled on a plan line
   and reads "A copy of this line, added by hand"; pressing it produced a second
   Javabreaker carrying the yellow **added** mark beside its 18, the badge went
   to "1 line differs from the plan", and the header moved **380 across 35
   items → 398 across 36** — which is the whole meaning of the change, the item
   being made once per line. Delete line put all three figures back.
   **(d) THE PAR SAYS WHEN IT DISAGREES WITH THE PLAN, and what the plan said.**
   The record has carried "N lines differ from the plan" since 040 and
   `planned_par` has been on every row since, rendered NOWHERE — so the badge
   sent you down 64 rows comparing a number against one you could not see
   (Mark: "it doesn't tell which one. Flag that par").
   **`planDeviation` in `lib/productionSchedule` is the ONE function the badge
   counts with and the cell marks with**, so the two cannot drift into saying
   "3 differ" over a table with two marks in it. It reads `par_source` first —
   `plan`/`override` are the generator's own and `special_order` is a different
   SOURCE with no plan figure to disagree with — and then `planned_par`: a
   number means the par was CHANGED, null means the line was ADDED by hand,
   which the plan cannot disagree with because it never carried the line.
   **A manual par EQUAL to the plan's is not a deviation**: `par_source` stays
   manual once touched (it also tells a regeneration to leave the line alone)
   but "differs from the plan" is a claim about the NUMBER. 5 fixtures, checked
   by breaking that clause.
   A FILL beside the number, never `text-mark` (1.43:1 on white) and never a
   colour on the figure itself — the figure is right, it is what somebody
   decided, and what is worth an eye is that it was decided rather than derived.
   Par took 20px for it, out of Name, which WRAPS and so loses a wrap point
   rather than any text.
   Walked live on the real DF02 09-07 schedule and left byte-identical (35
   lines, all `par_source = 'plan'`, `par = planned_par`): the par edit raised
   both the badge and a `plan 18` chip beside 24, the row menu showed Duplicate
   disabled with its reason, and the generate dialog opened on 2026-09-08.

   **THE SCHEDULE'S LINE TABLE LOST TWO COLUMNS AND GAINED TWO** (Mark,
   2026-08-27): Type - Size - Cut - Finish - Name - Par - Made - Left over -
   Sold - Note. **Tray** went because a special-order line never has one and a
   plan line's is already the band you can group by; **Planned** went with it —
   it was `planned_par`, what the plans said before an override or a hand edit,
   and its job was to let a row explain its own number. The header's "n lines
   differ from the plan" badge still counts them, so what is lost is the
   per-row figure, and restoring the column is a dozen lines. `sourceTitle`
   went too, being its only caller.
   **Cut is the column that had to exist**: with one generic `Letter`
   production item per flavour, twelve letter lines are twelve identical-looking
   rows without it — so it is wide (150) and is the one descriptor never dropped
   when the table goes compact. The Name cell stopped repeating
   `subtype · finish` underneath itself, both being columns now. Widths key
   bumped to `.v2`, or a stored order from before would outrank the new one.
   **Boxes went as well and was NOT in the removals Mark named** — his column
   list simply did not include it, and it is `filled × tally_box_size`, the
   printed tally strip restated on screen. One line to restore if that was an
   oversight.
   Measured at 1280: nothing clipped, no page overflow, and every letter cut
   fits the Cut column with room (`Letter - "<3"` is the widest at 87px in
   107px of space; only the inactive `Bullseye "<3" Center` would ellipsis). At
   1100 the compact tier sheds Size, Finish and Left over.

   **WALKED END TO END ON THE REAL #7769, 2026-08-27, AND LEFT AS FOUND**
   (17 schedules / 546 lines before and after, 27 events, the order byte-identical).
   Scheduled onto 2026-08-28 — a night DF01 already had a plan schedule for, so
   decision 11 could be tested — and what that proved beyond the harness:
   **`order_scheduled_at` STAYED 2023-07-14.** The real order already carried
   one, and the coalesce refused to move a date its 2023 paperwork was dated
   with. That is also the fact that makes the RESTORE step non-optional if
   anybody walks this again: **unscheduling CLEARS that column**, so on an order
   that had a real date, a test unschedule destroys it. Capture it first.
   **Both stamps landed on the right rows**: printing the DF01 plan schedule
   alone stamped `printed_at` on it AND on the special order, while the
   unselected DF02 plan schedule stayed null — which is the expanded-set
   stamping, and exactly what stops a printed special order slipping past the
   unschedule guard.
   **Both refusals fired by name** — first "was printed on 2026-08-28", then,
   after a real count entered through 044's definer on the schedule screen,
   "has counted quantities on 1 of 12 lines". Deleting the ORDER while scheduled
   was refused without even opening its confirm.
   The lock was checked for what it does NOT touch as well: no Add item, no row
   drag, no line remove — while the six column-RESIZE grips and "Remove this
   payment" stayed live, which is the rule (view controls and money are not
   what the schedule was built from).
   **One layout bug only the live walk found**: the refusal sentences are whole
   sentences, and as ordinary flex items in `OrderActions`' row one of them
   pushed Duplicate / Flag / Cancel / Delete off the side of the screen.
   `basis-full` puts it on its own line.
   **THE ROLL-UP IS GONE — MIGRATION 069, NEEDS APPLYING** (Mark, 2026-08-27,
   the same day, after seeing the first real one: "don't consolidate lines, even
   if they result in the same donut. Keep each line intact, and be sure to copy
   the notes column"). **ONE ORDER LINE IS ONE SCHEDULE LINE.**
   **The case that settled it was on #7769 all along**, and the walk surfaced it
   an hour after shipping the opposite: its two Mini lines are 50 with a note
   reading "chocolate glaze" and 50 reading "vanilla glaze" — same menu item,
   same cut, same size, and NOT the same thing to make. Rolled up they printed
   as one line of 100 and the decorator was never told half were chocolate.
   **No key over the taxonomy could have fixed that**, because the
   distinguishing fact is free text, which is the whole argument for
   transcribing rather than summarising: the order already says what to make, at
   the grain somebody typed it, and any grain imposed on top can only lose
   something.
   **069 MAKES THE KEY PARTIAL AND TAKES 067's COLUMN BACK OUT OF IT** —
   `unique (schedule_id, item_id) where par_source <> 'special_order'`. HAPPY
   has two P's, so a repeated (item, cut) is now the NORMAL case and no
   uniqueness can apply to these rows at all. 040's rule was always about
   REGENERATION (two rows of one item double the day's par and nothing notices),
   which is a fact about the generator and never about a special order — whose
   lines are written once from a validated payload and which the generator
   refuses to read. With special-order lines exempt, **subtype was doing nothing
   in the key**: `production_day` returns one row per item, so there was never a
   second row for it to separate.
   That also RETIRES 067's own hazard rather than patching it. With subtype in
   the key, renaming an item's subtype made the upsert miss its own row and a
   regeneration left the old line standing beside the new one — measured at 2
   lines and 48 donuts where 24 was right. 069's generator is **040's body byte
   for byte** but for the conflict target gaining
   `where par_source <> 'special_order'` (Postgres will not infer a PARTIAL
   index from a bare `on conflict`, and fails loudly rather than misbehaving if
   you forget). Verified on the harness: the rename case now gives 1 line and 24
   donuts with no special predicate at all.
   **The three line kinds separate cleanly, which is what makes the predicate
   safe**: the generator writes `plan`/`override`, `AddScheduleItems` writes
   `manual`, and only `schedule_special_order` writes `special_order`. Proved at
   the boundary — a second `manual` line of one item is still refused by the
   index, while a second `special_order` line is allowed.
   **`note` now travels** from `special_order_items.notes` onto
   `production_schedule_items.note`, where the schedule's own Note column
   already renders and edits it.
   **AND THE LINES KEEP THE ORDER'S OWN SEQUENCE, WHICH ON A LETTER ORDER IS THE
   WORD.** Sorting by name would turn HAPPY BIRTHDAY VINNY into
   A B D H H I I N N P P R T V Y Y Y — an anagram of the right donuts and
   useless to whoever lays them out. Fixture-pinned by asserting the letters
   join to `HAPPYBIRTHDAYVINNY`, and checked by breaking it (2 red).
   One consequence worth knowing: a credit line no longer cancels its sibling.
   Under the roll-up, +80 and −80 on one (item, cut) summed to zero and the
   whole thing vanished off the sheet; now the credit is dropped on its own and
   the 80 still get made.
   `canonicalCut` survives and its JOB CHANGED: it no longer decides what
   merges, only what the sheet SAYS, so three spellings of A are three lines
   spelled one way. Reverting to the raw cut is one line if that is ever wanted.
   Harness: 20 lines from #7769's 21, in order, the two Minis apart by their
   notes. **1,276 fixtures pass.**
   **Read `docs/special-orders-brief.md` before designing or touching anything
   here, and START AT ITS "Where a next session picks up" SECTION** — that is
   the handoff, and it carries the probes for everything this line claims, what
   4b and 4c each still need, and what test data is on the live database. Its
   CORRECTIONS block comes first: five measurements in the body are wrong,
   because the brief was designed from a `parseInt` reading of `OrderID`.
   **Shipped 2026-08-20/21, phase 4a — THE FRONT DOOR (migrations 057 + 058
   APPLIED, `submit-inquiry` DEPLOYED). *Probe, don't read this line.*** Decision 18: a public
   `/inquiry` form that creates a lead directly, replacing the Square web form
   whose entries a human retyped. Scoped to the form ALONE on Mark's call — the
   build-your-box picker (4b) and the paste-and-parse fallback (4c) are
   separate, because the Square form has no picker either and 4a already
   retires it.
   **THE RPC IS THE GATE AND THE FUNCTION IS THE DOOR**, which is
   `approve_quote_by_token` + `approve-quote` a second time and for the same
   reasons: the page posts once to `submit-inquiry`, which calls
   `create_inquiry` THROUGH THE ANON KEY — so the gate is the same SQL a direct
   caller hits, and the function can create nothing the page could not — and
   only then escalates to `service_role` to read the org's mail config and
   send. `create_inquiry` and `inquiry_shops` are the **third and fourth
   deliberate `anon` grants**, inverting 002's revoke rule in exactly the places
   the brief named.
   **IT NEVER RAISES, AND THAT IS A SECURITY PROPERTY.** 052's lesson: a
   function that errors on some inputs and answers quietly on others is a probe.
   Every refusal is a returned jsonb state. **And the answer is the SAME whether
   the email was already a customer, was new, or was throttled** — decision 18's
   central rule — which `inquiryStateMessage` carries into the UI by wording
   `received` and `created` identically. Broken on purpose in both places: in
   SQL the two answers diverge visibly, in TS a fixture goes red.
   **`create_inquiry` CANNOT CALL `next_special_order_number`** — 051 revokes it
   from `anon` by name and its body demands supervisor+, so it advances the
   sequence itself. Migration 014's footgun in a new costume, and the single
   easiest thing here to get wrong.
   **`lib/createSpecialOrder` COULD NOT BE THE THIRD DOOR**, which the brief's
   handoff had hoped: it takes the CALLER's client so RLS applies, and `anon`
   has no policy on the three tables. The lead's defaults are restated once in
   SQL and the duplication is argued in 057's header. 4c's staff-facing paste
   dialog still goes through it — that is the door the note meant.
   **`sendMail` RETURNS A PROVIDER ID, NOT AN RFC `Message-ID`** (`gmail 19f9…`
   is the message *resource* id), so storing it as decision 12's thread root
   produces something nothing will ever match **and the failure is silent**.
   `Mail` gained an optional **`messageId`** the caller generates, emits and
   stores; `newMessageId` takes the domain from the resolved sender. Rendered in
   Node against both providers: the header carries exactly our string, and with
   the field omitted **no header is emitted at all** — which is why redeploying
   the other three functions is hygiene rather than a requirement, even though
   `_shared` is compiled in at deploy.
   **AN ADDRESS IS NOT EVIDENCE OF DELIVERY** — measured over the three real
   Square submissions, two are PICKUPS carrying an address anyway and the third
   omits the field. Writing it to `delivery_address` unconditionally puts a
   customer's home address on a kitchen document for an order they collect
   themselves; checked by breaking it. All three samples are pickups, so **there
   is no delivery sample** for 4c's parser.
   Also: `customers.source` had no `'inquiry'` value where `special_orders.source`
   did (051 wrote the two checks differently), widened in 057;
   `locations.public_name` is nullable and falls back to `name`, because ours are
   internal ("Donut Friend 01 Highland Park") where Square's form said "Highland
   Park"; abuse is a honeypot decided IN THE GATE plus per-email and global
   hourly caps **counted off `special_orders` itself** (one partial index, no new
   table, no sweeper — the IP is recorded in `source_payload` as evidence, never
   as a key). The org comes from **`NEXT_PUBLIC_ORG_ID`**, a per-deployment
   constant exactly as `NEXT_PUBLIC_APP_URL` is, read on the SERVER so a missing
   value is a sentence rather than a form that fails on submit.
   **The page follows `/q/{token}`, NOT the parts table** — raw inputs, `h-12`,
   `text-[16px]` (the threshold below which iOS Safari zooms on focus). Its two
   `<select>`s are deliberate and noted in the file: that convention is about the
   DESK, and on a phone the platform's wheel picker beats a portalled panel. The
   DATE and TIME go the other way, to `ui/DateField` / `ui/TimeField` with a new
   **`variant="field"`** (`PickList`'s own prop name for the same dense-cell-vs-
   form-box problem), because those carry the fix for Safari painting TODAY into
   an empty date input — on a form whose date starts empty that means somebody
   submitting no date while believing they asked for today. **The rule is not
   "always ours" or "always native": a control carrying a hard-won bug fix is
   never re-implemented.**
   **WALKED END TO END 2026-08-21 against the live database**, through the real
   form. The lead is **#10013**: tax 0.09750 snapshotted from DF01,
   `date_initiated` the org's own day, `created_by` null, and
   **`delivery_address` null on a pickup that supplied an address** — the
   measured rule holding on real data. **The customer MATCHED rather than
   duplicating** (`trombino@mac.com` was already a FileMaker customer), and the
   answer was byte-identical to a create, which is the privacy rule proved on
   real rows. The confirmation sent and **`inbound_message_id` holds the exact
   Message-ID we generated**; a quote emailed afterwards stamped
   `quote_sent_at`, filed its PDF, minted a token, and **left
   `inbound_message_id` unchanged**, so it went out `In-Reply-To` the
   confirmation. The one leg no probe can settle is what the mailbox does with
   it.
   **Four tweaks the same day, all Mark's, after using it:**
   **(a) A NEW INQUIRY ARRIVES FLAGGED** (migration **058**, APPLIED) —
   `flag_reason = 'New Inquiry'`, because a lead that joins 8,330 others as an
   ordinary row is not "easily noticed" and `flag_reason` is what this module
   already has for "look at this one". **The to-do deliberately stays "Respond
   to Email/Call"** rather than the flag path's "Resolve Issue": the flag says
   LOOK AT THIS, the to-do says WHAT TO DO, and "Resolve Issue" describes
   nothing on a lead nobody has read. Known consequence and the intended arc —
   resolving clears both, and `suggestedTodo` then returns "Send Quote", which
   is the actual next step. **It is a separate migration rather than an edit to
   057** (055's rule: 057 is applied, and a file that no longer describes what
   was run is how the harness and production stop being the same database), so
   the function is reproduced in full and changed in exactly two places. The
   argument list is COPIED, not retyped — a changed one would create an
   OVERLOAD and leave 057's version live beside it, which is 033's
   `freeze_pay_period` lesson; the harness asserts `pg_proc` holds ONE row and
   that the grants survived `create or replace`.
   **(b) "Resolve the issue" IS BLACK WHILE FLAGGED** —
   **`PRIMARY_BUTTON_CLASS`**, a shared class rather than an inlined string
   (that file's own history: the red exception was shared while the rule it
   excepts was retyped, and three commands came out three heights). It is
   `DIALOG_COMMIT_CLASS`'s argument applied outside a dialog rather than a
   breach of the black-fill rule: a flagged record is in an abnormal state with
   exactly ONE way out, so this is a commit standing beside no peers. **Only
   ever right CONDITIONALLY** — unflagged, the same slot holds "Flag an issue",
   an ordinary command, and it stays white.
   **(c) THE NOTE FIELDS WEAR BOUNDING BOXES** — `InlineValue`'s new `boxed`,
   which swaps the dotted underline for a border and a `min-h`. The underline
   is the quietest possible "editable" and that is right for a value in a dense
   `dl`, where the LABEL beside it already bounds the field; a column of five
   multiline notes has no such structure, an empty one is a single blank line,
   and a dotted rule under a wrapped paragraph marks only its LAST line — so
   five notes read as five headings with loose text under them. **The SIZER
   wears it too**, or the field jumps the moment you click in, which is the
   same reason the underline was on the sizer in the first place; and the
   read-only branch keeps the box, or the tab looks broken for anyone below
   purchaser+.
   **(d) The interest vocabulary lost "Donut Cake" and "Vegan / Gluten-free".**
   **Shipped 2026-08-21 — THE SETTINGS ARE REACHABLE AT LAST** (Mark: "the
   display names for the shops should be editable on the locations detail page.
   Same with all the email stuff for special orders like what the confirmation
   email says. The user needs a way to set these things"). Design rule 2 had
   always said the business's own words live in `orgs.settings` and never in
   code, and every key did — but the only way to change one was a hand-written
   UPDATE in the SQL editor. **A settings key nobody can reach is a literal with
   extra steps**, which is the rule being honoured rather than merely stated.
   **`/settings` is a real screen now**, replacing the placeholder that had said
   since the skeleton "this is the slot for the screen that will edit them
   properly". It edits `orgs.settings` through `InlineValue`'s `jsonColumn` /
   `jsonPath` — the `locations.address` idiom — in five blocks: the six email
   templates, what the inquiry form says, what the documents say (terms,
   invoice footer, `document_phone`), the timing numbers (rush terms, attention
   thresholds, horizon, inquiry caps), and a READ-ONLY statement of the mailbox.
   **EMPTY MEANS "USE THE DEFAULT", which is why each box's PLACEHOLDER IS the
   default** — `setJsonPath` DELETES the key when a cell is cleared, so clearing
   a template restores the built-in wording rather than sending an empty subject
   line, and the placeholder is also how somebody reads what a message currently
   says before deciding to replace it.
   **THE MAILBOX IS STATED, NEVER OFFERED.** `email_provider` is plumbing: its
   `secret_ref` names an edge secret holding an OAuth refresh token, and its
   `from` must be an address that credential may send as. **Gmail does not
   refuse a `From` it is not authorised for — it silently REWRITES it** — so an
   editable field here would not fail on a typo, it would quietly start signing
   the shop's quotes as somebody else. The block says what is in force and
   points at `docs/po-email-setup.md`.
   **Owner/admin only**, because 001's `org_update` names that pair; below it
   the screen renders READ-ONLY rather than offering a write RLS would accept,
   change zero rows and return no error. Every value is still SHOWN — knowing
   what the shop's quote says is not manager-only, changing it is.
   **THE CONFIRMATION TEMPLATE MOVED TO `special_orders.email.inquiry`**, beside
   the other five, from a key of its own (`inquiry_email`). One editor should
   cover every message the module sends, and a special case is a message
   somebody has to be told about separately. Its default is now MIRRORED in
   `DEFAULT_TEMPLATES` so the screen can show it — the Deno function still holds
   the copy that is actually sent, the same `web/`-boundary duplication
   `send-special-order-email` makes for `STAGE_COLUMN`, flagged at both ends.
   **`submit-inquiry` was REDEPLOYED for the new key** (v2, 2026-08-21) — v1
   looked for the old one, which nobody ever set, so both paths fell back to the
   same built-in text and nothing broke in between.
   **`locations.public_name` is editable on the location record**, in the
   identity `dl` between Code and Kind, with the location's own `name` as the
   PLACEHOLDER — so the cell always says what a customer would see right now,
   whether or not anybody has set it. Mark filled DF01 and DF02 the same day
   ("Highland Park", "DTLA"), and the inquiry form's shop list reads them.
   Verified against the live database and **left byte-identical**: a template
   written through the screen landed at exactly
   `special_orders.email.inquiry.subject`, creating both intermediate objects,
   with **zero drift** in payroll, po_email, billing, timezone or
   email_provider — which is the thing to check whenever a cell writes a whole
   jsonb document, since `setJsonPath` is a read-modify-write over all of it.
   **All 57 migrations replay on the Docker harness and every rule was checked
   by BREAKING it** (see 057's own tail block): as a real `anon`, nine different
   malformed submissions all return states and none raises; the real Victoria Fay
   submission lands as a lead with the tax snapshotted and two log rows; a known
   and an unknown email answer identically; the caps stop the fourth submission;
   three punctuations of one phone number are one customer; an inactive, virtual
   or foreign shop is dropped rather than refused; and with 14 orders really
   present `anon` sees 0, a direct insert is refused by RLS, and
   `next_special_order_number` is permission-denied. **1068 fixtures pass**, 28
   new.
   **Migration 052 is APPLIED and all three edge functions are DEPLOYED**
   (Mark applied 052, 2026-08-17; the deploy was verified the same day).
   *Probe, don't read this line.* For 052:
   `select column_name from information_schema.columns where table_name =
   'special_order_quote_tokens' and column_name = 'document_snapshot'` (1 row),
   and `select public.quote_by_token('nope-nope-nope-nope1')`, which must
   answer `{"state": "unknown"}` rather than raising.
   For the functions, POST an EMPTY body with the anon key — each refuses by
   name from its first statement, which proves the code ran AND that the
   `_shared/email.ts` import resolved:
   `send-special-order-email` → 400 "missing order_id, kind, to, subject,
   pdf_base64 or filename"; `approve-quote` → 400 "missing token or name";
   `send-po-email` → 400 "missing po_id, …".
   Verified deeper the same day: `approve-quote` with a bogus token returns
   **`{"state":"unknown"}`** and with an empty name **`{"state":"name_required"}`**
   — so the gate really is the SQL, reached through the anon key, live; and
   `send-special-order-email` answers **401 "not signed in"** to an anon
   caller and names an unknown document kind at 400.
   **THE specialorders@ CREDENTIAL IS SET UP** (Mark, 2026-08-19, Path A of
   `docs/po-email-setup.md` — its own OAuth refresh token, secret
   `EMAIL_CREDS_SPECIALORDERS`, `orgs.settings.special_orders.email_provider`
   pointing at it). Probe with
   `select settings->'special_orders'->'email_provider' from orgs` — expect
   `kind: gmail`, `secret_ref: SPECIALORDERS`, and a `from` naming
   specialorders@.
   **`special_orders.reply_to` and `document_phone` are deliberately UNSET.**
   The masthead falls back to `email_provider.reply_to` for the address (so a
   configured mailbox names itself — see the 2026-08-18 fix), and to
   `billing.phone` for the number. That means the documents print
   `(213) 908-2743` where FileMaker's print `213 995 6191`. Setting
   `document_phone` is a one-line SQL in the setup doc and Mark has not asked
   for it; do not "fix" it unprompted.
   **`NEXT_PUBLIC_APP_URL` is what the approval link is built on**
   (`https://restaurantfriend.vercel.app`, in `web/.env.local` and in Vercel).
   Without it a quote composed on a dev server carries a `localhost` link that
   works for nobody — the compose card refuses to open rather than let that
   happen, and the send re-checks the link's origin against the `APP_URL`
   secret. **Next inlines it at BUILD time, so a new value needs a dev-server
   restart and a redeploy**, not just a page reload.
   **Migration 051 is APPLIED and LOADED (Mark, 2026-08-17)** — 5,874
   customers · 8,330 orders · 47,827 lines · 6,457 payments · 106,471 log
   entries. *Probe, don't read this line.* Sanity: `select count(*) from
   special_orders` (8,330), `… where standing_order_id is not null` (**0** —
   the migration materializes nothing, decision 13), and `select
   settings->'special_orders'->>'horizon_days' from orgs` (14).
   **VERIFIED IN THE BROWSER against the real data the same day**, which is
   where four bugs were found that typecheck, lint and 943 fixtures all
   passed: see (g). The headline result is that **order 9885 derives
   $147.40 / $14.37 / $161.77 — matching FileMaker's own sent quote PDF to the
   cent**, with no stored total anywhere. That is decision 6 proved against a
   document a customer received.
   It was also HARNESS-VERIFIED before it was applied: all 51 migrations apply on the Docker stub; as real
   authenticated roles a supervisor reads 8,330 orders / 47,827 lines / 6,457
   payments / 5,874 customers while **a staffer reads 0 of each and an UPDATE
   changes 0 rows with NO error**; `anon` cannot execute
   `next_special_order_number` and a staffer is refused by name from inside it;
   the storage policies pass 018's own three tests. Every constraint was checked
   by breaking it, including that **a CANCELLED wholesale day still blocks
   re-creation**. **The whole real export was then replayed through the real
   constraints, and that is what found the one real bug** — see (f) below.
   Also shipped: the
   transform/load pair, `lib/specialOrders.ts` + 56 fixtures, `/special-orders`
   + its record, and `/customers` + its record. See the brief's build-phase list
   for exactly what each contains.
   **THE FIVE THINGS TO KNOW BEFORE TOUCHING ANY OF IT:**
   **(a) `special_orders.number` IS TEXT.** `2899-01`, `3932 cont.`, `5689a`,
   `5542b`, `7220a` are real FileMaker order numbers a human suffixed to split a
   job; an integer column rounds every one into a collision with its unsuffixed
   sibling. Over the raw strings exactly ONE number repeats — `6002`, twice, and
   they are DIFFERENT ORDERS — so both migrate and `legacy_seq` records the
   collision (028's `source_row_key` lesson, on the one row that needs it).
   **(b) THE MONEY HAS NO COLUMN AND MUST NEVER GET ONE.** There is no subtotal,
   tax, total or balance on `special_orders`; `orderTotals` derives all of them
   from the lines, the payments and six stored INPUTS on every read. FileMaker
   stored them TWICE, by era (`Order_Subtotal` and `Order_Subtotal2`), which is
   how they drifted — and yet **only 50 of its 8,330 orders now fail to
   reproduce their own stored subtotal from their own lines**, which is the
   measurement that says the model is right. Two arithmetic decisions inside it
   a rewrite could plausibly flip, both fixture-pinned: **the discount comes off
   BEFORE tax, proportionally across the taxable and non-taxable parts** (taxing
   the undiscounted amount charges sales tax on money nobody paid), and
   **delivery and rush are NOT taxed** (the real 9885 invoice computes tax on
   the item subtotal alone). The immutable copy of a quote is the PDF that was
   sent, filed as an attachment — decision 17's whole mechanism.
   **(c) `status` IS NULL EXACTLY WHEN `kind` IS NOT `order`** — the brief's
   open question 2, answered as a BICONDITIONAL check rather than a default. So
   "does this record have a status" and "is this record an order" are the SAME
   question and the app cannot get two answers. A template with status `lead`
   would be a claim about a workflow it is not in, and every list filter would
   have to know to ignore it. Consequence: the record screen shows the status
   picker only for `kind = 'order'` — offering it otherwise offers a write a
   CHECK refuses, which is the one refusal `InlineValue` cannot explain.
   **(d) A `Misc*` LINE IS MONEY, NOT PRODUCTION, and an UNTYPED line is
   PRODUCTION.** `isProductionLine` is prefix-insensitive (the data holds `Misc`
   495 times and `Misc- Cupcake liners` once) and the fallback direction is
   load-bearing: 569 real lines carry no type, they are ordinary donuts, and
   treating an unclassified line as money would silently drop it off the kitchen
   sheet. `unschedulableLines` names decision 9's blockers — a production line
   with no `production_item_id` — because `production_schedule_items.item_id` is
   NOT NULL and must stay so.
   **(e) `menuItemKey_n` IS A PRODUCTION ITEM ID, checked rather than assumed.**
   The brief expected FMP's retired MenuItems catalog; instead 20,518 of 20,561
   keyed lines resolve, and over those the line's donut name agrees with the
   item's on 19,482 while the SIZE agrees on 19,497 of 19,520. The 1,015
   name disagreements are the feature working — "DIY", "Custom", and a product
   renamed from "(x9)" to "(x12)" — which is decision 5's customized copy. So
   **twelve years of history carries `production_item_id` and is schedulable**,
   which decision 9 assumed only new lines would be.
   Two smaller things worth not rediscovering: **`Notes_Invoice` is boilerplate**
   ("We appreciate your business!" on 8,052 of 8,060 rows) and lives in
   `orgs.settings.special_orders.invoice_footer`, not on eight thousand orders;
   and **`todo` is empty on 8,233 of 8,334 rows** and its real values include
   "OH HOLD" and "No need to print *page 2*", so decision 4's `allowNew` is
   load-bearing and this column must never become a check constraint.
   **(f) THERE IS NO `check (qty >= 0)` ON A LINE, and putting one back breaks
   the load.** It was there, and replaying the real export on the harness failed
   partway through 47,827 inserts: three lines carry a NEGATIVE quantity and
   they name themselves — `short s'morrisseys` (-80), `short (dropped bin)`
   (-30), `short donuts (quality issues)` (-26). That is how this shop credits a
   customer for what it failed to deliver, and two of the three are recent. It
   was also incoherent with the column beside it, since `unit_price` has no
   check and six real lines use a negative one ("Tasting Discount",
   "Wedding Sampler Discount", -$248.50) — the same idea expressible one way and
   refused the other. 024's lesson, found the same way: a statement true about
   finished data is still wrong as a constraint.
   **(g) FOUR BUGS THAT ONLY RENDERING FOUND**, all fixed, and each one a
   class worth knowing:
   · **A controlled `DataTable` IGNORES `defaultSort`** (`sort = controlled ?
   controlledSort ?? null : …`), and a null controlled sort renders rows as
   given — so the work queue opened on the server's `event_date DESC` with
   December at the top and TODAY at the bottom. A list that owns its sort needs
   a `NATURAL_SORT` it passes down; the `sort` STATE stays null so the URL
   keeps one canonical address.
   · **A `FilterMenus` dimension with a `defaultValue` needs a real token for
   "no filter"** — `lib/filterMenus` says so and `/recipes` writes `?tier=all`.
   Without it "All orders" wrote no parameter, so a round trip silently put you
   back on Upcoming. Known cost: the menu now shows two entries reading "All
   orders", the bar's own and the real token.
   · **A `time` column reads back as `10:00:00`**, and the list formatted it
   while the record didn't. `format` is a FUNCTION, so a server component
   cannot pass it — hence `specialOrders/TimeCell`, a client cell.
   · **The customer record counted STANDING ORDERS as unpaid.** A recurrence
   carries lines and no payments, so it always derives a balance: the record
   claimed Cafe Knotted owed $1,738.50 while the list, which does check
   `kind`, said nothing was owed. Two screens disagreeing about one customer's
   money is the tell.
   And a measuring trap: **check the label SPAN, not the button around it** —
   a button sizes to its own content and can never report an overflow, which is
   how two clipped column headers survived a check that said everything fit.
   **PHASE 3 IS DONE — the documents, the email and the public approval page,
   LIVE AND WALKED END TO END** (2026-08-19/20). 052 applied, all three
   functions deployed, the specialorders@ credential set up, and the whole loop
   exercised against real customers by Mark. Nothing here is outstanding.
   Five documents from three renderers
   (`components/specialOrders/pdf/SpecialOrderPdfs.tsx`): quote · invoice ·
   receipt are ONE layout at three moments, the kitchen order is its own
   (no money at all, grouped by SIZE CLASS, the customized name over the full
   taxonomy), and the statement is decision 21's. `SignedQuotePdf` is an
   ADAPTER over the first, not a fourth renderer — the artifact a customer
   signed has to BE the paper they read.
   **VERIFIED BY RENDERING against FileMaker's own four PDFs for order 9885**,
   in Node over the live rows (the recipe-sheet pattern, which the brief made
   this phase's acceptance test). The money reproduces to the cent — $147.40 /
   $14.37 / $161.77 — and the render found FOUR bugs a code review would not
   have:
   the transform was **eating the letter-cake notes** (`text()` stripped a
   wrapping pair of quotes, written for `"DeliverLA"`; the note on a letter
   order IS `"W"`) — fixed, and `migration/backfill-special-order-notes.mjs`
   HAS RUN, restoring **4,617 line notes and 384 orders**, idempotent;
   the masthead **printed the date twice**, because Mark's titles routinely end
   with it, which is why FileMaker prints the title alone there;
   **@react-pdf hyphenates by default**, breaking a customer's address into
   `alexlan-dayan@gmail.com` (a no-op callback is registered at module scope —
   it is GLOBAL to the renderer, so per-document would be a second place to
   forget); and a **`fixed` table header repeats onto a page holding only the
   totals**, so the financial documents' header is not fixed while the kitchen
   sheet's is.
   Two departures from the reference, both deliberate: the quote's terms and
   signature print AFTER the totals rather than at the foot of page one
   (nobody signs a figure they have not reached), and the reference invoice's
   **TOTAL DUE $0.00 on an unpaid $161.77 quote is wrong** — that is the
   stored-total drift decision 6 exists to end, and ours derives $161.77.
   **THE PROVIDER LAYER MOVED TO `supabase/functions/_shared/email.ts`**, which
   is the change most likely to bite: `_shared` is compiled into each function
   at DEPLOY time, so **`send-po-email` must be redeployed too** or it keeps
   running the old copy (harmless, but it never gets the threading headers).
   `send-special-order-email` sends **as specialorders@** — decision 12, and
   the reason it needs its own credential is that **Gmail does not refuse a
   `From` it is not authorized for, it silently REWRITES it**, so the send
   looks like it worked and the reply goes to info@. Resolution is
   org-module → org → app default with **no location tier**: a PO belongs to a
   shop, a customer's quote is the org's letter.
   The send does FOUR bookkeeping writes after the mail is out — stage date,
   log entry, a filed copy of what was sent, and binding decision 17's token —
   and **none of them may turn a sent email into a failure**; they come back as
   warnings on a 200, or somebody sends the quote twice.
   **DECISION 17'S TOKEN IS MINTED WHEN THE COMPOSE CARD OPENS, WITHOUT A
   SNAPSHOT**, so the link in the draft body is a real URL the human can read
   and edit — and a compose that is CANCELLED leaves a token that shows
   nothing, because `quote_by_token` reads a snapshot-less row as `unknown`.
   The snapshot is written BEFORE the send, not after: a live link nobody has
   been given is harmless, where a link the customer HAS that says the quote
   does not exist is not.
   **Migration 052 adds `document_snapshot` and the two anon RPCs.** The
   snapshot is a COLUMN because money is derived live, so the order can change
   after a quote goes out — and because a definer function cannot mint a
   signed URL for the PDF in the private bucket. What makes the public route
   sound is not the entropy, it is what the token can REACH: `quote_by_token`
   reads ONE row of ONE table and touches neither `special_orders` nor
   `customers`; `approve_quote_by_token` writes the approval, one date and one
   log row. Both are granted to `anon` DELIBERATELY, inverting 002's revoke
   rule in exactly two places. Neither ever RAISES on a bad token — an error
   where an empty answer belongs is how you let somebody probe which tokens
   exist.
   `/q/{token}` is exempt in `proxy.ts` (verified signed out: 200, where
   `/special-orders` 307s to /login). **Reading is safe and APPROVING is the
   act** — the opposite of `/welcome`, whose token is spent by verification and
   must therefore never be touched on load. The signed PDF is rendered in the
   CUSTOMER's browser and posted to `approve-quote`, which is the only place it
   can be: @react-pdf needs a DOM and the customer cannot write to a private
   bucket. A render failure does NOT block the approval.
   `approve-quote` is the one function here with no signed-in caller. Its gate
   is the RPC, called with the ANON key so the check lives in SQL and it can
   approve nothing the page could not; only then does it use `service_role`,
   and every write is scoped to an `order_id` that came back FROM the check
   rather than from the request body.
   The compose card is a PICKER PLUS TWO VERBS (Document ▾ · Preview ·
   Download · Email…), not FileMaker's nine cells — the question is "which
   document", then "look at it" or "send it".
   Also shipped: the **attachments card** (decision 14 — pics and documents
   merged, `signed_quote`/`picture`/`document` pickable while
   `quote_document`/`invoice_document` are only ever produced by the app, so
   nobody can file a document as having been sent when it wasn't), which
   OFFERS the `quote_returned` stamp rather than forcing it; and the
   **statement** (decision 21) on the customer record, defaulting to LAST WEEK
   Monday–Sunday — "last week", not "the last seven days", because two
   consecutive statements must neither overlap nor leave a day out.
   **967 fixtures pass**, 24 new, each rule checked by breaking it — and the
   break-check earned its keep: `usDate` written through `new Date()` really
   does print **8/15** for 8/16 west of Greenwich, which on a quote is
   somebody's wedding on the wrong day.

   **(j) THE CREATE PATH HAD THREE HOLES, and the one that surfaced was the
   one a second COLLEAGUE opened** (Mark, 2026-08-18). `NewSpecialOrder`
   resolved the org with `from("org_members").select("org_id").maybeSingle()`
   and NO filter — but 001's `members_read` policy shows you every member of
   your org, so that returns one row per member. Correct with one member,
   "JSON object requested, multiple (or no) rows returned" with three. **A
   create that only ever ran while the org had one person is a create nobody
   has tested**, which is design rule 1's lesson in a second costume. Swept:
   this was the only unfiltered `.maybeSingle()` on that table; every other
   caller either filters by `user_id` or wants the whole list.
   Fixing it surfaced two more, both invisible until then because the crash
   came first:
   **the pickup shop was never asked for** — the form offered only the KITCHEN,
   so decision 8's other half was null and the quote printed no LOCATION while
   the Items tab priced at the org grid rather than the selling shop;
   and **`tax_rate` was never written by anything**. 051 calls it "snapshotted
   from the pickup shop, editable" and every reference in `web/src` was a
   SELECT, so an order created in the app derived ZERO TAX on a document a
   customer pays from. Measured before fixing: **0 app-created orders exist**,
   so nothing was corrupted — the crash had been preventing the very rows that
   would have carried the bug.
   All three are fixed in ONE place, `lib/createSpecialOrder.ts`, because there
   are TWO doors — the list's New special order and the customer record's New
   order for them — and each had a different subset of the truth, which is how
   this survived. **Pickup defaults to the shop you are standing in and the
   kitchen deliberately does not**: an order taken at DF01 is usually collected
   there, while which kitchen bakes it is decided later. The tax rate comes
   from the PICKUP shop because sales tax is charged where the goods change
   hands, and a null rate stays NULL rather than being defaulted to a number
   invented in code — the record's own Tax rate cell is right there.

   **WALKED ON REAL DATA, 2026-08-19/20, and the residue is the proof.** Order
   **#9877** carries three quote tokens and the whole of decision 17's design
   showing through:
   · **two sends succeeded** and the log names both by provider id
     ("Quote emailed to trombino@mac.com · gmail 1a01…"), each filing its own
     `quote_document`;
   · **the earlier tokens are SUPERSEDED** and only the newest was approvable —
     which is the rule that stops a customer signing a price you have revised;
   · **the approval came through the public page**: `approved_name`
     "mark trombino", `quote_returned_at` stamped by the RPC, and a
     `signed_quote` PDF filed — rendered in the CUSTOMER's browser and uploaded
     by `approve-quote`, which is the one path that cannot be tested any other
     way.
   · **And the FIRST token has a snapshot but no PDF and no log entry** — that
     is the failed send from the credential bug, behaving exactly as designed:
     the snapshot is written BEFORE the send, so a send that throws leaves a
     live link NOBODY HAS BEEN GIVEN (no email went out), and the next send
     superseded it. If that ordering is ever "tidied up" to write the snapshot
     after the send, the same failure instead leaves a link the customer HOLDS
     saying the quote does not exist.
   **Deliberately left in place**: those 4 tokens, 3 attachments and order
   #9877's stage dates are Mark's real test and the evidence above. The only
   app-created order is **#10000** ("test order"). Everything Claude created
   while verifying was deleted.

   **(n) THE ORDER STARTS KNOWING FOUR THINGS IT USED TO HAVE TO BE TOLD, and
   the ITEM stopped being read-only** (Mark, 2026-08-19, four notes in one).
   **A CUSTOMER'S DETAILS BECOME THE ORDER'S DAY-OF CONTACT.** They are two
   different facts — `customers` is who the order BELONGS TO, `contact_*` is
   who to ring on the day, which on a corporate order is whoever is running the
   party and is why (m) stopped asking for it — and they are the same fact nine
   times out of ten. Seeded once in `createSpecialOrder`, per FIELD ("if it
   exists"), never slaved: editing the customer next month must not rewrite who
   to call about an order already quoted. Both doors get it because the read
   lives in the shared creator, which is what that module exists for — the
   customer record has the row on screen and the list's picker has only a
   label. `contactNameFor` leads with the PERSON where `customerLabel` leads
   with the company: "Cafe Knotted (Jane Doe)" is not somebody you ask for on
   the phone. **`date_initiated` IS WRITTEN AT LAST** — the date the quote's
   signature band prints and the head of the completion dates, and nothing had
   ever set it, so every app-made order carried a blank where all 8,330
   migrated ones carry FileMaker's `Date_Created`. It takes the ORG's calendar
   day (`lib/today`, passed in — both callers already held it), and the live
   test proves why: a real create at 04:16 UTC wrote **2026-08-19** while
   `created_at` says 2026-08-20, so a browser clock or a UTC host would have
   dated it tomorrow.
   **THE ADD-ITEM PANEL'S `Done` IS BLACK** ("a real black button") — the
   panel-commit exception rather than a breach of it, the receiving screen's
   `Complete` argument: the chooser produces ONE outcome and Done is the only
   way out of it, so it is a commit standing beside no peers. It had been an
   underlined phrase, which gave the control that closes the thing less weight
   than the Add button on every row.
   **THE FIVE TAXONOMY FIELDS ARE EDITABLE** ("We need to be able to edit the
   fields of an item after it has been added"). Donut · type · cut · finish ·
   size were plain text, so the fields that decide what the KITCHEN DOCUMENT
   says were the only ones on the row nobody could correct — and they are the
   likeliest to need it, arriving as a snapshot of a menu item that is only
   approximately the thing being ordered. Same line, same `·` separators, each
   a `PickList` over the live menu's own distinct values with `allowNew`.
   **THE LETTER IS THE CUT** ("If the item is a letter donut, the app should
   allow the user to select the cut that represents the actual letter"), and
   that is a measurement: FileMaker put the character IN the cut, so of the
   9,926 migrated letter lines 8,991 read `Letter - "A"` — the canonical
   spelling `letterCut` writes, against `Letter "A"` and `Letter. "A"`, which
   `cutLetter` reads but never writes. So an option's VALUE is the composed cut
   and choosing the letter IS choosing the cut; nothing is composed at write
   time. The character set is the real one — all 26 letters, all 10 digits, and
   `<3` (277 lines), `!` (160), `+`, `&`, `?`, `-`; rarer ones (`OP`, `AB`, one
   line each) are why `allowNew` stays. **The letter group appears ONLY on a
   letter line**, where it LEADS (it is what you opened the list for) and the
   letter-family subtypes come out of the cuts beneath it, or the same donut is
   offered twice under two spellings. A BARE `Letter` IS A REAL STATE, never
   inferred — 935 lines are an order for letters whose word nobody has settled
   — so it stays pickable and the row says "(no letter yet)" in the mark
   colour. A chosen letter renders as the character alone under a static
   "Letter", because `Letter - "D"` in a row of five values is four words of
   packaging around the one that matters. `lib/specialOrderLines`, 21 fixtures,
   each rule checked by breaking it. Verified against real order **#7769**,
   which spells HAPPY BIRTHDAY VINNY: 21 lines, every character ticked in its
   own picker, and the order left as found.
   **(p) TWO LABELS AND A DEFAULT** (Mark, 2026-08-19). "What it is" is
   **Order name** and "How it leaves" is **Pickup / delivery** — both were
   descriptions of a field rather than names for one, which reads fine once and
   badly every day after. And **`taken_by` seeds from whoever creates the
   order** ("the name of the employee who started/initiated the order"), through
   `createSpecialOrder` so both doors agree. It is a SNAPSHOT OF A NAME and not
   a link to a user, which is the column this schema already has: FileMaker's
   holds "Traci", and 8,330 migrated orders name people who mostly no longer
   work here. It stays free text and editable — the order taken over the phone
   by somebody who then hands it to you is a real thing. Verified live: a real
   create wrote `taken_by: "Mark"` where the order made an hour earlier carries
   null.

   **(q) THE ORDER'S HISTORY WRITES ITSELF, AND "TAKEN BY" IS A LINK
   (migrations 053 + 054, BOTH NEED APPLYING).** Mark, 2026-08-19: "no edits I
   make to my test order are getting logged as events in the history section. Is
   that still to come?" — and it was never built. `special_order_events` had
   four writers and all four were ACTS on a screen (a document emailed,
   paperwork filed, an order flagged, a note); nothing watched the RECORD, so
   changing an event date, a price or a quantity left no trace.
   **FILEMAKER LOGGED FIELD EDITS AND WE DID NOT** — measured over its own
   106,465 entries, more than half the top shapes are column changes: "Order
   Type set to Quote" 8,045 · "Order To Do cleared" 4,792 · "Order Taken By
   changed to Traci" 3,457 · "Changed Event Date to …" 1,434 · "Delivery Charge
   changed to …" 1,262. So this is a missing half rather than a new idea. What
   IS new is **the lines and the payments**, which FMP never logged and Mark
   asked for ("adding/editing/removing items was absent from FMP and would be
   nice to have").
   **IT IS A TRIGGER**, which is design rule 6's own words for the catalog
   ("logged automatically by DB triggers — don't log in app code") and is here
   because there are already four ways an order changes — inline cells, two edge
   functions, `approve_quote_by_token` — so app-side logging has to be
   remembered in each, and the day it is forgotten looks exactly like the bug
   reported.
   Four decisions inside it, each of which the obvious version gets wrong.
   **ONE ENTRY PER STATEMENT, not per column**, so a three-column edit is one
   sentence — which also settles double-entry by construction. **`sort` IS NOT
   WATCHED**, and that is the omission that would flood the log: one drag
   renumbers the WHOLE list, 21 rows on a real order. **NOR ARE THE STAGE
   DATES**, which are set by acts that already write their own entry, so
   watching them would print each send twice. And **A UUID IS RESOLVED** —
   locations to their code, the customer and the employee to a name.
   **IT IS `security definer`, WHICH IS 001's ANSWER TOO** (`log_price_change`
   and its three siblings). Written plain first, and the harness said no twice:
   the writer calls `auth.uid()`, and the renderer reads `employees`, which 020
   gates to owner/admin — so a SUPERVISOR's edit would have logged "a record
   that no longer exists" where the taker's name belongs. What a definer opens
   is a DIRECT call, so **execute is revoked from `authenticated` rather than
   granted**; a trigger's permission is checked when it is created, not when it
   fires. Verified: `anon` AND `authenticated` are both refused the writer.
   Consequence that landed in the same commit: `OrderActions` stopped writing
   "Order cancelled", "Flagged: …" and "Issue resolved", each of which the
   trigger now says with more in it. Its `log()` helper is gone entirely — the
   one entry left is `Duplicated from order N`, a fact with no column anywhere.
   **AND `taken_by` IS A LINK (053).** `taken_by_employee_id` references
   `employees`, `on delete set null` (023 lets an owner delete a typo, and an
   order must not go with them). The roster comes from
   **`special_order_takers`**, a definer returning id and name only — 044's
   `production_operators` applied a second time, and a SECOND narrow function
   rather than a general one because 044 says why in as many words. It differs
   in being scoped by ORG, not location: whoever answered the phone is not a
   fact about a shop.
   **HISTORY IS DELIBERATELY NOT BACKFILLED, and the check is why.** A first
   pass said 98.7% of the 7,944 legacy names "resolve to an employee"; that was
   first-match-wins over 445 people. Checked properly, **2,386 (30%) match MORE
   THAN ONE** — mark → two, adam → three, amanda → five, sarah → four. A
   backfill would have attributed 558 orders to whichever Adam sorted first and
   said nothing about it. So the text column stays, the link is null on every
   migrated row, and the cell renders whichever it has — a link where we know,
   plain text where we only roughly do.
   **053 AND 054 ARE APPLIED** (Mark, 2026-08-20). *Probe, don't read this
   line*: `select taken_by_employee_id from special_orders limit 1` (present),
   and `select public.special_order_takers('00000000-0000-0000-0000-000000000000')`,
   which answers **"Not your organisation"** to a service_role script — that is
   migration 014's footgun and is what proves the function exists AND that its
   guard runs. The triggers only show themselves by FIRING, so look for an entry
   no app code writes: any message beginning "Order started" or containing
   "changed from".
   **055 IS APPLIED** (Mark, 2026-08-20) and the whole chain was walked live the
   same day: a real create through "New order for them" logged **"Order started
   as a lead"**, picking from the roster set the link, cleared the text and
   logged it as one entry, and the Notes tab's History rendered both with author
   and date. The order was then deleted, leaving 8,330.
   **055 adds the entry for the order EXISTING.** 054 watched
   UPDATE only, so a brand-new order had an empty history until somebody edited
   it — which reads as the logging not working rather than as nothing having
   happened yet. FMP wrote one ("Order started by tracit", 3,482 times).
   **It is a separate migration rather than an edit to 054, and that is the rule
   worth keeping**: 054 is applied, and once a migration has run it is history —
   a file that no longer describes what was run is how the harness and
   production quietly stop being the same database. 054 IS rerunnable, so
   re-pasting it would have worked; the ledger is the reason not to.
   The trigger has to be RECREATED, not just the function: `create or replace`
   on a function does not widen the events its trigger fires on.
   **056 IS APPLIED** (Mark, 2026-08-20) and the whole log was walked live
   afterwards on a throwaway order, one path at a time: create → "Order started
   as a lead"; pick from the roster → **"Taken by set to Mark Trombino"**, one
   line, which is 056 working; a title edit → "Order name changed from … to …";
   add a line → "Added 12 × Angry Samoa"; edit its quantity → "Angry Samoa —
   quantity changed from 12.00 to 24.00"; remove it → "Removed 24 × Angry
   Samoa". Order deleted afterwards, leaving 8,330 and 47,819 lines.
   Known cosmetic residue, NOT fixed: a numeric column renders through
   `to_jsonb`, so a quantity reads **"12.00"** rather than "12". Trimming
   trailing zeros generally would turn money into "5.1", which is worse, so the
   fix is per-column in `special_order_value_label` and is a migration nobody
   needs today.
   **056 makes "Taken by" report as ONE field.** Found by using
   it minutes after 055 went in: picking somebody from the roster writes both
   halves in one statement — the link set, the superseded text cleared — and
   both carry the label "Taken by", so the entry came out **"Taken by cleared
   (was Mark); Taken by set to Mark Trombino"**. Every word true, and it reads
   like a glitch on the commonest edit this field will ever see. The text half
   is suppressed WHEN THE LINK MOVED IN THE SAME STATEMENT and only then —
   editing the legacy text on one of the 7,944 orders that has no link still
   logs "Taken by changed from Traci to Levi", which is the case where that text
   IS the answer. Both pinned on the harness. Nothing but the function changes;
   055's trigger already fires on insert and update.
   Known gap: **the CREATE still seeds only the text.** Resolving the signed-in
   member to their employee row needs `employees.user_id`, which a supervisor
   cannot read — a third definer, not built. Pick the person on the record.
   **057 AND 058 ARE APPLIED** (Mark, 2026-08-21) — the inquiry form and its
   auto-flag. *Probe, don't read this line*, and there are two that matter.
   `select public.create_inquiry(null, 'A Name')` must return
   `{"ok": false, "state": "unknown_org"}` — an ANSWER, not an error, which is
   the property the whole public surface rests on; and
   `select count(*) from pg_proc where proname = 'create_inquiry'` must return
   **ONE**, because two would mean 058's argument list drifted from 057's and
   both versions are live (033's `freeze_pay_period` trap). Also
   `select public.inquiry_shops(null)` → `[]`, and `locations.public_name`
   selects, with DF01/DF02 reading "Highland Park" / "DTLA".
   **`submit-inquiry` is DEPLOYED at v2** — v1 read the confirmation template
   from `special_orders.inquiry_email`, v2 from `special_orders.email.inquiry`
   beside the other five, which is what `/settings` edits. `send-po-email`,
   `send-special-order-email` and `approve-quote` still run the pre-`messageId`
   `_shared/email.ts` (last deployed 2026-08-19) and that is FINE, verified
   rather than assumed: the field is optional and none of them passes it, so no
   `Message-ID` header is emitted and Resend's `headers` object stays
   `undefined`, exactly as before.

   **059 IS APPLIED** (Mark, 2026-08-21 — purchase requests). *Probe, don't read
   this line; it has been wrong in both directions for four different
   migrations.* Three probes, because it does three distinguishable things:
   `select column_name from information_schema.columns where table_name =
   'purchase_requests' and column_name in ('priority','resolution_note',
   'inventory_item_id','resolved_at','dismiss_reason')` — expect the first four
   and NOT `dismiss_reason`; `select polname from pg_policy where polrelid =
   'public.purchase_requests'::regclass` — **four** rows, the new one being
   `preq_author_update`; and `select conname from pg_constraint where conrelid =
   'public.purchase_requests'::regclass and contype = 'c'` — includes
   `purchase_requests_reason_when_dismissed`.
   It had to be applied BEFORE deploying, which is the opposite of 012's order:
   the new screen SELECTS these columns, so a deploy in front of the migration
   400s the whole select and the list renders its "migration 059 has not been
   applied yet" sentence rather than a queue. It is NOT rerunnable — the rename fails a
   second time, which is the signal it already ran — and all-or-nothing, since
   a partial run dies on that rename before it reaches the constraint, the
   policy or the index.

   **067 AND 068 ARE APPLIED** (Mark, 2026-08-27 — scheduling a special order's
   production), and the whole loop was WALKED on the real #7769 the same day and
   left exactly as found. *Probe, don't read this line; it has been wrong in both
   directions for four different migrations.* For 067, three probes because it
   does three things:
   `select conname from pg_constraint where conrelid =
   'public.production_schedule_items'::regclass and contype = 'u'` — must NOT
   include `production_schedule_items_schedule_id_item_id_key`;
   its own index `production_schedule_items_line` is GONE and probing for it
   today proves nothing — 069 dropped it and 096 narrowed its successor, so what
   survives of 067 is the dropped constraint above and the fact that the table
   is keyed by an INDEX at all (`production_schedule_items_generated_line`;
   see 096 for the predicate it should carry). This clause said "must include
   `production_schedule_items_line`" from 2026-08-27, when 069 made it false,
   until 2026-09-07 — which is the file's own warning about probes coming true.
   Then `select count(*) from pg_proc where proname =
   'generate_production_schedules'` — must be **ONE**, because two means the
   argument list drifted and 040's version is live beside it (033's
   `freeze_pay_period` trap).
   For 068: `select public.schedule_special_order(null, null, null, null, null)`
   must raise **"no order given"** from its first statement, and
   `select public.unschedule_special_order(null)` the same, which proves the
   code ran; and `select count(*) from production_schedules where source =
   'special_order'` — 0 until somebody schedules one.
   067 must go FIRST: 068's insert relies on the widened key. Neither is
   rerunnable — 067's `drop constraint` fails a second time, which is the signal
   it already ran.

   **069 IS APPLIED** (Mark, 2026-08-27 — a special order's lines stop being
   rolled up), and it was VINDICATED on his own data within the hour: he
   scheduled two real orders, and **#9886 is two rows differing only by their
   note — 18 "Vanilla glaze with gold dust sprinkles" and 18 "Maple glaze with
   gold dust sprinkles", same item, same cut, same size.** Under the roll-up
   that was one line of 36 Custom Mini and the kitchen made whichever it
   guessed. *Probe, don't read this line.* The one that matters is the key's
   shape, because everything else here follows from it:
   `select indexname, indexdef from pg_indexes where tablename =
   'production_schedule_items' and indexname like '%line%'` — expect ONE row,
   `production_schedule_items_generated_line`, and NO
   `production_schedule_items_line`. **Its PREDICATE is 096's now, not 069's**:
   `WHERE (par_source = ANY (ARRAY['plan'::text, 'override'::text]))`, which is
   the narrowing that let a plan line be duplicated. 069's own
   `WHERE (par_source <> 'special_order'::text)` is what this probe expected
   between 2026-08-27 and 2026-09-07, and finding it today means 096 has NOT
   been applied. Then
   `select proname, count(*) from pg_proc where proname in
   ('generate_production_schedules','schedule_special_order') group by 1` —
   **1 each**, or an argument list drifted and an overload is live beside it.
   NOT rerunnable: `drop index production_schedule_items_line` fails a second
   time, which is the signal it already ran.

   **075, 076, 077 AND 078 ARE ALL APPLIED** (Mark, 2026-08-29/30 — facility
   checks). *Probe, don't read this line; it has been wrong in both directions
   for four different migrations.* Four probes, because they do four things:
   `select count(*) from equipment` and `… from location_tasks` (075's tables);
   `select polname, polcmd from pg_policy where polrelid =
   'public.location_tasks'::regclass` → **THREE** rows and NO delete, or
   somebody added an eraser that bypasses the reason;
   `select id, public from storage.buckets where id = 'facility-photos'` → one
   row, public **FALSE**, since a public bucket here is a data leak; and 078's
   `select column_name, is_nullable from information_schema.columns where
   column_name in ('guidance','position') and table_name in
   ('checklist_template_items','checklist_run_items')` → **FOUR** rows, every
   one YES.
   The one that would be SILENT if it broke is 076's empty-array refusal, which
   is what was wrong first:
   `insert into checklist_templates (org_id, location_id, kind, name, weekdays)
   select id, (select id from locations limit 1), 'checklist', 'x',
   '{}'::smallint[] from orgs limit 1;` must **ERROR**. If it inserts, the check
   is using `array_length` again — which returns NULL for an empty array, and a
   CHECK passes on NULL.
   Order is load-bearing: **075 → 076 → 077 → 078**. 076's
   `checklist_run_items.task_id` references a table 075 creates, 077's photos
   reference both, and 078 alters 076's tables. None is rerunnable.

   **060 IS APPLIED** (Mark, 2026-08-22 — the request's details box).
   *Probe, don't read this line.* `select column_name, is_nullable from
   information_schema.columns where table_name = 'purchase_requests' and
   column_name = 'details'` — expect one row, `YES`. One nullable column, no
   policy and no constraint, so nothing else moves. Same order as 059: it had to be applied
   BEFORE deploying, since the list selects the column; until it was, the
   screen said so in the same sentence. A SEPARATE FILE rather than an edit to
   059 because 059 is applied — 055's rule, that a migration which has run is
   history and a file no longer describing what was run is how the harness and
   production stop being the same database.

   **061 AND 062 ARE APPLIED** (Mark, 2026-08-22 — the per-employee workday
   start, and the paycheck that stopped following it). *Probe, don't read this
   line.* For 061, three things, because it does three:
   `select column_name, data_type, is_nullable from information_schema.columns
   where table_name = 'employees' and column_name = 'workday_starts_at'` (one
   row, `time without time zone`, `YES`);
   `select conname from pg_constraint where conrelid = 'public.employees'::regclass
   and contype = 'c'` (includes `employees_workday_start_is_afternoon`); and
   `select count(*) from employees where workday_starts_at is not null` — **11**
   today, the back-of-house crew, all `14:00:00`. The constraint bites through
   PostgREST as well as in SQL, so an app write of `03:00` or `14:00:30` is
   refused by name rather than rounded.
   For 062 the trigger only shows itself by FIRING, so probe the invariant it
   maintains rather than the function:
   `select count(*) from timesheets t join pay_periods p on p.id = t.pay_period_id
   where t.business_date not between p.start_date and p.end_date` (**0**);
   `select count(*) from timesheets where pay_period_id is null` (**0**); and
   `select count(*) from timesheets where workday <> business_date` (**24** —
   the kitchen's evening shifts in the 08-03→08-16 pay period, the first rows in
   seven years where the two columns differ at all).
   Note 062 is RERUNNABLE where 061 is not, and its backfill is a no-op once the
   invariant holds — verified by running it twice on the Docker harness.

   **070, 071, 072, 073 AND 074 ARE ALL APPLIED** (Mark, 2026-08-28/29 — the
   shift report, its break time, its reopen, the per-shop access grid, and the
   password-reset log). *Probe, don't read this line; it has been wrong in both
   directions for four different migrations.*
   For **070**: `select count(*) from shift_reports` (the tables exist), and
   `select public.submit_shift_report(null)`, which must RAISE "No such shift
   report" from its first statement — that proves the body runs AND its guards
   do. For **071**: `select data_type, is_nullable from
   information_schema.columns where table_name = 'shift_report_ratings' and
   column_name = 'break_started_at'` → `time without time zone`, YES.
   For **072**: `select public.reopen_shift_report(null)` raises the same way,
   and `select count(*) from pg_proc where proname = 'reopen_shift_report'` must
   be **1** — two would mean an argument list drifted and an overload is live
   beside it (033's `freeze_pay_period` trap).
   For **073**, the one that matters is the EMPTY-TABLE rule rather than the
   table: `select public.may_work_at(o.id, m.user_id, l.id) from orgs o,
   org_members m, locations l limit 1` must be **true** while
   `select count(*) from location_members` is **0**. If that ever answers false
   on an empty table, every member has just been locked out of every shop.
   For **074**: `select count(*) from pg_policy where polrelid =
   'public.password_reset_requests'::regclass` → **1**, SELECT only; a second
   policy would mean somebody added a write path the service_role function is
   supposed to be the only holder of.
   Deploy order for the functions: `send-shift-report` and
   `request-password-reset` are new, and **`sync-square-sales` must be
   REDEPLOYED** for its `preview` mode or the shift report's Sales page can only
   ever say "Square has not reported this day yet". `_shared/email.ts` gained an
   optional `html`, and since it is compiled in AT DEPLOY TIME the other
   consumers pick it up only when redeployed — hygiene, not a requirement, since
   none of them passes the field.

   **(r) THE ROW IS A PROGRESS BAR** (Mark, 2026-08-20, after a mockup pass).
   A wash fills each row of `/special-orders` to the fraction of stages done,
   yellow at the first rung and green at the last, under a 3px rule on the row's
   bottom edge — plus a six-tick **Progress** strip saying WHICH.
   **THE SIX STAGES ARE MARK'S AND THEY ARE A LADDER WHERE THE SEVEN ARE NOT.**
   Measured over the 8,321 real orders, the seven stage columns are prefix-clean
   on **32%** — 68% carry a later stamp before an earlier one. Two of the seven
   cause nearly all of it: `delivery_scheduled_at` is filled on 11% because 82%
   of orders are pickups (of 6,846 pickups, NINE ever booked a delivery), and
   `order_scheduled_at` on 23%. Mark's six — Lead · Quote sent · Quote returned
   · Invoice sent · Invoice paid · Printed & scheduled — drops the booking and
   folds scheduling into printing, and is **88.6% prefix-clean**. That is what
   makes a bar honest here.
   **Two things offered and DECLINED, recorded because they will read as
   oversights.** Stage 6 is printed **AND** scheduled, not OR: printed is 64%,
   scheduled 23%, both 22.7%, so 41% of printed orders sit at 5 of 6 for good —
   deliberate, because scheduling is the real last step. And there is **no
   Receipt rung** though `receipt_sent_at` is filled on 58.4%; the ladder ends
   where the kitchen's work does.
   **STAGE ONE IS ALWAYS DONE, AND IT DRAWS NO BAR** (Mark, 2026-08-21: "Stage 1
   (leads) should have no visible progress bar. Stage 2 (quotes sent) should
   have the first visible display of a progress bar."). This REVERSES the first
   cut, which drew a 1/6 sliver so the bar was never an empty track — zero was
   thought to read as "broken" where a sliver reads as "started". Using it
   settled it the other way and the argument is better: **being a lead is the
   starting line, not progress.** Every order has reached it, so a mark every
   row carries distinguishes nothing, and on a list whose leads run to 39 rows
   it is a column of identical slivers.
   So the BAR measures the five rungs BEYOND the lead — nothing at rung 1, the
   first visible length at rung 2, full at rung 6 — while the STRIP still shows
   all six, because "which rungs are done" and "how far along" are different
   questions and the tick answers the first. **`OrderProgress.fraction` IS THE
   BAR'S OWN LENGTH**, `(done - 1) / (total - 1)` rather than `done / total`:
   both the width and the colour ramp read it, which is what keeps the first
   VISIBLE bar yellow and the last green, and a field that said 1/6 while the
   bar drew nothing would be a trap. `snapStops` is asked for FIVE stops, not
   six, indexed `done - 2`.
   **A FLAGGED LEAD STILL DRAWS, and since 058 that is the common case rather
   than an edge** — every inquiry from the public form arrives flagged and most
   arrive as nothing but a lead. Flagged is full-width red whatever the stages
   say, so the "no bar at rung 1" test runs AFTER it; the other order makes
   every new inquiry invisible, which is the exact opposite of what flagging it
   is for. Fixture-pinned in both directions.
   **The off-by-one in the snapped index was NOT caught by the suite** and was
   found by breaking it: nothing pinned WHICH stop a given rung draws to, so
   `snapped[done - 1]` passed all 1072 cases while drawing every bar one column
   too long and reading `undefined` — "NaN%" — on the last rung. There is a
   fixture for it now.
   **THE BAR'S LENGTH IS FOUR STEPS AND ITS COLOUR IS SIX** (Mark,
   2026-09-16: "make the steps of the bar 5 but the color of the bar 6"). The
   team's work ends at Invoice paid — printing and scheduling are the
   kitchen's, mostly done from the generate dialog — so rungs 2–5 fill the row
   (`OrderProgress.length`) and rung 6 adds no length. The colour still ramps
   over all six (`fraction`), so paid-and-unprinted is full width a shade short
   of green and only printed-and-scheduled is the final green. The strip's
   sixth tick is unchanged and still says whether the kitchen has it.
   **THE STATUS SETS A FLOOR AND THE DATES ONLY PUSH IT FURTHER** (Mark,
   2026-08-20: "once an order is set to 'order', then it should jump to stage
   5"). That is not a new rule — it is `STATUS_HINT` believed by the bar:
   lead→1, quote→2 ("sent, awaiting approval"), invoice→4 ("sent, awaiting
   payment"), order→5 ("**paid** — printing and scheduling remain"). The status
   is the record's claim about where it got to; the dates are how. When they
   disagree the status wins, because plenty of real orders reach a rung without
   stamping it — **925 orders at status `order` have no quote date and 770 no
   payment date** (wholesale and standing orders, billed weekly, which never
   pass through a quote). Measured, the floor moves **1,501 of 6,664 committed
   orders (23%)** off a bar that made finished work look unfinished.
   **The floor fills the TICKS, not just the count** — raising the number alone
   would leave the strip showing gaps while the wash said five, which is two
   readings of one fact disagreeing.
   **WHOSE MOVE IT IS BEATS HOW CLOSE THE EVENT IS** (Mark, 2026-08-20, with two
   real orders). `stageState`'s two waiting rungs — `quote_returned` and
   `invoice_paid` — were `close || past ? "overdue" : "waiting"`, and `close` is
   `printWithinDays`, TWO days. So order 9882 (quoted the 12th for the 22nd) and
   9863 (invoiced the 6th for the 22nd) both painted RED when we are plainly
   waiting on somebody else. They are `past ? "overdue" : "waiting"` now: while
   the event is ahead of you, waiting on them IS waiting; once it is behind you,
   "waiting" is a euphemism. Known cost, accepted: no warning in the last two
   days from the strip, which the row's event date and the attention queue both
   still carry. **Only the two THEIR-move rungs changed** — the four we act on
   are still `close || past`.
   **AND `suggestedTodo` NOW ASKS WHETHER ITS OWN DOCUMENT HAS GONE OUT.** It
   only ever looked at the NEXT stage's date, so it could not tell "not sent
   yet" from "sent and unanswered": 9863 was told to "Send Invoice" sixteen days
   after the invoice went out, and 9882 to "Respond to Email/Call", which is
   what you do for a LEAD that has written in. **When the ball is in their court
   the suggestion is NOTHING** until the event has passed, at which point an
   unpaid invoice gets FileMaker's own "Invoice Overdue!". A to-do suggested on
   every waiting row is the noise that teaches people to ignore the column, and
   the strip already says "waiting on them" in yellow. It takes `today` now —
   optional, and without it the chase simply never fires.
   **ONLY THE FIRST BLOCKED RUNG IS COLOURED** (Mark, 2026-08-20: "once we hit
   either a red or yellow one, the ones after it should just be 'not yet'").
   `stageState` judges each rung alone, so a near or past event calls EVERY
   undone rung overdue — an order with nothing stamped came out
   `done · OVERDUE · — · OVERDUE · — · OVERDUE`, which reads as three separate
   things being late when the quote is the blocker and the rest have not come
   up. A strip painting them all says nothing about WHERE the order is stuck,
   which is the one thing it exists to say. **A `done` rung is never demoted**:
   it is a fact rather than a prediction, and `done` is COUNTED from these
   ticks, so greying one would also shorten the bar. The tooltip inherits it and
   now carries at most one reason.
   **Cancelled gets NO bar** (the style is `undefined`, not a zero width) and the
   row greys out; **flagged is full-width red** whatever the stages say. Cancelled
   BEATS flagged — 705 orders are cancelled and a flag is cleared as soon as it
   is dealt with, so an order called off is not an open problem.
   **THE BAR SNAPS TO A COLUMN RULE** (Mark, 2026-08-20: "it looks a bit off
   when a column is partially colored"). The eye takes a vertical rule as the
   edge of a thing, so a wash stopping just short of one reads as having failed
   to reach it rather than as a measurement. `snapStops` takes the NEAREST rule
   and forces the run STRICTLY INCREASING — the second half is what makes it
   safe, because nearest alone sends two adjacent rungs to the same rule
   whenever a column is wide, and then 2 of 6 and 3 of 6 draw identically, which
   is worse than landing mid-cell. With fewer rules than rungs (a reader who has
   hidden the table down to five columns) it returns null and the raw fraction
   is used: snapping badly is worse than not snapping. **Only the LENGTH
   snaps** — the colour still runs off the true fraction, so the ramp stays even
   however the columns are dragged.
   That is what `rowStyle`'s second argument is for: only `DataTable` knows
   where the rules fall (weights, the reader's dragged widths, whatever is
   hidden), so it hands them over rather than the caller guessing.
   **The wash is 20% alpha and the fraction is inline**, which is why
   `DataTable` gained **`rowStyle`**: a computed width is not something a set of
   utilities can cover. It goes on the `<tr>` so the background spans the row —
   anchoring it to a cell makes it as wide as that column, which is exactly how
   the first mockup came out wrong — and the hover wash is a background COLOUR
   on the same element, so both survive.
   **`SHOW_ROW_PROGRESS_WASH` is the seam** for Mark's "make it a preference
   later… it might be too loud for some": one constant, not a stored preference,
   because a preference nobody can reach is dead machinery. Turning it into one
   is a `useSyncExternalStore` over localStorage plus a switch in the filter row.
   **It governs the WASH only** — the strip is a column, so the Columns menu
   already hides it, which is why the two are separate.
   The legend is pinned in a `ui/StickyFooter` and draws its OWN top rule (that
   component contributes position and a white backdrop and nothing else).
   **The strip's tooltip is a CHECKLIST** (Mark, 2026-08-20, who drew it) —
   `☑ Lead / ☐ Quote returned — waiting on them` rather than `Lead: done /
   Quote returned: waiting`. A column of boxes is scanned rather than read, and
   the eye lands on the first empty one, which is the next thing to do and the
   only reason to open it. The box is TWO-state and the strip is four, so
   overdue and waiting are said in words after the label while a rung merely not
   due yet says nothing — otherwise most rows carry four "not yet"s, which is
   the noise this replaced. **Both glyphs carry U+FE0E**: `☑` has an emoji
   presentation and `☐` does not, so without it Apple renders a colour box
   beside a plain outline one — the order guide's ♥/★ pair carries the same
   selector for the same reason. It is a native `title` like every tooltip here
   and inherits that there is NO HOVER ON AN IPAD; acceptable because the
   strip's colours already say done, overdue and waiting without it.
   **ALL SEVEN STAGE COLUMNS ARE GONE** (Mark, same day, in two steps — the six,
   then "the print column can go too"), and the strip moved to the END where
   they used to be. 868px of dates replaced by 92px of ticks: they were the
   third grain of one fact — how far, which, WHEN — and the day is on the
   record, which is where you go when you want it. The list went 16 columns to
   9. `STAGES` is NOT trimmed: `stageState` and `orderProgress` read the whole
   ladder and the record still prints every stamp.
   Final order: **Number · Kitchen · Status · Date · Customer · Event · Total ·
   Progress · To-do**. To-do led the list until this pass, which put a
   mostly-empty column — set on 101 of 8,330 orders — at the margin the eye
   starts from; last, it reads as what it is, a note left on an order.
   No `storageKey` bump for any of it — a stored key whose column is gone drops
   out, and a column added since the last drag appears at its declared position;
   both are already `columnOrder` fixtures.

   Not done, and worth asking about: **`LinkCustomer` does not seed the
   contact.** Linking a customer to an EXISTING order is the same idea, and
   overwriting a day-of contact somebody has already typed is not.

   **THE LIST SELECTS AND ACTS IN BULK — 2026-09-20** (Mark: "add a column to
   the first position on the special order list so we can 'select' multiple
   special orders and perform actions on them"). `BillList`'s arrangement, which
   is where every rule here was already paid for: a tick column, one **Actions**
   menu beside the create button, and a `SpecialOrderBatchActions` that hands
   its rows OUT through a render prop so the menu owns where they sit while it
   owns what they do.
   **THE TICK BOX IS FIRST, AHEAD EVEN OF THE NUMBER** — it is not a field, it
   is how you ADDRESS the row, so it sits where your hand goes before you have
   read anything. `pinned`, so a dragged layout cannot put the boxes in the
   middle of the table, and an EMPTY label, which is what keeps a control column
   out of the Columns and Reorder menus: hiding it would hide the only way to
   select anything.
   **THREE VERBS, AND THEY ARE THE ONES THAT ALREADY EXIST FOR ONE ORDER** —
   Cancel Orders, Resolve Flags, Delete Selected…. **Duplicate is deliberately
   absent**: in bulk it would make a dozen leads and leave you on the list
   looking at them, which reads as an accident rather than a command, and the
   thing it is for ("same as last year") is one order at a time. Flag-with-a-
   reason is not here either, because a reason shared across a selection is a
   question nobody has asked yet.
   **EVERY COMMAND COUNTS WHAT IT WILL ACT ON IN ITS OWN LABEL** — "Cancel
   Orders (4)" — and says what it will SKIP before it writes. A selection is a
   mixed bag, and **decision 3's biconditional decides who can be cancelled**:
   051's `special_orders_status_iff_order` makes `status` null exactly when
   `kind` is not `order`, so cancelling a template is asking the database for a
   row it will refuse, and a check-constraint refusal is the one failure this
   app cannot put into words. Templates, standing orders and the already-
   cancelled are skipped, and the confirm says how many.
   **ONE STATEMENT PER COMMAND, NOT ONE PER ROW.** Twenty round trips are
   twenty chances to half-finish, and a selection half-cancelled is worse than
   one nobody touched. Each `.select()`s its rows, because an update matching no
   policy changes nothing and PostgREST returns no error — and here the count is
   also what the report sentence is made of.
   **`deleteBlock` SPLITS THE TEST FROM ITS PROSE.** The row menu's refusal
   names the parent standing order in a sentence; a selection wants "3 were made
   by a standing order" instead. Two copies of the TEST is how a batch quietly
   starts deleting what the row menu refuses, so there is now one predicate and
   two vocabularies on top of it, with a fixture asserting the two doors always
   agree. The batch reads `production_schedule_id` for the TICKED ids when the
   command is pressed rather than carrying it on all 500 rows — the row menu's
   own argument, and the reason Delete's label cannot state a refusal count the
   way Cancel's does; the confirm states it, before anything is written.
   **THE REPORT IS HELD BY THE LIST**, not by the component that ran the
   command: reporting clears the selection, and a message owned by something
   that clearing re-renders past is a message nobody reads. `BillBatchActions`
   paid for that with a bulk approve that worked and said nothing.
   **AND THE CREATE BUTTON WENT INTO THAT MENU, FIRST ROW** (Mark, hours later:
   "move 'new special order' button into the new actionmenu you created. first
   position"). It had ridden in the title row since 2026-09-10; it is now the
   first row of the menu that stands there instead — which is where the bill
   list and the PO list both ended up the day they grew a selection. New Order
   leads for the record menu's reason, read again: it is the one row that is
   about no ticked row at all.
   **`NewSpecialOrder`'s BUTTON BRANCH IS GONE WITH IT** and `children` is now
   REQUIRED. The component drew its own button until the record grew a "New
   Order…" row that morning and the list moved its create command into a menu
   that afternoon, at which point the branch had no callers — one dialog, two
   menus, and no third dress to keep in step. The label is "New Order…" in both:
   "New special order" was right beside a heading already reading SPECIAL
   ORDERS, where the word was said twice, and wrong in a menu, where the row has
   to name the noun it makes.

   **AND SHOW IS A RANGEPICKER — 2026-09-20** (Mark: "convert the show picklist
   to a rangepicker"). With the two non-time options gone to Status, what was
   left of that menu was four words for date windows, and the app already has a
   control for one on five other lists.
   **IT IS STILL A DIMENSION, WHICH IS WHAT BUYS THE CONVERSION FOR ALMOST
   NOTHING.** `parseFilterValues`, `filterHref` and the view cookie all read the
   dimension list, so the window still travels in the URL and survives a hard
   load exactly as it did — `FilterMenus` is simply handed every dimension BUT
   this one, and a `RangePicker` is drawn in its place. A dimension nobody
   draws a menu for is still a filter. `?view=past` and `?view=all` keep
   working, so the desk start links needed no second edit.
   **ONE TOKEN, BECAUSE THE WINDOW IS A SERVER FILTER.** `lib/specialOrderRange`
   turns `view` into dates, and the QUERY and the PICKER each ask it. This is
   the fix for a warning `page.tsx` has carried since the list was built — the
   server's idea of the window and the filter's "must match — a window that
   disagrees with the filter shows an empty list and blames the filter for it" —
   which was kept true by hand and by a hard-coded month of slack. It is also
   what makes the calendar work at all: the old window was a month back at its
   widest unless you said `past` or `all`, so a range tapped in 2024 would have
   filtered rows the server never loaded.
   **CHANGING THE RANGE PUSHES; every other control still replaces.** The PO
   list's lesson in its own words, and the reason `setFilters` runs beside the
   push: the push re-renders the server component without remounting this one.
   **TWO PRESETS ARE OPEN AT ONE END AND SAY SO WITH A SENTINEL.** `DateRange`
   is a closed pair and Upcoming and Past are not, so they are bounded at 1900
   and 2999 — dates no donut order will carry — which keeps them ordinary ranges
   everywhere else: the calendar paints them, the server compares them, and
   `matchingPreset` puts the WORD back on the control's face. Past ends
   YESTERDAY, so today belongs to exactly one of the two.
   **`accepts` IS A ONE-LINE WIDENING OF `lib/filterMenus`.** A calendar pair is
   `2024-01-01..2024-03-31`, which no list of options can hold, and
   `parseFilterValues` validated against options — so a custom range would have
   survived being picked and not survived being bookmarked.
   **TWO BUGS THE FIXTURES FOUND, NEITHER BY REVIEW.** A digit-shaped token
   (`2024-13-45`) matched the pattern, and this value is interpolated STRAIGHT
   into `event_date.gte.…`, so a typo in the address bar would have come back as
   a Postgres date-parse error in place of the whole list; it now falls back to
   the resting view. And the bar's **Clear** hands back a record with no `view`
   in it, which would have dropped the window to Upcoming client-side only while
   the server still held a year of past orders — the exact empty list above.
   Clear now keeps the window, which is also the right reading: it clears the
   MENUS, and the range wears its own ✕.
   **`upcoming` LOST TWO QUESTIONS IT SHOULD NEVER HAVE ASKED.** It had matched
   `kind === "order" && status !== "cancelled" && event_date >= today` — three
   questions in one option. Show answers WHEN: a cancelled order still happens
   on its day, and Status is where you say you would rather not see it.
   The generated PostgREST filter was checked by building the query and reading
   its URL: `or=(and(event_date.gte.…,event_date.lte.…),event_date.is.null)`.

   **SHOW ANSWERS "WHEN", STATUS ANSWERS "WHAT STATE" — 2026-09-20** (Mark:
   "move 'unpaid' from the show picklist to the status picklist", then "move
   'needs attention' from show to the status picklist too, and any others that
   aren't time based"). Show had carried Needs Attention and Unpaid beside
   Upcoming, Tomorrow and Past on the argument — written into this file — that
   they "answer the same question the other five options do". **They do not, and
   the cost was a filter you could not express**: one menu holds one answer, so
   picking Unpaid silently threw away Upcoming, and the two are questions you
   want to ask at the same time. Status now reads Lead · Quote · Invoice ·
   Order · Cancelled, a rule, then **Needs Attention · Unpaid** — the derived
   pair below the stored five, with Needs Attention first because it is the
   wider net (an unpaid order whose event has gone by is one of the things it
   catches). Both matchers moved verbatim: `attention.has(r.id)` is decision
   19's own map, the one the to-do column paints from, and Unpaid is
   `countsAsOwed` + a balance, which is what both customer screens already ask.
   **THE DESK START LINKS GAINED `view=all`, AND THAT IS A FIX.** They pointed
   at `?view=attention`, which REPLACED the default Upcoming window and so
   showed overdue orders. Split across two menus, `?status=attention` alone
   would have left Show on Upcoming and hidden exactly the orders those two
   lines count — the ones whose event has gone by unpaid or unprinted. `all`
   also widens the SERVER window (`page.tsx`'s `showAll`), which `attention`
   never did, so the link now reaches orders the old one could not load at all.

   **A RATE IS TYPED AS A PERCENTAGE SINCE 2026-09-20** (Mark, on the Payments
   tab: "it seems like we should enter a whole number and let the app convert it
   to a decimal. I intuitively typed 20 for a percentage instead of .2. I think
   others would as well"). He is right, and **the cell had been telling him so**:
   it rested on "20%" and its editor wanted `.2` — two units in one control. 20
   into Discount stored 20, which is a **2000% discount** and would have taken
   the order below zero.
   **NOTHING NEW WAS INVENTED. `InlineValue.scale` ALREADY EXISTED** and its own
   doc describes this exact failure — "showing 0.50 at rest and putting 30 in
   the box the moment you click it invites someone to type an hour figure into a
   minutes column" — written for `unpaid_break_minutes` in August and never
   applied to a rate. `lib/percent` is the fraction↔percent pair plus the label,
   and the three cells that needed it now carry `scale` and `format` TOGETHER,
   because either alone is a cell in two units.
   **IT DOES NOT GUESS.** "Over 1 means a percentage" would read 20 and 0.2 as
   the same thing, which works until somebody means half a per cent. 0.2 typed
   here is two tenths of one per cent, and the cell then reads "0.2%" — the
   display and the box agree, which is the whole fix.
   **THE LOCATION'S TAX RATE CAME ALONG**, which is the one place this went
   past the Payments tab. It is the identical trap on the same quantity, and it
   is the column the order's rate is SNAPSHOTTED FROM — leaving it in fractions
   would mean two screens asking for one number in two units. Its local
   `percent()` helper is gone.
   **AND `scale` NOW TOLERATES A NUMERIC STRING**, which is not politeness: it
   is the `labor_rate` lesson that `lib/specialOrders`'s own `n()` exists for.
   PostgREST hands `numeric` back as a STRING often enough, and `row.tax_rate as
   number | null` is a CAST that converts nothing — so without it the scale
   would silently not apply and the cell would rest on "0.0975%".
   Rounding is deliberate at both ends: `0.07 * 100` is `7.000000000000001`, and
   that is what would land in the edit box. Nine fixture cases, four of which go
   red when the conversion is removed.
   **"Discount (rate)" IS NOW "Discount (%)"** (Mark, same day), which pairs it
   with "Discount ($)" directly above: two rows asking one question in two
   units, each label naming its own. Tax rate keeps its name — it has no sibling
   to be told apart from.

   **"NEW ORDER…" IS ON THE RECORD'S ACTIONS MENU SINCE 2026-09-20** (Mark: "add
   a 'New Order…' option to the navmenu on the special order detail page").
   **It is the LIST'S dialog, not a second one** — `NewSpecialOrder` gained
   `ScheduleProduction`'s render-prop idiom, so it keeps its own state, its own
   dialog and its own insert and hands the menu a row instead of drawing a
   button. A create form written again on the record is exactly the "second
   version that never behaves quite like the first" the conventions warn about,
   and this one would have had to learn pickup/delivery twice.
   **IT LEADS THE MENU** (Mark, same day: "'new order…' should appear at the top
   of the actionmenu"). It sat above Duplicate for a few hours, on the argument
   that those two are the pair that end with a DIFFERENT order on screen. The
   top is better, and for the same reason read the other way round: it is the
   one row here that is not about this order at all, so it belongs before the
   menu starts talking about this one — and it is the row you reach for while
   the last order is still open, which is to say without reading the menu.
   **THE RULES NOW FALL OUT OF A LIST OF GROUPS**, empties dropped first and a
   rule above every group but the first. That replaced three hand-made
   conditionals, each of which had to know what might be above it: on a template
   there are no documents and no QuickBooks row, so the first group would
   otherwise open the menu with a line drawn across the top of nothing.
   **The two labels differ on purpose**: the list's button says "New special
   order" beside a heading reading SPECIAL ORDERS, where the word would be said
   twice; the menu row says "New Order…" above "Duplicate", where it has to name
   the noun it makes. Title Case with an ellipsis, like every row that opens a
   dialog.

   **THE CREATE DIALOG ASKS PICKUP OR DELIVERY SINCE 2026-09-20** (Mark: "give
   the user the option for pickup or delivery. If delivery, allow the user to
   enter the delivery address as well"). **It earns its place by the create-
   dialog rule** — a field makes the cut when something BREAKS without it, not
   when it would be nice to have. `fulfillment` is `not null default 'pickup'`,
   so a delivery taken on this form started life claiming to be a pickup, and
   everything downstream believed it: `tabsFor` hides the Delivery TAB, so there
   was nowhere to type the address; `stageState` returns null for
   `delivery_scheduled` on a pickup, so the attention queue never chased the
   booking; and both PDFs print "PICK UP TIME" over an order nobody is
   collecting. Three silent failures, fixed by one tap at the moment the phone
   rings.
   **IT IS ASKED OF EVERY KIND**, unlike the two halves of "when". The column is
   `not null` on all three, Duplicate carries fulfillment across, and a standing
   wholesale account is the likeliest delivery in the building.
   **KIND NO LONGER SITS ALONE.** It had the row to itself as "the switch"; the
   new field is the second switch — Kind decides whether the date and time are
   required, Pickup / delivery decides whether an address is asked — so the two
   of them pair, and every row below stays a real pair rather than three fields
   wide with a hole in it.
   **THE ADDRESS IS OPTIONAL AND FULL WIDTH.** Mark asked to "allow" it, and an
   order taken over the phone often has a date and a customer long before it has
   a street, so `ready` is untouched and nothing can stop a delivery being
   created. Full width because "1638 Colorado Blvd, Los Angeles, CA 90041" is 44
   characters and not a half-column value. SINGLE LINE where the record's own
   cell is `multiline`, matching the public inquiry form: a textarea in a dialog
   invites a paragraph nobody wants to read back off a kitchen sheet. It sits
   with Pickup shop and Kitchen rather than under its own switch two rows up —
   those three are one question asked three ways.
   **`deliveryFields` IS THE ONE RULE WORTH A FIXTURE**, and it says an address
   belongs to a DELIVERY and to nothing else — the app's side of migration 058's
   `case when v_fulfillment = 'delivery' then v_address else null end`. It
   matters because the dialog KEEPS what you typed when you flip back to Pickup
   (a mis-tap should not silently delete an address), so without it the row
   would store as a pickup carrying a delivery address: true on the Info tab,
   with no tab to show it on. It also floors anything that is not `delivery` to
   `pickup` rather than passing it through, because the column is
   `check (fulfillment in ('pickup','delivery'))` and a check-constraint refusal
   is the one failure `InlineValue` cannot explain. Six cases, verified by
   breaking the guard and watching two go red.
   **The customer record's "New order for them" is UNCHANGED** — it is a
   one-click stub with no dialog, so it keeps the column default, exactly as
   before.

   **THE PAID DATE OFFERS TO SETTLE THE BALANCE SINCE 2026-09-19** (Mark:
   "when we set a paid date and the order is still unsettled/has a balance due,
   we should offer to create a payment for the order so it becomes settled") —
   the mirror of the offer that has run the other way since 2026-08-21, where
   recording the money offers the date. Both directions exist because the two
   facts are entered from two tabs and either can come first; together they are
   what stops a record saying it was paid over a balance nobody cleared, which
   is precisely the disagreement the new PAID chip would otherwise put on
   screen beside "$1,125.00 due".
   **IT IS A LINE IN THE SAME DIALOG, NOT A SECOND ONE.** `whatFollows` returns
   everything at once for exactly this reason — a second prompt reads as the app
   second-guessing the answer you just gave — so setting the paid date on an
   unsettled invoice asks one question with three ticks: record the payment,
   move to Order, set the Print Order to-do. **The money is FIRST in the list**:
   the ladder is bookkeeping, the balance is money.
   **THE CONSEQUENCE TYPE IS NOW A UNION**, and `payment` is the only member
   that is not a column on `special_orders`. `Consequence` = `ColumnConsequence`
   | `PaymentConsequence`, the latter carrying an `amount` and an `on` rather
   than a `value`. That is what makes `WorkflowOffer` handle it — the compiler
   refuses `patch[c.column] = c.value` until it does — and it is why
   `statusCatchUp` now returns the narrower `ColumnConsequence`.
   **THE AMOUNT AND DATE ARE DERIVED; THE METHOD IS LEFT BLANK.** The app knows
   what is outstanding and the day somebody just said it was paid. It does not
   know how the money arrived, and "Square Invoice" — right on 1,188 of 1,190
   real payments — would still be a guess written into a record of money
   received. `OrderPayments` shows the method as an inline cell, so the one fact
   the app cannot know is the one left for a human.
   **THREE WAYS TO GET NO OFFER, AND EACH IS A REAL ORDER** (`settlingPayment`,
   all fixture-tested by breaking the guard and watching the case go red):
   no money passed — `afterPaymentSettled` deliberately passes none, because a
   payment just landed there and proposing another is proposing to take the
   money twice; **`ignore_balance`** — decision 13's wholesale account is billed
   weekly in arrears, and Cafe Knotted has seven of those days a week, every one
   carrying a balance on purpose; and nothing outstanding, which is `<=` half a
   cent rather than `=== 0` so that a CREDIT (an overpayment, where "record a
   -$4.00 payment" is not a thing to offer) and a third of a cent of float
   arithmetic both stay off the screen. The broken-epsilon run proved the last
   one earns its keep: it offered a **$0.00** payment.
   **`WorkflowOffer` TAKES A REQUIRED `orgId` NOW**, which is why two components
   that can never raise a payment gained a prop they do not use. Design rule 1's
   failure mode is an insert that omits `org_id` and reports "new row violates
   row-level security policy" — a message that sends you to read policies when
   the fault is a missing column. A required prop makes the compiler ask first.
   **TWO WRITES, AND THE MONEY GOES FIRST.** The dialog is no longer one
   statement. A payment that lands without the status move leaves the catch-up
   offer to propose it; a status move without the payment leaves an order
   reading "Order" over an unsettled balance, which is the state this whole
   consequence exists to prevent. A failed insert writes nothing else, and
   `recorded` is a REF rather than state so that pressing "Do it" again after a
   failed status move cannot take the money twice.

   **THE STATUS AND "PAID" ARE CHIPS BESIDE THE TITLE SINCE 2026-09-19** (Mark:
   "add a chip next to the page title that says the status in yellow, and a
   chip that says 'Paid' in green if the order is paid"). `PurchaseOrderDetail`
   already wore one — same box, same type, same `gap-4` row — so this is the
   second record screen adopting a badge the first one settled, not a new part:
   the layout half of the class string is a local `CHIP` const and each chip
   states its own colours, which is CLAUDE.md's rule for a shared class string.
   **THE STATUS MOVED OUT OF THE LINE BELOW rather than joining it.** It had
   been plain text in `#9469 · Order · 2026-01-09 · …`; the same word twice,
   20px apart, reads as two facts. That line keeps the KIND for a template or a
   standing order — `#9762 · Standing order · …` — which has no status to chip
   (decision 3), so the chip and the word are never both on screen.
   **ONE YELLOW FOR EVERY STATUS, not a colour per rung.** Yellow is the app's
   "worth your eye" mark and the chip is here to be read at a glance; a
   five-colour ladder would make the colour the message and leave the word as
   decoration. Green is spoken for by Paid.
   **PAID IS THE `invoice_paid_at` STAMP** — what the list's Paid stage column
   and the progress ladder's "Invoice paid" rung both mean by the word.
   Deliberately NOT `isSettled`, which counts `ignore_balance` (decision 13's
   weekly-statement escape hatch) as settled: a wholesale day that has not been
   billed yet is not a paid order, and a green chip saying so would be a lie on
   every Cafe Knotted record. The money keeps speaking for itself on the line
   below, where an outstanding balance still prints as "$X due" in `text-accent`
   — so the two facts stay separable, which is the whole reason there are two.

   **(o) THE RECORD LOST ITS PINNED BAR, THE DOCUMENT PICKER, AND THE COLUMN
   UNDER THE MONEY** (Mark, 2026-08-19, three layout notes in one).
   **THE COMMANDS ARE LEVEL WITH THE TITLE** — right-aligned in the identity
   block's own row, and the "Commands" heading is gone with the move. They went
   there in two steps the same day: first out of `ui/StickyFooter` and into the
   Info tab's top-right quadrant ("move the buttons pinned to the bottom to
   above the customer quadrant"), then up one more level ("remove the title
   'commands' and move the buttons up a level so they're even with the title
   area"). Only the final arrangement is in the code; the intermediate one is
   recorded because its cost is what the second step bought back.
   Three things this settles.
   `ui/StickyFooter` is gone from this screen, and with it the spacer every tab
   was paying for whether or not you were going to press anything.
   **The heading went because a row of seven buttons is self-evidently a row of
   buttons** — `OrderActions` made that argument when it lost its own — and a
   caption over it spends exactly the vertical space the move was meant to give
   back.
   **And they are on EVERY TAB again**, because the identity block sits above
   the tab switch. The quadrant version was Info-only, which meant emailing a
   quote from Items took a click on Info first; that consequence is retired.
   The row is `items-start`, so the buttons line up with the TOP of the title
   rather than centring against a block whose height changes with the attention
   sentence — measured, the Preview button's top and the `h1`'s top are the same
   pixel. The two button rows **right-align beside the title and left-align once
   they wrap under it** (`items-start xl:items-end`): right is what makes a
   cluster read as one block when both rows end on the page margin, and wrong
   under the heading, where it indents the shorter row from the heading's own
   margin for no reason. The wrap happens between 1024 and 1280, which is where
   the breakpoint is. Measured: 1440 and 1280 level and unwrapped with both rows
   ending on the margin; 1024 wrapped with both rows starting on it; no
   horizontal overflow at any of the three.
   **THE DOCUMENT PICKER IS GONE AND EACH VERB IS A MENU OF THE FOUR
   DOCUMENTS** ("Delete the document selection picklist, then make Preview,
   Download, and Email… picklist buttons… Same functionality, one less
   button"). The picker held STATE, which is the thing this fixes rather than
   the button count: you chose Invoice, pressed Preview, came back a minute
   later and the bar still said Invoice, so the next Email went to whatever you
   had been looking at. Folded into the verb it is one gesture and leaves
   nothing selected — press Preview, pick Quote, and that is the sentence. It is
   **`ui/MenuButton`, NOT a `PickList`**, and the distinction is what the choice
   MEANS: a PickList chooses a value that stays chosen and shows which one is
   current; these are verbs. That control is `ui/RowMenu` lifted out rather than
   a second anchored panel — the two-pass placement, the flip near the window's
   foot, the close-on-scroll and the `z-[70]` are not worth learning twice.
   `kind` survives as state only because the compose DIALOG needs to know what
   it is sending; it is set by the act that opens it. **The popup gotcha still
   holds and still works**: `MenuButton` closes synchronously inside the click,
   so `openWindowNow()` is still inside the gesture.
   **Each of the three wears the caret** (Mark: "the new document picklist
   buttons should have the arrow glyph to indicate it's a picklist"), and the
   glyph itself moved to `lib/anchoredPanel` as `MENU_CARET` so `PickList` and
   `MenuButton` cannot draw the same affordance two ways. Its SIZE and COLOUR
   deliberately stay at each call site: a PickList trigger hovers to a pale wash
   where `text-muted` reads fine, and a command button fills BLACK, where a
   fixed grey would go dark-on-dark — so this one is `currentColor` at 60%.
   It is **opt-in, and `RowMenu` does not take it**: `⋯` already means "there is
   more here", and a caret beside it is the same claim twice inside a 36px
   square.
   **PAYMENTS AND MONEY HAVE THEIR OWN TAB SINCE 2026-09-16** (Mark) —
   Info · Items · Payments · Notes · Delivery · Documents, every kind of record
   included (a template's Money block is what a duplicate inherits). The Items
   tab keeps the lines, sticky column labels, and a pinned footer holding Add
   item and the Items total, which borrows the lines' own `colgroup` so the
   figure sits under Total. The paragraph below still describes the pair's
   arrangement, now on the Payments tab.
   **PAYMENTS LEFT, MONEY RIGHT ON THE ITEMS TAB.** Stacked, the payments table
   sat a screen below the balance it settles. They shipped Money-left first and
   were swapped the same day ("move the 'money' section… all the way to the
   right of the page, and the payment… all the way to the left"), which is
   better than it was: the lines table above ENDS in a money column against the
   right margin, and Money's own figures are a column of amounts against a right
   margin too, so on that side they continue the page's one vertical rule of
   numbers instead of starting a second one 400px to its left.
   **Money is sized to its CONTENT and Payments takes the rest**, rather than an
   even split — the recipe record's Costs-pane call and its reason: Money is
   label/value pairs set `justify-between`, so half of a 1150px column becomes
   500px of white space between "Delivery charge" and "$49.50", where a table
   with a free-text Note uses every pixel. Payments being the FLEXIBLE one is
   also what holds Money on the right margin when that table stops at its own
   `max-w`.
   **MONEY IS TWO COLUMNS INSIDE ITS OWN BLOCK** — tax rate through ignore-the-
   balance on the left, Items through Balance on the right, which is the two
   `dl`s exactly as they were written: what you SET beside what it COMES TO. It
   was briefly stacked, on the day the block became half a row and the pair
   would not fit; a `max-w-[32rem]` is what buys it back, and the block still
   sizes ITSELF rather than taking a share of the row, which is what keeps its
   right edge on the page margin. `max-w` and not a fixed `w`, because below
   `xl` it is stacked at the full width of the page where two 400px tracks would
   reintroduce the white space this is avoiding. Measured with real figures: two
   201px tracks, no label wrapping.
   **THE SWITCH HAS NO SENTENCE BESIDE IT.** "Wholesale days are billed weekly,
   not per order" was one REASON somebody might reach for Ignore the balance,
   not what it does — so on every other order it was a sentence about somebody
   else's order. Its accessible name still says what it does.
   **ONE DOM ORDER AT EVERY WIDTH, no `order-*` classes**: below `xl` you read
   Payments then Money, which is the price of keeping the visual order and the
   tab order the same thing. Measured at 1440: Payments starts at 240 and Money
   ends at 1392, which are exactly the lines table's own two edges; at 1024,
   stacked, Payments first; no horizontal overflow at either.
   **THE LINES TABLE'S COLUMNS DRAG TO RESIZE, AND IT IS STILL NOT A
   `DataTable`.** Worth stating, because the convention says every list is one.
   Two things this table does that the component cannot: a line is DRAGGED TO
   REORDER (`useRowDrag`, the ⠿ grip — a special order's line order is
   meaningful, and FileMaker's slots are where it comes from), and the last row
   is a SUBTOTAL spanning most of the width. Teaching `DataTable` row-drag would
   touch fifteen screens to serve one, which is the same reasoning that leaves
   `/order-guide` and `/cleanup` hand-rolled.
   What it does NOT hand-roll is the resizing: `useResizableColumns` and
   `catalog/ColumnHeader` are the shared primitives UNDERNEATH `DataTable`, so
   the grip, its Safari fixes, the persistence and the "Reset column widths"
   footer behave here exactly as on every list. Widths are WEIGHTS turned into
   percentages of the visible total (the fluid-column rule), the table is
   `table-fixed` — without which a `<col>` width is a suggestion the browser
   ignores — and **no column sorts**, because the ORDER IS THE DOCUMENT and a
   click that reordered it would fight the drag handle beside it.
   That last part surfaced a bug in the shared header: **`ColumnHeader` drew its
   resting `↕` on every column, sortable or not.** The marker is a promise, and
   on a column with no `onSort` it is one nothing keeps — equally wrong on every
   CONTROL column, which has never had an `onSort` either. It is now conditional.
   **AND THE LINES TABLE'S NOTE IS ITS SECOND COLUMN**, where it used to sit
   between Tax and Total. It belongs beside the thing it is about — `"H".
   Chocolate glaze with rainbow sprinkles` is a sentence about the item on its
   left — and moving it out of the middle lets Qty · Price · Tax · Total run as
   one unbroken band of figures against the right margin. Item and Note are both
   unsized, so they share whatever the four fixed columns leave.

   **(m) THE CREATE DIALOG ASKS WHO IS ORDERING, not who to call** (Mark,
   2026-08-18: "we should be able to set the customer when creating a special
   order. Remove the contact, phone and email and add the ability to link or
   create a new contact"). Those three boxes wrote `contact_*` — the DAY-OF
   contact, which on a corporate order is whoever is running the party and is
   genuinely a later detail. WHO IS ORDERING is what you know when the phone
   rings, and it was the one thing the form could not record. All three survive
   on the record.
   **`CustomerPicker` WRITES NOTHING.** A create dialog that has already made a
   customer by the time you press Cancel is a dialog that lies about what Cancel
   means, so a new customer is held as a DRAFT and `createSpecialOrder` writes
   it in the same act as the order — which also makes it impossible for an order
   to end up pointing at a customer that failed to save. Verified: typing a name
   into the form leaves `customers` at 5,874, and only Create moves it.
   The QUERY lives in `lib/customerSearch` because two screens ask it — this and
   the record's `LinkCustomer` — and it is the half with a rule in it. The UI
   differs legitimately; the search must not.
   **(k) AN ORDER COULD NOT BE GIVEN A CUSTOMER** (Mark, 2026-08-18: "how am I
   supposed to link a customer to the order?"). The only writer of
   `customer_id` in the whole app was "New order for them" on the customer
   record, which sets it at CREATION — so the link existed in one direction
   only, and an order that began as a lead (every phone order, and everything
   decision 18's inquiry form will create) said "None linked" forever with
   nothing to press. `LinkCustomer` is `InventoryItemPicker`'s shape, built for
   the same reason that one was.
   A SEARCH BOX, not a `PickList`: there are 5,874 customers and a picker loads
   its options up front. It searches five columns in one `or()` — and **the
   phone is matched on its DIGIT RUNS rather than as text**, which is not
   fussiness: stored `(323) 337-7966`, pasted `(323) 337`, and a plain `ilike`
   finds NOTHING, because the parentheses have to be stripped to keep them out
   of PostgREST's `or` list and stripping them leaves spaces the record does not
   have. `*323*337*` is indifferent to punctuation, which the real data needs —
   it holds `3233833742`, `310.721.5994` and `323) 485-2621`.
   It also offers **New customer from this order's contact**, because the common
   case is somebody ringing who turns out to be new and whose name and number
   are already typed into the order; sending them to `/customers` to type it a
   second time is the transcription the customer record exists to avoid.
   **(l) WHEN IT IS WANTED IS REQUIRED ON A REAL ORDER** (Mark, 2026-08-18).
   The create form asked for a title and nothing else, on the reasoning that a
   lead acquires the rest as the conversation happens. True of the customer, the
   lines and the money; false of WHEN — the kitchen sheet prints the pickup time
   as its most prominent field, the attention queue measures every threshold in
   days before the event, and an order nobody can date cannot be scheduled or
   chased. **The date is required with it**, which is forced rather than chosen:
   a time with no date says nothing. **Both are asked only of `kind = order`** —
   a template is a shape with no event and a standing order recurs by weekday,
   so demanding a date would make those two kinds uncreatable. The form had no
   time field at all before this; `ui/TimeField` is new and in the parts table.

   **(i) "ALSO THAT DAY" IS SCOPED TO THE KITCHEN** (Mark, 2026-08-17: "I
   assume you're only displaying orders for the same kitchen" — it wasn't).
   The block exists to stop a supervisor double-booking a KITCHEN, so another
   shop's night is not context, it is noise that inflates the count. Measured
   on 2026-08-16: order 9885 is DF01 and two of the four it listed were DF02,
   so half the block was somebody else's work.
   **Unassigned orders come too, and are marked**: 1,403 of the 8,329 real
   orders carry no kitchen, and they are load that will land somewhere —
   hiding 17% of the history would understate the day while looking complete,
   which is the failure this block exists to prevent. An order with no kitchen
   of its own has nothing to scope by, so it sees every kitchen and says so.
   Each row also carries its STATUS, in WEIGHT rather than colour — a
   committed `order` in full ink, a lead or quote muted. Colour is reserved
   for a state that is wrong or wants an eye and a lead is neither; dimming the
   whole ROW is refused for the Locations list's reason, that greying text you
   can still click reads as disabled and lies.
   **(h) THE INFO TAB IS FOUR QUADRANTS, ONE SECTION EACH** (Mark, 2026-08-17:
   the stacked column "just looks like a wall of text"), with FileMaker's own
   EVENT INFO tab as the reference:
   **Details · Customer** on top, **Also that day · Completion dates** beneath —
   the two panes that GROW at the bottom, where they can run as long as they
   like. Mark set that arrangement; the first cut stacked Customer over
   Completion dates and put the log bottom-right, which made the right column
   494px of a 588px frame and left the log FIFTY-FOUR PIXELS.
   **The log moved to the Notes tab**, which is what freed a quadrant — and is
   the right home for it: notes want WIDTH (they are paragraphs), the log wants
   HEIGHT (two hundred entries), so `OrderSplitLayout` puts them side by side
   and neither is under the other. Info stops paying for 200 log rows too.
   **DELIVERY IS NOT A TAB FOR A PICKUP ORDER** (Mark: "Delivery being on its
   own is weird but not sure where it fits"). It was weird because **6,842 of
   the 8,330 real orders are pickups**, and for those the tab held a two-cell
   toggle and one sentence — four times out of five, a tab leading nowhere. The
   CHOICE moved into the Details quadrant beside Pickup shop, where it is a
   fact about the order rather than a delivery detail, and `tabsFor` shows the
   tab only when that cell says delivery. Switching the cell makes it appear, so
   nothing hides behind a state you cannot reach.
   `components/specialOrders/OrderInfoLayout` measures the frame with
   `useExactViewportHeight` (the recipe record's hook, `xl`-gated, 420px floor)
   and each column's LAST pane takes the slack and scrolls its own rows.
   TWO COLUMNS OF STACKED PANES rather than a literal 2x2 grid, which is
   `RecipeInfo`'s shape and reason: a grid ties both bottom cells to one row
   height, so a long log would stretch the empty pane beside it.
   Three things this cost, each found by measuring rather than reading:
   **`overflow-y-auto` on the growing pane is load-bearing** — without it
   `xl:flex-1` gives the pane a box, the log simply overflows it, and the page
   runs to 1402px inside a 588px frame, which is the arrangement the layout
   exists to replace. **The top blocks decide whether the bottom ones exist**:
   Customer + Completion dates came to 494px of a 588px frame and left History
   FIFTY-FOUR PIXELS, a heading and nothing else — which is why the dates moved
   to the bottom-LEFT quadrant. And **inline labels were tried everywhere and
   kept only for the dates**: at ~272px per sub-column a 128px label track
   leaves too little for a name or a phone, so those wrap; the dates are short
   values and stay inline, which is what makes that block compact.
   **NOTES IS ITS OWN TAB** (FileMaker has one) — five multiline document notes
   are a screenful and they pushed the log below the fold. **The commands moved
   to a `ui/StickyFooter`**, FMP's bottom row: on the Info tab they sat under
   the log, so Delete was two hundred entries down the page.
   Known residue: at 1440x900 the page still scrolls ~32px. Nothing is hidden
   and every pane fits; it has not been chased down.
   Also: `ui/FilterMenus` gained a **`trailing`** slot (right-aligned; on its
   own line ABOVE the menus since 2026-08-21, in the row until then) for a
   list's create command — `EmployeesList` had the
   same slot before the control existed. And `/special-orders` and `/customers`
   join `/employees` in `InactiveLocationGate`'s exempt list, because decision 8
   makes them deliberately ORG-WIDE.
   The rest of this entry is the design as specced; it was settled in
   conversation with Mark against the fresh exports
   (`FMP Export/Special Orders/`, re-exported the same day after the first
   export proved to be an 18-month-stale copy — check `max(OrderID)` ≈ 9887+
   before trusting any future re-export), fifteen screenshots, four real
   generated PDFs for order 9885, and three real inquiry emails.
   The decisions in one line each: full migration (two ERAS — items in
   ␝-separated 20-slot repeating fields before Aug 2021, real OrderItems rows
   after; payments as rows only since Mar 2022, `Spent_c` synthesized into one
   legacy payment where no rows exist); FMP's one `Order_Type` field splits
   into **`kind`** (order | template | standing_order) × **`status`**
   (lead → quote → invoice → order, + cancelled); money DERIVED from lines +
   stored inputs, never stored totals; Square invoicing stays MANUAL in v1
   with `external_ref` seams for Square/QBO later (Mark, 2026-08-16); to-do is
   a manual field the app may hint at but never writes; items are editable
   COPIES of production items and **`Misc*` lines never reach the kitchen**;
   scheduling production inserts a real `production_schedules` row through
   040's `source='special_order'` seam (schedule line `item_id` stays NOT
   NULL — a schedulable line must link a production item, the custom name
   riding the snapshot columns); RLS is **supervisor+ on every verb including
   SELECT, customers too** (PII, 020's reasoning); inquiry emails (Square web
   form → specialorders@donutfriend.com) parse via a `parse-inquiry` Claude
   edge function as a PROPOSAL; outbound mail sends as specialorders@ through
   a second org-level provider config and threads by
   `In-Reply-To`/`References` (the stored `Email_Token` was the inbound
   SUBJECT — a threading kludge, retired); **standing orders (= wholesale,
   e.g. Cafe Knotted 370 M–Th / 700 F–Su, billed weekly in arrears)
   MATERIALIZE THEMSELVES on a 14-day rolling horizon** (BUILT 2026-09-08,
   migration 099 — read that entry, which corrects this line in one place) —
   no cron and no manual Instantiate (Mark forgot it in FMP):
   `ensure_standing_orders_materialized` is called from the list AND from
   the generate-schedules dialog, idempotent on `unique (standing_order_id,
   event_date)` where a CANCELLED day still blocks re-creation (cancel,
   never delete, or the donuts get ordered again), and the migration
   materializes NOTHING. **It is INVOKER, not the definer this line
   predicted** — 068's argument, so every insert flows through 051's own
   supervisor+ policies; pics + documents merge into one attachments
   card on a new `special-order-attachments` bucket; **the customer approves
   a quote on a public tokenized page** (`/q/{token}`, proxy-exempt like
   `/welcome`; typed-name clickwrap; the token is minted at SEND time bound
   to the exact PDF sent, spent by approval, superseded by a re-send; two
   definer RPCs deliberately granted `anon` and nothing else reachable —
   print/sign/scan survives as the manual lane); **the front door is OUR OWN
   public `/inquiry` form** (Mark, 2026-08-16 — the Square web form and its
   email layer retire; submission creates a Lead directly via a third
   deliberate anon-granted definer that never reveals whether an email is a
   known customer, and the confirmation email from specialorders@ becomes
   the thread root), with an optional **build-your-box picker** over
   production items curated by a new `show_on_inquiry_form` flag (default
   FALSE — opt-in, the catalog holds Scrap), picked lines landing as real
   order lines on the lead, totals labelled ESTIMATE, the free-text
   description always beside it, email paste-and-parse kept as the fallback
   lane; the list carries a DERIVED **needs-attention tier** (each order
   names its reason in words; the manual todo overrides on display; nothing
   stored); weekly **wholesale statements** are a one-tap rendering command
   on the customer record (Cafe Knotted is billed weekly in arrears today,
   by hand); the **rush fee suggests itself** inside the two-business-day
   cutoff (receiving's `→` idiom, never auto-written — only 795 of 5,198 v1
   orders ever carried one); **approve-and-pay via the Square API is the
   named first post-v1 feature** and nothing in v1 may make it harder;
   numbering seeds at
   10000 (FMP max 9887; `legacy_id` is NOT unique — 5 duplicated OrderIDs);
   customers migrate WITHOUT the plain-text CC fields, ever.
