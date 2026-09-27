-- ============================================================================
-- 143 — REVISE AN INVOICE, AND CUSTOMER CREDIT
-- ============================================================================
--
-- The third phase of the textbook A/R model (Mark, 2026-09-27). 141 froze a
-- sent invoice; this is how one changes: it is REPLACED, never edited.
--
-- REVISE. `revise_customer_invoice` makes a DRAFT with the same number and
-- the next revision — "1014-2" — its orders re-copied as they are now, its
-- deposits and free lines carried over. The original stays live and payable
-- while the revision is a draft: a customer paying 1014 on Wednesday is not
-- told it no longer exists. SENDING the revision replaces it: the original is
-- voided, its money moves to the revision (orders oldest first, the invoice's
-- own lines last), and anything the revision does not need becomes CREDIT.
-- The original's pay link then answers "superseded".
--
-- ONE BILL, NOT TWO. While a revision is a draft, it and the invoice it
-- replaces are one bill: an order's "billed" counts the original and not the
-- draft; the draft's own copy looks past the original ("Less invoice 1014"
-- would bill the order for nothing). A draft revision is a proposal until it
-- is sent.
--
-- CREDIT is money received and applied to nothing — the textbook's unapplied
-- payment: a payment's amount less its applications. Money HELD on an order
-- (140) is not credit; it is earmarked. Credit comes from a revision that
-- needs less, from an overpayment (QuickBooks' page lets a customer pay any
-- amount; 140 put the excess on the last order, which now becomes credit), and
-- it goes out by being APPLIED to an invoice — automatically when the
-- customer's next Square invoice is sent, as QuickBooks does by default, or by
-- hand — or REFUNDED (a Square payment, through `square-refund`).
--
-- A QUICKBOOKS INVOICE is revised only while nothing is paid on it, and credit
-- is never applied to one automatically: QuickBooks would not know, and would
-- ask for the money again.
--
-- Run in the Supabase SQL editor after 142. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Revisions
-- ----------------------------------------------------------------------------

alter table customer_invoices add column if not exists revision int not null default 1;
alter table customer_invoices add column if not exists revision_of uuid references customer_invoices(id);

-- 124's `unique (org_id, number)` becomes (org_id, number, revision). Dropped
-- by DEFINITION, not by a guessed name: an inline constraint's name is
-- Postgres's invention.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'customer_invoices'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (org_id, number)'
  loop
    execute format('alter table customer_invoices drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'customer_invoices_number_revision_key') then
    alter table customer_invoices add constraint customer_invoices_number_revision_key
      unique (org_id, number, revision);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_invoices_revision_check') then
    alter table customer_invoices add constraint customer_invoices_revision_check
      check (revision >= 1 and (revision = 1) = (revision_of is null));
  end if;
end $$;

create index if not exists customer_invoices_revision_of_idx
  on customer_invoices (revision_of) where revision_of is not null;

-- "1014", or "1014-2" — the log's name for an invoice (the paper adds the
-- org's prefix).
create or replace function public.customer_invoice_label(p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select number::text || case when revision > 1 then '-' || revision else '' end
    from customer_invoices where id = p_invoice;
$$;

-- A DRAFT revision: made, not yet sent, not void. Until it is sent it is a
-- proposal, and the invoice it would replace is still the bill.
create or replace function public.customer_invoice_is_pending_revision(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(revision_of is not null and sent_at is null and voided_at is null, false)
    from customer_invoices where id = p_invoice;
$$;

revoke all on function public.customer_invoice_label(uuid) from public, anon, authenticated;
revoke all on function public.customer_invoice_is_pending_revision(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. One bill, not two: what an order is billed
-- ----------------------------------------------------------------------------
-- 141's functions IN FULL, changed where marked: a pending revision is not
-- counted (the original is), and a revision's own figures look past the
-- invoice it replaces.

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
     and l.invoice_id is distinct from p_except
     -- 143: the invoice `p_except` would replace, and any other draft revision
     and i.id is distinct from (select revision_of from customer_invoices where id = p_except)
     and not (i.revision_of is not null and i.sent_at is null);
$$;

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
  v_replaces uuid;
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
  select ci.revision_of into v_replaces from customer_invoices ci where ci.id = p_invoice;   -- <<< 143

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
    select i.number, i.revision, sum(l.amount) as billed
      from customer_invoice_lines l
      join customer_invoices i on i.id = l.invoice_id
     where l.special_order_id = p_order
       and i.voided_at is null
       and i.id is distinct from p_invoice
       and i.id is distinct from v_replaces                                  -- <<< 143
       and not (i.revision_of is not null and i.sent_at is null)            -- <<< 143
     group by i.id, i.number, i.revision
    having sum(l.amount) <> 0
     order by i.number, i.revision
  loop
    line_type := 'prior_billing';
    description := 'Less invoice ' || v_prefix || pb.number
                   || case when pb.revision > 1 then '-' || pb.revision else '' end;
    amount := -pb.billed;
    sort := v_n;
    v_n := v_n + 1;
    return next;
  end loop;
end;
$$;

revoke all on function public.special_order_billed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.order_invoice_lines(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Credit: money received and applied to nothing
-- ----------------------------------------------------------------------------

-- One payment's credit: its amount less every application of it. A refund is
-- a payment of its own (negative, applied to nothing unless it gave back an
-- order's share), so refunding credit is a negative credit that nets it out.
create or replace function public.customer_payment_unapplied(p_payment uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (p.amount - coalesce((select sum(a.amount) from payment_applications a where a.payment_id = p.id), 0))::numeric(10,2)
    from customer_payments p where p.id = p_payment;
$$;

-- A customer's credit, and the payments it is in, oldest first. The credit
-- REFUNDED from a payment is counted against that payment, so the list shows
-- what is still there to use.
create or replace function public.customer_credit(p_customer uuid)
returns table (payment_id uuid, paid_on date, payment_type text, processor text, external_ref text, note text, credit numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from customers where id = p_customer;
  if v_org is null or v_org not in (select user_org_ids()) then
    return;
  end if;
  return query
  select p.id, p.paid_on, p.payment_type, p.processor, p.external_ref, p.note,
         (customer_payment_unapplied(p.id)
          + coalesce((select sum(customer_payment_unapplied(r.id)) from customer_payments r where r.refund_of = p.id), 0)
         )::numeric(10,2)
    from customer_payments p
   where p.customer_id = p_customer
     and p.amount > 0
     and customer_payment_unapplied(p.id)
         + coalesce((select sum(customer_payment_unapplied(r.id)) from customer_payments r where r.refund_of = p.id), 0) > 0.005
   order by p.paid_on nulls last, p.created_at;
end;
$$;

revoke all on function public.customer_payment_unapplied(uuid) from public, anon, authenticated;
revoke all on function public.customer_credit(uuid) from public, anon, authenticated;
grant execute on function public.customer_credit(uuid) to authenticated;

-- Internal: put up to `p_amount` of a payment onto an invoice — each order up
-- to what it still owes there, oldest event first, then the invoice's own
-- lines. What nothing owes stays with the payment: credit. Settles each order
-- the money pays in full, and the invoice when it is. Returns what it applied.
create or replace function public.apply_payment_to_invoice(
  p_payment uuid,
  p_invoice uuid,
  p_amount  numeric,
  p_today   date,
  p_by      uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  g record;
  v_left numeric(10,2) := greatest(coalesce(p_amount, 0), 0);
  v_owed numeric(10,2);
  v_share numeric(10,2);
  v_applied numeric(10,2) := 0;
begin
  select * into inv from customer_invoices where id = p_invoice;
  for g in select * from customer_invoice_payment_groups(p_invoice) x order by x.seq loop
    exit when v_left <= 0;
    select g.amount - coalesce(sum(a.amount), 0) into v_owed
      from payment_applications a
     where a.customer_invoice_id = p_invoice
       and a.special_order_id is not distinct from g.order_id;
    v_share := least(v_left, greatest(v_owed, 0));
    continue when v_share <= 0;
    insert into payment_applications (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
    values (inv.org_id, p_payment, g.order_id, p_invoice, v_share, p_by);
    v_left := v_left - v_share;
    v_applied := v_applied + v_share;
    if g.order_id is not null
       and (select m.total from special_order_money(g.order_id) m) - special_order_paid(g.order_id) <= 0 then
      perform settle_special_order_paid(g.order_id, p_today);
    end if;
  end loop;

  if (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice)
     - customer_invoice_paid(p_invoice) <= 0 then
    update customer_invoices set paid_at = coalesce(paid_at, p_today) where id = p_invoice;
  end if;
  return v_applied;
end;
$$;

revoke all on function public.apply_payment_to_invoice(uuid, uuid, numeric, date, uuid) from public, anon, authenticated;

-- Internal: the customer's credit onto an invoice, oldest payment first, up to
-- what the invoice still owes. Returns what it applied.
create or replace function public.apply_credit_to_invoice(p_invoice uuid, p_today date, p_by uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  c record;
  v_owed numeric(10,2);
  v_applied numeric(10,2) := 0;
  v_one numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  for c in
    select p.id,
           customer_payment_unapplied(p.id)
           + coalesce((select sum(customer_payment_unapplied(r.id)) from customer_payments r where r.refund_of = p.id), 0) as credit
      from customer_payments p
     where p.customer_id = inv.customer_id and p.org_id = inv.org_id and p.amount > 0
     order by p.paid_on nulls last, p.created_at
  loop
    continue when c.credit <= 0.005;
    v_owed := (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice)
              - customer_invoice_paid(p_invoice);
    exit when v_owed <= 0;
    v_one := apply_payment_to_invoice(c.id, p_invoice, least(c.credit, v_owed), p_today, p_by);
    v_applied := v_applied + v_one;
  end loop;
  if v_applied > 0 then
    perform log_special_order_event(inv.org_id, o.id,
              format('%s of credit applied to invoice %s', to_char(v_applied, 'FM$999,999,990.00'),
                     customer_invoice_label(p_invoice)))
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = p_invoice and special_order_id is not null) o;
  end if;
  return v_applied;
end;
$$;

revoke all on function public.apply_credit_to_invoice(uuid, date, uuid) from public, anon, authenticated;

-- Apply Credit, by hand: any invoice still owing that is not void. Not a
-- QuickBooks one — its customer pays through QuickBooks, which would not know.
create or replace function public.apply_customer_credit(p_invoice uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  if inv.voided_at is not null then
    raise exception 'invoice % is void', customer_invoice_label(p_invoice);
  end if;
  if inv.processor = 'quickbooks' then
    raise exception 'a QuickBooks invoice is paid through QuickBooks, which would not know about credit applied here';
  end if;
  return apply_credit_to_invoice(p_invoice, org_today(inv.org_id), auth.uid());
end;
$$;

revoke all on function public.apply_customer_credit(uuid) from public, anon, authenticated;
grant execute on function public.apply_customer_credit(uuid) to authenticated;

-- What is left to refund of a payment's CREDIT (manager and up).
create or replace function public.payment_credit_refundable(p_payment uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p record;
begin
  select * into p from customer_payments where id = p_payment;
  if not found or not user_has_role(p.org_id, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  return greatest(customer_payment_unapplied(p_payment)
         + coalesce((select sum(customer_payment_unapplied(r.id)) from customer_payments r where r.refund_of = p_payment), 0), 0);
end;
$$;

-- `square-refund`'s record of credit given back: a negative payment naming
-- the one it refunds, applied to nothing.
create or replace function public.record_credit_refund(
  p_payment   uuid,
  p_amount    numeric,
  p_refund_id text,
  p_note      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_left numeric(10,2);
  v_id uuid;
begin
  select * into p from customer_payments where id = p_payment;
  if not found or not user_has_role(p.org_id, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  if p.payment_type <> 'Square Online' or p.external_ref is null or p.amount <= 0 then
    raise exception 'only a payment taken through the pay link is refunded from here';
  end if;
  if coalesce(p_amount, 0) <= 0 or nullif(btrim(coalesce(p_refund_id, '')), '') is null then
    raise exception 'a refund is more than zero and names Square''s refund';
  end if;
  v_left := payment_credit_refundable(p_payment);
  if p_amount > v_left then
    raise exception 'only % of this payment is credit', v_left;
  end if;
  insert into customer_payments
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note, refund_of, created_by)
  values
    (p.org_id, p.customer_id, org_today(p.org_id), -p_amount, 'Square Refund', 'square',
     btrim(p_refund_id), nullif(btrim(coalesce(p_note, '')), ''), p.id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.payment_credit_refundable(uuid) from public, anon, authenticated;
revoke all on function public.record_credit_refund(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.payment_credit_refundable(uuid) to authenticated;
grant execute on function public.record_credit_refund(uuid, numeric, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. An invoice payment: what the invoice does not need becomes credit
-- ----------------------------------------------------------------------------
-- 141's `allocate_customer_invoice_payment`, same signature: the payment row
-- as before (one per processor id; a second invoice EXTENDS it), then
-- `apply_payment_to_invoice` — where 140 put an overpayment on the last order,
-- it now stays with the payment as credit.

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
  v_payment uuid;
  v_before int;
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

  select count(*) into v_before from payment_applications where payment_id = v_payment;
  perform apply_payment_to_invoice(v_payment, p_invoice, p_amount, p_today, p_by);
  -- 0 means "already recorded" to the callers; a payment that found nothing
  -- owed is still recorded (it is all credit), so it answers 1.
  return greatest((select count(*) from payment_applications where payment_id = v_payment) - v_before, 1);
end;
$$;

revoke all on function public.allocate_customer_invoice_payment(uuid, numeric, text, text, text, date, uuid)
  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. Revise…
-- ----------------------------------------------------------------------------

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
     where l.invoice_id = p_invoice and l.special_order_id is not null
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
-- 6. Sending: a revision replaces its original; credit is applied
-- ----------------------------------------------------------------------------
-- 141's `mark_customer_invoice_sent` IN FULL, changed where marked.

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

revoke all on function public.mark_customer_invoice_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_customer_invoice_sent(uuid, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 7. The replaced invoice's link, and the log's names
-- ----------------------------------------------------------------------------
-- 140's `pay_token_state` IN FULL, one check added: an invoice replaced by a
-- sent revision answers SUPERSEDED — the customer holds old paper, and the
-- revision's email carries the new link — before the void check says
-- "cancelled", which would read as though they owe nothing.

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
    if exists (select 1 from customer_invoices r                             -- <<< 143
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
  else
    select status, ignore_balance into o from special_orders where id = t.order_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    v_paid := special_order_paid(t.order_id);
    if o.ignore_balance or t.total - v_paid <= 0 then
      return jsonb_build_object('state', 'paid', 'invoice', t.document_snapshot,
                                'total', t.total, 'paid', v_paid);
    end if;
    if o.status = 'cancelled' then
      return jsonb_build_object('state', 'cancelled');
    end if;
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

-- 141's trace, naming the revision.
create or replace function public.trg_customer_invoice_leaves_a_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if tg_op = 'DELETE' then
    v_label := old.number::text || case when old.revision > 1 then '-' || old.revision else '' end;
    perform log_special_order_event(old.org_id, o.id,
                                    'Removed from invoice ' || v_label || ' (draft deleted)')
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = old.id and special_order_id is not null) o;
    return old;
  end if;

  if old.voided_at is null and new.voided_at is not null then
    v_label := new.number::text || case when new.revision > 1 then '-' || new.revision else '' end;
    perform log_special_order_event(new.org_id, o.id, 'Invoice ' || v_label || ' voided')
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = new.id and special_order_id is not null) o;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_leaves_a_trace() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select number, revision, revision_of from customer_invoices order by 1;   → every revision 1, none revising
--   select conname from pg_constraint where conrelid = 'customer_invoices'::regclass and contype = 'u';
--     → customer_invoices_number_revision_key (and no plain (org_id, number))
-- ============================================================================
