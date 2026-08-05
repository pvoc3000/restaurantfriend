-- ============================================================================
-- restaurantfriend — migration 031 · wage types
--
-- Two columns phase 6 cannot be correct without, plus their backfill.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Gusto's import file is one row per (employee, JOB TITLE), and it identifies
-- the person's primary job by SUFFIXING that title with "(Primary)" — it is not
-- a separate flag (Mark, 2026-08-04). Measured over the real template: 24
-- people, each with exactly one such row, and every non-hours earning — tips,
-- premium, commuter benefit, bonus, reimbursement — rides that row and only
-- that row. Zero exceptions.
--
-- So the export has to know two things this schema had nowhere to put:
--
--   which job each SHIFT was worked as        → timesheets.wage_type
--   which job is the person's PRIMARY one     → employees.primary_wage_type
--
-- `timesheets.position` is not it. That column holds Homebase's `Role` and
-- FileMaker's `ts_Position`, and `employees.position` holds a THIRD vocabulary
-- of abbreviations — "DF", "Sr. DF", "Sr. Baker" — which match the shift
-- positions on only 8 of 22 people in the last real fortnight. Deriving the
-- primary from it would mis-title most of the file.
--
-- ---------------------------------------------------------------------------
-- THE SUFFIX IS NEVER STORED
--
-- Both columns hold the BARE title ("Supervisor"), and the export appends
-- "(Primary)" by comparing the two. That is what makes the file's central
-- invariant structural rather than data-dependent: a person has exactly one
-- `primary_wage_type`, so they get exactly one primary row, so the earnings
-- have exactly one place to go. Storing the suffix per shift would let a
-- fortnight produce two primary rows, or none.
--
-- It also gives the Homebase importer something to write. Its `Role` column
-- carries no suffix (and does carry FileMaker numbering — "01 Overnight
-- Baker"), so a bare title is the only shape both sources can supply.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL, AND WHY "LATEST WINS"
--
-- FileMaker's `ts_Wage_Type` already carries the suffix and is riding in
-- `source_payload` from the historical load. Measured over all 44,721 rows:
-- 198 employees have a (Primary) wage type in their history, 134 have exactly
-- one ever, and 64 CHANGED over time — Traci Trombino went Supervisor →
-- Manager, Ruby Mares went Kitchen Supervisor → Baker. Those are promotions,
-- so the most recent one is the true present answer.
--
-- Run in the Supabase SQL editor. NOT rerunnable (add column fails twice).
-- ============================================================================

alter table timesheets add column wage_type text;
alter table employees  add column primary_wage_type text;

-- The job each shift was worked as, stripped of the suffix.
update timesheets
   set wage_type = nullif(btrim(regexp_replace(source_payload->>'wage_type', '\s*\(Primary\)\s*$', '')), '')
 where source_payload ? 'wage_type';

-- Each person's primary job: the most recent title FileMaker ever marked
-- (Primary) for them. `distinct on` with a matching `order by` is Postgres's
-- idiom for "one row per group, the latest".
update employees e
   set primary_wage_type = sub.wt
  from (
    select distinct on (t.employee_id)
           t.employee_id,
           nullif(btrim(regexp_replace(t.source_payload->>'wage_type', '\s*\(Primary\)\s*$', '')), '') as wt
      from timesheets t
     where t.source_payload->>'wage_type' like '%(Primary)'
     order by t.employee_id, t.workday desc
  ) sub
 where e.id = sub.employee_id
   and sub.wt is not null;

create index timesheets_wage_type_idx on timesheets (employee_id, wage_type);

-- No new policies: both columns live on tables whose RLS already covers every
-- verb, and no new function means nothing to revoke from anon.

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from timesheets where wage_type is not null;
--                                        -- ~44,700 of 44,721
--   select count(*) from employees where primary_wage_type is not null;
--                                        -- 198
--   select primary_wage_type, count(*) from employees
--    where primary_wage_type is not null group by 1 order by 2 desc;
--
--   -- the suffix must NOT have been stored:
--   select count(*) from timesheets where wage_type like '%(Primary)%';   -- 0
--   select count(*) from employees  where primary_wage_type like '%(Primary)%'; -- 0
--
--   -- Traci Trombino must read Manager, not Supervisor (latest wins):
--   select last_name, first_name, primary_wage_type from employees
--    where last_name = 'Trombino';
-- ============================================================================
