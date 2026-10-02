-- ============================================================================
-- 165 — DELIVERY AND RUSH BOOK TO THEIR OWN QUICKBOOKS ITEMS
--
-- Mark, 2026-10-01: delivery fees were not reaching the QBO sales item
-- "Delivery Fee" — they rode inside each order's untaxed line under Special
-- Order (or Wholesale). Add a Delivery item beside the Wholesale item in
-- Settings → Accounting, and use it for delivery charges. Rush fees get their
-- own item too ("Misc service fee", or whatever the books want), on special
-- and wholesale orders alike.
--
-- Two column pairs on the connection row, beside 131's wholesale item, and
-- 132's status function widened to report them. Like every id here they live
-- INSIDE one company file, so `qbo-oauth` clears them when the realm changes,
-- and `qbo-sync`'s `set_defaults` is the only writer (081: no policies).
--
-- THE APP READS THESE THROUGH `accounting_connection_status()`, and `qbo-oauth`
-- clears them on a reconnect — apply this BEFORE deploying either function or
-- shipping the web change. RERUNNABLE.
-- ============================================================================

alter table accounting_connections
  add column if not exists delivery_item_ref  text,
  add column if not exists delivery_item_name text,
  add column if not exists rush_item_ref      text,
  add column if not exists rush_item_name     text;

-- 132's body, widened by the four columns. DROP FIRST: `create or replace`
-- cannot change a `returns table` column list, and the drop takes the grants.
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
  wholesale_item_ref        text,
  wholesale_item_name       text,
  delivery_item_ref         text,
  delivery_item_name        text,
  rush_item_ref             text,
  rush_item_name            text,
  special_order_customer_ref  text,
  special_order_customer_name text,
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

  -- NAMED COLUMNS, NEVER `select c.*` (086) — the row holds live tokens.
  return query
    select c.provider, c.status,
           (c.realm_id is not null) as connected,
           c.environment,
           c.bill_expense_account_ref, c.bill_expense_account_name,
           c.invoice_item_ref, c.invoice_item_name,
           c.wholesale_item_ref, c.wholesale_item_name,
           c.delivery_item_ref, c.delivery_item_name,
           c.rush_item_ref, c.rush_item_name,
           c.special_order_customer_ref, c.special_order_customer_name,
           c.tax_code_ref, c.tax_code_name,
           c.refresh_token_expires_at, c.connected_at, c.last_used_at,
           c.last_error
      from accounting_connections c
     where c.org_id = p_org;
end $$;

revoke all on function public.accounting_connection_status(uuid) from public;
revoke all on function public.accounting_connection_status(uuid) from anon;
grant execute on function public.accounting_connection_status(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select pg_get_function_result(oid) from pg_proc
--    where proname = 'accounting_connection_status';  → names rush_item_ref
--   select has_function_privilege('anon',
--     'public.accounting_connection_status(uuid)', 'execute');      → false
-- ============================================================================
