-- ============================================================================
-- 128 — A CUSTOMER INVOICE FOLLOWS ITS ORDERS, AND IS RE-SENT WHEN THEY CHANGE
-- ============================================================================
--
-- Mark, 2026-09-23: "one concern I have … is the case where an invoice is sent
-- then the order is changed. That contingency needs to be handled because it
-- happens all the time." Then, choosing: "automatic updates, manual re-send,
-- build it now".
--
-- 124 froze a sent invoice's lines, so a changed order meant void and invoice
-- again — a new number every time somebody adds six donuts. That is replaced:
--
-- 1. THE LINES FOLLOW THEIR ORDERS. Every write that can change what an order
--    owes — its items, its money fields, its status, a payment — re-derives
--    each of its invoice lines, until the invoice is voided. A line bills what
--    the order totals LESS the payments not taken on THIS invoice (a deposit),
--    so money collected on the invoice never shrinks its own line; a CANCELLED
--    order bills nothing. The wording follows too (number, title, date).
--    Nobody hand-edits an amount or a description any more: only the sync may.
--
-- 2. THE TOTAL IS NOW DERIVED IN SQL, because a trigger cannot call
--    TypeScript. `special_order_money` is `orderTotals` line for line, IN THE
--    SAME FLOATING POINT (`js_cents`) so it agrees with the screen — the
--    discount before tax and proportional, delivery and rush untaxed, a rush
--    RATE resolving to max(subtotal × rate, the org's minimum). CLAUDE.md's
--    "no stored total" still holds: nothing stores an ORDER's total; an
--    invoice line stores what it BILLS, which is the invoice's own fact. The
--    two derivations are checked against each other over every real order
--    after this is applied (the parity script in the history file).
--
-- 3. A SENT INVOICE THAT HAS CHANGED SAYS SO. Each send records what went out
--    per line (`sent_amount`) and keeps the PDF (`customer_invoice_sends`, one
--    row per send, so what the customer had and when is never lost). A line
--    whose amount has moved from its sent amount makes the invoice "changed
--    since sent" (derived in `lib/customerInvoices`), and the order that
--    changed gets "Send Invoice" as its to-do when its to-do is empty (117: a
--    typed note stays).
--
-- 4. RE-SENDING KEEPS THE NUMBER. `mark_customer_invoice_sent` stamps
--    `last_sent_at`, copies each amount to `sent_amount`, logs "re-sent", and
--    clears "Send Invoice" from its orders — 117's own trigger only clears it
--    the FIRST time a sent date is stamped. The old pay link stands down:
--    `pay_token_state` answers SUPERSEDED for an invoice token whose total no
--    longer matches the invoice, before the paid check, so a customer holding
--    an old link can neither underpay nor be told a grown invoice is paid.
--
-- 5. A CHANGE AFTER PAYMENT REOPENS IT. The paid date is recomputed after
--    every change: an order that grows clears it and the invoice asks for the
--    difference on its next send; one that shrinks leaves a credit, refunded
--    from the order's Payments tab.
--
-- Run in the Supabase SQL editor after 127. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What an order owes, in SQL — `orderTotals`, line for line
-- ----------------------------------------------------------------------------

-- JavaScript's `Math.round(x * 100) / 100`, in the same binary floating point.
-- `orderTotals` runs in double precision, where 65.105 is 65.10499… and rounds
-- DOWN; exact numeric rounds it up. An invoice line must match the figure the
-- order's own screen shows, so this mirrors the screen's arithmetic rather than
-- correcting it — found by running 300 generated orders through both.
create or replace function public.js_cents(x double precision)
returns double precision
language sql
immutable
as $$ select floor(x * 100 + 0.5) / 100 $$;

create or replace function public.special_order_money(p_order uuid)
returns table (
  subtotal numeric, discount numeric, delivery numeric,
  rush numeric, tax numeric, total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o record;
  l record;
  v_minimum double precision;
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

  -- Summed in the ORDER RECORD's line order (drag order), left to right as
  -- `reduce` does: floating-point addition is not associative, and a sum that
  -- lands exactly on a half cent rounds by the order it was added in.
  for l in
    select coalesce(qty, 0)::double precision as q, coalesce(unit_price, 0)::double precision as p, taxable
      from special_order_items where order_id = p_order order by sort nulls last, id
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

-- `customerLabel`: "Company (Person)", else whichever there is.
create or replace function public.customer_label(p_customer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when nullif(btrim(c.company), '') is not null
                and nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), '') is not null
             then btrim(c.company) || ' (' || btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))) || ')'
           else coalesce(nullif(btrim(c.company), ''),
                         nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), ''))
         end
    from customers c where c.id = p_customer;
$$;

-- `orderLineDescription`: "Order #10057 · Cafe Knotted SO (M-Th) · 10/5/2026".
create or replace function public.invoice_line_description(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(' · ',
           'Order #' || o.number,
           coalesce(nullif(btrim(o.title), ''), customer_label(o.customer_id)),
           to_char(o.event_date, 'FMMM/FMDD/YYYY'))
    from special_orders o where o.id = p_order;
$$;

revoke all on function public.special_order_money(uuid) from public, anon, authenticated;
revoke all on function public.js_cents(double precision) from public, anon, authenticated;
revoke all on function public.customer_label(uuid) from public, anon, authenticated;
revoke all on function public.invoice_line_description(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. What went out: per-line sent amounts, and every send kept
-- ----------------------------------------------------------------------------

alter table customer_invoice_lines add column if not exists sent_amount numeric(10,2);
alter table customer_invoices add column if not exists last_sent_at date;

create table if not exists customer_invoice_sends (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  invoice_id    uuid not null references customer_invoices(id) on delete cascade,
  sent_on       date not null,
  sent_to       text,
  total         numeric(10,2),
  document_path text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index if not exists customer_invoice_sends_invoice_idx
  on customer_invoice_sends (invoice_id, created_at desc);

alter table customer_invoice_sends enable row level security;
drop policy if exists customer_invoice_sends_select on customer_invoice_sends;
drop policy if exists customer_invoice_sends_insert on customer_invoice_sends;
create policy customer_invoice_sends_select on customer_invoice_sends for select
  using (org_id in (select user_org_ids()));
create policy customer_invoice_sends_insert on customer_invoice_sends for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- ----------------------------------------------------------------------------
-- 3. Lines are written by the sync, and only Sold as by hand
-- ----------------------------------------------------------------------------

create or replace function public.trg_customer_invoice_lines_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_sync boolean := coalesce(current_setting('rf.invoice_line_sync', true), '') = 'on';
begin
  select sent_at, paid_at, voided_at into inv from customer_invoices
   where id = coalesce(new.invoice_id, old.invoice_id);

  if tg_op = 'INSERT' then
    if inv.sent_at is not null then
      raise exception 'invoice already sent — void it and invoice again';
    end if;
    -- 128: the amount and the wording are the ORDER's, whatever was passed.
    select case when o.status = 'cancelled' then 0
                else m.total - coalesce((select sum(p.amount) from special_order_payments p
                                          where p.order_id = o.id
                                            and p.customer_invoice_id is distinct from new.invoice_id), 0)
           end,
           invoice_line_description(o.id)
      into new.amount, new.description
      from special_orders o, special_order_money(o.id) m
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
  if (new.invoice_id, new.special_order_id, new.description, new.amount, new.sent_amount, new.sort)
     is distinct from
     (old.invoice_id, old.special_order_id, old.description, old.amount, old.sent_amount, old.sort) then
    raise exception 'an invoice line follows its order — change the order instead';
  end if;
  if new.square_item is distinct from old.square_item
     and (inv.paid_at is not null or inv.voided_at is not null) then
    raise exception 'this invoice is paid or void, so what it was sold as is settled';
  end if;
  return new;
end;
$$;

revoke all on function public.trg_customer_invoice_lines_frozen() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_lines_frozen on customer_invoice_lines;
create trigger trg_customer_invoice_lines_frozen
  before insert or update or delete on customer_invoice_lines
  for each row execute function trg_customer_invoice_lines_frozen();

-- ----------------------------------------------------------------------------
-- 4. The sync
-- ----------------------------------------------------------------------------

-- An invoice's paid date, from its lines and the payments taken on it.
create or replace function public.refresh_customer_invoice_paid(p_invoice uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update customer_invoices i
     set paid_at = case
                     when (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = i.id)
                          - customer_invoice_paid(i.id) <= 0
                       then coalesce(i.paid_at, org_today(i.org_id))
                     else null
                   end
   where i.id = p_invoice and i.voided_at is null;
$$;

-- Re-derive every live invoice line of one order. A line that moves away from
-- what was sent puts "Send Invoice" on the order's empty to-do.
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
  v_changed boolean := false;
begin
  if not exists (select 1 from customer_invoice_lines where special_order_id = p_order) then
    return;
  end if;

  perform set_config('rf.invoice_line_sync', 'on', true);

  for l in
    select li.*, i.sent_at
      from customer_invoice_lines li
      join customer_invoices i on i.id = li.invoice_id
     where li.special_order_id = p_order and i.voided_at is null
  loop
    select case when o.status = 'cancelled' then 0
                else m.total - coalesce((select sum(p.amount) from special_order_payments p
                                          where p.order_id = o.id
                                            and p.customer_invoice_id is distinct from l.invoice_id), 0)
           end,
           invoice_line_description(o.id)
      into v_amount, v_desc
      from special_orders o, special_order_money(o.id) m
     where o.id = p_order;

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

create or replace function public.trg_invoice_follows_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_customer_invoice_lines(coalesce(new.order_id, old.order_id));
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    perform sync_customer_invoice_lines(old.order_id);
  end if;
  return null;
end;
$$;

create or replace function public.trg_invoice_follows_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_customer_invoice_lines(new.id);
  return null;
end;
$$;

-- An UNTAGGED payment changes what a line bills; a TAGGED one changes only
-- whether the invoice is paid (a refund reopens it).
create or replace function public.trg_invoice_follows_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.customer_invoice_id, old.customer_invoice_id) is null
     or (tg_op = 'UPDATE' and new.customer_invoice_id is distinct from old.customer_invoice_id) then
    perform sync_customer_invoice_lines(coalesce(new.order_id, old.order_id));
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

revoke all on function public.refresh_customer_invoice_paid(uuid) from public, anon, authenticated;
revoke all on function public.sync_customer_invoice_lines(uuid) from public, anon, authenticated;
revoke all on function public.trg_invoice_follows_items() from public, anon, authenticated;
revoke all on function public.trg_invoice_follows_order() from public, anon, authenticated;
revoke all on function public.trg_invoice_follows_payments() from public, anon, authenticated;

drop trigger if exists trg_special_order_items_invoice on special_order_items;
create trigger trg_special_order_items_invoice
  after insert or update or delete on special_order_items
  for each row execute function trg_invoice_follows_items();

drop trigger if exists trg_special_orders_invoice on special_orders;
create trigger trg_special_orders_invoice
  after update of tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate,
                  status, title, event_date, number, customer_id
  on special_orders
  for each row execute function trg_invoice_follows_order();

drop trigger if exists trg_special_order_payments_invoice on special_order_payments;
create trigger trg_special_order_payments_invoice
  after insert or update or delete on special_order_payments
  for each row execute function trg_invoice_follows_payments();

-- ----------------------------------------------------------------------------
-- 5. Sending, and re-sending with the same number
-- ----------------------------------------------------------------------------

drop function if exists public.mark_customer_invoice_sent(uuid, text);

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

  perform set_config('rf.invoice_line_sync', 'on', true);
  update customer_invoice_lines set sent_amount = amount where invoice_id = p_invoice;
  perform set_config('rf.invoice_line_sync', 'off', true);

  insert into customer_invoice_sends (org_id, invoice_id, sent_on, sent_to, total, document_path, created_by)
  values (inv.org_id, p_invoice, v_today, nullif(btrim(coalesce(p_sent_to, '')), ''),
          (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = p_invoice),
          p_document_path, auth.uid());

  update special_orders o
     set invoice_sent_at = coalesce(o.invoice_sent_at, v_today),
         status = case when o.status in ('lead', 'quote') then 'invoice' else o.status end,
         -- 117 clears it only on the FIRST stamp; a re-send answers it too.
         todo = case when o.todo = 'Send Invoice' then null else o.todo end
   where o.id in (select special_order_id from customer_invoice_lines where invoice_id = p_invoice);

  perform log_special_order_event(inv.org_id, l.special_order_id,
                                  'Invoice ' || inv.number || case when v_resend then ' re-sent' else ' sent' end)
     from customer_invoice_lines l where l.invoice_id = p_invoice;
end;
$$;

revoke all on function public.mark_customer_invoice_sent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_customer_invoice_sent(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. An invoice link sent before a change stands down
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

  if t.customer_invoice_id is not null then
    select * into inv from customer_invoices where id = t.customer_invoice_id;
    if not found then
      return jsonb_build_object('state', 'unknown');
    end if;
    if inv.voided_at is not null then
      return jsonb_build_object('state', 'cancelled');
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

-- ----------------------------------------------------------------------------
-- 7. Bring what exists up to date
-- ----------------------------------------------------------------------------

-- What a sent invoice sent is what its lines say now (nothing tracked it before).
do $$
begin
  perform set_config('rf.invoice_line_sync', 'on', true);
  update customer_invoice_lines l
     set sent_amount = l.amount
    from customer_invoices i
   where i.id = l.invoice_id and i.sent_at is not null and l.sent_amount is null;
  update customer_invoices set last_sent_at = sent_at where sent_at is not null and last_sent_at is null;
  perform set_config('rf.invoice_line_sync', 'off', true);
end $$;

insert into customer_invoice_sends (org_id, invoice_id, sent_on, total, document_path)
select i.org_id, i.id, i.sent_at,
       (select coalesce(sum(amount), 0) from customer_invoice_lines where invoice_id = i.id),
       i.document_path
  from customer_invoices i
 where i.sent_at is not null
   and not exists (select 1 from customer_invoice_sends s where s.invoice_id = i.id);

-- Every live line re-derived from its order.
select sync_customer_invoice_lines(o) from (
  select distinct l.special_order_id as o
    from customer_invoice_lines l join customer_invoices i on i.id = l.invoice_id
   where i.voided_at is null
) x;

notify pgrst, 'reload schema';
