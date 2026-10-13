-- ============================================================================
-- 202 — A PAY PERIOD LOCKS WHEN IT IS CLOSED, NOT WHEN IT IS EXPORTED
--
-- Mark, 2026-10-13: "Payroll should be editable until it is final/closed/
-- complete. Locking some items mid way through the process doesn't make sense
-- to me. … After exporting and importing into Gusto, I may catch something I
-- didn't see before, and want to come back to restaurant friend to make
-- changes before exporting again." And: "allow a pay period to be reopened
-- under very, very rare circumstances."
--
-- Until now Export Timesheets ran `freeze_pay_period`: it snapshotted every
-- tip allocation and benefit accrual and set the period to `exported`, which
-- 028's policies treat as read-only. Decision 10's reason for the snapshot
-- still stands — a later change to a person's entitlement must not re-derive
-- money already paid — but money is paid when payroll RUNS, which is `closed`.
--
-- What this does:
--   1. Closes the four periods that are `exported` today (2026-07-20 to
--      2026-09-13). They were paid weeks ago and each is fully snapshotted;
--      under the new rule `exported` is editable, so they must not stay there.
--      Any OTHER exported period loses its snapshot and is derived again.
--   2. `exported` becomes editable everywhere the database asks: the three
--      "is this period editable" functions and the tip-fill trigger.
--   3. `freeze_pay_period` is replaced by `close_pay_period`: the same
--      snapshot, the same checks, but it sets `closed`.
--   4. `reopen_pay_period(period, reason)`: OWNER only, a closed period only,
--      never one loaded from FileMaker (its tips cannot be derived again). It
--      clears the snapshot and puts the period back In Review.
--   5. A trigger refuses to move a period into or out of `closed` except
--      through those two functions, so a plain status update cannot close a
--      period with nothing snapshotted or reopen one without the owner.
--
-- RERUNNABLE. Needs 027, 028, 029, 033, 064, 151.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The periods exported under the old rule.
--    BEFORE the trigger in step 5 exists, so this plain update is allowed.
-- ---------------------------------------------------------------------------

update pay_periods
   set status    = 'closed',
       closed_at = coalesce(closed_at, now())
 where status = 'exported'
   and start_date in ('2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31');

-- Anything else still `exported` was frozen by the old Export and is about to
-- become editable. A snapshot on an editable period would win over the
-- recompute (`mergeFrozen`), so it goes.
delete from timesheet_benefits tb
 using timesheets t, pay_periods pp
 where tb.timesheet_id = t.id
   and t.pay_period_id = pp.id
   and pp.status = 'exported';

update timesheets t
   set tip_allocation       = null,
       allocation_frozen_at = null
  from pay_periods pp
 where t.pay_period_id = pp.id
   and pp.status = 'exported'
   and t.allocation_frozen_at is not null;

update tip_pools p
   set tip_rate_millicents = null,
       residual_cents      = null,
       frozen_at           = null
  from pay_periods pp
 where p.org_id = pp.org_id
   and p.business_date between pp.start_date and pp.end_date
   and pp.status = 'exported'
   and p.frozen_at is not null;

-- ---------------------------------------------------------------------------
-- 2. `exported` is editable. Only `closed` is not.
-- ---------------------------------------------------------------------------

create or replace function public.timesheet_period_editable(p_period_id uuid)
 returns boolean
 language sql
 stable
as $function$
  -- A shift with no period is editable: it fell outside the calendar, and the
  -- fix for that is to edit it. Refusing would strand the row.
  select p_period_id is null
      or exists (
           select 1 from pay_periods
            where id = p_period_id
              and status in ('open', 'review', 'exported')          -- <<< 202
         );
$function$;

create or replace function public.period_editable_on(p_org uuid, p_workday date)
 returns boolean
 language sql
 stable
as $function$
  select not exists (
    select 1 from pay_periods
     where org_id = p_org
       and p_workday between start_date and end_date
       and status not in ('open', 'review', 'exported')             -- <<< 202
  );
$function$;

create or replace function public.day_in_open_pay_period(p_org uuid, p_day date)
 returns boolean
 language sql
 stable
as $function$
  select exists (
    select 1 from pay_periods
     where org_id = p_org
       and p_day between start_date and end_date
       and status in ('open', 'review', 'exported')                 -- <<< 202
  );
$function$;

create or replace function public.fill_tip_pools_for_period()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status not in ('open', 'review', 'exported') then          -- <<< 202
    return new;
  end if;

  insert into tip_pools (org_id, location_id, business_date, reported_cents, reported_at)
  select ds.org_id, ds.location_id, ds.business_date, ds.tips_cents, now()
    from daily_sales ds
   where ds.org_id = new.org_id
     and ds.business_date between new.start_date and new.end_date
     and ds.tips_cents >= 0
  on conflict (org_id, location_id, business_date) do nothing;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Closing takes the snapshot. `freeze_pay_period`'s body from
--    `pg_get_functiondef` on 2026-10-13, with the lines marked 202 changed.
-- ---------------------------------------------------------------------------

drop function if exists public.freeze_pay_period(uuid, jsonb, jsonb, jsonb);

create or replace function public.close_pay_period(p_period_id uuid, p_allocations jsonb, p_pools jsonb, p_benefits jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    raise exception 'Only a manager or the owner can close a pay period';   -- <<< 202
  end if;
  if v_status = 'closed' then                                               -- <<< 202
    raise exception 'This pay period is already closed';
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

  -- REPLACE, don't merge. A period can be reopened and closed again, and a
  -- shift that no longer qualifies must LOSE its accrual rather than keep an
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

  -- <<< 202: closed, not exported. `exported_at` is left as the last export
  -- stamped it, or null when the period was never exported. The setting is
  -- what step 5's trigger looks for; `true` makes it last this transaction.
  perform set_config('rf.pay_period_gate', 'on', true);
  update pay_periods
     set status    = 'closed',
         closed_at = now(),
         closed_by = auth.uid()
   where id = p_period_id;
  perform set_config('rf.pay_period_gate', 'off', true);

  return v_frozen;
end;
$function$;

revoke all on function public.close_pay_period(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.close_pay_period(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reopening a closed period. Rare on purpose: the owner, with a reason.
-- ---------------------------------------------------------------------------

create or replace function public.reopen_pay_period(p_period_id uuid, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period  pay_periods%rowtype;
  v_cleared integer;
begin
  select * into v_period from pay_periods where id = p_period_id;
  if v_period.id is null then
    raise exception 'No such pay period';
  end if;

  if not user_has_role(v_period.org_id, array['owner']) then
    raise exception 'Only the owner can reopen a closed pay period';
  end if;
  if v_period.status <> 'closed' then
    raise exception 'This pay period is not closed';
  end if;
  -- A FileMaker period has no tip pools and no entitlements behind it, so
  -- nothing here could be derived again once it was editable.
  if v_period.legacy_id is not null then
    raise exception 'A pay period loaded from FileMaker cannot be reopened — correct it with an adjustment in the current period';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Reopening a pay period needs a reason';
  end if;

  -- The snapshot goes, so every figure is derived again and a correction made
  -- now reaches the next export. Closing takes a fresh one.
  delete from timesheet_benefits tb
   using timesheets t
   where tb.timesheet_id = t.id
     and t.pay_period_id = p_period_id;

  update timesheets
     set tip_allocation       = null,
         allocation_frozen_at = null
   where pay_period_id = p_period_id;
  get diagnostics v_cleared = row_count;

  update tip_pools
     set tip_rate_millicents = null,
         residual_cents      = null,
         frozen_at           = null
   where org_id = v_period.org_id
     and business_date between v_period.start_date and v_period.end_date;

  -- In Review, not Open: the period has ended and is being corrected.
  perform set_config('rf.pay_period_gate', 'on', true);
  update pay_periods
     set status        = 'review',
         closed_at     = null,
         closed_by     = null,
         exported_at   = null,
         exported_by   = null,
         reopened_at   = now(),
         reopened_by   = auth.uid(),
         reopen_reason = btrim(p_reason)
   where id = p_period_id;
  perform set_config('rf.pay_period_gate', 'off', true);

  return v_cleared;
end;
$function$;

revoke all on function public.reopen_pay_period(uuid, text) from public, anon;
grant execute on function public.reopen_pay_period(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. `closed` is entered and left only through the two functions above.
--    `pay_periods_update` lets a manager update the row, so without this a
--    plain status write would close a period with nothing snapshotted, or
--    reopen one without the owner or a reason.
-- ---------------------------------------------------------------------------

create or replace function public.guard_pay_period_closed()
 returns trigger
 language plpgsql
as $function$
begin
  if (old.status = 'closed') is distinct from (new.status = 'closed')
     and coalesce(current_setting('rf.pay_period_gate', true), '') <> 'on' then
    raise exception 'A pay period is closed with Close Pay Period and reopened by the owner, not by changing its status';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pay_periods_guard_closed on pay_periods;
create trigger trg_pay_periods_guard_closed
  before update of status on pay_periods
  for each row execute function guard_pay_period_closed();
