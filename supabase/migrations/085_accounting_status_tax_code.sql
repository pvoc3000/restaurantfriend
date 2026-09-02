-- ============================================================================
-- restaurantfriend — migration 085 · the status function can see the tax code
--
-- 084 added `tax_code_ref` / `tax_code_name` to `accounting_connections` and
-- stopped there. The app never reads that table directly — it cannot, the table
-- having NO policies at all (081) — so everything it knows about the connection
-- comes through `accounting_connection_status()`, whose column list 084 left
-- alone. The column was written and could not be read back.
--
-- HOW IT SHOWED, which is the part worth keeping: nothing looked broken.
-- Settings saved the code and reported success (the write goes through
-- `qbo-sync set_defaults`, which does see the column), the picker simply went
-- back to reading "Choose a tax code", and the first TAXABLE customer invoice
-- refused with "No QuickBooks tax code is set. Choose one in Settings →
-- Accounting." — pointing at the screen where it had just been set.
--
-- A ZERO-TAX ORDER IS WHY IT SHIPPED. `invoicePushRefusals` asks for a tax code
-- only when something on the order is taxable, and the order phase 4 was walked
-- against was wholesale bagels — $218.40, none of it taxed. That push succeeded
-- and matched to the cent. Found the next order (2026-09-02).
--
-- ---------------------------------------------------------------------------
-- DROP FIRST, and that is not tidiness
--
-- `create or replace` CANNOT change the column list of a `returns table`
-- function — Postgres refuses with "cannot change return type of existing
-- function". So this drops and recreates, which also means the two revokes and
-- the grant must be restated: a dropped function takes its privileges with it,
-- and a recreated one is executable by `anon` again through Supabase's default
-- grants unless revoked BY NAME (002's rule).
--
-- The body is 081's, reproduced whole (055's rule) and changed in exactly two
-- places: two columns in the signature, two in the select.
--
-- Depends on 081 and 084. RERUNNABLE — `drop ... if exists` then create.
-- ============================================================================

drop function if exists public.accounting_connection_status(uuid);

create function public.accounting_connection_status(p_org uuid)
returns table (
  provider                 text,
  status                   text,
  realm_id                 text,
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
  -- Same guard as 081: not your org, no rows. A refusal here would tell an
  -- outsider which org ids exist, and this function is reachable by every
  -- authenticated member.
  if p_org is null or p_org not in (select user_org_ids()) then
    return;
  end if;

  -- NAMED COLUMNS, NEVER `select c.*`. The row holds a live refresh token and
  -- an access token; this list is the only thing keeping them off the wire, so
  -- it must stay a list even when that means editing it for every new column.
  -- That discipline is what 084 forgot, and forgetting it is the safe way round.
  return query
    select c.provider, c.status, c.realm_id, c.environment,
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
--   select count(*) from pg_proc
--    where proname = 'accounting_connection_status';                    → 1
--     (two would mean the drop was skipped and an overload is live — 033's
--      `freeze_pay_period` trap, and the older one returns no tax code)
--
--   select pg_get_function_result(oid) from pg_proc
--    where proname = 'accounting_connection_status';
--     → names tax_code_ref and tax_code_name, and NO token but the expiry
--
--   NOT `information_schema.columns` — a function's OUT parameters are not
--   listed there, so that query returns ZERO ROWS for a healthy function and a
--   "0 tokens leak" test written against it is vacuously true. Measured on the
--   harness while verifying this migration, which is the only reason it is
--   written down.
--
--   select has_function_privilege('anon',
--     'public.accounting_connection_status(uuid)', 'execute');          → false
--
--   select has_function_privilege('authenticated',
--     'public.accounting_connection_status(uuid)', 'execute');          → true
-- ============================================================================
