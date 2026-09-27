-- ============================================================================
-- 141 — AN INVOICE OWNS ITS LINES: copied from its orders, free of them, and
--       frozen once it goes out
-- ============================================================================
--
-- Mark, 2026-09-27: "invoices and orders should be related, but separate
-- things … I would like to be able to create invoices that don't require an
-- order. I would like to be able to create an invoice and then decide to add
-- an order to it. Or a bunch of orders. When that invoice is paid, I would like
-- payments applied to any attached orders." The second of five migrations; 140
-- built the payments ledger this one bills against.
--
-- WHAT CHANGES:
--
-- 1. A LINE IS THE INVOICE'S OWN. Adding an order COPIES its charges —
--    each item (qty × price), then its discount, delivery, rush fee and tax,
--    exactly as `special_order_money` works them out, and "Less invoice 1015"
--    for anything its other live invoices already bill. The copy is the
--    invoice's; the order is where it came from. Any rounding penny between
--    the items and the order's subtotal goes on the largest item, so a group
--    always nets to exactly what the order owes.
--
-- 2. A LINE NEED NOT BE AN ORDER'S. `special_order_id` is nullable: a free line
--    — "Delivery Fee", an item — belongs to the invoice alone, is untaxed (v1),
--    and is paid by an application naming the invoice and no order (140).
--
-- 3. A SENT INVOICE IS FROZEN, and so is any invoice money has been applied
--    to (two of the live drafts were paid before they were sent). The
--    follow-the-order machinery of 128/139 goes: an order that changes after
--    its invoice went out is billed the difference on a new invoice, or the
--    invoice is revised (142). A draft whose order changed says so, and Send
--    refuses it until it is updated.
--
-- 4. THE HEADER OWNS ITS CUSTOMER AND ITS SHOP. `location_id` — the shop whose
--    Square location collects (120's rule, now a column) — and `customer_id`
--    are required, so an invoice can exist with no orders and orders are
--    checked against IT when they are added.
--
-- 5. MONEY HELD ON AN ORDER APPLIES WHEN ITS INVOICE IS SENT. Cash taken
--    before an order is billed no longer shrinks what is left to bill; it is a
--    payment, held, and `mark_customer_invoice_sent` applies it to the order's
--    share of the invoice. The paper shows it as a payment.
--
-- 6. SEND CHECKS FIRST. `customer_invoice_send_problems` says what stops an
--    invoice going out — a changed order, an empty invoice, a QuickBooks
--    invoice with lines QuickBooks cannot show — and the edge function asks it
--    BEFORE mailing, since `mark_customer_invoice_sent` runs after the email
--    has gone and must never refuse.
--
-- THE 13 INVOICES THAT EXIST: sent, paid and void ones keep their lines as
-- they are, typed `order_total` (or `deposit`) — frozen history. The one live
-- DRAFT, Knotted's #1014, is re-copied itemized; each of its seven days nets to
-- exactly what its line says today plus any money held on it (none on
-- Knotted's) — checked below, or the file rolls back.
--
-- Run in the Supabase SQL editor after 140. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------

alter table customer_invoice_lines alter column special_order_id drop not null;

alter table customer_invoice_lines add column if not exists line_type text;
alter table customer_invoice_lines add column if not exists qty numeric(10,2);
alter table customer_invoice_lines add column if not exists unit_price numeric(10,2);
alter table customer_invoice_lines add column if not exists taxable boolean not null default false;
alter table customer_invoice_lines add column if not exists tax_rate numeric(6,5);
-- "Order #10057 · Cafe Knotted SO (M-Th) · 10/5/2026", frozen when copied, so
-- the paper cannot drift if the order is renamed.
alter table customer_invoice_lines add column if not exists order_label text;
alter table customer_invoice_lines add column if not exists special_order_item_id uuid
  references special_order_items(id) on delete set null;

update customer_invoice_lines
   set line_type = case when kind in ('deposit', 'other') then 'deposit' else 'order_total' end
 where line_type is null;
update customer_invoice_lines
   set order_label = invoice_line_description(special_order_id)
 where order_label is null and special_order_id is not null;

alter table customer_invoice_lines alter column line_type set not null;
alter table customer_invoice_lines alter column line_type set default 'item';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_invoice_lines_line_type_check') then
    alter table customer_invoice_lines add constraint customer_invoice_lines_line_type_check
      check (line_type in ('item', 'discount', 'delivery', 'rush', 'tax',
                           'deposit', 'prior_billing', 'order_total'));
  end if;
  -- A FREE line (no order) is an item or a delivery charge, and nothing else:
  -- the other types are an order's arithmetic.
  if not exists (select 1 from pg_constraint where conname = 'customer_invoice_lines_free_line_check') then
    alter table customer_invoice_lines add constraint customer_invoice_lines_free_line_check
      check (special_order_id is not null or line_type in ('item', 'delivery'));
  end if;
end $$;

comment on column customer_invoice_lines.line_type is
  'item / discount / delivery / rush / tax: an order''s charges, copied (141). '
  'prior_billing: "Less invoice N" — what the order''s other live invoices bill. '
  'deposit: a fixed amount asked for with New Invoice (139). '
  'order_total: one line for a whole order, the shape of invoices sent before 141.';

-- THE SHOP. 120's rule as a column: the kitchen, where it has a Square
-- location, else the pickup shop, else whichever is set.
create or replace function public.special_order_collecting_location(p_order uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
           when nullif(btrim(k.square_location_id), '') is not null then k.id
           when nullif(btrim(p.square_location_id), '') is not null then p.id
           else coalesce(k.id, p.id)
         end
    from special_orders o
    left join locations k on k.id = o.kitchen_location_id
    left join locations p on p.id = o.location_id
   where o.id = p_order;
$$;

revoke all on function public.special_order_collecting_location(uuid) from public, anon, authenticated;

alter table customer_invoices add column if not exists location_id uuid references locations(id);

update customer_invoices i
   set location_id = (select special_order_collecting_location(l.special_order_id)
                        from customer_invoice_lines l
                       where l.invoice_id = i.id and l.special_order_id is not null
                       order by l.sort nulls last, l.created_at
                       limit 1)
 where i.location_id is null;

do $$
declare
  v_bad text;
begin
  -- Required, except on a void invoice: two voided ones bill an order that has
  -- no shop at all, and a void invoice collects nothing.
  select string_agg(number::text, ', ') into v_bad
    from customer_invoices where location_id is null and voided_at is null;
  if v_bad is not null then
    raise exception '141: live invoices with no shop to collect at: % — set a kitchen or pickup shop on their orders first', v_bad;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_invoices_location_unless_void') then
    alter table customer_invoices add constraint customer_invoices_location_unless_void
      check (location_id is not null or voided_at is not null);
  end if;
end $$;

-- An invoice is addressed to someone. Every one of the 13 has a customer; from
-- here on the customer cannot be deleted out from under one.
alter table customer_invoices alter column customer_id set not null;
alter table customer_invoices drop constraint if exists customer_invoices_customer_id_fkey;
alter table customer_invoices add constraint customer_invoices_customer_id_fkey
  foreign key (customer_id) references customers(id) on delete restrict;


-- ----------------------------------------------------------------------------
-- 2. The follow-the-order machinery goes
-- ----------------------------------------------------------------------------
-- 128/139's triggers re-derived a line on every change to its order. A line is
-- now a copy; a draft is updated by hand, a sent one never.

drop trigger if exists trg_special_order_items_invoice on special_order_items;
drop trigger if exists trg_special_orders_invoice on special_orders;
drop trigger if exists trg_invoice_lines_move_the_balance on customer_invoice_lines;
drop trigger if exists trg_invoice_void_moves_the_balance on customer_invoices;
drop function if exists public.trg_invoice_follows_items();
drop function if exists public.trg_invoice_follows_order();
drop function if exists public.trg_invoice_lines_move_the_balance();
drop function if exists public.sync_customer_invoice_lines(uuid);

-- 140's payments trigger, without the sync: money on an invoice moves only
-- whether the invoice is paid (a refund reopens it).
create or replace function public.trg_invoice_follows_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.customer_invoice_id is not null then
    perform refresh_customer_invoice_paid(old.customer_invoice_id);
  end if;
  if tg_op <> 'DELETE' and new.customer_invoice_id is not null then
    perform refresh_customer_invoice_paid(new.customer_invoice_id);
  end if;
  return null;
end;
$$;

revoke all on function public.trg_invoice_follows_payments() from public, anon, authenticated;

-- 129's one survivor: what an order is SOLD AS follows to its lines until the
-- invoice is paid or void — it is not on the customer's paper, and once paid
-- the Square order exists and the line is history.
create or replace function public.trg_invoice_lines_follow_sold_as()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('rf.invoice_line_write', 'on', true);
  update customer_invoice_lines l
     set square_item = new.square_item
    from customer_invoices i
   where i.id = l.invoice_id
     and l.special_order_id = new.id
     and i.paid_at is null and i.voided_at is null
     and l.square_item is distinct from new.square_item;
  perform set_config('rf.invoice_line_write', 'off', true);
  return null;
end;
$$;

revoke all on function public.trg_invoice_lines_follow_sold_as() from public, anon, authenticated;

drop trigger if exists trg_invoice_lines_follow_sold_as on special_orders;
create trigger trg_invoice_lines_follow_sold_as
  after update of square_item on special_orders
  for each row
  when (old.square_item is distinct from new.square_item)
  execute function trg_invoice_lines_follow_sold_as();


-- ----------------------------------------------------------------------------
-- 3. What an invoice may still be changed in
-- ----------------------------------------------------------------------------
-- FROZEN: sent, void, or holding money. On a draft, an ORDER's lines are
-- written only by the functions below (they come from the order, so they are
-- changed by updating from it); a FREE line is anyone's with the role, and its
-- amount is worked out from qty × price when both are given.

create or replace function public.customer_invoice_is_frozen(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select i.sent_at is not null
      or i.voided_at is not null
      or exists (select 1 from payment_applications a where a.customer_invoice_id = i.id)
    from customer_invoices i where i.id = p_invoice;
$$;

revoke all on function public.customer_invoice_is_frozen(uuid) from public, anon, authenticated;

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_fn boolean := coalesce(current_setting('rf.invoice_line_write', true), '') = 'on';
begin
  select id, org_id, paid_at, voided_at, customer_invoice_is_frozen(id) as frozen
    into inv
    from customer_invoices where id = coalesce(new.invoice_id, old.invoice_id);

  if tg_op = 'DELETE' then
    -- A cascade from the invoice's own delete finds no invoice row: allowed.
    if inv.id is null or v_fn then
      return old;
    end if;
    if inv.frozen then
      raise exception 'this invoice has gone out or holds money, so its lines are settled';
    end if;
    if old.special_order_id is not null then
      raise exception 'an order''s lines come off together — remove the order from the invoice';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and v_fn then
    return new;
  end if;

  -- An ORDER ITEM deleted leaves its copy on the invoice, pointing at nothing
  -- (the foreign key's set null). The paper is unchanged, so it is never
  -- refused — an order's items are the order's to edit.
  if tg_op = 'UPDATE'
     and old.special_order_item_id is not null and new.special_order_item_id is null
     and (to_jsonb(new) - 'special_order_item_id' - 'updated_at')
         = (to_jsonb(old) - 'special_order_item_id' - 'updated_at') then
    return new;
  end if;

  -- Sold as, alone, on an invoice still collecting (129).
  if tg_op = 'UPDATE'
     and (new.invoice_id, new.special_order_id, new.line_type, new.description, new.qty, new.unit_price,
          new.amount, new.taxable, new.tax_rate, new.sort, new.kind, new.sent_amount, new.order_label)
         is not distinct from
         (old.invoice_id, old.special_order_id, old.line_type, old.description, old.qty, old.unit_price,
          old.amount, old.taxable, old.tax_rate, old.sort, old.kind, old.sent_amount, old.order_label) then
    if inv.paid_at is not null or inv.voided_at is not null then
      raise exception 'this invoice is paid or void, so what it was sold as is settled';
    end if;
    return new;
  end if;

  if inv.frozen then
    raise exception 'this invoice has gone out or holds money, so its lines are settled';
  end if;
  if new.org_id is distinct from inv.org_id then
    raise exception 'a line belongs to its invoice''s org';
  end if;

  if new.special_order_id is not null or (tg_op = 'UPDATE' and old.special_order_id is not null) then
    if not v_fn then
      raise exception 'an order''s lines come from the order — change the order, then Update it on the invoice';
    end if;
    return new;
  end if;

  -- A FREE line: untaxed (v1), and its amount is its qty × price when given.
  new.taxable := false;
  new.tax_rate := null;
  new.kind := 'balance';
  if nullif(btrim(coalesce(new.description, '')), '') is null then
    raise exception 'a line says what it is';
  end if;
  if new.qty is not null and new.unit_price is not null then
    new.amount := round(new.qty * new.unit_price, 2);
  end if;
  if new.amount is null then
    raise exception 'a line has an amount';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_lines_frozen on customer_invoice_lines;
create trigger trg_customer_invoice_lines_frozen
  before insert or update or delete on customer_invoice_lines
  for each row execute function trg_customer_invoice_lines_frozen();


-- ----------------------------------------------------------------------------
-- 4. An order's charges, as lines
-- ----------------------------------------------------------------------------

-- What an order is billed so far: every order-linked line on its live
-- invoices. What is left is its total less that, and it may be negative — an
-- order that shrank after it was billed, which only Revise (142) can answer.
create or replace function public.special_order_billed(p_order uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.amount), 0)::numeric(10,2)
    from customer_invoice_lines l
    join customer_invoices i on i.id = l.invoice_id
   where l.special_order_id = p_order
     and i.voided_at is null
     and l.invoice_id is distinct from p_except;
$$;

create or replace function public.special_order_unbilled(p_order uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (case when o.status = 'cancelled' then 0 else m.total end
          - special_order_billed(p_order, p_except))::numeric(10,2)
    from special_orders o, special_order_money(o.id) m
   where o.id = p_order;
$$;

revoke all on function public.special_order_billed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.special_order_unbilled(uuid, uuid) from public, anon, authenticated;

-- The lines a copy of the order would write onto `p_invoice` right now: its
-- items, then discount, delivery, rush, tax, then "Less invoice N" for each
-- other live invoice that bills it. Used to COPY, and to tell whether a draft's
-- copy has gone STALE. Figures are `special_order_money`'s, so the group nets
-- to the order's total less what it is billed elsewhere, to the cent.
create or replace function public.order_invoice_lines(p_order uuid, p_invoice uuid)
returns table (
  line_type text,
  description text,
  qty numeric,
  unit_price numeric,
  amount numeric,
  taxable boolean,
  tax_rate numeric,
  special_order_item_id uuid,
  sort int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o record;
  m record;
  it record;
  v_n int := 0;
  v_items numeric(10,2) := 0;
  v_penny numeric(10,2);
  v_big uuid;
  v_prefix text;
  pb record;
begin
  select so.*, coalesce(g.settings -> 'customer_invoices' ->> 'prefix', '') as prefix
    into o
    from special_orders so join orgs g on g.id = so.org_id
   where so.id = p_order;
  if not found then
    return;
  end if;
  select * into m from special_order_money(p_order);
  v_prefix := o.prefix;

  -- The largest item takes any penny between the rounded items and the
  -- order's subtotal (which rounds once, over the unrounded sum).
  select i.id into v_big
    from special_order_items i
   where i.order_id = p_order
   order by abs(round(coalesce(i.qty, 0) * coalesce(i.unit_price, 0), 2)) desc, i.sort nulls last, i.id
   limit 1;
  select coalesce(sum(round(coalesce(i.qty, 0) * coalesce(i.unit_price, 0), 2)), 0) into v_items
    from special_order_items i where i.order_id = p_order;
  v_penny := m.subtotal - v_items;

  for it in
    select i.id, i.name, coalesce(i.qty, 0) as q, coalesce(i.unit_price, 0) as p, i.taxable
      from special_order_items i
     where i.order_id = p_order
     order by i.sort nulls last, i.id
  loop
    line_type := 'item';
    description := it.name;
    qty := it.q;
    unit_price := it.p;
    amount := round(it.q * it.p, 2) + case when it.id = v_big then v_penny else 0 end;
    taxable := it.taxable;
    tax_rate := null;
    special_order_item_id := it.id;
    sort := v_n;
    v_n := v_n + 1;
    return next;
  end loop;

  qty := null; unit_price := null; special_order_item_id := null; taxable := false; tax_rate := null;

  if m.discount <> 0 then
    line_type := 'discount'; description := 'Discount'; amount := -m.discount; sort := 1000;
    return next;
  end if;
  if m.delivery <> 0 then
    line_type := 'delivery'; description := 'Delivery'; amount := m.delivery; sort := 1001;
    return next;
  end if;
  if m.rush <> 0 then
    line_type := 'rush'; description := 'Rush fee'; amount := m.rush; sort := 1002;
    return next;
  end if;
  if m.tax <> 0 then
    line_type := 'tax'; description := 'Sales tax'; amount := m.tax; tax_rate := o.tax_rate; sort := 1003;
    return next;
    tax_rate := null;
  end if;

  v_n := 1004;
  for pb in
    select i.number, sum(l.amount) as billed
      from customer_invoice_lines l
      join customer_invoices i on i.id = l.invoice_id
     where l.special_order_id = p_order
       and i.voided_at is null
       and i.id is distinct from p_invoice
     group by i.id, i.number
    having sum(l.amount) <> 0
     order by i.number
  loop
    line_type := 'prior_billing';
    description := 'Less invoice ' || v_prefix || pb.number;
    amount := -pb.billed;
    sort := v_n;
    v_n := v_n + 1;
    return next;
  end loop;
end;
$$;

revoke all on function public.order_invoice_lines(uuid, uuid) from public, anon, authenticated;

-- Internal: write an order's copy onto a draft (the caller has checked it).
create or replace function public.write_order_invoice_lines(p_invoice uuid, p_order uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  o record;
  v_net numeric(10,2);
begin
  select id, org_id into inv from customer_invoices where id = p_invoice;
  select id, square_item into o from special_orders where id = p_order;

  perform set_config('rf.invoice_line_write', 'on', true);
  delete from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order;
  insert into customer_invoice_lines
    (org_id, invoice_id, special_order_id, line_type, description, qty, unit_price, amount,
     taxable, tax_rate, special_order_item_id, sort, kind, square_item, order_label)
  select inv.org_id, p_invoice, p_order, x.line_type, x.description, x.qty, x.unit_price, x.amount,
         x.taxable, x.tax_rate, x.special_order_item_id, x.sort, 'balance', o.square_item,
         invoice_line_description(p_order)
    from order_invoice_lines(p_order, p_invoice) x;
  perform set_config('rf.invoice_line_write', 'off', true);

  select coalesce(sum(amount), 0) into v_net
    from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order;
  return v_net;
end;
$$;

revoke all on function public.write_order_invoice_lines(uuid, uuid) from public, anon, authenticated;

-- Internal: the refusals an order meets being put on an invoice, in words.
create or replace function public.order_invoice_refusal(p_invoice uuid, p_order uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv record;
  o record;
  v_left numeric(10,2);
  v_where text;
begin
  select * into inv from customer_invoices where id = p_invoice;
  select * into o from special_orders where id = p_order;
  if o.id is null or o.org_id <> inv.org_id then
    return 'an order that is not this org''s';
  end if;
  if o.kind <> 'order' then
    return 'Order #' || o.number || ' is a template or a standing order, not a day';
  end if;
  if o.status = 'cancelled' then
    return 'Order #' || o.number || ' is cancelled';
  end if;
  if o.customer_id is distinct from inv.customer_id then
    return 'Order #' || o.number || ' is ' || coalesce(customer_label(o.customer_id), 'no customer') ||
           '''s, and this invoice is ' || coalesce(customer_label(inv.customer_id), 'someone else') || '''s';
  end if;
  if special_order_collecting_location(p_order) is distinct from inv.location_id then
    select code into v_where from locations where id = special_order_collecting_location(p_order);
    return 'Order #' || o.number || ' collects at ' || coalesce(v_where, 'no shop') ||
           ', and one payment cannot cover two shops';
  end if;
  if exists (select 1 from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order) then
    return 'Order #' || o.number || ' is already on this invoice';
  end if;
  v_left := special_order_unbilled(p_order, p_invoice);
  if v_left < 0 then
    return 'Order #' || o.number || ' is billed $' || to_char(-v_left, 'FM999999990.00') ||
           ' more than it now comes to — revise the invoice that bills it';
  end if;
  if v_left = 0 then
    return 'Order #' || o.number || ' is already billed in full';
  end if;
  return null;
end;
$$;

revoke all on function public.order_invoice_refusal(uuid, uuid) from public, anon, authenticated;

-- A number, one at a time per org.
create or replace function public.next_customer_invoice_number(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || p_org::text));
  select coalesce(max(number), 1000) + 1 into v from customer_invoices where org_id = p_org;
  return v;
end;
$$;

revoke all on function public.next_customer_invoice_number(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. The draft's commands
-- ----------------------------------------------------------------------------

create or replace function public.require_invoice_draft(p_invoice uuid)
returns customer_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  inv customer_invoices;
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  if customer_invoice_is_frozen(p_invoice) then
    raise exception 'invoice % has gone out or holds money, so it is settled', inv.number;
  end if;
  return inv;
end;
$$;

revoke all on function public.require_invoice_draft(uuid) from public, anon, authenticated;

-- Add Orders…: each order's charges, copied. All or nothing, with the first
-- refusal in words. Returns the number added.
create or replace function public.add_orders_to_customer_invoice(p_invoice uuid, p_orders uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inv customer_invoices := require_invoice_draft(p_invoice);
  v_order uuid;
  v_why text;
  v_n int := 0;
begin
  foreach v_order in array coalesce(p_orders, '{}') loop
    v_why := order_invoice_refusal(p_invoice, v_order);
    if v_why is not null then
      raise exception '%', v_why;
    end if;
    perform write_order_invoice_lines(p_invoice, v_order);
    perform log_special_order_event(inv.org_id, v_order, 'Added to invoice ' || inv.number);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.remove_order_from_customer_invoice(p_invoice uuid, p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv customer_invoices := require_invoice_draft(p_invoice);
begin
  perform set_config('rf.invoice_line_write', 'on', true);
  delete from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order;
  perform set_config('rf.invoice_line_write', 'off', true);
  perform log_special_order_event(inv.org_id, p_order, 'Removed from invoice ' || inv.number);
end;
$$;

-- Update: a draft's copy re-taken from the order as it is now. A deposit is a
-- fixed figure and is left alone.
create or replace function public.update_order_on_customer_invoice(p_invoice uuid, p_order uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv customer_invoices := require_invoice_draft(p_invoice);
  v_net numeric(10,2);
begin
  if exists (select 1 from customer_invoice_lines
              where invoice_id = p_invoice and special_order_id = p_order and line_type = 'deposit') then
    raise exception 'a deposit is the figure it was asked for — change its amount instead';
  end if;
  if not exists (select 1 from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order) then
    raise exception 'that order is not on this invoice';
  end if;
  v_net := write_order_invoice_lines(p_invoice, p_order);
  if v_net <= 0 then
    raise exception 'this order is billed on another invoice for everything it now comes to — remove it from this one';
  end if;
  return v_net;
end;
$$;

-- A deposit's figure, on a draft, within what the order has left to bill.
create or replace function public.set_invoice_deposit(p_invoice uuid, p_order uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv customer_invoices := require_invoice_draft(p_invoice);
  v_left numeric(10,2);
begin
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'a deposit or part payment is more than zero';
  end if;
  v_left := special_order_unbilled(p_order, p_invoice);
  if p_amount > v_left then
    raise exception 'more than the % not yet billed on this order', v_left;
  end if;
  perform set_config('rf.invoice_line_write', 'on', true);
  update customer_invoice_lines set amount = p_amount
   where invoice_id = p_invoice and special_order_id = p_order and line_type = 'deposit';
  perform set_config('rf.invoice_line_write', 'off', true);
end;
$$;

-- An invoice's orders, each with what it bills here, what a fresh copy would
-- bill, and whether the copy has gone stale — the record screen's Orders
-- section and Send's check. Any member may read.
create or replace function public.customer_invoice_groups(p_invoice uuid)
returns table (
  special_order_id uuid,
  kind text,
  billed numeric,
  expected numeric,
  stale boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from customer_invoices where id = p_invoice;
  if v_org is null or v_org not in (select user_org_ids()) then
    return;
  end if;
  return query
  select g.special_order_id,
         g.kind,
         g.billed,
         case when g.kind = 'charges'
              then (select coalesce(sum(x.amount), 0) from order_invoice_lines(g.special_order_id, p_invoice) x)
              else g.billed end::numeric(10,2),
         case when g.kind = 'charges' then exists (
                (select x.line_type, x.description, x.qty, x.unit_price, x.amount
                   from order_invoice_lines(g.special_order_id, p_invoice) x
                 except
                 select l.line_type, l.description, l.qty, l.unit_price, l.amount
                   from customer_invoice_lines l
                  where l.invoice_id = p_invoice and l.special_order_id = g.special_order_id)
                union all
                (select l.line_type, l.description, l.qty, l.unit_price, l.amount
                   from customer_invoice_lines l
                  where l.invoice_id = p_invoice and l.special_order_id = g.special_order_id
                 except
                 select x.line_type, x.description, x.qty, x.unit_price, x.amount
                   from order_invoice_lines(g.special_order_id, p_invoice) x))
              else false end
    from (select l.special_order_id,
                 case when bool_or(l.line_type = 'deposit') then 'deposit'
                      when bool_or(l.line_type = 'order_total') then 'order_total'
                      else 'charges' end as kind,
                 sum(l.amount)::numeric(10,2) as billed
            from customer_invoice_lines l
           where l.invoice_id = p_invoice and l.special_order_id is not null
           group by l.special_order_id) g;
end;
$$;

-- What stops an invoice going out, in words — empty when nothing does. Asked
-- by the Send button and by `send-special-order-email` BEFORE it mails.
create or replace function public.customer_invoice_send_problems(p_invoice uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv customer_invoices;
  v_out text[] := '{}';
  g record;
  v_total numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    return array['invoice not found'];
  end if;
  if inv.voided_at is not null then
    return array['This invoice is void.'];
  end if;
  select coalesce(sum(amount), 0) into v_total from customer_invoice_lines where invoice_id = p_invoice;
  if not exists (select 1 from customer_invoice_lines where invoice_id = p_invoice) then
    v_out := array_append(v_out, 'This invoice has no lines yet.');
  elsif v_total <= 0 then
    v_out := array_append(v_out, 'This invoice comes to nothing.');
  end if;

  -- A re-send is the same frozen paper; only a first send checks its orders.
  if inv.sent_at is null and not customer_invoice_is_frozen(p_invoice) then
    for g in select x.*, o.number from customer_invoice_groups(p_invoice) x
               join special_orders o on o.id = x.special_order_id order by o.number loop
      if g.stale then
        v_out := array_append(v_out, ('Order #' || g.number || ' has changed since it was added — update it on the invoice.'));
      end if;
      if g.billed <= 0 then
        v_out := array_append(v_out, ('Order #' || g.number || ' bills nothing here — remove it.'));
      end if;
    end loop;
  end if;

  -- QuickBooks computes its own figures from the lines it is sent (131): a
  -- deposit, a "Less invoice", or cash already taken would leave its copy
  -- disagreeing with the customer's.
  if inv.processor = 'quickbooks' then
    if exists (select 1 from customer_invoice_lines
                where invoice_id = p_invoice and line_type in ('deposit', 'prior_billing')) then
      v_out := array_append(v_out, 'A deposit or a "Less invoice" line cannot go on a QuickBooks invoice yet — collect this one through Square.');
    end if;
    if inv.sent_at is null and exists (
         select 1 from payment_applications a
          where a.customer_invoice_id is null and a.amount > 0
            and a.special_order_id in (select l.special_order_id from customer_invoice_lines l where l.invoice_id = p_invoice)) then
      v_out := array_append(v_out, 'Money is already held on one of these orders, which QuickBooks would ask for again — collect this one through Square.');
    end if;
  end if;
  return v_out;
end;
$$;

revoke all on function public.require_invoice_draft(uuid) from public, anon, authenticated;
revoke all on function public.add_orders_to_customer_invoice(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.remove_order_from_customer_invoice(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_order_on_customer_invoice(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_invoice_deposit(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.customer_invoice_groups(uuid) from public, anon, authenticated;
revoke all on function public.customer_invoice_send_problems(uuid) from public, anon, authenticated;
grant execute on function public.add_orders_to_customer_invoice(uuid, uuid[]) to authenticated;
grant execute on function public.remove_order_from_customer_invoice(uuid, uuid) to authenticated;
grant execute on function public.update_order_on_customer_invoice(uuid, uuid) to authenticated;
grant execute on function public.set_invoice_deposit(uuid, uuid, numeric) to authenticated;
grant execute on function public.customer_invoice_groups(uuid) to authenticated;
grant execute on function public.customer_invoice_send_problems(uuid) to authenticated;

-- The picker: a customer's orders with something left to bill at a shop.
-- FileMaker's statement-billed days (`ignore_balance`) are history and stay out.
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
   order by o.event_date nulls last, o.number;
end;
$$;

revoke all on function public.customer_unbilled_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_unbilled_orders(uuid, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Creating one
-- ----------------------------------------------------------------------------

-- NEW: an invoice for a customer at a shop, with any number of orders — none
-- is fine; orders and lines can be added to the draft. Created from a
-- selection of orders, the customer and the shop default to the first one's.
create or replace function public.create_customer_invoice(
  p_org_id    uuid,
  p_customer  uuid,
  p_location  uuid,
  p_orders    uuid[] default '{}',
  p_issued_on date default null,
  p_due_on    date default null,
  p_notes     text default null,
  p_processor text default 'square'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_number int;
begin
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to create an invoice';
  end if;
  if coalesce(array_length(p_orders, 1), 0) > 0 then
    p_customer := coalesce(p_customer,
      (select customer_id from special_orders where id = p_orders[1] and org_id = p_org_id));
    p_location := coalesce(p_location, special_order_collecting_location(p_orders[1]));
  end if;
  if p_customer is null or not exists (select 1 from customers where id = p_customer and org_id = p_org_id) then
    raise exception 'an invoice is addressed to a customer';
  end if;
  if p_location is null or not exists (select 1 from locations where id = p_location and org_id = p_org_id) then
    raise exception 'an invoice collects at a shop';
  end if;
  if coalesce(p_processor, 'square') not in ('square', 'quickbooks') then
    raise exception 'collect through Square or QuickBooks';
  end if;

  v_number := next_customer_invoice_number(p_org_id);
  insert into customer_invoices
    (org_id, customer_id, location_id, number, issued_on, due_on, notes, processor, created_by)
  values
    (p_org_id, p_customer, p_location, v_number, coalesce(p_issued_on, org_today(p_org_id)),
     p_due_on, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_processor, 'square'), auth.uid())
  returning id into v_id;

  perform add_orders_to_customer_invoice(v_id, p_orders);
  return v_id;
end;
$$;

revoke all on function public.create_customer_invoice(uuid, uuid, uuid, uuid[], date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.create_customer_invoice(uuid, uuid, uuid, uuid[], date, date, text, text)
  to authenticated;

-- 124's signature, kept until 144 so a browser still holding the old app can
-- create one: the customer and the shop come from the first order.
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
  v_first uuid;
begin
  select array_agg((x ->> 'order_id')::uuid order by n) into v_ids
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(x, n);
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'an invoice needs at least one order';
  end if;
  v_first := v_ids[1];
  return create_customer_invoice(
    p_org_id,
    (select customer_id from special_orders where id = v_first and org_id = p_org_id),
    special_order_collecting_location(v_first),
    v_ids, p_issued_on, p_due_on, p_notes, 'square');
end;
$$;

revoke all on function public.create_customer_invoice(uuid, jsonb, date, date, text) from public, anon, authenticated;
grant execute on function public.create_customer_invoice(uuid, jsonb, date, date, text) to authenticated;

-- 139's New Invoice, on the new lines: Balance Due is the order's charges less
-- what its other invoices bill; a deposit or part payment is one fixed line.
create or replace function public.create_payment_invoice(
  p_order  uuid,
  p_kind   text,
  p_amount numeric default null,
  p_note   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_left numeric(10,2);
  v_today date;
  v_days int;
  v_id uuid;
  v_location uuid;
begin
  select * into o from special_orders where id = p_order;
  if not found or not user_has_role(o.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'order not found';
  end if;
  if p_kind not in ('balance', 'deposit', 'other') then
    raise exception 'ask for the balance, a deposit or another amount';
  end if;
  if o.kind <> 'order' or o.status = 'cancelled' then
    raise exception 'only a live order can be invoiced';
  end if;
  if o.customer_id is null then
    raise exception 'link a customer to this order first';
  end if;
  v_location := special_order_collecting_location(p_order);
  if v_location is null then
    raise exception 'set the shop that makes this order first';
  end if;

  v_left := special_order_unbilled(p_order, null);
  if v_left <= 0 then
    raise exception 'nothing is left to bill on this order';
  end if;
  if p_kind <> 'balance' then
    if coalesce(p_amount, 0) <= 0 then
      raise exception 'a deposit or part payment is more than zero';
    elsif p_amount > v_left then
      raise exception 'more than the % not yet billed on this order', v_left;
    end if;
  end if;

  v_today := org_today(o.org_id);
  select coalesce(nullif(settings -> 'customer_invoices' ->> 'terms_days', '')::int, 4)
    into v_days from orgs where id = o.org_id;

  insert into customer_invoices
    (org_id, customer_id, location_id, number, issued_on, due_on, notes, created_by)
  values
    (o.org_id, o.customer_id, v_location, next_customer_invoice_number(o.org_id), v_today,
     v_today + greatest(v_days, 0), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  if p_kind = 'balance' then
    perform add_orders_to_customer_invoice(v_id, array[p_order]);
  else
    perform set_config('rf.invoice_line_write', 'on', true);
    insert into customer_invoice_lines
      (org_id, invoice_id, special_order_id, line_type, description, amount, sort, kind,
       square_item, order_label)
    values
      (o.org_id, v_id, p_order, 'deposit',
       case p_kind when 'deposit' then 'Deposit' else 'Part payment' end,
       p_amount, 0, p_kind, o.square_item, invoice_line_description(p_order));
    perform set_config('rf.invoice_line_write', 'off', true);
    perform log_special_order_event(o.org_id, p_order,
      'Added to invoice ' || (select number from customer_invoices where id = v_id)
      || case p_kind when 'deposit' then ' (deposit of $' else ' (part payment of $' end
      || to_char(p_amount, 'FM999999990.00') || ')');
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_payment_invoice(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_payment_invoice(uuid, text, numeric, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. Sending: record it, and apply money held on its orders
-- ----------------------------------------------------------------------------
-- 128's `mark_customer_invoice_sent`, same signature. Called by the edge
-- function AFTER the email has gone, so it records and never refuses for an
-- order's sake — `customer_invoice_send_problems` was asked first.

create or replace function public.mark_customer_invoice_sent(
  p_invoice uuid,
  p_document_path text default null,
  p_sent_to text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_today date;
  v_resend boolean;
  g record;
  h record;
  v_open numeric(10,2);
  v_held numeric(10,2);
  v_take numeric(10,2);
  v_moved numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  v_today := org_today(inv.org_id);
  v_resend := inv.sent_at is not null;

  update customer_invoices
     set sent_at = coalesce(sent_at, v_today),
         last_sent_at = v_today,
         document_path = coalesce(p_document_path, document_path)
   where id = p_invoice;

  perform set_config('rf.invoice_line_write', 'on', true);
  update customer_invoice_lines set sent_amount = amount where invoice_id = p_invoice;
  perform set_config('rf.invoice_line_write', 'off', true);

  insert into customer_invoice_sends (org_id, invoice_id, sent_on, sent_to, total, document_path, created_by)
  values (inv.org_id, p_invoice, v_today, nullif(btrim(coalesce(p_sent_to, '')), ''),
          (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice),
          p_document_path, auth.uid());

  update special_orders o
     set invoice_sent_at = coalesce(o.invoice_sent_at, v_today),
         status = case when o.status in ('lead', 'quote') then 'invoice' else o.status end,
         todo = case when o.todo = 'Send Invoice' then null else o.todo end
   where o.id in (select special_order_id from customer_invoice_lines
                   where invoice_id = p_invoice and special_order_id is not null);

  -- MONEY HELD ON ITS ORDERS APPLIES NOW, each order up to what it bills
  -- here — oldest payment first, split where one is bigger than needed. Not
  -- on a QuickBooks invoice, which cannot know about it (send refuses that).
  -- The moves are the ledger's business, not the log's: one line says it.
  if not v_resend and inv.processor = 'square' then
    perform set_config('rf.suppress_order_log', 'on', true);
    for g in
      select l.special_order_id, sum(l.amount) as net
        from customer_invoice_lines l
       where l.invoice_id = p_invoice and l.special_order_id is not null
       group by l.special_order_id
    loop
      v_open := g.net - coalesce((select sum(a.amount) from payment_applications a
                                   where a.customer_invoice_id = p_invoice
                                     and a.special_order_id = g.special_order_id), 0);
      v_held := coalesce((select sum(a.amount) from payment_applications a
                           where a.customer_invoice_id is null
                             and a.special_order_id = g.special_order_id), 0);
      v_take := least(v_open, v_held);
      continue when v_take <= 0;
      v_moved := 0;
      for h in
        select a.id, a.amount, a.payment_id
          from payment_applications a
         where a.customer_invoice_id is null and a.special_order_id = g.special_order_id and a.amount > 0
         order by a.created_at, a.id
      loop
        exit when v_moved >= v_take;
        if h.amount <= v_take - v_moved then
          update payment_applications set customer_invoice_id = p_invoice where id = h.id;
          v_moved := v_moved + h.amount;
        else
          update payment_applications set amount = h.amount - (v_take - v_moved) where id = h.id;
          insert into payment_applications (org_id, payment_id, special_order_id, customer_invoice_id, amount)
          values (inv.org_id, h.payment_id, g.special_order_id, p_invoice, v_take - v_moved);
          v_moved := v_take;
        end if;
      end loop;
      perform set_config('rf.suppress_order_log', 'off', true);
      perform log_special_order_event(inv.org_id, g.special_order_id,
        format('%s already paid applied to invoice %s', to_char(v_moved, 'FM$999,999,990.00'), inv.number));
      perform set_config('rf.suppress_order_log', 'on', true);
    end loop;
    perform set_config('rf.suppress_order_log', 'off', true);
  end if;

  perform log_special_order_event(inv.org_id, o.id,
                                  'Invoice ' || inv.number || case when v_resend then ' re-sent' else ' sent' end)
     from (select distinct special_order_id as id from customer_invoice_lines
            where invoice_id = p_invoice and special_order_id is not null) o;

  -- An order its held money has now paid in full is settled, as an invoice
  -- payment settles one (124).
  perform settle_special_order_paid(o.id, v_today)
     from (select distinct l.special_order_id as id from customer_invoice_lines l
            where l.invoice_id = p_invoice and l.special_order_id is not null) o
     join special_orders so on so.id = o.id
    where (select m.total from special_order_money(o.id) m) - special_order_paid(o.id) <= 0
      and so.invoice_paid_at is null;
end;
$$;

revoke all on function public.mark_customer_invoice_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_customer_invoice_sent(uuid, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. Paying one: orders oldest first, the invoice's own lines last
-- ----------------------------------------------------------------------------

-- The groups a payment is split across: each order, oldest event first, keyed
-- by its id; then the FREE lines, keyed 'free'. The same keys the pay link's
-- Square order is cut by (section 9).
create or replace function public.customer_invoice_payment_groups(p_invoice uuid)
returns table (k text, order_id uuid, amount numeric, seq bigint)
language sql
stable
security definer
set search_path = public
as $$
  select li.special_order_id::text, li.special_order_id, sum(li.amount),
         row_number() over (order by min(o.event_date) nulls last, min(o.number))
    from customer_invoice_lines li
    join special_orders o on o.id = li.special_order_id
   where li.invoice_id = p_invoice
   group by li.special_order_id
  union all
  select 'free', null::uuid, sum(li.amount), 1000000
    from customer_invoice_lines li
   where li.invoice_id = p_invoice and li.special_order_id is null
  having count(*) > 0;
$$;

revoke all on function public.customer_invoice_payment_groups(uuid) from public, anon, authenticated;
-- 140's `allocate_customer_invoice_payment`, same signature. The FREE lines
-- are one more group, after the orders, paid by an application naming the
-- invoice and no order; when there are free lines they are the last group and
-- take any excess.

create or replace function public.allocate_customer_invoice_payment(
  p_invoice uuid,
  p_amount  numeric,
  p_type    text,
  p_ref     text,
  p_note    text,
  p_today   date,
  p_by      uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  l   record;
  v_left numeric(10,2) := p_amount;
  v_owed numeric(10,2);
  v_share numeric(10,2);
  v_last text;
  v_written int := 0;
  v_payment uuid;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_processor text := case p_type
                        when 'Square Online'       then 'square'
                        when 'QuickBooks Payments' then 'quickbooks'
                      end;
begin
  select * into inv from customer_invoices where id = p_invoice;

  insert into customer_payments
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note, created_by)
  values
    (inv.org_id, inv.customer_id, p_today, p_amount, p_type, v_processor, v_ref,
     nullif(btrim(coalesce(p_note, '')), ''), p_by)
  on conflict (org_id, processor, external_ref)
    where processor is not null and external_ref is not null
  do nothing
  returning id into v_payment;

  if v_payment is null then
    select id into v_payment
      from customer_payments
     where org_id = inv.org_id and processor = v_processor and external_ref = v_ref
     for update;
    if exists (select 1 from payment_applications
                where payment_id = v_payment and customer_invoice_id = p_invoice) then
      return 0;
    end if;
    update customer_payments set amount = amount + p_amount where id = v_payment;
  end if;

  select g.k into v_last from customer_invoice_payment_groups(p_invoice) g order by g.seq desc limit 1;

  for l in select * from customer_invoice_payment_groups(p_invoice) g order by g.seq loop
    exit when v_left <= 0;
    select l.amount - coalesce(sum(a.amount), 0) into v_owed
      from payment_applications a
     where a.customer_invoice_id = p_invoice
       and a.special_order_id is not distinct from l.order_id;

    v_share := case when l.k = v_last then v_left else least(v_left, greatest(v_owed, 0)) end;
    continue when v_share <= 0;

    insert into payment_applications
      (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
    values
      (inv.org_id, v_payment, l.order_id, p_invoice, v_share, p_by);
    v_written := v_written + 1;
    v_left := v_left - v_share;

    if l.order_id is not null
       and (select m.total from special_order_money(l.order_id) m) - special_order_paid(l.order_id) <= 0 then
      perform settle_special_order_paid(l.order_id, p_today);
    end if;
  end loop;

  if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice)
     - customer_invoice_paid(p_invoice) <= 0 then
    update customer_invoices set paid_at = coalesce(paid_at, p_today) where id = p_invoice;
  end if;

  return v_written;
end;
$$;

revoke all on function public.allocate_customer_invoice_payment(uuid, numeric, text, text, text, date, uuid)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 9. The pay link: the header's shop, and one Square line per ORDER
-- ----------------------------------------------------------------------------

create or replace function public.customer_invoice_square_location(p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when g.settings -> 'square_payments' ->> 'environment' = 'sandbox'
             then nullif(btrim(g.settings -> 'square_payments' ->> 'sandbox_location_id'), '')
           else nullif(btrim(l.square_location_id), '')
         end
    from customer_invoices i
    join orgs g on g.id = i.org_id
    left join locations l on l.id = i.location_id
   where i.id = p_invoice;
$$;

revoke all on function public.customer_invoice_square_location(uuid) from public, anon, authenticated;

-- 129's rule, with free lines left out: an invoice is wholesale when every
-- ORDER on it is sold as wholesale (a delivery fee is nobody's item).
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
     where l.invoice_id = (p_state ->> 'customer_invoice_id')::uuid
       and l.special_order_id is not null;                                -- <<< 141
  else
    select square_item = 'wholesale' into v_wholesale
      from special_orders where id = (p_state ->> 'order_id')::uuid;
  end if;
  return pay_link_item_variation(
    v_org, case when coalesce(v_wholesale, false) then 'wholesale' else 'special_order' end);
end;
$$;

revoke all on function public.pay_link_token_variation(jsonb) from public, anon, authenticated;

-- 138's `claim_pay_token` IN FULL. `items` is now one entry per GROUP — each
-- order, keyed by its id, and the free lines keyed 'free' — which is how the
-- send keys the breakdown, so `square-pay` cuts the Square order exactly as it
-- did when a line was an order.
create or replace function public.claim_pay_token(p_token text, p_pay text default 'balance')
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
    'balance', case when p_pay = 'deposit' and s ? 'deposit_due'
                    then s -> 'deposit_due' else s -> 'balance' end,
    'is_deposit', (p_pay = 'deposit' and s ? 'deposit_due'),
    'location_id', pay_link_token_location(s),
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_token_variation(s),
    'items', (select jsonb_agg(jsonb_build_object(                          -- <<< 141
                       'line_id', g.k,
                       'variation_id', pay_link_item_variation((s ->> 'org_id')::uuid, g.item))
                     order by g.seq)
                from (select coalesce(l.special_order_id::text, 'free') as k,
                             case when bool_and(l.square_item = 'wholesale') then 'wholesale'
                                  else 'special_order' end as item,
                             min(l.sort) + case when l.special_order_id is null then 100000 else 0 end as seq
                        from customer_invoice_lines l
                       where l.invoice_id = (s ->> 'customer_invoice_id')::uuid
                       group by l.special_order_id) g)
  );
end;
$$;

revoke all on function public.claim_pay_token(text, text) from public, anon, authenticated;
grant execute on function public.claim_pay_token(text, text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 10. The log names each order once
-- ----------------------------------------------------------------------------
-- 130's trace, over DISTINCT orders: an order is several lines now.

create or replace function public.trg_customer_invoice_leaves_a_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform log_special_order_event(old.org_id, o.id,
                                    'Removed from invoice ' || old.number || ' (draft deleted)')
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = old.id and special_order_id is not null) o;
    return old;
  end if;

  if old.voided_at is null and new.voided_at is not null then
    perform log_special_order_event(new.org_id, o.id, 'Invoice ' || new.number || ' voided')
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = new.id and special_order_id is not null) o;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_leaves_a_trace() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 11. The live draft, re-copied — and proved
-- ----------------------------------------------------------------------------
-- Every DRAFT with no money on it has its order lines re-copied itemized. What
-- each order bills moves by exactly the money HELD on it, and by nothing else:
-- a 139 line billed the order's total less what was held or billed elsewhere;
-- the copy bills the total less what is billed elsewhere, and the held money
-- applies when it is sent (section 7). Checked per order, not assumed.

do $$
declare
  d record;
  v_before numeric(10,2);
  v_after numeric(10,2);
  v_held numeric(10,2);
  v_bad text := '';
begin
  for d in
    select i.id as invoice_id, i.number, l.special_order_id, sum(l.amount) as billed
      from customer_invoices i
      join customer_invoice_lines l on l.invoice_id = i.id
     where i.sent_at is null and i.voided_at is null
       and not exists (select 1 from payment_applications a where a.customer_invoice_id = i.id)
       and l.special_order_id is not null
       and l.line_type = 'order_total'
     group by i.id, i.number, l.special_order_id
  loop
    v_before := d.billed;
    v_held := coalesce((select sum(a.amount) from payment_applications a
                         where a.special_order_id = d.special_order_id and a.customer_invoice_id is null), 0);
    v_after := write_order_invoice_lines(d.invoice_id, d.special_order_id);
    if v_after <> v_before + v_held then
      v_bad := v_bad || format(' invoice %s order %s: %s (+ %s held) → %s;',
                               d.number, d.special_order_id, v_before, v_held, v_after);
    end if;
  end loop;
  if v_bad <> '' then
    raise exception '141: re-copying a draft moved what it bills —%', v_bad;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select line_type, count(*) from customer_invoice_lines group by 1;
--     → order_total / deposit for the sent and void invoices, item + delivery for #1014
--   select number, location_id is not null from customer_invoices order by 1;
--     → true for every invoice that is not void
--   select sum(amount) from customer_invoice_lines l join customer_invoices i on i.id = l.invoice_id
--    where i.number = 1014;                                               → 5288.00, as before
-- ============================================================================
