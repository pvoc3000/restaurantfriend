<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->


The cleanup work is specced in `docs/catalog-cleanup-brief.md` (v2 = §A
multi-favorites + §B last-ordered triage). Cleanup checks live in
`web/src/lib/cleanup.ts`; unit conversion in `web/src/lib/units.ts`;
last-ordered buckets in `web/src/lib/lastOrdered.ts`. Schema: migration 003
makes `order_guide_plan_days` unique per (item, weekday, **vendor_item**) — multiple
favorites per day (multi-vendor sourcing / pack-size variants), so the guide
groups lines by inventory item. (003 also made `par_qty` a per-VENDOR-ITEM par —
a distinction FMP never had and the data never used; migration 009 undid it.)
Migration 004 adds the last-ordered view (per-location semantics: "last ordered
AT this location"). Migration 005 renames tables for clarity — see
"Table naming" under Conventions; docs/purchasing-spec.md §5 predates the
renames, translate via that mapping when reading it. Migration 006 adds
`po_number_seq` + `next_po_number()` for PO generation and 007 sets
`orgs.settings.timezone` (the order guide derives "today" from it — without it
a UTC host rolls the guide date at 5pm local). Migration 008 stores item order
days on `inventory_item_locations.order_days`, makes plan-row `vendor_item_id`
NOT NULL (materializing the old null-means-default rows), and recreates
`v_order_guide` at item-location × vendor item × weekday grain with
`should_order` / `is_favorite` / the three day arrays. Migration 009 returns
per-weekday par to `inventory_item_locations` (`par_by_weekday` /
`par_fixed_by_weekday`, slot n = weekday n, mirroring FMP's `Par__array` +
`isFixed_array`) and drops `par_qty` / `par_mode` from plan rows, leaving the
plan row a PURE FAVORITE record with no payload — so un-favoriting a day can no
longer destroy a par. The view's output is unchanged (`par_qty` / `par_mode`
still, just sourced differently), so no app code changed for par.
Migration 012 retires `inventory_item_locations.default_vendor_item_id` — dead
since 008 and read only by the cleanup checks that complained about it.
Migration 014 makes `v_item_last_ordered` security DEFINER with an explicit
`il.org_id in (select user_org_ids())` guard. 004 had made it
`security_invoker`, which evaluates four tables' RLS inside an aggregate over
104,669 `purchase_order_items` rows — measured 2026-07-26 at 4,336ms in-app vs
160–250ms for the identical query under `service_role`. **APPLIED and verified
2026-07-26**: `/items` 6.5s → ~0.8s, `/cleanup` → ~2.6s, and the data is
unchanged (452 dated + 338 null = 790 items at DF01).
**Footgun it introduces:** `service_role` now reads this view as EMPTY, because
`user_org_ids()` has no `auth.uid()` to resolve. A local audit script will
conclude "nothing was ever ordered" and be wrong — query
`purchase_order_items` directly from those scripts, or set the guard aside
deliberately. Any future definer view carrying a `user_org_ids()` guard has the
same property.

Migration 015 gives `purchase_order_items` its own `notes` column — the
ordering note §4.9 prints on each line, which until now was read LIVE from
`vendor_items.notes` at render time and was the one field on a PO line that
wasn't a snapshot (so editing the catalog rewrote orders sent months ago, and
deleting a vendor item erased the note from its own history). 015 adds the
column, BACKFILLS DRAFTS ONLY (history is left alone — a sent PO's document is
whatever was sent), and recreates 013's function to snapshot `vi.notes`
alongside the description. The note is editable per line on PO detail, which is
the point: strike it off this order without touching the catalog entry every
future order inherits (Mark, 2026-07-28). Fixture-tested in the Docker harness —
snapshot on generation, catalog edit doesn't touch the order, line edit doesn't
touch the catalog, backfill skips non-drafts.

Migration 016 makes a generated PO know when it arrives: `next_delivery_date`
(immutable, `((day - isodow + 6) % 7) + 1`, so the answer is STRICTLY after the
order date — a Tuesday order to a Tuesday-delivering vendor arrives the
following Tuesday) and a recreated generation function that fills
`purchase_orders.delivery_date` from `vendor_locations.delivery_days`. Null when
the vendor has no delivery days (13 of DF01's 56 vendor-locations), which is
what the Process card's date input is still for. Drafts are backfilled, history
isn't. Same arithmetic as the suggestion chip it replaces
(`lib/poProcessing.ts` `nextDeliveryDate`) — if one changes, change both.

Migration 017 makes the location a real record — the FMP fields that were
dropped or left as raw text get TYPED COLUMNS on `locations`: `tax_rate`
(a FRACTION, 0.0975, shown as a percentage), `labor_rate`, `register_count`,
`open_days` (the same ISO smallint[] `WeekdayPicker` writes), the seven-slot
`open_time_by_weekday` / `close_time_by_weekday`, and the production mapping
`kitchen_by_weekday` (seven slots) / `shops_for`. Every per-weekday array
copies 009's `par_by_weekday` — slot n = weekday n, with the same
`is null or array_length = 7` guard — so weekday indexing reads the same
everywhere in the schema. Not more `settings` jsonb: these are structured facts
of the same class as `vendor_locations.order_days`, and a column is what the
existing inline controls know how to write. **After the backfill,
`locations.settings` holds `email_provider` and nothing else** (today, nothing
at all — DF's override is at the ORG level). 017 also adds
`unique (location_id, display_name)` on `shop_sections`: that name is the
identity the guide groups by and the key `load.mjs` dedupes on, and the new
shop-sections screen is a second writer.
The VALUES come from the raw export, not the migration — run
`migration/backfill-locations.mjs` (dry run by default, `--apply` to write),
which parses `Location.mer` and also STRIPS the retired FMP keys from
`settings`. Addresses stay jsonb: `lib/poProcessing.ts` reads
`address.shipping` straight through as a PO's Ship-to, and that contract
shouldn't move for a form — `InlineValue` grew a json path instead.

**Migrations 001–016 are ALL APPLIED to the hosted DB** (013 verified
2026-07-23 by the bogus-argument RPC probe; 015 and 016 verified 2026-07-28 —
the note backfill hit drafts only, and `select next_delivery_date('2026-07-28',
'{5}')` returns 2026-07-31 over RPC). **018 is APPLIED and verified 2026-07-31**
— columns present, bucket present and private, and an upload through the app
landed at `{org_id}/{po_id}/{uuid}.png` with the signed URL rendering; an
unauthenticated fetch and an `anon` signed-URL request were both refused.
**017 and 019 are APPLIED** — verified 2026-07-31 by probe (`tax_rate` selects
on `locations`; `extraction` / `extracted_at` / `extraction_model` select on
`purchase_order_attachments` and hold a real Chefs' Warehouse reading). This
line said "NOT applied yet" for a while after they were; **probe, don't read
this file** — that's what the memory note says and it was right.
**020, 021 and 022 are APPLIED** (Mark, 2026-08-01/02) and the employee data is
LOADED: 445 rows, 26 active / 2 new hire / 417 inactive, matching the transform
report, with Mark's row linked to his auth account. 022 verified 2026-08-02 by
inserting an `orientation` document and removing it again — the constraint
accepts the value, so the widened check is live.
**032 is APPLIED** (Mark, 2026-08-05) — `break_premiums.reason` is nullable and
the requirement now rides the decision, so a waiver or a not-owed may be
recorded bare while an owed hour still has to argue its case. Probe with
`select is_nullable from information_schema.columns where table_name =
'break_premiums' and column_name = 'reason'` (YES) and
`select conname from pg_constraint where conrelid = 'public.break_premiums'::regclass`
(expect `break_premiums_reason_when_owed`, and NO `break_premiums_reason_check`).
**033 is APPLIED** (Mark, 2026-08-05) and the backfill has run: 19 entitlement
rows over 13 people, `starts_on` 2022-06-27, every amount left NULL so they
inherit the benefit's $12. Verified the same day — the three tables select, the
commuter benefit is seeded, and the OLD three-argument `freeze_pay_period` is
GONE (a call to it returns PostgREST's `PGRST202`) while the four-argument one
raises "No such pay period" from inside its own body. That pair of probes is the
one that matters: two live overloads would let a stale tab freeze a pay period
with no benefits in it and no error. A second `--apply` wrote 0 new and updated
19, so the select-then-update idempotency holds without an `on conflict` target.
Then the whole stack was run against the LIVE database — 159 shifts, 19
entitlements, 36 accruals — and the produced CSV matches Mark's real Gusto file
person for person, **$432.00 against $432.00**, with the sick-hours header
assertion and the 18-cell width both holding on the real file.
**035 is APPLIED and LOADED** (Mark, 2026-08-06) — 46,553 employee events,
verified the same day by probe: `select count(*) from employee_events` (46,553),
`… where source='filemaker' and legacy_id is null` (0), `… where score < 0 or
score > 5` (0), `… where kind='shift' and location_id is null` (1), and
`select kind, count(*) … group by 1` (shift 43,918 · attendance 867 · call_out
435 · negative 409 · incident 339 · verbal_warning 194 · positive 158 ·
written_warning 100 · document_note 81 · note 38 · check_in 14). Mean shift score
4.825 against FMP's own stored 4.854 — lower on purpose, because we keep the true
mean where FileMaker rounded up. 33 rows skipped and named (employee ids `387B`
and `001` match nobody). All 35 migrations apply on the Docker harness, and the
whole 46,553-row file was replayed through the real constraints there before it
went near production. See build step 4e.
**044 is APPLIED** (Mark, 2026-08-09) — production phase 5's actuals — and the
whole flow was walked live the same day and left as found (see build step 4f).
*Probe, don't trust this line.* `select count(*) from production_batches` (0 —
the walk's 26 were deleted); `select last_value, is_called from
production_batch_number_seq` (**30025, true** — the walk consumed 30000–30025,
so the next `next_batch_number` returns **30026** and the first REAL batch will
not be 30000. Gaps are normal; FMP's own run has thousands. Note this probe is
SQL-EDITOR only: `next_batch_number` is definer and re-checks `user_org_ids()`,
which a service_role script cannot satisfy — it answers "Not your organisation",
which is migration 014's footgun and not a fault); `select column_name from
information_schema.columns where
table_name = 'production_schedule_items' and column_name in
('counted_by','counted_at')` (2 rows); `select id, public from storage.buckets
where id='batch-photos'` (1 row, false). For the five functions, call one via
RPC with a bogus uuid — each raises from its FIRST statement ("No such schedule
line", "unknown location") without doing any work, which is how their existence
was confirmed.
**036 is APPLIED and LOADED** (Mark, 2026-08-07) — 470 elements · 59
element-locations · 128 recipes · 493 versions · 3,765 lines · 2,914 steps, with
**128 masters for 128 families**, verified by the loader's own sanity counts and
then by using the screens against live data. 154 of the 159 vendor keys resolved
to an inventory item. **Probe, don't read this line** — it has been wrong in
both directions for four different migrations: `select count(*) from
production_elements` (470), and confirm exactly one master per family with
`select count(*) from production_recipes r where (select count(*) from
production_recipe_versions v where v.recipe_id = r.id and v.is_master) <> 1`
(0). To reload: `node transform-production.mjs --write` then
`node --env-file=.env load-production.mjs --wipe`.
**034 is APPLIED** (Mark, 2026-08-06) — verified the same day: both screens'
selects return rows, and **0 of the 42 existing documents carry an expiry**,
which is the migration working (null means never, so nothing changed under
anyone). Probe with `select count(*) from employee_documents where expires_on
is not null` and check `employee_documents_expires_idx` exists.
Then the real components were rendered in Node over the LIVE rows (the
`PoPdf` idiom — esbuild-less tsc slice, service_role read, `renderToStaticMarkup`,
inspected in the browser with the dev server's own stylesheet). What that
measured is the argument for the whole feature: **15 of the 16 current staff
with a food handler date are already LAPSED** — Campos 2021-07-27, Altamirano
2022-12-28, five in 2023 — and only Kimberly Ramirez (2026-10-18) is in date.
Every one of them read as "onboarding paperwork complete" the day before,
because completeness asked whether a document existed and never whether it was
still good. All 15 now show a red date over "Food handler card" on the roster.
Note none is `filed: true` yet — they are all the legacy column speaking,
exactly as designed until the cards are photographed.
Pre-apply behaviour, verified before it was applied and worth keeping because
the next schema change will meet it: the roster's document query is deliberately
NOT folded into the page's own error — a missing column must not blank a
readable roster — but it isn't swallowed either, because an empty Expires column
asserts that nothing is lapsing, which is the one claim that screen exists to
make. It reads "unreadable" instead, and the employee RECORD replaces its
Paperwork card with the Postgres error, 018's pattern.
**031 IS APPLIED** — measured 2026-08-06 by service_role probe, after this line
had said "NOT applied yet" for two days: `timesheets.wage_type`, `tip_hours` and
`tip_allocation` and `employees.primary_wage_type` and `gusto_id` all select, and
**44,516 timesheets carry a wage_type**. That mattered, not as bookkeeping — the
timesheets screen's ONE select now carries those columns, so had they been
missing the whole screen would have gone down rather than just the export panel.
**Probe, don't read this file**; it has now been wrong in both directions for
four different migrations. `select count(*) from timesheets where wage_type is
not null` (~44,500) and `select count(*) from employees where primary_wage_type
is not null` (198), and confirm `select count(*) from timesheets where wage_type
like '%(Primary)%'` is ZERO — the suffix must never be stored.
**027, 028, 029 and 030 are ALL APPLIED** (Mark, 2026-08-04) and both loads
have run — 178 pay periods and 44,721 timesheets. For 029/030 probe
`select count(*) from break_premiums`, `from tip_pools`, `from
timesheet_imports`, and check the `timesheet-imports` bucket exists and is
PRIVATE. Note `report_pooled_tips` answers "Not your organisation" to a
service_role probe — that is migration 014's footgun, not a fault: the function
resolves `user_org_ids()` from `auth.uid()`, which service_role has none of.
Test it from a signed-in session.
**027 and 028** were applied earlier the same day. Probe with `select count(*) from
pay_periods` (178) and `select count(*) from timesheets` (44,721); for 028's
period gate, `select public.timesheet_period_editable(id), status from
pay_periods order by start_date desc limit 3` — false on every closed one.
**025 and 026 are APPLIED** (Mark, 2026-08-04) and `extract-invoice` is
redeployed. Verified the same day by probe and then end to end against the live
database: both tables and `purchase_order_attachments.invoice_id` /
`vendor_locations.external_ref` select; the approval RPC is refused for `anon`
with "permission denied for function" (so both revokes and the `authenticated`
grant landed) and returns 1 row with `approved_by` stamped from `auth.uid()`
for the owner; the edge function answers a bogus attachment id with a 404
rather than doing model work. **Probe, don't trust this line** — it has been
wrong in both directions before: `select count(*) from vendor_invoices` for
025, and `select is_nullable from information_schema.columns where table_name =
'purchase_order_attachments' and column_name = 'po_id'` for 026.
**The whole loop was walked on real data and left as found**: the stored
Chefs' Warehouse reading on `132-181132-02` filed as an invoice, **15 of 15
lines joined by SKU** to that order, the receiving screen then reading the
FILED invoice ("15 of 15 lines matched", `INVOICED 1 CS` beside `ORDERED 1 CS`,
billed $472.13 against received $460.73), approved, and deleted — leaving 0
invoices, 0 lines, and the PDF still on the order with `invoice_id` back to
null and its extraction intact.
Two things that verification settled. **A reading stored before the redeploy
has no due date, tax, freight or PO number** — those cells render as em dashes,
which is the both-sides contract working, and "Read again" is what fills them.
And **"Read again" on a document with no `invoice_id` also FILES it**, because
auto-file lives in `read()`; on an already-filed document it only refreshes the
raw reading, which is the intended asymmetry. **NO LONGER TRUE since
2026-09-01** — `read()` reads and does nothing else, on any document. Filing is
an act of closing; see below.
**023 is APPLIED** (Mark, 2026-08-02) — `employees_delete` for owner/admin,
reversing 020's deliberate absence. See build step 4c for the argument and for
the `.select()`-your-own-delete rule it taught. Probe with
`select polname, polcmd from pg_policy where polrelid = 'public.employees'::regclass`
— four rows, not three.
**024 is APPLIED** (Mark, 2026-08-03; verified by probe the same day — a
count-with-no-size update was accepted on a throwaway inactive row, which the
constraint would have refused, and the row was restored) — it drops
`vendor_items_pack_shape`, 010's `check (pack_count is null or pack_size is not
null)`. That statement is true about finished data and wrong as a constraint,
because the pack is edited ONE COLUMN AT A TIME: the vendor-item screen writes
`pack_count` / `pack_size` / `pack_unit` as three separate `InlineValue` cells
laid out the way a pack is written — count × size unit — so on an item with no
pack yet, **the first cell you reach reading left to right is the one column
this constraint forbids on its own**. Mark hit it on Restaurant Depot's Non
Stick Spray and got the raw Postgres text in the cell. (Before it was applied
the workaround was to enter the SIZE first — not a rule anyone could guess from
a row reading "1 × size EA".) Dropping it costs nothing because **no reader
has ever looked at `pack_count` without `pack_size`** — `packLabel` and 013's
generation function both gate on the size and fall back to `package_content` /
`package_desc` — so a count on its own is invisible rather than wrong and can
never put "6 ×" on a purchase order. Pinned by
`scripts/fixtures/packLabel.fixtures.ts`, which was checked by breaking the
guard: it prints `"6 × 0 EA"`, which is exactly the garbage the constraint was
imagined to be preventing and which the reader prevents by itself. Probe with
`select conname from pg_constraint where conrelid = 'public.vendor_items'::regclass`.

**Migration 048 gives the guide's item header a last purchase (NEEDS
APPLYING).** `v_item_last_purchase` — one row per item-location, the most
recent non-void order AT THIS LOCATION, carrying the date AND the vendor item
it was bought as. 004's `v_item_last_ordered` answers half of it and CANNOT
answer the other half: it is `max(po.order_date)` grouped by item-location, so
the aggregate discards the row the date came from. Additive rather than a
widening, because three screens read 004's shape and `lib/lastOrdered` buckets
it. Security is 014's pattern exactly — `security_invoker = false` plus ONE
top-level `user_org_ids()` guard — which means it inherits 014's FOOTGUN:
**service_role reads it EMPTY**, so an audit script will report that nothing was
ever bought. Verified on the Docker harness as a real `authenticated` member
(`current_user` asserted): it picks the later of two purchases, composes from an
undescribed vendor item, agrees with 004 on the date, returns exactly one row
per item-location, and `anon` is refused outright. The `po.status <> 'void'`
guard is load-bearing and was proved so — without it the fixture's header names
a voided order dated five days later. **Until it is applied the guide says so**
in one muted line under the title and suppresses the per-item label entirely,
because an absent line and "never ordered here" look identical and the header
would otherwise assert something false about every item.

Migration 019 gives the attachment somewhere to put what the invoice SAYS —
`extraction` jsonb, `extracted_at`, `extraction_model`. On the attachment rather
than a table of its own: the reading is 1:1 with the file, re-reading replaces
rather than accumulates, and deleting the attachment should take it along
(which a column does for free). If a screen ever loses these columns again it
says so out loud — the Paperwork card and the document pane are replaced by the
Postgres error naming the missing column, same as 018's pre-apply behaviour.

**The `extract-invoice` edge function needs one secret:**
`supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` then
`supabase functions deploy extract-invoice`.

Migration 018 gives receiving the invoice — the last unbuilt piece of spec §2
step 5. It adds `file_name` / `content_type` / `byte_size` to
`purchase_order_attachments` (which had existed since 001 with no writer at all),
creates the **private** `po-attachments` Storage bucket, and puts four
org-scoped policies on `storage.objects`. The object key is
`{org_id}/{po_id}/{uuid}.{ext}` so the policies authorise off the first folder
segment with no join, the same way every table policy reads `org_id`; the cast
is wrapped in `public.storage_folder_org()` which returns **null instead of
raising** on a non-uuid segment, because Postgres gives no guarantee it
evaluates the `bucket_id` test first. That helper is revoked from `public` AND
`anon` (per 002) and then **granted explicitly to `authenticated`** — a policy
runs with the querying role's privileges, so without the grant every read of the
bucket fails with "permission denied for function" rather than returning no
rows. 018 also indexes `purchase_reminders (location_id, show_on_date) where
dismissed_at is null`, which the order guide now queries on every load.
Verified in the Docker harness (all 18 migrations apply on a storage stub; a
member sees only their own org's objects, an insert into another org's folder is
rejected, a junk path yields null rather than an error).
**Until 018 is applied**, PO detail says so out loud — the Paperwork card is
replaced by the Postgres error — rather than showing an empty card that reads as
"no invoice yet".

The 16 POs Mark sent on 2026-07-27 have NO delivery date and that is deliberate
(his call, 2026-07-28): 016's backfill skipped them because they were already
sent, and filling them in afterwards would make the record disagree with the
document the vendor received. Don't "fix" them.
Mark runs them himself in the Supabase SQL editor — never assume a written
migration has been applied, and never assume it hasn't: check. Cheap probes:
`select settings->>'timezone' from orgs` for 007, and for a function, call it
via RPC with a bogus argument so it raises on its first statement instead of
doing any work.

Migration 010 restores the vendor item's PACK STRUCTURE — FMP recorded
`UnitAmount × UnitSize UnitMeasure` ("CS 12 × 32oz") and the original load
multiplied it into `package_content` alone, so the guide printed a hardcoded
"1 × 24 lbs" (the "1 ×" was a literal in the UI; it always said 1). 010 adds
`vendor_items.pack_count / pack_size / pack_unit` and exposes them on the view;
`package_content` is untouched and remains the base-unit total count mode
divides by. The VALUES come from the raw export, not the migration — run
`migration/backfill-pack.mjs` (dry run by default, `--apply` to write) after
010. Backfill is DONE (2,621 rows, verified field-by-field against the export;
698 multi-packs). Migration 011 retyped `pack_count` integer → numeric: FMP
allows a fractional UnitAmount and one row uses it (0.5 × 1qt), which killed
the first backfill run partway through. **The web app on this branch requires
010/011** — the guide selects the new columns — **and must ship BEFORE 012**,
which drops a column the Inventory list and item detail used to select.

**Par belongs to the item at a location, never to the order guide** (Mark,
2026-07-23). If a future change wants a par that varies by anything other than
(item, location, weekday), that is a signal the model is drifting again — 001
put per-weekday par on plan rows only because that table happened to carry the
weekday column, and 003 then silently made it per-vendor-item.

