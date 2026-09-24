-- ============================================================================
-- 129 — "SOLD AS" LIVES ON THE ORDER, SO A ONE-OFF CAN BE WHOLESALE
-- ============================================================================
--
-- Mark, 2026-09-23: "I feel like we need to be able to create a one-off
-- wholesale order. Like I want to do that now to test the invoicing."
--
-- 125 decided wholesale by ORIGIN (made by a standing order) and 126 let an
-- invoice line override it. Neither could say it of an order typed by hand for
-- a wholesale customer, and the order's own pay link could not be told at all.
-- So the fact moves to the order: `special_orders.square_item`, the same
-- 'special_order' | 'wholesale' vocabulary as the invoice line.
--
--   · BACKFILLED BY 125's RULE: standing orders and the days they made are
--     wholesale, everything else special_order.
--   · A DAY A STANDING ORDER MAKES TAKES ITS STANDING ORDER'S VALUE — a BEFORE
--     INSERT trigger, so the materializer (112) needs no edit. A hand-made
--     order starts as special_order; Duplicate copies it (114 copies every
--     column).
--   · THE INVOICE LINE FOLLOWS IT, 128's rule: the sync writes the order's
--     value onto every line of an UNPAID, non-void invoice, and a line can no
--     longer be set by hand — the invoice's Sold as column edits the ORDER.
--   · THE ORDER'S OWN PAY LINK sells as the order's value (was 125's origin
--     rule).
--
-- Run in the Supabase SQL editor after 128. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The column, backfilled by 125's rule
-- ----------------------------------------------------------------------------

alter table special_orders add column if not exists square_item text;

update special_orders
   set square_item = case
                       when kind = 'standing_order' or standing_order_id is not null then 'wholesale'
                       else 'special_order'
                     end
 where square_item is null;

alter table special_orders alter column square_item set default 'special_order';
alter table special_orders alter column square_item set not null;
alter table special_orders drop constraint if exists special_orders_square_item_check;
alter table special_orders add constraint special_orders_square_item_check
  check (square_item in ('special_order', 'wholesale'));

-- ----------------------------------------------------------------------------
-- 2. A day takes its standing order's value
-- ----------------------------------------------------------------------------

create or replace function public.trg_special_order_takes_standing_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.standing_order_id is not null then
    select coalesce(s.square_item, new.square_item) into new.square_item
      from special_orders s where s.id = new.standing_order_id;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_special_order_takes_standing_item() from public, anon, authenticated;

drop trigger if exists trg_special_order_takes_standing_item on special_orders;
create trigger trg_special_order_takes_standing_item
  before insert on special_orders
  for each row execute function trg_special_order_takes_standing_item();

-- ----------------------------------------------------------------------------
-- 3. Invoice lines follow it (128's trigger and sync, taught the column)
-- ----------------------------------------------------------------------------

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_sync boolean := coalesce(current_setting('rf.invoice_line_sync', true), '') = 'on';
begin
  select sent_at, paid_at, voided_at into inv from customer_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);

  if tg_op = 'INSERT' then
    if inv.sent_at is not null then
      raise exception 'invoice already sent — void it and invoice again';
    end if;
    -- 128: the amount and the wording are the ORDER's, whatever was passed.
    select case when o.status = 'cancelled' then 0
                else m.total - coalesce((select sum(p.amount) from special_order_payments p
                                          where p.order_id = o.id
                                            and p.customer_invoice_id is distinct from new.invoice_id), 0)
           end,
           invoice_line_description(o.id),
           o.square_item                                                   -- <<< 129
      into new.amount, new.description, new.square_item
      from special_orders o, special_order_money(o.id) m
     where o.id = new.special_order_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- A cascade from the invoice's own delete finds no invoice row: allowed.
    if inv.sent_at is not null then
      raise exception 'invoice already sent — void it instead';
    end if;
    return old;
  end if;

  -- UPDATE
  if v_sync then
    return new;
  end if;
  -- 129: Sold as lives on the ORDER now, so it joins the columns only the
  -- sync may write.
  if (new.invoice_id, new.special_order_id, new.description, new.amount, new.sent_amount, new.sort, new.square_item)
     is distinct from
     (old.invoice_id, old.special_order_id, old.description, old.amount, old.sent_amount, old.sort, old.square_item) then
    raise exception 'an invoice line follows its order — change the order instead';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;

create or replace function public.sync_customer_invoice_lines(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  v_amount numeric(10,2);
  v_desc text;
  v_item text;
  v_changed boolean := false;
begin
  if not exists (select 1 from customer_invoice_lines where special_order_id = p_order) then
    return;
  end if;

  perform set_config('rf.invoice_line_sync', 'on', true);

  for l in
    select li.*, i.sent_at, i.paid_at
      from customer_invoice_lines li
      join customer_invoices i on i.id = li.invoice_id
     where li.special_order_id = p_order and i.voided_at is null
  loop
    select case when o.status = 'cancelled' then 0
                else m.total - coalesce((select sum(p.amount) from special_order_payments p
                                          where p.order_id = o.id
                                            and p.customer_invoice_id is distinct from l.invoice_id), 0)
           end,
           invoice_line_description(o.id)
      into v_amount, v_desc
      from special_orders o, special_order_money(o.id) m
     where o.id = p_order;

    -- 129: what it is sold as follows the order until the invoice is paid —
    -- once paid, the Square order exists and the line is history.
    select case when l.paid_at is null then o.square_item else l.square_item end
      into v_item from special_orders o where o.id = p_order;

    if v_item is distinct from l.square_item then
      update customer_invoice_lines set square_item = v_item where id = l.id;
    end if;

    if v_amount is distinct from l.amount or v_desc is distinct from l.description then
      update customer_invoice_lines set amount = v_amount, description = v_desc where id = l.id;
      if l.sent_at is not null and v_amount is distinct from l.sent_amount then
        v_changed := true;
      end if;
    end if;
    perform refresh_customer_invoice_paid(l.invoice_id);
  end loop;

  perform set_config('rf.invoice_line_sync', 'off', true);

  if v_changed then
    update special_orders
       set todo = 'Send Invoice'
     where id = p_order and (todo is null or btrim(todo) = '');
  end if;
end;
$$;

revoke all on function public.sync_customer_invoice_lines(uuid) from public, anon, authenticated;

drop trigger if exists trg_special_orders_invoice on special_orders;
create trigger trg_special_orders_invoice
  after update of tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate,
                  status, title, event_date, number, customer_id, square_item
  on special_orders
  for each row execute function trg_invoice_follows_order();

-- ----------------------------------------------------------------------------
-- 4. The order's own pay link sells as the order says
-- ----------------------------------------------------------------------------

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
    select bool_and(l.square_item = 'wholesale') into v_wholesale
      from customer_invoice_lines l
     where l.invoice_id = (p_state ->> 'customer_invoice_id')::uuid;
  else
    select square_item = 'wholesale' into v_wholesale                            -- <<< 129
      from special_orders where id = (p_state ->> 'order_id')::uuid;
  end if;
  return pay_link_item_variation(
    v_org, case when coalesce(v_wholesale, false) then 'wholesale' else 'special_order' end);
end;
$$;

revoke all on function public.pay_link_token_variation(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Lines already on unpaid invoices take their order's value
-- ----------------------------------------------------------------------------

select sync_customer_invoice_lines(o) from (
  select distinct l.special_order_id as o
    from customer_invoice_lines l join customer_invoices i on i.id = l.invoice_id
   where i.voided_at is null
) x;

notify pgrst, 'reload schema';
