# Picklist option sets

A sweep of every picklist in `web/src` on 2026-10-08: each `ui/PickList`, each
`InlineValue kind="pick"`, and the generic `ui/FilterMenus` menu. 263 call
sites in 128 files. The call sites were extracted by script; the grouping into
sets below was done by hand from that list, so treat a count as right to
within one or two.

| Group | Call sites |
| --- | --- |
| Fixed lists written in code | 80 |
| Lists that grow from the data | 34 |
| Record pickers (choose a row) | 68 |
| QuickBooks and Square lists | 15 |
| Filters and view menus | 50 |
| `/interface` specimens (not real fields) | 16 |

"Type new" means the field accepts a value that is not on the list.

## 1. Fixed lists written in code

| Option set | Options | Uses | Where | Type new |
| --- | --- | --- | --- | --- |
| Unit (`UNIT_PICK_OPTIONS`, `lib/units`) | Measurement units grouped Count · Weight · Volume · Packages | 11 | Inventory item base unit (record, New Item) · vendor item pack unit (record, New Vendor Item) · batch amounts · element stock unit · item component unit · recipe line unit (2) · Add Ingredient · shift report "made" unit (adds "batch") | Yes, except the item's base unit and the vendor item record |
| Sold as (`PACKAGE_DESC_OPTIONS`) | CS · EA · BAG · TUB · BOX · GAL · QT · SLEEVE · TRAY · FLAT · ROLL | 4 | Vendor item record · vendor items table · New Vendor Item · Add PO Lines (one-off) | No |
| How orders are placed | Email PO · Online · In person · None — directory only | 2 | Vendor record · New Vendor | No |
| PO status | Draft · Sent · Received · Closed · Void | 1 | Purchase order record | No |
| Attachment kind (purchasing) | Invoice · Packing Slip · Photo · Other | 3 | PO attachments · bill document pane · tablet Scan Bill | No |
| Bill kind | Bill · Credit memo | 1 | Bill record | No |
| What to add | This vendor's items · One-off item | 1 | Add PO Lines | No |
| Request priority | High · Normal · Low | 2 | Purchase requests list · New Purchase Request | No |
| Employee status | Active · New Hire · Inactive | 2 | Employee record · New Employee | No |
| Employee schedule | Part Time · Part Time + · Full Time · Full Time + | 2 | Employee record · New Employee | No |
| App role | Manager · Purchaser · Supervisor · Staff | 2 | Employee App Access (current member, invite) | No |
| Employee document kind | Application · W-4 · I-9 · I-9 Documents · Food Handler Card · Employee Handbook · Notice to Employee · Orientation · Meal Break Waiver · Training Acknowledgement · Performance Review · Write-up · Other | 3 | Employee documents · New Event "File it as" · tablet Scan Employee | No |
| Event kind | Attendance · Call Out · Verbal Warning · Written Warning · Incident · Positive · Negative · Check-in · Note | 2 | Employee events · New Event | No |
| Shift | Opening · Mid · Closing · Off-site | 7 | New Checklist Template · template shift set · Start Walk (adds "No shift") · New Task and task row (add "Any shift") · New Shift Report · shift report Info page | No |
| Weekday | Mon … Sun | 1 | New Checklist Template | No |
| Checklist kind | Checklist · Walkthrough · Inspection | 2 | Template record · New Checklist Template | No |
| Answer type | Tick · Number · Text · Choice | 2 | Template items table · Add Template Item | No |
| Task priority | High · Normal · Low | 2 | Tasks list · New Task | No |
| Location kind | Physical · Virtual | 2 | Location record · New Location | No |
| Element kind | Made · Purchased · Manual | 2 | Element record · New Element | No |
| Element schedule | Weekly · Donut · Ice Cream | 1 | Element record | No |
| Batch status | To Do · In Progress · Complete · Skipped · Test | 2 | Batch record · batch log table | No |
| Batch of the day | 1 · 2 · 3 · 4 · 5 | 1 | New Batch | Yes |
| Days to generate | 1–7 · 10 · 14 · 21 · 28 days | 1 | Generate Schedules | No |
| Shift rating score | 5 · 4 · 3 · 2 · 1 · 0 | 1 | Shift report Ratings page | No |
| Premium decision | Owed · Waived · Not Owed | 1 | Timesheet shift decisions | No |
| Tip pool | Inherit · in pool · excluded | 1 | Timesheet shift decisions | No |
| Benefit frequency | Per Shift · Per Day · Per Pay Period | 2 | Benefits list · Add Benefit | No |
| Gusto column (`EARNING_COLUMNS`) | bonus · commission · cash_tips · correction_payment · commuter benefit · distributed service charges · premium · reimbursement | 2 | Benefits list · Add Benefit | No |
| Payment type | Square Invoice · Square Online · Square Refund · QuickBooks Payments · QuickBooks Refund · Cash · Check · Comp · Legacy | 4 | Order payments · New Payment · invoice Record Payment · batch Record Payment | Yes |
| Invoice line type | Delivery · Item | 1 | Customer invoice other charges | No |
| Square item | Special Order · Wholesale Order | 2 | Invoice orders · New Special Order "Sold as" | No |
| Pickup or delivery | Pickup · Delivery | 2 | Order fulfillment cell · New Special Order | No |
| Special order record kind | Order · Template · Standing order | 1 | New Special Order | No |
| Special order attachment kind | Signed Quote · Picture · Document | 1 | Order documents | No |
| Completion date | Order initiated · Quote sent · Quote approved · Invoice sent · Invoice paid · Delivery scheduled · Receipt sent · Order printed · Order scheduled | 1 | Special orders batch actions | No |
| How much to record | Paid in Full · another amount | 1 | Special orders batch Record Payment | No |
| QuickBooks environment | Sandbox · Production | 1 | Accounting settings | No |

## 2. Lists that grow from the data

These offer whatever values are already stored, so the list is as tidy as the
data. Most accept a new value.

| Option set | Comes from | Uses | Where | Type new |
| --- | --- | --- | --- | --- |
| Item category | `inventory_items.category` | 2 | Item record · New Item | Yes |
| Vendor type | `vendors.vendor_type` | 2 | Vendor record · New Vendor | Yes |
| Position | `employees.position` | 4 | Employee record · New Employee · checklist item "who does it" · shift report Ratings | Yes |
| Employment type | `employees.employment_type` | 1 | Employee record | Yes |
| Wage type | `employees.primary_wage_type` | 1 | Employee payroll | Yes |
| Event outcome | outcomes already recorded | 1 | New Event "What was done about it" | Yes |
| Inspection type | `inspections.inspection_type` | 2 | Inspection record · New Inspection | Yes |
| Equipment kind | `equipment.kind` | 2 | Equipment list · New Equipment | Yes |
| Shop section area | `shop_sections.area` | 2 | Shop sections table · Add Shop Section | Yes |
| Document category | org documents' categories | 1 | New Document | Yes |
| Recipe type / element type | `production_recipes.recipe_type` (plus "Ingredient" for elements) | 3 | Element record · New Element · New Recipe | Yes |
| Production item taxonomy | Type · Cut · Finish · Size · Price tier · Price class, each from `production_items` | 3 call sites, 6 fields | Production item record · New Production Item · schedule lines | Yes |
| Special order line taxonomy | Donut · Type · Cut · Finish · Size, from the menu | 5 | Order lines | Yes |
| Plan category band | bands on the plan | 2 | Plan matrix (add tray row, edit) | Yes |
| Batch size label | the recipe version's scale labels | 1 | Batch record | Yes |
| Tax rate | the shop's tax rates | 1 | Order totals | Yes |

## 3. Record pickers

Each chooses one row of a table. "Inactive" means retired rows are listed
under their own heading.

| Chooses a | Uses | Where | Notes |
| --- | --- | --- | --- |
| Location / shop | 16 | Working location (masthead) · employee main location (record, New Employee) · plan "Sells at" (record, New Plan) · plan matrix kitchen · schedule location cell · Production Day shop · bill location · employee benefit shop · location access · New Event shop · New Document shop · New Timesheet shop · copy checklist template to shop · special order pickup location | Shown by code, name as the hint |
| Employee | 9 | Batch operator · shift report "Prepared by" (2) · shift report supervisor · add employee to ratings · New Timesheet · Import Timesheets link · order "Taken by" · tablet Scan Employee | |
| Shop section | 8 | Item per-location row · equipment (record, list, New) · checklist item (table, Add) · task (row, New) | Always leads with "No section" |
| Vendor | 7 | New Vendor Item · bill (record, New Bill) · New Purchase Order · tablet Scan Bill · equipment "Serviced by" (record, list) | Inactive listed; equipment leads with "Nobody set" |
| Element | 6 | Item component · New Batch · New Recipe "Makes" · recipe Makes field · Add Ingredient · recipe line | Inactive listed; an ingredient may also be a typed name |
| Production item | 5 | Tag (record, New Tag) · plan matrix (add to tray, add donut, edit donut) | Inactive listed |
| Inventory item | 3 | Vendor item (record, table) · purchased element | Inactive listed |
| Equipment | 3 | Checklist item · task (row, New) | Leads with "Nothing in particular" |
| App member | 2 | Task "Assigned to" (row, New) | Leads with "Anybody" |
| Recipe version | 2 | Batch recipe version · recipe record's version menu | |
| Attachment / document | 2 | Bill document pane · New Event "A document already on file" | |
| Recipe | 1 | Element's Link Recipe | Hint says what it makes today |
| Payroll benefit | 1 | Add Employee Benefit | |
| Pay period | 1 | Timesheets period bar | |
| Checklist template | 1 | Start Walk | |
| Bill | 1 | Tablet Scan Bill | |

## 4. QuickBooks and Square lists

Read live from the connected account.

| Option set | Uses | Where |
| --- | --- | --- |
| QuickBooks item | 4 | Accounting settings: customer invoices · wholesale lines · delivery · rush |
| QuickBooks account | 3 | Accounting settings (bills) · vendor at a location · Square sales mappings |
| QuickBooks class | 2 | Vendor at a location · location integrations |
| QuickBooks location (department) | 2 | Vendor at a location · location integrations |
| QuickBooks vendor | 1 | Vendor at a location |
| QuickBooks customer | 1 | Customer accounting |
| QuickBooks tax code | 1 | Accounting settings |
| Square catalog variation | 1 | Square item setting |

## 5. Filters and view menus (50)

These change what a list shows and store nothing. Every list screen has one or
more: Active / Inactive / All (items, vendors, the shared list filter), "Which"
status menus with counts (bills, POs, requests, checklists, tasks, shift
reports, batch logs, plans, recipes, tags, timesheets, events), Group by menus
(order guide, schedules, schedule lines, batch logs, batch items, plan trays,
timesheets, order lines), and per-screen ones such as Last ordered, Due,
Layout, the price grid's shop, and the pay period.

## 6. Things the sweep turned up

1. **Answer type is defined twice, and the two disagree.** The template items
   table offers Tick · Number · Text · Choice; Add Template Item offers only
   Tick · Number · Text, so a Choice item cannot be created there.
2. **Location kind is written out twice with different wording.** New Location
   says "Physical — a building you walk into"; the location record says
   lowercase "physical — a shop with shelves".
3. **Active / Inactive / All is declared twice** (`ListFilters` and
   `VendorsList`), identical today.
4. **The shift list is declared three times** (`SHIFT_SLOT_OPTIONS` in
   `lib/employeeEvents`, and a local `SHIFT_OPTIONS` in New Shift Report and
   the Info page), identical today.
5. **High · Normal · Low exists as two separate lists** (tasks, purchase
   requests), each also built inline at both of its call sites.
6. **"No section" + sections is assembled inline in six places**, and
   Benefit frequency and Gusto column in two each. None is wrong; each is a
   place a future change could miss.
7. **Payment type accepts typed values at all four sites**, so anything typed
   there is stored beside the nine fixed types.
