-- ============================================================================
-- 223 — A STANDING ORDER'S DAYS CAN START AT QUOTE, AND STILL COUNT AS OWED
--
-- Mark, 2026-11-05: "I need a status option to precede Invoice for standing
-- orders when they are instantiated. When the order is created, it hasn't
-- been invoiced yet." Then: "Make the new status 'Quote', but also make sure
-- that even though the status is Quote they are also included in the 'not
-- invoiced' balance."
--
-- Quote needs nothing here: 112's constraint only says a standing order HAS a
-- status, and the app's picker (`STANDING_STATUS_OPTIONS`) now offers it.
-- Sending the invoice already moves a quote to Invoice (141/143/145).
--
-- WHAT CHANGES: who owes us. Until now an order was owed only at Invoice or
-- Order, because a lead or a quote is a price OFFERED. A standing-order day at
-- Quote is not an offer — the arrangement was agreed when the standing order
-- was set up — so it is owed from the day it is made:
--
--     status in ('invoice','order')
--     or (status = 'quote' and standing_order_id is not null)
--
-- The same test is `countsAsOwed` in web/src/lib/specialOrders.ts; the two
-- must agree. Both functions are restated IN FULL from their last definitions
-- (customer_balances: 218; customer_uninvoiced_orders: 144); the only change
-- in each is the line marked <<< 223.
--
-- Run after 222. Wrap in begin/commit. RERUNNABLE.
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

create or replace function public.customer_balances(p_org uuid, p_customer uuid default null)
returns table (customer_id uuid, invoiced numeric, open_invoices integer, not_invoiced numeric,
               uninvoiced_orders integer, credit numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_org is null or p_org not in (select user_org_ids()) then
    return;
  end if;
  return query
  with inv as (
    select i.customer_id as cid,
           sum(greatest(t.balance, 0)) as invoiced,
           count(*) filter (where t.balance > 0.005)::int as open_invoices
      from customer_invoices i
      cross join lateral (
        select coalesce((select sum(x.amount) from customer_invoice_lines x where x.invoice_id = i.id), 0)
             - coalesce((select sum(y.amount) from payment_applications y where y.customer_invoice_id = i.id), 0) as balance
      ) t
     where i.org_id = p_org
       and i.voided_at is null
            and (i.sent_at is not null or i.paid_at is not null
                 or exists (select 1 from payment_applications z where z.customer_invoice_id = i.id))
       and (p_customer is null or i.customer_id = p_customer)
     group by i.customer_id
  ),
  ord as (
    select o.customer_id as cid,
           sum(r.not_invoiced) as not_invoiced,
           count(*) filter (where r.not_invoiced > 0)::int as orders
      from special_orders o
      cross join lateral special_order_receivable(o.id) r
     where o.org_id = p_org
       and o.customer_id is not null
       and o.kind = 'order' and not o.ignore_balance
       and (o.status in ('invoice', 'order')
            or (o.status = 'quote' and o.standing_order_id is not null))   -- <<< 223
       and (p_customer is null or o.customer_id = p_customer)
     group by o.customer_id
  ),
  cr as (
    select x.cid, sum(x.credit) as credit from (
      select p.customer_id as cid,
             p.amount - coalesce((select sum(y.amount) from payment_applications y where y.payment_id = p.id), 0) as credit
        from customer_payments p
       where p.org_id = p_org
         and p.customer_id is not null
         and (p_customer is null or p.customer_id = p_customer)
      union all                                                              -- <<< 218
      select m.customer_id, credit_memo_unapplied(m.id)
        from customer_credit_memos m
       where m.org_id = p_org and m.voided_at is null and m.settlement = 'credit'
         and (p_customer is null or m.customer_id = p_customer)
    ) x
     group by x.cid
  )
  select c.id,
         coalesce(inv.invoiced, 0)::numeric(10,2),
         coalesce(inv.open_invoices, 0),
         coalesce(ord.not_invoiced, 0)::numeric(10,2),
         coalesce(ord.orders, 0),
         greatest(coalesce(cr.credit, 0), 0)::numeric(10,2)
    from customers c
    left join inv on inv.cid = c.id
    left join ord on ord.cid = c.id
    left join cr on cr.cid = c.id
   where c.org_id = p_org
     and (p_customer is null or c.id = p_customer)
     and (p_customer is not null
          or coalesce(inv.invoiced, 0) > 0
          or coalesce(ord.not_invoiced, 0) > 0
          or coalesce(cr.credit, 0) > 0.005)
   order by c.id;
end;
$$;

revoke all on function public.customer_balances(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_balances(uuid, uuid) to authenticated;

create or replace function public.customer_uninvoiced_orders(p_customer uuid)
returns table (
  id uuid,
  number text,
  title text,
  event_date date,
  status text,
  total numeric,
  paid numeric,
  invoiced_open numeric,
  not_invoiced numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org from customers c where c.id = p_customer;
  if v_org is null or v_org not in (select user_org_ids()) then
    return;
  end if;
  return query
  select o.id, o.number, o.title, o.event_date, o.status,
         m.total, (m.total - r.owed)::numeric(10,2), r.invoiced_open, r.not_invoiced
    from special_orders o
    cross join lateral special_order_money(o.id) m
    cross join lateral special_order_receivable(o.id) r
   where o.org_id = v_org
     and o.customer_id = p_customer
     and o.kind = 'order' and not o.ignore_balance
     and (o.status in ('invoice', 'order')
          or (o.status = 'quote' and o.standing_order_id is not null))   -- <<< 223
     and r.not_invoiced > 0
   order by o.event_date nulls last, o.number;
end;
$$;

revoke all on function public.customer_uninvoiced_orders(uuid) from public, anon, authenticated;
grant execute on function public.customer_uninvoiced_orders(uuid) to authenticated;
