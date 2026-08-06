-- ============================================================================
-- restaurantfriend — migration 033 · payroll benefits
--
-- The commuter benefit, and the shape that carries whatever comes after it
-- (overnight differentials, reimbursements). Depends on 020, 027, 028, 029, 031.
--
-- Some employees get a flat allowance per shift to cover parking. It has to
-- reach Gusto's `custom_earning_commuter_benefit` column, which
-- `lib/gustoExport.ts` has been emitting as a hardcoded empty string — so the
-- export as it stands is $432 a fortnight short across five people.
--
-- ---------------------------------------------------------------------------
-- WHY `locations` IS NOT TOUCHED
--
-- FileMaker put the benefit on BOTH tables: a boolean + amount + period on
-- Location, and an amount + unit + repeating list of locations on the employee.
-- Measured over the real export, the location half decides nothing:
--
--   Angelica Castellanos (configured DF02): 0 of 359 DF01 shifts stamped,
--                                           4 of 4 DF02 stamped.
--   Erick Mejia          (configured DF02): 0 of 615 DF01, 32 of 34 DF02.
--   Casildo Herrera    (configured DF01+2): 404 of 418 DF01, 128 of 135 DF02.
--
-- The employee's own location list classifies every shift, and identically. And
-- DF01's location flag is on with NO amount at all, so the location row is not
-- even the source of the money. A second place to state one fact is migration
-- 016's `nextDeliveryDate` trap — one rule in two languages, drifting.
--
-- So the entitlement is per (employee, location), and the amount cascades
-- entitlement → benefit default, which is design rule 6's shape
-- (`vendor_item_location_prices` override → `vendor_items.price`).
--
-- ---------------------------------------------------------------------------
-- WHY NOTHING IS STAMPED ONTO A TIMESHEET
--
-- FileMaker's script wrote a dollar figure onto each timesheet at import, and
-- that stamp has holes. Casildo Herrera worked seven consecutive DF02
-- overnights in July 2024 unstamped; two currently-configured people, one of
-- them active, were never stamped at all. Nothing ever surfaced any of it,
-- because a stamped number cannot explain itself.
--
-- So an accrual is DERIVED — decision 3's posture, the one `breakRules` already
-- takes — and `lib/payrollBenefits.ts` owns the arithmetic. A derived rule has
-- no holes to have, and the row expansion can say "entitled at DF02, and this
-- shift was at DF01" where a stamped $0 could only sit there silently.
--
-- ---------------------------------------------------------------------------
-- WHY THERE ARE DOLLARS HERE, WHEN 029 HAS ALMOST NONE
--
-- Decision 1 forbids storing a wage RATE and computing pay from it — a meal
-- premium is one hour at the regular rate of compensation and we refuse to own
-- that arithmetic. A flat allowance is derived from no rate at all: it is $12
-- because somebody decided $12. That is the class of `tip_pools` dollars, not
-- the class of a rate card.
--
-- `numeric(10,2)` rather than 029's integer cents, because there is no division
-- here and so no residual to conserve exactly. It matches
-- `timesheets.tip_allocation`.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payroll_benefits — the catalog
-- ----------------------------------------------------------------------------
create table payroll_benefits (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,

  code           text not null check (code ~ '^[a-z0-9_]+$'),
  name           text not null check (length(btrim(name)) > 0),

  -- The Gusto column this benefit's dollars land in. Deliberately NOT
  -- constrained to a value list here: the export is a DESCRIBED format (design
  -- rule 2) and the column set lives in `lib/gustoExport`'s GUSTO_COLUMNS.
  -- What guards it is the EARNING_COLUMNS pick list in the UI, which makes a
  -- typo unenterable, plus an `exportReadiness` caveat that NAMES the dollars
  -- it dropped. A SQL-editor write can still point one at an hours column;
  -- that is the honest cost of a described format.
  gusto_column   text not null check (length(btrim(gusto_column)) > 0),

  -- `per_shift`   one accrual per qualifying shift.
  -- `per_workday` one per employee per day, on the chronologically first
  --               qualifying shift — 029's cap shape.
  -- `per_period`  one per employee per pay period.
  --
  -- There is no `per_hour` and no percentage, and there must never be one: a
  -- percentage would be a percentage OF WAGES, which needs a rate, which
  -- decision 1 forbids storing.
  unit           text not null check (unit in ('per_shift', 'per_workday', 'per_period')),

  default_amount numeric(10,2) check (default_amount is null or default_amount >= 0),

  -- `is_active`, that exact name, because `catalog/ActiveToggle` writes
  -- `.update({ is_active })` and the parts table forbids hand-rolling a second
  -- switch to accommodate a different spelling.
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (org_id, code)
);

create index payroll_benefits_org_idx on payroll_benefits (org_id, is_active);

create trigger trg_payroll_benefits_updated before update on payroll_benefits
  for each row execute function set_updated_at();

-- READ is membership-only, unlike `employee_benefits` below. This table names
-- no person: "we pay a commuter allowance of $12 a shift" is org configuration,
-- the class of `shop_sections`, not the class of `employees`.
alter table payroll_benefits enable row level security;

create policy payroll_benefits_select on payroll_benefits for select
  using (org_id in (select user_org_ids()));

create policy payroll_benefits_insert on payroll_benefits for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy payroll_benefits_update on payroll_benefits for update
  using      (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- No delete policy — 020's enforcement-by-absence. A benefit carrying
-- entitlements or frozen accruals must not vanish; `is_active = false` retires
-- one, and the accruals it already paid keep their referent.

-- ----------------------------------------------------------------------------
-- 2. employee_benefits — the entitlement
-- ----------------------------------------------------------------------------
create table employee_benefits (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- CASCADE, deliberately unlike `timesheets` and `break_premiums`, which both
  -- restrict. Those are records of money OWED and must not follow a deleted
  -- employee out of the building. This is standing CONFIGURATION; the record of
  -- money lives in `timesheet_benefits`, which hangs off the timesheet, and
  -- 028's restrict already refuses to delete anyone who has a shift.
  employee_id uuid not null references employees(id) on delete cascade,

  benefit_id  uuid not null references payroll_benefits(id) on delete restrict,

  -- NOT NULL, one row per shop. This IS FileMaker's repeating field
  -- (`DF01<VT>DF02` for six people); it first-classes "earns at one shop and
  -- not the other", which the measurements show is the thing that decided every
  -- stamp; and it keeps the constraint below out of the nulls-in-a-unique-index
  -- trap the vendor-invoice number already taught us (Postgres allows unlimited
  -- NULLs in a unique index, so null rows would silently skip it).
  location_id uuid not null references locations(id) on delete restrict,

  -- null = the benefit's `default_amount`. Design rule 6's override → base, so
  -- changing the default still moves everybody who never differed from it.
  amount      numeric(10,2) check (amount is null or amount >= 0),

  -- INCLUSIVE at both ends; null = unbounded. Tested against the shift's
  -- `workday`, which is what every other rule in this module keys on.
  starts_on   date,
  ends_on     date,

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint employee_benefits_dates
    check (starts_on is null or ends_on is null or ends_on >= starts_on),

  -- 027's idiom, second outing, and it is NOT a unique index on purpose. A
  -- plain unique (org, employee, benefit, location) would make the two date
  -- columns decoration — you could never say "$12 through June, $15 from July".
  --
  -- This says at most ONE entitlement covers any given day, which makes "which
  -- entitlement pays this shift" a TOTAL function. That is the same property
  -- that let 028 fill `pay_period_id` from a trigger, and it is what lets
  -- `lib/payrollBenefits.ts` be deterministic rather than order-dependent.
  --
  -- btree_gist is already installed by 027.
  constraint employee_benefits_no_overlap
    exclude using gist (
      org_id      with =,
      employee_id with =,
      benefit_id  with =,
      location_id with =,
      daterange(starts_on, ends_on, '[]') with &&
    )
);

create index employee_benefits_employee_idx on employee_benefits (employee_id, benefit_id);
create index employee_benefits_org_idx      on employee_benefits (org_id);

create trigger trg_employee_benefits_updated before update on employee_benefits
  for each row execute function set_updated_at();

-- Owner/admin on every verb including SELECT — 020's reasoning, which 028
-- inherited: what a named person is paid is the same class of fact as their
-- home address.
--
-- WRITES DELIBERATELY DO NOT REQUIRE PERIOD EDITABILITY, unlike break_premiums
-- and tip_pools. Three reasons, and they are worth stating because the omission
-- looks like one:
--
--   1. An entitlement is a standing fact about a PERSON, the class of
--      `employees.excludes_tips` — which 028 put on `employees` with no period
--      gate at all, for exactly this reason.
--   2. `period_editable_on` takes ONE DAY. An entitlement carries a RANGE,
--      routinely unbounded and routinely spanning closed periods. There is no
--      single period to test, and testing the one containing `starts_on` would
--      refuse a correction to a 2019 entitlement for reasons nobody could
--      explain at the screen.
--   3. What decision 8 actually protects is MONEY ALREADY PAID, and that is
--      protected by the freeze rather than by this policy — see
--      `timesheet_benefits` below. The snapshot is what earns this table its
--      ungated write.
--
-- A DELETE policy exists, unlike `tip_pools`, because an entitlement typed
-- against the wrong Sanchez is a mistake rather than history. The UI should
-- still prefer setting `ends_on`.
alter table employee_benefits enable row level security;

create policy employee_benefits_select on employee_benefits for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy employee_benefits_insert on employee_benefits for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy employee_benefits_update on employee_benefits for update
  using      (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy employee_benefits_delete on employee_benefits for delete
  using (user_has_role(org_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- 3. timesheet_benefits — the frozen accrual
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS AT ALL, when the accrual is derived:
--
-- Entitlements are editable in a closed period BY DESIGN (see above). Without a
-- snapshot, a September correction to Angelica's shops would silently restate
-- July's commuter dollars — money Gusto has already paid. That is precisely the
-- scenario decision 10 froze the tip allocations for, reaching a second table.
--
-- WHY A TABLE AND NOT `timesheets.commuter_benefit`: two more benefits are
-- already named (overnight, reimbursements), and a column each is a migration
-- each plus an edit to the CSV writer each — the thing the data-driven earnings
-- lookup in `lib/gustoExport` exists to kill. And not a jsonb column either:
-- it could not be constrained or aggregated, and 029 already argued at length
-- why `break_premiums` is a table.
create table timesheet_benefits (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,

  -- CASCADE is safe: 028's delete policy already refuses to delete a timesheet
  -- whose period is not editable, so history cannot quietly take its own
  -- accruals with it.
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  benefit_id   uuid not null references payroll_benefits(id) on delete restrict,

  amount       numeric(10,2) not null check (amount >= 0),
  frozen_at    timestamptz not null default now(),

  unique (timesheet_id, benefit_id)
);

create index timesheet_benefits_org_idx on timesheet_benefits (org_id, benefit_id);

-- No `employee_id` column: the export already holds the timesheets keyed by id,
-- and 028's `timesheets_employee_idx` makes the one join cheap. A denormalized
-- copy would be a second place for the answer to be wrong.

alter table timesheet_benefits enable row level security;

-- SELECT only, owner/admin — this is what a named person was paid.
create policy timesheet_benefits_select on timesheet_benefits for select
  using (user_has_role(org_id, array['owner', 'admin']));

-- NO insert, update or delete policy, on purpose. The ONLY writer is
-- `freeze_pay_period`, which is security definer and bypasses RLS, so the
-- snapshot is structurally unwritable from the app. That is 020's
-- enforcement-by-absence with nothing left to argue about.

-- ----------------------------------------------------------------------------
-- 4. Seed the commuter benefit
-- ----------------------------------------------------------------------------
-- One row per org, so this stays multi-tenant-honest with one org (design
-- rule 1).
--
-- `per_shift` WILL LOOK LIKE A BUG and is not. Both FileMaker unit fields —
-- `Employees.commuterReimbUnit` and `Location.commuterBenefit_period_t` —
-- literally read "Day". The MONEY went out per shift: 32 employee-days carry
-- two $12 stamps, 16 of them in 2026. Mark's own reading is per shift, and the
-- data agrees with him rather than with the field. Same posture as the
-- crossing-midnight rule, where the TIMES decide and `ts_Date_End` is
-- corroboration only. It is one tap to change on /payroll-benefits.
insert into payroll_benefits (org_id, code, name, gusto_column, unit, default_amount, notes)
select id,
       'commuter',
       'Commuter benefit',
       'custom_earning_commuter_benefit',
       'per_shift',
       12.00,
       'FileMaker''s commuterReimb* fields. Both FMP unit fields say "Day"; the money went out per SHIFT — 32 employee-days carry two stamps. The data wins.'
  from orgs;

-- ----------------------------------------------------------------------------
-- 5. freeze_pay_period — now snapshots the accruals too
-- ----------------------------------------------------------------------------
-- DROP FIRST. `create or replace` cannot change an argument list: a fourth
-- parameter creates an OVERLOAD and leaves 029's three-argument version live,
-- so a stale browser tab would keep freezing fortnights with no benefits in
-- them and no error anywhere. With the drop, a stale tab gets PostgREST's
-- PGRST202 "Could not find the function in the schema cache", which is loud and
-- correct.
drop function if exists public.freeze_pay_period(uuid, jsonb, jsonb);

create or replace function public.freeze_pay_period(
  p_period_id uuid,
  -- [{ "timesheet_id": uuid, "tip_hours": numeric, "tip_allocation": numeric }]
  p_allocations jsonb,
  -- [{ "tip_pool_id": uuid, "tip_rate_millicents": int, "residual_cents": int }]
  p_pools jsonb,
  -- [{ "timesheet_id": uuid, "benefit_id": uuid, "amount": numeric }]
  p_benefits jsonb
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
  v_written  integer;
  v_offered  integer;
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

  -- REPLACE, don't merge. A period can be reopened and re-frozen, and a shift
  -- that no longer qualifies — because the entitlement was corrected, which is
  -- the whole reason to reopen — must LOSE its accrual rather than keep an
  -- orphan that no rule would produce again.
  delete from timesheet_benefits tb
   using timesheets t
   where tb.timesheet_id = t.id
     and t.pay_period_id = p_period_id;

  insert into timesheet_benefits (org_id, timesheet_id, benefit_id, amount)
  select v_org,
         (b->>'timesheet_id')::uuid,
         (b->>'benefit_id')::uuid,
         (b->>'amount')::numeric
    from jsonb_array_elements(p_benefits) b
   where exists (
           select 1 from timesheets t
            where t.id = (b->>'timesheet_id')::uuid
              and t.pay_period_id = p_period_id
         )
     and exists (
           select 1 from payroll_benefits pb
            where pb.id = (b->>'benefit_id')::uuid
              and pb.org_id = v_org
         );
  get diagnostics v_written = row_count;

  select count(*) into v_offered from jsonb_array_elements(p_benefits);

  -- NOTE THE ASYMMETRY with the allocations guard above, and it is deliberate:
  -- there is no "covers every timesheet" check here, because most shifts accrue
  -- nothing and the payload is SPARSE by construction. What must hold is that
  -- every row we were GIVEN actually landed.
  if v_written <> v_offered then
    raise exception
      'Wrote % of % benefit accruals — a timesheet or benefit id did not belong to this period',
      v_written, v_offered;
  end if;

  update pay_periods
     set status      = 'exported',
         exported_at = now(),
         exported_by = auth.uid()
   where id = p_period_id;

  return v_frozen;
end;
$$;

-- 002's lesson, against the NEW four-argument signature. The old grants died
-- with the dropped function.
revoke all on function public.freeze_pay_period(uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.freeze_pay_period(uuid, jsonb, jsonb, jsonb) from anon;
grant execute on function public.freeze_pay_period(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from payroll_benefits;    -- 1 per org, code 'commuter'
--   select count(*) from employee_benefits;   -- 0
--   select count(*) from timesheet_benefits;  -- 0
--
--   select tablename, policyname, cmd from pg_policies where tablename in
--     ('payroll_benefits','employee_benefits','timesheet_benefits')
--     order by tablename, cmd;
--   -- payroll_benefits 3 (NO delete) · employee_benefits 4
--   -- · timesheet_benefits 1 (select ONLY)
--
--   -- the overlap constraint, proved by being REFUSED:
--   begin;
--     insert into employee_benefits (org_id, employee_id, benefit_id, location_id, starts_on, ends_on)
--       select o.id, e.id, b.id, l.id, null, date '2025-12-31'
--         from orgs o
--         join employees e        on e.org_id = o.id
--         join payroll_benefits b on b.org_id = o.id and b.code = 'commuter'
--         join locations l        on l.org_id = o.id and l.code = 'DF01'
--        limit 1;                                              -- ok
--     insert into employee_benefits (org_id, employee_id, benefit_id, location_id, starts_on, ends_on)
--       select o.id, e.id, b.id, l.id, date '2026-01-01', date '2026-12-31'
--         from orgs o
--         join employees e        on e.org_id = o.id
--         join payroll_benefits b on b.org_id = o.id and b.code = 'commuter'
--         join locations l        on l.org_id = o.id and l.code = 'DF01'
--        limit 1;                                              -- ok, no overlap
--     insert into employee_benefits (org_id, employee_id, benefit_id, location_id, starts_on, ends_on)
--       select o.id, e.id, b.id, l.id, date '2026-06-01', null
--         from orgs o
--         join employees e        on e.org_id = o.id
--         join payroll_benefits b on b.org_id = o.id and b.code = 'commuter'
--         join locations l        on l.org_id = o.id and l.code = 'DF01'
--        limit 1;                                              -- must ERROR
--   rollback;
--
--   -- EXACTLY ONE freeze_pay_period, and it takes four arguments. Two rows here
--   -- means the drop didn't happen and a stale tab can still freeze a period
--   -- with no benefits in it:
--   select proname, pg_get_function_arguments(oid) from pg_proc
--    where proname = 'freeze_pay_period';
-- ============================================================================
