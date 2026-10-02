-- ============================================================================
-- 171 — 492 FILEMAKER ORDERS WERE DISCOUNTED TWICE
--
-- Found 2026-10-02 while making the two discount fields exclusive (Mark: "if
-- a user enters a dollar discount amount, the percentage discount field should
-- be cleared disabled, and vice versa"). `orderTotals` and
-- `special_order_money` ADD `discount_amount` and `discount_rate`, and 492
-- migrated orders carry BOTH: the percentage, and that percentage's own dollar
-- figure (491 to the cent; SO-8432 one rounding step off). FileMaker stored
-- the computed amount beside the rate; here it is counted a second time.
--
-- Measured: none is on an app invoice, 345 have payments (and so read as
-- OVERPAID — a credit that never existed), 29 are cancelled, and one is live:
-- SO-9849, a quote for 2026-10-19 at $880.22, $84.60 short.
--
-- Mark chose "Fix all 492": the dollar amount is cleared and the PERCENTAGE
-- kept, which is what the customer was offered. The rows as they stood —
-- amount, rate, subtotal, discount and total — are saved in
-- `FMP Export/pre171-double-discounts-2026-10-02.json`. Each order's change
-- log records the cleared amount (`trg_log_special_order`).
--
-- RERUNNABLE: a second run finds nothing holding both.
-- ============================================================================

update special_orders
   set discount_amount = null
 where coalesce(discount_amount, 0) <> 0
   and coalesce(discount_rate, 0) <> 0;
