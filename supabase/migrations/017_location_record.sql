-- ============================================================================
-- restaurantfriend — migration 017 · the location becomes a real record
--
-- Why (Mark, 2026-07-30): `locations` is the only table in the app with no UI
-- at all. Nothing in web/src writes to it, and its six rows still carry the
-- FMP backfill exactly as the loader left them — `settings` holds raw
-- FileMaker text:
--
--   "OperatingHours_Open_time": "10am<GS>10am<GS>10am<GS>…"   (char 29 between
--                                                              seven slots)
--   "Location_OpenDays":        "Wed\nThu\nFri\nSat\nSun\nMON\nTUE"
--   "LaborRate_n":              "35"                          (a string)
--
-- with "9pm" in one row and "9 pm" in the next, and DF04 carrying five of the
-- seven hour slots. Meanwhile 42 of FMP's 51 location columns were dropped at
-- transform time, including the tax rate.
--
-- This migration gives those facts TYPED COLUMNS. Not more `settings` jsonb:
-- they are structured per-location facts of the same class as
-- `vendor_locations.order_days`, and a column is what `InlineValue` and
-- `WeekdayPicker` already know how to write. `settings` stays for genuinely
-- open-ended config — after the backfill its only key is `email_provider`.
--
-- The COLUMNS are added here; the VALUES come from the raw export, which lives
-- outside the database — run `migration/backfill-locations.mjs` afterwards
-- (dry run by default, `--apply` to write). Same division of labour as 010.
--
-- Run in the Supabase SQL editor. NOT rerunnable (add column fails a second
-- time — that means it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Scalars
-- ----------------------------------------------------------------------------

alter table locations
  add column tax_rate       numeric(6,4),
  add column labor_rate     numeric(10,2),
  add column register_count smallint;

comment on column locations.tax_rate is
  'FMP Location_TaxRate_n — sales tax as a FRACTION (0.0975 = 9.75%), not a '
  'percentage. Nothing computes with it yet; it is recorded here because the '
  'location screen is where it was always kept.';
comment on column locations.labor_rate is
  'FMP LaborRate_n — the location''s standard hourly rate, for the Time & '
  'Payroll module.';
comment on column locations.register_count is
  'FMP NumberOfRegisters_n — POS terminals on the floor.';

-- ----------------------------------------------------------------------------
-- 2. Opening hours
--
-- Two facts, deliberately kept apart the way FMP kept them: WHICH days the shop
-- opens, and WHAT TIME it opens on each. A day can be recorded as open before
-- anyone has typed its hours, and a seasonal closure doesn't destroy the times.
--
-- `open_days` is the same smallint[] of ISO weekdays that
-- `vendor_locations.order_days` uses, so `WeekdayPicker` writes it unchanged.
-- The two time arrays copy migration 009's `par_by_weekday` exactly, length
-- guard included: SEVEN SLOTS, slot n = weekday n (1 = Monday). Every
-- per-weekday array in this schema indexes the same way.
-- ----------------------------------------------------------------------------

alter table locations
  add column open_days             smallint[] not null default '{}',
  add column open_time_by_weekday  time[],
  add column close_time_by_weekday time[];

alter table locations
  add constraint locations_open_time_by_weekday_len
    check (open_time_by_weekday is null or array_length(open_time_by_weekday, 1) = 7),
  add constraint locations_close_time_by_weekday_len
    check (close_time_by_weekday is null or array_length(close_time_by_weekday, 1) = 7);

comment on column locations.open_days is
  'ISO weekdays the location opens (1 = Monday … 7 = Sunday). FMP '
  'Location_OpenDays, which was a list of day NAMES in arbitrary order and '
  'mixed case.';
comment on column locations.open_time_by_weekday is
  'Seven slots, slot n = weekday n (1 = Monday) — mirrors '
  'inventory_item_locations.par_by_weekday. Null slot = no time recorded, '
  'which is not the same as closed (see open_days).';
comment on column locations.close_time_by_weekday is
  'Seven slots, slot n = weekday n. See open_time_by_weekday.';

-- ----------------------------------------------------------------------------
-- 3. Production mapping
--
-- Recorded, not read. FMP's location screen carried both and the Production
-- module will want them; nothing in the app consults them today, and the
-- location screen says so out loud rather than implying a live wiring.
--
-- No FK is possible from an array element, so these hold location ids the way
-- par_by_weekday holds numbers. A deleted location leaves a dangling id — which
-- is why nothing here cascades and why readers must tolerate an id that no
-- longer resolves.
-- ----------------------------------------------------------------------------

alter table locations
  add column kitchen_by_weekday uuid[],
  add column shops_for          uuid[] not null default '{}';

alter table locations
  add constraint locations_kitchen_by_weekday_len
    check (kitchen_by_weekday is null or array_length(kitchen_by_weekday, 1) = 7);

comment on column locations.kitchen_by_weekday is
  'FMP KitchenLocation — which location PRODUCES for this one, per weekday. '
  'Seven slots, slot n = weekday n. DF02 is produced at DF01 Mon–Wed and at '
  'DF02 Thu–Sun, which is why this varies by day at all.';
comment on column locations.shops_for is
  'FMP ShopForLocations_t — the locations this one buys for. Unordered set of '
  'location ids.';

-- ----------------------------------------------------------------------------
-- 4. Shop sections: one display name per location
--
-- `display_name` is the identity of a section everywhere it matters — it is
-- what the order guide groups by, what the in-person shopping list prints, and
-- the key `migration/load.mjs` dedupes on ("<location_code>|<display_name>").
-- The table never enforced it, which was harmless while the loader was the only
-- writer. The shop-sections screen adds a second writer, and "31 Storage R1 S1"
-- twice in one shop would split that shelf in two on the walk.
--
-- If this fails, the live table already has duplicates: find them with
--
--   select location_id, display_name, count(*)
--     from shop_sections group by 1, 2 having count(*) > 1;
--
-- and merge them (repoint inventory_item_locations.shop_section_id at the
-- keeper, delete the other) rather than dropping the constraint.
-- ----------------------------------------------------------------------------

alter table shop_sections
  add constraint shop_sections_display_name_unique unique (location_id, display_name);

-- ============================================================================
-- After applying:
--   1. `cd migration && node backfill-locations.mjs`          (dry run)
--   2. `node backfill-locations.mjs --apply`
--   3. Check one row: settings should hold email_provider and nothing else.
--
-- Verify this migration applied (non-mutating):
--   select tax_rate, open_days, open_time_by_weekday from locations
--    where code = 'DF01';
-- ============================================================================
