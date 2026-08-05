-- ============================================================================
-- restaurantfriend — migration 029 · break premiums and tip pools
--
-- Phase 5 of docs/timesheets-brief.md (the brief numbers this 027; Invoices took
-- 025/026 the same day it was written, so add two). Depends on 027 and 028.
--
-- The two tables here store a HUMAN DECISION, which is why they are separate
-- from 028's table of facts. A punch is what happened; a premium and a
-- corrected tip figure are what somebody decided about it.
--
-- ---------------------------------------------------------------------------
-- WHY break_premiums IS NOT A COLUMN ON timesheets
--
-- Decision 3: a break VIOLATION is derived and never stored — FileMaker's own
-- `cTimeSheetError` was an unstored calculation and was right to be, because a
-- flag about a punch goes stale the moment the punch is corrected. What IS
-- stored is the premium DECISION.
--
-- And that decision attaches to the WORKDAY, not to a shift. California caps it
-- at one meal premium and one rest premium per employee per day however many
-- shifts they worked, so a per-shift row would let two shifts each carry one.
-- The unique index below is that cap, enforced by the schema rather than by
-- remembering it.
--
-- ---------------------------------------------------------------------------
-- WHY THERE ARE NO DOLLARS ANYWHERE IN THIS FILE
--
-- Decision 1: the module exports HOURS and TIP DOLLARS and never a wage rate.
-- A meal premium is one hour of pay at the regular rate of compensation
-- (*Ferra v. Loews*, 2021), which folds in nondiscretionary bonuses — Donut
-- Friend has nine rate cards including Morning Bonus and Overnight Bonus. That
-- arithmetic is exactly what we don't want to own, so a premium is stored as
-- 1.00 HOURS and Gusto multiplies.
--
-- `tip_pools` is the one place dollars appear, and they are not wages: they are
-- money customers already handed over, which we are dividing rather than
-- computing.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. break_premiums
-- ----------------------------------------------------------------------------
create table break_premiums (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- Restricting, like timesheets: 023 lets owner/admin delete an employee, and
  -- that must not silently take a record of money owed with it.
  employee_id uuid not null references employees(id) on delete restrict,
  location_id uuid references locations(id) on delete set null,

  -- THE DAY, not the shift. See the header.
  workday     date not null,

  kind        text not null check (kind in ('meal', 'rest')),

  -- `owed`     the premium is due and will be exported.
  -- `waived`   a signed meal-break waiver covers it (employee_documents holds
  --            51 of them). Only meaningful for `meal`.
  -- `not_owed` looked at, and the rule wasn't broken — a real answer, and the
  --            reason a screen can show "reviewed" rather than "nothing here".
  decision    text not null check (decision in ('owed', 'waived', 'not_owed')),

  -- HOURS. One hour per premium under California law; a column rather than a
  -- constant because the law is the law and this is our reading of it.
  hours       numeric(8,2) not null default 1.00,

  -- NOT NULL and non-empty. A decision without a reason is one nobody can
  -- review a year later, which is the entire point of having this table rather
  -- than a boolean on the timesheet.
  reason      text not null check (length(btrim(reason)) > 0),

  decided_by  uuid references auth.users(id),
  decided_at  timestamptz not null default now(),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The California cap, as a constraint. One meal premium and one rest premium
  -- per employee per day, whatever they worked.
  unique (org_id, employee_id, workday, kind)
);

create index break_premiums_org_idx      on break_premiums (org_id, workday);
create index break_premiums_employee_idx on break_premiums (employee_id, workday);

create trigger trg_break_premiums_updated before update on break_premiums
  for each row execute function set_updated_at();

-- RLS matches `timesheets` exactly — owner/admin on every verb, and writes
-- require the workday's pay period to be open or in review. This is the same
-- read-only rule (decision 8) reaching a second table; a premium decided in a
-- fortnight that has been paid must not move afterwards.
alter table break_premiums enable row level security;

-- The period that owns a workday. 027's exclusion constraint makes this a total
-- function, so it can be a plain lookup rather than a policy full of joins.
create or replace function public.period_editable_on(p_org uuid, p_workday date)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from pay_periods
     where org_id = p_org
       and p_workday between start_date and end_date
       and status not in ('open', 'review')
  );
$$;

-- 002's lesson: every new public-schema function is executable by `anon`
-- through Supabase's defaults, and revoking from PUBLIC does not undo that.
-- 018's lesson: a policy runs with the QUERYING role's privileges, so the
-- explicit grant to `authenticated` is what keeps every read from failing with
-- "permission denied for function" instead of returning no rows.
revoke all on function public.period_editable_on(uuid, date) from public;
revoke all on function public.period_editable_on(uuid, date) from anon;
grant execute on function public.period_editable_on(uuid, date) to authenticated;

create policy break_premiums_select on break_premiums for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy break_premiums_insert on break_premiums for insert
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, workday)
  );

create policy break_premiums_update on break_premiums for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, workday)
  )
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, workday)
  );

create policy break_premiums_delete on break_premiums for delete
  using (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, workday)
  );

-- ----------------------------------------------------------------------------
-- 2. tip_pools
-- ----------------------------------------------------------------------------
-- One row per shop per business day. The figures a supervisor writes down at
-- close live in neither Homebase nor Gusto, which is the reason this module
-- exists at all.
create table tip_pools (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  location_id   uuid not null references locations(id) on delete restrict,
  business_date date not null,

  -- BOTH figures, never one (decision 5). Mark: the supervisors' numbers "have
  -- to be double checked and changed before I calculate tips." Collapsing them
  -- loses the fact that a correction happened — the same shape as the invoice
  -- extraction being a proposal rather than an answer.
  --
  -- Square card tips only, so everything here is Gusto "paycheck tips" and
  -- there is no cash split. GROSS, not net of Square's processing fee:
  -- California doesn't let the fee come out of tips.
  reported_cents  integer check (reported_cents >= 0),
  reported_by     uuid references auth.users(id),
  reported_at     timestamptz,

  corrected_cents integer check (corrected_cents >= 0),
  corrected_by    uuid references auth.users(id),
  corrected_at    timestamptz,
  correction_reason text,

  -- CENTS, as integers, everywhere. The allocations must sum to the pool
  -- EXACTLY or the shop pays out more or less than Square collected, every day.
  -- Floating point cannot promise that; integers can. `lib/tipPool.ts` does the
  -- arithmetic and this stores the result.
  --
  -- Frozen at export (decision 10), alongside each timesheet's tip_allocation.
  tip_rate_millicents integer,
  residual_cents      integer,
  frozen_at           timestamptz,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (org_id, location_id, business_date)
);

create index tip_pools_org_idx  on tip_pools (org_id, business_date);
create index tip_pools_date_idx on tip_pools (location_id, business_date);

create trigger trg_tip_pools_updated before update on tip_pools
  for each row execute function set_updated_at();

-- READ is membership-only, unlike break_premiums. A day's pooled tips and the
-- resulting dollars-per-hour are a shop-floor fact, and the people IN the pool
-- may see it — indeed they should, since it is their money being divided. What
-- it deliberately does not expose is any individual's allocation: that lives on
-- `timesheets`, which is owner/admin.
--
-- WRITE is owner/admin, because the CORRECTION is money. A supervisor reports
-- through the definer function below and can write nothing else.
alter table tip_pools enable row level security;

create policy tip_pools_select on tip_pools for select
  using (org_id in (select user_org_ids()));

create policy tip_pools_insert on tip_pools for insert
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, business_date)
  );

create policy tip_pools_update on tip_pools for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, business_date)
  )
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    and public.period_editable_on(org_id, business_date)
  );

-- No delete policy — 020's enforcement-by-absence. A day's pool is the record
-- of money that was handed over; if it is wrong, correct it.

-- ----------------------------------------------------------------------------
-- 3. report_pooled_tips — a supervisor writes ONE column
-- ----------------------------------------------------------------------------
-- RLS filters ROWS, not columns, and "a supervisor may set the reported figure
-- and nothing else" is a column rule. So it is a security definer function
-- naming exactly the safe columns — 002's `set_my_member_profile` pattern.
--
-- Definer means it bypasses RLS, so the body re-checks everything RLS would
-- have: org membership, that the location belongs to the org, and that the day
-- still sits in an editable period.
--
-- It deliberately CANNOT touch `corrected_cents`. The whole point of storing
-- both is that the correction is a separate, accountable act.
create or replace function public.report_pooled_tips(
  p_location_id uuid,
  p_business_date date,
  p_cents integer
)
returns tip_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_row  tip_pools;
begin
  if p_cents is null or p_cents < 0 then
    raise exception 'Pooled tips must be zero or more';
  end if;

  select org_id into v_org from locations where id = p_location_id;
  if v_org is null then
    raise exception 'No such location';
  end if;

  -- What the SELECT policy would have allowed: you must be a member of the org
  -- that owns this shop.
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not public.period_editable_on(v_org, p_business_date) then
    raise exception 'That day belongs to a pay period that is no longer open';
  end if;

  insert into tip_pools (org_id, location_id, business_date, reported_cents, reported_by, reported_at)
  values (v_org, p_location_id, p_business_date, p_cents, auth.uid(), now())
  on conflict (org_id, location_id, business_date) do update
    set reported_cents = excluded.reported_cents,
        reported_by    = excluded.reported_by,
        reported_at    = excluded.reported_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.report_pooled_tips(uuid, date, integer) from public;
revoke all on function public.report_pooled_tips(uuid, date, integer) from anon;
grant execute on function public.report_pooled_tips(uuid, date, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. freeze_pay_period — the one write that must outrank its own policy
-- ----------------------------------------------------------------------------
-- Freezing is the moment a period LEAVES the state its write policies require:
-- the allocations must land and the status must flip, in one transaction, and
-- the allocation write cannot be the thing that has to happen first.
--
-- The CLIENT computes. `lib/tipPool.ts` owns the allocator and is
-- fixture-tested; reimplementing that arithmetic in PL/pgSQL would be migration
-- 016's `nextDeliveryDate` trap — one rule in two languages, drifting. This
-- function VALIDATES and COMMITS.
--
-- It refuses a payload that doesn't cover every timesheet in the period, which
-- is what stops a stale browser tab freezing a fortnight it only half knows.
create or replace function public.freeze_pay_period(
  p_period_id uuid,
  -- [{ "timesheet_id": uuid, "tip_hours": numeric, "tip_allocation": numeric }]
  p_allocations jsonb,
  -- [{ "tip_pool_id": uuid, "tip_rate_millicents": int, "residual_cents": int }]
  p_pools jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_status   text;
  v_expected integer;
  v_given    integer;
  v_frozen   integer;
begin
  select org_id, status into v_org, v_status from pay_periods where id = p_period_id;
  if v_org is null then
    raise exception 'No such pay period';
  end if;

  -- Everything the policies would have asked, asked here.
  if not user_has_role(v_org, array['owner', 'admin']) then
    raise exception 'Only a manager or the owner can freeze a pay period';
  end if;
  if v_status not in ('open', 'review') then
    raise exception 'This pay period is already %', v_status;
  end if;

  select count(*) into v_expected from timesheets where pay_period_id = p_period_id;
  select count(*) into v_given from jsonb_array_elements(p_allocations);

  -- EVERY timesheet, or none. A partial freeze would leave some rows with an
  -- allocation and some without, in a period nobody can edit afterwards.
  if v_given <> v_expected then
    raise exception 'Allocations cover % of % timesheets in this period', v_given, v_expected;
  end if;

  update timesheets t
     set tip_hours            = (a->>'tip_hours')::numeric,
         tip_allocation       = (a->>'tip_allocation')::numeric,
         allocation_frozen_at = now()
    from jsonb_array_elements(p_allocations) a
   where t.id = (a->>'timesheet_id')::uuid
     and t.pay_period_id = p_period_id;
  get diagnostics v_frozen = row_count;

  if v_frozen <> v_expected then
    raise exception 'Froze % rows but the period holds % — an id did not match', v_frozen, v_expected;
  end if;

  update tip_pools p
     set tip_rate_millicents = (x->>'tip_rate_millicents')::integer,
         residual_cents      = (x->>'residual_cents')::integer,
         frozen_at           = now()
    from jsonb_array_elements(p_pools) x
   where p.id = (x->>'tip_pool_id')::uuid
     and p.org_id = v_org;

  update pay_periods
     set status      = 'exported',
         exported_at = now(),
         exported_by = auth.uid()
   where id = p_period_id;

  return v_frozen;
end;
$$;

revoke all on function public.freeze_pay_period(uuid, jsonb, jsonb) from public;
revoke all on function public.freeze_pay_period(uuid, jsonb, jsonb) from anon;
grant execute on function public.freeze_pay_period(uuid, jsonb, jsonb) to authenticated;

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from break_premiums;   -- 0
--   select count(*) from tip_pools;        -- 0
--   select policyname, cmd from pg_policies where tablename in
--     ('break_premiums','tip_pools');      -- 4 + 3, tip_pools has NO delete
--
--   -- the California cap, proved by being refused:
--   begin;
--     insert into break_premiums (org_id, employee_id, workday, kind, decision, reason)
--       select o.id, e.id, date '2026-07-24', 'meal', 'owed', 'no meal by hour 5'
--         from orgs o join employees e on e.org_id = o.id limit 1;
--     insert into break_premiums (org_id, employee_id, workday, kind, decision, reason)
--       select o.id, e.id, date '2026-07-24', 'meal', 'owed', 'second shift'
--         from orgs o join employees e on e.org_id = o.id limit 1;   -- must ERROR
--   rollback;
--
--   -- an empty reason is not a reason:
--   --   ... 'owed', '   '  -> must ERROR on break_premiums_reason_check
--
--   -- the functions exist and anon cannot call them:
--   select proname from pg_proc where proname in
--     ('report_pooled_tips','freeze_pay_period','period_editable_on');
-- ============================================================================
