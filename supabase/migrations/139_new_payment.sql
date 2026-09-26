-- ============================================================================
-- 139 — NEW PAYMENT: one invoice per payment asked for
-- ============================================================================
--
-- Mark, 2026-09-25, the same day as 138 and replacing its shape: "imagine a
-- fresh order with no payments yet. It's for a wedding in December. We press
-- [New Payment] … Balance Due, Deposit or Other … Selecting options then
-- pressing Continue generates an invoice for the amount indicated and a note
-- … When the balance due invoice is paid, and our order has a zero balance,
-- then we're done." And: "I think the deposit should only exist once someone
-- asks for it."
--
-- So a deposit is no longer a RATE ON THE ORDER that the invoice and the pay
-- page interpret (138). It is an INVOICE OF ITS OWN, for a fixed amount, made
-- when somebody asks for one. An order can now be on several live invoices —
-- a deposit, a part payment, and one for the balance — and each invoice asks
-- for one figure, so `/pay` is back to one button.
--
-- THE NO-OVERLAP RULE, which is what makes several invoices safe: an order's
-- live invoices never bill the same dollars. What is NOT YET INVOICED is
--   the order's total
--   − payments on no live invoice (a cash payment; one on a voided invoice)
--   − every line on its live invoices, paid or not.
-- A deposit or part payment may ask for at most that. A BALANCE line IS that
-- (for its own invoice), and it keeps following the order as 128 built it —
-- add twenty donuts and the balance invoice grows and says "Changed since
-- sent". A deposit or part-payment line holds the figure it was given.
-- One balance line per order among its live invoices.
--
-- CASH ("Cash Payment" in the dialog) is not an invoice: it is a payment row
-- on the order, as "Take a payment" always wrote. It shrinks what is not yet
-- invoiced like any payment on no invoice.
--
-- THE ORDER IS SETTLED WHEN THE ORDER IS PAID, not when a line is. 124's
-- allocate settled an order the moment its share of an invoice was met — right
-- when an order was on one invoice, wrong now: a paid deposit invoice would
-- have moved a December wedding to Order and asked to print it. It now asks
-- the order's own balance, after the payment.
--
-- 138's deposit machinery comes out: the order's `deposit_rate`, the invoice
-- made on quote approval, and `pay_token_state`'s `deposit_due`. Nothing used
-- them (probed: no order had a rate set). `orgs.settings.special_orders.
-- deposit_rate` stays — it is New Payment's suggested percentage. 138's
-- `claim_pay_token(p_token, p_pay)` stays as it is: with no `deposit_due` it
-- always charges the balance, and keeping its signature means no deploy of
-- `square-pay` has to be timed against this file.
--
-- Run in the Supabase SQL editor after 138. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 138's deposit-on-the-order, withdrawn
-- ----------------------------------------------------------------------------

drop trigger if exists trg_quote_approved_makes_invoice on special_order_quote_tokens;
drop function if exists public.trg_quote_approved_makes_invoice();

-- 131's `pay_token_state`, restored IN FULL (138 added `deposit_due`).
create or replace function public.pay_token_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t   record;
  o   record;
  inv record;
  v_paid numeric(10,2);
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into t from special_order_pay_tokens where token = p_token;
  if not found or t.document_snapshot is null or t.total is null then
    return jsonb_build_object('state', 'unknown');
  end if;

  if t.customer_invoice_id is not null then
    select * into inv from customer_invoices where id = t.customer_invoice_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    if inv.voided_at is not null then
      return jsonb_build_object('state', 'cancelled');
    end if;
    -- 131: paid through QuickBooks' own link, never this one.
    if inv.processor = 'quickbooks' then
      return jsonb_build_object('state', 'superseded');
    end if;
    -- 128: the invoice has changed since this link's send — the customer is
    -- holding the old figures; the re-send carries the new link.
    if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = inv.id) <> t.total then
      return jsonb_build_object('state', 'superseded');
    end if;
    v_paid := customer_invoice_paid(inv.id);
    if t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
  else
    select status, ignore_balance into o from special_orders where id = t.order_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    select coalesce(sum(amount), 0) into v_paid
      from special_order_payments where order_id = t.order_id;
    if o.ignore_balance or t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    if o.status = 'cancelled' then
      return jsonb_build_object('state', 'cancelled');
    end if;
    -- 127: a customer invoice bills this order, so its own link stands down.
    if exists (select 1
                 from customer_invoice_lines l
                 join customer_invoices i on i.id = l.invoice_id
                where l.special_order_id = t.order_id and i.voided_at is null) then
      return jsonb_build_object('state', 'superseded');
    end if;
  end if;

  if t.superseded_at is not null then
    return jsonb_build_object('state', 'superseded');
  end if;

  return jsonb_build_object(
    'state', 'open',
    'invoice', t.document_snapshot,
    'total', t.total,
    'paid', v_paid,
    'balance', t.total - v_paid,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'customer_invoice_id', t.customer_invoice_id,
    'claimed_until', t.claimed_until
  );
end;
$$;

revoke all on function public.pay_token_state(text) from public, anon, authenticated;

drop function if exists public.customer_invoice_deposit(uuid);
drop function if exists public.special_order_deposit(uuid);
alter table special_orders drop constraint if exists special_orders_deposit_rate_range;
alter table special_orders drop column if exists deposit_rate;
-- 138's log watch-list row for `deposit_rate` stays: the loop skips a column
-- the row does not have (118's own rule), and rewriting that function to take
-- one row out is more risk than the row.


-- ----------------------------------------------------------------------------
-- 2. A line says what it asks for
-- ----------------------------------------------------------------------------

alter table customer_invoice_lines
  add column if not exists kind text not null default 'balance';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_invoice_lines_kind_check') then
    alter table customer_invoice_lines
      add constraint customer_invoice_lines_kind_check
      check (kind in ('balance', 'deposit', 'other'));
  end if;
end $$;

comment on column customer_invoice_lines.kind is
  'balance: bills what is not yet invoiced on the order, and follows it (128). '
  'deposit / other: a fixed amount somebody asked for with New Payment. '
  'Migration 139.';


-- ----------------------------------------------------------------------------
-- 3. What is not yet invoiced, and what a line says
-- ----------------------------------------------------------------------------

-- The header's rule. `p_except` leaves one invoice's own lines out — the
-- balance line's invoice, whose lines are what is being worked out.
create or replace function public.special_order_uninvoiced(p_order uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when o.status = 'cancelled' then 0
              else m.total
                   - coalesce((select sum(p.amount)
                                 from special_order_payments p
                                 left join customer_invoices pi on pi.id = p.customer_invoice_id
                                where p.order_id = o.id
                                  and (p.customer_invoice_id is null or pi.voided_at is not null)), 0)
                   - coalesce((select sum(l.amount)
                                 from customer_invoice_lines l
                                 join customer_invoices i on i.id = l.invoice_id
                                where l.special_order_id = o.id
                                  and i.voided_at is null
                                  and l.invoice_id is distinct from p_except), 0)
         end::numeric(10,2)
    from special_orders o, special_order_money(o.id) m
   where o.id = p_order;
$$;

-- "Deposit · Order #10080 · Smith wedding · 12/12/2026". A balance line says
-- "Balance due · …" only when the order is on another live invoice — a
-- weekly wholesale invoice reads exactly as it did.
create or replace function public.invoice_line_text(p_order uuid, p_kind text, p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
           when 'deposit' then 'Deposit · '
           when 'other'   then 'Part payment · '
           else case when exists (select 1
                                    from customer_invoice_lines l
                                    join customer_invoices i on i.id = l.invoice_id
                                   where l.special_order_id = p_order
                                     and i.voided_at is null
                                     and l.invoice_id is distinct from p_invoice)
                     then 'Balance due · ' else '' end
         end || invoice_line_description(p_order);
$$;

revoke all on function public.special_order_uninvoiced(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invoice_line_text(uuid, text, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. The line trigger: a balance line is worked out; a fixed one is checked
-- ----------------------------------------------------------------------------
-- 129's function IN FULL, changed where marked.

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_sync boolean := coalesce(current_setting('rf.invoice_line_sync', true), '') = 'on';
  v_left numeric(10,2);                                                  -- <<< 139
begin
  select sent_at, paid_at, voided_at into inv from customer_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);

  if tg_op = 'INSERT' then
    if inv.sent_at is not null then
      raise exception 'invoice already sent — void it and invoice again';
    end if;
    -- 139: a fixed line keeps its amount, within what is not yet invoiced;
    -- a balance line IS what is not yet invoiced.
    v_left := special_order_uninvoiced(new.special_order_id, new.invoice_id);
    if new.kind = 'balance' then
      new.amount := v_left;
    elsif coalesce(new.amount, 0) <= 0 then
      raise exception 'a deposit or part payment is more than zero';
    elsif new.amount > v_left then
      raise exception 'more than the % not yet invoiced on this order', v_left;
    end if;
    select invoice_line_text(o.id, new.kind, new.invoice_id),
           o.square_item                                                   -- <<< 129
      into new.description, new.square_item
      from special_orders o
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
  -- 139: a deposit or part payment's AMOUNT may be changed by hand while its
  -- invoice is a draft — "the user is taken to the invoice where they can
  -- edit it" — and nothing else about it.
  if new.kind <> 'balance' and old.kind = new.kind
     and new.amount is distinct from old.amount
     and (new.invoice_id, new.special_order_id, new.description, new.sent_amount, new.sort, new.square_item)
         is not distinct from
         (old.invoice_id, old.special_order_id, old.description, old.sent_amount, old.sort, old.square_item) then
    if inv.sent_at is not null or inv.paid_at is not null or inv.voided_at is not null then
      raise exception 'this invoice has gone out — void it and ask again';
    end if;
    if coalesce(new.amount, 0) <= 0 then
      raise exception 'a deposit or part payment is more than zero';
    end if;
    v_left := special_order_uninvoiced(new.special_order_id, new.invoice_id);
    if new.amount > v_left then
      raise exception 'more than the % not yet invoiced on this order', v_left;
    end if;
    return new;
  end if;
  -- 129: Sold as lives on the ORDER now, so it joins the columns only the
  -- sync may write.
  if (new.invoice_id, new.special_order_id, new.description, new.amount, new.sent_amount, new.sort, new.square_item, new.kind)
     is distinct from
     (old.invoice_id, old.special_order_id, old.description, old.amount, old.sent_amount, old.sort, old.square_item, old.kind) then
    raise exception 'an invoice line follows its order — change the order instead';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. The sync: balance lines follow; every line's wording follows
-- ----------------------------------------------------------------------------
-- 129's function IN FULL, changed where marked.

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
    -- 139: only a BALANCE line's amount follows; a fixed line keeps its own.
    v_amount := case when l.kind = 'balance'
                     then special_order_uninvoiced(p_order, l.invoice_id)
                     else l.amount end;
    v_desc := invoice_line_text(p_order, l.kind, l.invoice_id);

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

-- A line arriving, leaving or changing amount (a draft deposit edited) moves
-- what the order's balance line bills; so does an invoice being voided. Not
-- while the sync itself is writing — its own updates must not re-enter it.
create or replace function public.trg_invoice_lines_move_the_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('rf.invoice_line_sync', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'customer_invoices' then
    perform sync_customer_invoice_lines(l.special_order_id)
       from (select distinct special_order_id from customer_invoice_lines where invoice_id = new.id) l;
  else
    perform sync_customer_invoice_lines(coalesce(new.special_order_id, old.special_order_id));
  end if;
  return null;
end;
$$;

revoke all on function public.trg_invoice_lines_move_the_balance() from public, anon, authenticated;

drop trigger if exists trg_invoice_lines_move_the_balance on customer_invoice_lines;
create trigger trg_invoice_lines_move_the_balance
  after insert or delete or update of amount on customer_invoice_lines
  for each row execute function trg_invoice_lines_move_the_balance();

drop trigger if exists trg_invoice_void_moves_the_balance on customer_invoices;
create trigger trg_invoice_void_moves_the_balance
  after update of voided_at on customer_invoices
  for each row
  when (old.voided_at is distinct from new.voided_at)
  execute function trg_invoice_lines_move_the_balance();


-- ----------------------------------------------------------------------------
-- 6. The order is settled when the ORDER is paid
-- ----------------------------------------------------------------------------
-- 124's `allocate_customer_invoice_payment` IN FULL, changed where marked.

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
  v_last uuid;
  v_n int;
  v_inserted int := 0;
begin
  select * into inv from customer_invoices where id = p_invoice;

  select l2.special_order_id into v_last
    from customer_invoice_lines l2
    join special_orders o on o.id = l2.special_order_id
   where l2.invoice_id = p_invoice
   order by o.event_date desc nulls first, o.number desc
   limit 1;

  for l in
    select li.special_order_id, sum(li.amount) as amount,
           min(o.event_date) as event_date, min(o.number) as number
      from customer_invoice_lines li
      join special_orders o on o.id = li.special_order_id
     where li.invoice_id = p_invoice
     group by li.special_order_id
     order by min(o.event_date) nulls last, min(o.number)
  loop
    exit when v_left <= 0;
    select l.amount - coalesce(sum(p.amount), 0) into v_owed
      from special_order_payments p
     where p.customer_invoice_id = p_invoice and p.order_id = l.special_order_id;

    v_share := case
                 when l.special_order_id = v_last then v_left
                 else least(v_left, greatest(v_owed, 0))
               end;
    continue when v_share <= 0;

    insert into special_order_payments
      (org_id, order_id, customer_invoice_id, paid_on, amount, payment_type,
       note, external_ref, created_by)
    values
      (inv.org_id, l.special_order_id, p_invoice, p_today, v_share, p_type,
       nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_ref, '')), ''), p_by)
    on conflict (org_id, external_ref, order_id)
      where payment_type = 'Square Online' and external_ref is not null
    do nothing;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;
    v_left := v_left - v_share;

    -- 139: the ORDER's balance, not this line's share — a paid deposit
    -- invoice leaves the rest of the order owed.
    if (select m.total from special_order_money(l.special_order_id) m)
       - coalesce((select sum(p.amount) from special_order_payments p
                    where p.order_id = l.special_order_id), 0) <= 0 then
      perform settle_special_order_paid(l.special_order_id, p_today);
    end if;
  end loop;

  if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice)
     - customer_invoice_paid(p_invoice) <= 0 then
    update customer_invoices set paid_at = coalesce(paid_at, p_today) where id = p_invoice;
  end if;

  return v_inserted;
end;
$$;

revoke all on function public.allocate_customer_invoice_payment(uuid, numeric, text, text, text, date, uuid)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. Create Invoice… refuses only a second BALANCE invoice
-- ----------------------------------------------------------------------------
-- 126's `create_customer_invoice` IN FULL, changed where marked. Its lines
-- are balance lines (the column's default).

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
   where l.special_order_id = any (v_ids) and i.voided_at is null
     and l.kind = 'balance';                                              -- <<< 139
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
-- 8. New Payment's invoice
-- ----------------------------------------------------------------------------
-- p_kind: 'balance' | 'deposit' | 'other'. A deposit or part payment names
-- its amount; a balance works its own out. A DRAFT, due on the org's terms,
-- with the note on it — the dialog then opens it to be checked and sent.
-- Refuses in words: no linked customer, not a live order, a second balance
-- invoice, nothing left to invoice, more than is left.

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
  v_taken int;
  v_today date;
  v_days int;
  v_number int;
  v_id uuid;
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

  v_left := special_order_uninvoiced(p_order, null);
  if p_kind = 'balance' then
    select i.number into v_taken
      from customer_invoice_lines l
      join customer_invoices i on i.id = l.invoice_id
     where l.special_order_id = p_order and l.kind = 'balance' and i.voided_at is null
     limit 1;
    if v_taken is not null then
      raise exception 'invoice % already bills this order''s balance', v_taken;
    end if;
    if v_left <= 0 then
      raise exception 'nothing is left to invoice on this order';
    end if;
  elsif coalesce(p_amount, 0) <= 0 then
    raise exception 'a deposit or part payment is more than zero';
  elsif p_amount > v_left then
    raise exception 'more than the % not yet invoiced on this order', v_left;
  end if;

  v_today := org_today(o.org_id);
  select coalesce(nullif(settings -> 'customer_invoices' ->> 'terms_days', '')::int, 4)
    into v_days from orgs where id = o.org_id;

  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || o.org_id::text));
  select coalesce(max(number), 1000) + 1 into v_number
    from customer_invoices where org_id = o.org_id;

  insert into customer_invoices
    (org_id, customer_id, number, issued_on, due_on, notes, created_by)
  values
    (o.org_id, o.customer_id, v_number, v_today, v_today + greatest(v_days, 0),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  -- Wording, Sold as and a balance line's amount are the trigger's.
  insert into customer_invoice_lines
    (org_id, invoice_id, special_order_id, description, amount, sort, kind)
  values
    (o.org_id, v_id, p_order, '', case when p_kind = 'balance' then 0 else p_amount end, 0, p_kind);

  perform log_special_order_event(o.org_id, p_order,
    'Added to invoice ' || v_number
    || case p_kind when 'deposit' then ' (deposit of $' || to_char(p_amount, 'FM999999990.00') || ')'
                   when 'other'   then ' (part payment of $' || to_char(p_amount, 'FM999999990.00') || ')'
                   else ' (balance due)' end);

  return v_id;
end;
$$;

revoke all on function public.create_payment_invoice(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_payment_invoice(uuid, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from information_schema.columns
--    where table_name = 'special_orders' and column_name = 'deposit_rate';   → 0
--   select kind, count(*) from customer_invoice_lines group by 1;            → all balance
--   select tgname from pg_trigger where tgname in
--     ('trg_invoice_lines_move_the_balance', 'trg_invoice_void_moves_the_balance',
--      'trg_quote_approved_makes_invoice');                                  → the first two
--   select has_function_privilege('authenticated',
--     'public.create_payment_invoice(uuid,text,numeric,text)', 'execute');   → true
-- ============================================================================
