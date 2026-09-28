-- ============================================================================
-- 148 — CANCELLING AN ORDER CALLS OFF ITS MONEY
-- ============================================================================
--
-- Mark, 2026-09-28, of Cancel Order: "should it unschedule the order? Should
-- it refund the order if it was paid?" — then "build all three". The app now
-- unschedules (068's own function and guards) and names the order's sent
-- invoices in its confirm; this is the money half, which only the database can
-- do in one piece.
--
-- WHAT A CANCELLED ORDER'S MONEY DID BEFORE THIS: nothing. Money HELD on an
-- order (140: a payment applied to the order and no invoice) stayed held. A
-- cancelled order is not owed (`countsAsOwed`), so it never reached an invoice,
-- and held money is not credit (143) — so it sat where no screen shows it.
-- Measured 2026-09-28: 11 cancelled orders hold $1,232.93 (7 from FileMaker,
-- the largest $494.06 on #8097; 4 app-era, $4.80 together).
--
-- WHAT IT DOES NOW, as `cancel_special_order`, all or nothing:
--
--   1. the status becomes Cancelled (054's trigger logs it, as before);
--   2. the order comes off every DRAFT invoice — a draft can still change,
--      and an invoice owns a COPY of its orders' lines (141), so nothing else
--      would take it off;
--   3. money HELD on it becomes the customer's CREDIT: the held applications
--      are removed, so the payment is applied to nothing, which is 143's
--      definition of credit. Credit is applied to the customer's next Square
--      invoice when it is sent, or refunded from their record.
--
-- NOT A REFUND, deliberately (Mark agreed the reasoning, 2026-09-28): a
-- deposit may be non-refundable, a late cancel may carry a fee, the customer
-- may want it on their next order, a refund cannot be taken back, Square's
-- refund books to the wrong accounts (the pinned refund thread), and cash or a
-- cheque cannot be refunded by the app at all. Credit keeps the money visible
-- and leaves that decision to a person, with Refund… one click away.
--
-- A SENT INVOICE IS NOT TOUCHED — it is frozen (141). It changes by Revise…,
-- and two rules here make that come out right:
--
--   4. `revise_customer_invoice` leaves CANCELLED orders out of the revision
--      (143 re-copied every order, a cancelled one at full price). Sending the
--      revision moves the original's money across, and whatever the revision
--      no longer needs stays with its payment as credit — 143's own rule.
--   5. VOIDING an invoice gives a cancelled order's share to CREDIT rather than
--      back to the order (140 held it there, where it would be stranded).
--
-- NO BACKFILL. The 11 orders above keep their held money: the FileMaker ones
-- were cancelled years ago and were almost certainly settled by hand at the
-- time, and credit is applied AUTOMATICALLY to the customer's next Square
-- invoice — turning them into credit would take money off real invoices that
-- nobody is owed. Release one by hand only after checking it.
--
-- UN-CANCELLING does not put the money back on the order: it stays credit,
-- and is applied when the order is next invoiced and sent.
--
-- Run in the Supabase SQL editor after 147. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cancel
-- ----------------------------------------------------------------------------
-- Returns what it did, for the app to say: the drafts it took the order off,
-- the credit it made, and money it had to leave held (an order with no
-- customer has no account to hold credit on).

create or replace function public.cancel_special_order(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  d record;
  v_drafts text[] := '{}';
  v_held numeric(10,2);
  v_credit numeric(10,2) := 0;
begin
  select * into o from special_orders where id = p_order for update;
  -- The special_orders update policy's roles (051), re-checked because this
  -- bypasses it.
  if not found or not user_has_role(o.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'order not found';
  end if;
  if o.kind <> 'order' then
    raise exception 'only an order is cancelled';
  end if;
  if o.status = 'cancelled' then
    raise exception 'order % is already cancelled', o.number;
  end if;

  update special_orders set status = 'cancelled' where id = p_order;

  -- Off every draft. `customer_invoice_is_frozen` is 141's test — sent, void
  -- or holding money — so a draft that has taken a payment is left alone.
  for d in
    select distinct i.id
      from customer_invoice_lines l
      join customer_invoices i on i.id = l.invoice_id
     where l.special_order_id = p_order
       and not customer_invoice_is_frozen(i.id)
  loop
    perform set_config('rf.invoice_line_write', 'on', true);
    delete from customer_invoice_lines where invoice_id = d.id and special_order_id = p_order;
    perform set_config('rf.invoice_line_write', 'off', true);
    perform log_special_order_event(o.org_id, p_order,
              'Removed from invoice ' || customer_invoice_label(d.id) || ' (order cancelled)');
    v_drafts := v_drafts || customer_invoice_label(d.id);
  end loop;

  -- Held money becomes credit. Netted — a refund held on the order goes with
  -- the payment it gave back, so the credit is what is really left.
  select coalesce(sum(a.amount), 0) into v_held
    from payment_applications a
   where a.special_order_id = p_order and a.customer_invoice_id is null;
  if o.customer_id is not null and v_held > 0 then
    perform set_config('rf.suppress_order_log', 'on', true);
    delete from payment_applications
     where special_order_id = p_order and customer_invoice_id is null;
    perform set_config('rf.suppress_order_log', 'off', true);
    v_credit := v_held;
    v_held := 0;
    perform log_special_order_event(o.org_id, p_order,
              format('%s paid on this order is now the customer''s credit',
                     to_char(v_credit, 'FM$999,999,990.00')));
  end if;

  return jsonb_build_object('drafts', to_jsonb(v_drafts), 'credit', v_credit, 'held', v_held);
end;
$$;
revoke all on function public.cancel_special_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_special_order(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. A revision leaves cancelled orders out
-- ----------------------------------------------------------------------------
-- 143's `revise_customer_invoice` IN FULL, changed where marked.

create or replace function public.revise_customer_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_id uuid;
  v_rev int;
  v_pending text;
  g record;
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  if inv.voided_at is not null then
    raise exception 'invoice % is void', customer_invoice_label(p_invoice);
  end if;
  if not customer_invoice_is_frozen(p_invoice) then
    raise exception 'invoice % has not gone out — change it directly', customer_invoice_label(p_invoice);
  end if;
  if customer_invoice_is_pending_revision(p_invoice) then
    raise exception 'invoice % is itself a draft revision — change it directly', customer_invoice_label(p_invoice);
  end if;
  select customer_invoice_label(id) into v_pending
    from customer_invoices
   where revision_of = p_invoice and voided_at is null and sent_at is null
   limit 1;
  if v_pending is not null then
    raise exception 'invoice % is already being revised — open %', customer_invoice_label(p_invoice), v_pending;
  end if;
  if inv.processor = 'quickbooks' and customer_invoice_paid(p_invoice) <> 0 then
    raise exception 'a QuickBooks invoice with money on it cannot be revised here — its payment is QuickBooks''';
  end if;

  select coalesce(max(revision), 1) + 1 into v_rev
    from customer_invoices where org_id = inv.org_id and number = inv.number;

  insert into customer_invoices
    (org_id, customer_id, location_id, number, revision, revision_of, issued_on, due_on, notes, processor, created_by)
  values
    (inv.org_id, inv.customer_id, inv.location_id, inv.number, v_rev, p_invoice,
     org_today(inv.org_id), inv.due_on, inv.notes, inv.processor, auth.uid())
  returning id into v_id;

  -- Its orders, as they are NOW; its deposits and free lines, as they were.
  for g in
    select l.special_order_id, bool_or(l.line_type = 'deposit') as deposit
      from customer_invoice_lines l
      join special_orders so on so.id = l.special_order_id                  -- <<< 148
     where l.invoice_id = p_invoice and l.special_order_id is not null
       and so.status <> 'cancelled'                                          -- <<< 148
     group by l.special_order_id
  loop
    if g.deposit then
      perform set_config('rf.invoice_line_write', 'on', true);
      insert into customer_invoice_lines
        (org_id, invoice_id, special_order_id, line_type, description, qty, unit_price, amount,
         taxable, tax_rate, sort, kind, square_item, order_label)
      select org_id, v_id, special_order_id, line_type, description, qty, unit_price, amount,
             taxable, tax_rate, sort, kind, square_item, order_label
        from customer_invoice_lines
       where invoice_id = p_invoice and special_order_id = g.special_order_id;
      perform set_config('rf.invoice_line_write', 'off', true);
    else
      perform write_order_invoice_lines(v_id, g.special_order_id);
    end if;
  end loop;

  insert into customer_invoice_lines
    (org_id, invoice_id, special_order_id, line_type, description, qty, unit_price, amount, taxable, sort, square_item)
  select org_id, v_id, null, line_type, description, qty, unit_price, amount, false, sort, square_item
    from customer_invoice_lines
   where invoice_id = p_invoice and special_order_id is null;

  perform log_special_order_event(inv.org_id, o.id,
            'Invoice ' || customer_invoice_label(p_invoice) || ' being revised as ' || customer_invoice_label(v_id))
     from (select distinct special_order_id as id from customer_invoice_lines
            where invoice_id = p_invoice and special_order_id is not null) o;

  return v_id;
end;
$$;
revoke all on function public.revise_customer_invoice(uuid) from public, anon, authenticated;
grant execute on function public.revise_customer_invoice(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. A void gives a cancelled order's share to credit
-- ----------------------------------------------------------------------------
-- 140's trigger function IN FULL, changed where marked. The trigger itself is
-- unchanged and is not re-created.

create or replace function public.trg_customer_invoice_void_releases_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;                                                                  -- <<< 148
begin
  if old.voided_at is null and new.voided_at is not null then
    -- 148: a CANCELLED order's share is owed to nobody, so it becomes the
    -- customer's credit — money applied to nothing — rather than money held
    -- on an order that will never be invoiced again.
    for c in
      select o.id, o.org_id, sum(a.amount) as amount
        from payment_applications a
        join special_orders o on o.id = a.special_order_id
       where a.customer_invoice_id = new.id
         and o.status = 'cancelled' and o.customer_id is not null
       group by o.id, o.org_id
    loop
      perform set_config('rf.suppress_order_log', 'on', true);
      delete from payment_applications
       where customer_invoice_id = new.id and special_order_id = c.id;
      perform set_config('rf.suppress_order_log', 'off', true);
      if c.amount > 0 then
        perform log_special_order_event(c.org_id, c.id,
                  format('%s paid on void invoice %s is now the customer''s credit',
                         to_char(c.amount, 'FM$999,999,990.00'), customer_invoice_label(new.id)));
      end if;
    end loop;                                                                -- <<< 148

    update payment_applications
       set customer_invoice_id = null
     where customer_invoice_id = new.id
       and special_order_id is not null;
  end if;
  return null;
end;
$$;
revoke all on function public.trg_customer_invoice_void_releases_payments() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select proname, count(*) from pg_proc
--    where proname in ('cancel_special_order', 'revise_customer_invoice',
--                      'trg_customer_invoice_void_releases_payments')
--    group by proname;                      -- one row each, count 1
