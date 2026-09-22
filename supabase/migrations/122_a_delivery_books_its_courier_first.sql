-- ============================================================================
-- 122 — A DELIVERY PAID IN FULL BOOKS ITS COURIER FIRST
--
-- SQL STARTS AT LINE 36. Everything above it is comment.
--
-- Mark, 2026-09-22: "if the order is set for delivery, when it's paid in full,
-- the to do should be set to 'schedule delivery'".
--
-- TWO HALVES, and the second is what keeps the first from getting stuck:
--
-- 1. `record_pay_link_payment` (reproduced IN FULL from 121, 055's rule; one
--    change, marked) sets the to-do to 'Schedule Delivery' instead of 'Print
--    Order' when `fulfillment = 'delivery'` and `delivery_scheduled_at` is
--    still empty. Same conditions as 121 otherwise — only on the payment that
--    clears the balance, only from lead/quote/invoice on `kind = 'order'`, and
--    only over an empty to-do or one the payment answers. It is the SQL copy of
--    `paidTodo` in `lib/specialOrders`, which the hand-recorded offer
--    (`lib/orderWorkflow`) and the derived suggestion (`suggestedTodo`) share.
--
-- 2. `trg_special_order_stage_clears` (117, reproduced IN FULL; one branch
--    added) now lets the FIRST stamp of `delivery_scheduled_at` clear a to-do of
--    'Schedule Delivery' or 'Respond to Email/Call'. 117 left this column out on
--    purpose — "booking a courier is a different act that Mark did not name …
--    One line to add if he wants it" — and a to-do the app now SETS has to be
--    one the app can also clear, or "Schedule Delivery" would sit there after
--    the courier was booked. Once cleared, `suggestedTodo` offers Print Order.
--
--    DELIBERATELY TO-DO ONLY: unlike 117's five stages, booking a courier does
--    NOT clear a system flag. Mark named five acts for that in 117; this one
--    was named for the to-do, and widening the flag rule is his call.
--
-- Arguments and trigger names are unchanged, so every grant stands and no
-- overload or second trigger is created.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE PAY LINK PICKS THE RIGHT TO-DO
-- ----------------------------------------------------------------------------
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
                      -- <<< 122: a delivery not yet booked books first.
                      then case
                             when fulfillment = 'delivery' and delivery_scheduled_at is null
                               then 'Schedule Delivery'
                             else 'Print Order'
                           end
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



-- ----------------------------------------------------------------------------
-- 2. THE COURIER BOOKED ANSWERS "Schedule Delivery"
-- ----------------------------------------------------------------------------
create or replace function public.trg_special_order_stage_clears()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The to-dos this update's stages ANSWER. Empty means no stage finished.
  v_answered text[] := '{}';
  -- <<< 122: stages that clear the to-do but NOT the flag.
  v_todo_only text[] := '{}';
begin
  if old.quote_sent_at is null and new.quote_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Quote'];
  end if;
  if old.invoice_sent_at is null and new.invoice_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Invoice'];
  end if;
  if old.receipt_sent_at is null and new.receipt_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Receipt'];
  end if;
  if old.order_printed_at is null and new.order_printed_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Print Order'];
  end if;
  if old.order_scheduled_at is null and new.order_scheduled_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Schedule Production'];
  end if;
  -- <<< 122
  if old.delivery_scheduled_at is null and new.delivery_scheduled_at is not null then
    v_todo_only := array['Respond to Email/Call', 'Schedule Delivery'];
  end if;
  if new.todo = any (v_todo_only) then
    new.todo := null;
  end if;
  -- >>> 122

  if array_length(v_answered, 1) is null then
    return new;
  end if;

  -- ONLY IF THE STAGE ANSWERS IT. "Adjust time to 9am or later" is a real
  -- value in the real data and is nobody's idea of something a printer settles.
  if new.todo = any (v_answered) then
    new.todo := null;
  end if;

  -- The notice goes whatever the to-do said, and only if the app raised it.
  if new.flag_source = 'system' then
    new.flag_reason := null;
    new.flag_source := null;
  end if;

  return new;
end;
$$;


notify pgrst, 'reload schema';
