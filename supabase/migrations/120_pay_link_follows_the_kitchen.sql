-- ============================================================================
-- 120 — A PAY-LINK PAYMENT LANDS AT THE SHOP THAT MAKES THE ORDER
--
-- SQL STARTS AT LINE 40. Everything above it is comment.
--
-- Mark, 2026-09-22, the day 119 was applied: "I don't want to create an
-- 'Orders' location. I think sales should stay with the location that makes
-- the donuts."
--
-- 119 charged every pay-link payment into ONE Square location named in
-- `orgs.settings.square_payments.location_id` — a location of its own for
-- invoiced sales, so `sync-square-sales` would never read it. That location was
-- never created, and now will not be. The payment goes to the Square location
-- of the order's KITCHEN (`special_orders.kitchen_location_id`, "MADE here" in
-- 051), which is already on `locations.square_location_id` for DF01 and DF02.
--
-- THE FALLBACK IS THE PICKUP SHOP, THEN NOTHING. Measured over 2026's 386
-- orders: 380 name a kitchen; 4 of the other 6 name a pickup shop; 2 name
-- neither. An order resolving to no Square location offers no online payment
-- (`square: null` on the page, which says so), rather than guessing a shop.
--
-- WHAT THIS CHANGES DOWNSTREAM, deliberately: these payments are now IN that
-- shop's Square sales, so `sync-square-sales` reads them and the nightly
-- journal entry posts them — the same place a hand-sent Square invoice's
-- payment lands today. The reporting separation 119 was built for is given up
-- on purpose; CLAUDE.md's customer-invoices thread says so.
--
-- THE SANDBOX IS THE EXCEPTION. Square's sandbox is a separate account with
-- its own locations, where DF01's real id does not exist — so while
-- `square_payments.environment` is 'sandbox', every payment goes to
-- `square_payments.sandbox_location_id` instead, and a test never needs a shop
-- mapped to a fake location.
--
-- `settings.square_payments.location_id` is no longer read. The two functions
-- below are reproduced IN FULL (055's rule) with only the location changed;
-- `pay_token_state` and `record_pay_link_payment` are untouched. Arguments are
-- unchanged, so 119's grants stand and no overload is created (033's lesson).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WHERE AN ORDER'S MONEY GOES — internal, granted to nobody
-- ----------------------------------------------------------------------------
create or replace function public.pay_link_square_location(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when g.settings -> 'square_payments' ->> 'environment' = 'sandbox'
             then nullif(btrim(g.settings -> 'square_payments' ->> 'sandbox_location_id'), '')
           else coalesce(
                  nullif(btrim(k.square_location_id), ''),
                  nullif(btrim(p.square_location_id), '')
                )
         end
    from special_orders o
    join orgs g on g.id = o.org_id
    left join locations k on k.id = o.kitchen_location_id
    left join locations p on p.id = o.location_id
   where o.id = p_order;
$$;

revoke all on function public.pay_link_square_location(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. READ (anon) — 119's, with the location from the order
-- ----------------------------------------------------------------------------
create or replace function public.pay_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb := pay_token_state(p_token);
  v_cfg jsonb;
  v_location text;
begin
  if s ->> 'state' <> 'open' then
    return s;
  end if;

  select settings -> 'square_payments' into v_cfg
    from orgs where id = (s ->> 'org_id')::uuid;
  v_location := pay_link_square_location((s ->> 'order_id')::uuid);   -- <<< 120

  return (s - 'org_id' - 'order_id' - 'claimed_until') || jsonb_build_object(
    'square',
    case
      when coalesce(v_cfg ->> 'application_id', '') = ''
        or v_location is null then null
      else jsonb_build_object(
        'environment', coalesce(v_cfg ->> 'environment', 'production'),
        'application_id', v_cfg ->> 'application_id',
        'location_id', v_location
      )
    end
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. CLAIM (anon) — 119's, with the location from the order
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
    'balance', s -> 'balance',
    'location_id', pay_link_square_location((s ->> 'order_id')::uuid)   -- <<< 120
  );
end;
$$;


notify pgrst, 'reload schema';
