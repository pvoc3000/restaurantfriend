-- ============================================================================
-- 168 — SWITCHING AN ORDER TO PICKUP REMOVES ITS DELIVERY CHARGE
--
-- Mark, 2026-10-02: "when the user changes an order from delivery to pickup,
-- we either need to hide and disregard the delivery fee if there is one or
-- delete it."
--
-- DELETED, not disregarded. An order's money is worked out twice — the
-- browser's `orderTotals` and `special_order_money` (128) here — and read by
-- the documents, invoices, balances, the Square order and QuickBooks. A charge
-- that is kept but ignored would have to be ignored identically in every one
-- of them; a charge that is gone is gone everywhere at once. The change log
-- (`trg_log_special_order`, AFTER UPDATE, comparing whole rows) records the
-- old figure, so switching back to delivery can re-enter it.
--
-- THE SCREEN ASKS FIRST (Mark: "you should prompt the user to make sure they
-- want to clear the fee before doing so") and then writes both columns in one
-- update (`FulfillmentCell`). This trigger is the backstop for every OTHER
-- path that changes fulfillment, today or later. It fires ONLY ON THE SWITCH: 377 orders are already pickup with a
-- charge, among them every Cafe Knotted standing-order day ($40–$50, live and
-- invoiced), and those are left exactly as they are. Nothing else on
-- `special_orders` watches `delivery_charge` by column list, so changing it
-- from a BEFORE trigger misses no AFTER trigger (checked 2026-10-02).
--
-- The delivery details (address, window, company, tracking) stay: they cost
-- nothing, the Delivery tab hides with the choice, and switching back finds
-- them where they were. RERUNNABLE.
-- ============================================================================

create or replace function public.trg_special_order_pickup_drops_delivery_charge()
returns trigger
language plpgsql
as $$
begin
  if new.fulfillment is distinct from 'delivery' then
    new.delivery_charge := null;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_special_order_pickup_drops_delivery_charge() from public;
revoke all on function public.trg_special_order_pickup_drops_delivery_charge() from anon;

drop trigger if exists trg_special_orders_pickup_drops_delivery_charge on special_orders;
create trigger trg_special_orders_pickup_drops_delivery_charge
  before update of fulfillment on special_orders
  for each row
  when (old.fulfillment is distinct from new.fulfillment)
  execute function public.trg_special_order_pickup_drops_delivery_charge();
