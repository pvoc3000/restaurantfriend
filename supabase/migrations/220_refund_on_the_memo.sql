-- ============================================================================
-- 220 — EVERY REFUND ON AN INVOICED ORDER IS A CREDIT MEMO
--
-- Mark, 2026-11-01: "I think we could consolidate the two paths: Tap
-- 'Refund…' and it brings up the 'Record Short…' dialogue … Sometimes we
-- might want to issue a refund for delivery. Sometimes … for the rush fee. Or
-- maybe we just want to issue an arbitrary refund not tied to an item … including
-- an 'All' option to refund the entire order."
--
-- 218's memo could credit a SHORT (items, and the discount, rush and tax they
-- carried) or be an allowance (an amount, no order billing). One memo now
-- carries any of:
--
--   · SHORTS — as 218, and they still CORRECT BILLING: the order's target
--     follows the delivery record, so nothing re-bills them.
--   · THE DELIVERY CHARGE, or part of it — a new line type, 'delivery'.
--   · THE RUSH FEE, or part of it — a 'rush' line.
--   · ANOTHER AMOUNT, with a reason from Settings — an 'allowance' line.
--   · ALL — every short, then everything else still billed and not yet given
--     back, line by line (items, discount, delivery, rush, tax), so the books
--     reverse the sale in its own accounts and the tax comes back.
--
-- Only the shorts correct billing. A delivery or rush refund, an amount, and
-- the rest of an "All" are money given back on a sale that stands — the order
-- still delivered what it delivered, so its target does not move and nothing
-- offers to bill it again. That is `customer_credit_memo_lines.corrects_billing`:
-- null on 218's rows, read as "by the memo's kind", as 218 read it.
--
-- And for the 7 AM run: `square_memo_refunds`, each Square refund of a memo
-- with what it gave back by kind — the split `sync-square-sales` puts on the
-- day in place of Square's "Uncategorized" return (the pinned 2026-09-22
-- refund thread, option 1).
--
-- Run after 219. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The line
-- ----------------------------------------------------------------------------
alter table customer_credit_memo_lines drop constraint if exists customer_credit_memo_lines_line_type_check;
alter table customer_credit_memo_lines add constraint customer_credit_memo_lines_line_type_check
  check (line_type in ('item', 'discount', 'delivery', 'rush', 'tax', 'allowance'));
alter table customer_credit_memo_lines add column if not exists corrects_billing boolean;

-- Billing reads only the lines that correct it.
create or replace function public.special_order_credited(p_order uuid)
returns table (items numeric, discount numeric, rush numeric, tax numeric, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.amount) filter (where l.line_type = 'item'), 0)::numeric(10,2),
         coalesce(-sum(l.amount) filter (where l.line_type = 'discount'), 0)::numeric(10,2),
         coalesce(sum(l.amount) filter (where l.line_type = 'rush'), 0)::numeric(10,2),
         coalesce(sum(l.amount) filter (where l.line_type = 'tax'), 0)::numeric(10,2),
         coalesce(sum(l.amount), 0)::numeric(10,2)
    from customer_credit_memo_lines l
    join customer_credit_memos m on m.id = l.memo_id
   where l.special_order_id = p_order
     and coalesce(l.corrects_billing, m.kind = 'short_shipment')     -- <<< 220
     and m.voided_at is null;
$$;
revoke all on function public.special_order_credited(uuid) from public, anon, authenticated;

create or replace function public.special_order_item_credited(p_item uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.qty), 0)::numeric(10,2)
    from customer_credit_memo_lines l
    join customer_credit_memos m on m.id = l.memo_id
   where l.special_order_item_id = p_item
     and l.line_type = 'item'
     and coalesce(l.corrects_billing, m.kind = 'short_shipment')     -- <<< 220
     and m.voided_at is null;
$$;
revoke all on function public.special_order_item_credited(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. What is left to give back on an order
-- ----------------------------------------------------------------------------
-- Billed, on every live invoice that went out, less every live memo's lines
-- for the order — whatever they correct. Amounts; a discount is negative.
create or replace function public.order_refundable(p_order uuid)
returns table (items numeric, discount numeric, delivery numeric, rush numeric, tax numeric,
               allowance numeric, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  with billed as (
    select coalesce(sum(p.amount) filter (where p.line_type = 'item'), 0) as items,
           coalesce(sum(p.amount) filter (where p.line_type = 'discount'), 0) as discount,
           coalesce(sum(p.amount) filter (where p.line_type = 'delivery'), 0) as delivery,
           coalesce(sum(p.amount) filter (where p.line_type = 'rush'), 0) as rush,
           coalesce(sum(p.amount) filter (where p.line_type = 'tax'), 0) as tax
      from order_prior_invoice_lines(p_order, null) p
  ), given as (
    select coalesce(sum(l.amount) filter (where l.line_type = 'item'), 0) as items,
           coalesce(sum(l.amount) filter (where l.line_type = 'discount'), 0) as discount,
           coalesce(sum(l.amount) filter (where l.line_type = 'delivery'), 0) as delivery,
           coalesce(sum(l.amount) filter (where l.line_type = 'rush'), 0) as rush,
           coalesce(sum(l.amount) filter (where l.line_type = 'tax'), 0) as tax,
           coalesce(sum(l.amount) filter (where l.line_type = 'allowance'), 0) as allowance
      from customer_credit_memo_lines l
      join customer_credit_memos m on m.id = l.memo_id
     where l.special_order_id = p_order and m.voided_at is null
  )
  select (b.items - g.items)::numeric(10,2),
         (b.discount - g.discount)::numeric(10,2),
         (b.delivery - g.delivery)::numeric(10,2),
         (b.rush - g.rush)::numeric(10,2),
         (b.tax - g.tax)::numeric(10,2),
         g.allowance::numeric(10,2),
         ((b.items + b.discount + b.delivery + b.rush + b.tax)
          - (g.items + g.discount + g.delivery + g.rush + g.tax + g.allowance))::numeric(10,2)
    from billed b, given g;
$$;
revoke all on function public.order_refundable(uuid) from public, anon, authenticated;

-- The screen's read gains it (217's `order_delivery`, plus `refundable`).
create or replace function public.order_delivery(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o record;
begin
  select * into o from special_orders where id = p_order;
  if not found or o.org_id not in (select user_org_ids()) then
    return null;
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(d) order by d.sort nulls last, d.item_id)
                         from order_delivery_items(p_order) d), '[]'::jsonb),
    'unbilled', special_order_unbilled(p_order, null),
    'credited', (select c.total from special_order_credited(p_order) c),
    'refundable', (select to_jsonb(r) from order_refundable(p_order) r),     -- <<< 220
    'short_decision', o.short_decision,
    'short_decision_note', o.short_decision_note,
    'short_decision_by', (select mb.display_name from org_members mb
                           where mb.user_id = o.short_decision_by and mb.org_id = o.org_id),
    'short_decision_at', o.short_decision_at
  );
end;
$$;
revoke all on function public.order_delivery(uuid) from public, anon;
grant execute on function public.order_delivery(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. Issuing one memo for all of it
-- ----------------------------------------------------------------------------
-- `p_shorts`: [{ "item_id", "qty" }] — as 218's `issue_credit_memo`, each at
-- most what the delivery record leaves creditable. `p_delivery`, `p_rush`,
-- `p_other`: amounts, each at most what is left of it. `p_reason`: one of
-- Settings' allowance reasons, required when anything but shorts is given
-- back. `p_all`: every short, then everything left — the amounts are then
-- ignored.
create or replace function public.issue_order_credit_memo(
  p_order uuid, p_invoice uuid, p_shorts jsonb, p_delivery numeric, p_rush numeric, p_other numeric,
  p_reason text, p_all boolean, p_note text, p_settlement text default 'credit')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  inv record;
  r record;
  rf record;
  v_id uuid;
  v_shorts jsonb := '[]'::jsonb;
  v_reasons jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_extra boolean;
  v_delivery numeric(10,2) := round(coalesce(p_delivery, 0), 2);
  v_rush numeric(10,2) := round(coalesce(p_rush, 0), 2);
  v_other numeric(10,2) := round(coalesce(p_other, 0), 2);
  v_before numeric(10,2);
  v_total numeric(10,2);
  v_what text[] := '{}';
begin
  select * into o from special_orders where id = p_order;
  if not found or not user_has_role(o.org_id, array['owner', 'admin']) then
    raise exception 'only a manager or the owner issues a credit memo';
  end if;
  if coalesce(p_settlement, '') not in ('credit', 'refund') then
    raise exception 'a memo is applied as credit or refunded';
  end if;
  if v_delivery < 0 or v_rush < 0 or v_other < 0 then
    raise exception 'a refund is more than zero';
  end if;

  -- The shorts: as given, or every creditable one for All.
  if coalesce(p_all, false) then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', d.item_id, 'qty', d.creditable)), '[]'::jsonb)
      into v_shorts
      from order_delivery_items(p_order) d where d.creditable > 0;
  elsif jsonb_typeof(p_shorts) = 'array' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_shorts
      from jsonb_array_elements(p_shorts) x where coalesce((x ->> 'qty')::numeric, 0) <> 0;
  end if;
  v_extra := coalesce(p_all, false) or v_delivery > 0 or v_rush > 0 or v_other > 0;
  if jsonb_array_length(v_shorts) = 0 and not v_extra then
    raise exception 'a credit memo credits at least one line';
  end if;

  if v_extra then
    select settings -> 'customer_credit_memos' -> 'allowance_reasons' into v_reasons from orgs where id = o.org_id;
    if v_reason is null or (v_reasons is not null and not v_reasons ? v_reason) then
      raise exception 'a refund of anything but a short takes one of the reasons in Settings';
    end if;
    if coalesce(p_all, false) and (select allowance from order_refundable(p_order)) <> 0 then
      raise exception 'order % already has an amount given back; refund the rest as an amount', o.number;
    end if;
  end if;

  if jsonb_array_length(v_shorts) > 0 then
    -- 218 checks the invoice, writes the shorts and their discount, rush and
    -- tax shares, logs them and refreshes the to-do.
    v_id := issue_credit_memo(p_order, p_invoice, v_shorts, p_note, p_settlement);
    update customer_credit_memo_lines set corrects_billing = true where memo_id = v_id;
  else
    select * into inv from customer_invoices where id = p_invoice and org_id = o.org_id;
    if not found or inv.voided_at is not null or not customer_invoice_is_frozen(p_invoice)
       or not exists (select 1 from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order) then
      raise exception 'a credit memo corrects an invoice that billed order % and went out', o.number;
    end if;
    if o.customer_id is null then
      raise exception 'order % has no customer to credit', o.number;
    end if;
    insert into customer_credit_memos
      (org_id, customer_id, number, kind, reason_code, note, issued_on, credits_invoice_id, special_order_id,
       location_id, processor, settlement, created_by)
    values
      (o.org_id, o.customer_id, next_credit_memo_number(o.org_id), 'allowance', v_reason,
       nullif(btrim(coalesce(p_note, '')), ''), org_today(o.org_id), p_invoice, p_order,
       inv.location_id, inv.processor, p_settlement, auth.uid())
    returning id into v_id;
  end if;
  if not v_extra then
    return v_id;
  end if;
  v_before := credit_memo_total(v_id);

  select * into rf from order_refundable(p_order);
  if coalesce(p_all, false) then
    -- Each item's rest, at what it was billed for.
    for r in
      select it.id, it.name, it.sort, it.taxable,
             coalesce(sum(p.qty), 0) - coalesce((select sum(l.qty) from customer_credit_memo_lines l
                                                   join customer_credit_memos m on m.id = l.memo_id
                                                  where l.special_order_item_id = it.id and l.line_type = 'item'
                                                    and m.voided_at is null), 0) as qty,
             coalesce(sum(p.amount), 0) - coalesce((select sum(l.amount) from customer_credit_memo_lines l
                                                      join customer_credit_memos m on m.id = l.memo_id
                                                     where l.special_order_item_id = it.id and l.line_type = 'item'
                                                       and m.voided_at is null), 0) as amount,
             (array_agg(p.unit_price order by p.invoice_number desc, p.invoice_revision desc))[1] as price
        from special_order_items it
        join order_prior_invoice_lines(p_order, null) p
          on p.line_type = 'item' and p.special_order_item_id = it.id
       where it.order_id = p_order
       group by it.id, it.name, it.sort, it.taxable
    loop
      continue when r.amount = 0;
      insert into customer_credit_memo_lines
        (org_id, memo_id, special_order_id, special_order_item_id, line_type, description, qty, unit_price,
         amount, taxable, sort, corrects_billing)
      values
        (o.org_id, v_id, p_order, r.id, 'item', r.name,
         nullif(r.qty, 0), case when r.qty <> 0 then r.price end, r.amount, r.taxable,
         2000 + coalesce(r.sort, 0), false);
    end loop;
    v_delivery := rf.delivery;
    v_rush := rf.rush;
    if rf.discount <> 0 then
      insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort, corrects_billing)
      values (o.org_id, v_id, p_order, 'discount', 'Discount', rf.discount, 3000, false);
    end if;
    v_what := v_what || 'the whole order'::text;
  else
    if v_delivery > rf.delivery then
      raise exception 'at most % of the delivery charge is left to refund', rf.delivery;
    end if;
    if v_rush > rf.rush then
      raise exception 'at most % of the rush fee is left to refund', rf.rush;
    end if;
  end if;

  if v_delivery > 0 then
    insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort, corrects_billing)
    values (o.org_id, v_id, p_order, 'delivery', 'Delivery', v_delivery, 3001, false);
    if not coalesce(p_all, false) then v_what := v_what || 'delivery'::text; end if;
  end if;
  if v_rush > 0 then
    insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort, corrects_billing)
    values (o.org_id, v_id, p_order, 'rush', 'Rush fee', v_rush, 3002, false);
    if not coalesce(p_all, false) then v_what := v_what || 'rush fee'::text; end if;
  end if;
  if coalesce(p_all, false) and rf.tax <> 0 then
    insert into customer_credit_memo_lines
      (org_id, memo_id, special_order_id, line_type, description, amount, tax_rate, sort, corrects_billing)
    values (o.org_id, v_id, p_order, 'tax', 'Sales tax', rf.tax, o.tax_rate, 3003, false);
  end if;
  if not coalesce(p_all, false) and v_other > 0 then
    -- What is left once the lines above are counted.
    if v_other > (select total from order_refundable(p_order)) then
      raise exception 'at most % is left to give back on order %', (select total from order_refundable(p_order)), o.number;
    end if;
    insert into customer_credit_memo_lines (org_id, memo_id, special_order_id, line_type, description, amount, sort, corrects_billing)
    values (o.org_id, v_id, p_order, 'allowance',
            v_reason || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''), v_other, 3004, false);
    v_what := v_what || to_char(v_other, 'FM$999,999,990.00');
  end if;

  if (select total from order_refundable(p_order)) < 0 then
    raise exception 'that gives back more than order % was billed', o.number;
  end if;
  v_total := credit_memo_total(v_id);
  if v_total <= 0 then
    raise exception 'this credit memo comes to nothing';
  end if;
  -- A memo with shorts keeps 218's reason; the rest is in its lines and log.
  update customer_credit_memos
     set reason_code = case when kind = 'allowance' then reason_code else reason_code || ', ' || v_reason end
   where id = v_id;

  perform log_special_order_event(o.org_id, p_order,
    format('Credit memo %s gives back %s (%s, %s)%s', credit_memo_label(v_id),
           to_char(v_total - v_before, 'FM$999,999,990.00'), array_to_string(v_what, ', '), v_reason,
           case when p_settlement = 'refund' then ' — to be refunded' else '' end));
  return v_id;
end;
$$;
revoke all on function public.issue_order_credit_memo(uuid, uuid, jsonb, numeric, numeric, numeric, text, boolean, text, text)
  from public, anon;
grant execute on function public.issue_order_credit_memo(uuid, uuid, jsonb, numeric, numeric, numeric, text, boolean, text, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 4. The 7 AM run: each Square refund of a memo, by what it gave back
-- ----------------------------------------------------------------------------
-- Square's API refunds by AMOUNT, which it reports as a return on
-- "Uncategorized", tax included. The memo knows what the money was. A memo's
-- refund is the negative `Square Refund` payment its settlement wrote in the
-- same transaction as the memo's own application (218's
-- `record_credit_memo_refund`), so the two share `created_at`.
--
-- `reporting_day` is Square's: local time, rolling at 01:00 (`lib/sales`).
-- Goods are items, discount, rush and any amount — what the pay link sold on
-- its untaxed and taxed goods lines; delivery was a service charge; tax, tax.
create or replace function public.square_memo_refunds(p_org uuid, p_from date, p_to date)
returns table (memo_id uuid, memo_label text, square_location_id text, reporting_day date,
               refund_id text, square_payment_id text, goods_cents bigint, taxable_goods_cents bigint,
               delivery_cents bigint, tax_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, credit_memo_label(m.id), customer_invoice_square_location(m.credits_invoice_id),
         ((p.created_at at time zone coalesce(g.settings ->> 'timezone', 'America/Los_Angeles'))
           - interval '1 hour')::date,
         p.external_ref, root.external_ref,
         round(100 * coalesce(sum(l.amount) filter (where l.line_type in ('item', 'discount', 'rush', 'allowance')), 0))::bigint,
         round(100 * coalesce(sum(l.amount) filter (where l.line_type = 'item' and l.taxable), 0))::bigint,
         round(100 * coalesce(sum(l.amount) filter (where l.line_type = 'delivery'), 0))::bigint,
         round(100 * coalesce(sum(l.amount) filter (where l.line_type = 'tax'), 0))::bigint
    from customer_credit_memos m
    join orgs g on g.id = m.org_id
    join payment_applications am on am.credit_memo_id = m.id
    join payment_applications ap on ap.customer_invoice_id = am.customer_invoice_id
                                and ap.created_at = am.created_at and ap.payment_id is not null and ap.amount < 0
    join customer_payments p on p.id = ap.payment_id and p.payment_type = 'Square Refund'
    left join customer_payments root on root.id = p.refund_of
    join customer_credit_memo_lines l on l.memo_id = m.id
   where m.org_id = p_org
     and m.voided_at is null
     and m.settlement = 'refund'
     and ((p.created_at at time zone coalesce(g.settings ->> 'timezone', 'America/Los_Angeles'))
           - interval '1 hour')::date between p_from and p_to
     and (auth.role() = 'service_role' or p_org in (select user_org_ids()))
   group by m.id, g.settings, p.created_at, p.external_ref, root.external_ref;
$$;
revoke all on function public.square_memo_refunds(uuid, date, date) from public, anon;
grant execute on function public.square_memo_refunds(uuid, date, date) to authenticated, service_role;
