-- ============================================================================
-- 176 — AN INVOICE BILLS WHAT WAS ADDED
-- ============================================================================
--
-- Mark, 2026-10-06. Knotted raised two days that INV-10000 had already billed
-- and been paid for (560 each, now 1,300 and 1,100). 141 put such an order on
-- a second invoice as ALL of its charges and then "Less invoice INV-10000" —
-- a negative line QuickBooks cannot carry, so the send was refused.
--
-- BILLED BY QUANTITY. Each copied item line has remembered its order item
-- since 141 (`special_order_item_id`). So when an order goes onto an invoice
-- and its other live invoices already bill it, the copy is now WHAT WAS ADDED:
--
--   - each item for the quantity not yet billed, at the order's price
--     ("740 × Knotted Bismark @ $1.55"); an item billed in full is left off;
--   - a PRICE that went up on units already billed is a line of its own,
--     never folded into a quantity ("… — price change on 560 already invoiced");
--   - delivery, rush, discount and tax for what the earlier invoices did not
--     bill of each (a delivery charge billed once is not billed again).
--
-- Every line is an ordinary positive charge, so the paper, the pay page and
-- QuickBooks say the same thing with no special case — and the group still
-- nets to the order's total less what is billed elsewhere, to the cent. The
-- group's label says so: "Order #SO-10085 · Cafe Knotted · 10/10/2026 · in
-- addition to INV-10000".
--
-- "LESS INVOICE N" STAYS for what a quantity cannot say: an item that went
-- DOWN, was removed, or changed its tax; a price, delivery, rush or tax that
-- went down; a discount that shrank; a tax rate that changed; and an order
-- whose earlier invoice is a deposit, or one line from before 141. Those copy
-- exactly as 141/143 copied them. A decrease on a paid invoice is a credit
-- memo, which is not built.
--
-- A DRAFT copied before this (charges, then "Less invoice") reads as changed —
-- "The order has changed" — and Update re-copies it in the new form. A sent
-- invoice is frozen and is not touched.
--
-- Run in the Supabase SQL editor after 175. RERUNNABLE. The executable SQL
-- starts at section 1, below this header.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What the order's other invoices bill, line by line
-- ----------------------------------------------------------------------------
-- 143's rule for "the other live invoices", in one place: not void, not this
-- one, not the invoice this one would replace, and not a draft revision.

create or replace function public.order_prior_invoice_lines(p_order uuid, p_invoice uuid)
returns table (
  invoice_id uuid,
  invoice_number int,
  invoice_revision int,
  line_type text,
  qty numeric,
  unit_price numeric,
  amount numeric,
  taxable boolean,
  tax_rate numeric,
  special_order_item_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.number, i.revision, l.line_type, l.qty, l.unit_price, l.amount,
         l.taxable, l.tax_rate, l.special_order_item_id
    from customer_invoice_lines l
    join customer_invoices i on i.id = l.invoice_id
   where l.special_order_id = p_order
     and i.voided_at is null
     and i.id is distinct from p_invoice
     and i.id is distinct from (select revision_of from customer_invoices where id = p_invoice)
     and not (i.revision_of is not null and i.sent_at is null);
$$;

-- Each of the order's items against what is billed of it: the quantity billed
-- (`billed_qty`), what that quantity was billed at (`billed_amount`, each
-- line's qty × price), and any price changes billed since (`billed_adjust`, the
-- lines with an amount and no quantity).
create or replace function public.order_item_billing(p_order uuid, p_invoice uuid)
returns table (
  item_id uuid,
  name text,
  qty numeric,
  unit_price numeric,
  taxable boolean,
  seq bigint,
  billed_qty numeric,
  billed_amount numeric,
  billed_adjust numeric,
  repriced boolean,
  retaxed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select it.id, it.name, coalesce(it.qty, 0)::numeric, coalesce(it.unit_price, 0)::numeric, it.taxable,
         row_number() over (order by it.sort nulls last, it.id),
         coalesce(sum(p.qty) filter (where p.qty is not null), 0),
         coalesce(sum(round(p.qty * coalesce(p.unit_price, 0), 2)) filter (where p.qty is not null), 0),
         coalesce(sum(p.amount) filter (where p.qty is null), 0),
         coalesce(bool_or(p.qty is not null
                          and p.unit_price is distinct from coalesce(it.unit_price, 0)::numeric(10,2)), false),
         -- (`invoice_id` is null on the left join's empty row: an item nothing bills.)
         coalesce(bool_or(p.invoice_id is not null and p.taxable is distinct from it.taxable), false)
    from special_order_items it
    left join order_prior_invoice_lines(p_order, p_invoice) p
      on p.line_type = 'item' and p.special_order_item_id = it.id
   where it.order_id = p_order
   group by it.id, it.name, it.qty, it.unit_price, it.taxable, it.sort;
$$;

-- "INV-10000", or "INV-10000, INV-10014-2" — the invoices that already bill
-- the order, as the paper prints them.
create or replace function public.order_prior_invoice_labels(p_order uuid, p_invoice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(x.label, ', ' order by x.number, x.revision)
    from (select p.invoice_number as number, p.invoice_revision as revision,
                 coalesce(g.settings -> 'customer_invoices' ->> 'prefix', '') || p.invoice_number
                 || case when p.invoice_revision > 1 then '-' || p.invoice_revision else '' end as label
            from order_prior_invoice_lines(p_order, p_invoice) p
            join special_orders o on o.id = p_order
            join orgs g on g.id = o.org_id
           group by p.invoice_id, p.invoice_number, p.invoice_revision, g.settings
          having sum(p.amount) <> 0) x;
$$;

revoke all on function public.order_prior_invoice_lines(uuid, uuid) from public, anon, authenticated;
revoke all on function public.order_item_billing(uuid, uuid) from public, anon, authenticated;
revoke all on function public.order_prior_invoice_labels(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. An order's charges, as lines — what was added, where that can be said
-- ----------------------------------------------------------------------------
-- 143's `order_invoice_lines` IN FULL, changed where marked.

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
  -- 176
  pr record;
  v_added boolean := false;
  v_add numeric(10,2);
  v_adjust numeric(10,2);
  v_emitted numeric(10,2) := 0;
  v_big_qty uuid;
  v_big_adjust uuid;
  v_big_amount numeric(10,2) := 0;
  v_big_adjust_amount numeric(10,2) := 0;
  v_d_discount numeric(10,2);
  v_d_delivery numeric(10,2);
  v_d_rush numeric(10,2);
  v_d_tax numeric(10,2);
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
  select ci.revision_of into v_replaces from customer_invoices ci where ci.id = p_invoice;

  -- <<< 176: WHAT WAS ADDED. Decided first, and only where every difference is
  -- an addition; anything else falls through to 143's copy below, unchanged.
  select count(*) as n,
         coalesce(sum(p.amount), 0) as total,
         coalesce(bool_or(p.line_type not in ('item', 'discount', 'delivery', 'rush', 'tax')), false) as other_shape,
         coalesce(bool_or(p.line_type = 'item' and not exists (
                    select 1 from special_order_items si
                     where si.id = p.special_order_item_id and si.order_id = p_order)), false) as item_gone,
         coalesce(sum(p.amount) filter (where p.line_type = 'item'), 0) as items,
         coalesce(-sum(p.amount) filter (where p.line_type = 'discount'), 0) as discount,
         coalesce(sum(p.amount) filter (where p.line_type = 'delivery'), 0) as delivery,
         coalesce(sum(p.amount) filter (where p.line_type = 'rush'), 0) as rush,
         coalesce(sum(p.amount) filter (where p.line_type = 'tax'), 0) as tax,
         coalesce(bool_or(p.line_type = 'tax' and p.amount <> 0
                          and p.tax_rate is distinct from round(o.tax_rate::numeric, 5)), false) as rate_changed
    into pr
    from order_prior_invoice_lines(p_order, p_invoice) p;

  if pr.n > 0 and pr.total <> 0 and not pr.other_shape and not pr.item_gone and not pr.rate_changed then
    v_d_discount := m.discount - pr.discount;
    v_d_delivery := m.delivery - pr.delivery;
    v_d_rush := m.rush - pr.rush;
    v_d_tax := m.tax - pr.tax;
    v_added := v_d_discount >= 0 and v_d_delivery >= 0 and v_d_rush >= 0 and v_d_tax >= 0;

    if v_added then
      for it in select * from order_item_billing(p_order, p_invoice) b order by b.seq loop
        v_adjust := case when it.repriced or it.billed_adjust <> 0
                         then round(it.billed_qty * it.unit_price, 2) - it.billed_amount - it.billed_adjust
                         else 0 end;
        if it.retaxed or it.billed_qty > it.qty or v_adjust < 0 then
          v_added := false;
          exit;
        end if;
        v_add := round((it.qty - it.billed_qty) * it.unit_price, 2);
        v_emitted := v_emitted + v_add + v_adjust;
        if v_add > v_big_amount then
          v_big_amount := v_add; v_big_qty := it.item_id;
        end if;
        if v_adjust > v_big_adjust_amount then
          v_big_adjust_amount := v_adjust; v_big_adjust := it.item_id;
        end if;
      end loop;
    end if;

    -- The lines must add to the order's subtotal less the items already
    -- billed. A cent or two of rounding goes on the largest line, as the
    -- whole copy's does; more than that is not rounding, and is not guessed at.
    if v_added then
      v_penny := (m.subtotal - pr.items) - v_emitted;
      if abs(v_penny) > 0.05 or (v_penny <> 0 and v_big_qty is null and v_big_adjust is null) then
        v_added := false;
      end if;
    end if;
  end if;

  if v_added then
    for it in select * from order_item_billing(p_order, p_invoice) b order by b.seq loop
      v_add := round((it.qty - it.billed_qty) * it.unit_price, 2);
      v_adjust := case when it.repriced or it.billed_adjust <> 0
                       then round(it.billed_qty * it.unit_price, 2) - it.billed_amount - it.billed_adjust
                       else 0 end;
      if v_add <> 0 then
        line_type := 'item';
        description := it.name;
        qty := it.qty - it.billed_qty;
        unit_price := it.unit_price;
        amount := v_add + case when it.item_id = v_big_qty then v_penny else 0 end;
        taxable := it.taxable;
        tax_rate := null;
        special_order_item_id := it.item_id;
        sort := v_n;
        v_n := v_n + 1;
        return next;
      end if;
      if v_adjust <> 0 then
        -- No quantity: this is money for units an earlier invoice already
        -- counted, and `order_item_billing` reads a line with no quantity as
        -- exactly that.
        line_type := 'item';
        description := it.name || ' — price change on '
                       || trim(trailing '.' from trim(trailing '0' from it.billed_qty::numeric(10,2)::text))
                       || ' already invoiced';
        qty := null;
        unit_price := null;
        amount := v_adjust + case when v_big_qty is null and it.item_id = v_big_adjust then v_penny else 0 end;
        taxable := it.taxable;
        tax_rate := null;
        special_order_item_id := it.item_id;
        sort := v_n;
        v_n := v_n + 1;
        return next;
      end if;
    end loop;

    qty := null; unit_price := null; special_order_item_id := null; taxable := false; tax_rate := null;
    if v_d_discount <> 0 then
      line_type := 'discount'; description := 'Discount'; amount := -v_d_discount; sort := 1000;
      return next;
    end if;
    if v_d_delivery <> 0 then
      line_type := 'delivery'; description := 'Delivery'; amount := v_d_delivery; sort := 1001;
      return next;
    end if;
    if v_d_rush <> 0 then
      line_type := 'rush'; description := 'Rush fee'; amount := v_d_rush; sort := 1002;
      return next;
    end if;
    if v_d_tax <> 0 then
      line_type := 'tax'; description := 'Sales tax'; amount := v_d_tax; tax_rate := o.tax_rate; sort := 1003;
      return next;
    end if;
    return;
  end if;
  -- >>> 176. From here down is 143's copy.

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
       and i.id is distinct from v_replaces
       and not (i.revision_of is not null and i.sent_at is null)
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

revoke all on function public.order_invoice_lines(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. The copy says what it is
-- ----------------------------------------------------------------------------
-- 141's `write_order_invoice_lines` IN FULL, changed where marked: a copy of
-- what was added names the invoices it adds to, in the group's label — the
-- band on the invoice record, the row on the paper and the pay page, and the
-- line QuickBooks is sent.

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
  v_earlier text;
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

  -- <<< 176: earlier invoices bill this order and the copy carries no "Less
  -- invoice" — so it is what was added.
  v_earlier := order_prior_invoice_labels(p_order, p_invoice);
  if v_earlier is not null
     and not exists (select 1 from customer_invoice_lines
                      where invoice_id = p_invoice and special_order_id = p_order
                        and line_type = 'prior_billing') then
    update customer_invoice_lines
       set order_label = order_label || ' · in addition to ' || v_earlier
     where invoice_id = p_invoice and special_order_id = p_order;
  end if;
  -- >>> 176
  perform set_config('rf.invoice_line_write', 'off', true);

  select coalesce(sum(amount), 0) into v_net
    from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order;
  return v_net;
end;
$$;

revoke all on function public.write_order_invoice_lines(uuid, uuid) from public, anon, authenticated;

-- Check, after running:
--   select proname from pg_proc where proname in
--     ('order_prior_invoice_lines', 'order_item_billing', 'order_prior_invoice_labels');
--   -- three rows
