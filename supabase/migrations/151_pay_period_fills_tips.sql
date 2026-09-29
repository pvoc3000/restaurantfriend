-- ============================================================================
-- restaurantfriend — migration 151 · a new pay period fills its tips from
-- sales already synced (2026-09-29)
--
-- THE TRAP. Since 064, `record_daily_sales` writes a shop-day's tip figure only
-- when an OPEN pay period covers that day — right, because a full backfill
-- otherwise wrote tip pools for 2015. But it means syncing Square BEFORE the
-- period is created pulls the sales and silently skips the tips, and nothing
-- goes back for them: the figures sit in `daily_sales` and the worksheet reads
-- "no tip figure entered". Mark hit exactly this on Sep 14–27 and had to sync
-- again after creating the period.
--
-- THE FIX. When a pay period is created — or its dates move, or it is reopened
-- — copy `daily_sales.tips_cents` into `tip_pools` for every shop-day in its
-- range that HAS NO POOL YET. `on conflict do nothing`: a figure a supervisor
-- reported or somebody corrected is never touched, and a later Square sync
-- still refreshes as it always has. Negative tips (a refund-heavy day) are
-- skipped, as the sync skips them — `reported_cents` may not be negative.
--
-- A TRIGGER rather than a call from New Pay Period, so every way a period comes
-- to exist gets it. SECURITY DEFINER because the insert policy on `tip_pools`
-- asks `period_editable_on`, and the function already scopes itself to the
-- period's own org and dates; a trigger function cannot be called directly.
--
-- Run in the Supabase SQL editor. RERUNNABLE. Backfills nothing on its own —
-- the Sep 14–27 pools already exist.
-- ============================================================================

create or replace function public.fill_tip_pools_for_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('open', 'review') then
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
$$;

revoke all on function public.fill_tip_pools_for_period() from public;
revoke all on function public.fill_tip_pools_for_period() from anon;

drop trigger if exists trg_pay_periods_fill_tips on pay_periods;
create trigger trg_pay_periods_fill_tips
  after insert or update of start_date, end_date, status on pay_periods
  for each row execute function public.fill_tip_pools_for_period();

notify pgrst, 'reload schema';
