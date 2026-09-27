-- ============================================================================
-- 145 — CLEAN-UP (the textbook A/R model, phase 5)
-- ============================================================================
--
-- Mark, 2026-09-27: "The existing invoices were all tests. The app won't be
-- live until October 1st. We can do the cleanup now" — so the two weeks of
-- parity reports the plan waited for are not needed. What the rebuild left
-- behind, each checked for callers (in the database, the app and the edge
-- functions) before it goes:
--
-- 1. `special_order_payments` — FileMaker's payments table, frozen since 140
--    (writes revoked, triggers dropped) while the ledger proved itself. No
--    function, view or key reads it; 140's parity block and every
--    `check-ledger-parity` run since agreed row for row.
-- 2. `create_customer_invoice(org, lines jsonb, …)` — 124's shape, kept by 141
--    as a wrapper. Nothing calls it; `create_customer_invoice(org, customer,
--    shop, orders[], …)` is the one.
-- 3. `special_order_uninvoiced` — 139's "what is left to invoice", replaced by
--    141's `special_order_unbilled`. Nothing calls it.
-- 4. `customer_invoice_lines.sent_amount` — 128's per-line record of what
--    went out, for "changed since sent". A sent invoice has not changed since
--    141, so it only ever equalled `amount`. Its two writers are redefined
--    below without it, then it goes.
-- 5. PAY LINKS FOR AN ORDER (119) — since 2026-09-23 an order's Send ▸
--    Invoice goes through a customer invoice, so no order link has been made
--    since; none exists. Every link names an invoice now: the order branches
--    of `pay_token_state`, `claim_pay_token`, `record_pay_link_payment` and
--    the two location/variation readers go, then the token's `order_id`, and
--    `customer_invoice_id` is required. `square-pay`, the email function and
--    the pay page drop theirs in the same change.
--
-- KEPT, though the plan listed it: `customer_invoice_lines.kind`. It is the
-- only record of whether a deposit line is a Deposit or a Part payment
-- (`line_type` is 'deposit' for both), and 141's functions still read it.
--
-- Run in the Supabase SQL editor after 144. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Refuse if a pay link still names an order
-- ----------------------------------------------------------------------------

do $$
declare
  v_n int;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'special_order_pay_tokens'
                and column_name = 'order_id') then
    execute 'select count(*) from special_order_pay_tokens where order_id is not null' into v_n;
    if v_n > 0 then
      raise exception '145: % pay links still name an order', v_n;
    end if;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1–3. The old table and the two functions nothing calls
-- ----------------------------------------------------------------------------

drop table if exists public.special_order_payments;
drop function if exists public.create_customer_invoice(uuid, jsonb, date, date, text);
drop function if exists public.special_order_uninvoiced(uuid, uuid);

-- ----------------------------------------------------------------------------
-- 4. `sent_amount`: its two writers without it, then the column
-- ----------------------------------------------------------------------------

-- 141's trigger IN FULL; only the Sold-as comparison loses the column.
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
          new.amount, new.taxable, new.tax_rate, new.sort, new.kind, new.order_label)
         is not distinct from
         (old.invoice_id, old.special_order_id, old.line_type, old.description, old.qty, old.unit_price,
          old.amount, old.taxable, old.tax_rate, old.sort, old.kind, old.order_label) then
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

-- 143's `mark_customer_invoice_sent` IN FULL, less the copy of each line's
-- amount into `sent_amount`.
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
  mv record;
  v_open numeric(10,2);
  v_held numeric(10,2);
  v_take numeric(10,2);
  v_moved numeric(10,2);
  v_carried numeric(10,2);
  v_credit numeric(10,2);
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

  -- 143: A REVISION REPLACES ITS ORIGINAL. The original is voided (130's
  -- trace logs it) and every payment on it moves here, spread as a payment
  -- is; what this invoice does not need stays with its payment as credit. A
  -- refund moves WITH the payment it gave back — netted against it — or the
  -- revision would count money that already went back to the card.
  if not v_resend and inv.revision_of is not null then
    perform set_config('rf.suppress_order_log', 'on', true);
    v_carried := 0;
    for mv in
      select coalesce(p.refund_of, p.id) as root, sum(a.amount) as amount
        from payment_applications a
        join customer_payments p on p.id = a.payment_id
       where a.customer_invoice_id = inv.revision_of
       group by coalesce(p.refund_of, p.id)
    loop
      delete from payment_applications a
       using customer_payments p
       where p.id = a.payment_id
         and a.customer_invoice_id = inv.revision_of
         and coalesce(p.refund_of, p.id) = mv.root;
      if mv.amount > 0 then
        v_carried := v_carried + apply_payment_to_invoice(mv.root, p_invoice, mv.amount, v_today, auth.uid());
      end if;
    end loop;
    perform set_config('rf.suppress_order_log', 'off', true);
    update customer_invoices set voided_at = coalesce(voided_at, v_today)
     where id = inv.revision_of;
    if v_carried > 0 then
      perform log_special_order_event(inv.org_id, o.id,
                format('%s paid on invoice %s moved to %s', to_char(v_carried, 'FM$999,999,990.00'),
                       customer_invoice_label(inv.revision_of), customer_invoice_label(p_invoice)))
         from (select distinct special_order_id as id from customer_invoice_lines
                where invoice_id = p_invoice and special_order_id is not null) o;
    end if;
  end if;

  -- MONEY HELD ON ITS ORDERS APPLIES NOW (141), then the customer's CREDIT
  -- (143). Neither on a QuickBooks invoice, which cannot know about it.
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
        format('%s already paid applied to invoice %s', to_char(v_moved, 'FM$999,999,990.00'),
               customer_invoice_label(p_invoice)));
      perform set_config('rf.suppress_order_log', 'on', true);
    end loop;
    perform set_config('rf.suppress_order_log', 'off', true);

    v_credit := apply_credit_to_invoice(p_invoice, v_today, auth.uid());   -- <<< 143
  end if;

  perform log_special_order_event(inv.org_id, o.id,
                                  'Invoice ' || customer_invoice_label(p_invoice)
                                  || case when v_resend then ' re-sent' else ' sent' end
                                  || case when not v_resend and inv.revision_of is not null
                                          then ' (replaces ' || customer_invoice_label(inv.revision_of) || ')'
                                          else '' end)
     from (select distinct special_order_id as id from customer_invoice_lines
            where invoice_id = p_invoice and special_order_id is not null) o;

  perform settle_special_order_paid(o.id, v_today)
     from (select distinct l.special_order_id as id from customer_invoice_lines l
            where l.invoice_id = p_invoice and l.special_order_id is not null) o
     join special_orders so on so.id = o.id
    where (select m.total from special_order_money(o.id) m) - special_order_paid(o.id) <= 0
      and so.invoice_paid_at is null;
end;
$$;

alter table customer_invoice_lines drop column if exists sent_amount;

-- ----------------------------------------------------------------------------
-- 5. Pay links name an invoice
-- ----------------------------------------------------------------------------

create or replace function public.pay_token_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t   record;
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

  select * into inv from customer_invoices where id = t.customer_invoice_id;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  -- 143: a sent revision replaces this invoice.
  if exists (select 1 from customer_invoices r
              where r.revision_of = inv.id and r.sent_at is not null and r.voided_at is null) then
    return jsonb_build_object('state', 'superseded');
  end if;
  if inv.voided_at is not null then
    return jsonb_build_object('state', 'cancelled');
  end if;
  if inv.processor = 'quickbooks' then
    return jsonb_build_object('state', 'superseded');
  end if;
  if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = inv.id) <> t.total then
    return jsonb_build_object('state', 'superseded');
  end if;
  v_paid := customer_invoice_paid(inv.id);
  if t.total - v_paid <= 0 then
    return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                              'total', t.total, 'paid', v_paid);
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
    'customer_invoice_id', t.customer_invoice_id,
    'claimed_until', t.claimed_until
  );
end;
$$;

-- The Square location and item a link charges into: the invoice's.
create or replace function public.pay_link_token_location(p_state jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select customer_invoice_square_location((p_state ->> 'customer_invoice_id')::uuid);
$$;

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
  select bool_and(l.square_item = 'wholesale') into v_wholesale
    from customer_invoice_lines l
   where l.invoice_id = (p_state ->> 'customer_invoice_id')::uuid
     and l.special_order_id is not null;
  return pay_link_item_variation(
    v_org, case when coalesce(v_wholesale, false) then 'wholesale' else 'special_order' end);
end;
$$;

-- `square-pay`'s claim. `kind` stays, always 'customer_invoice', so a
-- `square-pay` deployed before this migration reads it the same way.
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
    'customer_invoice_id', s -> 'customer_invoice_id',
    'kind', 'customer_invoice',
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',
    'balance', case when p_pay = 'deposit' and s ? 'deposit_due'
                    then s -> 'deposit_due' else s -> 'balance' end,
    'is_deposit', (p_pay = 'deposit' and s ? 'deposit_due'),
    'location_id', pay_link_token_location(s),
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_token_variation(s),
    'items', (select jsonb_agg(jsonb_build_object(
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

create or replace function public.record_pay_link_payment(
  p_token text,
  p_amount numeric,
  p_square_payment_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_paid numeric(10,2);
  v_inserted int;
begin
  select * into t from special_order_pay_tokens where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_square_payment_id), '') = '' then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_inserted := allocate_customer_invoice_payment(
    t.customer_invoice_id, p_amount, 'Square Online', p_square_payment_id,
    p_note, org_today(t.org_id), null);
  update special_order_pay_tokens set claimed_until = null where id = t.id;
  v_paid := customer_invoice_paid(t.customer_invoice_id);
  return jsonb_build_object(
    'state', case when v_inserted > 0 then 'recorded' else 'already_recorded' end,
    'org_id', t.org_id,
    'customer_invoice_id', t.customer_invoice_id,
    'paid', v_paid,
    'balance', t.total - v_paid
  );
end;
$$;

-- Only `pay_link_token_location`'s order branch read it.
drop function if exists public.pay_link_square_location(uuid);

alter table special_order_pay_tokens drop constraint if exists special_order_pay_tokens_one_target;
alter table special_order_pay_tokens drop column if exists order_id;
alter table special_order_pay_tokens alter column customer_invoice_id set not null;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select to_regclass('public.special_order_payments');   → null
--   select column_name from information_schema.columns
--    where table_name in ('customer_invoice_lines', 'special_order_pay_tokens')
--      and column_name in ('sent_amount', 'order_id');   → no rows
-- ============================================================================
