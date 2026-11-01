-- ============================================================================
-- 217 — THE DELIVERY RECORD, AND AN INVOICE BILLS WHAT WAS DELIVERED
--
-- SQL STARTS AT SECTION 1. Everything above it is comment.
--
-- Mark, 2026-10-31 / 11-01 (docs/customer-credit-memos-brief.md, phase 0):
-- Knotted was handed 518 Bismarks of the 560 ordered and paid for, and the app
-- had nowhere to say so. Standard order-to-cash keeps THREE quantities, each
-- its own record — ordered (the order, never edited to say what happened),
-- delivered (this), invoiced (the invoice lines, 141).
--
-- 1. `special_order_items.delivered_qty`. NULL means DELIVERED AS ORDERED
--    (Mark: "set the delivery amount to the ordered amount by default"); a
--    recorded short carries its reason, who and when. Recorded on the order
--    (`record_order_short`, supervisor and up — the order screen's own write
--    access), never above the ordered quantity.
-- 2. The credit memo tables (filled by 218), created here so the billing
--    functions below can count what memos have credited.
-- 3. THE BILLING FUNCTIONS AIM AT A TARGET QUANTITY, not the ordered one:
--
--        billable = least(coalesce(delivered, ordered), ordered)
--        target   = greatest(billable, least(billed − credited, ordered))
--
--    · not yet invoiced → billed 0 → the target is what was delivered, so the
--      invoice bills 518 and no memo is ever needed;
--    · billed 560, then a short → the target stays 560: a short on BILLED
--      quantity is the memo's to correct, never 176's "Less invoice" (which
--      would credit the customer with no memo, no approval and nothing in
--      QuickBooks). It raises the order's to-do instead (section 6);
--    · after a 42 memo → billed − credited = 518 = billable: nothing to bill;
--    · an ORDER decrease after billing (no short) still falls to 176's copy
--      as it always has.
--
--    `special_order_target_money` is 104's `special_order_money` with the
--    target quantity in place of the ordered one; `special_order_unbilled`,
--    `order_item_billing` and `order_invoice_lines` read it, and count memo
--    credit as billing. `special_order_money` itself — the ORDER's total — is
--    untouched.
-- 4. `customer_invoice_lines.ordered_qty`: what was ordered, beside `qty`, the
--    quantity the line bills, so the paper can print Ordered and Delivered.
-- 5. `order_delivery` — the order's Ordered · Delivered · Billed · Credited
--    per item, for the Items tab and the Issue Credit Memo dialog.
-- 6. A SHORT ON BILLED QUANTITY THAT NO MEMO COVERS sets the to-do "Issue
--    Credit Memo" (over an empty one only, 161's rule) until a memo covers
--    it, a manager decides on no credit, or the short is cleared.
--
-- Run after 216. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The delivery record
-- ----------------------------------------------------------------------------
alter table special_order_items
  add column if not exists delivered_qty numeric(10,2),
  add column if not exists delivered_note text,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references auth.users(id);

alter table special_order_items drop constraint if exists special_order_items_delivered_not_negative;
alter table special_order_items add constraint special_order_items_delivered_not_negative
  check (delivered_qty is null or delivered_qty >= 0);

-- A manager's decision that a short gets NO credit (a make-good, a gift).
-- Cleared whenever the delivery record changes, so a new short asks again.
alter table special_orders
  add column if not exists short_decision text,
  add column if not exists short_decision_note text,
  add column if not exists short_decision_by uuid references auth.users(id),
  add column if not exists short_decision_at timestamptz;

alter table special_orders drop constraint if exists special_orders_short_decision_check;
alter table special_orders add constraint special_orders_short_decision_check
  check (short_decision is null or short_decision = 'no_credit');

-- What an invoice line's order ordered, beside the quantity it bills.
alter table customer_invoice_lines add column if not exists ordered_qty numeric(10,2);


-- ----------------------------------------------------------------------------
-- 2. Credit memos (filled by 218)
-- ----------------------------------------------------------------------------
create table if not exists customer_credit_memos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id) on delete cascade,
  customer_id        uuid not null references customers(id) on delete restrict,
  number             integer not null,
  kind               text not null check (kind in ('short_shipment', 'allowance')),
  reason_code        text not null,
  note               text,
  issued_on          date not null,
  -- The invoice it corrects (required for a short), and the order.
  credits_invoice_id uuid references customer_invoices(id) on delete restrict,
  special_order_id   uuid references special_orders(id) on delete restrict,
  location_id        uuid references locations(id) on delete set null,
  -- Who collected what it corrects, and so where it goes: a QuickBooks memo is
  -- pushed as a QuickBooks CreditMemo; a Square one leaves no trace there.
  processor          text not null check (processor in ('square', 'quickbooks')),
  -- 'credit': applied to the customer's next invoice. 'refund': given back
  -- through the processor when issued (§6a).
  settlement         text not null default 'credit' check (settlement in ('credit', 'refund')),
  document_path      text,
  external_ref       jsonb,
  sent_at            date,
  voided_at          date,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  unique (org_id, number)
);

create table if not exists customer_credit_memo_lines (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  memo_id               uuid not null references customer_credit_memos(id) on delete cascade,
  special_order_id      uuid references special_orders(id) on delete restrict,
  special_order_item_id uuid references special_order_items(id) on delete set null,
  -- An item line is a quantity at the price it was billed at; discount, rush
  -- and tax are the share of each that quantity carried; an allowance is an
  -- amount with no quantity. Amounts are CREDIT: positive gives back, a
  -- discount line is negative.
  line_type             text not null check (line_type in ('item', 'discount', 'rush', 'tax', 'allowance')),
  description           text not null,
  qty                   numeric(10,2),
  unit_price            numeric(10,2),
  amount                numeric(10,2) not null,
  taxable               boolean not null default false,
  tax_rate              numeric(6,5),
  sort                  integer,
  created_at            timestamptz not null default now(),
  check (line_type <> 'allowance' or qty is null)
);

create index if not exists customer_credit_memos_customer on customer_credit_memos (customer_id);
create index if not exists customer_credit_memos_order on customer_credit_memos (special_order_id);
create index if not exists customer_credit_memo_lines_memo on customer_credit_memo_lines (memo_id);
create index if not exists customer_credit_memo_lines_order on customer_credit_memo_lines (special_order_id);

drop trigger if exists trg_customer_credit_memos_updated on customer_credit_memos;
create trigger trg_customer_credit_memos_updated before update on customer_credit_memos
  for each row execute function set_updated_at();

-- Read by the org; written only by 218's definer functions.
alter table customer_credit_memos enable row level security;
alter table customer_credit_memo_lines enable row level security;
drop policy if exists customer_credit_memos_select on customer_credit_memos;
create policy customer_credit_memos_select on customer_credit_memos for select
  using (org_id in (select user_org_ids()));
drop policy if exists customer_credit_memo_lines_select on customer_credit_memo_lines;
create policy customer_credit_memo_lines_select on customer_credit_memo_lines for select
  using (org_id in (select user_org_ids()));
revoke insert, update, delete on customer_credit_memos, customer_credit_memo_lines from anon, authenticated;
revoke all on customer_credit_memos, customer_credit_memo_lines from anon;

-- The memo series sits beside the invoices' (design rule 2): "CM-" from 10000.
update orgs
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb), '{customer_credit_memos}',
         jsonb_build_object(
           'prefix', 'CM-',
           'first_number', 10000,
           'short_reason', 'Short shipment',
           'allowance_reasons', jsonb_build_array('Quality', 'Late delivery', 'Pricing error', 'Goodwill')
         ) || coalesce(settings -> 'customer_credit_memos', '{}'::jsonb))
 where true;


-- ----------------------------------------------------------------------------
-- 3. What memos have credited an order
-- ----------------------------------------------------------------------------
-- Short-shipment memos only: an allowance names an order for the record and
-- changes nothing about how it is billed (brief §4).
create or replace function public.special_order_credited(p_order uuid)
returns table (items numeric, discount numeric, rush numeric, tax numeric, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.amount) filter (where l.line_type = 'item'), 0)::numeric(10,2),
         -- the DISCOUNT given back: a memo's discount line is negative
         coalesce(-sum(l.amount) filter (where l.line_type = 'discount'), 0)::numeric(10,2),
         coalesce(sum(l.amount) filter (where l.line_type = 'rush'), 0)::numeric(10,2),
         coalesce(sum(l.amount) filter (where l.line_type = 'tax'), 0)::numeric(10,2),
         coalesce(sum(l.amount), 0)::numeric(10,2)
    from customer_credit_memo_lines l
    join customer_credit_memos m on m.id = l.memo_id
   where l.special_order_id = p_order
     and m.kind = 'short_shipment'
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
     and m.kind = 'short_shipment'
     and m.voided_at is null;
$$;
revoke all on function public.special_order_item_credited(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. The target quantity, and the money it comes to
-- ----------------------------------------------------------------------------
-- `p_invoice` is the invoice being built, left out of "billed" exactly as
-- `order_prior_invoice_lines` leaves it out (with the invoice it replaces).
create or replace function public.special_order_item_targets(p_order uuid, p_invoice uuid default null)
returns table (item_id uuid, ordered numeric, billable numeric, billed_qty numeric, credited_qty numeric, target numeric)
language sql
stable
security definer
set search_path = public
as $$
  select it.id,
         coalesce(it.qty, 0)::numeric(10,2),
         least(coalesce(it.delivered_qty, it.qty, 0), coalesce(it.qty, 0))::numeric(10,2),
         coalesce(b.q, 0)::numeric(10,2),
         special_order_item_credited(it.id),
         greatest(
           least(coalesce(it.delivered_qty, it.qty, 0), coalesce(it.qty, 0)),
           least(coalesce(b.q, 0) - special_order_item_credited(it.id), coalesce(it.qty, 0))
         )::numeric(10,2)
    from special_order_items it
    left join lateral (
      select sum(p.qty) as q
        from order_prior_invoice_lines(p_order, p_invoice) p
       where p.line_type = 'item' and p.special_order_item_id = it.id and p.qty is not null
    ) b on true
   where it.order_id = p_order;
$$;
revoke all on function public.special_order_item_targets(uuid, uuid) from public, anon, authenticated;

-- 104's `special_order_money`, line for line, with each item's TARGET quantity
-- in place of its ordered one. The float order and `js_cents` are the same, so
-- an order nobody shorted comes to exactly `special_order_money`.
create or replace function public.special_order_target_money(p_order uuid, p_invoice uuid default null)
returns table (subtotal numeric, discount numeric, delivery numeric, rush numeric, tax numeric, total numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o record;
  l record;
  v_sum double precision := 0;
  v_taxable_sum double precision := 0;
  v_sub double precision;
  v_taxable double precision;
  v_disc double precision;
  v_kept double precision;
  v_tax double precision;
  v_deliv double precision;
  v_rush double precision;
begin
  select so.*, coalesce(nullif(g.settings -> 'special_orders' ->> 'rush_minimum', '')::double precision, 25) as rush_minimum
    into o
    from special_orders so join orgs g on g.id = so.org_id
   where so.id = p_order;
  if not found then
    return;
  end if;

  for l in
    select coalesce(t.target, 0)::double precision as q, coalesce(i.unit_price, 0)::double precision as p, i.taxable
      from special_order_items i
      join special_order_item_targets(p_order, p_invoice) t on t.item_id = i.id
     where i.order_id = p_order
     order by i.sort nulls last, i.id
  loop
    v_sum := v_sum + l.q * l.p;
    if l.taxable then v_taxable_sum := v_taxable_sum + l.q * l.p; end if;
  end loop;

  v_sub := js_cents(v_sum);
  v_taxable := js_cents(v_taxable_sum);
  v_disc := js_cents(coalesce(o.discount_amount, 0)::double precision
                     + v_sub * coalesce(o.discount_rate, 0)::double precision);
  v_kept := case when v_sub > 0 then greatest(0, (v_sub - v_disc) / v_sub) else 0 end;
  v_tax := js_cents(v_taxable * v_kept * coalesce(o.tax_rate, 0)::double precision);
  v_deliv := js_cents(coalesce(o.delivery_charge, 0)::double precision);
  v_rush := case
              when o.rush_rate is null then js_cents(coalesce(o.rush_fee, 0)::double precision)
              when o.rush_rate <= 0 then 0
              else js_cents(greatest(v_sub * o.rush_rate::double precision, o.rush_minimum))
            end;

  subtotal := round(v_sub::numeric, 2);
  discount := round(v_disc::numeric, 2);
  delivery := round(v_deliv::numeric, 2);
  rush := round(v_rush::numeric, 2);
  tax := round(v_tax::numeric, 2);
  total := round(js_cents(v_sub - v_disc + v_deliv + v_rush + v_tax)::numeric, 2);
  return next;
end;
$$;
revoke all on function public.special_order_target_money(uuid, uuid) from public, anon, authenticated;

-- 141's rule, aimed at the target and with memo credit counted as billing.
create or replace function public.special_order_unbilled(p_order uuid, p_except uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (case when o.status = 'cancelled' then 0 else m.total end
          - special_order_billed(p_order, p_except)
          + (select c.total from special_order_credited(p_order) c))::numeric(10,2)
    from special_orders o, special_order_target_money(o.id, p_except) m
   where o.id = p_order;
$$;
revoke all on function public.special_order_unbilled(uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. 176's billing, aimed at the target
-- ----------------------------------------------------------------------------
-- `qty` is now the item's TARGET quantity (what it should be billed for), and
-- `credited_qty` what memos gave back of it. Its only caller is 176's
-- `order_invoice_lines`, below.
drop function if exists public.order_item_billing(uuid, uuid);
create function public.order_item_billing(p_order uuid, p_invoice uuid)
returns table (item_id uuid, name text, qty numeric, unit_price numeric, taxable boolean, seq bigint,
               billed_qty numeric, billed_amount numeric, billed_adjust numeric, repriced boolean, retaxed boolean,
               ordered_qty numeric, credited_qty numeric)
language sql
stable
security definer
set search_path = public
as $$
  select it.id, it.name, t.target, coalesce(it.unit_price, 0)::numeric, it.taxable,
         row_number() over (order by it.sort nulls last, it.id),
         coalesce(sum(p.qty) filter (where p.qty is not null), 0),
         coalesce(sum(round(p.qty * coalesce(p.unit_price, 0), 2)) filter (where p.qty is not null), 0),
         coalesce(sum(p.amount) filter (where p.qty is null), 0),
         coalesce(bool_or(p.qty is not null
                          and p.unit_price is distinct from coalesce(it.unit_price, 0)::numeric(10,2)), false),
         coalesce(bool_or(p.invoice_id is not null and p.taxable is distinct from it.taxable), false),
         t.ordered,
         t.credited_qty
    from special_order_items it
    join special_order_item_targets(p_order, p_invoice) t on t.item_id = it.id
    left join order_prior_invoice_lines(p_order, p_invoice) p
      on p.line_type = 'item' and p.special_order_item_id = it.id
   where it.order_id = p_order
   group by it.id, it.name, t.target, it.unit_price, it.taxable, it.sort, t.ordered, t.credited_qty;
$$;
revoke all on function public.order_item_billing(uuid, uuid) from public, anon, authenticated;

-- 176's `order_invoice_lines` IN FULL, changed where marked (<<< 217):
--   · the money is the TARGET's, and an item's quantity its target;
--   · what memos credited counts as billing, so a shorted, credited order is
--     what was added and nothing more;
--   · every item line says what was ORDERED (`ordered_qty`);
--   · 143's copy, when it is taken, gives back the memo credit beside its
--     "Less invoice" lines, or it would bill the credited amount twice.
drop function if exists public.order_invoice_lines(uuid, uuid);
create function public.order_invoice_lines(p_order uuid, p_invoice uuid)
returns table (line_type text, description text, qty numeric, unit_price numeric, amount numeric,
               taxable boolean, tax_rate numeric, special_order_item_id uuid, sort integer, ordered_qty numeric)
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
  pr record;
  cr record;                                                                 -- <<< 217
  cm record;                                                                 -- <<< 217
  v_cm_prefix text;                                                          -- <<< 217
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
  select so.*, coalesce(g.settings -> 'customer_invoices' ->> 'prefix', '') as prefix,
         coalesce(g.settings -> 'customer_credit_memos' ->> 'prefix', '') as cm_prefix   -- <<< 217
    into o
    from special_orders so join orgs g on g.id = so.org_id
   where so.id = p_order;
  if not found then
    return;
  end if;
  select * into m from special_order_target_money(p_order, p_invoice);            -- <<< 217
  select * into cr from special_order_credited(p_order);                          -- <<< 217
  v_prefix := o.prefix;
  v_cm_prefix := o.cm_prefix;
  select ci.revision_of into v_replaces from customer_invoices ci where ci.id = p_invoice;

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
    -- <<< 217: billed NET of what memos gave back
    v_d_discount := m.discount - (pr.discount - cr.discount);
    v_d_delivery := m.delivery - pr.delivery;
    v_d_rush := m.rush - (pr.rush - cr.rush);
    v_d_tax := m.tax - (pr.tax - cr.tax);
    v_added := v_d_discount >= 0 and v_d_delivery >= 0 and v_d_rush >= 0 and v_d_tax >= 0;

    if v_added then
      for it in select * from order_item_billing(p_order, p_invoice) b order by b.seq loop
        v_adjust := case when it.repriced or it.billed_adjust <> 0
                         then round(it.billed_qty * it.unit_price, 2) - it.billed_amount - it.billed_adjust
                         else 0 end;
        if it.retaxed or it.billed_qty - it.credited_qty > it.qty or v_adjust < 0 then   -- <<< 217
          v_added := false;
          exit;
        end if;
        v_add := round((it.qty - (it.billed_qty - it.credited_qty)) * it.unit_price, 2);  -- <<< 217
        v_emitted := v_emitted + v_add + v_adjust;
        if v_add > v_big_amount then
          v_big_amount := v_add; v_big_qty := it.item_id;
        end if;
        if v_adjust > v_big_adjust_amount then
          v_big_adjust_amount := v_adjust; v_big_adjust := it.item_id;
        end if;
      end loop;
    end if;

    if v_added then
      v_penny := (m.subtotal - (pr.items - cr.items)) - v_emitted;                     -- <<< 217
      if abs(v_penny) > 0.05 or (v_penny <> 0 and v_big_qty is null and v_big_adjust is null) then
        v_added := false;
      end if;
    end if;
  end if;

  if v_added then
    for it in select * from order_item_billing(p_order, p_invoice) b order by b.seq loop
      v_add := round((it.qty - (it.billed_qty - it.credited_qty)) * it.unit_price, 2);    -- <<< 217
      v_adjust := case when it.repriced or it.billed_adjust <> 0
                       then round(it.billed_qty * it.unit_price, 2) - it.billed_amount - it.billed_adjust
                       else 0 end;
      if v_add <> 0 then
        line_type := 'item';
        description := it.name;
        qty := it.qty - (it.billed_qty - it.credited_qty);                                -- <<< 217
        unit_price := it.unit_price;
        amount := v_add + case when it.item_id = v_big_qty then v_penny else 0 end;
        taxable := it.taxable;
        tax_rate := null;
        special_order_item_id := it.item_id;
        ordered_qty := it.ordered_qty;                                                    -- <<< 217
        sort := v_n;
        v_n := v_n + 1;
        return next;
      end if;
      if v_adjust <> 0 then
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
        ordered_qty := null;                                                              -- <<< 217
        sort := v_n;
        v_n := v_n + 1;
        return next;
      end if;
    end loop;

    qty := null; unit_price := null; special_order_item_id := null; taxable := false; tax_rate := null;
    ordered_qty := null;                                                                  -- <<< 217
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
  -- From here down is 143's copy, at the target.

  select i.id into v_big
    from special_order_items i
    join special_order_item_targets(p_order, p_invoice) t on t.item_id = i.id          -- <<< 217
   where i.order_id = p_order
   order by abs(round(t.target * coalesce(i.unit_price, 0), 2)) desc, i.sort nulls last, i.id
   limit 1;
  select coalesce(sum(round(t.target * coalesce(i.unit_price, 0), 2)), 0) into v_items
    from special_order_items i
    join special_order_item_targets(p_order, p_invoice) t on t.item_id = i.id          -- <<< 217
   where i.order_id = p_order;
  v_penny := m.subtotal - v_items;

  for it in
    select i.id, i.name, t.target as q, coalesce(i.unit_price, 0) as p, i.taxable, t.ordered   -- <<< 217
      from special_order_items i
      join special_order_item_targets(p_order, p_invoice) t on t.item_id = i.id
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
    ordered_qty := it.ordered;                                                          -- <<< 217
    sort := v_n;
    v_n := v_n + 1;
    return next;
  end loop;

  qty := null; unit_price := null; special_order_item_id := null; taxable := false; tax_rate := null;
  ordered_qty := null;                                                                  -- <<< 217

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

  -- <<< 217: what memos gave back of the billing above is not billed again.
  for cm in
    select c.number, sum(l.amount) as credited
      from customer_credit_memo_lines l
      join customer_credit_memos c on c.id = l.memo_id
     where l.special_order_id = p_order and c.kind = 'short_shipment' and c.voided_at is null
     group by c.id, c.number
    having sum(l.amount) <> 0
     order by c.number
  loop
    line_type := 'prior_billing';
    description := 'Credit memo ' || v_cm_prefix || cm.number;
    amount := cm.credited;
    sort := v_n;
    v_n := v_n + 1;
    return next;
  end loop;
end;
$$;
revoke all on function public.order_invoice_lines(uuid, uuid) from public, anon, authenticated;

-- 176's `write_order_invoice_lines` IN FULL; the copy carries `ordered_qty`.
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
     taxable, tax_rate, special_order_item_id, sort, kind, square_item, order_label, ordered_qty)  -- <<< 217
  select inv.org_id, p_invoice, p_order, x.line_type, x.description, x.qty, x.unit_price, x.amount,
         x.taxable, x.tax_rate, x.special_order_item_id, x.sort, 'balance', o.square_item,
         invoice_line_description(p_order), x.ordered_qty                                       -- <<< 217
    from order_invoice_lines(p_order, p_invoice) x;

  v_earlier := order_prior_invoice_labels(p_order, p_invoice);
  if v_earlier is not null
     and not exists (select 1 from customer_invoice_lines
                      where invoice_id = p_invoice and special_order_id = p_order
                        and line_type = 'prior_billing') then
    update customer_invoice_lines
       set order_label = order_label || ' · in addition to ' || v_earlier
     where invoice_id = p_invoice and special_order_id = p_order;
  end if;
  perform set_config('rf.invoice_line_write', 'off', true);

  select coalesce(sum(amount), 0) into v_net
    from customer_invoice_lines where invoice_id = p_invoice and special_order_id = p_order;
  return v_net;
end;
$$;
revoke all on function public.write_order_invoice_lines(uuid, uuid) from public, anon, authenticated;

-- Lines already copied say what they ordered, where the order item is known.
-- (A function's write, past the frozen-line trigger: the paper is unchanged.)
select set_config('rf.invoice_line_write', 'on', true);
update customer_invoice_lines l
   set ordered_qty = i.qty
  from special_order_items i
 where i.id = l.special_order_item_id
   and l.line_type = 'item' and l.qty is not null and l.ordered_qty is null
   and l.qty = i.qty;
select set_config('rf.invoice_line_write', 'off', true);


-- ----------------------------------------------------------------------------
-- 6. What the order says: Ordered · Delivered · Billed · Credited
-- ----------------------------------------------------------------------------
-- BILLED here is what went out: invoices that are sent or hold money (141's
-- frozen), not drafts — a draft is re-copied when the order changes, so a
-- short before it is sent never needs a memo. `creditable` is the most a short
-- memo may give back of each item; `billed_price` is the price the latest of
-- those invoices billed it at.
create or replace function public.order_delivery_items(p_order uuid)
returns table (item_id uuid, name text, sort integer, ordered numeric, delivered numeric, recorded boolean,
               note text, recorded_by text, recorded_at timestamptz, billed_qty numeric, billed_price numeric,
               credited_qty numeric, creditable numeric, taxable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select it.id, it.name, it.sort,
         coalesce(it.qty, 0)::numeric(10,2),
         least(coalesce(it.delivered_qty, it.qty, 0), coalesce(it.qty, 0))::numeric(10,2),
         it.delivered_qty is not null,
         it.delivered_note,
         (select mb.display_name from org_members mb where mb.user_id = it.delivered_by and mb.org_id = it.org_id),
         it.delivered_at,
         coalesce(b.q, 0)::numeric(10,2),
         b.price,
         special_order_item_credited(it.id),
         greatest(0, coalesce(b.q, 0) - special_order_item_credited(it.id)
                     - least(coalesce(it.delivered_qty, it.qty, 0), coalesce(it.qty, 0)))::numeric(10,2),
         it.taxable
    from special_order_items it
    left join lateral (
      select sum(l.qty) as q,
             (array_agg(l.unit_price order by i.issued_on desc, i.number desc, i.revision desc))[1] as price
        from customer_invoice_lines l
        join customer_invoices i on i.id = l.invoice_id
       where l.special_order_item_id = it.id
         and l.line_type = 'item' and l.qty is not null
         and i.voided_at is null
         and customer_invoice_is_frozen(i.id)
         and not customer_invoice_is_pending_revision(i.id)
    ) b on true
   where it.order_id = p_order;
$$;
revoke all on function public.order_delivery_items(uuid) from public, anon, authenticated;

-- The screen's read: every item, and the order's own figures.
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

-- THE TO-DO. "Issue Credit Memo" over an empty to-do, or cleared when nothing
-- is left to decide. Any other to-do — a person's, or another stage's — is
-- left alone (161's rule).
create or replace function public.refresh_order_short_todo(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
begin
  select exists (select 1 from order_delivery_items(p_order) d where d.creditable > 0)
         and (select short_decision is null from special_orders where id = p_order)
    into v_open;
  update special_orders
     set todo = case
                  when v_open and (todo is null or btrim(todo) = '') then 'Issue Credit Memo'
                  when not v_open and todo = 'Issue Credit Memo' then null
                  else todo
                end
   where id = p_order
     and todo is distinct from case
                  when v_open and (todo is null or btrim(todo) = '') then 'Issue Credit Memo'
                  when not v_open and todo = 'Issue Credit Memo' then null
                  else todo
                end;
end;
$$;
revoke all on function public.refresh_order_short_todo(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. Recording a short, and deciding on no credit
-- ----------------------------------------------------------------------------
-- `p_lines`: [{ "item_id": uuid, "delivered": number }]. A line set back to its
-- ordered quantity is CLEARED (delivered as ordered again). A short needs a
-- reason. Supervisor and up — the special_orders update policy's roles.
create or replace function public.record_order_short(p_order uuid, p_lines jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  r record;
  it record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_d numeric(10,2);
  v_changed boolean := false;
  v_fmt text;
begin
  select * into o from special_orders where id = p_order for update;
  if not found or not user_has_role(o.org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'order not found';
  end if;
  if o.kind <> 'order' then
    raise exception 'only an order records a delivery';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'no lines';
  end if;

  for r in select (x ->> 'item_id')::uuid as item_id, (x ->> 'delivered')::numeric as delivered
             from jsonb_array_elements(p_lines) x loop
    select * into it from special_order_items where id = r.item_id and order_id = p_order for update;
    if not found then
      raise exception 'that line is not on order %', o.number;
    end if;
    if r.delivered is null or r.delivered < 0 then
      raise exception 'a delivered quantity is zero or more';
    end if;
    if r.delivered > coalesce(it.qty, 0) then
      raise exception '% was ordered % — more than that is a new line, billed as usual',
        it.name, rtrim(rtrim(to_char(coalesce(it.qty, 0), 'FM999999990.99'), '0'), '.');
    end if;
    v_d := case when r.delivered = coalesce(it.qty, 0) then null else r.delivered end;
    continue when v_d is not distinct from it.delivered_qty
              and (v_d is null or v_note is not distinct from it.delivered_note);
    if v_d is not null and v_note is null then
      raise exception 'a short needs a reason';
    end if;

    update special_order_items
       set delivered_qty = v_d,
           delivered_note = case when v_d is null then null else v_note end,
           delivered_at = case when v_d is null then null else now() end,
           delivered_by = case when v_d is null then null else auth.uid() end
     where id = it.id;
    v_changed := true;

    v_fmt := rtrim(rtrim(to_char(coalesce(it.qty, 0), 'FM999999990.99'), '0'), '.');
    perform log_special_order_event(o.org_id, p_order,
      case when v_d is null
           then format('%s — delivered as ordered (%s); short cleared', it.name, v_fmt)
           else format('%s — delivered %s of %s: %s', it.name,
                       rtrim(rtrim(to_char(v_d, 'FM999999990.99'), '0'), '.'), v_fmt, v_note)
      end);
  end loop;

  if v_changed then
    -- A changed record asks the question again.
    update special_orders
       set short_decision = null, short_decision_note = null, short_decision_by = null, short_decision_at = null
     where id = p_order and short_decision is not null;
    perform refresh_order_short_todo(p_order);
  end if;
end;
$$;
revoke all on function public.record_order_short(uuid, jsonb, text) from public, anon;
grant execute on function public.record_order_short(uuid, jsonb, text) to authenticated;

-- A manager decides a short gets no credit (a make-good, a gift), with why.
-- `p_note` null withdraws the decision.
create or replace function public.decide_order_short(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into o from special_orders where id = p_order for update;
  if not found or not user_has_role(o.org_id, array['owner', 'admin']) then
    raise exception 'only a manager or the owner decides a short gets no credit';
  end if;
  update special_orders
     set short_decision = case when v_note is null then null else 'no_credit' end,
         short_decision_note = v_note,
         short_decision_by = case when v_note is null then null else auth.uid() end,
         short_decision_at = case when v_note is null then null else now() end
   where id = p_order;
  perform log_special_order_event(o.org_id, p_order,
    case when v_note is null then 'Short reopened for a credit memo'
         else 'Short: no credit — ' || v_note end);
  perform refresh_order_short_todo(p_order);
end;
$$;
revoke all on function public.decide_order_short(uuid, text) from public, anon;
grant execute on function public.decide_order_short(uuid, text) to authenticated;
