-- 150 — index timesheets.adjusts_timesheet_id (2026-09-29)
--
-- Delete Timesheets… timed out ("canceling statement due to statement
-- timeout") deleting 157 imported rows. 028 declared
-- `adjusts_timesheet_id uuid references timesheets(id) on delete set null`
-- with no index, so for EACH deleted row Postgres scans the whole table
-- (45,360 rows) for adjustments pointing at it: 157 sequential scans in one
-- statement. An index turns each into a lookup.

create index if not exists timesheets_adjusts_idx
  on timesheets (adjusts_timesheet_id)
  where adjusts_timesheet_id is not null;
