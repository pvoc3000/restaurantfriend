-- ============================================================================
-- 123 — THE PAYMENT SAYS WHAT IT WAS: SPECIAL ORDERS, SALES TAX, DELIVERY
--
-- SQL STARTS AT LINE 33. Everything above it is comment.
--
-- Mark, 2026-09-22, asked how a pay-link payment is categorized in Square: as
-- built it is a bare payment, which Square reports as a custom amount under
-- UNCATEGORIZED, and the nightly journal entry posts that to Uncategorized
-- Income with the sales tax and the delivery folded in. "Let's do it the
-- proper way." So `square-pay` now creates a Square ORDER first —
-- `supabase/functions/_shared/squareOrder.ts` has the whole argument — whose
-- lines are the existing "Special Order" item (variable price, Special Orders
-- category; Mark, same day), with the tax as a real Square tax and delivery as
-- a service charge. This migration gives it the two facts it lacked:
--
-- 1. `special_order_pay_tokens.breakdown` — the invoice split into taxable
--    goods, untaxed goods (+ rush), delivery, tax and rate, snapshotted at send
--    beside `total` by `payBreakdown` (`invoiceSplit`, the QuickBooks push's
--    own arithmetic). A link sent before this has none and is charged as ONE
--    Special Orders line — still categorized, just not split.
--
-- 2. WHICH ITEM. `orgs.settings.square_payments.item_variation_id`, or
--    `sandbox_item_variation_id` while the environment is sandbox — the
--    sandbox is a separate Square account with its own catalog, exactly as it
--    has its own locations (120). Empty → lines with no catalog item, which
--    Square reports as Uncategorized: the old behaviour, not a failure.
--
-- `claim_pay_token` is reproduced IN FULL from 120 (055's rule) and returns
-- three more keys, marked. `pay_by_token` is untouched: the browser has no use
-- for any of this. Arguments unchanged, so grants stand, no overload.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE BREAKDOWN
-- ----------------------------------------------------------------------------
alter table special_order_pay_tokens
  add column if not exists breakdown jsonb;

comment on column special_order_pay_tokens.breakdown is
  'The invoice total split for the Square order (123): taxable_net, other_net '
  '(untaxed goods + rush), delivery, tax, tax_rate, total — dollars, at send.';


-- ----------------------------------------------------------------------------
-- 2. THE ITEM — internal, granted to nobody
-- ----------------------------------------------------------------------------
create or replace function public.pay_link_square_variation(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(
           case
             when settings -> 'square_payments' ->> 'environment' = 'sandbox'
               then settings -> 'square_payments' ->> 'sandbox_item_variation_id'
             else settings -> 'square_payments' ->> 'item_variation_id'
           end), '')
    from orgs where id = p_org;
$$;

revoke all on function public.pay_link_square_variation(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. CLAIM — 120's, with three more keys
-- ----------------------------------------------------------------------------
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
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',                                  -- <<< 123
    'balance', s -> 'balance',
    'location_id', pay_link_square_location((s ->> 'order_id')::uuid),   -- <<< 120
    'breakdown', (select breakdown from special_order_pay_tokens         -- <<< 123
                   where token = p_token),
    'variation_id', pay_link_square_variation((s ->> 'org_id')::uuid)    -- <<< 123
  );
end;
$$;



notify pgrst, 'reload schema';
