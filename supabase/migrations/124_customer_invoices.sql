-- ============================================================================
-- 124 — CUSTOMER INVOICES: one invoice, many orders, one pay link
-- ============================================================================
--
-- Mark, 2026-09-23. Cafe Knotted is billed a WEEK at a time — seven standing-
-- order days, one invoice, sent Sunday, due Thursday — and the pay link (119–
-- 123) is keyed to ONE order everywhere: the token, the balance, the payment
-- row and the settle step. This is the record that joins them.
--
-- THE SHAPE IS 025's, FROM THE A/P SIDE. The join to an order is on the LINE,
-- with no unique constraint, so one invoice across seven orders is seven lines
-- and — later — one order billed twice (a deposit, then the balance) is two
-- invoices whose lines point at the same order. Phase 1 only builds the first.
-- Weekly is Knotted's arrangement, not a rule: a one-order invoice is one line,
-- which is how regular special orders will move onto this record later, so
-- there is one workflow for everything.
--
-- ONE LINE PER ORDER, and the amount is the order's WHOLE total, delivery
-- included (Mark: delivery is not its own line on a regular order, so it is not
-- one here). The amount is SNAPSHOTTED — `orderTotals` lives in TypeScript, so
-- the client computes it and `create_customer_invoice` validates the orders —
-- and it FREEZES when the invoice is sent (the trigger in section 2).
--
-- THE ORDER KEEPS ITS OWN STAGE FIELDS, AND THE INVOICE WRITES THROUGH THEM.
-- Production refuses anything not at status `order`, and the list, the
-- progress ladder and the to-do suggestions all read `invoice_sent_at` /
-- `invoice_paid_at`. So sending the invoice stamps each order's sent date, and
-- the payment that settles an order's share applies 121/122's rule to it —
-- now in ONE function, `settle_special_order_paid`, which the per-order pay
-- link calls too, so the two paths cannot drift.
--
-- A PAYMENT STAYS PER ORDER, TAGGED WITH THE INVOICE. One Square payment for a
-- week becomes seven `special_order_payments` rows sharing its id, each that
-- order's share, oldest event first. Every existing reader of an order's
-- payments keeps working. 119's unique index therefore gains `order_id`, so a
-- retried record is still a no-op row by row.
--
-- ONE INVOICE, ONE SQUARE LOCATION. The money lands at the shop that makes the
-- order (120), and a Square payment has one location, so an invoice's orders
-- must all resolve to the same `pay_link_square_location`.
--
-- Run in the Supabase SQL editor after 123. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The invoice and its lines
-- ----------------------------------------------------------------------------

create table if not exists customer_invoices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,

  -- Per org, from 1001. An integer, unlike an order's number: nothing was ever
  -- typed here by hand, so nothing needs a suffix.
  number      integer not null,

  issued_on   date not null,
  due_on      date,
  notes       text,

  -- The invoice's own dates. Its status is DERIVED from these in
  -- `lib/customerInvoices` — draft, sent, paid, void — and never stored.
  sent_at     date,
  paid_at     date,
  voided_at   date,

  -- The PDF as sent, in the special-order-attachments bucket.
  document_path text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),

  unique (org_id, number)
);

create index if not exists customer_invoices_customer_idx
  on customer_invoices (customer_id, issued_on desc);

create table if not exists customer_invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  invoice_id uuid not null references customer_invoices(id) on delete cascade,

  -- RESTRICT: an invoiced order cannot vanish from under the invoice that
  -- charged for it. Delete or void the invoice first.
  special_order_id uuid not null references special_orders(id) on delete restrict,

  description text not null,
  amount      numeric(10,2) not null,
  sort        integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_invoice_lines_invoice_idx
  on customer_invoice_lines (invoice_id, sort);
create index if not exists customer_invoice_lines_order_idx
  on customer_invoice_lines (special_order_id);

drop trigger if exists trg_customer_invoices_updated on customer_invoices;
create trigger trg_customer_invoices_updated before update on customer_invoices
  for each row execute function set_updated_at();
drop trigger if exists trg_customer_invoice_lines_updated on customer_invoice_lines;
create trigger trg_customer_invoice_lines_updated before update on customer_invoice_lines
  for each row execute function set_updated_at();

alter table customer_invoices enable row level security;
alter table customer_invoice_lines enable row level security;

-- Special orders' own policies: every member reads (092), supervisor+ writes.
do $$
declare t text;
begin
  foreach t in array array['customer_invoices', 'customer_invoice_lines'] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format(
      'create policy %I_select on %I for select
         using (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (user_has_role(org_id, array[''owner'', ''admin'', ''purchaser'', ''supervisor'']))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using      (user_has_role(org_id, array[''owner'', ''admin'', ''purchaser'', ''supervisor'']))
         with check (user_has_role(org_id, array[''owner'', ''admin'', ''purchaser'', ''supervisor'']))', t, t);
    execute format(
      'create policy %I_delete on %I for delete
         using (user_has_role(org_id, array[''owner'', ''admin'', ''purchaser'', ''supervisor'']))', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. A sent invoice's lines are frozen
-- ----------------------------------------------------------------------------
-- The pay link charges the total snapshotted at send; a line edited afterwards
-- would make the page and the record disagree. Void it and invoice again.

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent date;
begin
  select sent_at into v_sent from customer_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);
  if v_sent is not null then
    raise exception 'invoice already sent — void it and invoice again';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_lines_frozen on customer_invoice_lines;
create trigger trg_customer_invoice_lines_frozen
  before insert or update or delete on customer_invoice_lines
  for each row execute function trg_customer_invoice_lines_frozen();

-- ----------------------------------------------------------------------------
-- 3. Payments carry the invoice; pay tokens point at an order OR an invoice
-- ----------------------------------------------------------------------------

alter table special_order_payments
  add column if not exists customer_invoice_id uuid
    references customer_invoices(id) on delete set null;

create index if not exists special_order_payments_invoice_idx
  on special_order_payments (customer_invoice_id)
  where customer_invoice_id is not null;

-- 119's index, widened by `order_id`: one Square payment, one row per order.
drop index if exists special_order_payments_square_ref;
create unique index special_order_payments_square_ref
  on special_order_payments (org_id, external_ref, order_id)
  where payment_type = 'Square Online' and external_ref is not null;

alter table special_order_pay_tokens
  alter column order_id drop not null;
alter table special_order_pay_tokens
  add column if not exists customer_invoice_id uuid
    references customer_invoices(id) on delete cascade;

alter table special_order_pay_tokens
  drop constraint if exists special_order_pay_tokens_one_target;
alter table special_order_pay_tokens
  add constraint special_order_pay_tokens_one_target
    check (num_nonnulls(order_id, customer_invoice_id) = 1);

create index if not exists special_order_pay_tokens_invoice_idx
  on special_order_pay_tokens (customer_invoice_id, created_at desc)
  where customer_invoice_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Helpers (internal — no grants)
-- ----------------------------------------------------------------------------

create or replace function public.org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone coalesce(settings ->> 'timezone', 'America/Los_Angeles'))::date
    from orgs where id = p_org;
$$;

-- 121/122's rule, lifted out of `record_pay_link_payment` unchanged: a paid
-- order gets its paid date; a lead/quote/invoice ORDER becomes an order; an
-- empty or answered to-do becomes Schedule Delivery (an unbooked delivery) or
-- Print Order. A typed to-do stays (117).
create or replace function public.settle_special_order_paid(p_order uuid, p_today date)
returns void
language sql
security definer
set search_path = public
as $$
  update special_orders
     set invoice_paid_at = coalesce(invoice_paid_at, p_today),
         status = case
                    when kind = 'order' and status in ('lead', 'quote', 'invoice')
                      then 'order'
                    else status
                  end,
         todo = case
                  when kind = 'order'
                   and status in ('lead', 'quote', 'invoice')
                   and (todo is null or btrim(todo) = ''
                        or todo in ('Send Invoice', 'Invoice Overdue!', 'Respond to Email/Call'))
                    then case
                           when fulfillment = 'delivery' and delivery_scheduled_at is null
                             then 'Schedule Delivery'
                           else 'Print Order'
                         end
                  else todo
                end
   where id = p_order;
$$;

create or replace function public.customer_invoice_paid(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(10,2)
    from special_order_payments where customer_invoice_id = p_invoice;
$$;

-- The Square location an invoice charges into: its first order's (120). The
-- create function refused a mix, so the first speaks for all.
create or replace function public.customer_invoice_square_location(p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pay_link_square_location(l.special_order_id)
    from customer_invoice_lines l
   where l.invoice_id = p_invoice
   order by l.sort nulls last, l.created_at
   limit 1;
$$;

-- Split a payment across the invoice's lines, oldest event first, each up to
-- what is still owed on it. Anything beyond the last line's share lands on the
-- last line — a payment Square has taken is never dropped. Each order whose
-- share is met is settled; the invoice is stamped paid when its balance is.
-- Returns the number of rows inserted (0 = a retried Square payment).
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

    if v_share >= v_owed then
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

revoke all on function public.org_today(uuid) from public, anon, authenticated;
revoke all on function public.settle_special_order_paid(uuid, date) from public, anon, authenticated;
revoke all on function public.customer_invoice_paid(uuid) from public, anon, authenticated;
revoke all on function public.customer_invoice_square_location(uuid) from public, anon, authenticated;
revoke all on function public.allocate_customer_invoice_payment(uuid, numeric, text, text, text, date, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Signed-in commands: create, mark sent, record a payment by hand
-- ----------------------------------------------------------------------------

-- p_lines: [{order_id, description, amount}]. Refuses, by name: an order that
-- is not a live order, orders of more than one customer, orders that charge
-- into different Square locations, and an order already on an invoice that is
-- not void.
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

  -- One number at a time per org.
  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || p_org_id::text));
  select coalesce(max(number), 1000) + 1 into v_number
    from customer_invoices where org_id = p_org_id;

  insert into customer_invoices
    (org_id, customer_id, number, issued_on, due_on, notes, created_by)
  values
    (p_org_id, v_customer, v_number, coalesce(p_issued_on, org_today(p_org_id)),
     p_due_on, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;

  insert into customer_invoice_lines (org_id, invoice_id, special_order_id, description, amount, sort)
  select p_org_id, v_id, (x ->> 'order_id')::uuid, coalesce(x ->> 'description', ''),
         coalesce((x ->> 'amount')::numeric, 0), (n - 1)::int
    from jsonb_array_elements(p_lines) with ordinality as t(x, n);

  perform log_special_order_event(p_org_id, u, 'Added to invoice ' || v_number)
     from unnest(v_ids) u;

  return v_id;
end;
$$;

-- Called by `send-special-order-email` after the mail goes: stamps the
-- invoice and writes through to each order (its sent date; a lead or quote
-- becomes an invoice — DATE_IMPLIES.invoice_sent_at), logging on each.
create or replace function public.mark_customer_invoice_sent(
  p_invoice uuid,
  p_document_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_today date;
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  v_today := org_today(inv.org_id);

  update customer_invoices
     set sent_at = coalesce(sent_at, v_today),
         document_path = coalesce(p_document_path, document_path)
   where id = p_invoice;

  update special_orders o
     set invoice_sent_at = coalesce(o.invoice_sent_at, v_today),
         status = case when o.status in ('lead', 'quote') then 'invoice' else o.status end
   where o.id in (select special_order_id from customer_invoice_lines where invoice_id = p_invoice);

  perform log_special_order_event(inv.org_id, l.special_order_id,
                                  'Invoice ' || inv.number || ' sent')
     from customer_invoice_lines l where l.invoice_id = p_invoice;
end;
$$;

-- A payment taken by hand (a cheque, a Square invoice paid outside the link):
-- the same split as the pay link. Refuses more than the balance, which the pay
-- link never does because Square has already taken the money.
create or replace function public.record_customer_invoice_payment(
  p_invoice uuid,
  p_amount  numeric,
  p_type    text,
  p_paid_on date default null,
  p_note    text default null,
  p_ref     text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_balance numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  if inv.voided_at is not null then
    raise exception 'invoice is void';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'a payment is more than zero';
  end if;
  v_balance := (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice)
               - customer_invoice_paid(p_invoice);
  if p_amount > v_balance then
    raise exception 'more than the % still owed', v_balance;
  end if;
  return allocate_customer_invoice_payment(
    p_invoice, p_amount, p_type, p_ref, p_note,
    coalesce(p_paid_on, org_today(inv.org_id)), auth.uid());
end;
$$;

revoke all on function public.create_customer_invoice(uuid, jsonb, date, date, text) from public, anon, authenticated;
revoke all on function public.mark_customer_invoice_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.record_customer_invoice_payment(uuid, numeric, text, date, text, text) from public, anon, authenticated;
grant execute on function public.create_customer_invoice(uuid, jsonb, date, date, text) to authenticated;
grant execute on function public.mark_customer_invoice_sent(uuid, text) to authenticated;
grant execute on function public.record_customer_invoice_payment(uuid, numeric, text, date, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. The pay link, taught invoices. Every function redefined IN FULL with its
--    arguments unchanged, so 119's grants stand. An ORDER token behaves
--    exactly as before; the branches are the invoice's.
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

  if t.customer_invoice_id is not null then                              -- <<< 124
    select * into inv from customer_invoices where id = t.customer_invoice_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    v_paid := customer_invoice_paid(inv.id);
    -- No `ignore_balance` shortcut: that flag says an order is billed on
    -- something other than its own invoice, and this IS that something.
    if t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    if inv.voided_at is not null then
      return jsonb_build_object('state', 'cancelled');
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

create or replace function public.pay_link_token_location(p_state jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_state ->> 'customer_invoice_id' is not null
             then customer_invoice_square_location((p_state ->> 'customer_invoice_id')::uuid)
           else pay_link_square_location((p_state ->> 'order_id')::uuid)
         end;
$$;

revoke all on function public.pay_link_token_location(jsonb) from public, anon, authenticated;

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
  v_location := pay_link_token_location(s);                              -- <<< 124

  return (s - 'org_id' - 'order_id' - 'customer_invoice_id' - 'claimed_until') || jsonb_build_object(
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
    'customer_invoice_id', s -> 'customer_invoice_id',                  -- <<< 124
    'kind', case when s ->> 'customer_invoice_id' is not null
                 then 'customer_invoice' else 'order' end,             -- <<< 124
    'number', s -> 'invoice' -> 'number',
    'title', s -> 'invoice' -> 'title',
    'balance', s -> 'balance',
    'location_id', pay_link_token_location(s),                          -- <<< 124
    'breakdown', (select breakdown from special_order_pay_tokens
                   where token = p_token),
    'variation_id', pay_link_square_variation((s ->> 'org_id')::uuid)
  );
end;
$$;

create or replace function public.record_pay_link_payment(
  p_token             text,
  p_amount            numeric,
  p_square_payment_id text,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_today date;
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

  v_today := org_today(t.org_id);

  if t.customer_invoice_id is not null then                              -- <<< 124
    v_inserted := allocate_customer_invoice_payment(
      t.customer_invoice_id, p_amount, 'Square Online', p_square_payment_id,
      p_note, v_today, null);
    update special_order_pay_tokens set claimed_until = null where id = t.id;
    v_paid := customer_invoice_paid(t.customer_invoice_id);
    return jsonb_build_object(
      'state', case when v_inserted > 0 then 'recorded' else 'already_recorded' end,
      'org_id', t.org_id,
      'customer_invoice_id', t.customer_invoice_id,
      'paid', v_paid,
      'balance', t.total - v_paid
    );
  end if;

  insert into special_order_payments
    (org_id, order_id, paid_on, amount, payment_type, note, external_ref)
  values
    (t.org_id, t.order_id, v_today, p_amount, 'Square Online',
     nullif(btrim(coalesce(p_note, '')), ''), p_square_payment_id)
  on conflict (org_id, external_ref, order_id)                           -- <<< 124
    where payment_type = 'Square Online' and external_ref is not null
  do nothing;
  get diagnostics v_inserted = row_count;

  update special_order_pay_tokens set claimed_until = null where id = t.id;

  select coalesce(sum(amount), 0) into v_paid
    from special_order_payments where order_id = t.order_id;

  if t.total - v_paid <= 0 then
    perform settle_special_order_paid(t.order_id, v_today);              -- <<< 124
  end if;

  return jsonb_build_object(
    'state', case when v_inserted = 1 then 'recorded' else 'already_recorded' end,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'paid', v_paid,
    'balance', t.total - v_paid
  );
end;
$$;

-- 119's grants, restated because the next person to restate these will copy
-- what is in front of them.
revoke all on function public.pay_token_state(text) from public, anon, authenticated;
revoke all on function public.pay_by_token(text) from public, anon, authenticated;
revoke all on function public.claim_pay_token(text) from public, anon, authenticated;
revoke all on function public.record_pay_link_payment(text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.pay_by_token(text) to anon, authenticated;
grant execute on function public.claim_pay_token(text) to anon, authenticated;
grant execute on function public.record_pay_link_payment(text, numeric, text, text)
  to service_role;

notify pgrst, 'reload schema';
