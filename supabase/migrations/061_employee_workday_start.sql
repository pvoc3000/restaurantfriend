-- ============================================================================
-- restaurantfriend — migration 061 · a baker's day is a night
--
-- Why (Mark, 2026-08-22): "Homebase is simply checking if the shift is on the
-- same day, and ignoring if there's enough turnaround time between shifts. It's
-- using midnight to delineate between days instead of a 24 hour period that
-- could start at 10pm, for example. The end result is that I have to go in by
-- hand and make the adjustments to remove the overtime hours and it's a pain."
--
-- California daily overtime is computed per WORKDAY, and `timesheets.workday`
-- has always been the calendar date the clock-in fell on — the midnight-to-
-- midnight default. The overnight crew starts anywhere from 18:00 to 03:00, so
-- a baker who finishes at 09:13 and starts again at 23:21 puts both shifts on
-- one calendar date. Angelica Castellanos, 2026-08-13: 8.48h + 7.43h summed to
-- 15.91h and split 8 regular / 4 OT / 3.91 double, with fourteen hours of rest
-- in the middle. Measured over the last 12 months: 28 of these a year.
--
-- Worth knowing before changing any of this: Homebase is NOT the disagreement.
-- `lib/overtime.ts` recomputes the identical split — 322 shifts over the last
-- two pay periods, ZERO disagreements — because our rule uses the same midnight
-- boundary. Neither "recompute it ourselves" nor "flag where we differ" fixes
-- anything here. The only variable is where the workday starts.
--
-- California permits a workday beginning at any fixed, regularly recurring
-- hour. 14:00 was chosen by measurement, not taste: the kitchen's start times
-- have a dead zone from 09:25 to 16:01, and at 14:00 the false-stack count over
-- the last 12 months falls from 28 to 2. It also has a business meaning rather
-- than being a bare number — the workday runs 2pm to 2pm, so the whole night
-- that produces Thursday's donuts is Thursday's workday — which matters,
-- because a workday may not be redefined to EVADE overtime.
--
-- PER EMPLOYEE, and null means midnight. Front of house is untouched: their
-- closing shifts start at 19:00 and a shared boundary would have to clear both
-- crews, which nothing does. Null costs nothing and changes no existing row.
--
-- Note what this is NOT: `business_date` (028) still says which day's tip pool
-- and shift report a shift belongs to, and it stays the calendar date the punch
-- fell on. Only the OVERTIME day moves. 028 split those two columns for exactly
-- this — "so the overnight production crew could later be attributed to the day
-- they FINISH without a rewrite" — and this is the first time they diverge.
--
-- NO org-level default. Eleven of thirty-seven people need this, and an org
-- default of midnight is only the absence of a value; a second place to state
-- one fact is 016's `nextDeliveryDate` trap. If a whole org ever goes
-- nocturnal, `orgs.settings.payroll` is where that would live.
--
-- Depends on 020 (employees). Run in the Supabase SQL editor BEFORE deploying —
-- the employee record selects this column. NOT rerunnable (add column fails a
-- second time, which means it already ran).
-- ============================================================================

alter table employees add column workday_starts_at time;

-- WHY THE FLOOR IS NOON. Two reasons, and neither is that the arithmetic
-- breaks — it doesn't; any hour describes a valid 24-hour window.
--
--   1. THE LABEL STAYS HONEST. The workday is named for the date it ENDS on,
--      so at noon or later at least twelve of its twenty-four hours fall on
--      that date. At 06:00 a 6am-to-2pm Monday shift would be labelled TUESDAY
--      on a payroll report, which is arithmetically fine and humanly absurd.
--
--   2. FORWARD ONLY, which is the whole safety argument for this migration.
--      Every row in `timesheets` today has `workday` equal to the clock-in's
--      calendar date. At noon or later a punch's workday can only be its own
--      date or the next one — never earlier. So no shift can move backwards
--      into a CLOSED pay period, no backfill is needed, and history is left
--      exactly as it stands.
--
-- Measured, for the record: every boundary from 01:00 to 06:00 scores three to
-- seven times WORSE than midnight, because it drags the 766-shift-a-year
-- just-after-midnight cluster backwards onto a day that is already full.
--
-- The upper bound and the truncation are not fussiness. Postgres accepts
-- `time '24:00:00'`, which would satisfy every punch and mean midnight by a
-- second spelling; and `lib/workday` reads this as whole minutes, so
-- `14:00:30` would be silently truncated — the class of difference nobody
-- finds until it is somebody's overtime.
alter table employees add constraint employees_workday_start_is_afternoon
  check (
    workday_starts_at is null
    or (
      workday_starts_at >= time '12:00'
      and workday_starts_at < time '24:00'
      and date_trunc('minute', workday_starts_at) = workday_starts_at
    )
  );

comment on column employees.workday_starts_at is
  'When this person''s California workday begins, for daily overtime. Null '
  'means midnight, which is the default and what front of house uses. The '
  'overnight kitchen crew uses 14:00, so one production night is one workday '
  'rather than two calendar dates. Does not move business_date, which stays '
  'the date the punch fell on. Prospective: editing this does not restate '
  'history, since a shift keeps the workday it was imported with.';

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from employees where workday_starts_at is not null;
--     -- 0: the column exists and nobody has a boundary yet, so no existing
--     --    timesheet's attribution can have changed underneath anyone
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'employees' and column_name = 'workday_starts_at';
--     -- workday_starts_at | time without time zone | YES
--
--   select conname from pg_constraint
--    where conrelid = 'public.employees'::regclass and contype = 'c';
--     -- includes employees_workday_start_is_afternoon
--
-- And the constraint actually bites (roll this back):
--
--   begin;
--     update employees set workday_starts_at = '03:00'
--      where id = (select id from employees limit 1);
--     -- ERROR: violates "employees_workday_start_is_afternoon"
--     update employees set workday_starts_at = '14:00:30'
--      where id = (select id from employees limit 1);
--     -- ERROR: same constraint — seconds are REFUSED, never rounded
--   rollback;
-- ============================================================================
