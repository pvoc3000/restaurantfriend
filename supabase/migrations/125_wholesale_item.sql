-- ============================================================================
-- 125 — A WHOLESALE PAYMENT IS SOLD AS THE "WHOLESALE ORDER" ITEM
-- ============================================================================
--
-- Mark, 2026-09-23, after creating the first customer invoice: "Don't we need
-- to set a 'Wholesale Order' square token in settings the same way we did
-- 'Special Order'?" Yes. 123 sells every pay-link payment as the "Special
-- Order" item, so Square files it under the Special Orders category and the
-- nightly journal entry books it as special-order income — and a week of Cafe
-- Knotted's donuts is wholesale.
--
-- WHAT COUNTS AS WHOLESALE is the app's existing answer: a day MADE BY A
-- STANDING ORDER (`standing_order_id` set — decision 13, "standing orders =
-- wholesale"). A customer invoice is wholesale when EVERY order on it is such
-- a day; a single order's pay link when that order is one. A mixed invoice
-- stays Special Order, because a Square line carries one item.
--
-- NEW SETTINGS, beside 123's: `square_payments.wholesale_item_variation_id`
-- and `sandbox_wholesale_item_variation_id`. EMPTY FALLS BACK to the Special
-- Order item, so nothing changes until the field is filled.
--
-- The QuickBooks side needs no code: a new Square category registers itself
-- in `accounting_sales_mappings` on the first sync that sees it and posts to
-- Uncategorized Income, named on the receipt, until it is mapped.
--
-- `claim_pay_token` is redefined IN FULL with its argument list unchanged, so
-- 119's grants stand. `pay_link_square_variation(uuid)` (123) is left in place
-- and unused by this function.
--
-- Run in the Supabase SQL editor after 124. RERUNNABLE.
-- ============================================================================

create or replace function public.pay_link_token_variation(p_state jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := (p_state ->> 'org_id')::uuid;
  v_sandbox boolean;
  v_cfg jsonb;
  v_wholesale boolean;
  v_special text;
  v_whole text;
begin
  select settings -> 'square_payments' into v_cfg from orgs where id = v_org;
  v_sandbox := coalesce(v_cfg ->> 'environment', '') = 'sandbox';

  v_special := nullif(btrim(v_cfg ->> case when v_sandbox
                                        then 'sandbox_item_variation_id'
                                        else 'item_variation_id' end), '');
  v_whole := nullif(btrim(v_cfg ->> case when v_sandbox
                                      then 'sandbox_wholesale_item_variation_id'
                                      else 'wholesale_item_variation_id' end), '');

  if p_state ->> 'customer_invoice_id' is not null then
    select bool_and(o.standing_order_id is not null) into v_wholesale
      from customer_invoice_lines l
      join special_orders o on o.id = l.special_order_id
     where l.invoice_id = (p_state ->> 'customer_invoice_id')::uuid;
  else
    select standing_order_id is not null into v_wholesale
      from special_orders where id = (p_state ->> 'order_id')::uuid;
  end if;

  return case when coalesce(v_wholesale, false) then coalesce(v_whole, v_special) else v_special end;
end;
$$;

revoke all on function public.pay_link_token_variation(jsonb) from public, anon, authenticated;

create or replace function public.claim_pay_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb := pay_token_state(p_token);
begin
  if s ->> 'state' <> 'open' then
    return s;
  end if;

  update special_order_pay_tokens
     set claimed_until = now() + interval '2 minutes'
   where token = p_token
     and (claimed_until is null or claimed_until < now());
  if not found then
    return jsonb_build_object('state', 'busy');
  end if;

  s := pay_token_state(p_token);
  if s ->> 'state' <> 'open' then
    update special_order_pay_tokens set claimed_until = null where token = p_token;
    return s;
  end if;

  return jsonb_build_object(
    'state', 'claimed',
    'org_id', s -> 'org_id',
    'order_id', s -> 'order_id',
    'customer_invoice_id', s -> 'customer_invoice_id',
    'kind', case when s ->> 'customer_invoice_id' is not null
                 then 'customer_invoice' else 'order' end,
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',
    'balance', s -> 'balance',
    'location_id', pay_link_token_location(s),
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_token_variation(s)                          -- <<< 125
  );
end;
$$;

revoke all on function public.claim_pay_token(text) from public, anon, authenticated;
grant execute on function public.claim_pay_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
