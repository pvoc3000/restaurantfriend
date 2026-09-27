-- ============================================================================
-- 144 — WHO OWES US, READ FROM INVOICES (the textbook A/R model, phase 4)
-- ============================================================================
--
-- Mark, 2026-09-27: "Make Restaurant Friend use the textbook model." 140 put
-- money in a ledger, 141 gave invoices their own lines, 143 revisions and
-- credit. This is the reading side — what a customer owes, and the statement —
-- plus one rule phase 2 planned and 141 left out (section 5).
--
-- WHAT A CUSTOMER OWES, IN THREE PARTS, each worked out one way:
--
--   INVOICED — the open balance of every invoice on the account. On the
--     account means POSTED: not void, and sent, paid or holding money. A
--     draft is not a bill yet; but #1012 and #1013 were paid through their
--     links without ever being marked sent, and money on an invoice makes it
--     one, as it already freezes its lines (141).
--   NOT INVOICED — an order that counts as owed (`countsAsOwed`: a real
--     order, at Invoice or Order, not "ignore balance") owing more than its
--     posted invoices still ask of it: the difference. On 2026-09-27 that is
--     Cafe Knotted's seven days on draft #1014 ($5,248) and two orders of two
--     other customers — every dollar today's screens call outstanding, and
--     nothing else (checked customer by customer on a copy of the data).
--   CREDIT — a payment's amount less what has been applied from it (143).
--
-- THE STATEMENT is posted invoices and the money that reached the account:
-- each payment's applications to invoices, and whatever of it is applied to
-- nothing. Money HELD on an order is not on the account until an invoice for
-- that order is sent — it is earmarked, and every FileMaker payment is held,
-- so counting it would put $61,010 of Cafe Knotted's history against $5,288
-- of invoices. `customer_account_entries` is those rows; the arithmetic —
-- opening balance, running balance, aging — is `lib/customerStatement`, where
-- the fixtures can reach it.
--
-- Views are `security_invoker`, so RLS reads them as the caller. The
-- functions that need an order's total (`special_order_money`, 128, which is
-- definer and revoked) are definer too, and re-check the caller's org.
--
-- Run in the Supabase SQL editor after 143. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Each invoice's money — what the list pages used to sweep every line for
-- ----------------------------------------------------------------------------

create or replace view public.customer_invoice_totals
with (security_invoker = true) as
select i.id, i.org_id, i.customer_id, i.location_id, i.number, i.revision, i.revision_of,
       i.issued_on, i.due_on, i.sent_at, i.paid_at, i.voided_at, i.processor,
       coalesce(l.total, 0)::numeric(10,2) as total,
       coalesce(a.applied, 0)::numeric(10,2) as applied,
       (coalesce(l.total, 0) - coalesce(a.applied, 0))::numeric(10,2) as balance,
       coalesce(l.orders, 0)::int as order_count,
       -- On the account (see the header).
       (i.voided_at is null and (i.sent_at is not null or i.paid_at is not null or a.n > 0)) as posted
  from customer_invoices i
  left join lateral (
    select sum(x.amount) as total, count(distinct x.special_order_id) as orders
      from customer_invoice_lines x where x.invoice_id = i.id
  ) l on true
  left join lateral (
    select sum(y.amount) as applied, count(*) as n
      from payment_applications y where y.customer_invoice_id = i.id
  ) a on true;

revoke all on public.customer_invoice_totals from public, anon, authenticated;
grant select on public.customer_invoice_totals to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The money that reached a customer's account
-- ----------------------------------------------------------------------------
-- One row per payment per invoice it paid, and one per payment for whatever of
-- it is applied to nothing (its credit; a refund of credit is a negative row)
-- — unique on (payment_id, customer_invoice_id), the order a page sweeps it
-- in. Money held on an order is left out — see the header.

create or replace view public.customer_account_entries
with (security_invoker = true) as
select p.org_id, p.customer_id, p.id as payment_id, p.paid_on, p.payment_type, p.note,
       p.refund_of, p.created_at, a.customer_invoice_id, sum(a.amount)::numeric(10,2) as amount
  from customer_payments p
  join payment_applications a on a.payment_id = p.id
 where a.customer_invoice_id is not null
 group by p.org_id, p.customer_id, p.id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at,
          a.customer_invoice_id
union all
select p.org_id, p.customer_id, p.id, p.paid_on, p.payment_type, p.note,
       p.refund_of, p.created_at, null::uuid,
       (p.amount - coalesce(sum(a.amount), 0))::numeric(10,2)
  from customer_payments p
  left join payment_applications a on a.payment_id = p.id
 group by p.org_id, p.customer_id, p.id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at, p.amount
having p.amount - coalesce(sum(a.amount), 0) <> 0;

revoke all on public.customer_account_entries from public, anon, authenticated;
grant select on public.customer_account_entries to authenticated;

-- ----------------------------------------------------------------------------
-- 3. One order's receivable (internal)
-- ----------------------------------------------------------------------------
-- owed          what the order comes to less everything paid on it;
-- invoiced_open what its posted invoices still ask of it;
-- not_invoiced  the part of `owed` no posted invoice asks for.

create or replace function public.special_order_receivable(p_order uuid)
returns table (owed numeric, invoiced_open numeric, not_invoiced numeric)
language sql
stable
security definer
set search_path = public
as $$
  with m as (select total from special_order_money(p_order)),
       paid as (select coalesce(sum(amount), 0) as v from payment_applications where special_order_id = p_order),
       billed as (
         select coalesce(sum(l.amount), 0) as v
           from customer_invoice_lines l
           join customer_invoices i on i.id = l.invoice_id
          where l.special_order_id = p_order
            and i.voided_at is null
            and (i.sent_at is not null or i.paid_at is not null
                 or exists (select 1 from payment_applications z where z.customer_invoice_id = i.id))
       ),
       collected as (
         select coalesce(sum(a.amount), 0) as v
           from payment_applications a
           join customer_invoices i on i.id = a.customer_invoice_id
          where a.special_order_id = p_order
            and i.voided_at is null
            and (i.sent_at is not null or i.paid_at is not null
                 or exists (select 1 from payment_applications z where z.customer_invoice_id = i.id))
       )
  select (m.total - paid.v)::numeric(10,2),
         (billed.v - collected.v)::numeric(10,2),
         greatest(0, (m.total - paid.v) - greatest(0, billed.v - collected.v))::numeric(10,2)
    from m, paid, billed, collected;
$$;

revoke all on function public.special_order_receivable(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. What each customer owes — the customer list and the customer record
-- ----------------------------------------------------------------------------
-- Every customer of the org with something invoiced, not invoiced or in
-- credit; with `p_customer`, that one customer whatever it holds. The
-- order filter is `countsAsOwed` (lib/specialOrders), kept in step by hand.

create or replace function public.customer_balances(p_org uuid, p_customer uuid default null)
returns table (
  customer_id uuid,
  invoiced numeric,
  open_invoices int,
  not_invoiced numeric,
  uninvoiced_orders int,
  credit numeric
)
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
       and o.kind = 'order' and o.status in ('invoice', 'order') and not o.ignore_balance
       and (p_customer is null or o.customer_id = p_customer)
     group by o.customer_id
  ),
  cr as (
    select p.customer_id as cid,
           sum(p.amount - coalesce((select sum(y.amount) from payment_applications y where y.payment_id = p.id), 0)) as credit
      from customer_payments p
     where p.org_id = p_org
       and p.customer_id is not null
       and (p_customer is null or p.customer_id = p_customer)
     group by p.customer_id
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

-- The orders behind NOT INVOICED, for the customer record.
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
     and o.kind = 'order' and o.status in ('invoice', 'order') and not o.ignore_balance
     and r.not_invoiced > 0
   order by o.event_date nulls last, o.number;
end;
$$;

revoke all on function public.customer_uninvoiced_orders(uuid) from public, anon, authenticated;
grant execute on function public.customer_uninvoiced_orders(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Money taken on an order goes on the order's invoice
-- ----------------------------------------------------------------------------
-- The plan's phase-2 rule, which 141 did not carry out: `record_order_payment`
-- (the order's New Payment ▸ The order, a workflow's "paid in full", and the
-- list's Record Payment…) HELD everything on the order, even an order on a
-- sent invoice — the order read paid while its invoice went on asking for the
-- money. It now pays the order's share of its open posted invoices first,
-- oldest first, and holds only what is left. Its share of an invoice paid in
-- full settles the order, as an invoice payment does.
--
-- A QuickBooks invoice is paid in QuickBooks, whose webhook records it here;
-- money recorded by hand beside it would be counted twice, or leave
-- QuickBooks asking for it. So an order with a share open on one is refused,
-- by name. A negative amount (a hand-entered refund) stays on the order.

create or replace function public.record_order_money(
  p_order   uuid,
  p_amount  numeric,
  p_paid_on date,
  p_type    text,
  p_note    text,
  p_by      uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  g record;
  v_payment uuid;
  v_left numeric(10,2) := p_amount;
  v_share numeric(10,2);
  v_paid_on date;
  v_on_invoice boolean := false;
begin
  select id, org_id, customer_id, number into o from special_orders where id = p_order;
  if not found then
    raise exception 'order not found';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'a payment is not zero';
  end if;
  v_paid_on := coalesce(p_paid_on, org_today(o.org_id));

  insert into customer_payments (org_id, customer_id, paid_on, amount, payment_type, note, created_by)
  values (o.org_id, o.customer_id, v_paid_on, p_amount,
          nullif(btrim(coalesce(p_type, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), p_by)
  returning id into v_payment;

  if p_amount > 0 then
    for g in
      select i.id, i.processor,
             (select coalesce(sum(l.amount), 0) from customer_invoice_lines l
               where l.invoice_id = i.id and l.special_order_id = p_order)
             - (select coalesce(sum(a.amount), 0) from payment_applications a
                 where a.customer_invoice_id = i.id and a.special_order_id = p_order) as open
        from customer_invoices i
       where i.voided_at is null
         and exists (select 1 from customer_invoice_lines l where l.invoice_id = i.id and l.special_order_id = p_order)
         and (i.sent_at is not null or i.paid_at is not null
              or exists (select 1 from payment_applications z where z.customer_invoice_id = i.id))
       order by i.issued_on, i.number, i.revision
    loop
      exit when v_left <= 0;
      continue when g.open <= 0;
      if g.processor = 'quickbooks' then
        raise exception 'Order #% is on invoice %, which QuickBooks collects — record this payment in QuickBooks',
          o.number, customer_invoice_label(g.id);
      end if;
      v_share := least(v_left, g.open);
      insert into payment_applications (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
      values (o.org_id, v_payment, p_order, g.id, v_share, p_by);
      v_left := v_left - v_share;
      v_on_invoice := true;
    end loop;
  end if;

  if v_left <> 0 then
    insert into payment_applications (org_id, payment_id, special_order_id, amount, created_by)
    values (o.org_id, v_payment, p_order, v_left, p_by);
  end if;

  if v_on_invoice
     and (select m.total from special_order_money(p_order) m) - special_order_paid(p_order) <= 0 then
    perform settle_special_order_paid(p_order, v_paid_on);
  end if;
  return v_payment;
end;
$$;

revoke all on function public.record_order_money(uuid, numeric, date, text, text, uuid)
  from public, anon, authenticated;

create or replace function public.record_order_payment(
  p_order   uuid,
  p_amount  numeric,
  p_paid_on date default null,
  p_type    text default null,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from special_orders where id = p_order;
  if v_org is null or not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'order not found';
  end if;
  return record_order_money(p_order, p_amount, p_paid_on, p_type, p_note, auth.uid());
end;
$$;

create or replace function public.record_order_payments(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  x jsonb;
  v_org uuid;
  v_n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select org_id into v_org from special_orders where id = (x ->> 'order_id')::uuid;
    if v_org is null or not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
      raise exception 'order not found: %', x ->> 'order_id';
    end if;
    perform record_order_money(
      (x ->> 'order_id')::uuid,
      (x ->> 'amount')::numeric,
      nullif(x ->> 'paid_on', '')::date,
      x ->> 'payment_type',
      x ->> 'note',
      auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.record_order_payment(uuid, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.record_order_payments(jsonb) from public, anon, authenticated;
grant execute on function public.record_order_payment(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.record_order_payments(jsonb) to authenticated;

-- 140's held-only version; nothing else calls it.
drop function if exists public.record_held_payment(uuid, numeric, date, text, text, uuid);

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select number, total, applied, balance, posted from customer_invoice_totals order by number;
--     → 1014 5288.00 / 0.00 / 5288.00 / false (a draft); 1012 and 1013 posted
--   select count(*) from payment_applications a join customer_invoices i on i.id = a.customer_invoice_id
--    where i.voided_at is not null;   → 0
-- ============================================================================
