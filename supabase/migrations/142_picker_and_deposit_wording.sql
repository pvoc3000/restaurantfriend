-- ============================================================================
-- 142 — ADD ORDERS… OFFERS WHAT IS STILL OWED; OLD DEPOSIT LINES SAY ONLY WHAT
--       THEY ARE
-- ============================================================================
--
-- Two things 141's first day on the real data showed (2026-09-27):
--
-- 1. THE PICKER LISTED 48 KNOTTED DAYS FROM AUGUST. They are "unbilled" in the
--    141 sense — no line on any invoice here — because they were billed by hand
--    in Square before this app invoiced anything, and every one is PAID IN FULL
--    (the 'Square Invoice' and FileMaker payments held on them). An order that
--    is paid needs no invoice. `customer_unbilled_orders` now offers only
--    orders with something left to bill AND something still owed.
--
-- 2. A DEPOSIT LINE WRITTEN BY 139 CARRIES ITS ORDER IN ITS WORDING —
--    "Part payment · Order #10055 · Birthday · 9/25/2026" — and since 141 the
--    order is the band above it, so the paper and the pay page said the order
--    twice. Those lines (on 1012 and 1013, both paid) now say "Deposit" or
--    "Part payment", as 141's own deposit lines do. Wording only: no amount
--    moves, which is checked.
--
-- (The textbook plan's later phases move up one: Revise and credit is 143.)
--
-- Run in the Supabase SQL editor after 141. RERUNNABLE.
-- ============================================================================

create or replace function public.customer_unbilled_orders(p_customer uuid, p_location uuid)
returns table (
  id uuid,
  number text,
  title text,
  event_date date,
  status text,
  total numeric,
  billed numeric,
  unbilled numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from customers where customers.id = p_customer;
  if v_org is null or not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    return;
  end if;
  return query
  select o.id, o.number, o.title, o.event_date, o.status,
         m.total, special_order_billed(o.id, null), special_order_unbilled(o.id, null)
    from special_orders o
    cross join lateral special_order_money(o.id) m
   where o.org_id = v_org
     and o.customer_id = p_customer
     and o.kind = 'order'
     and o.status <> 'cancelled'
     and not o.ignore_balance
     and special_order_collecting_location(o.id) is not distinct from p_location
     and special_order_unbilled(o.id, null) > 0
     and m.total - special_order_paid(o.id) > 0                          -- <<< 142
   order by o.event_date nulls last, o.number;
end;
$$;

revoke all on function public.customer_unbilled_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_unbilled_orders(uuid, uuid) to authenticated;

do $$
declare
  v_before numeric;
  v_after numeric;
begin
  select coalesce(sum(amount), 0) into v_before from customer_invoice_lines;
  perform set_config('rf.invoice_line_write', 'on', true);
  update customer_invoice_lines
     set description = case when kind = 'other' then 'Part payment' else 'Deposit' end
   where line_type = 'deposit'
     and description is distinct from case when kind = 'other' then 'Part payment' else 'Deposit' end;
  perform set_config('rf.invoice_line_write', 'off', true);
  select coalesce(sum(amount), 0) into v_after from customer_invoice_lines;
  if v_after <> v_before then
    raise exception '142: rewording deposit lines moved money (% → %)', v_before, v_after;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select description from customer_invoice_lines where line_type = 'deposit';
--     → 'Deposit' / 'Part payment'
-- ============================================================================
