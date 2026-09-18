<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4c. 🚧 **HR + app access** — the second module outside Purchasing, and the one
   that makes the app multi-user (Mark, 2026-08-01: "It's time to add users to
   the app"). Specced in `docs/hr-access-brief.md`.
   **An EMPLOYEE and a USER are two records, linked.** FMP conflated them:
   login credentials were two fields on the employee's ADMIN tab — the password
   stored and DISPLAYED in plain text, beside the SSN on the INFO tab of the
   same record — and access was implied by a 1–5 "user level" radio whose
   meaning lived only in script logic. Now `employees` is the HR record (all
   ~445 people, almost all terminated, the referent every rating/timesheet/order
   will hang off) and `org_members` stays the access record; the link is
   `employees.user_id`, nullable and unique. Granting access is an ACTION an
   admin takes on a record, not a job category — so a supervisor who does
   ordering gets `purchaser` without being reclassified.
   Schema: **020** (employees + the supervisor role + `org_members.invited_at`)
   and **021** (employee_documents + a private bucket). Split so a storage
   problem can't hold the data load hostage — 018's precedent.
   **`employees` is the first table where READ is role-gated** (owner/admin, not
   any-member): it carries a home address, a date of birth and eventually a
   write-up. It has **no delete policy at all** — an employee is TERMINATED,
   never deleted, and absence of the policy is the enforcement (the Clear-guide
   lesson). A supervisor phone list and a "my own record" view are both real
   future needs and both COLUMN-scoped, so each arrives as a definer function
   naming the safe columns (the `set_my_member_profile` pattern), never by
   loosening this.
   **Onboarding paperwork is DERIVED, never stored** (Mark: it "should not be a
   check list but flags that are set when those documents are uploaded"). FMP
   had eight checkboxes and the documents themselves nowhere in the system; a
   checkbox is a claim about paper in a drawer and goes stale the moment it's
   ticked optimistically. `missingPaperwork()` asks which kinds exist, so
   "complete" cannot be true without the files. FMP's Events table had already
   been repurposed as a filing cabinet for exactly this reason (81 rows typed
   `Document` since 2024, 73 with a paper original) — those land here at cutover.
   **Access is an INVITATION.** `invite-member` (edge function) mints a
   one-time Supabase link with the admin API and mails it through the SAME
   three-tier provider layer the PO sender uses (org tier only — no location is
   in scope for a member). `/welcome` is where the invitee sets their own
   password; no credential is ever stored, displayed, or known to whoever
   granted access. Revoke = delete the membership FIRST (it's what every policy
   reads, so the door shuts even if the rest fails), then **ban** the auth user,
   then null the link — **never DELETE an auth user**, because 001's audit
   columns reference `auth.users` with no cascade and the history should keep
   its author. Needs one new secret: `APP_URL`.
   Two things the plan had wrong, both worth remembering:
   **`proxy.ts` bounces every signed-out request to `/login`**, which would have
   landed the invite on a password page for an account that has no password —
   `/welcome` is exempted alongside `/login`. And **`InlineValue` hardcoded
   `.eq("id", id)`** while `org_members` is keyed `(org_id, user_id)` with no
   `id` column at all; it takes an optional `match` now, with a hard stop when a
   cell has neither (a cell with no row to write to would otherwise update every
   row in the table).
   **`/welcome` spends the token on SUBMIT, never on load.** Mail scanners and
   link previewers follow URLs in email as a matter of course, so verifying in
   an effect would let a corporate spam filter burn the invitation before the
   person ever clicked it.
   **The submit button is disabled until React hydrates**, which is cheap
   insurance rather than a fix for anything observed: on a browser that never
   hydrates it stays disabled instead of letting the browser submit the form
   natively and strip the token out of the URL. Note this page CAN'T suffer
   that in the normal case — `Suspense fallback={null}` means the server sends
   no form at all, so there is nothing to press until React has rendered it.
   (A 2026-08-02 report of "nothing happens, the fields just clear" was blamed
   on exactly that mechanism and the blame was wrong; the flow was then walked
   end-to-end against a real admin-API token and completed correctly. If it
   recurs, get the URL after the failure — a bare `/welcome?` would prove a
   native submit, anything else rules it out.) The guard uses
   `useSyncExternalStore` (server snapshot false, client true) rather than an
   effect, which is what the `set-state-in-effect` lint wants.
   **A `/welcome` with no `token_hash` says so on ARRIVAL** rather than looking
   normal and failing at submit — reading the parameter doesn't spend it — and
   a failed verify now carries the server's own message instead of a blanket
   "expired or already used", which read as certainty while hiding the reason.
   **It does NOT ask for a name** (Mark, 2026-08-02: "we know their name
   already"). The org name and the person's first name ride the link as
   cosmetic params — the page has no session and so can't read either — so it
   greets them with "Welcome to Donut Friend" rather than a product name they
   have never heard of, and writes `display_name` for them. That write matters:
   a null one is what the App access block reads as "invited, hasn't signed
   in", so it falls back to the email's local part for links minted before the
   param existed. Only `token_hash` carries any authority.
   Screens: `/employees` (defaults to Active — 26 of 445) and `/employees/[id]`,
   both cloned from the locations pattern including the `key={id}` shell. The
   nav gained per-role visibility (`NavSub.roles` + `sectionsForRole`, filtered
   server-side in AppHeader) — a TIDINESS rule, never a security one; RLS is the
   gate and each gated screen says so in a sentence. `/employees` is exempt from
   `InactiveLocationGate`: a person belongs to the ORG, not to a shop.
   Migration: `transform-hr.mjs` → `load-hr.mjs`, mirroring the purchasing
   pipeline, output outside the repo. The transform matches each field against
   candidate column names and names what's missing, which is how the FIRST
   export was caught: every file Mark exported on 2026-08-01 was a LAYOUT
   export (Employees.mer had 14 columns, no employee id, no separate name
   fields, none of the ADMIN tab). **Events, Ratings, Reviews, PayPeriods and
   Timesheets in `FMP Export/HR/` are still those layout exports** — they need
   redoing before any of them can be migrated.
   The re-export is the full table, 89 columns, and it carries **SSN,
   `_security_password`, `Account_password`, `Wage` and the `Bonus_*` fields**.
   None of that is read: the transform declares the seventeen fields it wants
   and ignores the rest, which is why the design is a field allow-list rather
   than a drop-list. The file itself is outside the repo and should stay there.
   Two things the full export settled:
   **the user level is `_security_level`** (124 of 445 filled, values 1–5 —
   NOT `Account_permission_level`, which is empty in every row, and NOT
   `PermissionLevel_c`, a calculation that tracks the job rather than the
   login). 11 current employees had access above staff; that's the invite
   roster.
   And **the eighth onboarding document is "Orientation", not "Training
   Acknowledgement"** — the layout's checkbox label said the latter, but the
   `Paperwork` value list holds both and the data is Orientation 45 to
   Training Acknowledgement 3. Migration **022** widens 021's check constraint;
   `training_ack` stays fileable but is no longer required.
   Four employees are FMP location `DF00`, which isn't a location in this org
   (Mark, two managers, a contractor — evidently "the company, not a shop").
   They load with no main location, which renders as an em dash.
   Shipped 2026-08-02: **hiring someone, and deleting the typo you made doing
   it** — the app's first CREATE and first DELETE of a top-level record. Until
   this, every `.insert()` in `web/src` was a child row and nothing inserted a
   vendor, an item or a location either, so **this is the template those will
   follow** — and on **2026-09-03 all three finally did**: `NewVendor`,
   `NewInventoryItem` and `NewLocation`, plus `NewProductionItem` and
   `NewRecipe`. Every one of those tables already had a purchaser+ write policy
   from 001 or 037; **what was missing was a door, never a migration.** The
   shape: a command right-aligned ABOVE the list's filter row (it sat IN
   that row until 2026-08-21 — see `ui/FilterMenus`) → `ui/Dialog` →
   insert → land on the new record. `components/hr/NewEmployee.tsx` asks for the
   ROSTER fields only (the columns the list groups and filters by — a record
   missing those is invisible in the roster's own organizing scheme) and leaves
   the rest to the detail screen's `InlineValue`s rather than keeping a second
   editor in step. It warns on a surname already present, searching ALL 445
   including the 417 former employees, since a rehire is by definition inactive;
   clicking through to their record IS the rehire flow, so no reactivation UI
   was needed. `findPossibleRehires` is pure and fixture-tested.
   **Delete needed migration 023**, which REVERSES 020's "no delete policy,
   deliberately" for owner/admin — that rule was right about a PERSON and wrong
   about a TYPO, and the guard moved from the schema into the confirm
   (`EmployeeActions.tsx` counts `legacy_id`, app access and documents, defaults
   to Deactivate, lets you through). Deleting YOURSELF is refused outright and
   is the one guard that isn't passable: revoke removes the `org_members` row
   every policy reads. Order is revoke → delete row → remove Storage objects;
   `employee_documents` cascades but Storage does not, and revoke-then-fail is
   recoverable where delete-then-fail leaves someone able to sign in with no HR
   record.
   **A DELETE MUST `.select()` ITS OWN RESULT.** With no matching RLS policy
   Postgres removes zero rows and PostgREST returns no error, so a bare
   `.delete()` reports a cheerful success — caught in the browser here, the
   screen navigated back to a roster that had grown by one. The
   `order_guide_entries` lesson, alive on any table whose delete policy might
   not be applied yet.
   Shipped 2026-08-02: **an item's shop section is chosen from a list**
   (`ItemLocationRows`, `InlineValue kind="pick"` on
   `inventory_item_locations.shop_section_id`). The options are keyed BY
   LOCATION and that is the whole of the care: each row of that table is a
   different shop and a shelf belongs to exactly one of them, so offering DF01's
   shelves on DF02's row would write a section the guide there can never group
   by. Ordered by `sort_order` — walk order is how you think about shelves.
   "No section" is a real option with an empty value, not the absence of one;
   without it there is no way to take an item OFF a shelf.
   **Shipped 2026-08-05 — PAPERWORK CAN LAPSE (migration 034, NEEDS APPLYING).**
   021 made onboarding completeness DERIVED, which fixed "a checkbox is a claim
   about paper in a drawer". This is the other half of the same problem: a food
   handler card that expired in 2023 is on file, so the derived flags said
   complete, and the thing a health inspector would actually ask about was
   invisible. ONE nullable column, `employee_documents.expires_on`, and **null
   means it does not lapse** — the default, and the honest reading for a W-4 or
   a handbook receipt, so no existing row needed touching.
   **There is deliberately no per-kind allow-list.** Which documents expire is a
   fact about the piece of paper in your hand, not about the vocabulary: a card
   issued with no printed expiry says so by staying null, and the next kind that
   turns out to lapse needs no migration.
   `lib/employeeDocuments` gained the whole rule — `expiryState` (60 days is
   "soon", moved here from `lib/employees`' `foodHandlerState`, which is gone),
   `expiryRoll` (soonest first, so its head is both the next thing to deal with
   and the worst thing outstanding), `soonestExpiry`, and `paperworkStatus`.
   **MISSING AND EXPIRED ARE COUNTED SEPARATELY and never merged**: a lapsed
   card is ON FILE, and reporting it as missing sends someone to upload a first
   copy of a document they are looking at. `complete` is stricter than "nothing
   missing" — expired breaks it, expiring soon does not.
   UI: the expiry is on the CHIP and editable there (Mark's placement), as a
   label line over an `InlineValue kind="date"` — two lines because a 176px chip
   cannot hold both side by side, and **the label carries the meaning of an
   empty box** ("Never expires"), or a blank reads as something nobody has got
   round to filling in. The Paperwork block's derived line gained Expired and
   Expiring-soon rows beside Missing. The roster's **Food card column became
   `Expires`** — the soonest date, red if lapsed, yellow if near, with the KIND
   on a second line because "expired" without it sends you to the record to find
   out what.
   **`employees.food_handler_expires` is NOT dropped, and that is the one thing
   here that isn't finished.** Mark's note says this "would negate the need" for
   it and it will, but not on the day it ships. Measured against the live DB:
   124 employees carry that date (16 current staff) and **zero food handler CARDS
   are on file** — 42 documents exist, all handbooks and meal-break waivers. So
   dropping it destroys 124 real dates and moves none, and there is nowhere to
   move them to (a document row requires a file). Until then the app reads the
   two in priority order — `foodHandlerExpiry`, the same shape as receiving
   preferring the FILED invoice over the last raw reading: **a card on file wins
   even when it carries no expiry**, because at that point the card IS the
   record and a date on the employee row is a claim about a different piece of
   paper. `expiryRoll` folds the legacy column in only while no card is filed, so
   the roster loses nobody it used to flag. The detail screen's Food card row
   states which of the two it is showing. 034 names the probe whose answer must
   be 0 before the follow-up migration drops the column.
   **NOT migrated:** SSN (never exported — it's in FMP and Gusto, and a
   web-reachable database is the wrong home for it), pay rates and everything
   payroll-adjacent, and the Events/Ratings/Reviews/Timesheets tables, which
   FMP keeps writing until their own modules are built. See
   `migration/field-map.md` for the per-field reasons and the traps in each
   child file.
