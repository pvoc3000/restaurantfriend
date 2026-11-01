-- ============================================================================
-- 218 — CUSTOMER CREDIT MEMOS
--
-- SQL STARTS AT SECTION 1. Everything above it is comment.
--
-- docs/customer-credit-memos-brief.md, phases 1 and 2's ledger. 217 made the
-- delivery record and the tables; this issues memos and makes their credit
-- work like a payment's.
--
-- 1. A MEMO IS A SECOND SOURCE OF CREDIT. `payment_applications.payment_id`
--    becomes nullable beside a new `credit_memo_id`, exactly one set. Every
--    reader that SUMS applications (an invoice's paid, an order's paid, the
--    receivable, frozen) therefore counts memo credit without a change; every
--    reader that JOINS the payment (refunds, edits, the Payments tab's view)
--    is taught it below or never sees a memo row.
--    Rejected (brief §5): a fake "Credit Memo" payment row — every cash
--    reader would have to learn to skip it — and a negative invoice.
-- 2. `issue_credit_memo` (a short, from 217's delivery record, capped by it)
--    and `issue_allowance` (an amount and a reason). Manager and up. A short's
--    discount, rush and tax lines are worked out so that billed − credited
--    equals what the target quantity comes to, TO THE CENT — which is what
--    lets 217's billing see "nothing left to bill" rather than a penny.
-- 3. HOW IT IS SETTLED. 'credit': applied to the customer's next invoice when
--    it is sent, MEMOS FIRST (Mark, 2026-10-31), and only to an invoice the
--    same processor collects (a QuickBooks memo is a QuickBooks CreditMemo,
--    linked there by `qbo-sync`; a Square one has no QuickBooks trace).
--    'refund' (§6a): the processor gives the money back and
--    `record_credit_memo_refund` books both halves at once — the memo applied
--    to the invoice it credits, the refund taken back off it — so that invoice
--    stays paid in full.
-- 4. CHANGES. A memo is frozen once issued. Void only while nothing of it is
--    applied. An invoice a live memo credits cannot be voided or revised (the
--    memo and a revision would correct it twice); voiding an invoice a memo
--    was APPLIED to gives the credit back.
-- 5. The Payments tab's view, the statement's view, `customer_balances`, the
--    credit list and the QuickBooks payment reader learn the new source.
--
-- Run after 217. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The second source
-- ----------------------------------------------------------------------------
alter table payment_applications alter column payment_id drop not null;
alter table payment_applications
  add column if not exists credit_memo_id uuid references customer_credit_memos(id) on delete cascade,
  -- The QuickBooks Payment that applied a QuickBooks memo there, so reading it
  -- back is never mistaken for cash (brief §8).
  add column if not exists qbo_payment_id text;
alter table payment_applications drop constraint if exists payment_applications_one_source;
alter table payment_applications add constraint payment_applications_one_source
  check (num_nonnulls(payment_id, credit_memo_id) = 1);
create index if not exists payment_applications_memo on payment_applications (credit_memo_id);

-- A memo's total, and what of it has not been applied.
create or replace function public.credit_memo_total(p_memo uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(10,2) from customer_credit_memo_lines where memo_id = p_memo;
$$;
revoke all on function public.credit_memo_total(uuid) from public, anon;
grant execute on function public.credit_memo_total(uuid) to authenticated;

create or replace function public.credit_memo_unapplied(p_memo uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (credit_memo_total(p_memo)
          - coalesce((select sum(amount) from payment_applications where credit_memo_id = p_memo), 0))::numeric(10,2);
$$;
revoke all on function public.credit_memo_unapplied(uuid) from public, anon;
grant execute on function public.credit_memo_unapplied(uuid) to authenticated;

create or replace function public.credit_memo_label(p_memo uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(g.settings -> 'customer_credit_memos' ->> 'prefix', '') || m.number
    from customer_credit_memos m join orgs g on g.id = m.org_id
   where m.id = p_memo;
$$;
revoke all on function public.credit_memo_label(uuid) from public, anon;
grant execute on function public.credit_memo_label(uuid) to authenticated;

create or replace function public.next_credit_memo_number(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v int;
begin
  perform pg_advisory_xact_lock(hashtext('customer_credit_memo_number:' || p_org::text));
  select settings -> 'customer_credit_memos' ->> 'first_number' into v_first from orgs where id = p_org;
  select greatest(coalesce(max(number), 0) + 1,
                  case when v_first ~ '^[0-9]{1,9}$' then v_first::int else 10000 end)
    into v
    from customer_credit_memos
   where org_id = p_org;
  return v;
end;
$$;
revoke all on function public.next_credit_memo_number(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Applying a memo to an invoice — 140's `apply_payment_to_invoice`, spread
--    across the invoice's orders the same way, with the memo as the source.
-- ----------------------------------------------------------------------------
create or replace function public.apply_memo_to_invoice(p_memo uuid, p_invoice uuid, p_amount numeric,
                                                        p_today date, p_by uuid, p_qbo_payment text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  g record;
  v_left numeric(10,2) := least(greatest(coalesce(p_amount, 0), 0), credit_memo_unapplied(p_memo));
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
    insert into payment_applications
      (org_id, credit_memo_id, special_order_id, customer_invoice_id, amount, qbo_payment_id, created_by)
    values (inv.org_id, p_memo, g.order_id, p_invoice, v_share, p_qbo_payment, p_by);
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
revoke all on function public.apply_memo_to_invoice(uuid, uuid, numeric, date, uuid, text) from public, anon, authenticated;

-- The memos that could credit an invoice, oldest first, with what each would
-- give. A memo applies only to an invoice its processor collects, and a
-- QuickBooks memo only once it is in QuickBooks.
create or replace function public.invoice_memo_credit(p_invoice uuid)
returns table (memo_id uuid, label text, issued_on date, qbo_id text, amount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv record;
  c record;
  v_owed numeric(10,2);
  v_take numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or inv.org_id not in (select user_org_ids()) or inv.voided_at is not null then
    return;
  end if;
  v_owed := (select coalesce(sum(l.amount), 0) from customer_invoice_lines l where l.invoice_id = p_invoice)
            - customer_invoice_paid(p_invoice);
  for c in
    select m.id, m.issued_on, m.external_ref -> 'qbo' ->> 'id' as qbo, credit_memo_unapplied(m.id) as left_
      from customer_credit_memos m
     where m.customer_id = inv.customer_id and m.org_id = inv.org_id
       and m.voided_at is null and m.settlement = 'credit'
       and m.processor = inv.processor
       and (m.processor <> 'quickbooks' or m.external_ref -> 'qbo' ->> 'id' is not null)
     order by m.issued_on, m.number
  loop
    exit when v_owed <= 0;
    continue when c.left_ <= 0.005;
    v_take := least(c.left_, v_owed);
    memo_id := c.id; label := credit_memo_label(c.id); issued_on := c.issued_on; qbo_id := c.qbo; amount := v_take;
    return next;
    v_owed := v_owed - v_take;
  end loop;
end;
$$;
revoke all on function public.invoice_memo_credit(uuid) from public, anon;
grant execute on function public.invoice_memo_credit(uuid) to authenticated;

-- 143's `apply_credit_to_invoice`, MEMOS FIRST (<<< 218), then payments.
-- Payments only on a Square invoice, as before (its callers already keep a
-- QuickBooks invoice away; QuickBooks memo credit goes through
-- `record_qbo_memo_application`, which posts it there too).
create or replace function public.apply_credit_to_invoice(p_invoice uuid, p_today date, p_by uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  c record;
  mc record;
  v_owed numeric(10,2);
  v_applied numeric(10,2) := 0;
  v_one numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;

  -- <<< 218: memos first, oldest first
  if inv.processor = 'square' then
    for mc in select * from invoice_memo_credit(p_invoice) loop
      v_one := apply_memo_to_invoice(mc.memo_id, p_invoice, mc.amount, p_today, p_by);
      v_applied := v_applied + v_one;
    end loop;
  end if;
  -- >>> 218

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

-- 143's Apply Credit, by hand. A QuickBooks invoice takes MEMO credit only,
-- and only through QuickBooks (`qbo-sync`'s `apply_memo_credit`), so here it is
-- still refused.
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
    raise exception 'a QuickBooks invoice takes credit memo credit through QuickBooks — use Apply Credit Memo';
  end if;
  return apply_credit_to_invoice(p_invoice, org_today(inv.org_id), auth.uid());
end;
$$;

-- What `qbo-sync` records once QuickBooks has applied a memo (its own zero
-- Payment, or QuickBooks' automatic one). Idempotent on the Payment's id.
create or replace function public.record_qbo_memo_application(p_memo uuid, p_invoice uuid, p_amount numeric, p_qbo_payment text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  m record;
  v numeric(10,2);
begin
  select * into inv from customer_invoices where id = p_invoice;
  if not found or not user_has_role(inv.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'invoice not found';
  end if;
  select * into m from customer_credit_memos where id = p_memo and org_id = inv.org_id;
  if not found or m.voided_at is not null or m.customer_id <> inv.customer_id
     or m.processor <> 'quickbooks' or inv.processor <> 'quickbooks' then
    raise exception 'that credit memo cannot credit invoice %', customer_invoice_label(p_invoice);
  end if;
  if nullif(btrim(coalesce(p_qbo_payment, '')), '') is null then
    raise exception 'a QuickBooks application names its QuickBooks payment';
  end if;
  if exists (select 1 from payment_applications where credit_memo_id = p_memo and qbo_payment_id = p_qbo_payment) then
    return 0;
  end if;
  v := apply_memo_to_invoice(p_memo, p_invoice, p_amount, org_today(inv.org_id), auth.uid(), p_qbo_payment);
  if v > 0 then
    perform log_special_order_event(inv.org_id, o.id,
              format('Credit memo %s: %s applied to invoice %s', credit_memo_label(p_memo),
                     to_char(v, 'FM$999,999,990.00'), customer_invoice_label(p_invoice)))
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = p_invoice and special_order_id is not null) o;
  end if;
  return v;
end;
$$;
revoke all on function public.record_qbo_memo_application(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_qbo_memo_application(uuid, uuid, numeric, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. Issuing
-- ----------------------------------------------------------------------------
-- Who collects the invoice a memo corrects. An allowance with no invoice takes
-- the customer's latest live invoice's processor, else Square.
create or replace function public.credit_memo_processor(p_customer uuid, p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select processor from customer_invoices where id = p_invoice),
    (select processor from customer_invoices
      where customer_id = p_customer and voided_at is null
      order by issued_on desc, number desc limit 1),
    'square');
$$;
revoke all on function public.credit_memo_processor(uuid, uuid) from public, anon, authenticated;

-- A SHORT. `p_lines`: [{ "item_id": uuid, "qty": number }], each at most what
-- the delivery record leaves creditable (217's `order_delivery_items`), at the
-- price it was billed at. `p_settlement`: 'credit' or 'refund'.
create or replace function public.issue_credit_memo(p_order uuid, p_invoice uuid, p_lines jsonb,
                                                    p_note text, p_settlement text default 'credit')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  inv record;
  r record;
  d record;
  pr record;
  cr record;
  tm record;
  v_id uuid;
  v_n int := 0;
  v_amount numeric(10,2);
  v_line numeric(10,2);
  v_total numeric(10,2);
  v_reason text;
  v_what text[] := '{}';
begin
  select * into o from special_orders where id = p_order for update;
  if not found or not user_has_role(o.org_id, array['owner', 'admin']) then
    raise exception 'only a manager or the owner issues a credit memo';
  end if;
  if o.customer_id is null then
    raise exception 'order % has no customer to credit', o.number;
  end if;
  if coalesce(p_settlement, '') not in ('credit', 'refund') then
    raise exception 'a memo is applied as credit or refunded';
  end if;
  select * into inv from customer_invoices where id = p_invoice and org_id = o.org_id;
  if not found or inv.voided_at is not null or not customer_invoice_is_frozen(p_invoice)
     or not exists (select 1 from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order) then
    raise exception 'a credit memo corrects an invoice that billed order % and went out', o.number;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a credit memo credits at least one line';
  end if;
  select coalesce(settings -> 'customer_credit_memos' ->> 'short_reason', 'Short shipment') into v_reason
    from orgs where id = o.org_id;

  insert into customer_credit_memos
    (org_id, customer_id, number, kind, reason_code, note, issued_on, credits_invoice_id, special_order_id,
     location_id, processor, settlement, created_by)
  values
    (o.org_id, o.customer_id, next_credit_memo_number(o.org_id), 'short_shipment', v_reason,
     nullif(btrim(coalesce(p_note, '')), ''), org_today(o.org_id), p_invoice, p_order,
     inv.location_id, inv.processor, p_settlement, auth.uid())
  returning id into v_id;

  -- The items, capped by the record.
  for r in select (x ->> 'item_id')::uuid as item_id, (x ->> 'qty')::numeric as qty
             from jsonb_array_elements(p_lines) x loop
    continue when coalesce(r.qty, 0) = 0;
    select * into d from order_delivery_items(p_order) z where z.item_id = r.item_id;
    if not found then
      raise exception 'that line is not on order %', o.number;
    end if;
    if r.qty < 0 or r.qty > d.creditable then
      raise exception '% — at most % can be credited: billed %, delivered %, already credited %',
        d.name, d.creditable, d.billed_qty, d.delivered, d.credited_qty;
    end if;
    v_amount := round(r.qty * coalesce(d.billed_price, 0), 2);
    insert into customer_credit_memo_lines
      (org_id, memo_id, special_order_id, special_order_item_id, line_type, description, qty, unit_price,
       amount, taxable, sort)
    values
      (o.org_id, v_id, p_order, r.item_id, 'item',
       format('%s — short %s, delivered %s of %s', d.name,
              rtrim(rtrim(to_char(r.qty, 'FM999999990.99'), '0'), '.'),
              rtrim(rtrim(to_char(d.delivered, 'FM999999990.99'), '0'), '.'),
              rtrim(rtrim(to_char(d.billed_qty, 'FM999999990.99'), '0'), '.')),
       r.qty, d.billed_price, v_amount, d.taxable, v_n);
    v_n := v_n + 1;
    v_what := v_what || format('%s %s', rtrim(rtrim(to_char(r.qty, 'FM999999990.99'), '0'), '.'), d.name);
  end loop;
  if v_n = 0 then
    raise exception 'a credit memo credits at least one line';
  end if;

  -- The share of discount, rush and tax those items carried: whatever makes
  -- billed − credited come to what the new target bills, to the cent (217's
  -- billing then sees nothing left to bill). The items above are already
  -- counted as credited; these lines are not yet.
  select coalesce(-sum(p.amount) filter (where p.line_type = 'discount'), 0) as discount,
         coalesce(sum(p.amount) filter (where p.line_type = 'rush'), 0) as rush,
         coalesce(sum(p.amount) filter (where p.line_type = 'tax'), 0) as tax
    into pr
    from order_prior_invoice_lines(p_order, null) p;
  select * into cr from special_order_credited(p_order);
  select * into tm from special_order_target_money(p_order, null);

  v_line := -((pr.discount - cr.discount) - tm.discount);
  if v_line <> 0 then
    insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort)
    values (o.org_id, v_id, p_order, 'discount', 'Discount on the items credited', v_line, 1000);
  end if;
  v_line := (pr.rush - cr.rush) - tm.rush;
  if v_line <> 0 then
    insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort)
    values (o.org_id, v_id, p_order, 'rush', 'Rush fee on the items credited', v_line, 1002);
  end if;
  v_line := (pr.tax - cr.tax) - tm.tax;
  if v_line <> 0 then
    insert into customer_credit_memo_lines
      (org_id, memo_id, special_order_id, line_type, description, amount, tax_rate, sort)
    values (o.org_id, v_id, p_order, 'tax', 'Sales tax', v_line, o.tax_rate, 1003);
  end if;

  v_total := credit_memo_total(v_id);
  if v_total <= 0 then
    raise exception 'this credit memo comes to nothing';
  end if;

  perform log_special_order_event(o.org_id, p_order,
    format('Credit memo %s issued, %s (%s), crediting invoice %s%s', credit_memo_label(v_id),
           to_char(v_total, 'FM$999,999,990.00'), array_to_string(v_what, ', '),
           customer_invoice_label(p_invoice),
           case when p_settlement = 'refund' then ' — to be refunded' else '' end));
  perform refresh_order_short_todo(p_order);
  return v_id;
end;
$$;
revoke all on function public.issue_credit_memo(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.issue_credit_memo(uuid, uuid, jsonb, text, text) to authenticated;

-- AN ALLOWANCE: an amount and a reason, no quantity, untaxed (v1). It may name
-- an order and an invoice for the record; that changes nothing about billing.
create or replace function public.issue_allowance(p_customer uuid, p_amount numeric, p_reason text, p_note text,
                                                  p_order uuid default null, p_invoice uuid default null,
                                                  p_settlement text default 'credit')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_id uuid;
  v_reasons jsonb;
  v_processor text;
  v_inv record;
begin
  select * into c from customers where id = p_customer;
  if not found or not user_has_role(c.org_id, array['owner', 'admin']) then
    raise exception 'only a manager or the owner issues an allowance';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'an allowance is more than zero';
  end if;
  if coalesce(p_settlement, '') not in ('credit', 'refund') then
    raise exception 'a memo is applied as credit or refunded';
  end if;
  select settings -> 'customer_credit_memos' -> 'allowance_reasons' into v_reasons from orgs where id = c.org_id;
  if nullif(btrim(coalesce(p_reason, '')), '') is null
     or (v_reasons is not null and not v_reasons ? btrim(p_reason)) then
    raise exception 'an allowance takes one of the reasons in Settings';
  end if;
  if p_order is not null and not exists (select 1 from special_orders where id = p_order and customer_id = p_customer) then
    raise exception 'that order is not this customer''s';
  end if;
  if p_invoice is not null then
    select * into v_inv from customer_invoices where id = p_invoice and customer_id = p_customer;
    if not found or v_inv.voided_at is not null then
      raise exception 'that invoice is not this customer''s, or is void';
    end if;
  end if;
  if p_settlement = 'refund' and (p_invoice is null or not customer_invoice_is_frozen(p_invoice)) then
    raise exception 'a refunded allowance names the invoice that was paid';
  end if;
  v_processor := credit_memo_processor(p_customer, p_invoice);

  insert into customer_credit_memos
    (org_id, customer_id, number, kind, reason_code, note, issued_on, credits_invoice_id, special_order_id,
     location_id, processor, settlement, created_by)
  values
    (c.org_id, p_customer, next_credit_memo_number(c.org_id), 'allowance', btrim(p_reason),
     nullif(btrim(coalesce(p_note, '')), ''), org_today(c.org_id), p_invoice, p_order,
     (select location_id from customer_invoices where id = p_invoice), v_processor, p_settlement, auth.uid())
  returning id into v_id;
  insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort)
  values (c.org_id, v_id, p_order, 'allowance',
          btrim(p_reason) || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
          round(p_amount, 2), 0);

  if p_order is not null then
    perform log_special_order_event(c.org_id, p_order,
      format('Allowance %s issued, %s (%s)', credit_memo_label(v_id),
             to_char(round(p_amount, 2), 'FM$999,999,990.00'), btrim(p_reason)));
  end if;
  return v_id;
end;
$$;
revoke all on function public.issue_allowance(uuid, numeric, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.issue_allowance(uuid, numeric, text, text, uuid, uuid, text) to authenticated;

-- Changing how an UNAPPLIED memo is settled (a refund that could not be made
-- becomes credit, or the other way).
create or replace function public.set_credit_memo_settlement(p_memo uuid, p_settlement text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from customer_credit_memos where id = p_memo for update;
  if not found or not user_has_role(m.org_id, array['owner', 'admin']) then
    raise exception 'credit memo not found';
  end if;
  if m.voided_at is not null then
    raise exception 'credit memo % is void', credit_memo_label(p_memo);
  end if;
  if coalesce(p_settlement, '') not in ('credit', 'refund') then
    raise exception 'a memo is applied as credit or refunded';
  end if;
  if exists (select 1 from payment_applications where credit_memo_id = p_memo) then
    raise exception 'credit memo % is already applied', credit_memo_label(p_memo);
  end if;
  if p_settlement = 'refund' and m.credits_invoice_id is null then
    raise exception 'a refunded memo names the invoice that was paid';
  end if;
  update customer_credit_memos set settlement = p_settlement where id = p_memo;
end;
$$;
revoke all on function public.set_credit_memo_settlement(uuid, text) from public, anon;
grant execute on function public.set_credit_memo_settlement(uuid, text) to authenticated;

-- VOID, while nothing of it is applied (QuickBooks first, by `qbo-sync`).
create or replace function public.void_credit_memo(p_memo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from customer_credit_memos where id = p_memo for update;
  if not found or not user_has_role(m.org_id, array['owner', 'admin']) then
    raise exception 'credit memo not found';
  end if;
  if m.voided_at is not null then
    return;
  end if;
  if exists (select 1 from payment_applications where credit_memo_id = p_memo) then
    raise exception 'credit memo % is applied — void the invoice it was applied to first', credit_memo_label(p_memo);
  end if;
  update customer_credit_memos set voided_at = org_today(m.org_id) where id = p_memo;
  if m.special_order_id is not null then
    perform log_special_order_event(m.org_id, m.special_order_id,
      'Credit memo ' || credit_memo_label(p_memo) || ' voided');
    perform refresh_order_short_todo(m.special_order_id);
  end if;
end;
$$;
revoke all on function public.void_credit_memo(uuid) from public, anon;
grant execute on function public.void_credit_memo(uuid) to authenticated;

-- The memo's paper and its QuickBooks record, written by the edge functions
-- through the caller's own session.
create or replace function public.record_credit_memo_sent(p_memo uuid, p_document_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from customer_credit_memos where id = p_memo;
  if not found or not user_has_role(m.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'credit memo not found';
  end if;
  update customer_credit_memos
     set sent_at = coalesce(sent_at, org_today(m.org_id)),
         document_path = coalesce(p_document_path, document_path)
   where id = p_memo;
  if m.special_order_id is not null then
    perform log_special_order_event(m.org_id, m.special_order_id,
      'Credit memo ' || credit_memo_label(p_memo) || case when m.sent_at is null then ' sent' else ' re-sent' end);
  end if;
end;
$$;
revoke all on function public.record_credit_memo_sent(uuid, text) from public, anon;
grant execute on function public.record_credit_memo_sent(uuid, text) to authenticated;

create or replace function public.record_credit_memo_external_ref(p_memo uuid, p_ref jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from customer_credit_memos where id = p_memo;
  if not found or not user_has_role(m.org_id, array['owner', 'admin']) then
    raise exception 'credit memo not found';
  end if;
  update customer_credit_memos set external_ref = p_ref where id = p_memo;
end;
$$;
revoke all on function public.record_credit_memo_external_ref(uuid, jsonb) from public, anon;
grant execute on function public.record_credit_memo_external_ref(uuid, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Refunding a memo when it is issued (§6a)
-- ----------------------------------------------------------------------------
-- The processor payment on the invoice a memo credits that can give it back:
-- a pay-link or QuickBooks Payments share of that invoice with enough left.
create or replace function public.credit_memo_refund_source(p_memo uuid)
returns table (application_id uuid, payment_type text, processor text, refundable numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from customer_credit_memos where id = p_memo;
  if not found or not user_has_role(m.org_id, array['owner', 'admin']) then
    return;
  end if;
  return query
  select a.id, p.payment_type, p.processor, payment_refundable(a.id)
    from payment_applications a
    join customer_payments p on p.id = a.payment_id
   where a.customer_invoice_id = m.credits_invoice_id
     and p.payment_type in ('Square Online', 'QuickBooks Payments')
     and p.external_ref is not null and a.amount > 0
     and payment_refundable(a.id) >= credit_memo_total(p_memo)
   order by (a.special_order_id is not distinct from m.special_order_id) desc, a.amount desc, a.created_at;
end;
$$;
revoke all on function public.credit_memo_refund_source(uuid) from public, anon;
grant execute on function public.credit_memo_refund_source(uuid) to authenticated;

-- BOTH HALVES AT ONCE, after the processor has given the money back (or, with
-- no `p_application`, after the shop gave it back in cash or by check): the
-- memo is applied to the invoice it credits and the refund comes back off it,
-- so the invoice stays paid in full and the order's balance does not move.
create or replace function public.record_credit_memo_refund(p_memo uuid, p_application uuid, p_refund_id text,
                                                            p_note text default null, p_type text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  a record;
  v_total numeric(10,2);
  v_payment uuid;
  v_order uuid;
  v_type text;
  v_processor text;
  v_root uuid;
  v_ref text := nullif(btrim(coalesce(p_refund_id, '')), '');
begin
  select * into m from customer_credit_memos where id = p_memo for update;
  if not found or not user_has_role(m.org_id, array['owner', 'admin']) then
    raise exception 'credit memo not found';
  end if;
  if m.voided_at is not null or m.settlement <> 'refund' or m.credits_invoice_id is null then
    raise exception 'credit memo % is not one to refund', credit_memo_label(p_memo);
  end if;
  if exists (select 1 from payment_applications where credit_memo_id = p_memo) then
    raise exception 'credit memo % is already settled', credit_memo_label(p_memo);
  end if;
  v_total := credit_memo_total(p_memo);

  if p_application is not null then
    select ap.id, ap.special_order_id, ap.customer_invoice_id, p.id as payment_id, p.payment_type
      into a
      from payment_applications ap join customer_payments p on p.id = ap.payment_id
     where ap.id = p_application and ap.customer_invoice_id = m.credits_invoice_id;
    if not found then
      raise exception 'that payment is not on invoice %', customer_invoice_label(m.credits_invoice_id);
    end if;
    if payment_refundable(p_application) < v_total then
      raise exception 'only % of that payment is left to refund', payment_refundable(p_application);
    end if;
    if a.payment_type = 'Square Online' then
      v_type := 'Square Refund'; v_processor := 'square';
    elsif a.payment_type = 'QuickBooks Payments' then
      v_type := 'QuickBooks Refund'; v_processor := 'quickbooks';
    else
      raise exception 'only a pay-link or QuickBooks Payments payment is refunded through its processor';
    end if;
    if v_ref is null then
      raise exception 'a refund names the processor''s refund';
    end if;
    v_order := a.special_order_id;
    v_root := a.payment_id;
  else
    -- By hand: only where the app itself collects (not a QuickBooks invoice,
    -- whose books QuickBooks keeps).
    if m.processor = 'quickbooks' then
      raise exception 'a QuickBooks invoice is refunded through QuickBooks Payments';
    end if;
    v_type := coalesce(nullif(btrim(coalesce(p_type, '')), ''), 'cash');
    v_processor := null;
    v_order := m.special_order_id;
  end if;

  insert into customer_payments
    (org_id, customer_id, paid_on, amount, payment_type, processor, external_ref, note, refund_of, created_by)
  values
    (m.org_id, m.customer_id, org_today(m.org_id), -v_total, v_type, v_processor, v_ref,
     coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Refund of credit memo ' || credit_memo_label(p_memo)),
     v_root, auth.uid())
  returning id into v_payment;

  -- The memo first, then the refund: the invoice is never short of money in
  -- between, so its paid date is not moved.
  perform set_config('rf.suppress_order_log', 'on', true);
  insert into payment_applications (org_id, credit_memo_id, special_order_id, customer_invoice_id, amount, created_by)
  values (m.org_id, p_memo, v_order, m.credits_invoice_id, v_total, auth.uid());
  insert into payment_applications (org_id, payment_id, special_order_id, customer_invoice_id, amount, created_by)
  values (m.org_id, v_payment, v_order, m.credits_invoice_id, -v_total, auth.uid());
  perform set_config('rf.suppress_order_log', 'off', true);

  if m.special_order_id is not null then
    perform log_special_order_event(m.org_id, m.special_order_id,
      format('Credit memo %s refunded, %s (%s)', credit_memo_label(p_memo),
             to_char(v_total, 'FM$999,999,990.00'), v_type));
  end if;
  return v_payment;
end;
$$;
revoke all on function public.record_credit_memo_refund(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.record_credit_memo_refund(uuid, uuid, text, text, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Guards: an invoice a live memo corrects is not voided or revised
-- ----------------------------------------------------------------------------
create or replace function public.trg_customer_invoice_memo_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if old.voided_at is null and new.voided_at is not null then
    select credit_memo_label(m.id) into v_label
      from customer_credit_memos m
     where m.credits_invoice_id = new.id and m.voided_at is null
     limit 1;
    if v_label is not null then
      raise exception 'credit memo % corrects invoice % — void the memo first', v_label, customer_invoice_label(new.id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_customer_invoice_memo_guard on customer_invoices;
create trigger trg_customer_invoice_memo_guard before update of voided_at on customer_invoices
  for each row execute function trg_customer_invoice_memo_guard();

-- 143's `revise_customer_invoice`: one refusal added, at the top.
do $do$
declare
  v_def text;
begin
  select pg_get_functiondef('public.revise_customer_invoice(uuid)'::regprocedure) into v_def;
  if v_def not like '%<<< 218%' then
    v_def := replace(v_def,
      $a$  if customer_invoice_is_pending_revision(p_invoice) then$a$,
      $b$  if exists (select 1 from customer_credit_memos m                      -- <<< 218
              where m.credits_invoice_id = p_invoice and m.voided_at is null) then
    raise exception 'a credit memo corrects invoice % — it is not revised as well', customer_invoice_label(p_invoice);
  end if;
  if customer_invoice_is_pending_revision(p_invoice) then$b$);
    if v_def not like '%<<< 218%' then
      raise exception 'revise_customer_invoice did not take the 218 guard';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- 148's void trigger IN FULL, changed where marked: a memo applied to the
-- voided invoice gets its credit back, and the orders' short to-dos are
-- looked at again (what is billed just changed).
create or replace function public.trg_customer_invoice_void_releases_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  mc record;                                                                 -- <<< 218
begin
  if old.voided_at is null and new.voided_at is not null then
    -- <<< 218: memo credit goes back to its memo
    for mc in
      select a.credit_memo_id, sum(a.amount) as amount
        from payment_applications a
       where a.customer_invoice_id = new.id and a.credit_memo_id is not null
       group by a.credit_memo_id
    loop
      perform set_config('rf.suppress_order_log', 'on', true);
      delete from payment_applications where customer_invoice_id = new.id and credit_memo_id = mc.credit_memo_id;
      perform set_config('rf.suppress_order_log', 'off', true);
      perform log_special_order_event(new.org_id, o.id,
                format('%s of credit memo %s, applied to void invoice %s, is credit again',
                       to_char(mc.amount, 'FM$999,999,990.00'), credit_memo_label(mc.credit_memo_id),
                       customer_invoice_label(new.id)))
         from (select distinct special_order_id as id from customer_invoice_lines
                where invoice_id = new.id and special_order_id is not null) o;
    end loop;
    -- >>> 218

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
    end loop;

    update payment_applications
       set customer_invoice_id = null
     where customer_invoice_id = new.id
       and special_order_id is not null;

    perform refresh_order_short_todo(o.id)                                   -- <<< 218
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = new.id and special_order_id is not null) o;
  end if;
  return null;
end;
$$;

-- An invoice going out may make a recorded short one on BILLED quantity.
create or replace function public.trg_customer_invoice_sent_checks_shorts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.sent_at is null and new.sent_at is not null then
    perform refresh_order_short_todo(o.id)
       from (select distinct special_order_id as id from customer_invoice_lines
              where invoice_id = new.id and special_order_id is not null) o;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_customer_invoice_sent_checks_shorts on customer_invoices;
create trigger trg_customer_invoice_sent_checks_shorts after update of sent_at on customer_invoices
  for each row execute function trg_customer_invoice_sent_checks_shorts();

-- 140's application log: a memo row says it is a memo, not a payment.
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

  -- <<< 218
  if coalesce(new.credit_memo_id, old.credit_memo_id) is not null then
    if tg_op = 'INSERT' then
      perform log_special_order_event(new.org_id, new.special_order_id,
        format('Credit memo %s: %s applied%s', credit_memo_label(new.credit_memo_id),
               to_char(coalesce(new.amount, 0), 'FM$999,999,990.00'),
               coalesce(' to invoice ' || customer_invoice_label(new.customer_invoice_id), '')));
    elsif tg_op = 'DELETE' then
      perform log_special_order_event(old.org_id, old.special_order_id,
        format('Credit memo %s: %s taken off', credit_memo_label(old.credit_memo_id),
               to_char(coalesce(old.amount, 0), 'FM$999,999,990.00')));
    end if;
    return null;
  end if;
  -- >>> 218

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


-- ----------------------------------------------------------------------------
-- 6. The readers
-- ----------------------------------------------------------------------------
-- The Payments tab: memo credit appears as its own row, read-only.
create or replace view public.order_payments
with (security_invoker = true) as
select a.id,
       a.org_id,
       a.special_order_id as order_id,
       a.customer_invoice_id,
       a.payment_id,
       coalesce(p.paid_on, cm.issued_on) as paid_on,
       a.amount,
       case when a.credit_memo_id is not null then 'Credit memo' else p.payment_type end as payment_type,
       case when a.credit_memo_id is not null then credit_memo_label(a.credit_memo_id) else p.note end as note,
       p.external_ref,
       p.processor,
       p.refund_of,
       coalesce(p.customer_id, cm.customer_id) as customer_id,
       a.created_at,
       a.credit_memo_id
  from payment_applications a
  left join customer_payments p on p.id = a.payment_id
  left join customer_credit_memos cm on cm.id = a.credit_memo_id
 where a.special_order_id is not null;

-- The statement: a memo is money in, like a payment — what of it was applied
-- to each invoice, and what is left as credit. Its `payment_id` is the memo's
-- own id, so the statement shows it once.
create or replace view public.customer_account_entries
with (security_invoker = true) as
select p.org_id, p.customer_id, p.id as payment_id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at,
       a.customer_invoice_id, sum(a.amount)::numeric(10,2) as amount, null::uuid as credit_memo_id
  from customer_payments p
  join payment_applications a on a.payment_id = p.id
 where a.customer_invoice_id is not null
 group by p.org_id, p.customer_id, p.id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at, a.customer_invoice_id
union all
select p.org_id, p.customer_id, p.id as payment_id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at,
       null::uuid as customer_invoice_id, (p.amount - coalesce(sum(a.amount), 0))::numeric(10,2) as amount,
       null::uuid as credit_memo_id
  from customer_payments p
  left join payment_applications a on a.payment_id = p.id
 group by p.org_id, p.customer_id, p.id, p.paid_on, p.payment_type, p.note, p.refund_of, p.created_at, p.amount
having p.amount - coalesce(sum(a.amount), 0) <> 0
union all                                                                    -- <<< 218
select m.org_id, m.customer_id, m.id, m.issued_on, 'Credit memo ' || credit_memo_label(m.id), m.note, null::uuid,
       m.created_at, a.customer_invoice_id, sum(a.amount)::numeric(10,2), m.id
  from customer_credit_memos m
  join payment_applications a on a.credit_memo_id = m.id
 where m.voided_at is null and a.customer_invoice_id is not null
 group by m.org_id, m.customer_id, m.id, m.issued_on, m.note, m.created_at, a.customer_invoice_id
union all
select m.org_id, m.customer_id, m.id, m.issued_on, 'Credit memo ' || credit_memo_label(m.id), m.note, null::uuid,
       m.created_at, null::uuid, credit_memo_unapplied(m.id)::numeric(10,2), m.id
  from customer_credit_memos m
 where m.voided_at is null and credit_memo_unapplied(m.id) <> 0;

-- 144's `customer_balances` IN FULL; credit counts unapplied memos (<<< 218).
create or replace function public.customer_balances(p_org uuid, p_customer uuid default null)
returns table (customer_id uuid, invoiced numeric, open_invoices integer, not_invoiced numeric,
               uninvoiced_orders integer, credit numeric)
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
    select x.cid, sum(x.credit) as credit from (
      select p.customer_id as cid,
             p.amount - coalesce((select sum(y.amount) from payment_applications y where y.payment_id = p.id), 0) as credit
        from customer_payments p
       where p.org_id = p_org
         and p.customer_id is not null
         and (p_customer is null or p.customer_id = p_customer)
      union all                                                              -- <<< 218
      select m.customer_id, credit_memo_unapplied(m.id)
        from customer_credit_memos m
       where m.org_id = p_org and m.voided_at is null and m.settlement = 'credit'
         and (p_customer is null or m.customer_id = p_customer)
    ) x
     group by x.cid
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

-- A customer's memos, for the record and the Credit section.
create or replace function public.customer_credit_memo_list(p_customer uuid)
returns table (id uuid, label text, kind text, reason_code text, note text, issued_on date, total numeric,
               unapplied numeric, settlement text, processor text, invoice_label text, order_number text,
               voided_at date, sent_at date, in_quickbooks boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from customers where customers.id = p_customer;
  if v_org is null or v_org not in (select user_org_ids()) then
    return;
  end if;
  return query
  select m.id, credit_memo_label(m.id), m.kind, m.reason_code, m.note, m.issued_on,
         credit_memo_total(m.id), credit_memo_unapplied(m.id), m.settlement, m.processor,
         case when m.credits_invoice_id is null then null else customer_invoice_label(m.credits_invoice_id) end,
         o.number, m.voided_at, m.sent_at, (m.external_ref -> 'qbo' ->> 'id') is not null
    from customer_credit_memos m
    left join special_orders o on o.id = m.special_order_id
   where m.customer_id = p_customer
   order by m.issued_on desc, m.number desc;
end;
$$;
revoke all on function public.customer_credit_memo_list(uuid) from public, anon;
grant execute on function public.customer_credit_memo_list(uuid) to authenticated;

-- 140's QuickBooks payment door: a Payment that only applied one of OUR memos
-- is not cash (brief §8). `qbo-sync` and `qbo-webhook` also pass the cash
-- alone (the Invoice-linked amount less the CreditMemo-linked ones); this is
-- the second lock.
do $do$
declare
  v_def text;
begin
  select pg_get_functiondef('public.record_qbo_invoice_payment(text, text, numeric, text, date)'::regprocedure) into v_def;
  if v_def not like '%<<< 218%' then
    v_def := replace(v_def,
      $a$  v_before := customer_invoice_unsettled_orders(inv.id); $a$,
      $b$  if exists (select 1 from payment_applications where qbo_payment_id = p_payment_id) then   -- <<< 218
    return 'credit memo';
  end if;

  v_before := customer_invoice_unsettled_orders(inv.id); $b$);
    if v_def not like '%<<< 218%' then
      raise exception 'record_qbo_invoice_payment did not take the 218 guard';
    end if;
    execute v_def;
  end if;
end;
$do$;
