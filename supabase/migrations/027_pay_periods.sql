-- ============================================================================
-- restaurantfriend — migration 027 · the payroll calendar
--
-- Why (docs/timesheets-brief.md, decisions 8 and 9): a timesheet is editable
-- iff its pay period is open. That is the module's one read-only rule, and it
-- needs something to hang off — no `locked` flag, no archive table, no
-- "is historical" boolean. One rule, the way `closed` came to mean something on
-- purchase orders.
--
-- NOTE ON NUMBERING: the brief was written on 2026-08-04 saying "the next
-- migration is 025". The Invoices module took 025 and 026 the same day, so this
-- module is 027–030. If you are reading the brief, add two.
--
-- The status ladder is open → review → exported → closed, modelled on the PO
-- ladder. The two end states mean different things and that distinction is the
-- point of having both:
--
--   exported   the file exists. Reversible — see `reopened_at` below.
--   closed     payroll RAN. Never reopened; a later correction becomes an
--              adjustment row in the current open period (028's `kind`).
--
-- The CALENDAR ITSELF is Donut Friend's, not the schema's. Measured over the
-- 178 real periods in the 2026-08-04 re-export of PayPeriods.mer
-- (2019-10-07 → 2026-08-02): every one starts on a Monday, every one is
-- exactly 14 days, zero gaps, zero overlaps. That is a fact about finished
-- data and would be wrong as a constraint — migration 024's lesson, learned by
-- dropping a constraint that was true of every finished pack and false of a
-- pack being entered one column at a time. So the fortnight lives in
-- `orgs.settings.payroll` per design rule 2, and the only thing the schema
-- insists on is that periods cannot OVERLAP.
--
-- The VALUES come from the FMP re-export, which lives outside the database —
-- run `migration/transform-payperiods.mjs` then `migration/load-payperiods.mjs`.
-- Same division of labour as 010, 017 and 020.
--
-- Run in the Supabase SQL editor. NOT rerunnable (create table / create
-- extension … if not exists is, but the table is not — a second run failing on
-- `create table` means it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. btree_gist — so a uuid and a daterange can share one exclusion constraint
-- ----------------------------------------------------------------------------
-- A gist index handles the range overlap (&&) natively but does not know how to
-- index plain equality on a uuid. btree_gist teaches it, which is what lets the
-- constraint be scoped per org rather than global.
create extension if not exists btree_gist;

-- ----------------------------------------------------------------------------
-- 2. pay_periods
-- ----------------------------------------------------------------------------
create table pay_periods (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- FileMaker's PayPeriodID. Unique per org, multiple NULLs allowed, so a
  -- period created in the app doesn't collide — the `employees.legacy_id`
  -- pattern. This is what timesheet rows join through at load time:
  -- Timesheets.mer's `cPayPeriod` holds exactly this value, and the two agree
  -- on 178 distinct values out of 178.
  legacy_id   text,

  -- INCLUSIVE, both ends. A period is "the fortnight of Monday the 20th
  -- THROUGH Sunday the 2nd", which is how everyone says it and how FMP stored
  -- it. The '[]' in the exclusion constraint below is what makes that literal.
  start_date  date not null,
  end_date    date not null,

  status      text not null default 'open'
              check (status in ('open', 'review', 'exported', 'closed')),

  -- The four stamps. Nullable by construction: a period that has never been
  -- exported has no export date, and that absence is the honest record.
  exported_at timestamptz,
  exported_by uuid references auth.users(id),
  closed_at   timestamptz,
  closed_by   uuid references auth.users(id),

  -- Reopening (decision 11) is owner/admin, confirmed, and REQUIRES a reason:
  -- the file the period produced is being discarded, and a year from now the
  -- only question anyone asks is why. A stamp with no reason is one nobody can
  -- review — the same argument 028's `break_premiums.reason` rests on.
  --
  -- Only `exported` reopens. `closed` never does.
  reopened_at   timestamptz,
  reopened_by   uuid references auth.users(id),
  reopen_reason text,

  -- FMP's `Note`.
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pay_periods_dates check (end_date >= start_date),
  unique (org_id, legacy_id),

  -- THE constraint this table exists to carry. Periods may not overlap, so
  -- "which period owns this workday?" is a TOTAL function — at most one answer,
  -- always. That is what lets 028 fill `pay_period_id` from a trigger instead
  -- of asking three different writers to agree on the lookup.
  --
  -- Deliberately NOT `unique (org_id, start_date)`: two periods can have
  -- different start dates and still overlap, and it is the overlap that breaks
  -- the lookup.
  constraint pay_periods_no_overlap exclude using gist (
    org_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

create index pay_periods_org_idx   on pay_periods (org_id);
-- The two questions every screen asks: "which period is open?" and "which
-- period owns this date?".
create index pay_periods_range_idx on pay_periods (org_id, start_date desc);

create trigger trg_pay_periods_updated before update on pay_periods
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS — read is membership-only; write is owner/admin
-- ----------------------------------------------------------------------------
-- This is the ONE table in the payroll module that is not owner/admin to read,
-- and the reason is that it holds no personal data at all: a pay period is two
-- dates and a status. 029's `tip_pools` will read the same way and for the same
-- reason.
--
-- It also has to be readable by more than admins to be useful. A supervisor
-- reporting Saturday's tips needs to know which fortnight is open; a screen
-- that says "you can't see the calendar" cannot ask them for a figure that
-- belongs in it.
--
-- 028's `timesheets` is the opposite — owner/admin on every verb — because
-- compensation data about a named person is the same class of fact as their
-- home address, which is what 020 already decided about `employees`.
alter table pay_periods enable row level security;

create policy pay_periods_select on pay_periods for select
  using (org_id in (select user_org_ids()));

create policy pay_periods_insert on pay_periods for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy pay_periods_update on pay_periods for update
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- NO delete policy, deliberately — 020's enforcement-by-absence. A pay period
-- is the anchor for every timesheet in it and for the money that was paid out
-- of it; deleting one is never the answer to anything. 028 additionally makes
-- `timesheets.pay_period_id` a restricting reference, so even a future delete
-- policy could not orphan a fortnight of paid hours.
--
-- Note the app must not read a bare `.delete()` as success here: with no
-- matching policy Postgres removes zero rows and PostgREST returns NO error.
-- Every delete in this module `.select()`s its own result — the
-- order_guide_entries lesson, which cost a screen that cheerfully navigated
-- back to a roster that had grown by one.

-- This migration adds no new FUNCTION, so there is nothing to revoke from anon
-- (the 002 / 018 lesson applies to functions, not tables).

-- ----------------------------------------------------------------------------
-- 4. The fortnight, as org configuration (design rule 2)
-- ----------------------------------------------------------------------------
-- Zero business hardcoding: the period length and the day it starts on are
-- Donut Friend's, not the platform's. An org paying weekly from a Sunday
-- changes this object and nothing else.
--
-- `workweek_starts_on` is a SEPARATE question from the pay period and must not
-- be derived from it. California weekly overtime (>40h) and the seventh-day
-- rule are per WORKWEEK, which is not a pay period — FMP knew, and carried
-- `cWeekNum` ("2019_41") on every timesheet row beside a separate
-- `ts_OTHours_OverForty` bucket. 028's `workweek_start` column is filled from
-- this anchor by trigger.
--
-- ISO weekdays throughout, 1 = Monday … 7 = Sunday, matching order_days,
-- open_days and every other weekday array in this schema.
update orgs
   set settings = jsonb_set(
         settings,
         '{payroll}',
         coalesce(settings->'payroll', '{}'::jsonb) || jsonb_build_object(
           'period_days',        14,
           'period_starts_on',   1,
           'workweek_starts_on', 1
         ),
         true
       )
 where settings->'payroll' is null
    or settings->'payroll'->'period_days' is null;

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from pay_periods;                      -- 0 before the load
--   select policyname, cmd from pg_policies
--    where tablename = 'pay_periods';                      -- select/insert/
--                                                          -- update, NO delete
--   select conname from pg_constraint
--    where conrelid = 'pay_periods'::regclass;             -- incl.
--                                                          -- pay_periods_no_overlap
--   select settings->'payroll' from orgs;                  -- the three keys
--
-- And prove the exclusion constraint actually bites — insert two overlapping
-- periods in a transaction and confirm the second is REFUSED, then roll back:
--
--   begin;
--     insert into pay_periods (org_id, start_date, end_date)
--       select id, '2019-01-07', '2019-01-20' from orgs limit 1;
--     insert into pay_periods (org_id, start_date, end_date)
--       select id, '2019-01-20', '2019-02-02' from orgs limit 1;  -- must ERROR
--   rollback;
--
-- Note the second range starts on the first one's END date. With '[]' bounds
-- those two share a day and must collide; with the default '[)' they would not,
-- which is exactly the off-by-one this constraint is written to catch.
-- ============================================================================
