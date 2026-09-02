-- ============================================================================
-- restaurantfriend — migration 086 · the app stops being told the realm id
--
-- Intuit refused the production-key questionnaire (2026-09-02) on one line:
--
--   "Any Intuit credentials including customer IDs, app client ID and client
--    secret must be stored securely and not be exposed within your app."
--
-- CUSTOMER ID IS INTUIT'S NAME FOR THE REALM ID — the QuickBooks company
-- identifier. `accounting_connection_status()` returned it to every member of
-- the org, so it travelled in the RPC response on every settings page load and
-- was RENDERED on screen whenever the company name had not arrived yet
-- ("COMPANY 9341457832962518"). It has exactly one consumer in `web/src` and
-- that consumer is the fallback that displayed it.
--
-- The name is the thing a person wants anyway, and it already comes from the
-- `meta` mode, which asks QuickBooks. So the id simply stops leaving Postgres.
--
-- ---------------------------------------------------------------------------
-- WHAT STILL HAS IT, AND MUST
--
-- `qbo-sync` and `qbo-oauth` read `accounting_connections` directly with a
-- service_role client — every API call is addressed to
-- `/v3/company/{realm_id}/…` and cannot be made without it. That is not
-- exposure: 081 gave the table zero policies precisely so nothing but those
-- functions can read it. What changes is that the BROWSER never sees it.
--
-- `connected` replaces it, so a caller can still tell a connected row from a
-- pending one without learning which company it is.
--
-- ---------------------------------------------------------------------------
-- DROP FIRST, for 085's reason restated: `create or replace` cannot change the
-- column list of a `returns table` function, and a dropped function takes its
-- privileges with it — so both revokes and the grant are restated. The body is
-- 085's, changed in exactly two places.
--
-- Depends on 081, 084, 085. RERUNNABLE.
-- ============================================================================

drop function if exists public.accounting_connection_status(uuid);

create function public.accounting_connection_status(p_org uuid)
returns table (
  provider                 text,
  status                   text,
  connected                boolean,
  environment              text,
  bill_expense_account_ref  text,
  bill_expense_account_name text,
  invoice_item_ref          text,
  invoice_item_name         text,
  tax_code_ref             text,
  tax_code_name            text,
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

  -- NAMED COLUMNS, NEVER `select c.*` — the row holds a live refresh token, an
  -- access token and the realm id, and this list is the only thing keeping any
  -- of them off the wire. 084 forgot to widen it and a feature quietly did not
  -- work; the failure in the other direction is a credential on a screen.
  return query
    select c.provider, c.status,
           (c.realm_id is not null) as connected,
           c.environment,
           c.bill_expense_account_ref, c.bill_expense_account_name,
           c.invoice_item_ref, c.invoice_item_name,
           c.tax_code_ref, c.tax_code_name,
           c.refresh_token_expires_at, c.connected_at, c.last_used_at,
           c.last_error
      from accounting_connections c
     where c.org_id = p_org;
end $$;

revoke all on function public.accounting_connection_status(uuid) from public;
revoke all on function public.accounting_connection_status(uuid) from anon;
grant execute on function public.accounting_connection_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- After this runs:
--   select pg_get_function_result(oid) from pg_proc
--    where proname = 'accounting_connection_status';
--     → names `connected boolean` and NO realm_id, no token but the expiry
--
--   select count(*) from pg_proc
--    where proname = 'accounting_connection_status';               → 1
--
--   select has_function_privilege('anon',
--     'public.accounting_connection_status(uuid)', 'execute');     → false
-- ============================================================================
