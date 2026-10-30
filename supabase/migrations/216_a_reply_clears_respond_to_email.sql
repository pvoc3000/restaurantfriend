-- ============================================================================
-- 216 — AN EMAILED REPLY CLEARS "RESPOND TO EMAIL/CALL"
--
-- Mark, 2026-10-29: "remove any 'respond to email' to-dos after replying to
-- an email".
--
-- `settle_special_order_messages` (214) is where a customer's email becomes
-- ANSWERED — by a reply from the Email tab, or by one from Mail.app that the
-- five-minute check copies in — so that is where the to-do goes too, 117's
-- rule ("a finished stage clears the note") applied to one more act.
--
-- ONLY WHEN THE REPLY ANSWERED SOMETHING, and only when nothing is still
-- waiting afterwards: a customer who wrote again after the reply still needs
-- answering, and the to-do stays until they are. Only the exact value
-- 'Respond to Email/Call', the one the vocabulary (`lib/specialOrders`) and
-- 117/122/161 name; any other to-do is left alone. No reply needed does NOT
-- clear it — that says the email needs no answer, not that one was given.
--
-- plpgsql rather than 214's single SQL statement, because the second update
-- must SEE the first: inside one statement every CTE reads the same snapshot,
-- so a message settled a line earlier would still look unanswered.
--
-- Same name, arguments and return type, so 214's revokes stand: only the
-- service role (`order-mail`) calls it.
-- ============================================================================

begin;

create or replace function public.settle_special_order_messages(p_orders uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settled uuid[];
begin
  with settled as (
    update special_order_messages m
       set handled_at = (
             select min(o.sent_at) from special_order_messages o
              where o.order_id = m.order_id and o.direction = 'out' and o.sent_at > m.sent_at
           )
     where m.order_id = any(p_orders)
       and m.direction = 'in'
       and m.handled_at is null
       and exists (
             select 1 from special_order_messages o
              where o.order_id = m.order_id and o.direction = 'out' and o.sent_at > m.sent_at
           )
    returning m.order_id
  )
  select coalesce(array_agg(order_id), '{}') into v_settled from settled;

  update special_orders s
     set todo = null
   where s.id = any(v_settled)
     and s.todo = 'Respond to Email/Call'
     and not exists (
           select 1 from special_order_messages w
            where w.order_id = s.id and w.direction = 'in' and w.handled_at is null
         );

  return coalesce(array_length(v_settled, 1), 0);
end;
$$;

revoke all on function public.settle_special_order_messages(uuid[]) from public;
revoke all on function public.settle_special_order_messages(uuid[]) from anon;
revoke all on function public.settle_special_order_messages(uuid[]) from authenticated;

commit;
