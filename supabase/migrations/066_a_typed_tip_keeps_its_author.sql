-- ============================================================================
-- restaurantfriend — migration 066 · a typed tip keeps its author
--
-- Fixes something 065 CLAIMED and did not do, found by walking the edit flow on
-- live data the same day.
--
-- 065's own comment says, of the pool row a hand-typed tip writes:
--
--     `reported_by` is the PERSON here, where the sync leaves it null to mean
--     Square. That difference is the audit trail: a pool figure either came
--     from the machine or from somebody, and the column says which.
--
-- It does say which, for about as long as it takes to press Sync. The tip feed
-- in `record_daily_sales` re-writes every editable day it is given, and it
-- stamps `reported_by = null` unconditionally — so the corrected FIGURE
-- survives (that half works, and was measured: 45 of 46 rows upserted, the
-- manual one skipped, the pool keeping 9999 rather than Square's 3207) while
-- the ATTRIBUTION flips to Square on the next pull.
--
-- The value being right is why this is small. Payroll divides the correct
-- number either way, and no screen reads `reported_by` yet. What is wrong is a
-- column that answers "who said this" with the wrong name, and a comment three
-- files away insisting it doesn't.
--
-- THE FIX IS THE `case`: a manual row's pool row keeps whatever author it has,
-- and only a square-sourced row is stamped as Square's. Nothing else changes —
-- the feed still reads the STORED figure (065's own fix), still skips closed
-- periods, still refuses a negative.
--
-- Depends on 063, 064, 065. Run in the Supabase SQL editor. RERUNNABLE.
--
-- NOT URGENT: `tip_pools.reported_by` has no reader in `web/src` today. This is
-- an audit column being made truthful, not a number being corrected.
-- ============================================================================

create or replace function public.record_daily_sales(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_orgs   integer;
  v_bad    text;
  v_sales  integer;
  v_tips   integer;
  v_neg    integer;
  v_dates  jsonb;
  v_count  integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'record_daily_sales expects an array of rows';
  end if;

  v_count := jsonb_array_length(p_rows);

  if v_count = 0 then
    return jsonb_build_object('sales_upserted', 0, 'tips_written', 0,
                              'tips_skipped_closed', 0, 'tips_refused_negative', 0,
                              'tip_dates', '[]'::jsonb);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where nullif(r->>'location_id', '') is null
  ) then
    raise exception 'Every row must name a location_id';
  end if;

  select r->>'location_id' into v_bad
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from locations l where l.id = (r->>'location_id')::uuid)
   limit 1;
  if v_bad is not null then
    raise exception 'No such location: %', v_bad;
  end if;

  select count(distinct l.org_id) into v_orgs
    from jsonb_array_elements(p_rows) r
    join locations l on l.id = (r->>'location_id')::uuid;
  if v_orgs <> 1 then
    raise exception 'Every row must name a location in one organisation';
  end if;

  select l.org_id into v_org
    from jsonb_array_elements(p_rows) r
    join locations l on l.id = (r->>'location_id')::uuid
   limit 1;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin']) then
    raise exception 'Only a manager or the owner can sync sales from Square';
  end if;

  insert into daily_sales (org_id, location_id, business_date,
                           net_sales_cents, tips_cents, source, synced_at)
  select v_org,
         (r->>'location_id')::uuid,
         (r->>'business_date')::date,
         (r->>'net_sales_cents')::integer,
         (r->>'tips_cents')::integer,
         'square',
         now()
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, location_id, business_date) do update
    set net_sales_cents = excluded.net_sales_cents,
        tips_cents      = excluded.tips_cents,
        synced_at       = excluded.synced_at
    where daily_sales.source <> 'manual';
  get diagnostics v_sales = row_count;

  select count(*) into v_neg
    from daily_sales ds
    join jsonb_array_elements(p_rows) r
      on ds.location_id = (r->>'location_id')::uuid
     and ds.business_date = (r->>'business_date')::date
   where ds.org_id = v_org
     and ds.tips_cents < 0
     and public.day_in_open_pay_period(v_org, ds.business_date);

  with fed as (
    insert into tip_pools (org_id, location_id, business_date,
                           reported_cents, reported_by, reported_at)
    select v_org, ds.location_id, ds.business_date, ds.tips_cents,
           -- THE AUTHOR IS DECIDED HERE, in the SELECT, and it has to be:
           -- `on conflict do update` can only see `excluded` and the target
           -- table, never this statement's own alias. Reaching for `ds.source`
           -- down there fails with "missing FROM-clause entry for table ds" —
           -- found by running it.
           case
             when ds.source = 'manual'
               then (select tp.reported_by from tip_pools tp
                      where tp.org_id = v_org
                        and tp.location_id = ds.location_id
                        and tp.business_date = ds.business_date)
             else null
           end,
           now()
      from daily_sales ds
      join jsonb_array_elements(p_rows) r
        on ds.location_id = (r->>'location_id')::uuid
       and ds.business_date = (r->>'business_date')::date
     where ds.org_id = v_org
       and ds.tips_cents >= 0
       and public.day_in_open_pay_period(v_org, ds.business_date)
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
          -- A MANUAL ROW KEEPS ITS AUTHOR, carried in from the SELECT above.
          -- Before 066 this was an unconditional null, which told every
          -- corrected day that Square had reported it. The figure was right;
          -- the name was not.
          reported_by    = excluded.reported_by,
          reported_at    = excluded.reported_at
    returning business_date
  )
  select count(*), coalesce(jsonb_agg(distinct business_date), '[]'::jsonb)
    into v_tips, v_dates
    from fed;

  return jsonb_build_object(
    'sales_upserted',        v_sales,
    'tips_written',          v_tips,
    'tips_skipped_closed',   v_count - v_tips - v_neg,
    'tips_refused_negative', v_neg,
    'tip_dates',             v_dates
  );
end;
$$;

revoke all on function public.record_daily_sales(jsonb) from public;
revoke all on function public.record_daily_sales(jsonb) from anon;
grant execute on function public.record_daily_sales(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (as a SIGNED-IN owner). The whole point is what survives a SECOND
-- sync, so this runs one, then another:
--
--   begin;
--     -- a day in an open period, corrected by hand:
--     select public.set_daily_sales_figure(
--              (select id from locations where code = 'DF02'),
--              '2026-08-20', 'tips_cents', 9999);
--     select reported_cents, reported_by is not null as by_a_person
--       from tip_pools t join locations l on l.id = t.location_id
--      where l.code = 'DF02' and business_date = '2026-08-20';
--       -- 9999 | true
--
--     -- a sync over it, twice, with Square saying something else:
--     select public.record_daily_sales(jsonb_build_array(jsonb_build_object(
--       'location_id', (select id from locations where code = 'DF02'),
--       'business_date', '2026-08-20', 'net_sales_cents', 1, 'tips_cents', 111)));
--     select public.record_daily_sales(jsonb_build_array(jsonb_build_object(
--       'location_id', (select id from locations where code = 'DF02'),
--       'business_date', '2026-08-20', 'net_sales_cents', 1, 'tips_cents', 111)));
--
--     select reported_cents, reported_by is not null as by_a_person
--       from tip_pools t join locations l on l.id = t.location_id
--      where l.code = 'DF02' and business_date = '2026-08-20';
--       -- STILL 9999 | true.  Before 066 this read 9999 | FALSE.
--   rollback;
--
--   -- And an ordinary synced day is still attributed to Square:
--   select count(*) from tip_pools t
--     join daily_sales d on d.location_id = t.location_id
--                       and d.business_date = t.business_date
--    where d.source = 'square' and t.reported_by is not null;
--     -- 0
-- ============================================================================
