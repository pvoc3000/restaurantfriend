<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

3. ✅ FMP → Postgres migration (`migration/`) loaded; web catalog admin shipped.
   **THE INVENTORY LIST'S COMMANDS ARE ONE ACTIONS MENU** (Mark, 2026-09-11,
   the third list in a day), in the title row where the create command already
   rode, and in **FOUR GROUPS** — he added the rules one at a time once he had
   it in front of him, and the shape they arrived at is the one to keep:
   **New Inventory Item**, which is the only row here that does not read the
   selection · **Deactivate Here (DF01)** and **Deactivate Everywhere** (red) ·
   **Duplicate Selected** and **Delete Selected…** · **Clear Selection** alone,
   being housekeeping rather than a command against the catalog.
   That is three rules where the other two lists have one, and it earns them:
   this menu holds six commands against their five and four, and its two pairs
   are genuinely different verbs — take it off the guide, versus copy or
   destroy the record. The selection bar is
   gone — its "N selected" only restated the ticks — and its error moved to the
   band slot, red on the mark fill, the purchasing lists' placement.
   `NewInventoryItem` hands its row out through a render prop and keeps owning
   its dialog, duplicate warning and write (`OrderCommandMenu`'s arrangement).
   **FLAT, NOT A "Deactivate ▸" SUBMENU**, which is where it departs from the
   PO list's "Mark ▸": two variants do not earn a submenu — that one groups
   three and Documents four — and the destructive half of this pair deserves to
   be VISIBLE rather than a hover away, which is the opposite of what hiding it
   would achieve.
   **NOTHING IS RENDERED BELOW purchaser+**, unlike the invoice list's, because
   every row here WRITES: there is no read command to keep the menu meaningful,
   so an empty one would be worse than none — and the selection column stays
   gated for the same reason, where the invoice list's had to widen.
   **DUPLICATE SELECTED AND DELETE SELECTED JOINED IT THE SAME DAY** (Mark),
   as their own group — and they are **the ROW MENU'S OWN COMMANDS over the
   ticked rows**, not a second implementation.
   `InventoryItemActions` took `itemId` and now takes `items: ItemTarget[]`,
   keeping its usage count, its "Deactivate instead" offer and its whole
   confirm dialog, and handing the list its two rows through the same render
   prop `NewInventoryItem` uses. That is the PO list's rule and its reason: what
   gets remembered in one copy and forgotten in the other is the confirm and the
   row-count check, and here the confirm is a dialog that counts what a delete
   would cascade.
   **A BATCH DUPLICATE GROWS ITS OWN TAKEN-NAMES LIST**, which is the one thing
   a naive loop gets wrong: `duplicateTitle` avoids the names it is given, so
   passing the same list three times makes three items called "… copy". It runs
   sequentially for that reason, LANDS ON THE COPY ONLY WHEN THERE IS ONE (nine
   copies have no single destination), and a failure part way through keeps what
   it made and says "Copied 3 of 9, then stopped" — each copy is its own tree of
   writes with no transaction spanning them, and pretending otherwise would be
   worse than the truth.
   The dialog counts the whole selection and speaks in the plural ("These items
   are stocked at 6 locations"), naming the first four so you can tell the
   selection is the one you meant. `scope="selection"` is wording only.
   Verified live at 1440 — the panel's own DOM read in order, which is the only
   way to see a rule (each row is WRAPPED, so measuring a row's `border-top`
   measures its wrapper and reports 0 on every one): three `role="separator"`
   rules in the four-group arrangement above. Plus 403 rows and 403 checkboxes,
   every row dead with nothing ticked and live with three, the batch confirm reading "3 inventory
   items · Activated Charcoal, Advil, Agar, Powdered" over 6 per-location rows,
   15 vendor items and 2 production elements — cancelled, nothing written — the
   row menu still reading "Duplicate"/"Delete…" with its hints, and New
   Inventory Item opening its dialog through the render prop.
   `/cleanup` queue (live from DB, per-location + all-locations, 3 problem
   checks, burn-down) with inline fix editors (package content w/ unit
   conversion, price, par — one per offending FAVORITE); multi-favorite plan-row grid
   editor (schema 003); last-ordered triage (view `v_item_last_ordered`,
   per-location, staleness chips, bulk-deactivate with "inactive everywhere"
   follow-up). Then brief §D: Inventory list + item detail, vendor detail with
   editable per-location config, vendor items everywhere.
   **THE VENDOR'S ITEMS PANE ENDS AT THE FOOT OF THE WINDOW** (Mark,
   2026-09-07) — `DataTable`'s new `fillViewport`, which swaps
   `useFillViewportHeight`'s CAP for `useExactViewportHeight`'s definite height
   on a `scroll` pane. **The two are identical on a list that already
   overflows**, which is the case you normally see and why measuring first
   mattered: at 720, 900 and 1000 the pane already reached 32px above the
   bottom (the layout's own `py-8`) with the page not scrolling. What the cap
   leaves content-sized is a SHORT list — filtering BakeMark's 95 items to 3
   collapsed the pane 528px → 128px and stranded it at the top of a screen of
   white, and a vendor that simply has six items does the same thing with no
   filter at all. Measured after: 528.5px at 95 rows and at 3, page not
   scrolling either way.
   **NOT the default for `scroll`**, which is the wrapper's own note being
   respected rather than overruled — dropping `min-h-64` was deliberate so that
   "a short table is as tall as its rows and a long one stops at the window",
   and that is right for a pane with a page under it and wrong for one that IS
   the screen. `fill` (invoice detail, where the parent decides) still wins over
   both, and `/events` keeps the cap.
   Note the pane has NO BORDER, so on a short list what changes is the layout
   holding still as you filter rather than anything you can point at; if a stub
   table under a full-height pane ever wants marking, that is a frame and a
   separate decision.

   **THERE WAS NO WAY TO ADD A VENDOR ITEM** (Mark, 2026-09-07: "we seem to
   have lost a way to add a vendor item. Should at least be a button on the
   vendor detail screen"). The only `insert` into `vendor_items` anywhere in
   `web/src` was the ⋯ menu's DUPLICATE — so a vendor's FIRST item could not be
   created at all, there being nothing to copy. Every one of the 2,888 rows came
   out of the FileMaker load, which is why months passed without anyone hitting
   it: design rule 1's lesson in a second costume ("a create that a loader also
   performs is a create nobody has tested"), except here the loader was the only
   creator there had ever been.
   **`NewVendorItem` ASKS FOR ONE LINE OF A VENDOR'S PRICE LIST**, which is what
   you are holding: SKU, brand, their wording, the pack, the price. The create
   convention says ask for the fields the rest of the app reads and stop, and
   here that reduces to the same thing.
   **THE INVENTORY ITEM IS THE ONLY REQUIRED FIELD.** An unlinked vendor item is
   a real state — 71 came out of FileMaker that way — but it is on NO order
   guide until it is linked, so deliberately creating one is creating a row that
   does nothing. Everything else is editable in the grid behind you and on the
   record you land on.
   **IT ASKS FOR THE PACK, NOT THE CONTENT**, and derives `package_content`
   exactly as the record does: "4 × 2.5 lbs" on an item counted in lbs writes
   10, shown live beside the fields. Where the pack cannot reach the base unit
   the derivation refuses rather than guessing, and the content is left for the
   record's own cell — which is where Recalc lives. `InventoryItemChooser`'s
   `ChosenItem` gained an OPTIONAL `base_unit` for this: a pack can only become
   a content once you know what the ITEM is counted in, and the two callers that
   build a `ChosenItem` from a row they already hold have neither the unit nor a
   use for it.
   The command sits on the Items tab's heading line, right-aligned — measured to
   the same pixel as the columns eye (1232 at 1440) — and lands on the new
   record with the crumb back. Walked live on BakeMark and left as found: a test
   row created with `4 × 2.5 lbs (10 lbs)`, then deleted, back to 95 items.
   **THE MIRROR SHIPPED 2026-09-08** (Mark: "add a new vendor item from the
   vendor item tab of the inventory detail screen… creates a new vendor item
   with the current inventory item set by default"), which is what that note
   predicted in as many words.
   **TWO DOORS, ONE `NewVendorItem`.** A vendor item is the join of a vendor and
   an inventory item, so it can be created from either end; pass `vendor` or
   `item` and the dialog asks for the other, after which every field, the pack
   derivation, the `org_id`, the landing and the confirm are identical. Two
   components would be the `ui/Dialog` story again — those are exactly the
   things remembered in one copy and forgotten in the other.
   **THE ITEM DOOR OFFERS EVERY VENDOR, inactive ones marked and sunk**, with
   `activateTable="vendors"` so choosing one asks to revive it first
   (`NewInvoice`'s pairing). Filtering them out would hide a supplier you have
   just started using again from the one screen you would look on — and would
   also let a new item land under a vendor whose items this tab HIDES, so the
   record would vanish from the list it was created on.
   **THE DUPLICATE WARNING IS A DIFFERENT QUESTION AT EACH END**: a SKU already
   on this vendor's list, or a vendor already supplying this item. Both warn and
   let you through (`findPossibleRehires`' rule) — a second pack size from one
   vendor is an ordinary thing to record. The item end reads the tab's own rows,
   so it knows only the ACTIVE vendors; that blind spot is covered by the
   reactivation prompt, which is the louder question anyway.
   **THE CAPTION MOVED OUT OF THE HEADING'S CELL.** `items-end` levels BOXES, so
   with the heading and its two-line note stacked in one cell the button dropped
   beside the CAPTION and stopped reading as the heading's command. Heading and
   button on one line, caption on its own beneath. Measured at 1440 and 1280:
   the button's right edge is the table's, and heading and button bottoms are
   the same pixel.
   Walked live on Flour, All Purpose and left as found (13 rows, 11 under active
   vendors): the BakeMark warning fired, a real row was created under Action
   Sales with the pack deriving `= 25 lbs` from the item's own base unit, landed
   on the record with the crumb back to the tab, and was deleted.

   **THE VENDOR ITEM RECORD HAD ONE INBOUND LINK IN THE WHOLE APP** (Mark,
   2026-09-07: "where is the best place to edit a vendor item? I'm missing a lot
   on the item tab of the vendor detail page"). He was right, and the cause was
   worse than missing columns: NEITHER grid linked to `/vendor-items/[id]`. The
   pinned column names the OTHER parent — the inventory item on a vendor's
   screen, the vendor on an item's — so the only screen carrying the PACK
   (count × size unit, with the content beside it and Recalc), the PER-LOCATION
   block (favorite days, price override, item par, last ordered) and the PRICE
   HISTORY was reachable only from the order guide. `VendorItemActions` already
   said so in as many words, in the note explaining why "unlinked" had to become
   a control.
   **THE THREE SURFACES, and which is for what.** The RECORD is where a vendor
   item is edited — it has every field. The two GRIDS are for scanning and
   correcting one cell across many rows, and each leaves out exactly what a
   fixed-width row cannot hold. Neither is a subset of the other by accident;
   they are a list and a record.
   **"Open vendor item" is the first entry of the ⋯ menu**, and the ⋯ column now
   renders FOR EVERYONE — the Page Permissions sheet gives `/vendor-items` an R
   to staff and supervisors, so gating their only way in on a write permission
   would hide a screen they may read. Below purchaser+ the menu holds that one
   entry and nothing else. It is a `router.push` rather than an `<a>`, because
   `MenuCommand` has only `onSelect`; the cost is cmd-click, which is worth one
   menu entry and not worth an href on every menu in the app.

   **THE VENDOR ITEM'S CONTENT IS EDITABLE FROM THE GRID** (Mark, 2026-09-07:
   "I need to be able to edit the content field from the vendor item tab on the
   inventory item detail screen"). `package_content` had been read-only in
   `VendorItemsTable` since 2026-07-29 on the reasoning that it is DERIVED from
   the pack beside it, so a second hand-typed copy is only a way for the two to
   disagree — while the vendor item's own RECORD has always offered exactly this
   cell as a plain number you type. So the rule was never "this number is
   computed", it was "the record is where you type it", which is a rule about
   WHERE, and it cost a trip to another screen for a correction you are looking
   straight at. It is ONE shared table, so the vendor record's Items tab gets it
   too: making a cell editable on one of the two screens it appears on is the
   "I edited this and it only changed here" complaint waiting to happen.
   **What the original note was RIGHT about survives** — a typed content can
   silently disagree with the pack on the row, and nothing in the grid shows the
   pack. `RecalcContent` on the record is what surfaces that: it renders only
   when the two differ, and names the number it would write.
   The cell NAMES ITS OWN UNIT (`Content in lbs`), which matters on the VENDOR
   screen where every row is a different item and so a different `base_unit`;
   and it keeps `qty`'s trimming as a `format`, so a numeric column's "50.000"
   still reads 50 at rest while editing shows the raw number.
   Verified against the live catalog and left as found: Restaurant Depot's All
   Purpose Flour 50 → 45 → 50, with the derived Unit price moving $0.22 → $0.24
   → $0.22 per lb, which is what proves the write reached the database rather
   than the cell.
