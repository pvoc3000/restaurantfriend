-- ============================================================================
-- 177 — AN ORDER REMEMBERS HOW ITS ITEMS ARE GROUPED
--
-- Mark, 2026-10-07: "store the grouping on the order."
--
-- The Items tab's Group by (None · Item type · Item cut · Item size · Item ·
-- Price) was a per-browser preference. Since the same day the quote, invoice
-- and receipt list their items under it, and a preference cannot do that: two
-- people sending one quote could send two layouts, and the customer's own
-- browser — which draws `/q` and the signed quote — has no preference at all.
-- So it is a fact about the order.
--
-- 'none' is the document order, which is what every existing order prints
-- today, so nothing already sent or on file changes. The values are
-- `LINE_GROUPINGS` in web/src/lib/specialOrderLines.ts; a new one is an edit
-- to this check as well.
--
-- (CORRECTED by 178: `copy_special_order` DOES carry it — it copies the whole
-- row. Only the standing-order materializer did not.)
-- NOT COPIED by `copy_special_order` (113) or the standing-order materializer
-- (172): both name their columns, so a copy and a standing order's days start
-- at 'none'. Not logged: `trg_log_special_order` watches a named list.
-- RERUNNABLE.
-- ============================================================================

alter table public.special_orders
  add column if not exists line_grouping text not null default 'none';

alter table public.special_orders
  drop constraint if exists special_orders_line_grouping_check;
alter table public.special_orders
  add constraint special_orders_line_grouping_check
  check (line_grouping in ('none', 'type', 'cut', 'size', 'item', 'price'));

notify pgrst, 'reload schema';
