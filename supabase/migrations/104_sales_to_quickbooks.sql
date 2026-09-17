-- ============================================================================
-- restaurantfriend — migration 104 · a shop-day's Square sales, posted to
-- QuickBooks as one journal entry
--
-- Why (Mark, 2026-09-16): Shogo, the third-party app that has been posting a
-- journal entry per location into QuickBooks every night, keeps a mapping
-- grid PER LOCATION over ~15 categories, ~80 discount names, ~80 marketplace
-- tax lines, ~30 tender names and ~20 service charges — and the two grids
-- have drifted. It also stops silently the first time it meets a Square item
-- it has not seen. The app already reads Square (063, `sync-square-sales`)
-- and already writes QuickBooks (081–088, `qbo-sync`); this is the posting in
-- between, and the much smaller mapping it reads.
--
-- WHAT THIS ADDS, in one file because Mark applies these by hand:
--
--   1. `daily_sales.breakdown` — the day's lines as Square reported them
--      (categories, discounts, tax, tips, gift cards, service charges, each
--      tender, each fee), pulled beside the two payroll figures that were
--      already here. Plus `external_ref`/`posted_at`/`post_error`, the
--      `vendor_invoices` shape, so a day knows which QuickBooks entry it is.
--
--   2. `locations.qbo_class_ref` / `qbo_location_ref` — the shop's Class and
--      Location in QuickBooks. 083 put the same pair on the vendor's per-shop
--      row; here it is the SHOP's own fact, stamped on every line of its entry.
--
--   3. `accounting_sales_mappings` — ONE grid for the whole org, not one per
--      shop: about ten fixed ROLES (where tax goes, where cash goes, …) plus a
--      row per Square category and per tender THE SYNC HAS SEEN. A row with no
--      account is "seen but unmapped", and that is the whole answer to Shogo's
--      silence: an unknown category posts to Uncategorized Income and is
--      NAMED on the receipt and on the grid, never dropped and never blocking.
--
--   4. `record_daily_sales` widened to write the breakdown and to record every
--      category and tender key it sees. SAME ARGUMENT LIST, so `create or
--      replace` is safe — a changed list would create an overload and leave
--      092's body live beside it (033's `freeze_pay_period` trap). The body is
--      092's, the last migration that touched it, NOT 065's.
--
--   5. `record_sales_posting` — the one writer of a day's QuickBooks ref, a
--      definer in 081's shape: zero rows on refusal, so the caller's row-count
--      check is the one place refusal is read.
--
-- ---------------------------------------------------------------------------
-- THE BREAKDOWN'S SHAPE (jsonb, `v: 1`), written by the edge function:
--
--   { "v": 1, "pulled_at": "...", "incomplete": true?,
--     "lines": [ { "kind": "category" | "service_charge" | "discount" | "tax"
--                        | "tip" | "gift_card_sale" | "tender" | "fee",
--                  "key": "Signatures" | "CARD" | "OTHER:UBEREATS" | ...,
--                  "name": "...", "cents": 123456 } ],
--     "totals": { "net_sales_cents": ..., "top_line_cents": ...,
--                 "itemized_returns_cents": ..., "refunds_by_amount_cents": ...,
--                 "total_collected_cents": ... } }
--
-- Every `cents` is SIGNED THE WAY THE MONEY MOVES for that kind: a category is
-- gross sales net of returns (negative on a day of net returns), a tender is
-- payments minus refunds, discounts and fees are positive magnitudes. The
-- identity the whole design rests on was MEASURED over sixty days of both
-- shops and every tender type, to the cent (2026-09-17):
--
--   Σ categories + Σ service charges + tax + tips + gift card sales
--     = Σ tenders + discounts
--
-- and fees sit inside the card tender (card net of fee + fee = card gross).
-- The builder in `web/src/lib/salesPosting.ts` refuses a day that does not
-- balance rather than inventing a line to make it.
--
-- `breakdown_hash` is GENERATED from the document, so "has this day changed
-- since it was posted" is a comparison of two strings and never a judgement
-- call. The posting stamps the hash it posted into `external_ref.qbo`.
--
-- ---------------------------------------------------------------------------
-- NO POLICY CHANGE ON `daily_sales`. 063 made it select-only for members and
-- every write goes through a definer; the two new writers below are definers
-- too. `locations` already has purchaser+ update (001), so the two new
-- columns are `InlineValue`-writable on the record with no new policy — and
-- the Page Permissions sheet keeps that screen owner-only at the gate.
--
-- Probes at the bottom. Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. daily_sales — the breakdown and the posting
-- ----------------------------------------------------------------------------

alter table daily_sales
  add column if not exists breakdown           jsonb,
  add column if not exists breakdown_pulled_at timestamptz,
  add column if not exists external_ref        jsonb not null default '{}'::jsonb,
  add column if not exists posted_at           timestamptz,
  add column if not exists post_error          text;

-- A generated column, never written: the hash of what Square said. `::text`
-- of a jsonb is canonical (keys sorted, whitespace normalised), so the same
-- document always hashes the same.
alter table daily_sales
  add column if not exists breakdown_hash text
    generated always as (md5(breakdown::text)) stored;

comment on column daily_sales.breakdown is
  'The day''s lines as Square reported them — categories, discounts, tax, tips, gift cards, service charges, tenders and fees — in signed integer cents. Written by sync-square-sales beside net_sales_cents; read by the QuickBooks posting. Null on a day pulled before migration 104, or when a breakdown cube failed (the sync says so). See the migration header for the shape.';
comment on column daily_sales.breakdown_hash is
  'md5 of the breakdown, generated. The posting stamps the hash it posted into external_ref.qbo.breakdown_hash, so "changed since posted" is a string comparison.';
comment on column daily_sales.external_ref is
  '{"qbo": {"id", "sync_token", "doc_number", "entity": "JournalEntry", "journal_hash", "breakdown_hash"}} once the day is in QuickBooks — the vendor_invoices shape. Written only by record_sales_posting.';
comment on column daily_sales.posted_at is
  'When the day''s journal entry last reached QuickBooks. Null means never.';
comment on column daily_sales.post_error is
  'What QuickBooks said the last time a post FAILED, so the Sales screen can say "failed" with a reason. Cleared by the next successful post.';

-- One QuickBooks entry per day, and one day per entry. Partial, because most
-- rows carry no id; unique so a second row can never claim an entry that is
-- already somebody else's — the seam a duplicate would otherwise slip through.
create unique index if not exists daily_sales_qbo_id_unique
  on daily_sales (org_id, (external_ref->'qbo'->>'id'))
  where external_ref->'qbo'->>'id' is not null;


-- ----------------------------------------------------------------------------
-- 2. locations — the shop's own Class and Location in QuickBooks
-- ----------------------------------------------------------------------------

alter table locations
  add column if not exists qbo_class_ref     text,
  add column if not exists qbo_class_name    text,
  add column if not exists qbo_location_ref  text,
  add column if not exists qbo_location_name text;

comment on column locations.qbo_class_ref is
  'QuickBooks Class id stamped on every line of this shop''s daily sales entry (DF01, DF02). 083''s column one level up: there it is per vendor per shop, here it is the shop itself. Realm-scoped — qbo-oauth clears it when the company file changes.';
comment on column locations.qbo_location_ref is
  'QuickBooks Location (Department) id stamped on every line of this shop''s daily sales entry. Realm-scoped, like the class.';


-- ----------------------------------------------------------------------------
-- 3. accounting_sales_mappings — one grid for the org
-- ----------------------------------------------------------------------------
--
-- THREE KINDS OF ROW, one vocabulary each:
--   role      the fixed slots the entry always needs (`square_key` is one of
--             the SALES_ROLES in lib/salesPosting: discounts, tax, tips, …)
--   category  a Square item category, keyed by its name as ItemSales reports it
--   tender    a Square payment method — CARD, CASH, SQUARE_GIFT_CARD, or
--             OTHER:<external source> for a marketplace tender (OTHER:UBEREATS)
--
-- CATEGORY AND TENDER ROWS ARE WRITTEN BY THE SYNC, the moment a key is seen,
-- with no account — which is how an unmapped name reaches the grid with a
-- picker beside it without anybody having to know it exists. Role rows are
-- created by the grid itself when somebody picks an account for one.

create table if not exists accounting_sales_mappings (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  kind           text not null check (kind in ('role', 'category', 'tender')),
  square_key     text not null,
  square_name    text,
  account_ref    text,
  account_name   text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, kind, square_key)
);

create trigger trg_accounting_sales_mappings_updated before update on accounting_sales_mappings
  for each row execute function set_updated_at();

comment on table accounting_sales_mappings is
  'Where each Square category, tender and fixed role posts in QuickBooks — ONE grid for the org, not one per shop (the shop''s Class and Location are on locations). A row with account_ref null has been SEEN by the sync and not yet mapped; it posts to its kind''s default and is named on the receipt. See migration 104.';

alter table accounting_sales_mappings enable row level security;

-- Every member may READ the grid (an account name is not sensitive, and the
-- Sales screen counts unmapped rows for anyone who can see it); only an owner
-- or manager may change where money posts.
create policy accounting_sales_mappings_select on accounting_sales_mappings for select
  using (org_id in (select user_org_ids()));

create policy accounting_sales_mappings_write on accounting_sales_mappings for all
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));


-- ----------------------------------------------------------------------------
-- 4. record_daily_sales — 092's body, plus the breakdown and the vocabulary
-- ----------------------------------------------------------------------------
--
-- Two additions, both AFTER the upsert 092 wrote and neither touching it:
--
--   * the breakdown is written for EVERY row that carries one, `manual` rows
--     included — a hand-corrected net figure is still Square's breakdown, and
--     the posting warns when the two disagree rather than losing the lines;
--   * every category and tender key in the breakdown is upserted into the
--     mapping grid with `last_seen_at`, so the grid always lists what Square
--     has actually sent.
--
-- The return gains `breakdown_days`. Everything 092 returned is unchanged.

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
  v_brk    integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'record_daily_sales expects an array of rows';
  end if;

  v_count := jsonb_array_length(p_rows);

  if v_count = 0 then
    return jsonb_build_object('sales_upserted', 0, 'tips_written', 0,
                              'tips_skipped_closed', 0, 'tips_refused_negative', 0,
                              'tip_dates', '[]'::jsonb, 'breakdown_days', 0);
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

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then
    raise exception 'Only a purchaser or above can sync sales from Square';
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

  -- THE BREAKDOWN, on every row that carries one — including a `manual` row,
  -- which the upsert above deliberately skipped. The figure somebody typed is
  -- theirs; the lines are still what Square said, and the posting reads the
  -- lines.
  update daily_sales ds
     set breakdown           = r->'breakdown',
         breakdown_pulled_at = now()
    from jsonb_array_elements(p_rows) r
   where ds.org_id = v_org
     and ds.location_id = (r->>'location_id')::uuid
     and ds.business_date = (r->>'business_date')::date
     and jsonb_typeof(r->'breakdown') = 'object';
  get diagnostics v_brk = row_count;

  -- THE VOCABULARY: every category and tender the breakdown names, with no
  -- account. `on conflict` keeps whatever account somebody has already picked
  -- and only moves `last_seen_at`, so the grid can say which names are still
  -- in use without ever forgetting a mapping.
  insert into accounting_sales_mappings (org_id, kind, square_key, square_name)
  select distinct v_org, ln->>'kind', ln->>'key', ln->>'name'
    from jsonb_array_elements(p_rows) r,
         jsonb_array_elements(r->'breakdown'->'lines') ln
   where jsonb_typeof(r->'breakdown') = 'object'
     and ln->>'kind' in ('category', 'tender')
     and nullif(ln->>'key', '') is not null
  on conflict (org_id, kind, square_key) do update
    set last_seen_at = now(),
        square_name  = coalesce(excluded.square_name, accounting_sales_mappings.square_name);

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
    'tip_dates',             v_dates,
    'breakdown_days',        v_brk
  );
end;
$$;

revoke all on function public.record_daily_sales(jsonb) from public;
revoke all on function public.record_daily_sales(jsonb) from anon;
grant execute on function public.record_daily_sales(jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. record_sales_posting — the one writer of a day's QuickBooks ref
-- ----------------------------------------------------------------------------
--
-- `p_ref` is the whole `{"qbo": {...}}` branch the edge function built from
-- QuickBooks' answer; the CURRENT breakdown_hash is stamped into it here, in
-- SQL, so "posted hash" can never drift from the row it was posted from.
--
-- `p_error` records a FAILED post instead: the ref is left alone (the entry
-- that is already in QuickBooks is still the entry), and the message lands
-- where the Sales screen can show it.
--
-- Purchaser+, matching record_daily_sales and the Sales cell in the Page
-- Permissions sheet. NO ROWS on refusal, never a raise — 081's shape.

create or replace function public.record_sales_posting(
  p_daily_sales uuid,
  p_ref         jsonb,
  p_error       text
)
returns setof daily_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_hash text;
begin
  select org_id, breakdown_hash into v_org, v_hash
    from daily_sales where id = p_daily_sales;

  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then return; end if;

  if p_error is not null then
    return query
      update daily_sales
         set post_error = p_error
       where id = p_daily_sales
       returning *;
    return;
  end if;

  if jsonb_typeof(p_ref) is distinct from 'object'
     or jsonb_typeof(p_ref->'qbo') is distinct from 'object' then
    raise exception 'The accounting reference must be an object carrying a qbo branch';
  end if;

  return query
    update daily_sales
       set external_ref = external_ref
                          || jsonb_build_object(
                               'qbo',
                               (p_ref->'qbo') || jsonb_build_object('breakdown_hash', v_hash)
                             ),
           posted_at    = now(),
           post_error   = null
     where id = p_daily_sales
     returning *;
end $$;

revoke all on function public.record_sales_posting(uuid, jsonb, text) from public;
revoke all on function public.record_sales_posting(uuid, jsonb, text) from anon;
grant execute on function public.record_sales_posting(uuid, jsonb, text) to authenticated;


-- ----------------------------------------------------------------------------
-- After this runs:
--   select column_name from information_schema.columns
--    where table_name = 'daily_sales'
--      and column_name in ('breakdown','breakdown_hash','external_ref','posted_at','post_error');
--                                                                 → 5 rows
--   select column_name from information_schema.columns
--    where table_name = 'locations' and column_name like 'qbo_%';   → 4 rows
--   select count(*) from accounting_sales_mappings;                → 0
--   select count(*) from pg_policy
--    where polrelid = 'public.accounting_sales_mappings'::regclass; → 2
--   select count(*) from pg_proc where proname = 'record_daily_sales';   → 1
--   select count(*) from pg_proc where proname = 'record_sales_posting'; → 1
--     (one each, never more: a changed argument list creates an OVERLOAD and
--      leaves the old body live beside it — 033's freeze_pay_period trap.)
--   select public.record_sales_posting(null, null, null);         → 0 rows
--     (an ANSWER, not an error; from the SQL editor it is 0 rows because the
--      id matches nothing, from a service_role script because user_has_role
--      has no auth.uid() — migration 014's footgun, not a fault.)
-- ============================================================================
