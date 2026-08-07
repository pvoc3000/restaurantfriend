-- ============================================================================
-- restaurantfriend — migration 035 · employee events
--
-- Why (Mark, 2026-08-06):
--
--   "In retrospect, these should really be all in one table: Events. What were
--    'ratings' are really just shift events, so they could easily live in the
--    events table. Events already had different types, what's one more."
--
-- FileMaker keeps two HR child tables that have never been migrated:
--
--   Events   2,398 rows, 2014-06-11 → 2026-07-21, ~200/yr. Ad-hoc narrative:
--            warnings, incidents, call-outs, check-ins, praise.
--   Ratings 44,251 rows, 2017-12-20 → today, ~5,000/yr. A supervisor's note and
--            score for ONE PERSON ON ONE SHIFT, written daily.
--
-- They are one thing. A rating is `kind = 'shift'`.
--
-- ---------------------------------------------------------------------------
-- WHY THE FIVE SCORES BECOME ONE
--
-- FMP scored speed, customer service, cleanliness, initiative and attitude
-- 1–5 each. The categories never discriminated: 89% of all 40,793 scored
-- ratings are a 5. What carries the information is the NOTE (35,832 filled,
-- 32,044 distinct, median 66 characters — real sentences).
--
-- The five survive verbatim in `source_payload`, so the collapse is reversible
-- without a re-export. That matters more than usual here because FileMaker is
-- being decommissioned and this is the only copy.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE IS NOT
--
-- It is not the shift log. Supervisors write ratings in BATCHES at the end of a
-- shift — 2–3 people at a time, alongside sales, tips and donut production
-- counts — and production is an unbuilt module. So the write surface for now is
-- the employee's own record, the batch screen waits for Production, and the
-- RLS below is deliberately owner/admin only. See the RLS section.
--
-- Depends on 020 (employees) and 001 (orgs, locations, user_has_role).
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

create table employee_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- CASCADE, matching employee_documents rather than break_premiums' RESTRICT.
  -- 029 chose restrict because a premium is money owed and must not vanish with
  -- a record; an event is narrative. But a long-serving person carries ~1,000 of
  -- these, so `lib/employees.ts`'s `deleteWarnings` counts them and the confirm
  -- on 023's delete says the number out loud. A cascade nobody is warned about
  -- is the actual danger, not the cascade.
  employee_id uuid not null references employees(id) on delete cascade,

  -- Which shop. FMP's Ratings table has no location column, but its SHIFT REPORT
  -- does: `Ratings.log_id` → `ShiftReports._log_id`, which is a real unique id
  -- (13,059 of 13,059) and joins 44,250 of 44,251 ratings — 100.0%. Measured
  -- 2026-08-06: DF01 25,592 · DF02 15,578 · DF03 2,946 · EVENT 134.
  --
  -- (An earlier plan recovered this by joining to the TIMESHEET for that
  -- (employee, day), which works from 2020 on and not at all before, because no
  -- timesheet data exists then. The shift report is the source's own answer and
  -- covers everything, so that inference is gone — along with the loader's need
  -- to read the 85 MB Timesheets.mer at all.)
  location_id uuid references locations(id) on delete set null,

  -- The shift report is the better source here too: 329 ratings carry no date of
  -- their own while their report does, so the loader falls back to it.
  occurred_on date not null,

  -- Eleven kinds. FMP had thirteen values with three merge pairs it had drifted
  -- into over twelve years (Negative/Negative Event, Positive/Positive Event,
  -- Incident/Incident Report); `lib/employeeEvents.ts` holds the fold table and
  -- `normalizeEventKind` is what the transform uses, so this list and the app's
  -- PickList are literally one list rather than two that agree today.
  --
  -- `document_note` is HISTORICAL ONLY — see the note below the table.
  kind        text not null check (kind in (
                'shift',            -- a rating: one person, one shift
                'call_out',         -- did not work the shift
                'attendance',       -- late, left early
                'verbal_warning',
                'written_warning',
                'incident',
                'positive',
                'negative',
                'check_in',
                'note',
                'document_note')),

  -- 0 TO 5, AND ZERO IS A REAL SCORE. Measured against FMP's own stored total
  -- (2026-08-06): of the 132 rows carrying a zero, the total says it was counted
  -- on 107 and excluded on 10 — and the 65 rows where all five categories are
  -- zero read "NO CALL/NO SHOW" and "Called out 5 minutes after she was supposed
  -- to start her shift". A zero is a supervisor writing the shift off.
  --
  -- Constraining this to 1–5 would refuse 72 rows of real history halfway
  -- through a batch. Numeric because it is a MEAN: FMP stored round(mean), which
  -- agrees with the true mean on only 33,545 of 40,793 rows, so computing it
  -- from the five components gives better history than the source had.
  --
  -- Deliberately NOT constrained to kind = 'shift'. 024's lesson: a statement
  -- true of finished data is still wrong as a constraint, and a score on a
  -- check-in would be invisible rather than wrong.
  score       numeric(3,2) check (score is null or (score >= 0 and score <= 5)),

  -- Which shift, from the shift report's own `Shift` label. Measured over all
  -- 44,251 ratings: Opening 23,718 · Closing 20,027 · Off-site 481 · Mid 19 ·
  -- Manager 3. `Manager` is a role rather than a shift and resolves to null.
  --
  -- OFF_SITE IS NOT DECORATION. Ratings' own `cShift_sortfield` is 1/2/3 and
  -- agrees with the label exactly where both exist, but the 487 rows carrying no
  -- sort field at all are precisely the Off-site and Manager ones — so a
  -- constraint of opening/mid/closing would refuse 481 real rows.
  shift       text check (shift in ('opening', 'mid', 'closing', 'off_site')),

  -- What they were doing that shift. This is the FOURTH place a job title is
  -- stored (`employees.position`, `timesheets.position` and
  -- `employees.primary_wage_type` being the others) and it earns its place: at
  -- write time there is no timesheet to read it from, because the Homebase
  -- import arrives a fortnight later. Nobody should discover the overlap by
  -- surprise, hence this comment.
  position    text,

  -- THREE TEXT FIELDS, because FMP's three are not interchangeable.
  -- `EventSummary` is the headline (2,374 of 2,398 rows), `EventDetail`
  -- elaborates on it (1,188, of which only TWO have no summary), and
  -- `EventAction` is what was DONE about it ("Documented", "Terminated").
  --
  -- No "at least one of these is present" constraint: ~22 rows carry none of
  -- them, and a constraint would refuse real history mid-batch.
  headline    text,
  detail      text,
  outcome     text,

  -- Who wrote it. Events carries `SupervisorID` on 1,889 of 2,398 rows, and a
  -- rating gets its rater from the shift report — `supervisor_id` reaches 44,237
  -- of 44,251 ratings, and all 46 distinct ids resolve to a real employee.
  -- `author_name` is FMP's free-text supervisor string, kept as a display
  -- fallback when the id matches nobody.
  author_employee_id uuid references employees(id) on delete set null,
  author_name text,
  created_by  uuid references auth.users(id),

  source      text not null default 'app' check (source in ('app', 'filemaker')),

  -- TEXT, not integer like `employees.legacy_id`, and NAMESPACED — 'E:1042' for
  -- an Event, 'R:…' for a Rating. The two source tables have overlapping integer
  -- id spaces, so one namespace cannot be a number. Don't "fix" it.
  legacy_id   text,

  -- The five component scores, FMP's rounded total, the raw EventType and
  -- EventAction, and the break fields. `transform-timesheets.mjs` does the same
  -- with `cTimeSheetError`: what the source said, kept beside what we decided.
  source_payload jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Postgres allows unlimited NULLs in a unique index, so events created in the
  -- app (no FMP row) don't collide. 020's own note.
  unique (org_id, legacy_id)
);

-- ----------------------------------------------------------------------------
-- Three things this table deliberately does NOT have
-- ----------------------------------------------------------------------------
--
-- NO `timesheet_id`. A rating is written at the end of a shift; the Homebase
-- import that creates the timesheet arrives a fortnight later, so at write time
-- the row it would point at does not exist. And because Ratings has no location
-- column, the location is RECOVERED FROM the timesheet — an FK would be a
-- foreign key derived from the thing it points at. `(employee_id, occurred_on)`
-- is the join whenever one is wanted, and it is the same grain `break_premiums`
-- already uses for exactly this reason.
--
-- NO `log_id` COLUMN, though FMP's shift report is a real record with a real
-- unique id (`ShiftReports._log_id`, 13,059 of 13,059) and every rating points
-- at one. It is read by the LOADER — for the location, the shift, the date and
-- the rater — and then kept in `source_payload` rather than becoming a column,
-- because a column would be a foreign key to a table this schema does not have.
--
-- That table is coming. The shift report carries total sales, total tips,
-- production batches and yields per donut type, waste, leftovers and a task
-- checklist — it is the PRODUCTION module's screen, not this one's. When it
-- lands as a real `shift_logs` table this gains a nullable FK, and the value to
-- populate it from is sitting in `source_payload.log_id`. Storing it now as a
-- bare integer with nothing to reference would be a key that only looks like
-- one.
--
-- NO period-editability gate, unlike `break_premiums` and `tip_pools`. Three
-- reasons, because the omission looks like an oversight without them:
--   · an event is narrative, not money. Decision 8 protects what has been PAID.
--   · every workday in the loaded calendar sits in a CLOSED period, so a gate
--     would make all of 2014–2026 permanently uncorrectable — you could not fix
--     a typo in a 2019 warning.
--   · `period_editable_on` returns TRUE for a day outside the 178-period
--     calendar (it is `not exists (… a closed period covering this day)`), so
--     half of Events would be freely editable while 2020 was frozen. Inheriting
--     that inconsistency for no benefit is worse than not gating at all.
--
-- And `document_note` is a historical kind only. FMP used its Events table as a
-- filing cabinet (81 rows typed `Document`, 73 with a paper original), and
-- `migration/field-map.md` said those should migrate to `employee_documents`.
-- They cannot: 021 declares `storage_path text not null` and we have metadata
-- with no files. Relaxing that would let `missingPaperwork()` report a W-4 as
-- filed that nobody can produce — reintroducing the exact "checkbox is a claim
-- about paper in a drawer" failure 021 exists to prevent, and which 034 has just
-- shown the cost of. So they land here, named `document_note` rather than
-- `document`, because "document" on a row with no file is the same lie in a
-- different column. `AD_HOC_EVENT_KINDS` keeps it out of the New-event dialog;
-- new filings go to `employee_documents`, where the bucket is.

create index employee_events_employee_idx on employee_events (org_id, employee_id, occurred_on desc);
create index employee_events_org_date_idx on employee_events (org_id, occurred_on desc);
-- No index on `kind`, deliberately: eleven values over ~46,000 rows in one org,
-- and every screen filters by employee or by date first. Don't add one "for the
-- filter" — it would never be chosen.

create trigger trg_employee_events_updated before update on employee_events
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — owner/admin on all four verbs. Supervisors are deferred, on purpose.
-- ----------------------------------------------------------------------------
--
-- 020's `employees` policies verbatim. The reasoning there names this table's
-- contents as the very reason employees became the schema's first role-gated
-- READ: "a home address, a date of birth and eventually a write-up". This is
-- that write-up — 194 verbal warnings, 100 written ones, 344 incident reports.
--
-- Supervisors WILL need to write `kind = 'shift'` rows, and this does not let
-- them, for three reasons:
--
--   1. A select policy for them would hand over 44,000 rows keyed by an
--      `employee_id` uuid that resolves to nothing, because they can read
--      neither `employees` nor `timesheets`. Giving them this table means also
--      giving them a definer function returning a safe name roster — the shape
--      020 already anticipates for the supervisor phone list — and that belongs
--      to the shift-log module.
--   2. A write policy with no writer is a policy nobody has tested. Design rule
--      1's own lesson from `NewPayPeriod`: "a create that a loader also performs
--      is a create nobody has tested." Shipping an untested insert grant on a
--      table containing terminations is that mistake with worse stakes.
--   3. When it comes, mind the trap: `with check (kind = 'shift')` on INSERT
--      does not stop an UPDATE changing `kind` afterwards unless the predicate
--      appears in BOTH `using` and `with check` on the update policy. Write it
--      once, in the migration that has a screen to test it against, and verify
--      it as a real authenticated supervisor — 028 established that is the only
--      way to test a policy.
--
-- DELETE is allowed for owner/admin, unlike 020's deliberate absence on
-- `employees`: an employee is terminated rather than deleted, but a rating typed
-- onto the wrong person is simply a misfile. The app must `.select()` its own
-- delete — with no matching policy Postgres removes zero rows and PostgREST
-- returns no error, which reads as a cheerful success.

alter table employee_events enable row level security;

create policy employee_events_select on employee_events for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy employee_events_insert on employee_events for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy employee_events_update on employee_events for update
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy employee_events_delete on employee_events for delete
  using (user_has_role(org_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- After the load, these should read:
-- ----------------------------------------------------------------------------
--   select kind, count(*) from employee_events group by 1 order by 2 desc;
--     → shift ~44,000 · attendance 876 · call_out ~415 · negative 409 ·
--       incident 344 · verbal_warning 194 · positive 159 · written_warning 100 ·
--       document_note 81 · note 38 · check_in 14
--
--   select count(*) from employee_events where kind = 'shift' and score is null;
--     → ~3,500 (FMP left score_TOTAL empty on 3,458 ratings)
--
--   select count(*) from employee_events where kind = 'shift' and location_id is null;
--     → 1 or 2. The shift-report join covers 44,250 of 44,251 ratings, so a
--       LARGE number means the loader's join is wrong, not that a shop was shut.
--
--   select shift, count(*) from employee_events where kind = 'shift' group by 1;
--     → opening ~23,718 · closing ~20,027 · off_site ~481 · mid 19 · null ~6
--
--   select count(*) from employee_events where source = 'filemaker'
--     and legacy_id is null;
--     → 0. Every migrated row carries its namespaced source id.
