# FMP → Restaurant Friend field map

Every column that migrates, and everything that deliberately doesn't.
Source: DF-PO-System.fmp12 (catalog + POs) and DF-Locations.fmp12 (locations).
Weekdays everywhere: ISO 1=Mon … 7=Sun (matches FMP `Get DayNum`; FMP repetition *n* = weekday *n*).

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
| `_VendorItemKey_num` | → `item_locations.default_vendor_item_id` | item-level favorite in FMP |
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

## InventoryLoc → `item_locations` + `item_order_days` (pars) + `shop_sections`

| FMP | Schema | Notes |
|---|---|---|
| `_InventoryKey_num` + `Location` | `item_locations (inventory_item_id, location_id)` | 218 fully blank rows and 5 duplicates dropped (audit) |
| `Shop_Location` | `shop_sections.display_name` + `item_locations.shop_section_id` | leading number → `sort_order`; text split into area / sub-area |
| `Par__array[1]` | `item_locations.default_par` | **in base units.** Par text parsed: package pars ("2 cs", "3 EA") × default vendor item's package_content; measure pars ("5 lbs", "1/2 gal") converted directly; "#"=lbs, "1.5g"/"3G"=gallons |
| `Par__array[2..7]` | `item_order_days.par_qty` (weekday 2–7) | per-day par overrides |
| `isFixed_array[n]` | `item_order_days.par_mode` | `1`→'fixed' |
| `isActive_b` | `is_active` | |
| `Note` | `note` | |
| `OrderDays_array` | **dropped** | 947 of 1242 rows are all-days, 294 all-off — carries no plan info; the real day plan is the OrderGuide favorites |
| `Par_Amount/Unit/Size_array` | **dropped** | used on only 3 rows ever |
| `Shop_LocationID` | **dropped** | FMP-internal UUID |

## OrderGuide → `item_order_days` (favorites) + `vendor_item_location_prices`

| FMP | Schema | Notes |
|---|---|---|
| `_key_VendorItem_num` + `Location` + `isDefault[n]` | `item_order_days.vendor_item_id` for weekday *n* | the per-day favorite. Stored as NULL when it equals the item default (inherit). Conflicts (two favorites, same day) resolved toward the item default — 631 cases in audit |
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
| `smtp_*`, `Path_PO_Dir`, `ShiftReportPages_*`, `commuterBenefit_*`, etc. | **dropped** | dead infra / other modules will re-model |

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

## POItem → `po_items`

| FMP | Schema | Notes |
|---|---|---|
| `_Key_PO_num` | `po_id` | 227 orphan lines dropped |
| `_Key_VendorItem_num` | `vendor_item_id` | NULL when the vendor item was deleted (snapshot fields still carry what it was) |
| `Item` / `Brand` / `ProductID` / `Package` | `description` / `brand` / `product_id` / `package_desc` | snapshots |
| `QTY_Ordered` / `QTY_Received` / `Price` | `qty_ordered` / `qty_received` / `unit_price` | |
| `Item_orderedCount`, `On_Hand`, `SentUnit*`, `QTY_Sent`, `Notes`, date/summary/search fields | **dropped** | session state and rollups |

## Not migrated at all

- **Messages** table (9 rows — transient reminders), **PackingList/PackingListItem** (receiving will be rebuilt), all FMP **globals** (`g*`, `search_*`, `_Current*`), all **calculated/summary fields** (recomputed live by views), custom menus/scripts/layouts (that's the app, not the data).
