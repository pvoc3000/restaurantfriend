-- ============================================================================
-- 121 — AN INVOICE PAID ONLINE MAKES THE ORDER AN ORDER
--
-- SQL STARTS AT LINE 45. Everything above it is comment.
--
-- Mark, 2026-09-22, after the first sandbox payment left test order #10070 at
-- "Invoice" with its paid date stamped: "shouldn't the special order status be
-- set to Order when it's paid?"
--
-- Yes, and the app already said so. `DATE_IMPLIES.invoice_paid_at` in
-- `lib/orderWorkflow` is Mark's own pairing — "paid means it is an Order, and
-- the thing left is to print it" — and a payment recorded by hand OFFERS both.
-- 119 declined to do it, borrowing 052's line that an approved quote becoming
-- an invoice "is a decision a person makes". That was the wrong precedent:
-- approving a quote leaves a judgement (is the order ready to invoice?), where
-- a settled invoice leaves none — the ladder DEFINES Order as "paid, printing
-- and scheduling remain". And a pay-link payment arrives with nobody at the
-- desk to accept an offer, so an offer is a status that stays wrong until
-- somebody happens to open the order.
--
-- SO WHEN A PAY-LINK PAYMENT SETTLES THE BALANCE, in the same statement that
-- stamps `invoice_paid_at`:
--
--   · `status` → 'order', ONLY from lead / quote / invoice and only on
--     `kind = 'order'` — never backwards from a later rung, never on a
--     cancelled order, never on a template or standing order (the same
--     `canAdvance` + `keepUseful` rules `lib/orderWorkflow` applies);
--   · `todo` → 'Print Order', ONLY when the to-do is empty or is one the
--     payment ANSWERS: 'Send Invoice', 'Invoice Overdue!', and 117's
--     'Respond to Email/Call'. Anything else — "call about the balloons" — is
--     somebody's note and stays, 117's rule exactly.
--
-- A DEPOSIT CHANGES NOTHING, as before: none of this runs until the balance is
-- clear. Both columns are logged by 054's trigger, so the order's history says
-- "Status changed from invoice to order" with no event written here.
--
-- #10070 is NOT backfilled — it is a test order, and the catch-up offer on its
-- screen (`catchUpOffer`) already proposes the move.
--
-- `record_pay_link_payment` is reproduced IN FULL from 119 (055's rule) with
-- only the settled branch changed, marked below. Arguments unchanged, so 119's
-- service_role-only grant stands and no overload is created.
-- ============================================================================

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

  select (now() at time zone coalesce(settings ->> 'timezone', 'America/Los_Angeles'))::date
    into v_today from orgs where id = t.org_id;

  -- DESIGN RULE 1: org_id explicitly. The conflict target is 119's unique
  -- index, so a retry of the same Square payment is a no-op and says so.
  insert into special_order_payments
    (org_id, order_id, paid_on, amount, payment_type, note, external_ref)
  values
    (t.org_id, t.order_id, v_today, p_amount, 'Square Online',
     nullif(btrim(coalesce(p_note, '')), ''), p_square_payment_id)
  on conflict (org_id, external_ref)
    where payment_type = 'Square Online' and external_ref is not null
  do nothing;
  get diagnostics v_inserted = row_count;

  update special_order_pay_tokens set claimed_until = null where id = t.id;

  select coalesce(sum(amount), 0) into v_paid
    from special_order_payments where order_id = t.order_id;

  if t.total - v_paid <= 0 then
    update special_orders
       set invoice_paid_at = coalesce(invoice_paid_at, v_today),
           -- <<< 121: the ladder's own consequence of being paid.
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
                      then 'Print Order'
                    else todo
                  end
           -- >>> 121
     where id = t.order_id;
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


notify pgrst, 'reload schema';
