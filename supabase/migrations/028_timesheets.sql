-- ============================================================================
-- restaurantfriend — migration 028 · timesheets
--
-- The shift record: what the source said, what we decided, and which fortnight
-- owns it. Phase 2 of docs/timesheets-brief.md (the brief numbers this 026 —
-- Invoices took 025/026 the day it was written, so add two).
--
-- Depends on 027 (pay_periods) and 020 (employees).
--
-- ---------------------------------------------------------------------------
-- THE THREE COLUMN GROUPS, AND WHY THEY ARE SEPARATE
--
--   source_*    what Homebase/Deputy/FileMaker SAID. Never edited.
--   hours_*     what we DECIDED, with ot_decision naming who decided and why.
--   clock_in /  the punch itself, as real INSTANTS.
--   clock_out
--
-- Decision 2: overtime is imported and VERIFIED, never silently overridden.
-- Storing one number would make "Homebase and we disagree" unrepresentable, and
-- that disagreement is the entire value this module adds over exporting
-- Homebase straight to Gusto. The invoice reader's posture: the machine
-- proposes, a human adjudicates, the decision is stored with a reason.
--
-- ---------------------------------------------------------------------------
-- WHY clock_in / clock_out ARE timestamptz
--
-- Not a date plus two wall-clock times. 22:00 → 06:00 is SEVEN hours across
-- spring-forward and NINE across fall-back, and any arithmetic over wall-clock
-- times pays the wrong number twice a year — always to the overnight crew, who
-- are the only people working at 2am. As instants, duration is a subtraction
-- and is correct for free. See web/src/lib/timeZone.ts, which owns the
-- conversion and REPORTS the two local times a year that are not a single
-- instant rather than guessing.
--
-- Measured in the 2026-08-04 re-export: of 133 rows where FileMaker's stored
-- hours disagree with clock-out minus clock-in, 37 fall on a DST transition day
-- and every one differs by exactly one hour.
--
-- ---------------------------------------------------------------------------
-- WHY workday AND business_date ARE TWO COLUMNS
--
-- `workday` owns the hours for California daily overtime — the day the shift
-- BEGAN, which is DLSE-aligned and what FileMaker did. `business_date` says
-- which day's tip pool and shift report it belongs to. Both default to the
-- start day, and they are separate so the overnight production crew could later
-- be attributed to the day they FINISH without a rewrite. A shift crossing a
-- pay-period or workweek boundary then needs no special case: it goes wherever
-- its workday goes.
--
-- `workweek_start` is not optional and is NOT derivable from the pay period: a
-- fortnight holds two workweeks, and CA weekly overtime (>40h) and the
-- seventh-day rule are per workweek. FileMaker knew — every row carries
-- `cWeekNum` ("2019_41") beside a separate over-forty bucket.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. employees: the external ids, and the durable tip exclusion
-- ----------------------------------------------------------------------------
-- There is no external-id column anywhere in this schema today — only
-- FileMaker's `legacy_id` — and an import that matches on a NAME pays the wrong
-- Sanchez. The Homebase CSV carries a "Payroll ID" per row and the Gusto import
-- template carries `gusto_employee_id`, so both get a home before either
-- importer is written.
alter table employees add column homebase_id text;
alter table employees add column gusto_id text;

-- Partial, so the 400+ people with neither don't collide on null.
create unique index employees_homebase_id_idx on employees (org_id, homebase_id)
  where homebase_id is not null;
create unique index employees_gusto_id_idx on employees (org_id, gusto_id)
  where gusto_id is not null;

-- Decision 4, tier one: this person can never share in the tip pool — an agent
-- of the employer under Labor Code 351. A durable fact about the PERSON, which
-- is why it lives here and not on the shift.
--
-- Note it changes on promotion, so re-deriving an old period from today's flag
-- would recompute history wrongly. 029's frozen allocation is what saves you.
alter table employees add column excludes_tips boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. timesheets
-- ----------------------------------------------------------------------------
create table timesheets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- ON DELETE RESTRICT, deliberately. Migration 023 lets owner/admin delete an
  -- employee, which was right about a TYPO made five minutes ago and must not
  -- become right about a decade of paid hours. The delete now fails loudly
  -- instead of taking the record of what someone was paid with it.
  employee_id uuid not null references employees(id) on delete restrict,

  -- Nullable: 55 FMP rows have no shop, and DF03's 5,578 rows point at a
  -- location that is closed today. A closed shop still employed people.
  location_id uuid references locations(id) on delete set null,

  -- Filled by trigger from `workday` — 027's exclusion constraint makes that
  -- lookup a total function. Nullable because a shift can legitimately land
  -- outside every period that exists (a punch arriving before anyone opened
  -- next fortnight), and refusing it would lose the punch rather than the
  -- calendar gap that caused it.
  pay_period_id uuid references pay_periods(id) on delete restrict,

  -- --- the punch, as instants -------------------------------------------
  clock_in    timestamptz,
  clock_out   timestamptz,

  -- --- the two derived dates --------------------------------------------
  workday        date not null,
  business_date  date not null,
  workweek_start date not null,

  -- --- what the SOURCE said ---------------------------------------------
  source_hours_regular   numeric(8,2),
  source_hours_overtime  numeric(8,2),
  source_hours_double_ot numeric(8,2),
  source_hours_paid      numeric(8,2),
  source_break_minutes   integer,

  -- --- what WE decided ---------------------------------------------------
  hours_regular   numeric(8,2),
  hours_overtime  numeric(8,2),
  hours_double_ot numeric(8,2),

  -- Who decided, and why. `source` = we took the import's word for it, which is
  -- the honest default for a historical load and for any shift nobody has
  -- looked at. `recomputed` = our own arithmetic won. `manual` = a human typed
  -- it, and then `ot_reason` is the only record of why.
  ot_decision text not null default 'source'
              check (ot_decision in ('source', 'recomputed', 'manual')),
  ot_reason   text,
  ot_decided_by uuid references auth.users(id),
  ot_decided_at timestamptz,

  -- --- the rest -----------------------------------------------------------
  -- An INTEGER: a meal break is 30 or 45 minutes, never 0.4166 hours. FMP
  -- stored it as hours and the rounding shows — 0.52 appears on hundreds of
  -- rows, which is 31.2 minutes and was nobody's intention.
  unpaid_break_minutes integer,

  -- Decision 7: a RECONCILIATION column, not a payroll input. Gusto already
  -- pays sick time; this exists so Mark's records and Gusto's can be checked
  -- against each other. It is excluded from tip hours (you weren't on the
  -- floor) and DELIBERATELY OMITTED from the export file — include it and the
  -- employee is paid twice.
  sick_hours numeric(8,2),

  -- Decision 4, tier two: the TRI-STATE. null = inherit the person's flag,
  -- true = excluded from this shift's pool, false = INCLUDED despite the
  -- person-level default. Modelled on the order guide's three-state quantity
  -- and for the same reason: a boolean cannot say the third thing, so without
  -- it you re-tick the same people every fortnight and still have no way to say
  -- "the manager actually worked the floor on Saturday".
  exclude_tips boolean,

  -- Frozen at export (decision 10), never derived on read. Someone editing a
  -- March punch must not silently re-derive a February allocation that
  -- disagrees with money already paid — the same argument PO generation
  -- snapshotting the catalog rests on.
  tip_hours           numeric(8,2),
  tip_allocation      numeric(10,2),
  allocation_frozen_at timestamptz,

  -- --- provenance ---------------------------------------------------------
  source text not null default 'manual',

  -- The idempotency key. Prefer the source's own id; where it has none — and
  -- NEITHER the FileMaker export NOR the Homebase CSV has one, both checked —
  -- the importer hashes the natural tuple plus an occurrence ordinal within
  -- (employee, workday). Unique per source so a re-import updates rather than
  -- duplicates.
  source_row_key text,

  -- The raw row, so a stitch is auditable and reversible and a re-import
  -- re-stitches identically. 019's argument for putting the extraction on the
  -- attachment: it is 1:1 with the row and should die with it.
  source_payload jsonb,

  -- True when this row was reassembled from segments a source split at
  -- midnight. Both files measured so far keep crossing shifts WHOLE, so this
  -- should stay rare — if it starts appearing in bulk, a source changed.
  stitched boolean not null default false,

  -- Decision 11: a correction to a CLOSED fortnight becomes an adjustment row
  -- in the current open period, exporting as its own line. Never a rewrite of
  -- history Gusto has already paid.
  kind text not null default 'shift' check (kind in ('shift', 'adjustment')),
  adjusts_timesheet_id uuid references timesheets(id) on delete set null,

  -- FMP kept these separate and so do we: one is the employee's account of the
  -- shift, the other is management's.
  employee_note text,
  manager_note  text,

  -- Imported, not owned. Kept cheap so that if scheduling ever comes in-house
  -- this becomes a real comparison rather than a stored guess.
  scheduled_hours numeric(8,2),
  position text,

  legacy_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timesheets_punch_order check (clock_out is null or clock_in is null or clock_out > clock_in),
  unique (org_id, source, source_row_key)
);

create index timesheets_org_idx        on timesheets (org_id);
create index timesheets_employee_idx   on timesheets (employee_id, workday);
create index timesheets_period_idx     on timesheets (pay_period_id);
create index timesheets_workday_idx    on timesheets (org_id, workday);
-- The tip pool is per (location, business_date) — 029's grain.
create index timesheets_pool_idx       on timesheets (location_id, business_date);
create index timesheets_workweek_idx   on timesheets (employee_id, workweek_start);

create trigger trg_timesheets_updated before update on timesheets
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Filling pay_period_id and workweek_start
-- ----------------------------------------------------------------------------
-- By trigger rather than by asking every writer to agree. 027's exclusion
-- constraint is what makes the period lookup a total function; without it this
-- would have to decide what to do about two candidates.
--
-- `workweek_start` is a plain column and not `generated`, because the anchor
-- day is org configuration (orgs.settings.payroll) and a generated expression
-- must be IMMUTABLE — it may not read another table. A trigger may.
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

  -- isodow is 1=Monday..7=Sunday, the convention used schema-wide.
  dow := extract(isodow from new.workday);
  new.workweek_start := new.workday - ((dow - anchor + 7) % 7);

  select id into new.pay_period_id
    from pay_periods
   where org_id = new.org_id
     and new.workday between start_date and end_date
   limit 1;

  return new;
end;
$$;

-- Both INSERT and UPDATE: editing a punch's workday must move it to the right
-- fortnight, or a correction silently stays in the period it was first filed
-- under. Fires before the row is written, so the columns are never stale.
create trigger trg_timesheets_derived
  before insert or update of workday, org_id on timesheets
  for each row execute function set_timesheet_derived();

-- ----------------------------------------------------------------------------
-- 4. RLS — owner/admin on every verb, and writes need an OPEN period
-- ----------------------------------------------------------------------------
-- READ is role-gated, which is unusual in this schema and follows 020's
-- reasoning about `employees`: what a named person was paid for is the same
-- class of fact as their home address. 027's `pay_periods` is deliberately NOT
-- gated this way — a period is two dates and a status.
--
-- Supervisors do not see timesheets in v1. Loosening that later is a security
-- definer function naming safe columns (020's own comment anticipates it),
-- never a policy change: RLS filters ROWS, not columns.
alter table timesheets enable row level security;

-- The editability rule, in one expression, used by all three write policies.
-- It must stay in step with `isPayPeriodEditable` in web/src/lib/payPeriods.ts:
-- `open` AND `review`. Review is where corrections are MADE — gating it would
-- force a reviewer to step the period backwards to fix anything they found.
create or replace function public.timesheet_period_editable(p_period_id uuid)
returns boolean
language sql
stable
as $$
  -- A shift with no period is editable: it fell outside the calendar, and the
  -- fix for that is to edit it. Refusing would strand the row.
  select p_period_id is null
      or exists (
           select 1 from pay_periods
            where id = p_period_id
              and status in ('open', 'review')
         );
$$;

-- Every new public-schema function is executable by `anon` through Supabase's
-- default privileges, and revoking from PUBLIC does NOT undo that (002's
-- lesson). Revoke by name, then grant explicitly — a policy runs with the
-- QUERYING role's privileges, so without the grant every read of this table
-- fails with "permission denied for function" rather than returning no rows
-- (018's lesson, learned the same way).
revoke all on function public.timesheet_period_editable(uuid) from public;
revoke all on function public.timesheet_period_editable(uuid) from anon;
grant execute on function public.timesheet_period_editable(uuid) to authenticated;

create policy timesheets_select on timesheets for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy timesheets_insert on timesheets for insert
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.timesheet_period_editable(pay_period_id)
  );

create policy timesheets_update on timesheets for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    and public.timesheet_period_editable(pay_period_id)
  )
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.timesheet_period_editable(pay_period_id)
  );

create policy timesheets_delete on timesheets for delete
  using (
    user_has_role(org_id, array['owner', 'admin'])
    and public.timesheet_period_editable(pay_period_id)
  );

-- FOOTGUN THE APP MUST COVER BOTH WAYS. An update against a CLOSED period
-- matches zero rows and PostgREST returns NO error — the order_guide_entries
-- lesson, alive on a table where the silent no-op is someone's paycheck. So:
--
--   1. every write .select()s its own result and checks the row count, and
--   2. the cell renders READ_ONLY_VALUE rather than an editable control when
--      the period isn't open, so the write is never offered in the first place.
--
-- Neither alone is enough. (1) without (2) offers an edit that silently does
-- nothing; (2) without (1) trusts the UI to be the enforcement.

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from timesheets;                    -- 0 before the load
--   select policyname, cmd from pg_policies
--    where tablename = 'timesheets';                    -- four policies
--   select homebase_id, gusto_id, excludes_tips
--     from employees limit 1;                           -- three new columns
--
-- Prove the trigger fills both derived columns, and that the period gate bites.
-- Note this runs as the table owner, which BYPASSES RLS — so it checks the
-- TRIGGER, not the policy. The policy is checked from the app, signed in.
--
--   begin;
--     insert into timesheets (org_id, employee_id, workday, business_date)
--     select o.id, e.id, date '2026-07-24', date '2026-07-24'
--       from orgs o, employees e limit 1
--     returning workweek_start, pay_period_id;
--     -- workweek_start must be 2026-07-20 (the Monday), and pay_period_id must
--     -- be the Jul 20 – Aug 2 period, NOT null.
--   rollback;
--
--   select public.timesheet_period_editable(id), status
--     from pay_periods order by start_date desc limit 3;   -- false on closed
-- ============================================================================
