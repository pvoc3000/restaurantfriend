# FMP → Restaurant Friend field map

Every column that migrates, and everything that deliberately doesn't.
Source: DF-PO-System.fmp12 (catalog + POs) and DF-Locations.fmp12 (locations).
Weekdays everywhere: ISO 1=Mon … 7=Sun (matches FMP `Get DayNum`; FMP repetition *n* = weekday *n*).

Table names here reflect **migration 005** (2026-07-22 renames: `item_locations`→
`inventory_item_locations`, `item_order_days`→`order_guide_plan_days`, `guide_entries`→
`order_guide_entries`, `po_items`→`purchase_order_items`, `po_attachments`→
`purchase_order_attachments`, `reminders`→`purchase_reminders`). The transformed
**JSON files keep their pre-rename names** (`item_locations.json`, `item_order_days.json`,
`po_items_1/2.json`) — `load.mjs` maps file → table.

## Vendor → `vendors`

| FMP | Schema | Notes |
|---|---|---|
| `_PrimaryKey_n` | `legacy_id` | join key for everything else |
| `Name` | `name` | |
| `VendorType` | `vendor_type` | 'Goods' / 'Services' |
| `Vendor Description` | `description` | |
| `OrderType` | `order_type` | Purchase Order→`email_po` · Online Order→`online` · Shopping List→`in_person` · Requisition→`email_po` · blank→`none` |
| `URL` | `url` | |
| `POPrefix` | `po_prefix` | numbering format itself is an org setting |
| `Notes` | `notes` | |
| `isActive` | `is_active` | `1`→true, blank→false |
| `Minimum` | → `vendor_locations.minimum_order` | vendor-level in FMP; copied to each location row |
| `AccountNumber`, `SalesRep`, `Phone`, `Email` | fallbacks for `vendor_locations.*` | used only where the VendorLoc field is blank |
| `Address`, `LastPOID`, `OrderType` oddities | **dropped** | address unused on POs (ship-to is ours); numbering restarts |

## VendorLoc → `vendor_locations`

| FMP | Schema | Notes |
|---|---|---|
| `Vendor_Key_n` | `vendor_id` | via legacy map |
| `Location_t` | `location_id` | by code (DF01/DF02/DF03) |
| `AccountNumber_t` | `account_number` | falls back to Vendor.AccountNumber |
| `SalesRep_t` / `SalesRep_Phone_t` / `Email_t` | `sales_rep` / `rep_phone` / `rep_email` | same fallback rule |
| `OrderDays_values` | `order_days smallint[]` | day names (any case) → ISO numbers |
| `DeliveryDays_values` | `delivery_days smallint[]` | |
| `isActive_b` | `is_active` | |
| `Address_t` | **dropped** | vendor's remit address; not used by the new PO template |

## InventoryItem → `inventory_items`

| FMP | Schema | Notes |
|---|---|---|
| `_PrimaryKey_num` | `legacy_id` | |
| `Item` | `name` | |
| `Item_Type` | `category` | |
| — | `base_unit` | **derived**: the default vendor item's unit, normalized (lb→lbs, ct→ea); fallback = modal unit family of the item's vendor items; no data → `ea` |
| `Note` | `note` | |
| `isActive` | `is_active` | |
| `_VendorItemKey_num` | → `inventory_item_locations.default_vendor_item_id` | item-level favorite in FMP |
| `Assigned_To`, `Log`, `ToOrder` | **dropped** | session state / future feature |

## VendorItems → `vendor_items`

| FMP | Schema | Notes |
|---|---|---|
| `_PrimaryKey_n` | `legacy_id` | |
| `VendorKey_n` | `vendor_id` | |
| `InventoryItemID` (falling back to `_InventoryItemKey_num`) | `inventory_item_id` | the two disagree on 11 rows — see audit "VI link issues" |
| `ProductID` | `product_id` | |
| `Brand` | `brand` | |
| `Description` | `description` | |
| `Package` | `package_desc` | 'CS', 'BAG', 'TUB'… |
| `UnitAmount` × `UnitSize` (+ `UnitMeasure`) | `package_content` | converted into the item's base unit (e.g. 1×50 lbs → 50). Cross-family units (weight vs volume vs count) → NULL + audit |
| `Price` | `price` | `$`/commas stripped |
| `URL` / `Notes` / `isActive` | `url` / `notes` / `is_active` | |
| `Par` (text) | **dropped** | superseded by per-location pars in InventoryLoc |
| `InventoryDays`, `OrderFrequency`, `StoreSection`, `toOrder`, `OrderedAmount`, `Price_Previous`, `DELETE onInventory`, `Log` | **dropped** | day plan comes from OrderGuide favorites; rest is session state / stale cache |

## InventoryLoc → `inventory_item_locations` + `order_guide_plan_days` (pars) + `shop_sections`

| FMP | Schema | Notes |
|---|---|---|
| `_InventoryKey_num` + `Location` | `inventory_item_locations (inventory_item_id, location_id)` | 218 fully blank rows and 5 duplicates dropped (audit) |
| `Shop_Location` | `shop_sections.display_name` + `inventory_item_locations.shop_section_id` | leading number → `sort_order`; text split into area / sub-area |
| `Par__array[1]` | `inventory_item_locations.default_par` | **in base units.** Par text parsed: package pars ("2 cs", "3 EA") × default vendor item's package_content; measure pars ("5 lbs", "1/2 gal") converted directly; "#"=lbs, "1.5g"/"3G"=gallons |
| `Par__array[2..7]` | `order_guide_plan_days.par_qty` (weekday 2–7) | per-day par overrides |
| `isFixed_array[n]` | `order_guide_plan_days.par_mode` | `1`→'fixed' |
| `isActive_b` | `is_active` | |
| `Note` | `note` | |
| `OrderDays_array` | **dropped** | 947 of 1242 rows are all-days, 294 all-off — carries no plan info; the real day plan is the OrderGuide favorites |
| `Par_Amount/Unit/Size_array` | **dropped** | used on only 3 rows ever |
| `Shop_LocationID` | **dropped** | FMP-internal UUID |

## OrderGuide → `order_guide_plan_days` (favorites) + `vendor_item_location_prices`

| FMP | Schema | Notes |
|---|---|---|
| `_key_VendorItem_num` + `Location` + `isDefault[n]` | `order_guide_plan_days.vendor_item_id` for weekday *n* | the per-day favorite. Stored as NULL when it equals the item default (inherit). Conflicts (two favorites, same day) resolved toward the item default — 631 cases in audit |
| `UnitPrice_num` | `vendor_item_location_prices.price` | only where it differs from the vendor item's global price (135 rows) |
| `shouldOrder[n]`, `Order_Amount`, `On_Hand`, `isNotNeeded` | **dropped** | transient session state from the last FMP ordering session |
| all `OG_*` fields | **dropped** | denormalized display caches — the new system computes these live (`v_order_guide`) |

## Location (DF-Locations.fmp12) → `locations` (backfill of seeded rows)

| FMP | Schema | Notes |
|---|---|---|
| `__Location_ID` | match on `code` | |
| `Location_Name` | `name` | |
| `Address_Shipping_*` / `Address_Billing_*` | `address` jsonb | |
| `Location_OpenDays`, `OperatingHours_Open/Close_time`, `Email_Billing`, `LaborRate_n` | `settings` jsonb | kept for later modules |
| `smtp_*`, `Path_PO_Dir`, `ShiftReportPages_*`, etc. | **dropped** | dead infra / other modules will re-model |
| `commuterBenefit_paysCommuterBenefit_b` / `_amount_n` / `_period_t` | **dropped, and deliberately not restored** | migration 033 puts the entitlement on the (employee, location) pair instead. Measured: the employee's own `commuterReimbLocations` classifies every stamped shift identically, and DF01's flag is on with no amount — the location row carries one redundant bit |

## Employee (DF-Employees) → `employees`

Migration 020. Loaded by `transform-hr.mjs` → `load-hr.mjs`.

**The export in `FMP Export/HR/` is a LAYOUT export and cannot be loaded** — 14
columns, no employee id, no names as separate fields. Re-export from
DF-Employees with **File → Export Records → Merge**, choosing the fields
EXPLICITLY in the dialog (not whatever the current layout shows), character set
**UTF-8** (there are accented names). `transform-hr.mjs` names any column it
can't find and stops.

| FMP | Schema | Notes |
|---|---|---|
| EMPLOYEE ID | `legacy_id` | **the join key** every child table uses (Events, Reviews, Ratings, Timesheets). The most important field in the export |
| `Status` | `status` | Active / New Hire / Inactive → `active` / `new_hire` / `inactive`. FMP: 26 / 2 / 417 |
| LAST NAME / FIRST NAME | `last_name` / `first_name` | the separate fields, NOT `Name_Full_c` — both NOT NULL |
| NICNAME *(sic)* | `nickname` | |
| `Phone` / `Email` | `phone` / `email` | |
| ADDRESS | `address` | one text blob; nothing reads it structurally, so it isn't split |
| DATE OF BIRTH | `date_of_birth` | M/D/YYYY → ISO |
| `Location` | `main_location_id` | DF00–DF03 codes, resolved against `locations` at load. Where they mostly work — NOT an access restriction |
| `Schedule` | `schedule` | Part Time / Full Time / ± → `part_time` etc. FMP's "N-A" → null |
| EMPLOYMENT TYPE | `employment_type` | free text |
| `Start_Date` | `start_date` | |
| END DATE | `end_date` | **FMP has none** — 417 former employees and no record of when they left. Nullable, filled going forward |
| `Position` | `position` | 20 free-typed values; the transform folds typo-duplicates (`Sr.DF` → `Sr. DF`) and prints the before→after table for review. Not a check constraint — the vocabulary grows |
| NOTES | `notes` | |
| `FHC_Ex_Date` | `food_handler_expires` | legally relevant, maintained (dates run to 2028) |
| USER LEVEL (ADMIN tab) | *(roster only)* | kept in the JSON as `_fmp_user_level` to seed the invite list; never loaded into a column |
| — | `user_id` | **derived**: null for everyone at load except Mark, whose row is linked to his existing auth account. Access is granted afterwards, per person, by invitation |
| **SSN** | **dropped** | never exported. It is in FMP and in Gusto, which needs it for W-2s; nothing this app does requires it, and a web-reachable database is the wrong home for it |
| pay rates, rate card, EARNS TIPS, CalSavers, POS PIN, payroll name overrides | **dropped** | the payroll module's business — rates are also on every timesheet row |
| `commuterReimbAmount` / `commuterReimbUnit` / `commuterReimbLocations` | **RESTORED 2026-08-05** | dropped with the line above and that was wrong — the benefit is live, not vestigial (17 configured, 4,663 shifts stamped, $432 in the current Gusto file). `backfill-employee-benefits.mjs` reads the `.mer` directly into `employee_benefits` (migration 033), one row per (person, shop). `transform-hr.mjs` is untouched: it feeds a load that has already run |
| USERNAME / PASSWORD (ADMIN tab) | **dropped** | stored in plain text in FMP. Replaced entirely by the invite flow; no credential is ever stored here |
| DEFAULT LOCATION / ACCESS LOCATIONS | **dropped** | per-location access is deliberately not built yet (Mark wants to revisit it) |
| COVID19 vaccination status, `hasHealthCare_b` | **dropped** | 2021 artifact; the healthcare flag only ever stored `1`, so an unchecked box is indistinguishable from an unanswered one |
| `cTenure`, `cRatingSummary`, `ReviewLast_Date` | **dropped** | FileMaker calculations, not stored data. Derivable once the ratings and reviews tables migrate |
| onboarding paperwork checkboxes (Application, W4, I9, I9 Documents, Food Handlers Card, Handbook, Notice to Employee, Training Acknowledgement), MEALBREAK WAIVER | **dropped** | replaced by `employee_documents` (021) — the flags are DERIVED from which documents are actually on file, so "complete" can't be true without them |

## Not migrated yet (DF-Employees)

`Events` (2,398), `Ratings` (44,214), `Reviews` (121), `PayPeriods` (283),
`Timesheets` (75,381) all stay in FileMaker for now — FMP keeps writing them
until each module is built, so they're re-exported at that module's cutover
rather than loaded twice. Notes for when that happens:

- **Events** key on `EmployeeID`; `Name_Full_c` there is the AUTHOR, not the
  subject. Its `EventType` vocabulary drifted over twelve years and has three
  merge pairs (`Negative`/`Negative Event`, `Positive`/`Positive Event`,
  `Incident`/`Incident Report`). The 81 rows typed **`Document`** (2024+, 73 of
  them flagged as having a paper original) are the filing-cabinet use that
  `employee_documents` now covers — those migrate there, not into an events
  table.
- **Ratings** has **two columns literally named `Name_Full_c`** (subject and
  rater); a header-to-dict parser silently drops one. `break_confirmed_b` is
  corrupt in 59% of rows (`0\x0b1`, two values flattened together), and
  `Document_Category_txt` is entirely empty.
- **Reviews**' category labels (`PA_Cat01`–`PA_Cat10`) are NOT in the export —
  they were layout text — so the scores are meaningless until the rubric is
  recovered.
- **PayPeriods.mer** is 99.99% padding: 2.7M blank records around 283 real ones.
  Filter while streaming.
- **Timesheets** carries 16 columns that are file-wide totals repeated on all
  75,381 rows (~15 MB of the 43 MB). Discard them.

## PO → `purchase_orders`

| FMP | Schema | Notes |
|---|---|---|
| `_PrimaryKey_num` | (loader-internal map) | |
| `PO_Number` | `po_number` | blank → `LEGACY-<id>`; duplicates → `-<id>` suffix (must be unique) |
| `_Key_Vendor_num` | `vendor_id` | |
| `PO_Location` | `location_id` | **blank (2014–2018) → DF01** — the only shop that existed |
| `PO_Date` / `PO_DeliveryDate` | `order_date` / `delivery_date` | M/D/YYYY → ISO |
| `PO_wasReceived` / `PO_wasProcessed` | `status` | received→'received', processed→'sent', neither→'draft' |
| `PO_Type` | `sent_via` | PO→email · Online→online · Shopping List→shopping · Requisition→print |
| `PO_Notes` / `PO_SentNotes` | `notes` / `sent_notes` | |
| `Vendor_*`, `Location_*` snapshots, `CSV`, totals, globals | **dropped** | recomputable / display caches |

## POItem → `purchase_order_items`

| FMP | Schema | Notes |
|---|---|---|
| `_Key_PO_num` | `po_id` | 227 orphan lines dropped |
| `_Key_VendorItem_num` | `vendor_item_id` | NULL when the vendor item was deleted (snapshot fields still carry what it was) |
| `Item` / `Brand` / `ProductID` / `Package` | `description` / `brand` / `product_id` / `package_desc` | snapshots |
| `QTY_Ordered` / `QTY_Received` / `Price` | `qty_ordered` / `qty_received` / `unit_price` | |
| `Item_orderedCount`, `On_Hand`, `SentUnit*`, `QTY_Sent`, `Notes`, date/summary/search fields | **dropped** | session state and rollups |

## Not migrated at all

- **Messages** table (9 rows — transient reminders), **PackingList/PackingListItem** (receiving will be rebuilt), all FMP **globals** (`g*`, `search_*`, `_Current*`), all **calculated/summary fields** (recomputed live by views), custom menus/scripts/layouts (that's the app, not the data).
