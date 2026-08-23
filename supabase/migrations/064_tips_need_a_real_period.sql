-- ============================================================================
-- restaurantfriend — migration 064 · a tip pool needs a REAL pay period
--
-- Fixes a bug 063 shipped, found on the first deep backfill (2026-08-23):
-- syncing 2015 wrote 107 tip_pools rows, and 2015 has no payroll at all.
--
-- ---------------------------------------------------------------------------
-- WHY `period_editable_on` SAID YES TO 2015
--
-- 029's predicate asks whether the day is covered by a period that is CLOSED:
--
--     select not exists (
--       select 1 from pay_periods
--        where org_id = p_org and p_workday between start_date and end_date
--          and status not in ('open', 'review'));
--
-- For a day NO period covers, that inner select finds nothing, `not exists` is
-- TRUE, and the answer is "editable". Which is right for what 029 uses it for —
-- a supervisor correcting a shift that fell outside the calendar must not be
-- stranded, and 028 makes the same call in as many words ("A shift with no
-- period is editable: it fell outside the calendar, and the fix for that is to
-- edit it").
--
-- It is exactly WRONG here, and CLAUDE.md already warned about this predicate in
-- these words, for 035: "period_editable_on returns TRUE for a day outside the
-- 178-period calendar, so half of Events would be freely editable while 2020
-- was frozen." Same trap, new caller.
--
-- The calendar runs 2019-10-07 → 2026-08-30. Square holds sales back to 2015.
-- So a full backfill walks nine years of days that no period covers, and every
-- one of them passed the gate.
--
-- ---------------------------------------------------------------------------
-- THE DISTINCTION, which is the whole of this migration
--
-- "Is this day NOT frozen?" and "is this day IN AN OPEN PAY PERIOD?" are
-- different questions. 029 wants the first. A sync feeding payroll wants the
-- second, because a tip pool with no pay period is not merely harmless clutter:
-- it is a payroll record for a fortnight that does not exist, it can never be
-- frozen or exported, and it makes `tip_pools` disagree with its own column
-- comment ("holds nothing before 2026-07-20 and never will").
--
-- So the tip feed now requires a period to EXIST and be open or review. It does
-- NOT change `period_editable_on`, which has three other callers that want its
-- current meaning.
--
-- Everything else in `record_daily_sales` is byte-identical to 063's. The
-- `daily_sales` half was never affected — sales are not payroll, and the full
-- history is exactly what that table is for.
--
-- A SEPARATE FILE rather than an edit to 063, per 055's rule: 063 is applied,
-- and a migration that has run is history — a file that no longer describes
-- what was run is how the harness and production stop being the same database.
--
-- Depends on 063. Run in the Supabase SQL editor. RERUNNABLE (create or
-- replace, plus a cleanup that is a no-op once correct).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The predicate this caller actually wants
-- ----------------------------------------------------------------------------
-- Named for what it asks, not for what it is not. `period_editable_on` is left
-- alone: 029's tip_pools policies, its break_premiums policies and its own
-- callers all want "not frozen", and widening or narrowing it under them would
-- be the second bug in this pair.
create or replace function public.day_in_open_pay_period(p_org uuid, p_day date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from pay_periods
     where org_id = p_org
       and p_day between start_date and end_date
       and status in ('open', 'review')
  );
$$;

comment on function public.day_in_open_pay_period(uuid, date) is
  'Is this day inside a pay period that is OPEN or IN REVIEW? Note this is NOT '
  'the negation of period_editable_on: that one answers "is this day not '
  'frozen", which is TRUE for a day no period covers at all. Use this one when '
  'a WRITE only makes sense against real payroll — a tip pool for a fortnight '
  'that does not exist can never be frozen or exported.';

revoke all on function public.day_in_open_pay_period(uuid, date) from public;
revoke all on function public.day_in_open_pay_period(uuid, date) from anon;
grant execute on function public.day_in_open_pay_period(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. record_daily_sales — the tip feed, and ONLY the tip feed, changes
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
        source          = excluded.source,
        synced_at       = excluded.synced_at;
  get diagnostics v_sales = row_count;

  -- THE ONE CHANGE: `day_in_open_pay_period`, not `period_editable_on`. See the
  -- header — the old predicate says yes to a day no pay period covers, which is
  -- every day before 2019-10-07 and is nine years of Square history.
  select count(*) into v_neg
    from jsonb_array_elements(p_rows) r
   where (r->>'tips_cents')::integer < 0
     and public.day_in_open_pay_period(v_org, (r->>'business_date')::date);

  with fed as (
    insert into tip_pools (org_id, location_id, business_date,
                           reported_cents, reported_by, reported_at)
    select v_org,
           (r->>'location_id')::uuid,
           (r->>'business_date')::date,
           (r->>'tips_cents')::integer,
           null,
           now()
      from jsonb_array_elements(p_rows) r
     where (r->>'tips_cents')::integer >= 0
       and public.day_in_open_pay_period(v_org, (r->>'business_date')::date)
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

-- ----------------------------------------------------------------------------
-- 3. Clean up what 063's version wrote
-- ----------------------------------------------------------------------------
-- Every row in `tip_pools` was written by the Square sync — the table had ZERO
-- rows before 2026-08-23, so there is no human entry to protect and no
-- correction to lose. This removes the rows that should never have been
-- created: a tip pool for a day no OPEN pay period covers.
--
-- `corrected_cents is null` is belt and braces rather than necessity: if a
-- human has since corrected one, that is a decision, and a cleanup migration
-- must not eat it.
--
-- NB `tip_pools` has no delete POLICY, deliberately — but this runs as the
-- migration's own role in the SQL editor, which is not subject to RLS.
delete from tip_pools t
 where not public.day_in_open_pay_period(t.org_id, t.business_date)
   and t.corrected_cents is null
   and t.frozen_at is null;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   -- The two predicates DISAGREE outside the calendar, which is the bug:
--   select public.period_editable_on(
--            (select id from orgs limit 1), date '2015-01-05')      as old_says,
--          public.day_in_open_pay_period(
--            (select id from orgs limit 1), date '2015-01-05')      as new_says;
--     -- true | false
--
--   -- and AGREE inside an open period:
--   select public.period_editable_on(
--            (select id from orgs limit 1), date '2026-08-20')      as old_says,
--          public.day_in_open_pay_period(
--            (select id from orgs limit 1), date '2026-08-20')      as new_says;
--     -- true | true
--
--   -- Nothing left in tip_pools that payroll can never reach:
--   select count(*) from tip_pools t
--    where not public.day_in_open_pay_period(t.org_id, t.business_date);
--     -- 0
--
--   -- And what remains is inside the open/review periods, and only those:
--   select min(business_date), max(business_date), count(*) from tip_pools;
--     -- 2026-07-20 | (today) | one row per shop-day since the open period began
--
--   -- daily_sales is UNAFFECTED and keeps the whole history:
--   select min(business_date), max(business_date), count(*) from daily_sales;
--     -- 2015-.. | 2026-.. | the full backfill
-- ============================================================================
