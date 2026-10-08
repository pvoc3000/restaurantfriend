-- ============================================================================
-- 180 — A LINE HIDDEN FROM THE CUSTOMER HAS NO COST
--
-- Mark, 2026-10-08: "add the database check."
--
-- 179 let a line be left off the quote, invoice and receipt, and hid the row
-- without touching the money — so a hidden line with a price would leave rows
-- that do not add up to the subtotal the customer is charged. The Items tab
-- already prevents the pair (the Hide box is disabled while the line has a
-- cost, and a hidden line's Price is locked). This is the same rule for every
-- other writer, today or later.
--
-- The cost is `lineTotal`'s (web/src/lib/specialOrders.ts): qty × unit price,
-- to the cent, nulls as zero. Either a zero price or a zero quantity passes.
--
-- One line was hidden when this was written and it has no cost (measured
-- 2026-10-08: 1 hidden, 0 that would fail), so the constraint validates
-- against the whole table. Nothing in
-- the schema rewrites `unit_price` or `qty` in bulk, so no existing function
-- can trip it. RERUNNABLE.
-- ============================================================================

alter table public.special_order_items
  drop constraint if exists special_order_items_hidden_has_no_cost;
alter table public.special_order_items
  add constraint special_order_items_hidden_has_no_cost
  check (
    not hide_from_customer
    or round(coalesce(qty, 0) * coalesce(unit_price, 0), 2) = 0
  );
