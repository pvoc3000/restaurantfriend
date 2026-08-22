-- ============================================================================
-- restaurantfriend — migration 062 · which paycheck is not which workday
--
-- Why (Mark, 2026-08-22, on the first real import under 061): "Now we have two
-- shifts that the employees have already been paid for counting towards the
-- next pay period. I hate it."
--
-- He is right, and 061 is not the fault. 028 derived `pay_period_id` from
-- `workday`, which was harmless while `workday` was always the punch's own
-- calendar date. 061 lets the two differ, and the consequence showed on the
-- first import: a kitchen shift starting after 14:00 on a fortnight's LAST day
-- has its overtime counted in the next workday — correctly — and 028's trigger
-- then filed the whole shift into the next FORTNIGHT, which is a different
-- claim and a wrong one. The hours were worked, recorded and paid inside the
-- period that was closing.
--
-- WHICH 24 HOURS THE OVERTIME IS COUNTED OVER AND WHICH PAYCHECK THE HOURS
-- LAND ON ARE TWO QUESTIONS. 028 already separated the columns that answer
-- them — `workday` owns California daily overtime, `business_date` says which
-- day's business a shift belongs to — and then read the wrong one for the
-- fortnight. Homebase answers the second question too: its export is BY pay
-- period, so the file a shift arrives in already says which paycheck it is on.
--
-- So `pay_period_id` now comes from `business_date`. Measured against the live
-- database before writing this: exactly 2 rows move, and they move back to the
-- period they were worked in. Nothing else in seven years of history changes,
-- because for every row that predates 061 the two columns are equal.
--
-- `workweek_start` STAYS ON `workday`, deliberately. The workweek exists for
-- the weekly-over-40 and seventh-day rules, which are overtime rules, so it
-- follows the overtime day. Only the payroll calendar follows the punch.
--
-- Note the trigger must also fire on `business_date` now. 028 watched `workday`
-- alone, which was complete when the two were the same column in all but name;
-- leaving it would mean correcting a punch's date silently kept the shift in
-- the fortnight it was first filed under — the exact bug 028's own comment says
-- the trigger exists to prevent.
--
-- Depends on 028 and 061. Run in the Supabase SQL editor. RERUNNABLE (create or
-- replace, drop/create trigger, and a backfill that is a no-op once correct).
-- ============================================================================

create or replace function set_timesheet_derived()
returns trigger
language plpgsql
as $$
declare
  anchor int;
  dow    int;
begin
  select coalesce((settings->'payroll'->>'workweek_starts_on')::int, 1)
    into anchor
    from orgs where id = new.org_id;

  -- THE OVERTIME WEEK, from the overtime day. isodow is 1=Monday..7=Sunday,
  -- the convention used schema-wide.
  dow := extract(isodow from new.workday);
  new.workweek_start := new.workday - ((dow - anchor + 7) % 7);

  -- THE PAYCHECK, from the day the punch actually fell on. See the header:
  -- a workday that starts in the afternoon can carry an evening past the end
  -- of a fortnight, and the hours were still worked inside it.
  select id into new.pay_period_id
    from pay_periods
   where org_id = new.org_id
     and new.business_date between start_date and end_date
   limit 1;

  return new;
end;
$$;

-- `create or replace` on a function does NOT widen the events its trigger fires
-- on, so the trigger itself has to be recreated (055's lesson, same shape).
drop trigger if exists trg_timesheets_derived on timesheets;
create trigger trg_timesheets_derived
  before insert or update of workday, business_date, org_id on timesheets
  for each row execute function set_timesheet_derived();

-- ----------------------------------------------------------------------------
-- Backfill: re-file any row the old rule put in the wrong fortnight.
-- ----------------------------------------------------------------------------
-- A no-op for every row where workday = business_date, which is all of history
-- before 061. Touching `business_date` is what fires the trigger; setting it to
-- its own value is the cheapest way to say "re-derive this".
--
-- NOT gated on the period being open. This is a correction to bookkeeping the
-- app got wrong, run by an operator in the SQL editor, and refusing to fix a
-- misfiled row because it is misfiled into a closed period would be the wrong
-- way round. The app's own writes remain gated by 028's policies.
update timesheets t
   set business_date = t.business_date
  from pay_periods p
 where p.org_id = t.org_id
   and t.business_date between p.start_date and p.end_date
   and t.pay_period_id is distinct from p.id;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   -- 1. Nobody is filed against a fortnight their punch did not fall in.
--   select count(*)
--     from timesheets t
--     join pay_periods p on p.id = t.pay_period_id
--    where t.business_date not between p.start_date and p.end_date;
--     -- 0
--
--   -- 2. The two shifts Mark hit are back where they were worked.
--   select e.last_name, t.business_date, t.workday, p.start_date, p.end_date
--     from timesheets t
--     join employees e on e.id = t.employee_id
--     join pay_periods p on p.id = t.pay_period_id
--    where t.workday <> t.business_date
--      and t.workday >= '2026-08-17'
--    order by e.last_name;
--     -- Mejia and Salazar, business_date 2026-08-16, workday 2026-08-17,
--     -- period 2026-08-03 → 2026-08-16
--
--   -- 3. The overtime week still follows the OVERTIME day, not the punch.
--   select count(*) from timesheets
--    where workweek_start <> workday - ((extract(isodow from workday)::int - 1 + 7) % 7);
--     -- 0, for a Monday-anchored workweek
--
--   -- 4. Nothing was stranded.
--   select count(*) from timesheets where pay_period_id is null;
--     -- 0
-- ============================================================================
