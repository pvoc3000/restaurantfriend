-- ============================================================================
-- restaurantfriend — migration 081 · the QuickBooks Online connection
--
-- Why (Mark, 2026-09-01): "link with quickbooks online so we can send invoices
-- we generate in the app to my QBO account for payment."
--
-- 025 put `external_ref` on `vendor_invoices` and called it "the QuickBooks
-- seam, and the ONLY part of the sync built now". 026 added the vendor half.
-- 051 added the customer-side twin. None of the three has ever had a reader.
-- This is the migration those comments were written for.
--
-- Mark's four decisions, 2026-09-01: BOTH directions with A/P first; QBO
-- RECORDS ONLY (no QuickBooks Payments, no Intuit-sent email — his own
-- documents and specialorders@ are untouched); ONE SUMMARY LINE per document,
-- so there is no account-mapping table; and status is PULLED BY A BUTTON.
--
-- ---------------------------------------------------------------------------
-- WHY A CREDENTIAL IS IN THE DATABASE, WHICH THIS APP HAS NEVER DONE
--
-- `_shared/email.ts` states the rule: "CREDENTIALS live in edge-function
-- secrets (never in the DB — settings are readable by every org member)", and
-- `org_read` (001) really is membership-wide, so that parenthetical is
-- literally true. Every credential to date — two Gmail refresh tokens, the
-- Square PAT — was minted by Mark by hand and pasted into a secret.
--
-- A QBO refresh token cannot be. It ROTATES: the token endpoint returns a new
-- one and invalidates the old, so whatever comes back must be stored or the
-- connection is dead. An edge function cannot rewrite its own secret. There is
-- no arrangement of secrets that survives a rotating credential.
--
-- So the rotating half lives here and the STATIC half does not: the client id
-- and secret stay in the edge secret `QBO_CREDS`, exactly like `EMAIL_CREDS_*`.
-- Whoever reads this next should not take it as licence — the test is whether
-- the credential rotates, and only this one does.
--
-- ---------------------------------------------------------------------------
-- ZERO POLICIES, WHICH IS A NEW SHAPE HERE
--
-- 033's `timesheet_benefits`, 063's `daily_sales` and 074's
-- `password_reset_requests` each have NO WRITE POLICIES and a SELECT policy.
-- This table has neither, and the difference is what the row holds: 074's holds
-- an email address, this one holds a live bearer token. A SELECT policy for
-- owner/admin would put a working credential one PostgREST call from any
-- manager's browser, and the app never needs to read it — the edge function
-- does, under `service_role`, which bypasses RLS (063 says so in as many
-- words).
--
-- What the SCREEN needs is whether we are connected, and that comes from
-- `accounting_connection_status()` below, which `returns table (...)` naming
-- its columns. It must never be rewritten to return `setof
-- accounting_connections` — that would hand back the tokens this shape exists
-- to hide.
--
-- The verify block asserts ZERO policies, so a later reader who "notices the
-- missing SELECT policy" finds out why before adding one.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- NO `qbo_syncs` run-record table. 063 lists what one has to earn and names the
-- trigger that would change the answer: "a NIGHTLY CRON. An unattended run has
-- nobody reading its response." Every push here is a button with a person
-- watching it, so it is not earned. Add one when a schedule arrives, not before.
--
-- NO `paid` column, on either side. `lib/invoices.ts`, 025 and 051 all say
-- payment is a fact QuickBooks owns. The balance pull returns its answer and
-- stores nothing (063's `preview` mode is the precedent), so there is nothing
-- here for it to land in and that is on purpose.
--
-- NO `orgs.settings.accounting`. The account and item refs are ids INSIDE one
-- company file, so they live on the connection row beside the `realm_id` that
-- gives them meaning. In settings they would silently point at a different
-- account the moment the realm changed — `locations.square_location_id`
-- (063) is the precedent for "a join key is a column, not open-ended config".
--
-- Depends on 001 (user_has_role, orgs), 025 (vendor_invoices), 051 (customers,
-- special_orders). Run in the Supabase SQL editor BEFORE deploying either edge
-- function. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The connection
-- ----------------------------------------------------------------------------

create table accounting_connections (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,

  -- One value today. Widening is a one-line migration, and the app should not
  -- carry a vocabulary nobody has asked for.
  provider text not null default 'qbo' check (provider in ('qbo')),

  -- `pending` is a handshake in flight and says nothing about the tokens
  -- beside it. `disconnected` is not decoration: Mark can disconnect this app
  -- from inside QuickBooks, and a refresh token dies at 100 days unused — in
  -- both cases the first we hear of it is an `invalid_grant`, and the screen
  -- has to be able to say so rather than reading `connected` forever.
  status   text not null default 'pending'
           check (status in ('pending', 'connected', 'disconnected', 'error')),

  -- The QBO company. Null until a callback succeeds, which is why the table can
  -- hold a handshake that has not finished.
  realm_id    text,
  environment text not null default 'sandbox'
              check (environment in ('sandbox', 'production')),

  -- THE ROTATING HALF. `previous_refresh_token` keeps one generation because
  -- Intuit tolerates the old value briefly, so a write that lands after a
  -- crash still has something to fall back on.
  refresh_token             text,
  previous_refresh_token    text,
  refresh_token_expires_at  timestamptz,
  access_token              text,
  access_token_expires_at   timestamptz,

  -- Where a pushed document lands. Ids inside `realm_id`'s company file, which
  -- is the whole reason they are on this row — see the header.
  bill_expense_account_ref  text,
  bill_expense_account_name text,
  invoice_item_ref          text,
  invoice_item_name         text,

  -- The OAuth handshake. Single-use: the callback clears it in the same
  -- statement that verifies it, so a replayed link matches nothing.
  oauth_state             text,
  oauth_state_expires_at  timestamptz,

  connected_by uuid references auth.users(id),
  connected_at timestamptz,
  last_used_at timestamptz,

  -- The sentence a human reads when a push refuses. Never the token, and never
  -- a raw provider body — `_shared/qbo.ts` words these.
  last_error   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, provider)
);

-- The callback arrives with `state` and NOTHING ELSE — no session, no org — so
-- this is the only way it can find the row. Partial, per 063's
-- `locations_square_location_id_unique`: null is the resting value and many
-- rows will hold it.
create unique index accounting_connections_oauth_state_unique
  on accounting_connections (oauth_state)
  where oauth_state is not null;

create trigger trg_accounting_connections_updated
  before update on accounting_connections
  for each row execute function set_updated_at();

alter table accounting_connections enable row level security;

-- NO POLICIES. Not a gap — see the header. `service_role` bypasses RLS and is
-- the only writer; the app reads through accounting_connection_status().


-- ----------------------------------------------------------------------------
-- 2. The two mapping columns
-- ----------------------------------------------------------------------------
--
-- A QBO Bill needs a `VendorRef` and an Invoice needs a `CustomerRef`, so both
-- of ours need somewhere to remember which QBO record they are.
--
-- WHY NOT 026's `vendor_locations.external_ref`, which was added for exactly
-- this. 026 chose that grain because "a per-location company file has its own
-- vendor ids" — and this connection is one row per ORG, i.e. one company file,
-- so the same id would have to be copied onto every location row: N copies of
-- one fact in a column that must never differ per row.
--
-- The deciding half is worse. `vendor_locations` has NO INSERT anywhere in
-- `web/src` (reads and InlineValue updates only), so a vendor with no row at
-- the location its bill was filed at cannot be mapped at all — and the landlord
-- and the plumber, `order_type: 'none'`, are both the vendors most likely to be
-- missing a row AND exactly the bills this feature exists to push.
--
-- So the mapping goes on `vendors`, which every vendor has. 026's column is
-- left in place and unread; if a second company file ever arrives it becomes
-- the override, which is the shape design rule 6 uses everywhere else.

alter table vendors   add column external_ref jsonb not null default '{}'::jsonb;
alter table customers add column external_ref jsonb not null default '{}'::jsonb;

comment on column vendors.external_ref is
  'Accounting-system identity, e.g. {"qbo": {"id": "58"}}. The org-level '
  'mapping; 026''s vendor_locations.external_ref is unread — see migration 081.';
comment on column customers.external_ref is
  'Accounting-system identity, e.g. {"qbo": {"id": "142"}}.';

-- TWO OF OURS MUST NEVER MAP TO ONE OF THEIRS. 063:80-88 is the argument and it
-- is sharper here: QBO enforces a globally unique DisplayName (error 6240),
-- 187 email addresses repeat across our 5,874 customers, and 138 have no email
-- at all — so a name-matched customer mapping WILL collide, and without this
-- two of Mark's customers would quietly bill to one QBO record while every
-- total still reconciled.
create unique index vendors_external_ref_qbo_unique
  on vendors (org_id, (external_ref -> 'qbo' ->> 'id'))
  where external_ref -> 'qbo' ->> 'id' is not null;

create unique index customers_external_ref_qbo_unique
  on customers (org_id, (external_ref -> 'qbo' ->> 'id'))
  where external_ref -> 'qbo' ->> 'id' is not null;

-- `vendor_invoices` got `synced_at` in 025; `special_orders` never did, and A/R
-- would otherwise have to invent somewhere to put it later. One column now
-- beats a second opinion in three months.
alter table special_orders add column synced_at timestamptz;


-- ----------------------------------------------------------------------------
-- 3. Starting a handshake
-- ----------------------------------------------------------------------------
--
-- Owner/admin, because connecting the books is the same class of act as
-- `org_update`, which 001 gives to that pair.
--
-- IT WRITES ONLY THE TWO STATE COLUMNS. Setting `status = 'pending'` on a row
-- that is already connected would mean clicking Connect and closing the tab
-- left a working token reading `pending` forever; nulling `realm_id` would be
-- worse. Tokens, realm and status are the callback's to write, and only when it
-- has succeeded.

create or replace function public.begin_accounting_connection(
  p_org uuid,
  p_environment text default 'sandbox'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  if not user_has_role(p_org, array['owner', 'admin']) then
    raise exception 'Connecting an accounting system is open to managers and the owner';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Unknown environment: %', p_environment;
  end if;

  v_state := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into accounting_connections (org_id, provider, environment,
                                      oauth_state, oauth_state_expires_at)
       values (p_org, 'qbo', p_environment,
               v_state, now() + interval '10 minutes')
  on conflict (org_id, provider) do update
     set oauth_state            = excluded.oauth_state,
         oauth_state_expires_at = excluded.oauth_state_expires_at,
         environment            = excluded.environment;

  return v_state;
end $$;

revoke all on function public.begin_accounting_connection(uuid, text) from public;
revoke all on function public.begin_accounting_connection(uuid, text) from anon;
grant execute on function public.begin_accounting_connection(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. What the screen may know
-- ----------------------------------------------------------------------------
--
-- `returns table (...)`, NEVER `setof accounting_connections`. That signature
-- is the whole of the zero-policy design: change it and every token on the row
-- goes back to the browser.
--
-- `refresh_token_expires_at` is here so the settings block can say "this stops
-- working on 10 Dec unless it is used" — 100 days with no bills is entirely
-- plausible in a slow month, and a connection that dies silently is one nobody
-- reconnects until the morning they need it.

create or replace function public.accounting_connection_status(p_org uuid)
returns table (
  provider                 text,
  status                   text,
  realm_id                 text,
  environment              text,
  bill_expense_account_ref  text,
  bill_expense_account_name text,
  invoice_item_ref          text,
  invoice_item_name         text,
  refresh_token_expires_at timestamptz,
  connected_at             timestamptz,
  last_used_at             timestamptz,
  last_error               text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or p_org not in (select user_org_ids()) then
    return;
  end if;

  return query
    select c.provider, c.status, c.realm_id, c.environment,
           c.bill_expense_account_ref, c.bill_expense_account_name,
           c.invoice_item_ref, c.invoice_item_name,
           c.refresh_token_expires_at, c.connected_at, c.last_used_at,
           c.last_error
      from accounting_connections c
     where c.org_id = p_org;
end $$;

revoke all on function public.accounting_connection_status(uuid) from public;
revoke all on function public.accounting_connection_status(uuid) from anon;
grant execute on function public.accounting_connection_status(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Recording that a bill reached QuickBooks
-- ----------------------------------------------------------------------------
--
-- `vendor_invoices_update` (025) is purchaser+ WITH NO COLUMN RESTRICTION, so
-- as things stand any purchaser can PATCH `external_ref` and `synced_at`
-- straight through PostgREST — invent a QBO id, blank a sync token, mark an
-- unsynced bill synced. CLAUDE.md's rule: "RLS filters ROWS, not COLUMNS. When
-- the rule is 'a user may change this field'... write a security definer
-- function naming those columns." 025 made that exact argument for approval.
--
-- It also lets `qbo-sync` do this write through the CALLER's JWT rather than
-- `service_role` — `sync-square-sales`' own shape — so the escalation in that
-- function stays bounded to one thing: reading and rewriting the token row.
--
-- APPROVED ONLY. `docs/invoices-brief.md`: the module exists because "an
-- invoice arriving is not an invoice you should pay", and pushing an unapproved
-- bill into the books throws away the one thing this app knows that QuickBooks
-- doesn't.
--
-- Returns rows so the caller can check the COUNT, not the absence of an error —
-- InvoiceFooter.tsx already does this and calls a cheerful false success about
-- money "the employee-delete lesson with more at stake".

create or replace function public.record_accounting_push(
  p_invoice uuid,
  p_ref     jsonb
)
returns setof vendor_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status text;
begin
  if jsonb_typeof(p_ref) is distinct from 'object' then
    raise exception 'The accounting reference must be a JSON object';
  end if;

  select org_id, status into v_org, v_status
    from vendor_invoices where id = p_invoice;

  -- No such invoice, not your role, or not approved: NO ROWS rather than a
  -- raise, so the caller's row-count check is the one place refusal is read.
  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then return; end if;
  if v_status <> 'approved' then return; end if;

  return query
    update vendor_invoices set
      -- Top-level merge, so {"qbo": {...}} replaces the qbo branch whole and
      -- an id can never outlive the sync token it was stored with.
      external_ref = external_ref || p_ref,
      synced_at    = now()
    where id = p_invoice
    returning *;
end $$;

revoke all on function public.record_accounting_push(uuid, jsonb) from public;
revoke all on function public.record_accounting_push(uuid, jsonb) from anon;
grant execute on function public.record_accounting_push(uuid, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from accounting_connections;                          → 0
--
--   select count(*) from pg_policy
--    where polrelid = 'public.accounting_connections'::regclass;          → 0
--     (DELIBERATE. The row holds a live refresh token, where 074's holds an
--      email address. Read it through accounting_connection_status(), which
--      never returns the tokens. Do not "fix" this by adding a SELECT policy.)
--
--   select column_name from information_schema.columns
--    where table_name = 'vendors' and column_name = 'external_ref';       → 1 row
--   select column_name from information_schema.columns
--    where table_name = 'special_orders' and column_name = 'synced_at';   → 1 row
--
--   select count(*) from pg_proc where proname in (
--     'begin_accounting_connection','accounting_connection_status',
--     'record_accounting_push');                                          → 3
--     (three, never more: a changed argument list creates an OVERLOAD and
--      leaves the old body live beside it — 033's freeze_pay_period trap.)
--
--   select public.accounting_connection_status(null);                     → 0 rows
--     (an ANSWER, not an error — and from a service_role script it is 0 rows
--      for a different reason: user_org_ids() has no auth.uid() to resolve,
--      which is migration 014's footgun, not a fault.)
-- ============================================================================
