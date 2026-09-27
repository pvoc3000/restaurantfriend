-- ============================================================================
-- 140 — THE PAYMENTS LEDGER: a payment is money received; an application says
--       where it went
-- ============================================================================
--
-- Mark, 2026-09-27: "FMP never had invoices and when we added them to
-- Restaurant Friend we tried to make them fit an old, outdated model instead of
-- starting from scratch. Make Restaurant Friend use the textbook model." The
-- plan is five migrations (140–144); this is the first, and it changes where
-- money is RECORDED without changing what any screen shows.
--
-- WHAT WAS WRONG. `special_order_payments` (051) is money on an ORDER. When a
-- customer invoice (124) was paid, one payment was shattered into a row per
-- order, and "what has this invoice collected" became a sum of order rows
-- tagged with it. So a payment could only ever land on an order, excess went
-- to the last order, and there was no record anywhere of "Knotted paid $5,288
-- on Thursday" as one fact.
--
-- THE TEXTBOOK SHAPE, in two tables:
--
--   customer_payments      MONEY RECEIVED — one row per real payment (a
--                          Square payment, a cheque, cash). Signed: a refund
--                          is a negative payment pointing at what it refunds.
--   payment_applications   WHERE IT WENT — one row per slice, naming an order,
--                          an invoice, or both:
--                            order only       held on the order (the textbook
--                                             "customer deposit")
--                            order + invoice  that order's share of an invoice
--                                             payment
--                            invoice only     (141) the invoice's own lines
--
-- An order's paid amount is the sum of its applications; an invoice's is the
-- sum of its. Every reader of the old table gets the same columns from the
-- view `order_payments`, so nothing on screen changes in this migration.
--
-- THE OLD TABLE IS FROZEN, NOT DROPPED. Writes are revoked from signed-in
-- users, so an app that has not been redeployed yet fails LOUDLY ("permission
-- denied") instead of recording money nobody reads. It is dropped in 144,
-- after two weeks of clean parity reports.
--
-- THE BACKFILL KEEPS EVERY ID. Each old row becomes an application with the
-- SAME id, so the Payments tab's row ids, the refund dialog and the order log
-- all still point at the same thing. Old rows that were one Square/QuickBooks
-- payment split across orders (same external_ref) become ONE payment with
-- several applications — the fact the old table could not hold. A row tagged
-- to a VOID invoice becomes money held on its order, which is what 139 already
-- took it to mean.
--
-- IT PROVES ITSELF OR IT DOES NOT HAPPEN. A parity block after the backfill
-- RAISES — which rolls back the whole file, since the SQL editor runs it as one
-- transaction — unless, for every one of the ~8,400 orders, the paid total and
-- the held total are unchanged; for every live invoice, what it collected is
-- unchanged; and every payment is fully applied. It runs on the first
-- application only (when the ledger is empty), so a re-run is safe.
--
-- UNCHANGED, DELIBERATELY: excess on an invoice payment still lands on the
-- invoice's last order (credit arrives in 142, with a screen to show it), and
-- balance lines still follow their orders (that machinery goes in 141).
--
-- Run in the Supabase SQL editor after 139. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The two tables
-- ----------------------------------------------------------------------------

create table if not exists customer_payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  -- Null only for the 8 FileMaker-era payments on orders that never had a
  -- customer; everything recorded from here on names one.
  customer_id  uuid references customers(id) on delete set null,

  paid_on      date,
  -- Signed. A refund is negative and names the payment it gives back.
  amount       numeric(10,2) not null,
  payment_type text,
  -- Who took the money, when a processor did: the key its own id is unique
  -- under. Null for cash, cheques and FileMaker's hand-typed rows.
  processor    text check (processor in ('square', 'quickbooks')),
  external_ref text,
  note         text,
  refund_of    uuid references customer_payments(id) on delete set null,
  legacy_key   text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- One Square payment, one QuickBooks payment: one row, however many orders or
-- invoices it pays. A retried webhook meets this and records nothing.
create unique index if not exists customer_payments_processor_ref
  on customer_payments (org_id, processor, external_ref)
  where processor is not null and external_ref is not null;
create unique index if not exists customer_payments_legacy_key
  on customer_payments (org_id, legacy_key) where legacy_key is not null;
create index if not exists customer_payments_customer_idx
  on customer_payments (customer_id, paid_on);
create index if not exists customer_payments_refund_idx
  on customer_payments (refund_of) where refund_of is not null;

create table if not exists payment_applications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  payment_id  uuid not null references customer_payments(id) on delete cascade,
  -- An order's payments went with it (051), and still do.
  special_order_id    uuid references special_orders(id) on delete cascade,
  -- 124's rule: an invoice deleted from under its payments leaves them on
  -- their orders.
  customer_invoice_id uuid references customer_invoices(id) on delete set null,
  -- Signed, as the payment is.
  amount      numeric(10,2) not null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),

  constraint payment_applications_names_something
    check (num_nonnulls(special_order_id, customer_invoice_id) >= 1)
);

create index if not exists payment_applications_payment_idx
  on payment_applications (payment_id);
create index if not exists payment_applications_order_idx
  on payment_applications (special_order_id) where special_order_id is not null;
create index if not exists payment_applications_invoice_idx
  on payment_applications (customer_invoice_id) where customer_invoice_id is not null;

drop trigger if exists trg_customer_payments_updated on customer_payments;
create trigger trg_customer_payments_updated before update on customer_payments
  for each row execute function set_updated_at();
drop trigger if exists trg_payment_applications_updated on payment_applications;
create trigger trg_payment_applications_updated before update on payment_applications
  for each row execute function set_updated_at();

-- Every member READS (092's rule for everything special orders). Nothing
-- WRITES except the functions below: money moves through a definer that checks
-- the role and keeps the two tables in step, never through a bare insert.
alter table customer_payments enable row level security;
alter table payment_applications enable row level security;

drop policy if exists customer_payments_select on customer_payments;
create policy customer_payments_select on customer_payments for select
  using (org_id in (select user_org_ids()));
drop policy if exists payment_applications_select on payment_applications;
create policy payment_applications_select on payment_applications for select
  using (org_id in (select user_org_ids()));

-- Loud, where RLS alone would be silent: an update or delete with no policy
-- "succeeds" on zero rows.
revoke insert, update, delete on customer_payments from anon, authenticated;
revoke insert, update, delete on payment_applications from anon, authenticated;
revoke all on customer_payments from anon;
revoke all on payment_applications from anon;


-- ----------------------------------------------------------------------------
-- 2. The backfill, and the proof — first run only
-- ----------------------------------------------------------------------------

do $$
declare
  v_old_count int;
  v_bad text;
begin
  if exists (select 1 from payment_applications) then
    raise notice '140: the ledger already holds applications — backfill and parity skipped';
    return;
  end if;

  -- One payment per real payment. Rows a processor split across orders share
  -- its id; everything else is its own payment. The earliest row's id becomes
  -- the payment's.
  create temp table p140 on commit drop as
  select p.*,
         case
           when p.payment_type in ('Square Online', 'QuickBooks Payments', 'Square Refund')
                and nullif(btrim(p.external_ref), '') is not null
             then p.org_id::text || '|' || p.payment_type || '|' || btrim(p.external_ref)
           else p.id::text
         end as grp
    from special_order_payments p;

  create temp table h140 on commit drop as
  select grp,
         (array_agg(id order by created_at, id))[1] as head_id,
         sum(amount)::numeric(10,2) as total
    from p140
   group by grp;

  insert into customer_payments
    (id, org_id, customer_id, paid_on, amount, payment_type, processor,
     external_ref, note, legacy_key, created_at, created_by, updated_at)
  select h.head_id, p.org_id, o.customer_id, p.paid_on, h.total, p.payment_type,
         case p.payment_type
           when 'Square Online'       then 'square'
           when 'Square Refund'       then 'square'
           when 'QuickBooks Payments' then 'quickbooks'
         end,
         nullif(btrim(p.external_ref), ''), p.note, p.legacy_key,
         p.created_at, p.created_by, p.updated_at
    from h140 h
    join p140 p on p.id = h.head_id
    left join special_orders o on o.id = p.order_id
  on conflict (id) do nothing;

  insert into payment_applications
    (id, org_id, payment_id, special_order_id, customer_invoice_id, amount, created_at, created_by, updated_at)
  select p.id, p.org_id, h.head_id, p.order_id,
         -- A tag to a VOID invoice becomes money held on the order (139's
         -- reading of it); a live tag stays.
         case when i.voided_at is null then p.customer_invoice_id end,
         p.amount, p.created_at, p.created_by, p.updated_at
    from p140 p
    join h140 h on h.grp = p.grp
    left join customer_invoices i on i.id = p.customer_invoice_id
  on conflict (id) do nothing;

  -- ---- THE PROOF. Any mismatch raises, and the whole file rolls back. ----

  select count(*) into v_old_count from special_order_payments;
  if (select count(*) from payment_applications a
       where a.id in (select id from special_order_payments)) <> v_old_count then
    raise exception '140 parity: % old rows, but not as many applications', v_old_count;
  end if;

  if (select coalesce(sum(amount), 0) from special_order_payments)
     <> (select coalesce(sum(amount), 0) from customer_payments) then
    raise exception '140 parity: the payments do not add up to the old rows';
  end if;

  -- Every payment is exactly the sum of where it went.
  select string_agg(p.id::text, ', ') into v_bad
    from customer_payments p
   where p.amount <> (select coalesce(sum(a.amount), 0) from payment_applications a where a.payment_id = p.id);
  if v_bad is not null then
    raise exception '140 parity: payments not fully applied: %', v_bad;
  end if;

  -- Every order: the same paid total, and the same HELD total (what 139's
  -- `special_order_uninvoiced` subtracts), so no balance line moves.
  with old_o as (
    select p.order_id,
           sum(p.amount) as paid,
           sum(p.amount) filter (where p.customer_invoice_id is null or i.voided_at is not null) as held
      from special_order_payments p
      left join customer_invoices i on i.id = p.customer_invoice_id
     group by p.order_id
  ), new_o as (
    select a.special_order_id as order_id,
           sum(a.amount) as paid,
           sum(a.amount) filter (where a.customer_invoice_id is null or i.voided_at is not null) as held
      from payment_applications a
      left join customer_invoices i on i.id = a.customer_invoice_id
     group by a.special_order_id
  )
  select string_agg(coalesce(o.order_id, n.order_id)::text, ', ') into v_bad
    from old_o o full join new_o n on n.order_id = o.order_id
   where coalesce(o.paid, 0) <> coalesce(n.paid, 0)
      or coalesce(o.held, 0) <> coalesce(n.held, 0);
  if v_bad is not null then
    raise exception '140 parity: orders whose payments moved: %', v_bad;
  end if;

  -- Every live invoice: the same collected.
  with old_i as (
    select customer_invoice_id as id, sum(amount) as paid
      from special_order_payments where customer_invoice_id is not null group by 1
  ), new_i as (
    select customer_invoice_id as id, sum(amount) as paid
      from payment_applications where customer_invoice_id is not null group by 1
  )
  select string_agg(i.number::text, ', ') into v_bad
    from customer_invoices i
    left join old_i o on o.id = i.id
    left join new_i n on n.id = i.id
   where i.voided_at is null
     and coalesce(o.paid, 0) <> coalesce(n.paid, 0);
  if v_bad is not null then
    raise exception '140 parity: invoices whose collected moved: %', v_bad;
  end if;

  raise notice '140: % old rows → % payments, parity holds',
    v_old_count, (select count(*) from customer_payments);
end $$;


-- ----------------------------------------------------------------------------
-- 3. The old table: frozen
-- ----------------------------------------------------------------------------

revoke insert, update, delete on special_order_payments from anon, authenticated;
drop trigger if exists trg_special_order_payments_invoice on special_order_payments;
drop trigger if exists trg_special_order_payments_log on special_order_payments;


-- ----------------------------------------------------------------------------
-- 4. What the screens read: `order_payments`
-- ----------------------------------------------------------------------------
-- The old table's columns, row for row — `id` is the application's, which is
-- the old row's id for everything the backfill carried over. Security INVOKER,
-- so the reader's own RLS applies (a definer view would hand every row to
-- anyone who can see the view).

create or replace view public.order_payments
  with (security_invoker = true) as
select a.id,
       a.org_id,
       a.special_order_id    as order_id,
       a.customer_invoice_id,
       a.payment_id,
       p.paid_on,
       a.amount,
       p.payment_type,
       p.note,
       p.external_ref,
       p.processor,
       p.refund_of,
       p.customer_id,
       a.created_at
  from payment_applications a
  join customer_payments p on p.id = a.payment_id
 where a.special_order_id is not null;

revoke all on public.order_payments from anon;
grant select on public.order_payments to authenticated;


-- ----------------------------------------------------------------------------
-- 5. The ledger's sums, where 124/139 summed the old table
-- ----------------------------------------------------------------------------

create or replace function public.customer_invoice_paid(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(10,2)
    from payment_applications where customer_invoice_id = p_invoice;
$$;

-- What an order has been paid, every application counted.
create or replace function public.special_order_paid(p_order uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(10,2)
    from payment_applications where special_order_id = p_order;
$$;

-- 139's rule, over the ledger: money HELD on the order (or left on a voided
-- invoice) counts against what is left to invoice, as a payment on no live
-- invoice always did.
create or replace function public.special_order_uninvoiced(p_order uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when o.status = 'cancelled' then 0
              else m.total
                   - coalesce((select sum(a.amount)
                                 from payment_applications a
                                 left join customer_invoices pi on pi.id = a.customer_invoice_id
                                where a.special_order_id = o.id
                                  and (a.customer_invoice_id is null or pi.voided_at is not null)), 0)
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

revoke all on function public.customer_invoice_paid(uuid) from public, anon, authenticated;
revoke all on function public.special_order_paid(uuid) from public, anon, authenticated;
revoke all on function public.special_order_uninvoiced(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 6. An invoice payment: ONE payment, an application per order
-- ----------------------------------------------------------------------------
-- 139's `allocate_customer_invoice_payment`, same signature and the same split
-- (oldest event first, each order up to what it is still owed here, anything
-- beyond on the last order, an order settled when ITS balance reaches zero).
-- What changed is what it writes: one `customer_payments` row and one
-- application per order, instead of N copies of the payment.
--
-- IDEMPOTENT PER (PAYMENT, INVOICE). A processor's id is unique per org, so a
-- retried Square payment finds its row; one QuickBooks payment that pays TWO
-- invoices arrives as two calls with the same id, and the second EXTENDS the
-- payment with its own applications instead of being mistaken for a replay.
-- Returns the number of applications written — 0 means "already recorded".

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
    -- The processor's id is already here. The same invoice again is a replay;
    -- another invoice is the same payment paying it too.
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
    select l.amount - coalesce(sum(a.amount), 0) into v_owed
      from payment_applications a
     where a.customer_invoice_id = p_invoice and a.special_order_id = l.special_order_id;

    v_share := case
                 when l.special_order_id = v_last then v_left
                 else least(v_left, greatest(v_owed, 0))
               end;
    continue when v_share <= 0;

    insert into payment_applications
      (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
    values
      (inv.org_id, v_payment, l.special_order_id, p_invoice, v_share, p_by);
    v_written := v_written + 1;
    v_left := v_left - v_share;

    -- 139: the ORDER's balance, not this line's share — a paid deposit
    -- invoice leaves the rest of the order owed.
    if (select m.total from special_order_money(l.special_order_id) m)
       - special_order_paid(l.special_order_id) <= 0 then
      perform settle_special_order_paid(l.special_order_id, p_today);
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
-- 7. The processors' writes
-- ----------------------------------------------------------------------------

-- 131's QuickBooks webhook write. The duplicate check now asks the ledger:
-- this QuickBooks payment, already on this invoice. A VOID invoice takes
-- nothing (its money would be moved straight back to the orders, and a replay
-- would then add it again).
create or replace function public.record_qbo_invoice_payment(
  p_realm       text,
  p_qbo_invoice text,
  p_amount      numeric,
  p_payment_id  text,
  p_paid_on     date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  inv   record;
  v_n   int;
begin
  if p_amount is null or p_amount <= 0 then
    return 'no amount';
  end if;

  select org_id into v_org
    from accounting_connections
   where provider = 'qbo' and realm_id = p_realm;
  if v_org is null then
    return 'unknown company';
  end if;

  select * into inv
    from customer_invoices
   where org_id = v_org
     and external_ref -> 'qbo' ->> 'id' = p_qbo_invoice;
  if not found then
    return 'not ours';
  end if;
  if inv.processor <> 'quickbooks' then
    return 'not a quickbooks invoice';
  end if;
  if inv.voided_at is not null then                                      -- <<< 140
    return 'void';
  end if;

  if exists (select 1                                                    -- <<< 140
               from payment_applications a
               join customer_payments p on p.id = a.payment_id
              where p.org_id = v_org and p.processor = 'quickbooks'
                and p.external_ref = p_payment_id
                and a.customer_invoice_id = inv.id) then
    return 'duplicate';
  end if;

  v_n := allocate_customer_invoice_payment(
    inv.id, p_amount, 'QuickBooks Payments', p_payment_id,
    'Paid through QuickBooks', coalesce(p_paid_on, org_today(v_org)), null);

  return case when v_n > 0 then 'recorded' else 'duplicate' end;
end;
$$;

revoke all on function public.record_qbo_invoice_payment(text, text, numeric, text, date)
  from public, anon, authenticated;
grant execute on function public.record_qbo_invoice_payment(text, text, numeric, text, date)
  to service_role;

-- 124's `record_pay_link_payment`, same signature and return. The invoice
-- branch is unchanged (allocate does the writing); the ORDER branch writes a
-- payment held on its order.
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
  v_payment uuid;
begin
  select * into t from special_order_pay_tokens where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_square_payment_id), '') = '' then
    return jsonb_build_object('state', 'invalid');
  end if;

  v_today := org_today(t.org_id);

  if t.customer_invoice_id is not null then
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

  insert into customer_payments                                          -- <<< 140
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note)
  select t.org_id, o.customer_id, v_today, p_amount, 'Square Online', 'square',
         btrim(p_square_payment_id), nullif(btrim(coalesce(p_note, '')), '')
    from special_orders o where o.id = t.order_id
  on conflict (org_id, processor, external_ref)
    where processor is not null and external_ref is not null
  do nothing
  returning id into v_payment;

  if v_payment is not null then
    insert into payment_applications (org_id, payment_id, special_order_id, amount)
    values (t.org_id, v_payment, t.order_id, p_amount);
  end if;

  update special_order_pay_tokens set claimed_until = null where id = t.id;

  v_paid := special_order_paid(t.order_id);                              -- <<< 140

  if t.total - v_paid <= 0 then
    perform settle_special_order_paid(t.order_id, v_today);
  end if;

  return jsonb_build_object(
    'state', case when v_payment is not null then 'recorded' else 'already_recorded' end,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'paid', v_paid,
    'balance', t.total - v_paid
  );
end;
$$;

revoke all on function public.record_pay_link_payment(text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.record_pay_link_payment(text, numeric, text, text)
  to service_role;

-- 139's `pay_token_state` IN FULL; only the order branch's paid sum changed.
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
    v_paid := special_order_paid(t.order_id);                            -- <<< 140
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


-- ----------------------------------------------------------------------------
-- 8. Signed-in commands: money on an order, by hand
-- ----------------------------------------------------------------------------
-- Supervisor and up, as 051's policies were. Each writes a payment and its one
-- application together; neither table takes a bare insert.

-- Internal: a payment held on one order.
create or replace function public.record_held_payment(
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
  v_payment uuid;
begin
  select id, org_id, customer_id into o from special_orders where id = p_order;
  if not found then
    raise exception 'order not found';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'a payment is not zero';
  end if;

  insert into customer_payments (org_id, customer_id, paid_on, amount, payment_type, note, created_by)
  values (o.org_id, o.customer_id, coalesce(p_paid_on, org_today(o.org_id)), p_amount,
          nullif(btrim(coalesce(p_type, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), p_by)
  returning id into v_payment;

  insert into payment_applications (org_id, payment_id, special_order_id, amount, created_by)
  values (o.org_id, v_payment, p_order, p_amount, p_by);

  return v_payment;
end;
$$;

revoke all on function public.record_held_payment(uuid, numeric, date, text, text, uuid)
  from public, anon, authenticated;

-- New Payment… ▸ "The order — no invoice", and the Paid-in-full offer.
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
  return record_held_payment(p_order, p_amount, p_paid_on, p_type, p_note, auth.uid());
end;
$$;

-- The list's Record Payment… on a selection: [{order_id, amount, paid_on,
-- payment_type, note}], all or nothing — a half-recorded batch of money is
-- the worst version of half-finished. Returns how many were recorded.
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
    perform record_held_payment(
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

-- One field of a payment, from its row on an order's Payments tab (the row is
-- an APPLICATION; the date, method and note belong to the PAYMENT, and so to
-- every order it paid). The amount only for a payment that went to this one
-- place and was typed by a person: a processor's figure is the processor's.
create or replace function public.update_order_payment(
  p_application uuid,
  p_column      text,
  p_value       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_amount numeric(10,2);
begin
  select ap.id, ap.payment_id, p.org_id, p.processor
    into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'payment not found';
  end if;

  case p_column
    when 'paid_on' then
      update customer_payments set paid_on = nullif(btrim(coalesce(p_value, '')), '')::date
       where id = a.payment_id;
    when 'payment_type' then
      update customer_payments set payment_type = nullif(btrim(coalesce(p_value, '')), '')
       where id = a.payment_id;
    when 'note' then
      update customer_payments set note = nullif(btrim(coalesce(p_value, '')), '')
       where id = a.payment_id;
    when 'amount' then
      if a.processor is not null then
        raise exception 'this payment was taken by %, so its amount is theirs — refund it instead',
          case a.processor when 'square' then 'Square' else 'QuickBooks' end;
      end if;
      if (select count(*) from payment_applications where payment_id = a.payment_id) <> 1 then
        raise exception 'this payment was split across several orders, so its amount cannot be changed from one of them';
      end if;
      v_amount := nullif(btrim(coalesce(p_value, '')), '')::numeric;
      if v_amount is null or v_amount = 0 then
        raise exception 'a payment is not zero';
      end if;
      update customer_payments set amount = v_amount where id = a.payment_id;
      update payment_applications set amount = v_amount where id = p_application;
    else
      raise exception 'not a payment field: %', p_column;
  end case;
end;
$$;

-- The ×. A payment that went to one place goes; one split across several
-- orders cannot be removed from just one of them.
create or replace function public.delete_order_payment(p_application uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  select ap.payment_id, p.org_id into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'payment not found';
  end if;
  if (select count(*) from payment_applications where payment_id = a.payment_id) <> 1 then
    raise exception 'this payment was split across several orders, so it cannot be removed from one of them';
  end if;
  delete from customer_payments where id = a.payment_id;
end;
$$;

-- What is left to refund of one order's share of a pay-link payment: the
-- share, less what has been refunded against it. (Square's own figure, which
-- counts refunds made in its dashboard, is the edge function's to apply.)
-- Manager and up, as `square-refund` is.
create or replace function public.payment_refundable(p_application uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a record;
begin
  select ap.*, p.org_id as p_org into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.p_org, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  return a.amount + coalesce((
    select sum(ra.amount)
      from payment_applications ra
      join customer_payments rp on rp.id = ra.payment_id
     where rp.payment_type = 'Square Refund'
       and ra.special_order_id is not distinct from a.special_order_id
       and ra.customer_invoice_id is not distinct from a.customer_invoice_id
       -- A refund made here names its payment; one carried over from the old
       -- table cannot, and counted against the order's share as 124 did.
       and (rp.refund_of = a.payment_id or rp.refund_of is null)
  ), 0);
end;
$$;

-- `square-refund`'s record, once Square has accepted: a negative payment
-- naming the one it gives back, applied where the original was.
create or replace function public.record_payment_refund(
  p_application uuid,
  p_amount      numeric,
  p_refund_id   text,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_left numeric(10,2);
  v_payment uuid;
begin
  select ap.id, ap.special_order_id, ap.customer_invoice_id, ap.amount,
         p.id as payment_id, p.org_id, p.customer_id, p.payment_type, p.external_ref
    into a
    from payment_applications ap
    join customer_payments p on p.id = ap.payment_id
   where ap.id = p_application;
  if not found or not user_has_role(a.org_id, array['owner', 'admin']) then
    raise exception 'payment not found';
  end if;
  if a.payment_type <> 'Square Online' or a.external_ref is null or a.amount <= 0 then
    raise exception 'only a payment taken through the pay link is refunded from here';
  end if;
  if coalesce(p_amount, 0) <= 0 or nullif(btrim(coalesce(p_refund_id, '')), '') is null then
    raise exception 'a refund is more than zero and names Square''s refund';
  end if;
  v_left := payment_refundable(p_application);
  if p_amount > v_left then
    raise exception 'only % of this payment is left to refund', v_left;
  end if;

  insert into customer_payments
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note, refund_of, created_by)
  values
    (a.org_id, a.customer_id, org_today(a.org_id), -p_amount, 'Square Refund', 'square',
     btrim(p_refund_id), nullif(btrim(coalesce(p_note, '')), ''), a.payment_id, auth.uid())
  returning id into v_payment;

  insert into payment_applications
    (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
  values
    (a.org_id, v_payment, a.special_order_id, a.customer_invoice_id, -p_amount, auth.uid());

  return v_payment;
end;
$$;

revoke all on function public.record_order_payment(uuid, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.record_order_payments(jsonb) from public, anon, authenticated;
revoke all on function public.update_order_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_order_payment(uuid) from public, anon, authenticated;
revoke all on function public.payment_refundable(uuid) from public, anon, authenticated;
revoke all on function public.record_payment_refund(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_order_payment(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.record_order_payments(jsonb) to authenticated;
grant execute on function public.update_order_payment(uuid, text, text) to authenticated;
grant execute on function public.delete_order_payment(uuid) to authenticated;
grant execute on function public.payment_refundable(uuid) to authenticated;
grant execute on function public.record_payment_refund(uuid, numeric, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 9. The triggers — created AFTER the backfill, so carrying 6,500 old rows
--    across neither re-syncs every invoice line nor writes 6,500 log lines
-- ----------------------------------------------------------------------------

-- 128's payments-follow rule, over applications: money HELD on an order moves
-- what its balance lines bill; money on an invoice moves whether it is paid (a
-- refund reopens it).
create or replace function public.trg_invoice_follows_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid := coalesce(new.special_order_id, old.special_order_id);
begin
  if v_order is not null
     and (coalesce(new.customer_invoice_id, old.customer_invoice_id) is null
          or (tg_op = 'UPDATE' and new.customer_invoice_id is distinct from old.customer_invoice_id)) then
    perform sync_customer_invoice_lines(v_order);
  end if;
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

drop trigger if exists trg_payment_applications_invoice on payment_applications;
create trigger trg_payment_applications_invoice
  after insert or update or delete on payment_applications
  for each row execute function trg_invoice_follows_payments();

-- 054's history lines, from the ledger. An application arriving or leaving is
-- a payment recorded or removed ON THAT ORDER, in 054's own words; its amount
-- changing is an edit. A move between an invoice and the order (a void) is
-- the void's own line (130), so it says nothing here.
create or replace function public.trg_log_payment_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if coalesce(new.special_order_id, old.special_order_id) is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select payment_type into v_type from customer_payments where id = new.payment_id;
    perform log_special_order_event(
      new.org_id, new.special_order_id,
      format('Payment of %s recorded%s',
             to_char(coalesce(new.amount, 0), 'FM$999,999,990.00'),
             coalesce(' · ' || nullif(btrim(v_type), ''), ''))
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform log_special_order_event(
      old.org_id, old.special_order_id,
      format('Payment of %s removed', to_char(coalesce(old.amount, 0), 'FM$999,999,990.00'))
    );
    return null;
  end if;

  if new.amount is distinct from old.amount and new.special_order_id is not null then
    perform log_special_order_event(
      new.org_id, new.special_order_id,
      format('Payment — %s',
             special_order_change_phrase('amount', 'amount', old.amount::text, new.amount::text))
    );
  end if;
  return null;
end;
$$;

-- The payment's own fields, logged on every order it paid.
create or replace function public.trg_log_customer_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watch text[][] := array[
    ['paid_on',      'date'],
    ['payment_type', 'method'],
    ['note',         'note'],
    ['external_ref', 'reference']
  ];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_parts text[] := '{}';
  v_phrase text;
  i int;
begin
  for i in 1 .. array_length(v_watch, 1) loop
    v_phrase := special_order_change_phrase(
      v_watch[i][1], v_watch[i][2],
      v_old ->> v_watch[i][1], v_new ->> v_watch[i][1]
    );
    if v_phrase is not null then
      v_parts := v_parts || v_phrase;
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  perform log_special_order_event(new.org_id, o.special_order_id,
                                  format('Payment — %s', array_to_string(v_parts, '; ')))
     from (select distinct special_order_id from payment_applications
            where payment_id = new.id and special_order_id is not null) o;
  return null;
end;
$$;

revoke all on function public.trg_log_payment_application() from public, anon, authenticated;
revoke all on function public.trg_log_customer_payment() from public, anon, authenticated;

drop trigger if exists trg_payment_applications_log on payment_applications;
create trigger trg_payment_applications_log
  after insert or update or delete on payment_applications
  for each row execute function trg_log_payment_application();

drop trigger if exists trg_customer_payments_log on customer_payments;
create trigger trg_customer_payments_log
  after update on customer_payments
  for each row execute function trg_log_customer_payment();

-- A VOIDED invoice gives its money back to its orders: what was applied to it
-- becomes money held on each order (139 already counted it that way; now the
-- ledger says so). The void's own log line is 130's.
create or replace function public.trg_customer_invoice_void_releases_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    update payment_applications
       set customer_invoice_id = null
     where customer_invoice_id = new.id
       and special_order_id is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.trg_customer_invoice_void_releases_payments() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_void_releases_payments on customer_invoices;
create trigger trg_customer_invoice_void_releases_payments
  after update of voided_at on customer_invoices
  for each row execute function trg_customer_invoice_void_releases_payments();

-- An order deleted takes its payments with it, as 051's cascade did — the
-- payments, not just their applications, or the money would linger as a
-- credit nobody can see. Only payments that went nowhere else; the log is
-- quiet, since the order and its history are going too (100).
create or replace function public.trg_special_order_takes_its_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('rf.suppress_order_log', 'on', true);
  delete from customer_payments p
   where p.id in (select payment_id from payment_applications where special_order_id = old.id)
     and not exists (select 1 from payment_applications x
                      where x.payment_id = p.id
                        and x.special_order_id is distinct from old.id);
  perform set_config('rf.suppress_order_log', 'off', true);
  return old;
end;
$$;

revoke all on function public.trg_special_order_takes_its_payments() from public, anon, authenticated;

drop trigger if exists trg_special_order_takes_its_payments on special_orders;
create trigger trg_special_order_takes_its_payments
  before delete on special_orders
  for each row execute function trg_special_order_takes_its_payments();

-- A payment is the customer's. When an order changes hands, the payments that
-- went only to that order follow it.
create or replace function public.trg_special_order_payments_follow_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update customer_payments p
     set customer_id = new.customer_id
   where p.id in (select payment_id from payment_applications where special_order_id = new.id)
     and not exists (select 1 from payment_applications x
                      where x.payment_id = p.id
                        and x.special_order_id is distinct from new.id)
     and p.customer_id is distinct from new.customer_id;
  return null;
end;
$$;

revoke all on function public.trg_special_order_payments_follow_customer() from public, anon, authenticated;

drop trigger if exists trg_special_order_payments_follow_customer on special_orders;
create trigger trg_special_order_payments_follow_customer
  after update of customer_id on special_orders
  for each row
  when (old.customer_id is distinct from new.customer_id)
  execute function trg_special_order_payments_follow_customer();

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select count(*) from customer_payments;            → 6,495 or fewer (grouped)
--   select count(*) from payment_applications;         → 6,495
--   select count(*) from order_payments;               → 6,495
--   select has_table_privilege('authenticated', 'special_order_payments', 'insert');  → false
--   select has_function_privilege('anon', 'public.record_order_payment(uuid,numeric,date,text,text)', 'execute');  → false
--   select has_function_privilege('authenticated', 'public.record_order_payment(uuid,numeric,date,text,text)', 'execute');  → true
-- ============================================================================
