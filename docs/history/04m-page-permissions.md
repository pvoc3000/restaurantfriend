<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4m. ✅ **PAGE PERMISSIONS — the spreadsheet is code (2026-09-04; migration 092
   NEEDS APPLYING, `sync-square-sales` NEEDS REDEPLOYING).** Mark, inviting the
   first employees: "I put together a spreadsheet with each page listed and how
   I imagine each security level should be able to access them … I LOVE the
   idea of having the spreadsheet be code that I can adjust." The sheet is
   `docs/Page Permissions.xlsx`; the code is **`web/src/lib/pageAccess.ts`**,
   one `row("-","R","W","W","W")` per screen in the sheet's own column order
   (staff · supervisor · purchaser · manager · owner), fixture-pinned cell by
   cell.
   **THREE READERS, ONE TABLE.** `sectionsForRole` (the menu) hides what the
   table hides; `components/PageAccessGate` in the (app) layout says so in a
   sentence for a typed URL ("This screen is open to managers and the owner.
   You're signed in as Staff."); and each page takes its `editable` /
   `canWrite` from `canEditPage(role, "/plans")`. `NavSub.roles` is GONE — it
   was a second copy of the same fact, and a second copy is how the menu and
   the screen came to disagree. `/` lands on `homeHref(role)`: the Locations
   list where the sheet allows it, else the first screen the menu offers.
   **HIDDEN VERSUS UNREACHABLE, and which is which is Mark's call**: "other
   than sensitive info for employees, everything else can be just hidden … I'd
   rather avoid the migration step as much as possible." So outside HR the
   table is the whole gate — a purchaser on /plans is "R" at the screen while
   039's policy still admits them at the table — and tightening is an edit here
   and a deploy. The one thing an edit here can NEVER do is loosen: a screen
   offering a write the policy refuses changes zero rows and reports success.
   **`LOOSENED_BY_092`** lists the six cells that asked for more than the
   policies gave, and the fixture pins them, so the next such cell goes red and
   is recognised as a migration.
   **092** widens: `preq_resolve` → supervisor+; `production_schedules` /
   `_items` / `_par_overrides` writes and `generate_production_schedules` →
   supervisor+ (this is also the bug where a supervisor's closing shift report
   could not generate tomorrow's paper); the 051 select policies on special
   orders and customers → every member (quote tokens stay supervisor+);
   `production_batches` / `_batch_logs` insert+update, the batch-photos bucket,
   `next_batch_number` and `production_operators` → every member (delete stays
   purchaser+, `generate_production_batches` stays supervisor+); and the three
   sales definers → purchaser+. One tightening: `payroll_benefits` select →
   owner/admin, the sheet's Unreachable. Each function is reproduced whole with
   its argument list unchanged (033's overload trap); RERUNNABLE, proved by
   applying it twice on the harness; every widening and every surviving refusal
   verified there as real authenticated roles (staff read an order and update 0;
   staff log a batch and delete 0; a supervisor resolves a request and the
   author cannot mark their own ordered; a supervisor generates and staff are
   refused by name; a purchaser corrects a day and a supervisor is refused;
   anon sees nothing; each reproduced function exists exactly once).
   Predicates that moved in `lib/roles`: `canResolveRequests` (supervisor+),
   `canSyncSales` (purchaser+), `canLogBatch` (every member), plus the new
   `canScheduleProduction` (supervisor+ — `schedule_special_order` is INVOKER
   and now answers to the widened policy, which is what 068's header asked
   for). The Square function's WRITE check is purchaser+ to match.
   Two cross-screen consequences, both deliberate: a purchaser is Read Only on
   Invoices, so "File as bill", the ticked box on Close and "File as invoice"
   all take a `canFileBills` from the INVOICES cell rather than from the PO's
   own gate; and staff are Read Only on Requests, so the New request command is
   withheld from them even though `preq_insert` would take the row.
   **Rows the sheet did not carry keep their old rule and say so in the file**:
   Inspection Logs (supervisor+), Equipment (staff hidden to match the rest of
   Facilities — the one assumption, one letter to reverse), Timesheets
   (unreachable below manager), Cleanup (purchaser+). Reviews, Documents,
   Policies and Tags are stubs and their /soon/ routes carry rows too.
   **THE FIRST HOLE, found by Mark on a staff account within the hour: the
   vendor record's fields were editable.** `VendorFields`, `ItemFields`,
   `VendorItemFields`, `VendorLocationsTable`, `ItemLocationRows` and
   `VendorItemLocations` had never taken an editable flag — they left writes
   to RLS, which for staff means a cell that opens, accepts typing and matches
   zero rows. A "Read Only" cell in the table reached nothing on those screens.
   Fixed by giving **`InlineValue`, `ActiveToggle` and `WeekdayPicker` a
   `readOnly` prop** (a value with `READ_ONLY_VALUE`'s padding and no box; a
   word instead of a switch; the seven boxes as a statement) and threading
   `editable` from the three records — `/vendors`, `/items`, `/vendor-items` —
   into every block. One switch on the control rather than a conditional at
   thirty call sites. **A field block that renders `InlineValue` must take
   `editable`**; grep for the ones that don't before trusting a Read Only cell.
   **Second hole, same hour: the vendors LIST still toggled Active.** It used
   `VendorActiveToggle`, a hand-rolled copy that predated `catalog/ActiveToggle`
   and so never learned `readOnly` — deleted, the list uses the shared part.
   `VendorItemsTable` and `PayrollBenefitsList` rendered the shared toggle
   without the flag; both pass it now. **Every `<ActiveToggle` either sits
   inside an `editable ?` or carries `readOnly={!editable}`** — the sweep that
   found these is `grep -rn -A4 "<ActiveToggle"`.
   **Third hole, on a supervisor: the LISTS' bulk bars and row menus.**
   `ItemsList` and `PurchaseOrderList` offered the selection column, the
   batch bar and a row's Delete to everyone ("RLS is the gate"), so a
   supervisor — Read Only on both — could tick, press, and be told zero rows
   moved. Both take the cell now; `SchedulesList` gates its print selection
   on `stampable` and `InvoiceList` on `canEdit || canApprove`. Swept with
   `grep -rln '<RowMenu\|key: "select"\|checked.size > 0'`; every other list
   already wrapped its commands in `editable`. **A selection column exists for
   its bar; if the bar has nothing a role may press, drop the column too.**
   **Fourth hole, found 2026-09-07 while editing that file for another
   reason: `VendorItemsTable`'s CELLS.** It took `canEdit` and spent it on the
   ⋯ column alone, with a comment saying so — every `InlineValue` in it
   rendered for everyone "and let the database refuse the write", which below
   purchaser+ is a cell that opens, accepts typing, matches zero rows and
   returns NO error. It is the one table that appears on TWO records (a
   vendor's Items tab and an item's Vendor Items tab), so the hole was on both.
   All six cells take `readOnly={!canEdit}` now. The 2026-09-04 sweep listed
   the six components that had never taken an editable flag and this was not
   among them, because it HAD the flag — **so grep for the flag being USED, not
   for its absence.**
   **THE SHEET WAS REVISED THE SAME AFTERNOON** (Mark, on a purchaser account:
   "purchasers should have almost manager access, minus HR"): a purchaser now
   WRITES Plans, Items, Elements, Recipes, Invoices and Customers, and
   Locations is OWNER ONLY — the manager cell went blank, so `/` lands a
   manager on Checklists. Seven cells, no migration: every one of those tables
   already admitted a purchaser. That is the table doing what it was built for.
   **There is no permissions SCREEN** — the table is the file, read on GitHub
   or in the editor; a read-only grid on /settings is the obvious next step if
   Mark wants to see it in the app.
   **TWO SETTINGS, TWO ICONS** (Mark, 2026-09-04: the gear was "available to
   everyone" and showed ORG settings; "the gear icon should be user
   settings"). The masthead's house became a STOREFRONT (`OrgIcon`) opening
   `/settings` — the org's, now `row("-","-","-","W","W")` in the table and
   withheld from the masthead below manager — and the gear opens the new
   **`/account`**: the member's own name (via `setDisplayName` →
   `set_my_member_profile`), email, role, the shops 073 lets them work at,
   and a password change through `supabase.auth.updateUser`, the same call
   /welcome makes. `/account` is UNGOVERNED — there is no role for whom your
   own name is off limits — and both settings screens are exempt from
   `InactiveLocationGate`. The house is gone; the section tabs are the way
   home and `/` still lands per role (`homeHref`'s no-menu fallback is now
   `/account`).
   **Nobody has ever held purchaser or supervisor**, so the first invites are
   the first real exercise of any of this. Expect small holes; each is a cell.
   **1601 fixtures pass**, 17 new.


