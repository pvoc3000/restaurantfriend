-- ============================================================================
-- 225 — THE WEBSITE'S DELIVERY ESTIMATE IS REMEMBERED
--
-- Mark, 2026-11-10: "when a customer submits a special order inquiry with a
-- delivery component, the app populates the delivery fee field with the
-- guestimate it made when the form was filled out. At the very least, if the
-- user doesn't change the value of the delivery cost field before sending a
-- quote, the app should warn the user that the delivery fee was an estimate."
--
-- `submit-inquiry` writes its estimate straight into `delivery_charge`, an
-- ordinary editable field, so nothing on the order said where the number came
-- from — only a log line. This column keeps the estimate beside the fee it
-- seeded. The app reads "still the estimate" as `delivery_charge =
-- delivery_charge_estimate`, so editing the fee to anything else silences the
-- warning with no flag to keep in step, and the column goes on recording what
-- the customer was told on the website.
--
-- BACKFILL: every earlier estimate is in the order log as
-- "Delivery estimated on the website: 4.2 mi, $25.00" (submit-inquiry's own
-- wording since 162); the newest such line per order is copied in.
--
-- Run after 224. Wrap in begin/commit. RERUNNABLE.
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

alter table public.special_orders
  add column if not exists delivery_charge_estimate numeric(10,2);

comment on column public.special_orders.delivery_charge_estimate is
  'The delivery fee the website estimated for an inquiry (submit-inquiry), kept beside delivery_charge, which it seeded. Equal to delivery_charge = the fee is still the estimate (225).';

update public.special_orders o
   set delivery_charge_estimate = e.fee
  from (
    select distinct on (order_id)
           order_id,
           (substring(message from '\$([0-9]+\.[0-9]{2})$'))::numeric as fee
      from public.special_order_events
     where message like 'Delivery estimated on the website:%'
     order by order_id, created_at desc
  ) e
 where e.order_id = o.id
   and e.fee is not null
   and o.delivery_charge_estimate is null;
