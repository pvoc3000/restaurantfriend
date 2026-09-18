-- ============================================================================
-- restaurantfriend — migration 105 · Square payouts, and the bank deposit
-- each one becomes in QuickBooks
--
-- Why (Mark, 2026-09-17): the daily journal entry (104) parks the card
-- takings in Undeposited Square Funds; something has to move them to the
-- bank when Square pays them out, or that account grows forever. On the
-- books today that is a Bank Deposit per payout into Chase ACH, one line to
-- Undeposited Square Funds — created from the bank feed (every one carries
-- the bank's own ACH memo and the same fixed location), and Mark's own
-- account of the routine is that a deposit exists BEFORE the bank line lands
-- and the feed MATCHES it. This makes that true: the sync pulls every payout
-- Square reports, the app posts a Deposit for each, and the bank feed then
-- offers a match instead of adding a second one.
--
-- MEASURED BEFORE BUILDING (2026-09-17, both shops, 09-07 → 09-15): a
-- payout's entries sum to its amount on all 26 payouts, and the day's card
-- takings net of EVERY Square fee agree with the payout for that day's
-- charges to within 0–123 cents (Square's own fee rounding, the two reports
-- disagreeing with each other). So the deposit is ONE line for the payout's
-- exact amount, and 104's entry nets all fees against the card line — the
-- gift-card load fee had been keyed to the tender that bought the card, which
-- left the payout short of the entry by that fee every time.
--
-- WHAT THIS ADDS:
--   1. `square_payouts` — one row per payout Square reports, keyed by Square's
--      own id, with the same posting columns `daily_sales` carries (104's
--      `external_ref` / `posted_at` / `post_error` shape).
--   2. `record_square_payouts` — the sync's writer, purchaser+, an upsert that
--      never touches the posting columns.
--   3. `record_payout_posting` — the one writer of a payout's QuickBooks ref,
--      081's shape: zero rows on refusal.
--
-- NO POLICY BEYOND SELECT: every write goes through a definer, like
-- `daily_sales` since 063. The bank account the deposit lands in is a ROLE
-- in `accounting_sales_mappings` (`bank`), so no column is added there.
--
-- Probes at the bottom. Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

create table if not exists square_payouts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  location_id       uuid not null references locations(id) on delete cascade,
  square_payout_id  text not null,
  -- Square's end-to-end id (`T316V42B337KEBX`): the bank's ACH memo carries
  -- it as IND ID, so it is the deposit's DocNumber and how a bank line is
  -- traced back to a payout.
  end_to_end_id     text,
  status            text not null,          -- SENT · PAID · FAILED, Square's words
  payout_type       text,                   -- BATCH · SIMPLE
  sent_at           timestamptz not null,   -- Square's created_at
  arrival_date      date not null,          -- the bank date the deposit is dated
  amount_cents      integer not null,
  currency          text not null default 'USD',
  destination_id    text,
  square_version    integer,
  pulled_at         timestamptz not null default now(),
  external_ref      jsonb not null default '{}'::jsonb,
  posted_at         timestamptz,
  post_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, square_payout_id)
);

drop trigger if exists trg_square_payouts_updated on square_payouts;
create trigger trg_square_payouts_updated before update on square_payouts
  for each row execute function set_updated_at();

create index if not exists square_payouts_arrival_idx on square_payouts (org_id, arrival_date);

-- One QuickBooks deposit per payout, and one payout per deposit (104's index).
create unique index if not exists square_payouts_qbo_id_unique
  on square_payouts (org_id, (external_ref->'qbo'->>'id'))
  where external_ref->'qbo'->>'id' is not null;

comment on table square_payouts is
  'Every payout Square reports for a mapped location, pulled by sync-square-sales (Payouts API), and the QuickBooks Bank Deposit each one became. Migration 105.';
comment on column square_payouts.external_ref is
  '{"qbo": {"id", "sync_token", "doc_number", "entity": "Deposit", "deposit_hash", "amount_cents", "arrival_date"}} once posted — the last two stamped here from the row, so "changed since posted" is a comparison. Written only by record_payout_posting.';
comment on column square_payouts.post_error is
  'What QuickBooks said the last time a post FAILED. Cleared by the next successful post.';

alter table square_payouts enable row level security;

drop policy if exists square_payouts_select on square_payouts;
create policy square_payouts_select on square_payouts for select
  using (org_id in (select user_org_ids()));


-- ----------------------------------------------------------------------------
-- record_square_payouts — the sync's writer
-- ----------------------------------------------------------------------------
--
-- An UPSERT on Square's own id. Status moves SENT → PAID and `pulled_at`
-- moves every time; the posting columns are never touched here, so a
-- re-pull can never forget which deposit a payout became.

create or replace function public.record_square_payouts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_orgs  integer;
  v_bad   text;
  v_count integer;
  v_n     integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'record_square_payouts expects an array of rows';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    return jsonb_build_object('payouts_upserted', 0);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where nullif(r->>'location_id', '') is null
        or nullif(r->>'square_payout_id', '') is null
        or nullif(r->>'arrival_date', '') is null
        or nullif(r->>'amount_cents', '') is null
  ) then
    raise exception 'Every row must name a location_id, square_payout_id, arrival_date and amount_cents';
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

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then
    raise exception 'Only a purchaser or above can sync payouts from Square';
  end if;

  insert into square_payouts (org_id, location_id, square_payout_id, end_to_end_id, status,
                              payout_type, sent_at, arrival_date, amount_cents, currency,
                              destination_id, square_version, pulled_at)
  select v_org,
         (r->>'location_id')::uuid,
         r->>'square_payout_id',
         nullif(r->>'end_to_end_id', ''),
         coalesce(nullif(r->>'status', ''), 'UNKNOWN'),
         nullif(r->>'payout_type', ''),
         (r->>'sent_at')::timestamptz,
         (r->>'arrival_date')::date,
         (r->>'amount_cents')::integer,
         coalesce(nullif(r->>'currency', ''), 'USD'),
         nullif(r->>'destination_id', ''),
         nullif(r->>'square_version', '')::integer,
         now()
    from jsonb_array_elements(p_rows) r
  on conflict (org_id, square_payout_id) do update
    set location_id    = excluded.location_id,
        end_to_end_id  = coalesce(excluded.end_to_end_id, square_payouts.end_to_end_id),
        status         = excluded.status,
        payout_type    = excluded.payout_type,
        sent_at        = excluded.sent_at,
        arrival_date   = excluded.arrival_date,
        amount_cents   = excluded.amount_cents,
        currency       = excluded.currency,
        destination_id = excluded.destination_id,
        square_version = excluded.square_version,
        pulled_at      = excluded.pulled_at;
  get diagnostics v_n = row_count;

  return jsonb_build_object('payouts_upserted', v_n);
end;
$$;

revoke all on function public.record_square_payouts(jsonb) from public;
revoke all on function public.record_square_payouts(jsonb) from anon;
grant execute on function public.record_square_payouts(jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- record_payout_posting — the one writer of a payout's QuickBooks ref
-- ----------------------------------------------------------------------------
--
-- 104's `record_sales_posting`, for a payout. The row's OWN amount and
-- arrival date are stamped into the ref here, in SQL, so "this payout has
-- changed since it was posted" is a comparison the Sales screen can make
-- with no rebuild. Purchaser+, NO ROWS on refusal.

create or replace function public.record_payout_posting(
  p_payout uuid,
  p_ref    jsonb,
  p_error  text
)
returns setof square_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_amount integer;
  v_date   date;
begin
  select org_id, amount_cents, arrival_date into v_org, v_amount, v_date
    from square_payouts where id = p_payout;

  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then return; end if;

  if p_error is not null then
    return query
      update square_payouts
         set post_error = p_error
       where id = p_payout
       returning *;
    return;
  end if;

  if jsonb_typeof(p_ref) is distinct from 'object'
     or jsonb_typeof(p_ref->'qbo') is distinct from 'object' then
    raise exception 'The accounting reference must be an object carrying a qbo branch';
  end if;

  return query
    update square_payouts
       set external_ref = external_ref
                          || jsonb_build_object(
                               'qbo',
                               (p_ref->'qbo') || jsonb_build_object('amount_cents', v_amount,
                                                                    'arrival_date', v_date)
                             ),
           posted_at    = now(),
           post_error   = null
     where id = p_payout
     returning *;
end $$;

revoke all on function public.record_payout_posting(uuid, jsonb, text) from public;
revoke all on function public.record_payout_posting(uuid, jsonb, text) from anon;
grant execute on function public.record_payout_posting(uuid, jsonb, text) to authenticated;


-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from square_payouts;                                  → 0
--   select count(*) from pg_policy
--    where polrelid = 'public.square_payouts'::regclass;                  → 1 (select only)
--   select count(*) from pg_proc where proname = 'record_square_payouts';  → 1
--   select count(*) from pg_proc where proname = 'record_payout_posting';  → 1
--   select public.record_payout_posting(null, null, null);               → 0 rows
--   select public.record_square_payouts('[]'::jsonb);   → {"payouts_upserted": 0}
--     (an ANSWER; a non-empty array from the SQL editor raises "Not your
--      organisation", which is migration 014's footgun and proves the guard.)
-- ============================================================================
