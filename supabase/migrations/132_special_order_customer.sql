-- ============================================================================
-- 132 — ONE QUICKBOOKS CUSTOMER FOR EVERY SPECIAL-ORDER CUSTOMER
-- ============================================================================
--
-- Mark, 2026-09-24: "would it be ill advised to create a 'Special Order
-- Customer' customer in QBO, and use it for every special order customer, and
-- leave real, dedicated customer records in QBO for our wholesale clients?"
-- Then, finding 081's one-to-one index refuse the second link: build the
-- fallback rather than drop the guard.
--
-- So the catch-all is a SETTING, never a link. A customer linked to a QBO
-- customer (a wholesale client) bills there; an unlinked one bills to this, with
-- their own name and address as the invoice's bill-to. 081's
-- `customers_external_ref_qbo_unique` stays exactly as it was: two of ours
-- still never map to one of theirs BY ACCIDENT.
--
-- Beside `invoice_item_ref` on the connection row, because it is an id inside
-- one company file (081's reason) — `qbo-oauth` clears it on a company change.
--
-- Depends on 081, 131. RERUNNABLE.
-- ============================================================================

alter table accounting_connections
  add column if not exists special_order_customer_ref  text,
  add column if not exists special_order_customer_name text;

-- 131's body, widened by the two columns. DROP FIRST: `create or replace`
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

-- ----------------------------------------------------------------------------
-- After this runs:
--   select pg_get_function_result(oid) from pg_proc
--    where proname = 'accounting_connection_status';  → names special_order_customer_ref
--   select has_function_privilege('anon',
--     'public.accounting_connection_status(uuid)', 'execute');      → false
-- ============================================================================
