-- ============================================================================
-- 205 — LABOR SPLIT BY HOURS, posted to QuickBooks once a month
-- ============================================================================
--
-- Gusto posts each payroll to QuickBooks with every person's cost on the one
-- shop (Class) they are assigned to, so a shop that borrows staff looks cheap
-- and the shop that lends them looks dear. The timesheets know where the
-- hours were actually worked. Once a month the app posts ONE journal entry
-- that takes the month's labor out of wherever it landed and puts it back in
-- proportion to each shop's hours (Mark, 2026-10-14: "option 1" — the share
-- of TOTAL hours, not a per-person split).
--
-- The entry is built in the browser (`lib/laborAllocation`, pure) and checked
-- and sent by `qbo-sync`'s `post_labor_allocation`, the `post_daily_sales`
-- shape (104). Three pieces live here:
--
--   1. accounting_labor_accounts — WHICH QuickBooks accounts are labor. The
--      pool is every journal-entry line on these accounts in the month, so the
--      choice is the whole definition of "labor": wages, employer taxes and
--      benefits if they are chosen, never a liability or the bank.
--   2. labor_allocations — one row per org-month once it has been posted (or
--      has failed to), holding the QuickBooks id and the hash of what was
--      sent, so posting again updates the same entry or skips an unchanged
--      one. Written ONLY by record_labor_allocation.
--   3. labor_hours_by_month — hours per shop per month, summed on the server.
--      A month is a few hundred shifts today; a year is past PostgREST's
--      silent 1,000-row cap, so the browser never sums rows itself.
--
-- HOURS ARE THE DECIDED HOURS (regular + overtime + double), what Gusto was
-- told to pay, bucketed by `business_date` — the day the punch fell on, which
-- is what files a shift into its pay period (062) and its tip pool. Sick hours
-- and break premiums are not hours worked at a shop and are left out.
--
-- Owner and manager only, every verb: the sums are payroll, and 028 gates
-- timesheets the same way.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. accounting_labor_accounts
-- ----------------------------------------------------------------------------

create table if not exists accounting_labor_accounts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  account_ref   text not null,
  account_name  text,
  created_at    timestamptz not null default now(),
  unique (org_id, account_ref)
);

comment on table accounting_labor_accounts is
  'The QuickBooks accounts that make up labor cost — the pool the monthly labor split moves between shops. account_name is a snapshot for display. See migration 205.';

alter table accounting_labor_accounts enable row level security;

create policy accounting_labor_accounts_select on accounting_labor_accounts for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy accounting_labor_accounts_write on accounting_labor_accounts for all
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));


-- ----------------------------------------------------------------------------
-- 2. labor_allocations
-- ----------------------------------------------------------------------------

create table if not exists labor_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  -- The first of the month the entry covers.
  month         date not null check (extract(day from month) = 1),
  -- What the entry was built from, for reading back: per shop, its hours and
  -- share; and the pool's total in cents.
  shares        jsonb,
  external_ref  jsonb not null default '{}'::jsonb,
  posted_at     timestamptz,
  posted_by     uuid references auth.users(id) on delete set null,
  post_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, month)
);

create trigger trg_labor_allocations_updated before update on labor_allocations
  for each row execute function set_updated_at();

comment on table labor_allocations is
  'One row per month whose labor split has been posted to QuickBooks (or failed to). Written only by record_labor_allocation. See migration 205.';
comment on column labor_allocations.external_ref is
  '{"qbo": {"id", "sync_token", "doc_number", "entity": "JournalEntry", "journal_hash"}} — the daily_sales shape (104).';

-- One month per QuickBooks entry, the guard 104 put on daily_sales.
create unique index if not exists labor_allocations_qbo_id_unique
  on labor_allocations (org_id, (external_ref->'qbo'->>'id'))
  where external_ref->'qbo'->>'id' is not null;

alter table labor_allocations enable row level security;

-- Read only. No write policy: every write is the definer function below.
create policy labor_allocations_select on labor_allocations for select
  using (user_has_role(org_id, array['owner', 'admin']));


-- ----------------------------------------------------------------------------
-- 3. record_labor_allocation — the only writer
-- ----------------------------------------------------------------------------
--
-- `p_error` records a FAILED post: the stored ref is left alone (the entry
-- already in QuickBooks, if any, is still the entry) and the message lands
-- where the screen can show it. Otherwise the ref, shares and stamps are
-- written and the error cleared. NO ROWS on refusal, never a raise — 104's
-- record_sales_posting shape.

create or replace function public.record_labor_allocation(
  p_org    uuid,
  p_month  date,
  p_ref    jsonb,
  p_shares jsonb,
  p_error  text
)
returns setof labor_allocations
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or p_month is null then return; end if;
  if not user_has_role(p_org, array['owner', 'admin']) then return; end if;
  if extract(day from p_month) <> 1 then
    raise exception 'The month must be the first of a month';
  end if;

  if p_error is not null then
    return query
      insert into labor_allocations (org_id, month, post_error)
      values (p_org, p_month, p_error)
      on conflict (org_id, month) do update set post_error = excluded.post_error
      returning *;
    return;
  end if;

  if jsonb_typeof(p_ref) is distinct from 'object'
     or jsonb_typeof(p_ref->'qbo') is distinct from 'object' then
    raise exception 'The accounting reference must be an object carrying a qbo branch';
  end if;

  return query
    insert into labor_allocations (org_id, month, shares, external_ref, posted_at, posted_by, post_error)
    values (p_org, p_month, p_shares, jsonb_build_object('qbo', p_ref->'qbo'), now(), auth.uid(), null)
    on conflict (org_id, month) do update
      set shares       = excluded.shares,
          external_ref = labor_allocations.external_ref || excluded.external_ref,
          posted_at    = excluded.posted_at,
          posted_by    = excluded.posted_by,
          post_error   = null
    returning *;
end $$;

revoke all on function public.record_labor_allocation(uuid, date, jsonb, jsonb, text) from public;
revoke all on function public.record_labor_allocation(uuid, date, jsonb, jsonb, text) from anon;
grant execute on function public.record_labor_allocation(uuid, date, jsonb, jsonb, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. labor_hours_by_month — hours per shop per month, summed here
-- ----------------------------------------------------------------------------
--
-- SECURITY INVOKER, so timesheets' own owner/admin policy (028) decides what
-- it can see. A null location_id is returned as its own row so the screen can
-- say how many hours belong to no shop rather than losing them.

create or replace function public.labor_hours_by_month(
  p_org  uuid,
  p_from date,
  p_to   date
)
returns table (month date, location_id uuid, hours numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('month', t.business_date)::date as month,
         t.location_id,
         sum(coalesce(t.hours_regular, 0) + coalesce(t.hours_overtime, 0) + coalesce(t.hours_double_ot, 0)) as hours
    from timesheets t
   where t.org_id = p_org
     and t.business_date between p_from and p_to
   group by 1, 2
  having sum(coalesce(t.hours_regular, 0) + coalesce(t.hours_overtime, 0) + coalesce(t.hours_double_ot, 0)) <> 0
   order by 1, 2;
$$;

revoke all on function public.labor_hours_by_month(uuid, date, date) from public;
revoke all on function public.labor_hours_by_month(uuid, date, date) from anon;
grant execute on function public.labor_hours_by_month(uuid, date, date) to authenticated;


-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from pg_policy
--    where polrelid in ('public.accounting_labor_accounts'::regclass,
--                       'public.labor_allocations'::regclass);          → 3
--   select count(*) from pg_proc
--    where proname in ('record_labor_allocation', 'labor_hours_by_month'); → 2
--   select * from public.record_labor_allocation(null, null, null, null, null); → 0 rows
-- ============================================================================
