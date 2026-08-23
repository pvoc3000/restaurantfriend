-- ============================================================================
-- restaurantfriend — migration 065 · a day's figures can be corrected by hand
--
-- Why (Mark, 2026-08-23): "Can the sales and tips data be editable?"
--
-- 063 gave `daily_sales` NO insert, update or delete policy at all — the only
-- writer was `record_daily_sales`, because Square is the authority and a table
-- fed by a machine should not also be typeable. That is still the default; what
-- this adds is the exception, and the exception has to answer one question
-- before anything else.
--
-- ---------------------------------------------------------------------------
-- WHAT THE NEXT SYNC DOES WITH YOUR EDIT
--
-- Every day you correct is a day Square will overwrite on the next pull, unless
-- the sync is told to leave it alone. Mark's ruling: the edit wins.
--
-- So an edited row flips `source` from 'square' to 'manual', and the upsert in
-- `record_daily_sales` skips manual rows from then on. 063 put that column
-- there with exactly these two values and no writer for the second — this is
-- it. Being in the DATA rather than in a flag column beside it means a row
-- explains itself: `source = 'manual'` is the whole story.
--
-- Known cost, and it is the reason `revert_daily_sales_to_square` exists in the
-- same breath: a day you corrected never updates again, even if Square later
-- corrects ITSELF. Reverting is one command on the row and the next sync
-- re-lands it.
--
-- ---------------------------------------------------------------------------
-- WHY A FUNCTION AND NOT AN UPDATE POLICY
--
-- 044's rule, third outing: RLS filters ROWS, and "owner/admin may set these
-- TWO figures" is a COLUMN rule. An update policy would also hand them
-- `synced_at`, `source` and `business_date` — including the ability to set
-- `source` back to 'square' while leaving a hand-typed figure in place, which
-- is a row that lies about where its number came from.
--
-- `set_schedule_actual` is the template down to the shape: a column NAME plus a
-- value, whitelisted by a `case when` INSIDE the update and never by dynamic
-- SQL. That whitelist is the entire security property.
--
-- ---------------------------------------------------------------------------
-- AND THE TIP POOL FOLLOWS THE STORED FIGURE, NOT THE PAYLOAD
--
-- This is the half that would have broken quietly. 063's tip feed inserted into
-- `tip_pools` straight from the sync's payload — Square's number. With manual
-- rows in play that splits the truth: `daily_sales` would keep the corrected
-- tip while payroll got Square's, and nothing on any screen would say so.
--
-- So the feed now reads back from `daily_sales` AFTER the upsert, scoped to the
-- days in this payload. A corrected tip reaches payroll; an uncorrected one is
-- unchanged. `set_daily_sales_figure` does the same thing for the edit itself,
-- or a correction would sit in `daily_sales` until a sync that now skips it.
--
-- Depends on 063 and 064. Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. set_daily_sales_figure — the only way to type a number into this table
-- ----------------------------------------------------------------------------
create or replace function public.set_daily_sales_figure(
  p_location_id uuid,
  p_business_date date,
  p_column text,
  p_cents integer
)
returns daily_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row daily_sales;
begin
  -- The whitelist. A `case when` inside the UPDATE, never dynamic SQL.
  if p_column is null or p_column not in ('net_sales_cents', 'tips_cents') then
    raise exception 'Only net_sales_cents or tips_cents can be set by hand';
  end if;

  if p_cents is null then
    raise exception 'A figure is required — there is no such thing as a day with no takings recorded';
  end if;

  select org_id into v_org from locations where id = p_location_id;
  if v_org is null then
    raise exception 'No such location';
  end if;
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;
  if not user_has_role(v_org, array['owner', 'admin']) then
    raise exception 'Only a manager or the owner can correct a day''s figures';
  end if;

  -- NO `>= 0` GUARD, matching the table: a day of net refunds is legitimately
  -- negative, and 063 left the check off deliberately. A negative TIP figure is
  -- refused further down, where it would otherwise trip tip_pools' own check.

  -- An UPSERT rather than an update: correcting a day Square has never reported
  -- is exactly the case this exists for — a cash event, an outage — and there
  -- may be no row yet.
  insert into daily_sales (org_id, location_id, business_date,
                           net_sales_cents, tips_cents, source, synced_at)
  values (v_org, p_location_id, p_business_date,
          case when p_column = 'net_sales_cents' then p_cents else 0 end,
          case when p_column = 'tips_cents'      then p_cents else 0 end,
          'manual', now())
  on conflict (org_id, location_id, business_date) do update
    set net_sales_cents = case when p_column = 'net_sales_cents'
                               then p_cents else daily_sales.net_sales_cents end,
        tips_cents      = case when p_column = 'tips_cents'
                               then p_cents else daily_sales.tips_cents end,
        -- THE ROW IS NOW A HUMAN'S. `record_daily_sales` skips it from here on.
        source          = 'manual'
  returning * into v_row;

  -- The pool follows the corrected figure immediately. Without this a tip
  -- typed here would sit in `daily_sales` waiting for a sync that now skips
  -- the row — so it would never reach payroll at all.
  if v_row.tips_cents >= 0
     and public.day_in_open_pay_period(v_org, p_business_date) then
    insert into tip_pools (org_id, location_id, business_date,
                           reported_cents, reported_by, reported_at)
    values (v_org, p_location_id, p_business_date, v_row.tips_cents, auth.uid(), now())
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
          reported_by    = excluded.reported_by,
          reported_at    = excluded.reported_at;
    -- `reported_by` is the PERSON here, where the sync leaves it null to mean
    -- Square. That difference is the audit trail: a pool figure either came
    -- from the machine or from somebody, and the column says which.
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_daily_sales_figure(uuid, date, text, integer) from public;
revoke all on function public.set_daily_sales_figure(uuid, date, text, integer) from anon;
grant execute on function public.set_daily_sales_figure(uuid, date, text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. revert_daily_sales_to_square — the way back
-- ----------------------------------------------------------------------------
-- Hands the row back to the sync. It deliberately does NOT restore Square's
-- figures itself: it does not know them, and inventing a value here would be
-- worse than leaving the corrected one visible until the next pull replaces it.
create or replace function public.revert_daily_sales_to_square(
  p_location_id uuid,
  p_business_date date
)
returns daily_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row daily_sales;
begin
  select org_id into v_org from locations where id = p_location_id;
  if v_org is null then
    raise exception 'No such location';
  end if;
  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;
  if not user_has_role(v_org, array['owner', 'admin']) then
    raise exception 'Only a manager or the owner can hand a day back to Square';
  end if;

  update daily_sales
     set source = 'square'
   where org_id = v_org
     and location_id = p_location_id
     and business_date = p_business_date
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No figures recorded for that day';
  end if;

  return v_row;
end;
$$;

revoke all on function public.revert_daily_sales_to_square(uuid, date) from public;
revoke all on function public.revert_daily_sales_to_square(uuid, date) from anon;
grant execute on function public.revert_daily_sales_to_square(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. record_daily_sales — skip manual rows, and feed tips from what is STORED
-- ----------------------------------------------------------------------------
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
    -- A HAND-CORRECTED DAY IS LEFT ALONE. This one clause is the whole of
    -- Mark's ruling that the edit wins; `revert_daily_sales_to_square` is how a
    -- row rejoins the sync. Note `source` is no longer in the SET list either —
    -- an upsert that skipped the figures but reset the flag would hand the row
    -- back silently on the very next pull.
    where daily_sales.source <> 'manual';
  get diagnostics v_sales = row_count;

  -- THE TIP FEED READS BACK FROM `daily_sales`, not from the payload, so a
  -- corrected tip reaches payroll and Square's superseded one does not. See the
  -- header — feeding from the payload split the truth between the two tables
  -- with nothing on screen to say so.
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
    select v_org, ds.location_id, ds.business_date, ds.tips_cents, null, now()
      from daily_sales ds
      join jsonb_array_elements(p_rows) r
        on ds.location_id = (r->>'location_id')::uuid
       and ds.business_date = (r->>'business_date')::date
     where ds.org_id = v_org
       and ds.tips_cents >= 0
       and public.day_in_open_pay_period(v_org, ds.business_date)
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
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
-- Verify (as a SIGNED-IN owner, not service_role — these are RLS paths):
--
--   -- Nothing is manual yet:
--   select source, count(*) from daily_sales group by 1;   -- square | 8418
--
--   -- The whitelist RAISES rather than writing something else:
--   select public.set_daily_sales_figure(
--            (select id from locations where code = 'DF01'),
--            '2026-08-20', 'synced_at', 1);
--     -- ERROR: Only net_sales_cents or tips_cents can be set by hand
--
--   -- A correction takes, and flips the row to manual (roll this back):
--   begin;
--     select net_sales_cents, source from daily_sales d
--       join locations l on l.id = d.location_id
--      where l.code = 'DF01' and business_date = '2026-08-20';
--     select public.set_daily_sales_figure(
--              (select id from locations where code = 'DF01'),
--              '2026-08-20', 'net_sales_cents', 12345);
--       -- net_sales_cents 12345, source 'manual', tips_cents UNCHANGED
--
--     -- …and the sync now leaves it alone:
--     select public.record_daily_sales(jsonb_build_array(jsonb_build_object(
--       'location_id', (select id from locations where code = 'DF01'),
--       'business_date', '2026-08-20', 'net_sales_cents', 999, 'tips_cents', 999)));
--     select net_sales_cents, tips_cents, source from daily_sales d
--       join locations l on l.id = d.location_id
--      where l.code = 'DF01' and business_date = '2026-08-20';
--       -- STILL 12345 and 'manual' — the sync skipped it
--
--     -- Reverting hands it back, and the next sync re-lands Square's figures:
--     select public.revert_daily_sales_to_square(
--              (select id from locations where code = 'DF01'), '2026-08-20');
--     select public.record_daily_sales(jsonb_build_array(jsonb_build_object(
--       'location_id', (select id from locations where code = 'DF01'),
--       'business_date', '2026-08-20', 'net_sales_cents', 999, 'tips_cents', 999)));
--       -- now 999 / 999, source 'square'
--   rollback;
--
--   -- A staffer is refused BY NAME:
--   --   ERROR: Only a manager or the owner can correct a day's figures
--   -- and `anon` is refused EXECUTE outright on both new functions.
-- ============================================================================
