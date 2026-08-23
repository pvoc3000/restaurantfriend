-- ============================================================================
-- restaurantfriend — migration 063 · daily net sales and tips, from Square
--
-- Why (Mark, 2026-08-23): "I need a new screen where I can view/track/add daily
-- net sales and tip info by location. It should probably live in the Operations
-- section of the app. the tip data will be used for tip pooling. In the fmp
-- solution, this data was manually entered by the closing supervisors as part
-- of their closing shift report, but I'm wondering if it's data we can pull
-- directly from square."
--
-- It is. Square's Reporting API answers `Sales.net_sales` and
-- `Orders.tips_amount` per location per day, over a `local_reporting_timestamp`
-- dimension that is the seller's own REPORTING DAY — which is what makes these
-- figures equal the ones Mark reads on his dashboard rather than approximate
-- them. So supervisors stop entering tips altogether (Mark, same day: "If we're
-- connected directly to square, I do not see a need for the supervisors to
-- enter anything anymore, and I would prefer it if they didn't").
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A NEW TABLE AND NOT MORE COLUMNS ON tip_pools
--
-- The two are the same GRAIN and not the same FACT. `tip_pools` (029) is a
-- payroll record: it carries the frozen tip rate, the residual, and the
-- correction somebody made, and its write policies gate on
-- `period_editable_on` precisely so that money already paid cannot move.
--
-- That gate is what forces the split. 177 of 180 pay periods are closed, so a
-- full-history backfill into `tip_pools` is refused row by row — and should be.
-- Those fortnights are paid. But the SALES history is exactly what Mark wants
-- for reporting, and it goes back years.
--
-- So: `daily_sales` takes everything Square holds and is answerable to nobody's
-- paycheck, while `tip_pools` keeps being the payroll record and is fed only
-- for days still in an open or review period. Every downstream reader —
-- `buildPools`, `allocateTips`, `freeze_pay_period`, the Gusto export — is
-- untouched by this migration, which is the point.
--
-- ---------------------------------------------------------------------------
-- WHY tip_pools NEEDS NO SCHEMA CHANGE
--
-- 029 stores `reported_cents` and `corrected_cents` separately because "the
-- supervisors' numbers have to be double checked and changed before I calculate
-- tips". Mark's ruling (2026-08-23) keeps both names honest without touching
-- either: "reported_cents can mean Square said, just reported by Square instead
-- of the supervisors interpreting square data. I can still override if needed."
--
-- So `reported_cents` is now what came in, `corrected_cents` is still the one
-- act of human judgement, and `corrected_cents ?? reported_cents` — which
-- `lib/payrollWorksheet.ts` and `TimesheetsList` already compute — needs no
-- edit at all.
--
-- `tip_pools` has ZERO ROWS today, so nothing is being reinterpreted after the
-- fact: no supervisor has ever entered a figure through the app.
--
-- Depends on 001 (locations, orgs), 029 (tip_pools, period_editable_on). Run in
-- the Supabase SQL editor BEFORE deploying — the new screen selects these
-- columns. NOT rerunnable (create table and add column each fail a second time,
-- which is how you know it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. locations.square_location_id — the join key
-- ----------------------------------------------------------------------------
-- A TYPED COLUMN, not `external_ref jsonb`, and 026 is the precedent that
-- argues against itself here. That column's own comment says "Recorded, not
-- read… Written by a future sync; unread in v1" — jsonb was right exactly
-- because nothing consumed it and its shape was unknown. This value is read on
-- every sync run as a join key, and 017 drew the line in this place: typed
-- columns for structured per-location facts, `settings` jsonb for open-ended
-- config.
--
-- Three things the typed column buys that jsonb does not:
--
--   1. THE UNIQUE INDEX BELOW. Two shops mapped to one Square id would silently
--      double-count net sales forever, and the dashboard's own Total row would
--      still reconcile, so nothing would ever surface it.
--   2. `InlineValue` already writes a text column, so the mapping is an
--      ordinary editable field on the location record. In jsonb it would need a
--      bespoke editor for a single string.
--   3. `.eq("square_location_id", id)` and `.not(…, "is", null)` in PostgREST,
--      against `->>` chains.
alter table locations add column square_location_id text;

-- PARTIAL, per 034's reasoning: four of six locations will never carry one, and
-- this index exists to REFUSE A DUPLICATE rather than to speed a lookup over
-- six rows.
create unique index locations_square_location_id_unique
  on locations (org_id, square_location_id)
  where square_location_id is not null;

comment on column locations.square_location_id is
  'Square''s own id for this shop ("L4X…"), from GET /v2/locations. NULL means '
  'this location is not on Square and the sync skips it — DF03, DF04, DF05 and '
  'EVENT today. Matched by ID and never by name: "DF01 HP" is a dashboard '
  'label that anyone with a Square login can rename.';

-- ----------------------------------------------------------------------------
-- 2. daily_sales
-- ----------------------------------------------------------------------------
create table daily_sales (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,

  -- RESTRICT, matching tip_pools and timesheets rather than `set null`. 028
  -- made its location nullable because 55 FileMaker rows genuinely had no shop;
  -- every row here arrives from Square carrying a location id, so there is no
  -- honest null — and a record of money taken must not lose the shop that took
  -- it.
  location_id   uuid not null references locations(id) on delete restrict,

  -- SQUARE'S REPORTING DAY. Not a calendar date, and NOT the same boundary as
  -- `timesheets.business_date`.
  --
  -- Mark's dashboard is set to 1:00 AM – 12:59 AM PT, which is printed on every
  -- export it produces and is what makes these figures equal the ones he reads
  -- there. `timesheets.business_date` is the punch's own calendar date, so a
  -- sale at 00:30 is on the previous day HERE and on the current day THERE.
  --
  -- Known and accepted (Mark, 2026-08-23), not a bug to be tidied later: the
  -- exposure is one hour a night and the effect on any day's tip rate is small.
  -- If Square's reporting-day setting is ever changed, every stored date here
  -- silently re-buckets and the history stops meaning what it meant — so the
  -- observed window is recorded in orgs.settings.square.reporting_day and
  -- docs/square-setup.md says to re-backfill.
  business_date date not null,

  -- CENTS, as integers, for 029's reason: the allocations must sum exactly, and
  -- a year of days must sum to the figure on the dashboard. Floating point
  -- cannot promise that; integers can.
  --
  -- DELIBERATELY NO `>= 0` CHECK, and this is the one place this table differs
  -- from tip_pools on purpose. That table checks its figure because a human
  -- typed it and a negative is a typo. This records what Square says, and a day
  -- of nothing but refunds is legitimately negative. A check here would drop
  -- the DAY rather than the mistake — and 024's lesson is that a statement true
  -- about finished data is still wrong as a constraint.
  net_sales_cents integer not null,
  tips_cents      integer not null,

  -- 'square' today. A column rather than a constant because the row should be
  -- attributable, and because `manual` is the seam for a day Square cannot
  -- answer for (an outage, a cash-only event). Nothing writes 'manual' yet and
  -- no policy allows it — see section 3.
  source        text not null default 'square'
                check (source in ('square', 'manual')),

  -- WHEN WE LAST PULLED IT, which is the only question anybody actually asks of
  -- a synced row. This is what the screen's "N of the last 14 shop-days have
  -- not been pulled" indicator counts over, and it is why there is no
  -- square_syncs run-record table in this migration — see section 5.
  synced_at     timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- EXACTLY tip_pools' key, and that is the point rather than a coincidence:
  -- the two tables join on (location_id, business_date) with no translation, so
  -- the sync, the payroll worksheet and the new screen are all talking about
  -- one grain.
  unique (org_id, location_id, business_date)
);

create index daily_sales_org_idx  on daily_sales (org_id, business_date);
create index daily_sales_date_idx on daily_sales (location_id, business_date);

create trigger trg_daily_sales_updated before update on daily_sales
  for each row execute function set_updated_at();

comment on column daily_sales.net_sales_cents is
  'Square''s Sales.net_sales for this reporting day, in cents — sales after '
  'discounts and returns, excluding tax and excluding tips. MAY BE NEGATIVE on '
  'a day of net refunds; there is no check, deliberately.';

comment on column daily_sales.tips_cents is
  'What Square collected in tips on this reporting day. THE FULL TIP HISTORY '
  'LIVES HERE. tip_pools only ever receives days inside an open or review pay '
  'period (029''s period_editable_on), so it holds nothing before 2026-07-20 '
  'and never will — 177 of 180 periods were already closed when this shipped. '
  'A screen wanting historical tips reads this table, not tip_pools.';

comment on column daily_sales.business_date is
  'Square''s REPORTING day, not a calendar date. Mark''s dashboard runs it '
  '1:00 AM – 12:59 AM PT. Deliberately NOT the same boundary as '
  'timesheets.business_date, which is the punch''s calendar date.';

-- ----------------------------------------------------------------------------
-- 3. RLS — read wide, write only through the function
-- ----------------------------------------------------------------------------
alter table daily_sales enable row level security;

-- Membership-wide, exactly tip_pools_select and for the same reason: what the
-- shop took is a shop-floor fact, and everyone rostered may see it. Mark chose
-- this explicitly over a role gate.
create policy daily_sales_select on daily_sales for select
  using (org_id in (select user_org_ids()));

-- NO insert, update or delete policy. 020's enforcement-by-absence, which
-- tip_pools already uses for delete.
--
-- The only writer is `record_daily_sales` below, which is security definer and
-- re-checks by hand everything a policy would have asked. An owner/admin insert
-- policy would exist only so that somebody could type a sales figure by hand,
-- and Square is the authority — that is the whole premise of the feature.
--
-- Note `service_role` still bypasses RLS, so the SQL editor and the local
-- migration scripts are unaffected.

-- ----------------------------------------------------------------------------
-- 4. record_daily_sales — the one writer
-- ----------------------------------------------------------------------------
-- A WHOLE CHUNK AS jsonb, which is `freeze_pay_period`'s payload idiom rather
-- than `report_pooled_tips`' one-row-per-call shape. A month is 62 rows and a
-- seven-year backfill is thousands; a per-day RPC would be one round trip each,
-- and — for the tips half — one PL/pgSQL exception block each, every one of
-- which is a SUBTRANSACTION. That is the wrong shape at backfill scale.
--
-- WHY IT CHECKS `period_editable_on` ITSELF RATHER THAN CALLING
-- report_pooled_tips AND CATCHING. Four reasons, and the last is the one that
-- matters most:
--
--   * one round trip instead of one per day;
--   * no subtransaction churn;
--   * the skipped days become DATA IN THE RETURN VALUE, which the screen can
--     show, rather than exceptions somebody has to swallow;
--   * `report_pooled_tips` stamps `reported_by = auth.uid()`, and after this
--     change that is a FALSE CLAIM. The reporter is Square, not whoever pressed
--     the button. Null now means Square.
--
-- Definer bypasses RLS, so the body asks by hand everything the policies would
-- have — `report_pooled_tips`' own posture, widened to a set.
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

  -- An empty window is a real answer, not a fault: a shop closed for a week
  -- returns nothing and the sync must report that rather than raise.
  if v_count = 0 then
    return jsonb_build_object('sales_upserted', 0, 'tips_written', 0,
                              'tips_skipped_closed', 0, 'tips_refused_negative', 0,
                              'tip_dates', '[]'::jsonb);
  end if;

  -- A MISSING location_id IS CHECKED SEPARATELY, and it has to be: the
  -- unknown-location probe below reports the offending id THROUGH v_bad, so a
  -- null one detects as "nothing was wrong" and slips through to fail on the
  -- NOT NULL constraint instead — a raw Postgres error where a sentence
  -- belongs. Found by running it, not by reading it.
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

  -- Two statements rather than one, because there is no `min(uuid)` aggregate
  -- in Postgres — the obvious one-liner fails at runtime, not at create time.
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

  -- A sync run is an IMPORT, and 030 gates imports at owner/admin. READING the
  -- screen is open to every member — that is the select policy above — but
  -- rewriting the org's whole sales history is not.
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

  -- THE TIPS HALF, for editable days only.
  --
  -- `corrected_cents` IS NEVER IN THIS STATEMENT, and that is the whole reason
  -- 029 stored two figures: the correction is a separate, accountable act, and
  -- a re-sync must not quietly undo one.
  --
  -- The `>= 0` filter is not defensiveness. `tip_pools` carries
  -- `check (reported_cents >= 0)`, so a negative Square figure would abort the
  -- entire chunk on a constraint violation and lose the sales half with it.
  -- `daily_sales` still records the negative; the pool skips it and the return
  -- value names how many.
  select count(*) into v_neg
    from jsonb_array_elements(p_rows) r
   where (r->>'tips_cents')::integer < 0
     and public.period_editable_on(v_org, (r->>'business_date')::date);

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
       and public.period_editable_on(v_org, (r->>'business_date')::date)
    on conflict (org_id, location_id, business_date) do update
      set reported_cents = excluded.reported_cents,
          reported_by    = excluded.reported_by,
          reported_at    = excluded.reported_at
    returning business_date
  )
  select count(*), coalesce(jsonb_agg(distinct business_date), '[]'::jsonb)
    into v_tips, v_dates
    from fed;

  -- COUNTS FOR WHAT DID NOT HAPPEN, DATES FOR WHAT DID. A seven-year backfill
  -- skips thousands of days and writes at most ninety, so naming the deeds and
  -- counting the non-deeds is the only shape that stays readable on screen.
  return jsonb_build_object(
    'sales_upserted',        v_sales,
    'tips_written',          v_tips,
    'tips_skipped_closed',   v_count - v_tips - v_neg,
    'tips_refused_negative', v_neg,
    'tip_dates',             v_dates
  );
end;
$$;

-- 002's lesson: every new public-schema function is executable by `anon`
-- through Supabase's default privileges, and revoking from PUBLIC does NOT undo
-- that. Revoke from anon by name.
revoke all on function public.record_daily_sales(jsonb) from public;
revoke all on function public.record_daily_sales(jsonb) from anon;
grant execute on function public.record_daily_sales(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. What this migration deliberately does NOT do
-- ----------------------------------------------------------------------------
-- NO square_syncs run-record table. 030's `timesheet_imports` exists for four
-- reasons and Square satisfies none of them: a FILE arrives and must be kept so
-- a disagreement can be settled against the original (here the source is
-- re-queryable at any time); rows are refused for per-row reasons worth naming
-- (here the only refusals are structural and identical every run); the run
-- CLAIMS a period (here we choose the window); and counters answer "what did
-- that import do" (here `synced_at` answers the question actually asked, which
-- is whether a day is fresh).
--
-- The trigger that would change this answer is stated rather than left to
-- taste: a NIGHTLY CRON. An unattended run has nobody reading its response, and
-- that is when a run record earns its keep — along with a way to notice a token
-- revoked in March before June.
--
-- NO source_payload jsonb (028's idiom). The payload for a two-measure row is
-- two numbers; storing it doubles the table for no evidence a re-query cannot
-- produce.
--
-- NO is_final flag. The sync re-upserts a rolling window and `synced_at` says
-- how fresh a day is; "final" would be a claim Square never makes.
--
-- NO order_count or average-ticket measure. Scope is settled at sales and tips,
-- and an invented Square measure name fails the WHOLE query at request time, so
-- a speculative measure is not free.

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from daily_sales;
--     -- 0
--
--   select code, square_location_id from locations order by code;
--     -- six rows, every square_location_id null until setup maps them
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.daily_sales'::regclass;
--     -- EXACTLY ONE row: daily_sales_select / r. Enforcement by absence — if
--     -- you see an insert or update policy here, someone has undone section 3.
--
--   select count(*) from pg_proc where proname = 'record_daily_sales';
--     -- 1. Two would mean a changed argument list left an OVERLOAD live
--     --    beside this one (033's freeze_pay_period trap).
--
-- The rules, each checked by BREAKING it. All three roll back.
--
--   -- (a) A NEGATIVE day is ACCEPTED. This is the check that is deliberately
--   --     absent, so prove it rather than trusting the comment.
--   begin;
--     insert into daily_sales (org_id, location_id, business_date,
--                              net_sales_cents, tips_cents)
--       select l.org_id, l.id, date '1999-01-01', -12345, 0
--         from locations l where l.code = 'DF01';
--       -- must SUCCEED
--   rollback;
--
--   -- (b) One row per shop per reporting day.
--   begin;
--     insert into daily_sales (org_id, location_id, business_date,
--                              net_sales_cents, tips_cents)
--       select l.org_id, l.id, date '1999-01-01', 1, 0
--         from locations l where l.code = 'DF01';
--     insert into daily_sales (org_id, location_id, business_date,
--                              net_sales_cents, tips_cents)
--       select l.org_id, l.id, date '1999-01-01', 2, 0
--         from locations l where l.code = 'DF01';
--       -- must ERROR on daily_sales_org_id_location_id_business_date_key
--   rollback;
--
--   -- (c) Two shops cannot claim one Square id.
--   begin;
--     update locations set square_location_id = 'LTEST'
--      where code in ('DF01', 'DF02');
--       -- must ERROR on locations_square_location_id_unique
--   rollback;
--
-- As a SIGNED-IN user (not service_role — these are RLS paths):
--
--   select public.record_daily_sales('[]'::jsonb);
--     -- {"sales_upserted": 0, ...} — an empty window answers, never raises
--
--   select public.record_daily_sales(
--     jsonb_build_array(jsonb_build_object(
--       'location_id', '00000000-0000-0000-0000-000000000000',
--       'business_date', '2026-01-01', 'net_sales_cents', 1, 'tips_cents', 0)));
--     -- ERROR: No such location — it refuses from its first check, doing no work
--
--   insert into daily_sales (org_id, location_id, business_date,
--                            net_sales_cents, tips_cents)
--     select l.org_id, l.id, date '1999-01-02', 1, 0
--       from locations l where l.code = 'DF01';
--     -- ERROR: new row violates row-level security policy. There is no insert
--     --        policy, so the function is the only door. NB this is an ERROR
--     --        rather than a silent zero rows, because it is an INSERT.
--
-- AFTER THE BACKFILL, the acceptance query (see docs/square-setup.md):
--
--   select l.code, count(*) as days, min(business_date), max(business_date),
--          sum(net_sales_cents)/100.0 as net, sum(tips_cents)/100.0 as tips
--     from daily_sales d join locations l on l.id = d.location_id
--    where business_date between '2026-01-01' and '2026-08-22'
--    group by 1 order by 1;
--     -- 234 days each; the two `net` figures must equal the CSV's own row sums
--
--   -- Nothing editable was left without a pool:
--   select count(*) from daily_sales d
--    where public.period_editable_on(d.org_id, d.business_date)
--      and d.tips_cents >= 0
--      and not exists (select 1 from tip_pools t
--                       where t.location_id = d.location_id
--                         and t.business_date = d.business_date);
--     -- 0
--
--   -- And nothing landed in a CLOSED period, which is the split this whole
--   -- migration exists to enforce:
--   select count(*) from tip_pools t
--    where not public.period_editable_on(t.org_id, t.business_date);
--     -- 0
-- ============================================================================
