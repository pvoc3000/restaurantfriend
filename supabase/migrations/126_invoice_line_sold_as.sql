-- ============================================================================
-- 126 — EACH INVOICE LINE SAYS WHICH SQUARE ITEM IT IS SOLD AS
-- ============================================================================
--
-- Mark, 2026-09-23, the day 125 went in: "since we can select the wholesale or
-- special order item with a picklist now, why don't we allow the user to
-- set/change it on the invoice. It could be a column in the orders section."
--
-- 125 decided it by RULE (every order a standing-order day → Wholesale). Now
-- the rule only proposes: `customer_invoice_lines.square_item` is written at
-- creation by the same rule and a person can change it, line by line.
--
-- A KIND, NOT A SQUARE ID. 'special_order' or 'wholesale', resolved to a
-- variation at pay time from `orgs.settings.square_payments` — so a line means
-- the same thing in sandbox and production, whose catalogs have different ids,
-- and changing the item in Settings moves every unpaid invoice with it.
--
-- EDITABLE ON A SENT INVOICE, UNTIL IT IS PAID OR VOID. 124 froze a sent
-- invoice's lines because the customer holds its figures; which Square
-- category the money is filed under is not on their paper, so this one column
-- is let through the freeze. Once paid, the Square order exists and the choice
-- is history.
--
-- AT PAY TIME the Square order gets lines PER ITEM (`_shared/squareOrder`), so
-- a mixed invoice files Knotted's days under Wholesale and a birthday order
-- under Special Orders in one payment. `claim_pay_token` hands the edge
-- function each line's variation; the per-line money is the pay token's
-- breakdown, which the web now snapshots per line.
--
-- Run in the Supabase SQL editor after 125. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The column, backfilled by 125's rule
-- ----------------------------------------------------------------------------

alter table customer_invoice_lines
  add column if not exists square_item text;

-- The freeze would refuse the backfill on a sent invoice; the backfill is the
-- rule 125 already applied at pay time, so it changes nothing that was true.
alter table customer_invoice_lines disable trigger trg_customer_invoice_lines_frozen;
update customer_invoice_lines l
   set square_item = case when o.standing_order_id is not null then 'wholesale' else 'special_order' end
  from special_orders o
 where o.id = l.special_order_id and l.square_item is null;
alter table customer_invoice_lines enable trigger trg_customer_invoice_lines_frozen;

alter table customer_invoice_lines alter column square_item set default 'special_order';
alter table customer_invoice_lines alter column square_item set not null;
alter table customer_invoice_lines drop constraint if exists customer_invoice_lines_square_item_check;
alter table customer_invoice_lines add constraint customer_invoice_lines_square_item_check
  check (square_item in ('special_order', 'wholesale'));

-- ----------------------------------------------------------------------------
-- 2. The freeze lets `square_item` through until the invoice is paid or void
-- ----------------------------------------------------------------------------

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select sent_at, paid_at, voided_at into inv from customer_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if inv.sent_at is null then
    return coalesce(new, old);
  end if;
  -- 126: only the Square item changed, on an invoice still collecting.
  if tg_op = 'UPDATE'
     and inv.paid_at is null and inv.voided_at is null
     and (new.invoice_id, new.special_order_id, new.description, new.amount, new.sort)
         is not distinct from
         (old.invoice_id, old.special_order_id, old.description, old.amount, old.sort) then
    return new;
  end if;
  raise exception 'invoice already sent — void it and invoice again';
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Creation writes the rule's answer (or the caller's), per line
-- ----------------------------------------------------------------------------

create or replace function public.create_customer_invoice(
  p_org_id    uuid,
  p_lines     jsonb,
  p_issued_on date,
  p_due_on    date,
  p_notes     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_customers int;
  v_customer uuid;
  v_locations int;
  v_taken text;
  v_bad text;
  v_number int;
  v_id uuid;
begin
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to create an invoice';
  end if;

  select array_agg((x ->> 'order_id')::uuid) into v_ids
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'an invoice needs at least one order';
  end if;
  if (select count(distinct u) from unnest(v_ids) u) <> array_length(v_ids, 1) then
    raise exception 'an order appears twice';
  end if;

  select string_agg(coalesce(o.number, u::text), ', ') into v_bad
    from unnest(v_ids) u
    left join special_orders o on o.id = u and o.org_id = p_org_id
   where o.id is null or o.kind <> 'order' or o.status = 'cancelled';
  if v_bad is not null then
    raise exception 'not an order that can be invoiced: %', v_bad;
  end if;

  select count(distinct customer_id), min(customer_id::text)::uuid
    into v_customers, v_customer
    from special_orders where id = any (v_ids);
  if v_customer is null or v_customers <> 1
     or exists (select 1 from special_orders where id = any (v_ids) and customer_id is null) then
    raise exception 'an invoice is for one customer';
  end if;

  select count(distinct coalesce(pay_link_square_location(u), '')) into v_locations
    from unnest(v_ids) u;
  if v_locations <> 1 then
    raise exception 'these orders are made at different shops, so one payment cannot cover them';
  end if;

  select string_agg(distinct o.number, ', ') into v_taken
    from customer_invoice_lines l
    join customer_invoices i on i.id = l.invoice_id
    join special_orders o on o.id = l.special_order_id
   where l.special_order_id = any (v_ids) and i.voided_at is null;
  if v_taken is not null then
    raise exception 'already on an invoice: %', v_taken;
  end if;

  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || p_org_id::text));
  select coalesce(max(number), 1000) + 1 into v_number
    from customer_invoices where org_id = p_org_id;

  insert into customer_invoices
    (org_id, customer_id, number, issued_on, due_on, notes, created_by)
  values
    (p_org_id, v_customer, v_number, coalesce(p_issued_on, org_today(p_org_id)),
     p_due_on, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;

  insert into customer_invoice_lines
    (org_id, invoice_id, special_order_id, description, amount, sort, square_item)
  select p_org_id, v_id, (x ->> 'order_id')::uuid, coalesce(x ->> 'description', ''),
         coalesce((x ->> 'amount')::numeric, 0), (n - 1)::int,
         -- 126: the caller's choice, else 125's rule.
         case
           when x ->> 'square_item' in ('special_order', 'wholesale') then x ->> 'square_item'
           when o.standing_order_id is not null then 'wholesale'
           else 'special_order'
         end
    from jsonb_array_elements(p_lines) with ordinality as t(x, n)
    join special_orders o on o.id = (x ->> 'order_id')::uuid;

  perform log_special_order_event(p_org_id, u, 'Added to invoice ' || v_number)
     from unnest(v_ids) u;

  return v_id;
end;
$$;

revoke all on function public.create_customer_invoice(uuid, jsonb, date, date, text) from public, anon, authenticated;
grant execute on function public.create_customer_invoice(uuid, jsonb, date, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. A kind, resolved to this environment's variation
-- ----------------------------------------------------------------------------

create or replace function public.pay_link_item_variation(p_org uuid, p_item text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_item = 'wholesale'
             then coalesce(
                    nullif(btrim(c ->> case when sandbox then 'sandbox_wholesale_item_variation_id'
                                            else 'wholesale_item_variation_id' end), ''),
                    nullif(btrim(c ->> case when sandbox then 'sandbox_item_variation_id'
                                            else 'item_variation_id' end), ''))
           else nullif(btrim(c ->> case when sandbox then 'sandbox_item_variation_id'
                                        else 'item_variation_id' end), '')
         end
    from (select settings -> 'square_payments' as c,
                 coalesce(settings -> 'square_payments' ->> 'environment', '') = 'sandbox' as sandbox
            from orgs where id = p_org) s;
$$;

revoke all on function public.pay_link_item_variation(uuid, text) from public, anon, authenticated;

-- 125's helper, taught the column: an invoice token's single variation (the
-- fallback when per-line money is missing) is Wholesale only when every line
-- says so. The per-order branch is 125's rule unchanged.
create or replace function public.pay_link_token_variation(p_state jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := (p_state ->> 'org_id')::uuid;
  v_wholesale boolean;
begin
  if p_state ->> 'customer_invoice_id' is not null then
    select bool_and(l.square_item = 'wholesale') into v_wholesale                -- <<< 126
      from customer_invoice_lines l
     where l.invoice_id = (p_state ->> 'customer_invoice_id')::uuid;
  else
    select standing_order_id is not null into v_wholesale
      from special_orders where id = (p_state ->> 'order_id')::uuid;
  end if;
  return pay_link_item_variation(
    v_org, case when coalesce(v_wholesale, false) then 'wholesale' else 'special_order' end);
end;
$$;

revoke all on function public.pay_link_token_variation(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The claim hands over each line's variation
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
    'customer_invoice_id', s -> 'customer_invoice_id',
    'kind', case when s ->> 'customer_invoice_id' is not null
                 then 'customer_invoice' else 'order' end,
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',
    'balance', s -> 'balance',
    'location_id', pay_link_token_location(s),
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_token_variation(s),
    'items', (select jsonb_agg(jsonb_build_object(                             -- <<< 126
                       'line_id', l.id,
                       'variation_id', pay_link_item_variation((s ->> 'org_id')::uuid, l.square_item))
                     order by l.sort nulls last, l.created_at)
                from customer_invoice_lines l
               where l.invoice_id = (s ->> 'customer_invoice_id')::uuid)
  );
end;
$$;

revoke all on function public.claim_pay_token(text) from public, anon, authenticated;
grant execute on function public.claim_pay_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
